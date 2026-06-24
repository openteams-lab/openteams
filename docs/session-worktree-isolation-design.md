# Session Worktree Isolation Design

## 目标

把 session worktree 做成可选能力，用来隔离多 session 并发执行时的
source file change 列表和 run changed-files，默认不增加用户负担。

## 现状入口

- `ChatRunner::resolve_workspace_path_for_agent` 当前优先使用
  `chat_session_agents.workspace_path`，否则使用
  `chat_sessions.default_workspace_path`，最后退回 app 生成目录。
- `ChatRun.workspace_path` 会快照本次 run 的 workspace，session 文件变更接口会按
  `session_id + workspace_path` 查询历史 runs。
- 已有 `WorktreeManager`，支持 create/ensure/cleanup/move worktree，并有按
  worktree path 的创建锁和 metadata cleanup。
- source-control 面板目前按 workspace path 读 Git status；如果 session 绑定到独立
  worktree，面板天然只展示该 worktree 的变更。

## 用户配置模型

建议做三层配置，越靠近 session 优先级越高：

1. 全局默认：`session_worktree_mode = off | ask | auto`
2. Project 默认：是否为新 session 自动创建 worktree
3. Session 创建时选项：`Use isolated worktree`

推荐默认值：

- 新用户/已有项目默认 `ask` 或 `off`，避免突然改变 workspace 行为。
- 在检测到同一 project workspace 已有 active session 正在运行时，UI 推荐开启
  isolated worktree。
- 非 Git workspace 禁用该选项，提示只能使用普通 workspace 或复制目录方案。

Session 创建时的选择是单 session 的总开关：

- 新会话入口增加配置项：`Create isolated worktree for this session`。
- 事项里的“创建会话”入口通过对话弹窗询问是否创建 worktree。
- 只有用户为该 session 开启后，后续才执行 worktree 创建、合并、删除等逻辑，并显示
  worktree 管理 UI。
- 未开启的 session 保持现有主 workspace 行为，不展示 worktree 专属动作。

## 数据模型

新增运行时表，避免只靠 `chat_session_agents.workspace_path` 推断：

```text
chat_session_worktrees
- id
- project_id
- session_id
- base_workspace_path
- repo_path
- base_branch
- base_commit
- branch_name
- worktree_path
- mode: session
- status: creating | active | dirty | merging | merged | archived | cleanup_pending | cleanup_failed
- created_at
- updated_at
- last_used_at
- merged_at
- archived_at
- cleanup_error
```

第一阶段建议按 session 维度建一个 worktree，所有 session agents 共享这个 session
worktree。这样比每个 agent 一个 worktree 更轻量，也符合用户“一个 session 是一条
任务线”的直觉。后续 workflow 如果需要更强隔离，可以扩展到 per-agent 或 per-step。

## 创建流程

触发点：创建 session 后、第一次添加 agent 前、或第一次 run 前 lazy create。

推荐 lazy create：

1. 用户在新会话入口或事项创建会话弹窗中选择 isolated worktree，但不立即执行 Git
   操作。
2. 第一次 agent run 时，后端调用 `SessionWorktreeService::ensure_for_session`。
3. 读取 project/default workspace，确认是 Git repo 且没有 merge/rebase 冲突。
4. 生成稳定 branch/path：
   - branch: `openteams/session/<short-session-id>`
   - path: `<worktree_base>/<project-id>/<session-id>`
5. 使用现有 `WorktreeManager::create_worktree` 或 `ensure_worktree_exists` 创建。
6. 将 session 的 `default_workspace_path` 或该 session 下 agent 的 `workspace_path`
   指向 worktree path。

为了轻量，创建进度只需要在 UI 显示一次短状态：`Preparing isolated workspace...`。
创建完成后用户仍然在同一个 chat 页面工作，不需要理解 Git 命令。

## Run 和 source-control 行为

当 session 使用 isolated worktree：

