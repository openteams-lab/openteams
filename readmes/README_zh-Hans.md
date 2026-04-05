<div align="center">
  <img src="../frontend/public/Logo/logo_blue.svg" alt="OpenTeams" width="200">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320" style="margin-top: 10px; margin-bottom: 10px;">
  
  <p><strong>让 Agent 以一个团队的方式运行，在 AI 时代成倍提升你的效率。</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#快速开始">快速开始</a> |
    <a href="https://doc.openteams-lab.com">文档</a> 
  </p>

  <p align="center">
    <a href="../README.md">English</a> |
    <a href="./README_zh-Hans.md">简体中文</a> |
    <a href="./README_zh-Hant.md">繁體中文</a> |
    <a href="./README_ja.md">日本語</a> |
    <a href="./README_ko.md">한국어</a> |
    <a href="./README_fr.md">Français</a> |
    <a href="./README_es.md">Español</a>
  </p>
</div>

---

![OpenTeams Demo](images/demo.gif)

**一分钟快速上手指南**

1. 导入一个预设团队，并为每位成员选择基础 Agent。
2. 为团队中的每位成员设置工作区。
3. 使用 `@member` 向指定成员发送消息。

---
## 🔥 *最新动态：*
### *重要更新*
- **2026.04.02 (v0.3.11)**
  - 启用深色 UI 模式
  - 修复 openteams-cli 并发问题
- **2026.04.02 (v0.3.10)**
  - 实现应用内版本更新
  - 文档网站现已上线。
- **2026.03.24 (v0.3.7)**: 
  - 新增内置的 openteams-CLI Agent，不再依赖本地安装 Agent。
  - 修复执行器中的内存泄漏问题。
---

## 快速开始

### 方案 A：使用 npx 运行
**推荐 Mac 和 Linux 使用这种安装方式。**

```bash
# web
npx openteams-web
```

### 方案 B：下载桌面应用

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 环境要求

**从 v0.3.7 开始，我们已内置 openteams-cli，因此不再需要安装 AI Agent。你可以前往“Settings -> Service Providers”页面配置你的 API。**

你也可以从支持的 Agent 列表中任选一个：

