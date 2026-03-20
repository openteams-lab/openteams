# TODOS

## P3: ChatSessionAgent workspace 继承状态标记

**What:** 给 `ChatSessionAgent` 加 `workspace_path_is_override: bool` 字段（或存储继承来源）

**Why:** 当前 `workspace_path` 字段无法区分 "自动继承自 session default" vs "用户显式设置"。
若未来支持修改 session default_workspace_path 后批量更新未覆盖成员，没有这个标记就无从判断。

**Pros:** 解锁批量更新能力，数据语义更清晰

**Cons:** 需要 DB migration，所有 create_session_agent 调用点需更新

**Context:** 在 feat/session-workspace-path PR 中，add_member 逻辑已改为：若 payload.workspace_path 为 null 则继承 session.default_workspace_path。
此时数据库里存的是具体路径值，没有标记是继承的还是覆盖的。
起点：`crates/db/src/models/chat_session_agent.rs` → 加字段 + migration

**Effort:** M (human: 1天 / CC: ~20min)
**Priority:** P3
**Depends on:** feat/session-workspace-path 合并后
