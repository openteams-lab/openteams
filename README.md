<div align="center">
  <img src="frontend/public/openteams-logo-white.png" alt="OpenTeams" width="320">

  <h1>OpenTeams</h1>

  <p><strong>Run a team of AI agents in one group chat - they @mention each other, share context, and work in parallel.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="https://docs.openteams.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="https://your-demo-link.com">Watch Demo</a> |
    <a href="#quick-start">Quick Start</a> |
    <a href="https://docs.openteams.com">Docs</a>
  </p>

  <p align="center">
    <a href="./README_zh.md">中文</a>
  </p>
  
</div>

---

![OpenTeams Demo](docs/images/demo.gif)

替换主页面展示demo，10s，内容：主页面->创建团队->导入->say hi

---


## Quick Start

### Option A: Run with npx

```bash
# web
npx openteams
```

### Option B: Download Desktop App

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Dependency
**You'll need at least one AI agent installed:**

| Agent | Install |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code@2.1.74` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli@0.33.0` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex@0.114.0` |
| [QWen Coder](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code@0.12.1` |

📚 [Guides for Installing More Agents →](https://docs.openteams.com/getting-started)

## Features
`画个表，内容有：支持多少种code agent、群聊上下文共享、并行执行、自主协作、预设成员和预设团队、完全本地运行`


### Agent并行执行任务
`demo展示内容: 多个agent同时工作的场景 5s`

同一个上下文环境下可同时指挥多个Agent并行执行任务

### Agent自主协作
`demo展示内容: agent A @ agent B干活的场景 5s`

支持多个Agent之间能互相发送消息，不受任何约束。你可以让一个Agent指挥全局，你也可以让所有Agent畅所欲言，这完全取决于你的使用场景。

### Agent技能库
`demo展示内容：滚动的技能市场页面 + 内置技能数量 + 安装和使用操作`

内置1000+个技能，可以任意配置组合，赋能给不同的AI成员，打造你的专属AI团队。支持你在软件中创建你自己的技能，直接应用到你的AI成员上。我们也将持续更新技能库

### 预设AI成员
`demo展示内容: 预设成员列表展示 + 使用预设成员操作 + 添加成员模板演示`

内置160+ AI成员，涵盖开发、营销、写作、内容生产等不同领域，你可以将他们自由组合成不同的AI团队，为你提供独一无二的服务。我们也将持续更新成员列表

### 预设AI团队
`demo展示内容: 预设AI团队 + 团队协议介绍 + 添加团队演示`

内置8类 常见AI团队，开箱即用。

## How It's Different

| Capability | 🧍 Traditional Single Agent | 🪟 Multi-window Workflow | 🤖 Claude Code-Agent Team | 🧩 OpenTeams |
|--|--|--|--|--|
| Parallelism | ❌ No (sequential) | ⚠️ Partial (manual) | ✅ Yes (Claude subagents) | ✅ Yes (automatic) |
| Shared context | ❌ No | ❌ No (copy-paste) | ⚠️ Partial (split subagent contexts) | ✅ Yes (always in sync) |
| Multi-model collaboration | ❌ No | ⚠️ Partial (manual switching) | ❌ No (Claude-only) | ✅ Yes (Claude + Gemini + Codex + more) |
| Agent handoff | ❌ No | ❌ No (you orchestrate) | ⚠️ Partial (delegated inside Claude) | ✅ Yes (@mention) |
| Your effort | 🔺 High | 🔺 Very high | ◼️ Medium | 🔹 Low |


---


## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |

## Local Development

#### Mac/Linux

```bash
# 1. Clone the repository
git clone https://github.com/StarterraAI/OpenTeams.git
cd openteams

# 2. Install dependencies
pnpm i

# 3. Start the development server (runs Rust backend + React frontend)
pnpm run dev

# 4. Build frontend
pnpm --filter frontend build

# 5. Build desktop app
pnpm desktop:build
```

#### Windows (PowerShell): Start backend and frontend separately

`pnpm run dev` cannot run in Windows PowerShell. Use the following commands to run backend and frontend separately.

```bash
# 1. Clone the repository
git clone https://github.com/StarterraAI/OpenTeams.git
cd OpenTeams

# 2. Install dependencies
pnpm i

# 3. generate typescript type
pnpm run generate-types

# 4. run database migrate
pnpm run prepare-db
```

**Terminal A (backend)**

```powershell
$env:FRONTEND_PORT = node scripts/setup-dev-environment.js frontend
$env:BACKEND_PORT = node scripts/setup-dev-environment.js backend
$env:RUST_LOG = "debug"
cargo run --bin server
```

**Terminal B (frontend)**

```powershell
$env:FRONTEND_PORT = <frontend port generated from terminal A>
$env:BACKEND_PORT = <backend port generated from terminal A>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

Open the frontend page at `http://localhost:<FRONTEND_PORT>` (example: `http://localhost:3001`).

## Contributing

We welcome contributions! Check what's needed in [Issues](https://github.com/StarterraAI/OpenTeams/issues) or start a [Discussion](https://github.com/StarterraAI/OpenTeams/discussions).

1. Fork -> feature branch -> PR
2. Please open an issue before large changes
3. Please follow our [Code of Conduct](./CODE_OF_CONDUCT.md)

## Community

| | |
|--|--|
| **Bug Reports** | [GitHub Issues](https://github.com/StarterraAI/OpenTeams/issues) |
| **Discussions** | [GitHub Discussions](https://github.com/StarterraAI/OpenTeams/discussions) |
| **Community Chat** | [Discord](https://discord.gg/MbgNFJeWDc) |

## Acknowledgements

Built on top of [Vibe Kanban](https://www.vibekanban.com/) - thanks to their team for the excellent open source foundation.
