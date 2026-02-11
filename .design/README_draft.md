<p align="center">
  <img src="frontend/public/agent-chatgroup-logo.svg" alt="Agent ChatGroup" width="200">
</p>

<h1 align="center">AgentsChatGroup</h1>

<p align="center">
  <strong>🚀 一个人，一整个 AI 团队</strong>
</p>

<p align="center">
  让多个 AI Agent 像真实团队一样协同工作<br/>
  通过工作群聊共享上下文、相互 @沟通，大幅提升工作效率
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-chatgroup"><img alt="npm" src="https://img.shields.io/npm/v/agent-chatgroup?style=flat-square" /></a>
  <a href="https://github.com/BloopAI/agent-chatgroup/blob/main/.github/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/BloopAI/agent-chatgroup/.github%2Fworkflows%2Fpublish.yml" /></a>
  <a href="#"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
</p>

<p align="center">
  <a href="https://youtu.be/TFT3KnZOOAk">📺 观看视频介绍</a> ·
  <a href="#快速开始">⚡ 快速开始</a> ·
  <a href="#文档">📖 文档</a>
</p>

---

## 为什么需要 AgentsChatGroup？

### 当前AI Agent的使用痛点

现在我们每一位开发者都离不开 Claude Code、Gemini CLI、Codex 等 AI Agent 助手，它们已成为我们最重要的工作伙伴。但在使用过程中，你是否遇到过这些问题：

| 痛点 | 描述 |
|------|------|
| ⏳**单任务耗时长** | 单个 Agent 执行任务时间长，我们只能干等着，啥也干不了 |
| 🔀**Agent各自为战** | 每个Agent在独立对话中工作，无法看到其他 Agent 的进展 |
| 🔗**上下文断裂** | 切换 Agent 时需反复解释项目背景，信息传递效率低下 |
| 📢**协调成本高** | 需要人工在多个 Agent 之间来回传递信息，充当"传话筒" |
| 🚧**并行困难** | 复杂任务只能串行处理，一个 Agent 完成后才能交给下一个 |
| 🎭**能力差异** | 有的擅长编码，有的擅长设计，总在它们之间疲于切换 |

> 不知道你们是否有感受，**AI 越来越强，但我们却越来越累。** 这是因为我们需要不断在各种Agent上下文中切换，注意力被频繁打断，那为什么不把它们统一起来呢，这就是我们这个项目的初衷。

### 我们的解决方案

**AgentsChatGroup** 创造性地引入了 **工作群聊** 模式，能让多个 AI Agent 像真实团队成员一样敏捷高效地协同工作：

```
╭──────────────────────────────────────────────────────────────╮
│                      AgentsChatGroup 🧩                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  👤 You                                                      │
│  │  @coder  帮我实现用户登录功能                               │
│                                                              │
│  🤖 Coder                                                    │
│  │  好的，我来编写登录模块…                                    │
│  │  └─ 🔔 @reviewer  代码写完了，请帮忙 review                │
│                                                              │
│  🤖 Reviewer                                                 │
│  │  收到，我来看看…发现几个安全问题：                           │
│  │  1) 密码需要加密存储                                        │
│  │  2) 需要添加登录频率限制                                    │
│  │  └─ 🛠️  @coder  请修复这些问题                             │
│                                                              │
│  🤖 Coder                                                    │
│  │  明白，我来修改…                                           │
│                                                              │
╰──────────────────────────────────────────────────────────────╯
```

**像管理真实团队一样管理 AI Agent们：**
-  一个项目 = 一个群聊
-  上下文清晰，作为管理者，我们能从群消息中快速获取AI成员的工作状态
- 添加任意多个 AI 成员，赋予不同职责
- 在同一会话上下文中指挥所有 Agent
- Agent 之间自动协作、相互沟通
- 你只需作为项目 Leader 统筹规划，让 AI 团队为你服务

## 核心优势

<table>
<tr>
<td width="50%">

### 🔗 上下文共享

所有 Agent 在同一对话空间工作，**自动共享项目背景、讨论历史、代码变更**。

无需反复解释，每个 Agent 都能看到完整上下文。

</td>
<td width="50%">

### 💬 @互通机制

Agent 之间可以 **相互 @唤起**，实现自动化任务流转。

一个 Agent 完成工作后直接 @另一个接手，形成流畅协作链条。

</td>
</tr>
<tr>
<td>

### 👥 一人成团

一个人指挥一个完整的 AI 开发团队：

- **🎨Designer**：Codex设计方案
- **🧑‍💻Coder**：ClaudeCode编写代码
- **🔍Reviewer**：GeminiCli代码审查
- **🧪Tester**：QWen Coder编写测试
- **🚀Executor**：OpenClaw部署测试
- **📝Doc**：Codex撰写文档
- **...** 更多角色等你定义

</td>
<td>

### ⚡ 效率倍增

- **并行处理**：多个 Agent 同时工作，互不阻塞
- **零沟通成本**：上下文自动同步，无需人工传递
- **专业分工**：让不同厂商的 Agent 专注最擅长领域
- **本地运行**：保证数据隐私安全

</td>
</tr>
</table>

## 功能特性

