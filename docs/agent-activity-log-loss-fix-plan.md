# Agent 运行中日志消失修复方案

本文解决下面两个表面不同、实际根因相同的问题：

1. Agent 正在执行时，用户再发送一条排队消息，思考过程中的非工具调用日志会消失。
2. Agent 正在执行时，从会话 A 切到会话 B，再切回会话 A，已经显示的非工具调用日志会消失。

用户当前在 macOS 桌面端复现。桌面端通过 Tauri 加载同一套
`frontend/dist`，没有单独的聊天状态实现，因此修复应落在共享前端状态层，而不是增加
macOS 专用逻辑。

下面的行号基于当前代码树，开发后可能发生偏移。

## 一句话结论

后端 runtime snapshot 是“已经写入 `activity.jsonl` 的磁盘快照”，WebSocket
状态是“正在实时增长的内存状态”。当前前端收到 snapshot 后直接删除内存状态并用磁盘
快照替换，较旧或不完整的 snapshot 因此会把最新日志覆盖掉。

修复原则是：

> snapshot 可以补充和校正 active run，但同一个 run 的 activity 日志只能单调合并，
> 不能因为一次 snapshot 中暂时没有某一行，就删除前端已经收到的那一行。

## 现象如何产生

### 场景一：运行中发送排队消息

完整时序如下：

```text
Agent 正在输出普通思考内容
  -> WebSocket 发送 agent_delta
  -> 前端创建 live-delta 临时日志行
  -> 该行尚未换行，所以还没有写入 activity.jsonl

用户发送新消息
  -> 后端发现 Agent 正忙，将消息写入队列
  -> create_message 返回 runtime snapshot
  -> snapshot 从 activity.jsonl 读取日志
  -> snapshot 中没有尚未落盘的 live-delta 行

前端应用 snapshot
  -> 删除当前会话的全部 active run
  -> 使用 snapshot.active_runs 重新创建 active run
  -> live-delta 行消失
```

对应代码：

- `frontend/src/context/WorkspaceContext.tsx:4447-4452`：发送成功后调用
  `applyChatRuntimeSnapshot(response.runtime)`。
- `frontend/src/context/WorkspaceContext.tsx:2149-2159`：先删除当前会话的 active
  runs，再使用 snapshot 整体重建。
- `crates/server/src/routes/chat/runtime.rs:154-184`：active run 日志来自
  `read_activity_lines`。
- `crates/server/src/routes/chat/runtime.rs:306-326`：`read_activity_lines` 只读取
  `<run_dir>/activity.jsonl`。

### 场景二：运行中切换会话

完整时序如下：

```text
会话 A 的 Agent 正在输出普通思考内容
  -> 会话 A 的 WebSocket 持续接收 live-delta

用户切到会话 B
  -> React effect cleanup 关闭会话 A 的 WebSocket
  -> 服务端 broadcast 没有事件重放

用户切回会话 A
  -> refreshMessages 拉取 runtime snapshot
  -> 同时重新建立会话 A 的 WebSocket
  -> snapshot 仍只包含已经落盘的日志
  -> applyChatRuntimeSnapshot 整体覆盖 active run
  -> 切换前保存在前端内存中的 live-delta 行消失
```

对应代码：

- `frontend/src/context/WorkspaceContext.tsx:3940-3945`：active session 改变后调用
  `refreshMessages`。
- `frontend/src/context/WorkspaceContext.tsx:2953`：刷新结果调用
  `applyChatRuntimeSnapshot(runtimeSnapshot)`。
- `frontend/src/context/WorkspaceContext.tsx:4151-4157`：切换会话时关闭原会话
  WebSocket。
- `frontend/src/context/WorkspaceContext.tsx:4104-4117`：WebSocket 重连后才恢复接收
  新事件，历史 broadcast 事件不会重放。

### 为什么工具调用日志通常不消失

`crates/services/src/services/agent_activity_stream.rs` 对日志采用两种处理方式：

- 工具调用行设置为 `immediate: true`，收到后立即写入 `activity.jsonl`。
- 普通 thinking 行先进入 `thinking_buffer`，遇到换行或运行结束时才持久化。

所以 runtime snapshot 往往包含工具调用行，却不包含当前仍在增长的普通思考行。这正好
解释了“工具调用日志还在，非工具日志消失”的现象。

## 修复目标

修复完成后必须满足：

1. 运行中发送排队消息，当前已经显示的 activity 行不能减少。
2. 会话 A 切到 B 再切回 A，切换前已经显示的 activity 行不能减少。
3. snapshot 中新增的持久化日志仍然可以补入前端。
4. 同一条日志不能同时显示为 live 临时行和持久化权威行。
5. run 完成后，active run 仍然能够正常移除，不能留下永久“正在执行”占位。
6. 不增加 macOS 专用分支；Web、macOS、Windows 和 Linux 桌面端共享修复。

