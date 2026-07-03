<div align="center">
  <img src="frontend/public/logos/logo_blue.svg" alt="OpenTeams" width="100">
</div>

<div align="center">
  <img src="frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>Plan, Build, and Ship — with a team of AI agents instead of one</h5>

  <p>
    Multiple AI agents share one context — collaborate freely through chat, 
   or orchestrate complex tasks through workflows you can see, review, and retry.
  </p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
    <a href="./readmes/images/openteams-wechat-community.png"><img alt="WeChat" src="https://img.shields.io/badge/WeChat-Join%20Group-07C160?style=flat-square&logo=wechat&logoColor=white" /></a>
    <a href="./readmes/images/openteams-feishu-community.png"><img alt="Feishu/Lark" src="https://img.shields.io/badge/Feishu%2FLark-Join%20Group-3370FF?style=flat-square" /></a>
    <a href="https://doc.openteams-lab.com/getting-started"><img alt="Platforms" src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-2EA44F?style=flat-square" /></a>
  </p>

  <p>
    <a href="#quick-start">Quick Start</a> |
    <a href="https://doc.openteams-lab.com">Docs</a> 
  </p>

  <p align="center">
    <a href="./README.md">English</a> |
    <a href="./readmes/README_zh-Hans.md">简体中文</a> |
    <a href="./readmes/README_zh-Hant.md">繁體中文</a> |
    <a href="./readmes/README_ja.md">日本語</a> |
    <a href="./readmes/README_ko.md">한국어</a> |
    <a href="./readmes/README_fr.md">Français</a> |
    <a href="./readmes/README_es.md">Español</a>
  </p>
</div>

---

<div align="center">
  <video src="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d" controls width="100%">
    <a href="https://github.com/user-attachments/assets/f918d5c7-68ff-4a8b-b2b4-f4f0ab31c17d">Watch the hero video</a>
  </video>
</div>

## What is openteam

**openteams** is an open-source multi-agent collaboration workspace. It brings multiple AI coding agents — such as Claude Code, Codex, Gemini CLI, and others — into one shared session where they can communicate, share context, and work together as a team. You can collaborate with agents through lightweight free-chat mode, or orchestrate complex tasks through structured workflows with visible plans, step-level control, and traceable review. Everything runs locally in your own workspace.

## Why openteams

AI agents are getting stronger at planning, coding, reviewing, and testing. But more agent output does not automatically become shipped work.

**Managing multiple agents is exhausting.** You switch between terminals, re-explain context to every new agent, copy outputs from one prompt into the next, and reconcile conflicting diffs — your attention is drained by the chaos of juggling multiple agents.

**Agent execution is invisible and uncontrollable.** You command claude code to "build the feature." It runs for 15 minutes. You have no idea which subtasks it attempted, which passed, and which it silently gave up on. Most coding agents today treat a complex task as one monolithic run — there is no visible plan before execution, no way to approve or reject individual steps mid-flight, no way to retry just the step that failed. When something goes wrong, you start over.

**openteams** solves both problems. All agents share a single context within the same session—no more juggling between agents or repeating yourself. Complex tasks become **visible, controllable workflows** — you refine the plan before it runs, watch each step execute, and intervene at any node: approve, reject, retry, or redirect.

> The real productivity leverage is not more agents. It is orchestrating them — with a complex plan you can see and steps you can control.

## Common Use Cases

You type: "Add GitHub issue sync to the workspace."

