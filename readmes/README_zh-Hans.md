<div align="center">
  <img src="../frontend/public/logos/logo_blue.svg" alt="OpenTeams" width="100">
</div>

<div align="center">
  <img src="../frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>规划、构建、交付——不再只靠一个 AI，而是与你的 AI 团队并肩完成</h5>

  <p>
    多个 AI 智能体共享同一份上下文——既可以通过聊天自由协作，也可以用可视、可审查、可重试的工作流来编排复杂任务。
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="../LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="images/openteams-wechat-community.png"><img alt="WeChat" src="https://img.shields.io/badge/WeChat-Join%20Group-07C160?style=flat-square&logo=wechat&logoColor=white" /></a>
    <a href="images/openteams-feishu-community.png"><img alt="Feishu/Lark" src="https://img.shields.io/badge/Feishu%2FLark-Join%20Group-3370FF?style=flat-square" /></a>
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
<div align="center">
  <video src="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d" controls width="100%">
    <a href="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d">观看产品视频</a>
  </video>
</div>

## 什么是 openteams

**openteams** 是一款开源的多智能体协作应用。它支持把 Claude Code、Codex、Gemini CLI 等多个 AI 编程智能体带入同一个共享会话，让它们可以交流、共享上下文，并像团队一样协同工作。你可以通过轻量的自由聊天模式与智能体进行对话式协作，也可以通过结构化的工作流图表来编排复杂任务，做到计划可视化、任务级控制和可追溯审查等。所有内容都在你自己的本地工作区中运行，无需担心隐私问题。

## 为什么选择 openteams

AI 智能体已经越来越擅长规划、编码、审查和测试。但更多智能体输出，并不意味着会自动变成真正交付的工作。

**管理多个 Agent 令人疲惫。** 你在终端之间反复切换，每换一个 Agent 都要重新交代背景，把上一个 Agent 的输出手动搬到下一个的提示词里，还要人肉合并相互矛盾的 diff。你的注意力在多个 Agent 的混乱切换中被消耗殆尽。

**Agent 的执行过程既看不见，也控不住。** 你让 Claude Code「把这个功能做完」，它跑了 15 分钟。你完全不知道它拆了哪些子任务、哪些跑通了、哪些被它悄悄跳过了。当前大多数编程 Agent 把复杂任务当作一次性的黑盒执行——执行前没有可见计划，执行中无法逐步审批或否决，失败了也没法只重试出问题的那一步。一旦出错，只能从头再来。

**openteams** 同时解决这两个问题。所有Agent在同一个会话总**共享同一份上下文**，你再也不用反复在多个Agent中进行来回切换倒腾了。复杂任务会变成**可见、可控的工作流图表**——你可以在执行前审阅和调整计划，实时观察每个步骤的进展，并随时介入任意节点：批准、拒绝、重试或重新指派。

> 真正的生产力杠杆不在于拥有更多 Agent，而在于用一份看得见的计划和一组控得住的步骤来编排指挥它们。

## 常见使用场景

你输入：“给工作区增加 GitHub issue 同步功能。”


1. **主 Agent 澄清需求：** 它会询问同步方向（单向还是双向？）、冲突处理方式（跳过、覆盖还是记录？），以及要映射哪些 issue 字段。你确认：单向拉取、记录冲突、映射 title/body/labels/status。
2. **主 agent 设计方案并生成执行计划：** 计划显示 5 个步骤：`Backend: OAuth + GitHub API` → `Backend: Sync Engine` → `Frontend: Sync Status UI` → `Integration Tests` → `Final Review`。每一步都有明确范围、分配的智能体和验收标准。
3. **你审查并批准计划：** 在任何代码运行前，你可以调整步骤、重排依赖或重新分配智能体。
4. **智能体执行，你实时观察进度：** `Backend: OAuth` 先运行。完成后，`Sync Engine` 和 `Frontend: Sync Status UI` 并行启动。每个步骤都会在工作流图上显示状态、diff 和日志。
5. **你审查并批准每个完成的步骤：** `Backend: OAuth` 完成后，你检查 diff，看到 token refresh 逻辑，然后批准。后续步骤继续推进。
6. **某一步失败，你只重试该步骤：** `Integration Tests` 失败，因为同步引擎返回了原始时间戳而不是 ISO 格式。你查看错误日志，然后只重试 `Integration Tests` 这一步。其余工作流保持不变。
7. **最终审查与验收：** 所有步骤通过。你审查完整 diff、产物和测试结果，然后接受。
8. **通过自由聊天模式跟进：** 两天后，用户反馈同步状态徽标在轮询时闪烁。你打开自由聊天模式：`@Frontend Agent 的同步状态标志在轮询时会闪烁 —— 请对状态更新进行防抖处理。`。一轮修复完成，不需要启动工作流。