| Agent | 安装方式 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [更多 Agent 安装指南](https://doc.openteams-lab.com/getting-started)

---

## 功能特性

| 功能 | 你将获得什么 |
|--|--|
| **支持的 Agent** | 支持 10 种编程 Agent 运行时，包括 `Claude Code`、`Gemini CLI`、`Codex`、`Qwen Code`、`Amp`、`Cursor Agent`、`Copilot`、`Droid`、`Kimi Code` 和 `OpenCode`。目前也正在集成更多 Agent。|
| **共享群聊上下文** | 每位参与者都基于同一份对话历史工作，不必在多个窗口之间来回复制粘贴提示词。 |
| **并行执行** | 多个 Agent 可以在同一个共享会话中同时处理同一项任务，不同 Agent 负责各自最擅长的部分。 |
| **自主协作** | Agent 可以彼此 `@mention`、交接工作，并直接在聊天中协同。 |
| **内置 AI 成员** | 开箱即用提供 160+ 内置 AI 成员，覆盖工程、营销、写作、研究和内容生产。 |
| **内置 AI 团队预设** | 提供 8 个开箱即用的团队预设，适配常见工作流。 |
| **团队协作准则** | 你可以定义谁负责主导、谁可以与谁沟通，以及协作应如何进行。按你的方式定制 AI 团队与团队准则。 |
| **技能库** | 为 Agent 配备 1000+ 内置技能，并在需要时导入你自己的技能。 |
| **完全本地执行** | Agent 直接在你的本地工作区运行，运行产物保存在该工作区内的 `.openteams/` 目录下，因此无需担心数据隐私。 |

### 并行 Agent 执行

*让多个 Agent 在同一个共享上下文中并行执行，以加快交付速度。*

![OpenTeams parallel](images/parallel.gif)

### 自主 Agent 协作

*OpenTeams 允许 Agent 直接互相发送消息，而不强制固定工作流。如果你希望有更多结构，可以通过团队准则控制沟通方式、指定主导 Agent，或者让所有成员自由协作。沟通模式完全取决于你的使用场景。*

![OpenTeams collaborate](images/collaborate.gif)

### AI 成员

*OpenTeams 内置 160+ AI 成员，覆盖工程、营销、写作、内容生产等多个领域。你可以自由组合成不同团队、按需自定义，并构建符合你工作方式的角色组合。我们也会持续扩充并优化这一成员库。*

![OpenTeams members](images/members.gif)

### AI 团队

*OpenTeams 内置 8 个适用于常见工作流的团队预设，让你可以立即开始使用。我们建议你在创建团队时定义团队准则，以便让协作方式始终符合你的目标。*

![OpenTeams team](images/team.gif)

### 技能库

*OpenTeams 内置 1000+ 技能，你可以将它们组合后分配给不同的 AI 成员。你也可以导入自己创建的技能，并直接应用到 Agent 身上。我们会继续扩展技能库，重点投入那些能够在真实生产环境中稳定发挥作用的能力。*

![OpenTeams skills](images/skills.gif)

---

## 为什么我们更强

图例：✅ 完整支持 | 🟡 部分支持 | ❌ 不支持

| **能力** | 传统单 Agent | 多窗口工作流 | Claude Code Agent Team | openteams |
|--|--|--|--|--|
| **并行能力**| ❌ 不支持，只能串行 | 🟡 部分支持，需手动操作 | ✅ 支持，Claude 子代理 | ✅ 支持，自动完成 |
| **共享上下文** | ❌ 不支持 | ❌ 不支持，需要复制粘贴 | 🟡 部分支持，子代理上下文彼此分离 | ✅ 支持，始终同步 |
| **多模型协作** | ❌ 不支持 | 🟡 部分支持，需手动切换 | ❌ 不支持，仅限 Claude | ✅ 支持，Claude + Gemini + Codex + 更多 |
| **Agent 交接** | ❌ 不支持 | ❌ 不支持，需要你自己编排 | 🟡 部分支持，在 Claude 内部委派 | ✅ 支持，直接 `@mentions` |
| **预定义 AI 成员** | ❌ 不支持 | ❌ 不支持 | ❌ 不支持 | ✅ 支持，160+ 成员 |
| **团队管理** | ❌ 不支持 | ❌ 不支持 | ❌ 不支持 | ✅ 支持，自定义团队准则 |
| **你的投入** | 🔴 高 | 🔴 非常高 | 🟠 中等 | 🟢 低 |

---

## 技术栈

| 层级 | 技术 |
|-------|-----------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Rust |
| 桌面端 | Tauri |

## 本地开发

#### Mac/Linux

```bash
# 1. 克隆仓库
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 安装依赖
pnpm i

# 3. 启动开发服务器（运行 Rust 后端 + React 前端）
pnpm run dev

# 4. 构建前端
pnpm --filter frontend build

# 5. 构建桌面应用
pnpm desktop:build
```

#### Windows（PowerShell）：分别启动后端和前端

`pnpm run dev` 无法在 Windows PowerShell 中运行。请使用以下命令分别启动后端和前端。

```bash
# 1. 克隆仓库
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 安装依赖
pnpm i

# 3. 生成 TypeScript 类型
pnpm run generate-types

# 4. 运行数据库迁移
pnpm run prepare-db
```

**终端 A（后端）**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**终端 B（前端）**

```powershell
$env:FRONTEND_PORT = <终端 A 生成的 frontend 端口>
$env:BACKEND_PORT = <终端 A 生成的 backend 端口>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

在 `http://localhost:<FRONTEND_PORT>` 打开前端页面（例如：`http://localhost:3001`）。

#### 在本地构建 `openteams-cli`

如果你需要编译本地的 `openteams-cli` 二进制，而不是使用内置版本或已发布的构建，请使用以下命令。
构建产物会放在 binaries 目录中。

```bash
# 在仓库根目录执行
bun run ./scripts/build-openteams-cli.ts
```

## 发布说明与路线图

### V0.2

- [x] 支持共享上下文的多 Agent 群聊
- [x] 并行 Agent 执行
- [x] Agent `@mention` 与自主协作
- [x] 支持 10 种编程 Agent 运行时（Claude Code、Gemini CLI、Codex、Qwen Code、Amp、Cursor Agent、Copilot、Droid、Kimi Code、OpenCode）
- [x] 桌面应用（Windows、macOS、Linux）
- [x] 可通过 npx 运行的 Web 应用
- [x] 多语言支持（EN、ZH、JA、KO、FR、ES）

### V0.3
- [x] 前端界面已完成全面重构。
- [x] 160+ 内置 AI 成员
- [x] 8 个内置 AI 团队预设
- [x] 团队规则配置
- [x] 1000+ 内置技能
- [x] 完全本地执行与工作区隔离
- [x] 重新定义输入协议

### 路线图
- [x] 为 OpenTeams 使用场景优化 Code Agent 后端 —— v0.3.7
- [x] 开发多套前端配色方案 —— v0.3.11
- [ ] 建立高效率团队协作框架
- [ ] 集成更多 Agent（Kilo Code、OpenClaw 等）
- [ ] 提供更多强大的开箱即用 AI 团队
- [ ] 增加更强大的技能
- [ ] 提供高度优化的定制版本


## 贡献

欢迎贡献！你可以在 [Issues](https://github.com/StarterraAI/OpenTeams/issues) 查看当前需要的内容，或发起 [Discussion](https://github.com/StarterraAI/OpenTeams/discussions)。

1. Fork -> 新建 feature 分支 -> 提交 PR
2. 大型改动请先开 issue 沟通
3. 请遵守我们的 [Code of Conduct](../CODE_OF_CONDUCT.md)

### 代码格式化

提交 PR 前，请确保代码已正确格式化：

```bash
# 同时格式化前端和后端
pnpm run format

# 检查格式但不修改文件
pnpm run format:check

# 仅格式化前端
pnpm run frontend:format

# 仅格式化后端（Rust）
pnpm run backend:format
```

**注意：** 如果代码格式不正确，CI 会失败。推送前请始终运行 `pnpm run format:check`。

## 社区

| | |
|--|--|
| **Bug 反馈** | [GitHub Issues](https://github.com/StarterraAI/OpenTeams/issues) |
| **讨论交流** | [GitHub Discussions](https://github.com/StarterraAI/OpenTeams/discussions) |
| **社区聊天** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 致谢

本项目构建于 [Vibe Kanban](https://www.vibekanban.com/) 之上，感谢他们的团队提供了优秀的开源基础。

同时也感谢 [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) 帮助塑造了内置技能生态，以及 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) 在 Agent 角色设计和团队组合方面带来的启发。