- agent 执行 cwd 是 session worktree。
- run diff baseline/delta 只在该 worktree 内计算，不会混入其他 session。
- session source-control 面板读取该 worktree 的 Git status。
- 原主 workspace 不应再参与该 session 的 changed-file 归属。

需要保留一个“base workspace”引用，用于 UI 展示来源和合并目标：

```text
Base workspace: E:/workspace/project
Session workspace: E:/.../.openteams-worktrees/<project>/<session>
```

默认 UI 只展示 `Session workspace` 的变更；高级信息折叠展示即可。

当 worktree 合并成功后，当前 session 的文件变更视图切回主 workspace：

- `chat_session_worktrees.status = merged`
- source-control / 文件变更区域的 active workspace 改为 base workspace
- worktree badge 改为 `Merged`，并保留进入历史 worktree diff 的只读入口
- 后续同一 session 如果继续运行 agent，需要用户显式选择：
  `Continue in main workspace` 或 `Create new worktree from current main`

## 合并流程

不要自动静默写回主 workspace。提供一个轻量按钮：

`Merge session changes`

后台步骤：

1. 检查 session worktree 是否 dirty。
2. 如果有未提交变更，自动创建一个 OpenTeams commit，message 可由 session title
   生成，也允许用户编辑。
3. 切到主 workspace 或目标 branch，确认没有正在进行的 merge/rebase。
4. 优先尝试 `git merge --squash <session-branch>` 或 cherry-pick session commit。
5. 无冲突：主 workspace 得到变更，session worktree 标记 `merged`。
6. 有冲突：状态标记 `needs_conflict_resolution`，打开 App 内部的冲突解决 tab，
   不能要求用户跳出到外部编辑器，也不能删除 worktree。

第一阶段推荐 `merge --squash`，因为 session 内可能有多轮 agent 噪声 commit；
用户最终只需要一个可审查变更集。

## App 内冲突解决

合并冲突需要在 App 内完成，建议增加一个独立 tab：

`Merge Conflicts`

触发条件：

- `Merge session changes` 返回冲突。
- App 启动或刷新时检测到 session worktree/main workspace 存在未完成 merge。
- 用户从 source-control 面板点击 `Resolve conflicts`。

后端需要把冲突状态持久化到 session worktree 记录中：

```text
status: needs_conflict_resolution
merge_target_branch
merge_operation: squash_merge | cherry_pick | rebase
conflict_files_json
operation_started_at
```

冲突 tab 的最小 UI：

- 左侧：冲突文件列表，显示 `both modified`、`deleted by us/them` 等状态。
- 中间：三栏 diff/merge 视图：`Current`、`Session Worktree`、`Result`。
- 顶部操作：`Use current`、`Use session`、`Accept both`、`Mark resolved`。
- 底部操作：`Continue merge`、`Abort merge`。

推荐第一阶段先支持文本文件三栏解决；二进制文件、超大文件、删除/重命名冲突先提供
明确的文件级选择：

- Keep current
- Use session version
- Delete file

后端接口建议：

```text
GET  /chat/sessions/{session_id}/worktree/merge-conflicts
GET  /chat/sessions/{session_id}/worktree/merge-conflicts/{path}
POST /chat/sessions/{session_id}/worktree/merge-conflicts/{path}/resolve
POST /chat/sessions/{session_id}/worktree/merge/continue
POST /chat/sessions/{session_id}/worktree/merge/abort
```

`resolve` 接口写入用户选择后的 result 内容，并执行 `git add <path>`。`continue`
接口检查是否仍有 unresolved paths；如果没有，完成 squash commit 或 cherry-pick
continue，并把 worktree 状态更新为 `merged`。`abort` 接口执行对应 Git abort/restore，
状态回到 `dirty` 或 `active`，保留 session worktree。

实现上不要解析冲突 marker 作为唯一真相。后端应优先使用 Git index stages 读取三方内容：

- stage 1: base
- stage 2: current / ours
- stage 3: session / theirs

这样能避免 marker 被用户或工具改坏后无法还原。App 的 result 编辑区保存的是最终工作区
文件内容，保存后再 `git add` 标记 resolved。

