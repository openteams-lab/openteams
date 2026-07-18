<div align="center">
  <img src="readmes/images/openteams-logo.png" alt="openteams" width="100">
</div>

<div align="center">
  <img src="readmes/images/characters_black.png" alt="openteams" width="200" style="margin-top: 10px; margin-bottom: 10px;">

  <h5>Plan, Build, and Ship — with a team of AI agents instead of one</h5>

  <p>
    openteams is an open-source, local-first AI desktop app that helps indie developers plan, build, and ship software faster with an AI team they can control.
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
  <video src="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590" controls autoplay muted playsinline width="100%">
    <a href="https://github.com/user-attachments/assets/fdf0ef91-5b02-4302-bdec-087c1995a590">Watch the hero video</a>
  </video>
</div>

## What is openteams?

You already run Claude Code, Codex, Gemini CLI, or another coding agent. Each one works well on its own. Then you open a second terminal, and a third. You repeat the same context, carry results from one window to another, and keep track of who is changing what. Before long, you are managing the agents instead of the work: changes are scattered across sessions, project priorities live elsewhere, and token usage is disconnected from what actually shipped.

openteams is what is missing around those agents: **one shared room where they can talk and hand off work, a plan you can see and control, and a lightweight local record that connects project work to agent output without giving agents control of the roadmap.**

| openteams **is** | openteams is **not** |
| --- | --- |
| a local-first workspace for the coding agents you already use | another model or a replacement for Claude Code, Codex, or Gemini CLI |
| a shared session where agents can talk, hand off work, and keep the same context | a pile of separate chat windows that you have to coordinate yourself |
| a developer-owned issue list linked to agent sessions | a full project-management suite or a roadmap that agents rewrite themselves |
| a workflow you can inspect, review, interrupt, and retry step by step | one large prompt that disappears into a black box until it finishes |
| isolated worktrees you can review, merge, or discard separately | multiple agents changing the same workspace and interfering with each other |
| build statistics that show what agents delivered, the resources they used, and what it cost | a token counter with no record of what was built |

**Concretely, installing it gives you:** chat sessions for lightweight collaboration and planned execution, ready-to-use team workflow templates, developer-controlled Issues that link work to sessions, independent workspaces for isolating parallel tasks, and complete build statistics.

```text
without openteams                  with openteams

Claude ─ terminal A ─┐             Claude ─┐
Codex ── terminal B ─┼─ you relay  Codex ──┼─ shared session
Gemini ─ terminal C ─┘             Gemini ─┘

plan: somewhere else               issues ── sessions ── build results
```

## Why openteams

AI coding agents can produce plenty of code. The harder part is keeping their work organized: sharing context, seeing what is happening, stopping parallel tasks from overwriting each other, deciding what comes next, and knowing what the work cost.

openteams keeps agents and their conversations in one session. For larger tasks, Workflow mode shows the steps and dependencies before and during execution, so you can review or retry one step without starting everything again. If several sessions are working at once, each can use its own Git worktree, keeping unfinished changes separate until you choose to merge or discard them.

The project direction stays with the developer. Issues hold the work you have chosen and link it to the sessions where agents carry it out; agents do the work, but they do not rewrite the plan. Build statistics then show what was delivered alongside the tokens and cost used to deliver it.

openteams is not trying to give you more agents. It is trying to make sure you always know what is being built, where the changes are, what comes next, and what it cost.

## Quick Start
### Install
#### Desktop App (Recommended)

Download the latest release for your platform from GitHub Releases.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-windows-x64.msi)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-macos.dmg)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/openteams-lab/openteams/releases/latest/download/openteams-linux-amd64.deb)

**macOS:** The current macOS release is not signed or notarized by Apple. Browsers add a quarantine attribute to apps downloaded from the internet, so Gatekeeper may report that openteams is “damaged” even when the download is intact. After dragging `openteams.app` to `/Applications`, and only if you trust that it came from the official openteams GitHub Release, run:

```bash
xattr -dr com.apple.quarantine /Applications/openteams.app
```

This removes the quarantine attribute only from openteams; it does not disable Gatekeeper globally.

#### npx

```bash
npx openteams-web
```

### Configure Providers

**openteams** includes a built-in openteams CLI agent. Configure your model providers in the app under `Settings → Provider Config → Add Provider`.

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
- [ ] **Integrate more agents** — Add support for more commonly used agents, such as Kilo Code, hermes-agent, openclaw, and others.

***Vision: Transform token consumption into real productivity.***

Have a feature request or want to help shape the direction? [Open a discussion](https://github.com/openteams-lab/openteams/discussions).


## Community

- [GitHub Issues](https://github.com/openteams-lab/openteams/issues): bug reports and feature requests
- [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions): product ideas and questions
- [Discord](https://discord.gg/openteams): community chat
- [Linux.do](https://linux.do): friendly link; thanks for providing community discussion support
- Community groups:

<p>
  <a href="./readmes/images/openteams-wechat-community.png"><img alt="openteams WeChat community group QR code" src="./readmes/images/openteams-wechat-community.png" width="260"></a>
  <a href="./readmes/images/openteams-feishu-community.png"><img alt="openteams Feishu/Lark community group QR code" src="./readmes/images/openteams-feishu-community.png" width="260"></a>
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
| Issue management | Record and prioritize developer-controlled work items, sync issues from GitHub, and create or link sessions for execution. |
| Isolated workspaces | Run independent session tasks in separate Git worktrees, then review, merge, or discard each result without interfering with other work. |
| Build statistics | Compare bugs fixed and features delivered with token usage and cost breakdowns across sessions and models. |
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

### macOS, Linux, and Windows

```bash
# Clone the repository
git clone https://github.com/openteams-lab/openteams.git
cd openteams
pnpm i
npm run dev
# build
pnpm --filter frontend build
pnpm desktop:build
```

### Build `openteams-cli` locally

Use the following commands if you need to compile the local `openteams-cli` binary instead of using the bundled or published build.
the build artifacts will be placed in the binaries directory.

```bash
# From the repository root
bun run ./scripts/build-openteams-cli.ts
```

## Contributing

Contributions are welcome, including reusable AI team workflows that others can learn from and adapt. Here is how to get started:

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

openteams is released under the Apache License 2.0. In practical terms, you may:

- use it free of charge for personal, educational, internal, or commercial projects;
- copy, modify, and build on the source code;
- distribute the original or a modified version, as source code or compiled software;
- include it in a proprietary product and charge for that product without having to open-source the rest of your code.

If you redistribute openteams or a modified version, include a copy of the license, keep the relevant copyright and attribution notices, and clearly state which files you changed.

Three other points are worth knowing:

- **Brand:** You may use the code, but you may not present yourself as the official openteams project or use its name and trademarks as your own brand.
- **Patents:** Contributors give you permission to use the patents necessarily covered by their code, so they cannot use those patents to stop you from using openteams. In return, if you file a lawsuit claiming that openteams infringes your patent, you lose this patent protection. Only the patent permission ends—not your ordinary copyright permission to use the code. Most users who are not involved in patent litigation are unaffected.
- **Risk:** The software is provided for free as it is. You decide whether it fits your needs and accept the risks of using it; the project does not provide a warranty or compensation for problems.

This section is a plain-language summary. The [LICENSE](LICENSE) file contains the authoritative legal terms.

See [LICENSE](LICENSE) for the complete legal terms.
