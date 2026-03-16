<div align="center">
  <img src="https://raw.githubusercontent.com/openteams-lab/openteams/main/frontend/public/openteams-brand-logo.png" alt="OpenTeams" width="320">

  <p><strong>Run agents as one team, multiply your efficiency in the AI era.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams"><img alt="npm" src="https://img.shields.io/npm/v/openteams?style=flat-square" /></a>
    <a href="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml"><img alt="Build" src="https://github.com/openteams-lab/openteams/actions/workflows/pre-release.yml/badge.svg" /></a>
    <a href="https://github.com/openteams-lab/openteams/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" /></a>
    <a href="https://discord.gg/MbgNFJeWDc"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  </p>

  <p>
    <a href="https://github.com/openteams-lab/openteams#quick-start">Quick Start</a> |
    <a href="https://docs.openteams.com">Docs</a> |
    <a href="https://github.com/openteams-lab/openteams">GitHub</a>
  </p>
</div>

---

## What is OpenTeams?

OpenTeams is a multi-agent conversation platform where multiple AI agents (Claude Code, Gemini CLI, Codex, QWen Coder, etc.) can collaborate in shared chat sessions like a real team.

**Key Features:**

| Feature | What you get |
|--|--|
| **Supported agents** | Supports 10 coding-agent runtimes, including `Claude Code`, `Gemini CLI`, `Codex`, `Qwen Code`, `Amp`, `Cursor Agent`, `Copilot`, `Droid`, `Kimi Code`, and `OpenCode`. |
| **Shared group-chat context** | Every participant works from the same conversation history instead of juggling copied prompts across separate windows. |
| **Parallel execution** | Multiple agents can work on the same task at the same time inside one shared session. |
| **Autonomous collaboration** | Agents can `@mention` each other, hand work off, and coordinate directly inside the chat. |
| **Built-in AI members** | Start with 160+ built-in AI members across engineering, marketing, writing, research, and content production. |
| **Built-in AI team presets** | Launch with 8 ready-to-use team presets for common workflows. |
| **Skill library** | Equip agents with 1000+ built-in skills, and import your own skills when needed. |
| **Fully local execution** | Agents run against your local workspace. No need to be concerned about data privacy. |

---

## Quick Start

```bash
# Install and run
npx openteams
```

### Requirements

**You'll need at least one AI agent installed:**

| Agent | Install |
|-------|---------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` |
| [Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | `npm i -g @qwen-code/qwen-code` |

📚 [More agent installation guides](https://docs.openteams.com/getting-started)

---

## CLI Commands

`openteams` is a zero-build NPX launcher. It **does not compile source code** on your machine. Instead, it downloads prebuilt binaries, verifies checksum, extracts, installs, and runs.

```bash
npx openteams              # install (if needed) + run
npx openteams install      # install only
npx openteams start [args] # run binary
npx openteams update       # force re-download + reinstall
npx openteams status       # show install status
npx openteams uninstall    # remove ~/.openteams
npx openteams --help
```

Pass-through args example:

```bash
npx openteams -- --port 54321
npx openteams start --port 54321
```

---

## How It Works

When you run `npx openteams`, the CLI does:

1. Detect current platform/arch
2. Download prebuilt `openteams.zip` from configured object storage
3. Verify SHA256 from manifest
4. Extract to `~/.openteams/bin`
5. Add `~/.openteams/bin` to PATH (current process + persistent profile)
6. Launch binary immediately

## Installation Paths

- Install root: `~/.openteams`
- Binary: `~/.openteams/bin/openteams` (or `.exe` on Windows)
- Cache: `~/.openteams/cache/<tag>/<platform>/`
- Metadata: `~/.openteams/install.json`

## Requirements

- Node.js >= 18
- Network access to configured OSS/R2 public URL

No Rust/Git/build toolchain is required for end users.

---

## Why we're better

Legend: ✅ Full support | 🟡 Partial support | ❌ No support

| **Capability** | Traditional Single Agent | Multi-window Workflow | Claude Code Agent Team | OpenTeams |
|--|--|--|--|--|
| **Parallelism**| ❌ No, sequential | 🟡 Partial, manual | ✅ Yes, Claude subagents | ✅ Yes, automatic |
| **Shared context** | ❌ No | ❌ No, copy-paste | 🟡 Partial, split subagent contexts | ✅ Yes, always in sync |
| **Multi-model collaboration** | ❌ No | 🟡 Partial, manual switching | ❌ No, Claude only | ✅ Yes, Claude + Gemini + Codex + more |
| **Agent handoff** | ❌ No | ❌ No, you orchestrate it | 🟡 Partial, delegated inside Claude | ✅ Yes, direct `@mentions` |
| **Predefined AI member** | ❌ No | ❌ No | ❌ No | ✅ Yes, 160+ members |
| **Team manager** | ❌ No | ❌ No | ❌ No | ✅ Yes, Customize team guidelines |
| **Your effort** | 🔴 High | 🔴 Very high | 🟠 Medium | 🟢 Low |

---

## Community

| | |
|--|--|
| **Bug Reports** | [GitHub Issues](https://github.com/openteams-lab/openteams/issues) |
| **Discussions** | [GitHub Discussions](https://github.com/openteams-lab/openteams/discussions) |
| **Community Chat** | [Discord](https://discord.gg/MbgNFJeWDc) |

## License

Apache 2.0