# Repository Guidelines

## Project Overview

**OpenTeams** is a multi-agent conversation platform where multiple AI agents (Claude Code, Gemini CLI, Codex, QWen Coder, etc.) can collaborate in shared chat sessions like a real team. Key features:
- **Multi-agent chat sessions** with real-time streaming
- **Context synchronization** across agents
- **Agent execution tracking** with diffs and logs
- **Session archive/restore** functionality
- **Permission-based access control**
- **Skill registry** for extensible agent capabilities

### Supported AI Agents
- Claude Code (`@anthropic-ai/claude-code`)
- Gemini CLI (`@google/gemini-cli`)
- Codex (`@openai/codex`)
- QWen Coder (`@qwen-code/qwen-code`)
- Amp
- More coming soon

## Project Structure & Module Organization

### Backend (Rust Workspace)
- `crates/db/`: SQLx database models and migrations
  - Core chat models: `chat_session.rs`, `chat_agent.rs`, `chat_session_agent.rs`, `chat_message.rs`, `chat_run.rs`, `chat_permission.rs`, `chat_artifact.rs`
  - Chat extensions: `chat_skill.rs`, `chat_agent_skill.rs`, `chat_work_item.rs`
  - Analytics: `analytics.rs`
  - Workspace: `workspace.rs`, `workspace_repo.rs`, `repo.rs`, `project.rs`, `project_repo.rs`
  - Legacy models: `task.rs`, `session.rs`, `image.rs`, `execution_process.rs`, `coding_agent_turn.rs`
  - 80+ migrations in `migrations/`
- `crates/server/`: API server and binaries
  - Chat routes: `src/routes/chat/` (sessions.rs, agents.rs, messages.rs, runs.rs, skills.rs, work_items.rs, presets.rs)
  - Type generation: `src/bin/generate_types.rs`
- `crates/services/`: Business logic (40+ services)
  - `chat.rs`: Message parsing, mentions, attachments
  - `chat_runner.rs`: Agent execution orchestration, WebSocket streaming
  - `skill_registry.rs`: Skill discovery and management
  - `native_skills.rs`: Built-in skill implementations
  - `analytics.rs`: Usage analytics tracking
  - `config/`: Configuration management with version migrations
  - `git_host/`: GitHub, Azure DevOps integrations
  - `events/`: Event streaming and patches
- `crates/executors/`, `crates/utils/`, `crates/deployment/`, `crates/local-deployment/`, `crates/git/`, `crates/review/`, `crates/remote/`: Supporting crates

### Frontend
- `frontend/`: Main React + TypeScript application (Vite, Tailwind)
  - `src/pages/ui-new/`: **New design** pages
    - ChatSessions.tsx, Workspaces.tsx, WorkspacesLanding.tsx
    - ProjectKanban.tsx, VSCodeWorkspacePage.tsx, MigratePage.tsx
    - ElectricTestPage.tsx
  - `src/pages/`: **Legacy design** pages (Projects.tsx, ProjectTasks.tsx - wrapped in LegacyDesignScope)
  - `src/components/ui-new/primitives/`: 50+ new design components
    - Chat components: ChatBoxBase, CreateChatBox, SessionChatBox
    - Form components: InputField, Dropdown, MultiSelectDropdown, SearchableDropdown
    - Navigation: AppBar, ViewNavTabs, Toolbar, CommandBar
    - Display: Label, Badge, StatusDot, PriorityIcon, PrBadge
    - And many more...
  - `src/components/ui-new/primitives/conversation/`: 17 specialized message renderers
    - ChatUserMessage, ChatAssistantMessage, ChatSystemMessage, ChatThinkingMessage
    - ChatMarkdown, ChatToolSummary, ChatAggregatedDiffEntries, ChatApprovalCard
  - `src/components/ui/`: Legacy design system components
  - `src/lib/api.ts`: API client with chatApi methods
  - `src/styles/`: CSS for both design systems
    - `new/index.css` + `tailwind.new.config.js` (scoped to `.new-design`)
    - `legacy/index.css` + `tailwind.legacy.config.js` (scoped to `.legacy-design`)
- `remote-frontend/`: Lightweight remote deployment frontend
- `shared/`: Generated TypeScript types from Rust (`shared/types.ts` - auto-generated)
- `openteams-npx/`: NPM CLI package (`openteams`) for cross-platform installer
- `scripts/`: Development helpers (port management, DB preparation, desktop packaging)
- `docs/`: Documentation (Mintlify setup)
- `src-tauri/`: Tauri desktop application configuration
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets

## Chat System Architecture

### Database Schema
The chat system uses 10 core entities:
- **ChatSession**: Conversation containers with title, status (active/archived), team_protocol
- **ChatAgent**: Agent definitions with name, runner_type, system_prompt, tools_enabled
- **ChatSessionAgent**: Join table linking agents to sessions; tracks state (idle/running/waiting_approval/dead), workspace_path, allowed_skill_ids
- **ChatMessage**: Messages with sender_type (user/agent/system), mentions, metadata
- **ChatRun**: Agent execution runs per session_agent; includes run_index, run_dir, log/output paths
- **ChatPermission**: Access control with capability, scope, TTL
- **ChatArtifact**: Files/artifacts pinned to sessions
- **ChatSkill**: Skill registry entries with triggers, enabled status, source
- **ChatAgentSkill**: Many-to-many relation between agents and skills
- **ChatWorkItem**: Work items tracked within sessions

