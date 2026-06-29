# Chat Agent 运行状态实现方案

本方案把聊天里的 Agent 占位消息、执行状态、排队状态全部改为后端权威。前端只渲染后端返回的 `messages`、`active_runs`、`queues`，不再根据本地成员状态、发送者名称、乐观占位合并逻辑来推断 Agent 是否正在执行。

下面的行号基于当前代码树，实际开发后会随修改发生偏移。

## 现状分析

当前 Agent 占位消息由多条路径共同生成和维护：

1. 发送消息时，`WorkspaceContext.tsx:3731-3965` 会先在前端本地创建用户消息，并根据本地成员状态和队列快照决定是否创建 pending Agent 占位。
2. `WorkspaceContext.tsx:3679-3729` 的 `stagePendingAgentPlaceholder` 又会在附件发送等路径里额外创建占位。
3. WebSocket 收到 `agent_run_started` 后，`WorkspaceContext.tsx:3185-3254` 会再插入 running placeholder。
4. WebSocket 收到 `agent_activity_line` 后，`WorkspaceContext.tsx:3012-3114` 也可能在没有 placeholder 的情况下创建一个 run placeholder。
5. `refreshMessages` 会在 `WorkspaceContext.tsx:2230-2367` 里重新拉 messages、session agents、run retention、project members、queues，然后通过 `hydrateRunningAgentPlaceholders` 和 `mergePersistedWithRunningPlaceholders` 再次合并占位。

这导致状态来源不止一个：

- 前端本地判断目标成员是否 running 或 queued。
- 后端 queue 表判断消息是否 queued。
- 后端 session agent state 判断成员是否 running。
- chat run retention 判断是否存在 run。
- WebSocket 事件判断 run 是否开始。
- 最终 agent message 的 `run_id` 判断 run 是否结束。

因此容易出现以下问题：

- 前端预测为 queued，但后端实际已经开始执行，导致发送后没有 running 占位。
- WebSocket 在断线、切会话、重连窗口中错过 `agent_run_started`，因为当前 stream 是 broadcast，没有事件重放。
- `agent_delta` 当前依赖已有 run placeholder；如果 placeholder 不存在，thinking delta 会被丢弃。
- live placeholder 使用后端 `agent.name`，最终消息和成员筛选可能使用 project member name，`FreeChatWorkspace.tsx:858-880` 里按 `msg.sender === selectedSidebarMember.name` 过滤会把占位过滤掉。
- pending placeholder、hydrated placeholder、run placeholder 需要互相去重和迁移，`correlateRunningPlaceholdersWithPending`、`mergePersistedWithRunningPlaceholders` 逻辑复杂，任一关联字段缺失都会导致占位消失或重复。
- 排队消息和运行消息在前端用同一套“占位消息”思路处理，导致 queued、processing、running 的边界不清晰。

根因不是某一个 if 写错，而是“运行状态”同时由前端乐观状态和后端事实状态共同驱动。只要网络事件、队列状态、成员名称、run row 创建时机中任意一个环节不同步，前端就可能显示不出 Agent 正在执行占位。

## 为什么修改后有效

修改后的方案把状态来源收敛为一个后端 runtime snapshot：

- `messages` 表示已经持久化的聊天消息。
- `queues` 表示后端确认的排队、阻塞、暂停、运行队列项。
- `active_runs` 表示后端确认正在执行的 run。

这样有效的原因：

1. 前端不再预测状态。发送后前端直接应用后端返回的 runtime snapshot，queued 就显示队列项，running 就显示 active run，占位不再依赖本地成员状态。
2. WebSocket 丢事件不再致命。重连或刷新时重新拉 `/runtime`，即可从后端事实状态恢复 active run 和 queue。
3. activity/delta 不再依赖已有占位。事件处理只 upsert active run；如果本地没有 run，就创建 shell 或刷新 runtime snapshot，不再直接丢弃 thinking。
4. 排队和运行分离。queued message 永远显示为 queue item，不伪装成 running placeholder；只有后端 claim 并绑定 run 后才进入 active run。
5. 成员筛选改用 id。占位和最终消息都用 `session_agent_id`/`agent_id` 关联，避免 display name 不一致导致过滤失败。
6. 合并逻辑大幅减少。前端只需要把 `persisted messages + active run messages` 派生成可见消息，不再维护 pending placeholder、hydrated placeholder、run placeholder 三套状态。

最终效果是：占位是否显示只取决于后端是否有 active run；排队是否显示只取决于后端 queue snapshot。前端变成纯渲染层，状态一致性由后端事务和快照保证。

