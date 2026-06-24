# Agent 运行后消息底部文件变更列表生成与不显示风险报告

## 结论

当前“消息底部文件变更列表”并不是直接使用 WebSocket 的 `file_change_refresh.changed_files` 渲染，而是在前端拿到最终 agent 消息后，依赖消息 `meta.run_id` 再调用 `GET /api/chat/runs/{run_id}/files` 拉取单次 run 的结构化文件列表。

最高概率的问题在前端：`AgentMessageContent` 会在请求发出前先把该 `runId` 的缓存写成空数组。项目入口启用了 React `StrictMode`，开发环境 effect 会被故意挂载/清理/再挂载一次，第一次请求被 cleanup 标记为取消，第二次 effect 看到“空数组缓存”后不再请求，最终真实返回也被丢弃，导致单次任务的文件列表很容易永久显示为空。

## 当前生成链路

### 1. Run 开始时建立变更基线

入口在 `crates/services/src/services/chat_runner/lifecycle.rs`：

- 解析 agent workspace。
- 创建 `.openteams/runs/<session_id>/run_records/session_agent_<id>_run_<index>/`。
- 调用 `capture_workspace_change_baseline(...)` 建立本次 run 的文件变更基线。
- 创建 `ChatRun`，其 `run_dir`、`input_path`、`output_path`、`meta_path` 会用于后续文件列表读取。

基线逻辑在 `crates/services/src/services/workspace_change_capture.rs`：

- Git workspace：用临时 index 记录 run 开始时的 tracked 文件状态。
- 同时用 `git ls-files --others --exclude-standard -z` 记录 run 开始前已有的 untracked 文件。
- 非 Git workspace 时 `git_tree` 为 `None`。

### 2. Run 结束时捕获本次变更

入口在 `crates/services/src/services/chat_runner/runtime.rs` 的 `LogMsg::Finished` 分支：

- 写入 `output.md`。
- 调用 `capture_workspace_change_delta(...)`：
  - tracked 变更：执行 `git diff <baseline_tree> -- .`，过滤路径后写入 `{prefix}_diff.patch`。
  - untracked 变更：再次执行 `git ls-files --others --exclude-standard -z`，减去 run 开始前已有的 untracked 文件。
- 构造 `workspace_observed_paths`：
  - `git_diff` 来自 diff patch 的路径。
  - `git_untracked` 来自新增 untracked 路径。
  - `artifact_record` 来自协议 artifact 记录。
  - `output_text` 来自 assistant 输出文本里提到的路径。
- 把 `workspace_observed_paths` 写入 `meta.json`。
- 最后 emit `file_change_refresh`，其中 `changed_files` 由 `workspace_observed_paths` 转成 created/modified/deleted。

注意：`file_change_refresh` 当前主要是“刷新信号”，前端消息底部列表不直接使用它的 `changed_files`。

### 3. 后端单次 run 文件列表接口

接口在 `crates/server/src/routes/chat/runs.rs`：

- `GET /api/chat/runs/{run_id}/files?include_diff=false`
- 调用 `collect_run_files(run, include_diff)`。

`collect_run_files` 在 `crates/server/src/routes/chat/sessions.rs`：

- 从 `{prefix}_diff.patch` / `run_<index>_diff.patch` / `diff.patch` 中读取 tracked diff。
- 将 diff block 分类为 `modified` / `added` / `deleted`，并统计 `+`/`-`。
- 读取 `meta.json.workspace_observed_paths`，只把 `source` 包含 `git_untracked` 的路径补充到 `untracked`。
- 对 `artifact_record`、`output_text` 等非 git source 不生成 run-level 文件列表行。

### 4. 前端消息底部渲染

核心在 `frontend/src/components/AgentMessageContent.tsx`：

- 只有 `!isRunning && message.runId` 时才请求 run files。
- 调用 `chatRunsApi.getFiles(runId, { includeDiff: false })`。
- 用 `flattenRunFileChanges(...)` 将 `modified/added/deleted/untracked` 拉平成行。
- 再用 `mergeArtifactPaths(...)` 合并当前消息正文里解析出的 artifact 路径。
- `fileRows.length > 0` 时渲染 `AgentArtifactFileList`。

`message.runId` 来自 `frontend/src/lib/mappers.ts` 对后端消息 `meta.run_id` 的映射。

WebSocket `file_change_refresh` 在 `frontend/src/context/WorkspaceContext.tsx` 里只触发 source-control/related-files 刷新，不会更新 `AgentMessageContent` 的 run file cache，也不会把 `changed_files` 注入消息底部。

## 会导致单次任务文件列表不生成/不显示的原因

### P0：前端 run 文件列表缓存被空数组污染

位置：`frontend/src/components/AgentMessageContent.tsx`

当前 effect 的关键行为：

1. 没有缓存时，立即执行 `runFileRowsCache.set(runId, [])`。
2. 发起 `GET /chat/runs/{run_id}/files`。
3. cleanup 时设置 `cancelled = true`。
4. 下次 effect 如果看到 cache 中有 `[]`，就认为已经加载完成，不再请求。

项目入口 `frontend/src/main.tsx` 使用了 `<StrictMode>`。在开发环境，React 会故意重复执行 effect 生命周期：

1. 第一次 effect 写入空缓存并发起请求。
2. StrictMode cleanup 使 `cancelled = true`。
3. 第二次 effect 看到空缓存，直接使用 `[]` 并返回。
4. 第一次请求即使成功返回，也因为 `cancelled` 被丢弃。
5. 该 runId 缓存保持空数组，消息底部不会显示文件列表。