### API Routes (`/chat`)
```
/chat
├── /sessions (list, create)
│   ├── /{session_id}
│   │   ├── / (get, update, delete)
│   │   ├── /archive (POST), /restore (POST)
│   │   ├── /stream (WebSocket - real-time events)
│   │   ├── /agents (list, create session agents)
│   │   ├── /agents/{session_agent_id} (update, delete)
│   │   ├── /messages (list, create)
│   │   ├── /messages/{message_id} (get, delete, upload attachments)
│   │   └── /work_items (list, create)
├── /agents (list, create, update, delete)
├── /skills (list, create, update, delete, download)
├── /presets (list, create, update, delete)
└── /runs/{run_id} (log, diff, untracked files)
```

### Frontend Chat Components
- **Main Page**: `frontend/src/pages/ui-new/ChatSessions.tsx`
  - Lists active/archived sessions
  - Create new sessions with agent members
  - Real-time WebSocket message streaming
  - @mentions autocomplete
  - Diff viewer and run output display
- **UI Primitives**: `frontend/src/components/ui-new/primitives/`
  - `ChatBoxBase.tsx`, `CreateChatBox.tsx`, `SessionChatBox.tsx`
  - 50+ additional components for forms, navigation, display
- **Conversation Renderers**: `primitives/conversation/`
  - 17 specialized message types including thinking, errors, approvals
- **API Client**: `frontend/src/lib/api.ts` exports `chatApi` object

### Data Flow
1. User creates session → API → DB (chat_sessions)
2. User adds agents → API → DB (chat_session_agents)
3. User sends message → API → mention parsing → DB
4. Agent executes → chat_runner orchestrates → WebSocket streams events
5. Run artifacts captured → stored with diffs/logs
6. Skills registered → skill_registry manages discovery/execution

### Runtime Storage (Workspace-Scoped)
- Agents are restricted to their configured workspace path for file access.
- Chat context file path:
  - `<workspace>/.openteams/context/<session_id>/messages.jsonl`
- Chat run records path:
  - `<workspace>/.openteams/runs/<session_id>/run_records/...`
- Per-run context snapshot path:
  - `<run_dir>/context.jsonl`
- Internal `.openteams/` files should be treated as runtime artifacts, not user source files.

## Design System Status

The project currently maintains two design systems during transition:
- **New Design** (`.new-design` scope): Used in `pages/ui-new/` - ChatSessions, Workspaces, ProjectKanban
  - Components: `components/ui-new/` (50+ primitives)
  - Styles: `styles/new/index.css` + `tailwind.new.config.js`
- **Legacy Design** (`.legacy-design` scope): Used in `pages/` - Projects, ProjectTasks
  - Components: `components/ui/`, `components/legacy-design/`
  - Styles: `styles/legacy/index.css` + `tailwind.legacy.config.js`

Both scopes coexist via CSS class scoping. New features should use the **new design system**.

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.

**Key shared types** exported in `shared/types.ts`:
- Chat: `ChatSession`, `ChatMessage`, `ChatAgent`, `ChatSessionAgent`, `ChatRun`, `ChatPermission`, `ChatArtifact`, `ChatSkill`, `ChatWorkItem`
- Stream: `ChatStreamEvent` (message_new, agent_delta, agent_state)
- Enums: `ChatSessionStatus` (active/archived), `ChatSenderType` (user/agent/system), `ChatSessionAgentState` (idle/running/waiting_approval/dead)

When making changes to the types, you can regenerate them using `pnpm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (frontend + backend with ports auto-assigned): `pnpm run dev`
- Run QA dev: `pnpm run dev:qa`
- Backend (watch): `pnpm run backend:dev:watch`
- Frontend (dev): `pnpm run frontend:dev`
- Type checks: `pnpm run check` (frontend) and `pnpm run backend:check` (Rust cargo check)
- Lint: `pnpm run lint` (frontend + backend clippy)
- Format: `pnpm run format` (cargo fmt + prettier)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `pnpm run generate-types` (or `generate-types:check` in CI)
- Generate remote types: `pnpm run remote:generate-types`
- Prepare SQLx (offline): `pnpm run prepare-db`
- Prepare SQLx (check only): `pnpm run prepare-db:check`
- Prepare SQLx (remote package, postgres): `pnpm run remote:prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in `openteams-npx/`
- Desktop dev: `pnpm run desktop:dev`
- Desktop build: `pnpm run desktop:build`

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Frontend: ensure `pnpm run check` and `pnpm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`, `VK_ALLOWED_ORIGINS`
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
- SQLx offline mode requires `.sqlx/` cache in `crates/db/.sqlx/` (must be committed for CI)