## 快速开始
### 安装
#### npx

```bash
npx openteams-web
```

#### 桌面应用

请从 GitHub Releases 下载适合你平台的最新版本。

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### 配置提供商

**openteams** 内置 openteams CLI 智能体。你可以在应用中通过 `menu->setting->provider config->add provider` 配置模型提供商。参考文档：

⚙️ [提供商配置](https://doc.openteams-lab.com/advanced-usage/custom-provider)

你也可以连接以下openteams支持的编程智能体：

| Agent | 安装示例 |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [更多智能体安装指南](https://doc.openteams-lab.com/getting-started)

### 30 秒上手
**前置条件：配置一个 API 服务提供商，或安装任意一个openteams支持的 Code Agent。**

*第 1 步。* 创建一个群聊会话。添加一个或多个成员，并为每个成员分配模型和角色。

*第 2 步。* 在自由聊天模式中，用 `@` 提及任意成员来发送消息或分配任务。

*第 3 步。* 切换到工作流模式。与主agent讨论需求、细化方案，并生成执行计划。

*第 4 步。* 启动执行，并在每个任务节点完成时审查结果。

## 工作模式

**openteams** 提供两种协作模式，因为不是所有任务都需要同样的结构化程度。可以类比 **Claude Code 的 Plan 与 Build 模式**，但这里是面向多 Agent 团队的：想让 Agent 自由探索讨论时用自由聊天模式，需要可靠、可预期的执行时用工作流模式。

### 自由聊天模式

在自由聊天模式中，你用 `@` 给任意 Agent 发送任务，Agent 之间也可以自由传递消息。协作规则由你定义的团队协议约束——谁负责什么、如何交接、遵循哪些标准。

**自由聊天模式**适合小修复、快速审查，以及不值得启动完整工作流的探索性讨论。

![](images/free_chat.png)

### 工作流模式

工作流模式专为复杂任务设计——当任务需要拆分为多个子任务，且你需要全程观察进度、在每一步保持可控执行时，它就是最佳选择。

主 Agent 负责驱动规划阶段：澄清需求、设计方案、制定执行计划，并将任务分配给合适的 Agent。最终生成一张可视化的工作流图，包含步骤、依赖关系、审查节点、重试机制和验收点。

![](images/openteams-workflow.png)

工作流模式不会让 Agent 松散地串联运行，而是把工作转化为有状态的执行图。

**注意：工作流模式会消耗更多 token。请确保你的 token 余额充足。**

## 重要更新
- **2026.05.20 (v0.4.4)**
  - 工作流模式 beta 版
- **2026.05.07 (v0.3.22)**
  - 支持一键将群聊会话中的成员保存为预设团队
- **2026.04.14 (v0.3.15)**
  - 工作区文件变更查看器
- **2026.04.06 (v0.3.12)**
  - 启用深色 UI 模式
  - 修复 openteams-cli 并发问题
- **2026.04.02 (v0.3.10)**
  - 实现应用内版本更新
  - 文档网站已上线

## 路线图

openteams 正在积极开发中。接下来我们会朝这些方向推进：

- [ ] **专家型的AI员工** — 推出更多拥有专业领域知识，能解决专业问题的AI员工。
- [ ] **高产出的AI团队** — 由高效的专家AI员工组成，可针对特定业务定制化生产工作流程，端到端将需求转换为产出结果。
- [ ] **集成更多智能体** — 集成更多常用Agent，如Kilo code, hermes-agent, openclaw等。

***愿景：把 token 消耗转化为真正的生产力。***

有功能建议，或想参与塑造产品方向？欢迎[发起讨论](https://github.com/openteams-lab/openteams/discussions)。

## 社区

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues)：bug 报告和功能请求
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions)：产品想法和问题
- [Discord](https://discord.gg/openteams)：社区聊天
- [Linux.do](https://linux.do)：友情链接，感谢提供社区交流支持
- 社区群：

<p>
  <a href="images/openteams-wechat-community.png"><img alt="openteams 微信交流群二维码" src="images/openteams-wechat-community.png" width="260"></a>
  <a href="images/openteams-feishu-community.png"><img alt="openteams 飞书交流群二维码" src="images/openteams-feishu-community.png" width="260"></a>
</p>

## 核心功能

| 功能 | 含义 |
| --- | --- |
| AI 员工与 AI 团队 | 把 token 直接转化为生产力。每个 AI 员工或团队都拥有特定领域的专业知识，能将通用模型提升为领域专家——不只是生成文本，而是真正产出可交付的工作成果。 |
| 多智能体工作区 | 把多个 AI 智能体带入同一个共享会话，不再在多个窗口之间来回切换。 |
| 共享上下文 | 智能体基于同一份对话和项目上下文工作。 |
| 自由聊天模式 | 使用 `@` 进行直接、轻量的智能体协作。 |
| 工作流模式 | 将复杂任务转换为结构化步骤、依赖、审查、重试和验收。 |
| 可见执行 | 看到每个智能体正在做什么，以及工作卡在哪里。 |
| 审查与重试 | 审查某一步的结果，精确重试失败的任务，无需重启整个项目。 |
| 产物与轨迹 | 将日志、diff、转录和生成的产物附加到工作上。 |
| 本地工作区执行 | 智能体在你配置的工作区中工作，运行记录保存在 `.openteams/` 下。 |

## 适合谁

openteams 适合：

- 正在使用多个编程智能体、但已经厌倦来回切换和协调的开发者
- 需要让智能体运行过程可审查、可复现的技术负责人

它不只是一个收纳更多 Agent 的容器，而是把 Agent 变成真正能协作交付的工作团队。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React, TypeScript, Vite, Tailwind CSS |
| 后端 | Rust |
| 桌面端 | Tauri |
| 数据库 | SQLx 管理的关系型 schema |
| 工作流 UI | React Flow |

## 本地开发

### 前置条件

- **Rust** >= 1.75
- **Node.js** >= 18
- **pnpm** >= 8

### Mac/Linux

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### Windows (PowerShell)：分别启动后端和前端

`pnpm run dev` 无法在 Windows PowerShell 中运行。请使用以下命令分别启动后端和前端。

```powershell
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run generate-types
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
$env:FRONTEND_PORT = <terminal A generated frontend port>
$env:BACKEND_PORT = <terminal A generated backend port>
cd frontend
pnpm dev -- --port $env:FRONTEND_PORT --host
```

在 `http://localhost:<FRONTEND_PORT>` 打开前端页面（例如：`http://localhost:3001`）。

### 本地构建 `openteams-cli`

如果你需要编译本地 `openteams-cli` 二进制文件，而不是使用内置或已发布的构建，请使用以下命令。
构建产物会放在 binaries 目录中。

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## 贡献

欢迎贡献。你可以这样开始：

1. **寻找 issue** — 查看 [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) 寻找适合新手的任务，或浏览开放 issue。
2. **开发前先讨论** — 在提交大型 PR 前，请先开启 issue 或 discussion，以便对齐方向。
3. **遵循代码风格** — 提交前请运行：

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **提交 PR** — 说明你改了什么以及为什么改。如有相关 issue，请一并链接。

完整指南请见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 许可证

本项目使用 Apache License 2.0。完整条款见 [LICENSE](../LICENSE)，其中包含版权和再分发要求。

你可以拿来用、改、发布、商用，也可以放进闭源产品里。需要保留版权声明和许可证文本，改过的地方要说明。不能删掉必要声明，不能拿项目所有者的名字或商标当背书；如果你因为这个项目发起专利诉讼，Apache-2.0 给你的专利授权可能会终止。软件按原样提供，不承诺担保。