## 不在本次修复范围内

第一阶段不做以下改造：

- 不把每个 thinking delta 都立即写入磁盘。
- 不把每个会话都改成长连接常驻 WebSocket。
- 不修改队列状态机或 Agent 执行状态机。
- 不修改 `shared/types.ts` 或后端 API 结构。
- 不引入完整的服务端事件重放协议。

这些改动范围更大，也不是阻止“已有日志被 snapshot 删除”所必需的。

## 推荐修复：对 active run 做单调合并

### 1. 抽取纯函数

建议新增：

```text
frontend/src/lib/chatRuntimeSnapshot.ts
frontend/src/lib/chatRuntimeSnapshot.test.ts
```

在纯函数文件中放置：

```ts
reconcileActiveRunsWithSnapshot(previousRuns, snapshot)
mergeActiveRun(existingRun, snapshotRun)
mergeActivityLines(existingLines, snapshotLines)
```

抽取纯函数有三个好处：

1. 不依赖 React，能够直接构造竞态场景做单元测试。
2. `WorkspaceContext` 只负责调用，不继续增加复杂状态判断。
3. 排队发送、会话切换和 WebSocket 重连都自动使用同一套规则。

`RuntimeActiveRun` 当前定义在 `WorkspaceContext.tsx`。实现时可将这个仅供前端运行态
使用的类型一起移动到 helper 文件并导出，避免 helper 反向依赖 React context。

### 2. activity 行的身份

activity 行分为两类：

#### 权威行

后端已经写入 `activity.jsonl` 的行：

- `line_id` 是后端生成的 UUID。
- `sequence` 是后端递增序号。
- snapshot 和 WebSocket `agent_activity_line` 使用相同 `line_id`。

#### live 临时行

前端根据 `agent_delta` 创建的行：

- `line_id` 以 `LIVE_DELTA_ACTIVITY_LINE_PREFIX` 开头。
- 内容可能仍在增长。
- 还没有对应的磁盘记录。

实现 helper 时应把 `LIVE_DELTA_ACTIVITY_LINE_PREFIX` 和判断函数放到同一文件，避免
不同调用路径使用不同规则。

### 3. 合并权威行

权威 activity 是 append-only 数据。合并规则：

1. 先把本地已有的权威行放入 `Map<line_id, line>`。
2. 再放入 snapshot 权威行；相同 `line_id` 时 snapshot 值覆盖旧值。
3. snapshot 暂时缺少、但本地已通过 WebSocket 收到的权威行必须保留。
4. 最后按 `sequence`、`line_id` 排序。

这一步能解决另一种竞态：snapshot 在服务端先生成，新的 WebSocket activity 随后到达
浏览器，但 HTTP 响应更晚到达。如果使用整体替换，较晚到达的旧 HTTP 响应会删除更新的
WebSocket 行；使用并集合并则不会。

### 4. 合并 live 临时行

不能无条件保留 live 行，否则 snapshot 已经包含对应权威行时会显示重复内容；也不能仅
按 `sequence` 无条件删除，因为断线期间可能错过中间权威行，使前端推算的临时 sequence
与服务端 sequence 暂时重叠。

采用保守替换规则：只有同时满足下面条件，才认为 snapshot 权威行已经覆盖 live 行：

1. `sequence` 相同；
2. `stream_type` 相同；
3. 对两边内容执行 `trim()` 后，内容完全相同，或权威行内容以 live 内容开头。

例子：

```text
live:          "正在检查"
authoritative: "正在检查工作区文件"
结果：权威行已经覆盖 live 行，删除 live 行。
```

如果无法确认覆盖关系，保留 live 行。宁可短暂显示一条可能重复的临时行，也不能再次删除
用户已经看到的内容。后续真正的 `agent_activity_line` 到达时，现有
`appendStreamActivityLine` 逻辑仍会清理相应 live 行。

### 5. 合并同一个 active run 的字段

对于相同 `run_id`：

- `status` 使用 snapshot 值，因为执行状态以后端为准。
- `activity_lines` 使用上面的合并结果。
- `source_message_id`：snapshot 非空时使用 snapshot，否则保留本地值。
- `client_message_id`：snapshot 非空时使用 snapshot，否则保留本地值。
- `model`：snapshot 非空时使用 snapshot，否则保留本地值。
- `created_at` 保留有效的原 run 创建时间，不因排队消息响应而变化。
- `session_id`、`session_agent_id`、`agent_id`、名称和头像正常使用 snapshot 更新。

保留关联字段很重要，因为发送排队消息时构建的 snapshot 不会把新排队消息识别成当前
run 的 source message，此时 snapshot 中的关联字段可能是 `null`。直接覆盖会顺带丢失
当前 run 与原用户消息的关联。

伪代码：

