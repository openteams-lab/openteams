# Session 文件变更过滤漏出原因分析

## 结论

当前 session 过滤不是按“最新修改者”过滤，而是按“这个 session 是否曾经关联过该路径”过滤。所有 session 仍然共享同一个 project workspace / Git working tree，所以只要 session A 的路径集合里包含某个文件，session B 后续修改这个文件后，session A 的文件变更列表也会看到它。

因此，所谓“过滤漏掉”主要来自路径归属集合过宽，而不是 Git 状态本身串 session。

## 当前过滤链路

### Project source-control 面板

前端 `SessionSourceControlPanel` 调用：

- `GET /api/projects/{project_id}/source-control/session-status?session_id=<active_session>`

后端链路：

1. `SourceControlService::session_status(...)`
2. `resolve_workspace_context(...)`
3. `status_for_context(...)`
4. `collect_session_paths(pool, session_id, context)`
5. 读取整个 workspace 的 `git status`
6. 只保留 `session_path_set.contains(entry.path)` 的文件

所以 Git 状态是 workspace 级的，session 过滤靠 `collect_session_paths` 产出的路径集合。

### session path 的来源

`collect_session_paths` 读取当前 session 在该 workspace 下的所有 `ChatRun`，再从这些地方收集路径：

- run `meta.json.workspace_observed_paths`
- run-scoped diff patch
- run-scoped untracked snapshot目录
- work_records 里的 artifact 内容

关键点：在 `crates/services/src/services/project/source_control.rs` 的 `collect_paths_from_runs` 里，`meta.json.workspace_observed_paths` 的所有 source 都会被加入 session path 集合，代码没有限定只接受 `git_diff` / `git_untracked`。

## 会导致过滤漏出的原因

### P0：`output_text` / `artifact_record` 被当成 session 归属路径

ChatRunner 在 run 结束时会构造 `workspace_observed_paths`：

- `git_diff`：本次 run 的 tracked diff
- `git_untracked`：本次 run 新增 untracked 文件
- `artifact_record`：agent artifact 记录里提到的路径
- `output_text`：agent 输出文本里提到、且 run 结束时存在的路径

source-control 的 `collect_paths_from_runs` 不区分 source，全部加入 session path。

结果是：

- session A 的 agent 只是“提到”了 `src/foo.ts`
- 或 artifact/conclusion 里写了这个路径
- 即使 session A 没有修改该文件
- 之后 session B 修改 `src/foo.ts`
- session A 也会看到这个文件，因为 A 的 session path 集合已经包含它

这是最像“过滤漏掉”的根因。

### P0：session path 是历史累计，不是本轮/最新修改者

`collect_session_paths` 会读取该 session 在 workspace 下的所有历史 runs。

如果 session A 很早以前改过或记录过 `src/foo.ts`，之后 session B 又修改同一个文件，session A 仍会看到它。当前模型没有“最新写入归属”概念，也没有按最后一次 run、最后修改时间或 run_id 收窄。

这在多人/多 agent 同 workspace 协作下会显得像串 session，但按当前实现是“同一路径被多个 session 共享”。

### P1：共享路径本来会在多个 session 中显示

`collect_shared_paths` 会扫描同 project 下其他 active sessions 的 session paths。如果同一路径存在于多个 session，文件行会带：

- `shared: true`
- `shared_session_ids: [...]`
- `blocked_reason: "Shared with another active session."`

也就是说，当前设计不是“shared path 只显示在最新修改 session”，而是“相关 session 都显示，并在写操作时阻止或要求 force”。

### P1：路径提取启发式过宽

source-control 的 `extract_workspace_paths_from_text` 会按空白切 token，再 normalize 成 workspace-relative path。它不像 chat session workspace-changes 的实现那样明显限制扩展名/inline code 场景。

因此 agent 输出里只要出现一个看起来像路径的 token，就可能被纳入 session path。只要该路径后来出现在 Git status 中，当前 session 就会看到它。

### P1：Project source-control 使用 project workspace，不是 member workspace

`resolve_workspace_context` 默认选 project 的 default workspace 或指定 workspace_id，而不是直接用当前 session agent 的 `workspace_path`。

如果多个 session 共享同一个 project，但用户以为它们的成员 workspace 是隔离的，source-control 面板仍可能在 project default workspace 上展示状态。这会造成“看到了别的 session 文件”的感受。

### P1：缓存导致旧关联短时间残留

`SESSION_PATH_CACHE` 和 `STATUS_CACHE` 都按 session/workspace 缓存。key 包含 session_id，不会天然跨 session 混用，但会保留该 session 过去计算出的路径集合直到 TTL 过期或被 invalidate。

普通 chat runner 完成时会调用：

- `SourceControlService::invalidate_workspace_caches(workspace_path)`
- `SourceControlService::invalidate_session_caches(session_id)`

但其他写入链路如果没有触发同等失效，或者路径归属修正后缓存未清，就会短时间继续显示旧结果。

### P2：fallback related-files 与 source-control 两条路径语义不完全一致

UI 在 Git source-control 可用时使用 `SessionSourceControlPanel`；不可用或 plain workspace 时回退到 `chatSessionsApi.getWorkspaceChanges`。

两套后端路径归属逻辑相似但不完全一致：

- source-control 的 `collect_paths_from_runs` 接收所有 meta observed source
- chat session workspace-changes 的 `collect_session_git_path_union` 对 Git path union 只接受 `git_diff` / `git_untracked`，但 plain observed fallback 又会处理 output/artifact

如果用户在不同模式、不同 workspace 状态下观察，可能看到过滤行为不一致。

## 如何定位是哪一种漏出

对 session A 中误显示的文件 `path`，按顺序查：

1. 调 `GET /api/projects/{project_id}/source-control/session-status?session_id=A`，看该文件是否在 `changes` / `staged_changes` 中，以及 `shared_session_ids` 是否包含 B。
2. 查 session A 的 run meta：`.openteams/runs/<session_A>/run_records/**/meta.json`，搜索该 `path`。
3. 看 meta 里的 `source`：
   - `git_diff` / `git_untracked`：A 历史上确实改过或新增过这个路径。
   - `output_text`：A 只是输出中提到过该路径。
   - `artifact_record`：A 的 artifact 记录关联过该路径。
4. 如果 A 的 run meta/diff/work_records 都没有该路径，但 API 仍显示，则优先查缓存、workspace_id/default workspace 是否选错、以及 fallback related-files 是否被误认为 source-control 结果。

## 修复方向

1. source-control 的 `collect_paths_from_runs` 只把 `git_diff` / `git_untracked` 作为可 stage/commit 的 session-owned paths。
2. `output_text` / `artifact_record` 改为 supplementary related files，不参与 source-control ownership。
3. 如果产品语义要求“只显示本 session 本轮产生的变更”，需要引入 run/round scoped 视图，而不是累计所有历史 run paths。
4. 如果产品语义要求强隔离，需要每个 session 使用独立 workspace/git worktree；共享 working tree 上无法从文件系统层面隔离 Git status。
5. 在 UI 上把 shared paths 和 current-session-owned paths 分区展示，避免 shared path 看起来像当前 session 自己产生。