## 目标契约

新增一个会话级运行时快照：

```ts
type ChatSessionRuntimeSnapshot = {
  session_id: string;
  messages?: ChatMessage[];
  active_runs: ChatActiveRun[];
  queues: MemberQueueSnapshot[];
};

type ChatActiveRun = {
  session_id: string;
  run_id: string;
  session_agent_id: string;
  agent_id: string;
  agent_name: string;
  display_name: string;
  avatar: string;
  model: string | null;
  status: 'starting' | 'running' | 'stopping' | 'waiting_approval';
  source_message_id: string | null;
  client_message_id: string | null;
  started_at: string;
  activity_lines: ChatRunActivityLine[];
};
```

核心规则：

- `active_runs` 只表示真实正在启动、运行、停止、等待审批的 run。
- 排队消息只存在于 `queues[].items`，不显示为 Agent 正在执行占位。
- 当前 run 结束后，后端原子地完成当前队列项并 claim 下一条；下一条真正开始运行后再进入 `active_runs`。
- 前端刷新、重连、发送后都以 runtime snapshot 修正状态。

硬要求：

- `create_message` 和 `upload_message_attachments` 不能在后端写入 run row 或 queued row 之前返回。
- 如果消息可以立即执行，后端必须先创建/绑定 run，并在返回的 `runtime.active_runs` 中包含该 run，状态至少为 `starting` 或 `running`。
- 如果消息需要排队，后端必须先写入 queued row，并在返回的 `runtime.queues` 中包含该队列项。
- 前端发送后是否显示“Agent 正在执行”只看返回的 `runtime.active_runs`；如果返回的是 queue item，就显示排队状态。
- 这条要求是实现“发送后立刻显示正确状态”的关键，否则前端仍然只能等待 WebSocket 或下一次 refresh，问题会复现。

刷新恢复要求：

- Agent 正在执行的占位不能依赖 `agent_delta` 或 `agent_activity_line` 是否已经到达。
- 只要后端已经创建 run row，并且 session agent 仍处于 `starting/running/stopping/waiting_approval` 等 active 状态，`/runtime` 就必须返回对应 `active_run`。
- 如果还没有任何 thinking/activity，`active_run.activity_lines` 返回空数组即可；前端仍然渲染“Agent 正在执行”占位。
- 页面刷新后，前端通过 `/runtime` 重新拿到 `active_runs`，用 `activeRunToMessage` 恢复占位，因此不会因为尚未收到 `agent_delta` 而丢失。
- 如果刷新时 run 已经结束，`/runtime.active_runs` 不再返回该 run，前端应显示最终 agent message；这不是占位丢失，而是状态已经完成。

## 后端修改

### 1. 新增 runtime snapshot 路由

文件：`crates/server/src/routes/chat/runtime.rs`（新文件）

新增类型：

- `ChatActiveRunStatus`：`Serialize`、`TS`、`serde(rename_all = "snake_case")`。
- `ChatActiveRun`：`Serialize`、`TS`。
- `ChatSessionRuntimeSnapshot`：`Serialize`、`TS`。

新增函数：

- `pub async fn get_session_runtime_snapshot(...)`
- `pub async fn build_session_runtime_snapshot(...)`

快照构建逻辑：

1. 读取 `ChatSessionAgent::find_all_for_session(pool, session.id)`。
2. 复用队列快照逻辑读取所有 `MemberQueueSnapshot`。
3. 读取 `ChatRun::list_retention_for_session(pool, session.id, None, 100)`，按 `session_agent_id` 找最新 run。
4. 只对状态为 `Running`、`Stopping`、`WaitingApproval` 的 session agent 生成 active run。
5. 如果 agent 已 active 但还没有 run row，不要前端造假 run id。要么暂时不返回 active run，要么调整后端顺序，确保 run row 先创建再发 running 状态。
6. `display_name` 优先用 `project_members.member_name`，没有则用 `ChatAgent.name`。
7. activity 从该 run 的 `activity.jsonl` 读取；文件未生成时返回空数组。

需要复用或移动的现有逻辑：

- 队列快照 helper 当前在 `crates/server/src/routes/chat/queues.rs:90-102`。
- activity 文件读取当前在 `crates/server/src/routes/chat/runs.rs:118-142`。

### 2. 挂载路由

文件：`crates/server/src/routes/chat/mod.rs`

当前位置：

- 模块声明：`crates/server/src/routes/chat/mod.rs:1-9`
- session 路由区：`crates/server/src/routes/chat/mod.rs:18-151`