```ts
function mergeActiveRun(existing, incoming) {
  if (!existing) return normalizeActiveRun(incoming);

  return {
    ...existing,
    ...incoming,
    source_message_id:
      incoming.source_message_id ?? existing.source_message_id,
    client_message_id:
      incoming.client_message_id ?? existing.client_message_id,
    model: incoming.model ?? existing.model,
    activity_lines: mergeActivityLines(
      existing.activity_lines,
      normalizeActivityLines(incoming.activity_lines),
    ),
  };
}
```

### 6. 合并整个 session 的 active runs

`snapshot.active_runs` 仍然是该会话当前活动 run 的权威集合：

1. 其他会话的 active runs 原样保留。
2. snapshot 中存在、且本地也存在相同 `run_id`：执行字段和日志合并。
3. snapshot 中存在、本地不存在：新增 run。
4. 当前会话本地存在、snapshot 中已不存在：删除 run，表示 run 已结束。

第 4 条保持现有完成态语义，避免修复日志后留下陈旧 running placeholder。

伪代码：

```ts
function reconcileActiveRunsWithSnapshot(previousRuns, snapshot) {
  const next = keepRunsFromOtherSessions(previousRuns, snapshot.session_id);

  for (const snapshotRun of snapshot.active_runs) {
    next[snapshotRun.run_id] = mergeActiveRun(
      previousRuns[snapshotRun.run_id],
      snapshotRun,
    );
  }

  return next;
}
```

### 7. 修改 WorkspaceContext 的应用方式

修改 `frontend/src/context/WorkspaceContext.tsx` 中的
`applyChatRuntimeSnapshot`：

```ts
setActiveRunsByRunId((previousRuns) =>
  reconcileActiveRunsWithSnapshot(previousRuns, snapshot),
);
```

删除当前“先遍历并删除 session 所有 runs，再遍历 snapshot 重建 runs”的代码。

其他调用方保持不变：

- `refreshMessages` 继续调用 `applyChatRuntimeSnapshot`。
- 发送消息成功后继续应用 `response.runtime`。
- WebSocket 重连后继续刷新 runtime。

这样无需给每条触发路径分别打补丁，也不会出现“排队发送修好了、切换会话仍然丢失”的
情况。

## 为什么不采用其他看似简单的修法

### 方案 A：发送排队消息时不应用 runtime snapshot

不推荐。它只能避开场景一，会话切换和 WebSocket 重连仍会调用 snapshot 并复现问题；
同时发送响应中的队列权威状态也无法及时应用。

### 方案 B：每个 thinking delta 都写入 activity.jsonl

不推荐作为第一阶段修复：

- thinking delta 频率高，会产生大量磁盘写入。
- 同一行不断增长，需要定义更新或压缩协议，而 JSONL 当前是 append-only。
- 即使全部落盘，HTTP 响应和 WebSocket 到达顺序仍可能反转，整体覆盖竞态仍然存在。

### 方案 C：切换会话时不关闭 WebSocket

不推荐作为第一阶段修复：

- 需要管理多个会话长连接、重连和清理。
- 同时打开很多会话会增加资源占用。
- 仍不能解决发送排队消息时 HTTP snapshot 覆盖实时状态的问题。

### 方案 D：只按数组长度选择较长的一边

不可靠。两边可能行数相同但内容不同，也可能 snapshot 新增了一条权威行、同时缺少一条
live 行。必须按 `line_id`、`sequence` 和 live/权威身份合并。

## 自动化测试方案

新增 `frontend/src/lib/chatRuntimeSnapshot.test.ts`，使用 `node:assert/strict` 和项目现有
`tsx` 测试风格。

### 用例 1：排队响应不能删除 live thinking

初始状态：

```text
本地 run:
  sequence 0，权威 tool 行
  sequence 1，live thinking 行

snapshot run:
  sequence 0，权威 tool 行
```

断言：合并后两行都存在。

### 用例 2：权威行替换对应 live 行

初始状态：

```text
本地：sequence 1，live thinking，内容“正在检查”
snapshot：sequence 1，权威 thinking，内容“正在检查文件”
```

断言：合并后只保留权威行，不重复显示 live 行。

### 用例 3：较旧 snapshot 不能删除较新的 WebSocket 权威行

初始状态：

```text
本地：权威行 sequence 0、1
snapshot：只有权威行 sequence 0
```

断言：合并后 sequence 0、1 都存在。

### 用例 4：不确定是否覆盖时保留 live 行

本地 live 行和 snapshot 权威行 sequence 相同，但内容没有前缀关系。

断言：两行都保留，避免错误删除断线后新收到的内容。

### 用例 5：保留 run 关联字段

本地 run 有 `source_message_id`、`client_message_id` 和 `model`，snapshot 对应字段为
`null`。

断言：合并后仍保留本地非空字段。

### 用例 6：正确移除已完成 run

