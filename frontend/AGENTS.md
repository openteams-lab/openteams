# AGENTS.md

## Test Restraint

- Default to minimal verification instead of adding new tests. Prefer type
  checks, lint, builds, or targeted manual verification for low-risk UI,
  copy, style, and wiring changes.
- Add or update tests only when the change touches shared runtime logic,
  protocol/API contracts, state synchronization, security-sensitive behavior,
  or a bug that is likely to regress without a focused guard.

## 角色定位

本仓库中的智能代理应作为工程协作者参与开发，重点关注代码质量、可维护性、可运行性与交付透明度。代理在执行任务时应先理解现有项目结构、技术栈与约定，再进行最小必要变更。

## 当前项目现状

- 项目是 `openteams-frontend`，当前为 Vite + React 19 + TypeScript 前端应用。
- 包管理器使用 pnpm 10，`package.json` 声明为 `pnpm@10.6.2`。
- 本地开发命令为 `pnpm dev`，默认通过 Vite 在 `3000` 端口启动。
- 构建命令为 `pnpm build`，类型检查命令为 `pnpm lint`（执行 `tsc --noEmit`）。
- 样式栈包含 Tailwind CSS 4 与 `src/index.css` 中的设计变量；图标主要使用 `lucide-react`，动效依赖 `motion`。
- 当前应用以单页工作台为主，包含工作流、自由聊天、团队/订阅、任务弹窗、路由策略、供应商密钥、设计 token 等页面区域。
- 主要状态集中在 `src/context/WorkspaceContext.tsx`，示例数据位于 `src/data.ts`，共享类型位于 `src/types.ts`。
- 多语言支持已接入 `src/i18n.ts` 与 `src/locales`，当前语言类型包含 `en`、`zh`、`ja`、`ko`、`fr`、`es`。
- 当前实现大量依赖本地模拟数据与前端状态；对接真实后端 API 前不得自行定义后端契约。

## 工作原则

- 优先遵循仓库已有架构、命名、目录组织、样式与工具链。
- 不得无故重写、删除或回滚用户已有改动。
- 不得执行破坏性命令，除非用户明确授权。
- 修改前应确认相关上下文，避免基于猜测改动核心逻辑。
- 变更应保持范围清晰，避免把无关重构混入当前任务。
- 单文件不得超过 800 行；如接近限制，应拆分模块、组件或文档。

## 代码规范

- 保持代码简洁、可读、可测试，避免过度抽象。
- 新增逻辑应符合现有 lint、format、类型检查与构建约束。
- 优先复用已有组件、工具函数、类型定义与 API 封装。
- 不引入未使用依赖、未使用变量或死代码。
- 不随意改变公共接口、路由、配置或数据结构。
- 必要注释只用于解释非显而易见的业务规则或技术权衡。

## 前端实现要求

- 页面与组件应具备加载态、空态、错误态和基础交互反馈。
- 保持响应式表现，确保桌面端与移动端均可正常使用。
- API 集成不得虚构字段、协议或返回结构；缺失信息应明确标记为阻塞项。
- 遵循设计稿或现有设计系统，不擅自改变核心视觉风格。
- 交互逻辑应尽量靠近相关组件，同时避免重复实现。
- 新增页面或功能时，应优先复用 `WorkspaceContext`、`src/types.ts` 与已有组件结构。

## 文件与文档

- 文档应准确反映当前实现，不写过期或无法验证的信息。
- 大型内容应拆分到多个文件，避免单文件超过 800 行。
- 新增文件应放在符合项目约定的位置，并使用清晰命名。
- 编辑文件时默认使用 ASCII；仅在已有文件或业务需要时使用非 ASCII 字符。

## 验证要求

- 完成代码变更后，应根据任务合理运行测试、类型检查、lint 或构建。
- 如无法运行验证命令，应说明原因与建议的人工验证步骤。
- 修复失败时应优先定位根因，不通过跳过检查来掩盖问题。

## Git 约束

- 未经用户明确要求，不创建提交、不推送远端。
- 不修改 Git 配置。
- 不使用 `git reset --hard`、强制推送等不可逆操作，除非用户明确要求。
- 提交前应检查暂存区与未跟踪文件，避免提交密钥、环境变量或无关文件。

## 输出要求

- 汇报应简洁说明完成内容、变更文件、验证结果、阻塞项和后续建议。
- 不粘贴大段文件内容，优先引用文件路径。
- 对不确定事项应说明假设与影响，避免伪造确定结论。
