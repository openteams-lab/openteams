<div align="center">
  <img src="https://raw.githubusercontent.com/openteams-lab/openteams/main/frontend/public/Logo/logo_black.svg" alt="OpenTeams" width="320">

  <p><strong>Run agents as one team, multiply your efficiency in the AI era.</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/openteams-web"><img alt="npm" src="https://img.shields.io/npm/v/openteams-web?style=flat-square" /></a>
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
# Run OpenTeams web app
npx openteams-web
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
