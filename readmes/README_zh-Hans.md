<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320">

  <p><strong>以团队方式运行 Agent，让效率在 AI 时代成倍提升。</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://your-demo-link.com">观看演示</a> |
    <a href="#快速开始">快速开始</a> |
    <a href="https://docs.openteams.com">文档</a>
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

![OpenTeams Demo](../images/demo.gif)

**一分钟快速入门指南**

1. 导入预设团队并为每个成员选择基础 Agent。
2. 为团队中的每个成员设置工作空间。
3. 使用 `@mentions` 向特定成员发送消息。

---

## 快速开始

### 方案 A：使用 npx 运行

```bash
# web
npx openteams-web
```

### 方案 B：下载桌面应用

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 系统要求

**你至少需要安装一个 AI Agent：**

| Agent | 安装命令 |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |
| [OpenCode](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g opencode-ai` |

📚 [更多 Agent 安装指南](https://docs.openteams.com/getting-started)

---

## 功能特性

| 功能 | 你将获得 |
|--|--|
| **支持的 Agent** | 支持 10 种编程 Agent 运行时，包括 `Claude Code`、`Gemini CLI`、`Codex`、`Qwen Code`、`Amp`、`Cursor Agent`、`Copilot`、`Droid`、`Kimi Code` 和 `OpenCode`，目前正在集成更多 Agent。|
| **共享群聊上下文** | 所有参与者都在同一对话历史中工作，无需在不同窗口之间复制粘贴提示词。 |
| **并行执行** | 多个 Agent 可以在同一个共享会话中同时处理同一任务，不同的 Agent 处理它们最擅长的任务。 |
| **自主协作** | Agent 可以互相 `@mention`，交接工作，直接在聊天中协调。 |
| **内置 AI 成员** | 开箱即用 160+ 内置 AI 成员，覆盖工程、营销、写作、研究和内容生产领域。 |
| **内置 AI 团队预设** | 提供 8 个开箱即用的团队预设，适用于常见工作流程。 |
| **团队准则** | 定义谁领导、谁可以与谁交流、以及协作应该如何进行，自定义你的 AI 团队和团队准则。 |
| **技能库** | 为 Agent 配备 1000+ 内置技能，并可在需要时导入自己的技能。 |
| **完全本地执行** | Agent 在本地工作空间运行，运行时产物保存在该工作空间的 `.openteams/` 目录下，无需担心数据隐私问题。 |

### 并行 Agent 执行

*在相同的共享上下文中运行多个 Agent，让它们并行执行以加快交付速度。*

![OpenTeams parallel](../images/parallel.gif)

### 自主 Agent 协作

*OpenTeams 允许 Agent 直接互相发送消息，无需强制固定的工作流程。如果你想要更多结构，可以添加团队准则来控制沟通、指定领导 Agent，或让所有人自由协作。沟通模式完全取决于你的使用场景。*

![OpenTeams collaborate](../images/collaborate.gif)

### AI 成员

*OpenTeams 包含 160+ 内置 AI 成员，覆盖工程、营销、写作、内容生产等领域。将它们组合成不同的团队，自定义配置，构建适合你工作方式的角色组合。我们将持续扩展和改进这个阵容。*

![OpenTeams members](../images/members.gif)

### AI 团队

*OpenTeams 内置 8 个团队预设，适用于常见工作流程，让你可以立即开始。我们建议在创建团队时定义团队准则，以确保协作符合你希望团队运作的方式。*

![OpenTeams team](../images/team.gif)

### 技能库

*OpenTeams 包含 1000+ 内置技能，你可以组合并分配给不同的 AI 成员。你也可以导入自己创建的技能，直接应用到你的 Agent。我们将继续扩展技能库，专注于在真实生产环境中可靠的能力。*

![OpenTeams skills](../images/skills.gif)

---

## 为什么我们更好

图例：✅ 全支持 | 🟡 部分支持 | ❌ 不支持

| **能力** | 传统单 Agent | 多窗口工作流 | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **并行能力**| ❌ 否，串行 | 🟡 部分，手动 | ✅ 是，Claude 子代理 | ✅ 是，自动 |
| **共享上下文** | ❌ 否 | ❌ 否，复制粘贴 | 🟡 部分，子代理上下文分裂 | ✅ 是，始终同步 |
| **多模型协作** | ❌ 否 | 🟡 部分，手动切换 | ❌ 否，仅 Claude | ✅ 是，Claude + Gemini + Codex + 更多 |
| **Agent 交接** | ❌ 否 | ❌ 否，你手动编排 | 🟡 部分，仅在 Claude 内委派 | ✅ 是，直接 `@mentions` |
| **预定义 AI 成员** | ❌ 否 | ❌ 否 | ❌ 否 | ✅ 是，160+ 成员 |
| **团队管理器** | ❌ 否 | ❌ 否 | ❌ 否 | ✅ 是，自定义团队准则 |
| **你的投入** | 🔴 高 | 🔴 很高 | 🟠 中等 | 🟢 低 |

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

# 3. 启动开发服务器（同时启动 Rust 后端 + React 前端）
pnpm run dev

# 4. 构建前端
pnpm --filter frontend build

# 5. 构建桌面应用
pnpm desktop:build
```

#### Windows (PowerShell)：前后端分开启动

`pnpm run dev` 无法在 Windows PowerShell 中运行。请使用下面的命令分别启动后端和前端。

```bash
# 1. 克隆仓库
git clone https://github.com/openteams-lab/openteams.git
cd openteams

# 2. 安装依赖
pnpm i

# 3. 生成 TypeScript 类型
pnpm run generate-types

# 4. 执行数据库迁移
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

打开前端页面：`http://localhost:<FRONTEND_PORT>`（例如：`http://localhost:3001`）。

## 发布说明与路线图

### V0.2

- ~~[x] 多 Agent 群聊与共享上下文~~
- ~~[x] 并行 Agent 执行~~
- ~~[x] Agent @mention 与自主协作~~
- ~~[x] 支持 10 种编程 Agent 运行时（Claude Code、Gemini CLI、Codex、Qwen Code、Amp、Cursor Agent、Copilot、Droid、Kimi Code、OpenCode）~~
- ~~[x] 桌面应用（Windows、macOS、Linux）~~
- ~~[x] 通过 npx 运行的 Web 应用~~
- ~~[x] 多语言支持（EN、ZH、JA、KO、FR、ES）~~

### V0.3

- ~~[x] 前端界面全面改版~~
- ~~[x] 160+ 内置 AI 成员~~
- ~~[x] 8 个内置 AI 团队预设~~
- ~~[x] 团队规则配置~~
- ~~[x] 1000+ 内置技能~~
- ~~[x] 完全本地执行与工作空间隔离~~
- ~~[x] 重新定义输入协议~~

### 路线图

- [ ] 开发针对openteams场景优化的Code Agent后端
- [ ] 建立高效的团队协作框架
- [ ] 更多 Agent 集成（kilo code、OpenClaw 等）
- [ ] 添加更强大的开箱即用AI团队
- [ ] 添加更强大的技能
- [ ] 提供高度优化的定制版本


## 贡献

欢迎贡献！你可以在 [Issues](https://github.com/openteams-lab/openteams/issues) 查看待办，或在 [Discussion](https://github.com/openteams-lab/openteams/discussions) 发起讨论。

1. Fork -> 创建 feature 分支 -> 提交 PR
2. 大改动请先开 issue 沟通
3. 请遵守我们的 [Code of Conduct](../CODE_OF_CONDUCT.md)

## 社区

| | |
|--|--|
| **问题反馈** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **讨论交流** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **社区聊天** | [Discord](https://discord.gg/MbgNFJeWDc) |

## 致谢

本项目基于 [Vibe Kanban](https://www.vibekanban.com/) 代码框架进行构建，感谢其团队提供优秀的开源基础。

同时也感谢 [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) 帮助塑造内置技能生态系统，以及 [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) 为 Agent 角色设计和团队组成提供的灵感。