1. **Lead agent clarifies requirements:** It asks about sync direction (one-way or two-way?), conflict handling (skip, overwrite, or log?), and which issue fields to map. You confirm: one-way pull, log conflicts, map title/body/labels/status.
2. **Lead agent designs the approach and builds the execution plan:** The plan shows 5 steps — `Backend: OAuth + GitHub API` → `Backend: Sync Engine` → `Frontend: Sync Status UI` → `Integration Tests` → `Final Review`. Each step has a clear scope, assigned agent, and acceptance criteria.
3. **You review and approve the plan:** You can adjust steps, reorder dependencies, or reassign agents before any code runs.
4. **Agents execute — you observe progress in real time:** `Backend: OAuth` runs first. Once complete, `Sync Engine` and `Frontend: Sync Status UI` start in parallel. Every step shows its status, diff, and logs on the workflow graph.
5. **You review and approve each completed step:** `Backend: OAuth` finishes. You inspect the diff, see the token refresh logic, and approve. The next steps proceed.
6. **A step fails — you retry just that step:** `Integration Tests` fails because the sync engine returns raw timestamps instead of ISO format. You review the error log, and retry only `Integration Tests` step. The rest of the workflow stays intact.
7. **Final review and acceptance:** All steps pass. You review the full diff, artifacts, and test results, then accept.
8. **Follow-up via Free Chat:** Two days later, a user reports the sync status badge flickers. You open Free Chat: `@Frontend Agent the sync status badge flickers when polling — debounce the state update`. Fixed in one turn, no workflow needed.

## Quick Start
### Install
#### npx

```bash
npx openteams-web
```

#### Desktop App

Download the latest release for your platform from GitHub Releases.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest)

### Configure Providers

**openteams** includes a built-in openteams CLI agent. Configure your model providers in the app under `menu->setting->provider config->add provider`.

