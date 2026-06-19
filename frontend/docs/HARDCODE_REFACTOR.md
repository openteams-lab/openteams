# Hardcode 接口化改造记录

## 改造目标

将主要运行态 hardcode 从组件和 context 中移出，改为通过本地 mock API 层异步获取。当前没有真实后端契约，因此本次只实现前端本地 mock 接口，不新增或假设真实后端字段。

## 新增接口层

- `src/mockApiData.ts`
  - 本地 mock 接口响应数据源。
  - 包含 workspace bootstrap、workflow presets、onboarding team templates、dialog options、settings options、shell options。
- `src/lib/mockFrontendApi.ts`
  - 本地 mock API facade。
  - 暴露 `getWorkspaceBootstrap`、`getWorkflowPreset`、`getOnboardingTeams`、`getDialogOptions`、`getSettingsOptions`、`getShellOptions`。

## 已接口化的 hardcode

- `WorkspaceContext`
  - 初始任务、成员、会话、消息、供应商、策略、mock agent 回复、默认统计和默认开关改为从 `mockFrontendApi.getWorkspaceBootstrap()` 获取。
  - 后端真实 API 请求失败时保留本地 mock API 返回数据作为 fallback。
- `App`
  - workflow preset 任务和项目/ship counter 数据改为通过本地 mock API 获取。
- `FreeChatWorkspace`
  - 从聊天生成 workflow 的任务列表、repo label、上下文文件列表改为通过本地 mock API 获取。
- `OnboardingPro`
  - 各项目类型推荐团队模板改为通过本地 mock API 获取。
- `DialogManager`
  - 新任务默认模板、成员模板、provider 模板、角色 chips、模型选项改为通过本地 mock API 获取。
- `SettingsWorkspace`
  - 语言列表、账号展示数据、设置菜单改为通过本地 mock API 获取。
- `DropdownsWorkspace`
  - 路由策略改为使用 context 中的接口化策略数据，不再直接读 seed 数据。

## API 依赖状态

- 真实后端：未新增契约，未假设字段。
- 本地 mock：已实现前端模块级 mock API，供现有页面异步读取。
- 后续如要接真实后端，可将 `mockFrontendApi` 的实现替换为 HTTP adapter，并保持调用方不变。

## 验证

- `pnpm lint` 通过。
- `pnpm build` 通过。