这能解释“单次运行修改的文件列表有较大概率不会生成/显示”。在非 StrictMode 的生产环境，如果组件在请求完成前因为会话切换、消息替换、虚拟列表卸载等原因 unmount，也会触发同类问题。

### P0：请求失败也会永久缓存为空

同一段前端逻辑在 `.catch` 中也会 `runFileRowsCache.set(runId, [])`。

任何一次短暂失败都会让该 runId 后续不再重试，包括：

- 接口短暂 500/网络错误。
- run artifact 被 retention 清理。
- 页面刚恢复连接时请求时机不佳。

因为缓存没有区分 `loading` / `loaded_empty` / `error`，也没有被 `file_change_refresh` 失效，失败后消息底部会持续为空。

### P1：消息没有 `runId` 就不会拉取文件列表

前端渲染条件是 `message.runId && !isRunning`。

正常 agent `send`、raw fallback、conclusion fallback 都会写入 `meta.run_id`；但以下情况不会在普通 agent 消息底部展示 run 文件：

- 协议错误最终落成 system message 或 notice，而不是普通 agent message。
- workflow runtime 只写 workflow runtime line / step run record，没有对应普通 chat agent message。
- 后端某条消息 meta 丢失或没有 `run_id`。

这类情况下，即便后端 run 目录里有 diff，消息底部也没有触发入口。

### P1：run-level 接口强依赖 run artifact 文件

`/chat/runs/{run_id}/files` 读取的是 run 目录里的 patch/meta 文件，而不是直接用数据库或 WebSocket 事件 payload。

因此以下情况会导致列表缺失：

- `{prefix}_diff.patch` 写入失败或被删除：tracked 文件变更不会出现在消息底部。
- `meta.json` 写入失败或被删除：untracked-only 变更不会出现在消息底部。
- retention janitor 在前端拉取前清理了 run artifact/run_dir。
- run_dir 路径不可访问。

当前后端写 `meta.json` 使用 `let _ = fs::write(...)` 忽略错误；patch 写失败也只 warn，不会让后续渲染链路降级到 `file_change_refresh.changed_files`。

### P1：非 Git workspace 或仅 ignored 文件变更不会进入 per-run 底部列表

`capture_workspace_change_baseline` 在非 Git workspace 下没有 `git_tree`，`capture_workspace_change_delta` 不会产生 tracked diff。

run-level `collect_run_files` 只解析：

- diff patch。
- `meta.json` 中 `source=git_untracked` 的路径。

它不会把 `output_text`、`artifact_record` 等 plain observed paths 转成 run-level 文件行。因此：

- 非 Git workspace 的真实文件修改通常不会出现在消息底部。
- `.gitignore` 排除的文件不会被 `git ls-files --others --exclude-standard` 捕获，除非它们以 artifact 路径形式出现在当前 agent 消息正文中。
- session 侧边栏有 plain fallback，但 per-message run files 没有同等 fallback。

### P2：新增 untracked 文件缺少内容快照

`collect_run_files` 支持从 `{prefix}_untracked/` 读取 untracked 文件内容，用于 additions 和 inline diff。

但当前 `capture_workspace_change_delta` 只记录 untracked 路径，没有复制 untracked 文件内容到 `{prefix}_untracked/`。结果通常是：

- untracked 路径仍可能显示。
- additions 为 `0`。
- `has_diff=false`。
- 点击 diff 时没有内联内容。

这不一定导致“列表完全不显示”，但会造成 untracked 行信息退化。

### P2：最终状态无 diff 属于设计行为

后端捕获的是 run 开始基线到 run 结束状态的差异。

这些情况不会生成列表，属于当前语义下的预期：

- agent 修改后又恢复到 run 开始时状态。
- 文件只被读取，没有最终变更。
- 变更只发生在被过滤的 `.openteams` runtime artifact 路径。
- 变更路径非法、绝对路径无法归一化、包含 `..`。

## 建议修复方向

1. 前端修复缓存状态机：不要在请求发出前把 cache 写成 `[]`；只在成功返回后写缓存，或缓存 `Promise/loading/error` 三态。
2. cleanup 只阻止 `setState`，不要阻止成功请求写入共享 cache。
3. 请求失败不要永久缓存空数组，应允许下次 render、展开、`file_change_refresh` 后重试。
4. `file_change_refresh` 按 `run_id` 失效或预填 `runFileRowsCache`，至少用 `changed_files` 做 fallback。
5. 后端 `/runs/{run_id}/files` 在 patch 缺失时可读取 `meta.json.workspace_observed_paths` 的 `git_diff` 路径作为降级列表。
6. run-level 增加 plain observed fallback，使非 Git/ignored 文件也能在消息底部显示。
7. 若需要 untracked diff/count，恢复或实现 `{prefix}_untracked/` 内容快照写入。

## 最小复现判断点

优先验证前端 P0：

1. 在 dev 模式下保持 `StrictMode`。
2. 让 agent 修改一个 tracked 文件并正常结束。
3. 观察 Network 是否有 `/api/chat/runs/<run_id>/files` 成功返回非空。
4. 如果接口返回非空但消息底部为空，基本可确认是 `runFileRowsCache` 空缓存污染。
5. 刷新页面后若偶发恢复，也进一步支持该判断。