⚙️ [Provider config](https://doc.openteams-lab.com/advanced-usage/custom-provider)

You can also connect supported coding agents such as:

| Agent | Example install |
| --- | --- |
| Claude Code | `npm i -g @anthropic-ai/claude-code` |
| Gemini CLI | `npm i -g @google/gemini-cli` |
| Codex | `npm i -g @openai/codex` |
| Qwen Code | `npm i -g @qwen-code/qwen-code` |
| OpenCode | `npm i -g opencode-ai` |

📚 [More agent installation guides](https://doc.openteams-lab.com/getting-started)


### Get Started in 30 Seconds
**Prerequisites: Configure an API service provider or install any supported Code Agent.**

*step 1.* Create a group chat session. Add one or more members and assign each a model and a role.

*step 2.* In Free Chat mode, `@` any member to send a message or assign a task.

*step 3.* Switch to Workflow mode. Discuss requirements with the lead agent, refine the solution, and generate an execution plan.

*step 4.* Start the execution and review the result of each task node as it completes.

## Work mode

**openteams** supports two collaboration modes, because not every task demands the same level of structure. Think of it like **Claude Code's Plan and Build modes** — but for multi-agent teams: choose free collaboration when you want agents to explore and discuss openly, and structured workflows when you need reliable, predictable execution.

### Free Chat

In free chat mode, you `@` any agent to send it a task, and agents can freely pass messages to each other. Collaboration is governed by a team protocol you define — who does what, how they hand off, and what standards to follow.

**free chat mode** is best for small fixes, quick reviews, and exploratory discussions where a full workflow would be overkill.

![](./readmes/images/free_chat.png)

### Workflow

Workflow mode is designed for complex tasks that need to be broken down into subtasks with observable progress and controllable execution at every step.

A lead agent drives the planning phase — clarifying requirements, designing the approach, defining the execution plan, and assigning tasks to the right agents. The result is a visible workflow with steps, dependencies, reviews, retries, and acceptance points.

![](./readmes/images/openteams-workflow.png)

Instead of asking agents to run in a loose chain, **openteams** turns the work into a stateful execution graph.

**Note: Workflow mode uses more tokens. Please make sure your token balance is sufficient.**

## Major updates
- **2026.05.20 (v0.4.4)**
  - Workflow mode beta version
- **2026.05.07 (v0.3.22)**
  - Supports saving members from a group chat session as a preset team with a single click
- **2026.04.14 (v0.3.15)**
  - Workspace File Change Viewer
- **2026.04.06 (v0.3.12)**
  - Enable dark ui mode
  - fix openteams-cli concurrency issues
- **2026.04.02 (v0.3.10)**
  - Implement in-app version update
  - The documentation website is now live.

## Roadmap

openteams is under active development. Here is where we are heading:

- [ ] **Expert AI workers** — Launch more AI workers with deep domain knowledge that can solve specialized problems.
- [ ] **High-output AI teams** — Compose efficient expert AI workers into teams that can customize production workflows for specific business needs and turn requirements into deliverables end to end.
- [ ] **Integrate more agents** — Add support for more commonly used agents, such as Kilo code, hermes-agent, openclaw, and others.

***Vision: Transform token consumption into real productivity.***

Have a feature request or want to help shape the direction? [Open a discussion](https://github.com/openteams-lab/openteams/discussions).


## Community

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues): bug reports and feature requests
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions): product ideas and questions
- [Discord](https://discord.gg/openteams): community chat
- [Linux.do](https://linux.do): friendly link; thanks for providing community discussion support
- Community groups:

<p>
  <a href="./readmes/images/openteams-wechat-community.png"><img alt="OpenTeams WeChat community group QR code" src="./readmes/images/openteams-wechat-community.png" width="260"></a>
  <a href="./readmes/images/openteams-feishu-community.png"><img alt="OpenTeams Feishu/Lark community group QR code" src="./readmes/images/openteams-feishu-community.png" width="260"></a>
</p>

## Core Features

| Feature | What it means |
| --- | --- |
| AI employees and AI teams | Turn tokens into real productivity. Each AI employee or team carries domain-specific expertise that elevates general-purpose models into specialists — ready to ship work, not just generate text. |
| Multi-agent workspace | Bring multiple AI agents into one shared session instead of juggling separate windows. |
| Shared context | Agents work from the same conversation and project context. |
| Free Chat | Use `@` for direct, lightweight agent collaboration. |
| Workflow mode | Convert complex tasks into structured steps, dependencies, reviews, retries, and acceptance. |
| Visible execution | See what each agent is doing and where the work is blocked. |
| Review and retry | Review a step, retry the right task, and avoid restarting the whole project. |
| Artifacts and traces | Keep logs, diffs, transcripts, and generated artifacts attached to the work. |
| Local workspace execution | Agents work against your configured workspace, with runtime records kept under `.openteams/`. |

## Who It Is For

openteams is for:

- developers using multiple coding agents who are tired of juggling them
- technical leads who need agent runs to be reviewable and reproducible

It is not just a place to collect more agents. It is a way to turn agents into a working team.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Rust |
| Desktop | Tauri |
| Database | SQLx-managed relational schema |
| Workflow UI | React Flow |


## Local Development

### Prerequisites

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

### Windows (PowerShell): Start backend and frontend separately

`pnpm run dev` cannot run in Windows PowerShell. Use the following commands to run backend and frontend separately.

```powershell
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
pnpm run generate-types
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

### Build `openteams-cli` locally

Use the following commands if you need to compile the local `openteams-cli` binary instead of using the bundled or published build.
the build artifacts will be placed in the binaries directory.

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## Contributing

Contributions are welcome. Here is how to get started:

1. **Find an issue** — Check [Good First Issues](https://github.com/openteams-lab/openteams/labels/good%20first%20issue) for beginner-friendly tasks, or browse open issues.
2. **Discuss before building** — Before opening a large pull request, please open an issue or discussion so the direction can be aligned.
3. **Follow the code style** — Run the following before submitting:

```bash
pnpm run format
pnpm run check
pnpm run lint
```

4. **Submit a PR** — Describe what you changed and why. Link the related issue if applicable.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE)
for the full license text, including copyright and redistribution terms.

You can use, change, ship, and sell this project, including in
closed-source products. Keep the copyright notice, keep the license text, and
say what you changed when you modify it. Do not remove the required notices, do
not use the project owner's name or trademarks as an endorsement, and do not
expect the patent grant to continue if you start a patent lawsuit over this
project. The software is provided as-is, without warranty.