| 类别 | 特性 |
|------|------|
| **Agent 支持** | ✅ Claude Code · ✅ Gemini CLI · ✅ Codex · ✅ Amp · 更多持续接入中 |
| **协作能力** | ✅ 群聊模式 · ✅ 上下文共享 · ✅ @机制调度 · ✅ 任务状态追踪 · ✅ 会话归档 |
| **配置管理** | ✅ 统一 MCP 配置 · ✅ 灵活环境变量 |
| **部署方式** | ✅ 跨平台桌面应用 (Windows/macOS/Linux) · ✅ SSH 远程部署 |
| **更多功能** | ▢ 更紧凑的上下文环境 |


## 快速开始

### 前置条件

确保你已安装至少一个支持的 AI Agent：

| Agent | 安装方式 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm install -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @anthropic-ai/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm install -g @openai/codex` |
| [QWen Coder](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm install -g @qwen-code/qwen-code@latest` |
> 其他Agent可以自行参考网上教程进行安装
### 安装 AgentsChatGroup

<details>
<summary><b>🪟 Windows</b></summary>

下载最新版本的安装包：

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/BloopAI/agent-chatgroup/releases/latest)

</details>

<details>
<summary><b>🍎 macOS</b></summary>

**方式一：使用 npx（推荐）**

```bash
npx agents-chatgroup
```

**方式二：下载客户端**

[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/BloopAI/agent-chatgroup/releases/latest)

</details>

<details>
<summary><b>🐧 Linux</b></summary>

```bash
npx agents-chatgroup
```

</details>

就是这么简单！打开应用，创建群聊，添加 Agent，开始协作！

## 文档

📚 完整文档请访问：[AgentsChatGroup Docs](https://agent-chatgroup.dev/docs)

| 文档 | 描述 |
|------|------|
| [快速入门指南](https://agent-chatgroup.dev/docs/quickstart) | 5 分钟上手 AgentsChatGroup |
| [配置说明](https://agent-chatgroup.dev/docs/configuration) | 详细配置参数说明 |
| [Agent 配置指南](https://agent-chatgroup.dev/docs/agents) | 如何配置和管理 Agent |
| [常见问题 FAQ](https://agent-chatgroup.dev/docs/faq) | 常见问题解答 |

## 社区与支持

我们期待与你交流！

| 渠道 | 链接 |
|------|------|
| 🐛 **Bug 反馈** | [GitHub Issues](https://github.com/BloopAI/agent-chatgroup/issues) |
| 💬 **功能讨论** | [GitHub Discussions](https://github.com/BloopAI/agent-chatgroup/discussions) |
| 💭 **社区群** | *即将开放，敬请期待* |

## 本地开发

欢迎参与项目开发！请按以下步骤设置开发环境。

### 环境准备

| 工具 | 版本要求 | 安装链接 |
|------|---------|---------|
| Rust | latest stable | [rustup.rs](https://rustup.rs/) |
| Node.js | >= 18 | [nodejs.org](https://nodejs.org/) |
| pnpm | >= 8 | [pnpm.io](https://pnpm.io/) |

**可选开发工具：**

```bash
cargo install cargo-watch  # 自动重载
cargo install sqlx-cli     # 数据库管理
```

### 开发步骤

```bash
# 1. 克隆仓库
git clone https://github.com/BloopAI/agent-chatgroup.git
cd agent-chatgroup

# 2. 安装依赖
pnpm i

# 3. 启动开发服务器（同时启动 Rust 后端 + React 前端）
pnpm run dev

# 4. 构建前端
pnpm --filter frontend build

# 5. 构建桌面应用
pnpm desktop:build
```

#### Windows (PowerShell): run backend and frontend separately

If `pnpm run dev` fails in Windows PowerShell because of Unix-style `export`, use two terminals:

**Terminal A (backend)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:VK_ALLOWED_ORIGINS = "http://localhost:$env:FRONTEND_PORT"
$env:DISABLE_WORKTREE_CLEANUP = "1"
$env:RUST_LOG = "debug"
cargo watch -w crates -x "run --bin server"
```

**Terminal B (frontend)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Open frontend at `http://localhost:<FRONTEND_PORT>` (example: `http://localhost:3001`).


### 技术栈

```
┌────────────────────────────────────────────┐
│              AgentsChatGroup               │
├────────────────────────────────────────────┤
│  Frontend │ React + TypeScript + Vite      │
│           │ Tailwind CSS                   │
├───────────┼────────────────────────────────┤
│  Backend  │ Rust                           │
├───────────┼────────────────────────────────┤
│  Desktop  │ Tauri                          │
└───────────┴────────────────────────────────┘
```

## 致谢

本项目基于 [Vibe Kanban](https://www.vibekanban.com/) 进行二次开发，感谢 Vibe Kanban 团队的开源贡献，为我们提供了优秀的项目基础架构。

## 贡献指南

我们热烈欢迎社区贡献！🎉

1. **Fork** 本仓库
2. 创建你的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启一个 **Pull Request**

> 💡 在提交 PR 之前，建议先通过 [Issue](https://github.com/BloopAI/agent-chatgroup/issues) 或 [Discussion](https://github.com/BloopAI/agent-chatgroup/discussions) 与我们讨论你的想法。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