修改：

- 增加 `pub mod runtime;`
- 在 session router 中加入 `.route("/runtime", get(runtime::get_session_runtime_snapshot))`
- 建议放在 `/stream` 后面，也就是当前 `mod.rs:29` 附近。

### 3. 发送消息后返回 runtime snapshot

文件：`crates/server/src/routes/chat/messages.rs`

当前位置：

- `CreateChatMessageRequest`：`messages.rs:56-62`
- `create_message`：`messages.rs:174-201`
- `upload_message_attachments` 起点：`messages.rs:207`

修改：

- 新增 `CreateChatMessageResponse { message: ChatMessage, runtime: ChatSessionRuntimeSnapshot }`，派生 `Serialize`、`TS`。
- `create_message` 返回类型从 `ApiResponse<ChatMessage>` 改为 `ApiResponse<CreateChatMessageResponse>`。
- 在 `deployment.chat_runner().handle_message(&session, &message).await;` 之后构建 runtime snapshot。
- 附件上传成功后同样返回 `{ message, runtime }`。

原因：

- 后端已经完成“直接执行还是排队”的判断后，前端立即拿到权威状态。
- 前端不再本地判断 `targetMember.status`、queue blocked、queue paused 等。

### 4. 让流事件具备完整状态

文件：`crates/services/src/services/chat_runner/types.rs`

当前位置：

- `ChatRunActivityLine`：`types.rs:78-92`
- `ChatStreamEvent::AgentDelta`：`types.rs:126-135`
- `AgentRunStarted`：`types.rs:136-148`
- `QueueUpdated`：`types.rs:170-174`

推荐修改：

- 长期建议新增 `ActiveRunUpdated { run: ChatActiveRun }` 和 `ActiveRunRemoved { session_id, run_id, final_message_id }`。
- 这样前端不用从 `AgentRunStarted`、`AgentState`、`AgentActivityLine` 多个事件里拼状态。
- `QueueUpdated` 继续保留，用于队列变化。

如果暂时不新增事件：

- 至少给 `AgentRunStarted` 补齐 `display_name`、`avatar`、`model`。
- `AgentActivityLine` 或 `AgentDelta` 到达时，如果前端没有 active run，必须能触发创建 shell 或刷新 runtime snapshot。

### 5. 发出后端权威 active run 事件

文件：`crates/services/src/services/chat_runner/lifecycle.rs`

当前位置：

- 队列分支：`lifecycle.rs:1271-1333`
- running state 事件：`lifecycle.rs:1375-1384`
- `AgentRunStarted` 事件：`lifecycle.rs:1389-1401`

修改：

- 队列分支只发 `QueueUpdated` 和 `MentionAcknowledged(received)`，不发 active run。
- run row 创建并绑定完成后，发 `ActiveRunUpdated`。
- queued entry 被 claim 后，先发 queue update，再在 run 绑定完成后发 active run update。

文件：`crates/services/src/services/chat_runner/runtime.rs`

当前位置：

- final assistant delta：`runtime.rs:2216-2227`
- final agent state：`runtime.rs:2266-2272`
- 队列完成和下一条 dispatch：`runtime.rs:2354-2435`

修改：

- 最终 agent message 持久化后，发 `ActiveRunRemoved { session_id, run_id, final_message_id }`。
- 如果 run 成功结束并 claim 下一条 queued message，下一条开始时再发新的 `ActiveRunUpdated`。

### 6. 生成 TypeScript 类型

文件：`crates/server/src/bin/generate_types.rs`

当前位置：

- stream/activity 导出：`generate_types.rs:224-232`
- message request 导出：`generate_types.rs:278-285`
- queue 导出：`generate_types.rs:399-408`

修改：

- 导出 `server::routes::chat::runtime::*` 里的新类型。
- 导出 `CreateChatMessageResponse`。
- 执行 `pnpm run generate-types`。
- 不手动编辑 `shared/types.ts`。

## 前端修改

### 1. 新增 API 和类型

文件：`frontend/src/types.ts`

当前位置：

- shared queue 类型导入导出：`frontend/src/types.ts:9-23`
- UI `Message`：`frontend/src/types.ts:65-102`

修改：

- 重新导出 `ChatActiveRun`、`ChatActiveRunStatus`、`ChatSessionRuntimeSnapshot`、`CreateChatMessageResponse`。
- `Message` 仍然保留为 UI shape，但不再承担“前端猜测 Agent 占位”的职责。

文件：`frontend/src/lib/api.ts`