## 删除和归档

删除要分成两类：

1. Discard session worktree：用户明确丢弃，允许 force remove。
2. Cleanup merged worktree：已合并且 clean，后台自动清理。

安全规则：

- `status=active|dirty|merging` 时不能自动删除。
- 删除前必须检查 `git status --porcelain`。
- 如果 dirty 且未 merged，只能显示“有未合并变更，是否丢弃”确认。
- archive session 不等于删除 worktree；archive 只把 worktree 标记
  `archived` 或 `cleanup_pending`。
- 删除 worktree 必须同时清理本地文件目录和 Git worktree metadata。优先使用
  `git worktree remove`，失败时进入 `cleanup_failed`，不要只删 DB 记录。
- app 启动时做 reconciliation：DB 有记录但目录缺失、目录存在但 DB 缺失、
  Git metadata stale 都要修复或标记 cleanup_failed。

## 轻量 UX

用户只需要看到三个概念：

- 创建 session 时的 toggle：`Isolate this session in a Git worktree`
- source-control 顶部 badge：`Isolated worktree`
- 结束后的操作：`Merge changes`、`Discard worktree`

worktree 管理 UI 放在右侧文件变更区域，不单独增加全局页面。右侧区域根据当前
worktree 状态切换动作：

- `disabled`：显示主 workspace 文件变更，不显示 worktree 操作。
- `enabled_pending_create`：显示 `Prepare worktree` 或在首次 run 前自动准备。
- `active/dirty`：显示 session worktree 文件变更，提供 `Merge changes`、
  `Discard worktree`。
- `needs_conflict_resolution`：显示 `Resolve conflicts`，打开 App 内冲突 tab。
- `merged`：文件变更切回主 workspace，显示 `Delete worktree` 和只读历史入口。
- `cleanup_failed`：显示 `Retry cleanup`。

不建议把 branch/path/cleanup 细节放在主流程里。高级菜单可以提供：

- Open worktree folder
- Copy branch name
- Rebase onto latest main
- Delete worktree

## 与现有代码的接入点

最小改造路径：

1. 新增 session worktree 表和 model。
2. 新增 `SessionWorktreeService`，复用 `WorktreeManager`。
3. 在 session 创建/update payload 加可选字段：
   `worktree_mode: inherit | disabled | isolated`。
4. 在 `ChatRunner::resolve_workspace_path_for_agent` 中，在 fallback 到
   `default_workspace_path` 前先判断 session 是否启用 isolated worktree。
5. 创建/确保 worktree 后，把该 session agent 的 `workspace_path` 更新为
   worktree path，或把 session default workspace 更新为 worktree path。
   推荐不覆盖用户原始 default，而是保留到新表中，由 resolver 返回有效路径。
6. source-control 状态接口优先解析 session worktree path。
7. session archive/delete 时触发 cleanup policy。

## 风险和边界

- Git LFS、submodule、sparse-checkout 需要继承主 repo 配置；已有
  `WorktreeManager` 使用 git CLI add worktree，有利于保留 Git 行为。
- Windows 路径长度和杀毒扫描可能让 worktree 创建慢；路径应短，避免深目录。
- 多 repo project 第一阶段可只支持 active repo/default workspace；多 repo session
  worktree 需要每个 repo 各建一个 worktree，并在 UI 中聚合状态。
- 如果用户直接在 session worktree 外部编辑文件，这是允许的；它仍属于该 session
  worktree 的变更集。

## 推荐分期

Phase 1:

- session 级 isolated worktree toggle
- lazy create
- run/source-control 使用 worktree path
- 手动 merge squash / discard
- archive 后 safe cleanup

Phase 2:

- 自动推荐开启隔离
- rebase onto latest target branch
- conflict 状态和 UI 引导
- orphan worktree reconciliation dashboard

Phase 3:

- workflow per-agent/per-step worktree
- 多 repo project worktree group
- PR 创建和远程 branch 推送