当前会话本地有 run，snapshot 的 `active_runs` 已不包含它。

断言：合并后该 run 被删除；其他会话的 run 不受影响。

### 用例 7：不同会话互不影响

对会话 A 应用 snapshot 时，本地会话 B 的 run 和 activity 保持完全不变。

## 手工验证方案（macOS 桌面端）

### 场景一：运行中排队发送

1. 启动 macOS 桌面端。
2. 让一个 Agent 执行持续时间足够长、会产生普通 thinking 的任务。
3. 等活动面板出现非工具调用文字。
4. 在 Agent 仍运行时向同一 Agent 发送新消息，使其进入队列。
5. 确认发送前已经显示的 thinking 内容没有消失。
6. 确认新消息显示为 queued。
7. 确认当前 run 完成后，队列消息能够正常开始执行。

### 场景二：A → B → A

1. 在会话 A 启动长任务，并等待普通 thinking 出现。
2. 切换到会话 B，等待 2 至 5 秒。
3. 切回会话 A。
4. 确认切换前的 thinking 内容仍然存在。
5. 确认后续 activity 能继续追加，而不是覆盖旧内容。
6. 确认 run 完成后占位正常变为最终消息。

### 场景三：WebSocket 重连

1. Agent 运行时短暂断开再恢复网络，或重启后端连接。
2. 等待前端自动重连和 runtime refresh。
3. 确认重连前已经显示的日志没有减少。
4. 确认 snapshot 中新增的持久化日志能够补入。

## 验证命令

先运行新增的纯函数测试：

```bash
cd frontend
pnpm exec tsx src/lib/chatRuntimeSnapshot.test.ts
```

再运行前端类型检查和构建：

```bash
pnpm run frontend:check
pnpm run frontend:build
```

本次第一阶段不修改 Rust 和生成类型，因此不要求重新生成 `shared/types.ts`。

## 预期修改文件

第一阶段只需要：

```text
frontend/src/context/WorkspaceContext.tsx
frontend/src/lib/chatRuntimeSnapshot.ts
frontend/src/lib/chatRuntimeSnapshot.test.ts
```

不应修改：

```text
crates/services/src/services/queued_message.rs
crates/services/src/services/chat_runner/lifecycle.rs
crates/server/src/routes/chat/runtime.rs
shared/types.ts
src-tauri/**
```

## 风险与防护

### 风险一：重复日志

防护：权威行按 `line_id` 去重；live 行只有确认被权威内容覆盖时才删除。测试覆盖重复替换
场景。

### 风险二：run 完成后占位不消失

防护：snapshot 中已经不存在的当前会话 run 仍然删除；WebSocket `agent_state` 和最终消息
处理逻辑保持不变。

### 风险三：日志顺序变化

防护：所有合并结果继续使用现有规则，先按 `sequence`，再按 `line_id` 排序。

### 风险四：旧 snapshot 覆盖新 run

本方案能防止同一 `run_id` 的 activity 回退，但当前 snapshot 没有版本号，理论上仍可能
出现“snapshot 生成后新 run 才开始，但旧 HTTP 响应最后到达”的不同 run 竞态。

这不是当前两个复现路径的主要原因。若第一阶段验证后仍能复现不同 run 被删除，再进入第二
阶段：

1. 给 `ChatSessionRuntimeSnapshot` 增加服务端 `captured_at` 或单调 `revision`。
2. 给本地 active run 记录最后更新时间或来源 revision。
3. 只允许更新版本不小于本地版本的 snapshot 删除 run。
4. 重新生成 `shared/types.ts` 并补充乱序响应测试。

不要在第一阶段同时引入该协议，避免把一个可由前端纯合并修复的 bug 扩大成前后端协议
重构。

## 验收标准

满足以下全部条件才算修复完成：

- 自动化测试 1 至 7 全部通过。
- `pnpm run frontend:check` 通过。
- `pnpm run frontend:build` 通过。
- macOS 桌面端“运行中排队发送”连续验证 3 次无日志减少。
- macOS 桌面端“A → B → A”连续验证 3 次无日志减少。
- run 完成后没有残留 running placeholder。
- activity 面板没有稳定可复现的重复行。
- Web 端行为与桌面端一致。

## 实施顺序

建议严格按下面顺序执行：

1. 先新增纯函数测试，确认当前整体覆盖行为会导致测试失败。
2. 实现 `mergeActivityLines`。
3. 实现 `mergeActiveRun` 和 `reconcileActiveRunsWithSnapshot`。
4. 接入 `applyChatRuntimeSnapshot`，不修改其调用方。
5. 运行纯函数测试、前端类型检查和构建。
6. 在 macOS 桌面端验证排队发送和会话切换。
7. 观察是否还存在不同 run 的乱序覆盖；只有确有复现时才启动 snapshot revision 第二阶段。