当前位置：

- queue API：`api.ts:495-539`
- message send：`api.ts:545-564`
- attachment upload：`api.ts:599-634`
- run activity：`api.ts:660-688`

修改：

- 新增 `chatRuntimeApi.getSnapshot(sessionId)`，请求 `/api/chat/sessions/{sessionId}/runtime`。
- `chatMessagesApi.send` 返回 `CreateChatMessageResponse`。
- `chatMessagesApi.uploadAttachment` 返回 `CreateChatMessageResponse`。

### 2. 用 active run state 替代占位推断

文件：`frontend/src/context/WorkspaceContext.tsx`

删除或废弃这些推断型逻辑：

- `PENDING_AGENT_MESSAGE_PREFIX`：`WorkspaceContext.tsx:228`
- `isPendingAgentPlaceholder`：`WorkspaceContext.tsx:291-296`
- `isOptimisticPendingAgentPlaceholder`：`WorkspaceContext.tsx:362-366`
- `findPendingAgentPlaceholderIndex`：`WorkspaceContext.tsx:575-599`
- `correlateRunningPlaceholdersWithPending`：`WorkspaceContext.tsx:661-757`
- `makePendingAgentPlaceholder`：`WorkspaceContext.tsx:877-922`
- `hydrateRunningAgentPlaceholders`：`WorkspaceContext.tsx:1115-1174`
- context interface 里的 `stagePendingAgentPlaceholder`：`WorkspaceContext.tsx:1237-1241`
- `stagePendingAgentPlaceholder` 实现：`WorkspaceContext.tsx:3679-3729`

新增：

- 在当前 message/queue state 附近新增：
  `WorkspaceContext.tsx:1371-1376`

```ts
const [activeRunsByRunId, setActiveRunsByRunId] =
  useState<Record<string, ChatActiveRun>>({});
```

- 在 queue helper 附近新增 `applyRuntimeSnapshot(snapshot)`：
  `WorkspaceContext.tsx:2398` 附近。
- 在 `mapBackendChatMessage` 附近新增 `activeRunToMessage(run)`：
  `WorkspaceContext.tsx:2802` 附近。

`activeRunToMessage(run)` 只使用后端字段：

- `id: run-${run.run_id}`
- `sessionId: run.session_id`
- `sender: run.display_name`
- `runId: run.run_id`
- `sessionAgentId: run.session_agent_id`
- `sourceMessageId: run.source_message_id`
- `clientMessageId: run.client_message_id`
- `isAgentRunning: true`
- `isThinking: true`
- `activityLines: run.activity_lines`

### 3. 从 messages + activeRuns + queues 派生可见消息

文件：`frontend/src/context/WorkspaceContext.tsx`

当前位置：

- 可见消息派生：`WorkspaceContext.tsx:3557-3569`

修改为：

```ts
const activeRunMessages = Object.values(activeRunsByRunId)
  .filter((run) => run.session_id === activeSessionId)
  .filter((run) => !activeSessionMessages.some((m) => m.runId === run.run_id))
  .map(activeRunToMessage);

const messages = activeSessionId
  ? filterQueuedUserMessagesFromSnapshot(
      orderMessagesForConversation([...activeSessionMessages, ...activeRunMessages]),
      activeSessionQueues,
      activeSessionId,
    )
  : [];
```

说明：

- queued user message 不出现在主消息流里。
- queue panel 仍然通过 `queuedUserMessagesById` 显示 queued item。
- active run 占位只来自 `activeRunsByRunId`。

### 4. 简化 refreshMessages

文件：`frontend/src/context/WorkspaceContext.tsx`

当前位置：

- `refreshMessages`：`WorkspaceContext.tsx:2230-2367`

修改：

- 不再前端调用 `sessionAgentsApi.list`、`chatRunsApi.listSessionRetention`、`projectApi.listMembers` 来拼 running placeholder。
- 改为调用 `chatRuntimeApi.getSnapshot(activeSessionId)`。
- 推荐 `/runtime?include_messages=true` 一次返回 messages、active_runs、queues。
- 前端只调用 `applyRuntimeSnapshot(snapshot)`。

### 5. 简化发送和附件上传

文件：`frontend/src/context/WorkspaceContext.tsx`

当前位置：

- `sendMessageToSession`：`WorkspaceContext.tsx:3731-3965`
- 前端队列预测：`WorkspaceContext.tsx:3800-3814`
- 本地占位追加：`WorkspaceContext.tsx:3815-3848`
- API response 处理：`WorkspaceContext.tsx:3893-3905`

