# 收件箱 Bell 通知前端交互清单 (Interaction Handoff)

本文档提供给前端开发人员，用于实现左上角 Bell (Inbox) 通知的交互细节，基于 `2026-07-05-inbox-notifications-design.html` 设计规范。

## 1. 入口与位置

- **原左上角入口**：替换原有 `History` (时钟) 入口（位于 `frontend/src/components/ProjectSidebar.tsx` 的左上角 `topControlClass` 控制区）。
- **右侧导航栏限制**：**明确要求，右侧导航栏现有的 Inbox 按钮保持不改动**。

## 2. Bell 图标与未读角标规则

- **默认状态**：普通 `Bell` 图标，无额外装饰。
- **未读角标 (Badge)**：
  - 当存在未读通知时，在 Bell 图标右上角显示显眼的未读提示（例如带有未读数字的小红点，超过 99 显示 99+）。
  - 角标设计需紧凑，保持与侧边栏整体比例协调。
- **状态响应**：Hover 或 Focus 时应用标准的 `hover:bg-[var(--surface-1)]` 交互态。

## 3. Popover 面板状态

遵循 Linear 极简风格（紧凑、可扫描、低装饰、无营销提示）。

- **空态 (Empty)**：显示居中的短文本，如 "No unread notifications" (无未读通知)。不添加多余的插画或冗长的营销引导语。
- **加载态 (Loading)**：骨架屏 (Skeleton) 或极简 Spinner (`LoaderCircle`)。
- **错误态 (Error)**：轻量级错误提示文字，并提供重试 (Retry) 操作，不可阻断用户浏览其余内容。
- **内容区限制**：列表只展示“未读”通知。

## 4. 未读列表信息层级与视觉优先级

### 信息层级
单条通知应当包含以下结构：
1. **标题 (Title)**：加粗，高对比度 `text-[var(--ink)]`。
2. **正文摘要 (Body)**：单行或双行截断，颜色较浅 `text-[var(--ink-muted)]`。
3. **来源上下文**：所处 Project 或 Session，以及相对时间 (如 "2h ago")，字体较小 `text-[var(--ink-tertiary)] text-[12px]`。

### 严重级别视觉优先级 (Severity)
- **Info (普通)**：标准配色，无特殊边框或底色。
- **Warning (警告/待办)**：左侧加入琥珀色指示条或点状标识 (`text-[var(--warn)]`)。
- **Error (错误/失败)**：左侧加入红色指示条或点状标识 (`text-[var(--error)]`)。

## 5. 动作按钮与文案

- **全局操作**：Popover 顶部或底部固定提供 **"Mark all as read"** 按钮（仅图标或紧凑文字）。
- **单条操作**：
  - Hover 单条通知时，出现 **"Mark as read"** 的 Check 图标按钮，点击后立即从当前列表移除该通知。
- **动效要求**：从列表中移除通知时，应用轻量且迅速的折叠/淡出 (Fade out) 动画，避免生硬闪烁。

## 6. 点击跳转与阅读规则

点击通知卡片主体后的行为依据事件类型决定：

- **普通消息 (如新 Agent 最终回复)**：
  - 行为：页面跳转至对应 Session，并自动调用 API 将该条通知标记为“已读” (Mark as read)。
  - **自动已读规则**：**当前打开会话 (Active Session) 中的普通 Agent 消息自动已读**。即如果用户已经处于该 Session 视图中，新到达的普通消息直接标记为已读，不计入未读列表。
- **Workflow 待办 (待输入 / 待审核 / 最终审核)**：
  - 行为：页面跳转进入对应的处理视图 (Input/Review panel)。
  - 标记规则：**处理前保持未读状态**。只有在用户实际完成输入、审批操作后，再由后端或前端业务逻辑将其已读（或由后端发出的状态变更使其不再符合未读条件）。
- **Worktree 异常 (合并冲突)**：
  - 行为：页面跳转进入冲突处理视图 (Conflict resolution view)。
  - 标记规则：处理完成前保持未读。
- **未知 Source (兜底)**：
  - 行为：回退到 Session 级别跳转。
  - 标记规则：跳转时自动标记为已读。

## 7. 代码修改范围

- **修改文件**：`frontend/src/components/ProjectSidebar.tsx`
- **新增组件**：`InboxPopover` 或类似名称的悬浮窗组件。
- **依赖上下文**：确保通过 `WorkspaceContext` 获取到全局状态，但不侵入原右侧 Inbox 逻辑。
