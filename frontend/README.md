# OpenTeams Frontend

这是 OpenTeams 的前端代码目录，基于 **Vite + React + TypeScript**，包含 chat、workflow、project 管理等新/旧两套界面入口。

## 本地运行

### 前置条件

- Node.js 22+
- pnpm 10+

### 安装依赖

```bash
cd frontend
pnpm install
```

> 或在仓库根目录执行 `pnpm install`，在 monorepo 模式下也可用于统一安装。

### 启动开发环境

```bash
pnpm dev
```

### 构建与预览

```bash
pnpm build
pnpm preview
```

### 代码检查

```bash
pnpm lint
```

## 目录结构（摘要）

- `src/pages/ui-new`：新设计页面（默认优先，包含 chat / workflow / workspaces 入口）
- `src/pages`：legacy 页面与兼容页面
- `src/components/ui-new`：新设计组件库
- `src/components/ui`：传统 UI 组件
- `src/components/Conversation`：会话消息相关组件（含 workflow 卡片）
- `src/components/workflow`：workflow 前端控制与图谱面板
- `src/lib`：接口封装与通用工具函数
- `src/types.ts`：前端共享类型
- `src/styles`：样式与主题入口

## 开发说明

- 路由与会话页入口逻辑遵循项目既有规范，新增功能默认落在 `ui-new` 路径。
- API 接口定义集中在 `src/lib/api.ts`，修改接口前请先确认后端 contract。
- 若联调出现 404 / 连接错误，请先确认后端服务可用性、端口与 websocket 配置。