修改：

- 删除前端队列预测。
- 删除本地 Agent 占位追加。
- 可以保留 optimistic user message，但 Agent 状态必须等后端 response/runtime。
- `chatMessagesApi.send(...).then((response) => { upsert response.message; applyRuntimeSnapshot(response.runtime); })`
- 失败时只移除 optimistic user message，不在 API 模式下创建 mock Agent 占位。

文件：`frontend/src/components/FreeChatWorkspace.tsx`

当前位置：

- destructure `stagePendingAgentPlaceholder`：`FreeChatWorkspace.tsx:739-747`
- 附件上传后调用占位：`FreeChatWorkspace.tsx:1727-1732`
- 普通发送：`FreeChatWorkspace.tsx:1745-1748`

修改：

- 不再从 context 取 `stagePendingAgentPlaceholder`。
- 附件上传也必须走同一个 context send/upload 方法，让 response runtime 更新状态。
- 不再在组件里直接制造 Agent 占位。

### 6. WebSocket 事件只做 upsert/delete

文件：`frontend/src/context/WorkspaceContext.tsx`

当前位置：

- `appendStreamActivityLine`：`WorkspaceContext.tsx:3012-3114`
- `upsertStreamDeltaActivityLine`：`WorkspaceContext.tsx:3116-3183`
- `insertRunningPlaceholder`：`WorkspaceContext.tsx:3185-3254`
- WebSocket switch：`WorkspaceContext.tsx:3314-3454`

修改：

- `insertRunningPlaceholder` 改成 `upsertActiveRun(run)`。
- `appendStreamActivityLine` 更新 `activeRunsByRunId[run_id].activity_lines`。
- 如果 activity/delta 先到但本地没有 active run，不丢弃；创建 shell 或刷新 runtime snapshot。
- `message_new` 带 `run_id` 时，先 upsert final message，再删除对应 active run。
- `queue_updated` 保持更新 `memberQueuesBySessionAgentId`。

### 7. 成员过滤改用 id

文件：`frontend/src/components/FreeChatWorkspace.tsx`

当前位置：

- `displayedMessages` 过滤：`FreeChatWorkspace.tsx:858-880`

修改：

- 非用户消息用 `msg.sessionAgentId === selectedSidebarMember.id` 判断。
- 用户消息仍可按 mention 文本过滤。
- 不再使用 `msg.sender === selectedSidebarMember.name`。

这样可以消除 live placeholder 使用后端 `agent.name`、最终 message 使用 project member name 导致的过滤不一致。

## 队列行为矩阵

| 后端状态 | 前端显示 |
| --- | --- |
| 用户消息已持久化，还没有 queue/run | 只显示用户消息，或输入区显示发送中。 |
| queue row 为 `queued` | 显示队列项，不显示 Agent 正在执行占位。 |
| queue row 为 `processing`，还没有 run id | 显示准备执行的队列项；除非后端暴露 `starting` active run，否则不造假占位。 |
| queue row 为 `running` 且有 run id | 显示 active run 占位；队列里可以隐藏该 running item 或标记为当前执行。 |
| active run 为 `running/stopping/waiting_approval` | 显示 Agent 正在执行占位。 |
| 最终 agent message 带同一 `run_id` | final message 替换 active run；activity 仍按 run id 可查看。 |
| queue 为 `blocked/paused` | 显示队列阻塞/暂停和继续按钮，不显示 active run。 |

## 测试计划

后端：

- 给新 `runtime.rs` 加路由/快照测试。
- 覆盖 active run、active run 无 activity 文件、queued-only、blocked queue、active run + queued backlog。
- 在 chat_runner 测试中覆盖：
  - `lifecycle.rs:1271-1333` 队列分支只发 queue update。
  - `lifecycle.rs:1375-1401` running 分支发 active run update。

前端：

- 更新 `frontend/src/context/WorkspaceContext.test.tsx` 中原 pending placeholder source-check 测试。
- 新增测试：
  - send response 会应用 runtime snapshot。
  - queued response 只显示 queue item，不显示 running placeholder。
  - activity/delta 先到时不会丢失，会创建 shell 或触发 runtime refresh。
  - final message 会移除 active run。
  - 成员筛选按 `sessionAgentId`，不按 sender name。

建议验证命令：

```bash
pnpm run generate-types
pnpm run frontend:check
cargo test -p services chat_runner
cargo test -p server
```

如果 `cargo test -p server` 太宽，可以只跑新增的 runtime route 测试模块。
