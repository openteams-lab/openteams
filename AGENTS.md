# Repository Guidelines

## Project Overview

**OpenTeams** is a multi-agent collaboration platform where multiple AI agents
(Claude Code, Gemini CLI, Codex, QWen Coder, etc.) work together in shared
sessions like a real team. The platform supports two cooperating execution
modes:

- **Chat mode** — free-form multi-agent conversation with @mentions, real-time
  streaming, approvals, and skill triggers.
- **Workflow mode** — a lead agent generates a structured plan (React Flow
  JSON), the backend compiles it into a deterministic DAG of steps/edges/loops,
  and an orchestrator schedules sub-agents through that DAG with explicit
  pause/resume/retry/accept-reject semantics.

Key features:
- Multi-agent chat sessions with real-time streaming
- Workflow planning and orchestration (React Flow JSON as truth source)
- Context synchronization across agents
- Agent execution tracking with diffs and logs
- Session archive/restore
- Permission-based access control
- Skill registry for extensible agent capabilities

### Supported AI Agents
- Claude Code (`@anthropic-ai/claude-code`)
- Gemini CLI (`@google/gemini-cli`)
- Codex (`@openai/codex`)
- QWen Coder (`@qwen-code/qwen-code`)
- Amp
- More coming soon

## Project Structure & Module Organization

### Backend (Rust Workspace)
- `crates/db/`: SQLx models and migrations
  - **Chat models**: `chat_session.rs`, `chat_agent.rs`, `chat_session_agent.rs`,
    `chat_message.rs`, `chat_run.rs`, `chat_permission.rs`, `chat_artifact.rs`,
    `chat_skill.rs`, `chat_agent_skill.rs`, `chat_work_item.rs`
  - **Workflow models**: `workflow_plan.rs`, `workflow_plan_revision.rs`,
    `workflow_execution.rs`, `workflow_step.rs`, `workflow_step_edge.rs`,
    `workflow_loop.rs`, `workflow_round.rs`, `workflow_agent_session.rs`,
    `workflow_transcript.rs`, `workflow_event.rs`, `workflow_step_review.rs`,
    `workflow_iteration_feedback.rs`, `workflow_types.rs` (status enums)
  - Analytics: `analytics.rs`
  - Workspace: `workspace.rs`, `workspace_repo.rs`, `repo.rs`, `project.rs`,
    `project_repo.rs`
  - Legacy models: `task.rs`, `session.rs`, `image.rs`, `execution_process.rs`,
    `coding_agent_turn.rs`
  - 80+ migrations in `migrations/`
- `crates/server/`: API server and binaries
  - Chat routes: `src/routes/chat/`
  - Workflow routes: `src/routes/workflow.rs`
  - Type generation: `src/bin/generate_types.rs`
- `crates/services/`: Business logic (40+ services)
  - `chat.rs`: Message parsing, mentions, attachments
  - `chat_runner.rs`: Agent execution orchestration, WebSocket streaming
  - **`workflow_orchestrator/`**: Plan compilation, DAG scheduling, state
    reduction, projection. Submodules: `mod.rs` (scheduler loop and command
    handler), `reducer.rs` (only legal writer of state), `step_executor.rs`,
    `review.rs`, `retry_resume.rs`, `plan_control.rs`, `transcript_actions.rs`,
    `step_input.rs`, `projection.rs`
  - `workflow_runtime.rs`: Card and graph projection for the frontend
  - `workflow_loop_executor.rs`: Loop review pass/reject/wait-for-user flow
  - `skill_registry.rs` / `native_skills.rs`: Skill discovery and built-ins
  - `analytics.rs`: Usage analytics
  - `config/`, `git_host/`, `events/`: Configuration, integrations, events
- `crates/executors/`, `crates/utils/`, `crates/deployment/`,
  `crates/local-deployment/`, `crates/git/`, `crates/review/`,
  `crates/remote/`: Supporting crates

### Frontend
- `frontend/`: Main React + TypeScript application (Vite, Tailwind)
  - `src/pages/ui-new/`: **New design** pages — ChatSessions, Workspaces,
    WorkspacesLanding, ProjectKanban, VSCodeWorkspacePage, MigratePage,
    ElectricTestPage
  - `src/pages/`: **Legacy design** pages (Projects, ProjectTasks; wrapped in
    `LegacyDesignScope`)
  - `src/components/ui-new/primitives/`: 50+ new-design components
    (ChatBoxBase, CreateChatBox, SessionChatBox, form/nav/display primitives)
  - `src/components/ui-new/primitives/conversation/`: 17 specialized message
    renderers (ChatUserMessage, ChatAssistantMessage, ChatToolSummary,
    ChatApprovalCard, ChatThinkingMessage, ChatMarkdown, ...)
  - `src/pages/ui-new/chat/components/`: workflow UI — `WorkflowWindow.tsx`,
    `WorkflowGraphBoard.tsx` (React Flow + dagre), `ChatWorkflowCard.tsx`,
    `WorkflowFinalReviewCard.tsx`, `WorkflowPendingInputCard.tsx`,
    `WorkflowPendingReviewCard.tsx`, `WorkflowIterationFeedbackCard.tsx`,
    `WorkflowReviewSettingsDialog.tsx`
  - `src/components/ui/`: Legacy design system components
  - `src/lib/api.ts`: API client (`chatApi`, workflow endpoints)
  - `src/styles/`: CSS for both design systems
    - `new/index.css` + `tailwind.new.config.js` (scoped to `.new-design`)
    - `legacy/index.css` + `tailwind.legacy.config.js` (scoped to
      `.legacy-design`)
- `remote-frontend/`: Lightweight remote deployment frontend
- `shared/`: Generated TypeScript types from Rust (`shared/types.ts`, auto-gen)
- `npx/openteams-npx/`: NPM CLI package (`openteams`) for cross-platform install
- `scripts/`: Dev helpers (port management, DB prep, desktop packaging)
- `docs/`: Documentation (Mintlify). Architecture and workflow design notes
  under `docs/architecture/` and `docs/workflow-*.md`
- `src-tauri/`: Tauri desktop application configuration
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets

## Chat System Architecture

### Database Schema (chat)
- **ChatSession**: title, status (active/archived), team_protocol
- **ChatAgent**: name, runner_type, system_prompt, tools_enabled
- **ChatSessionAgent**: join row per session; state
  (idle/running/waiting_approval/dead), workspace_path, allowed_skill_ids
- **ChatMessage**: sender_type (user/agent/system), mentions, metadata
- **ChatRun**: execution run per session_agent (run_index, run_dir, log/output)
- **ChatPermission**: capability, scope, TTL
- **ChatArtifact**: files/artifacts pinned to a session
- **ChatSkill**, **ChatAgentSkill**: skill registry and assignments
- **ChatWorkItem**: tracked work items inside a session

### API Routes (`/chat`)
```
/chat
├── /sessions (list, create)
│   ├── /{session_id}
│   │   ├── / (get, update, delete)
│   │   ├── /archive (POST), /restore (POST)
│   │   ├── /stream (WebSocket — real-time events)
│   │   ├── /agents (list, create) and /agents/{id} (update, delete)
│   │   ├── /messages (list, create) and /messages/{id} (get, delete, upload)
│   │   └── /work_items (list, create)
├── /agents (list, create, update, delete)
├── /skills (list, create, update, delete, download)
├── /presets (list, create, update, delete)
└── /runs/{run_id} (log, diff, untracked files)
```

### Frontend Chat Components
- Main page: `frontend/src/pages/ui-new/ChatSessions.tsx`
- Primitives: `frontend/src/components/ui-new/primitives/` (ChatBoxBase,
  CreateChatBox, SessionChatBox, plus 50+ others)
- Conversation renderers: `primitives/conversation/` (17 specialized types)
- API client: `chatApi` in `frontend/src/lib/api.ts`

### Data Flow (chat)
1. User creates session → API → DB (`chat_sessions`)
2. User adds agents → API → DB (`chat_session_agents`)
3. User sends message → API → mention parsing → DB
4. Agent executes → `chat_runner` orchestrates → WebSocket streams events
5. Run artifacts captured → stored with diffs/logs
6. Skills registered → `skill_registry` manages discovery/execution

## Workflow System Architecture

Workflow mode is layered as four well-separated concerns:

1. **Truth source** — `chat_workflow_plans` + `chat_workflow_plan_revisions`
   store the plan as **React Flow JSON** (`nodes`, `edges`, `viewport`). Plan
   JSON is edited only by `lead` or `system`; users can request changes but do
   not edit JSON directly.
2. **Compiled execution graph** — the compiler validates the JSON and
   materializes `chat_workflow_executions`, `chat_workflow_steps`,
   `chat_workflow_step_edges`, and `chat_workflow_loops`. Steps are addressed
   by stable `step_key`. Loop rows include `member_step_ids_json` and a review
   step linkage.
3. **Orchestrator** (`crates/services/src/services/workflow_orchestrator/`).
   Four internal layers — never reorder them:
   - **Command handler** (`mod.rs`): receives external commands (start, pause,
     resume, interrupt, retry, transcript actions, plan control).
   - **State reducer** (`reducer.rs`): the *only* path that mutates step /
     execution / loop / round status. Validates the `from → to` transition and
     the cross-layer combination table; rejects illegal combos.
   - **Scheduler loop** (`wake_scheduler` in `mod.rs`): re-reads execution
     snapshot, promotes `ready` steps, schedules per agent session, and parks
     for review/input/final-review. Triggered by writes (immediate wake) and a
     periodic compensating scan.
   - **Event projector** (`projection.rs` + `workflow_runtime.rs`): emits
     `chat_workflow_events`, writes the card projection, and pushes incremental
     graph patches over WebSocket.
4. **Frontend projection** — the chat session shows one **ChatWorkflowCard**
   summarizing the workflow. Detail is rendered in **WorkflowWindow** with a
   React Flow + dagre graph (`WorkflowGraphBoard`), transcript pane, and
   action cards (pending input/review/final-review/iteration-feedback).

### Roles
- **Lead** (LLM agent): generates and revises plan JSON; runs as a real agent
  but does not own the scheduling loop. Pause All halts the lead alongside
  other workflow agents.
- **Workflow agents**: execute steps; one agent session runs at most one step
  at a time (Phase 1 constraint).
- **User**: requests plan changes, approves final acceptance, resolves
  waiting_input / waiting_review actions, retries failed/interrupted steps.
- **Orchestrator**: the only scheduler and the only writer of runtime state.

### Step lifecycle (key states from `workflow_types.rs`)
`pending → ready → running → completed`, with branches:
- `running → waiting_input → ready` (user supplies input; prior partial output
  may be injected as context)
- `running → waiting_review → ready | completed` (review pass/reject)
- `running → interrupt_requested → interrupted` (terminate)
- `running → failed` (retry from `failed`; `interrupted` retries follow the
  retry-failed-step path — see audit note below)
- `pre_completed` is a scheduler-internal staging state

### Execution lifecycle
`bootstrapping → running` (or `bootstrapping → failed` for compile/setup
failures), then `running ↔ paused`, `paused → recompiling → resuming →
running`, terminal: `waiting_user_acceptance → completed | rejected`,
`cancelled`, `failed`. **Guard**: `recompiling` may only be entered from
`paused`. Result acceptance is decided by the **user**, not the lead.

### Loops
- Loop has member steps and exactly one review step (review_step is not in
  `member_step_ids_json`).
- Loop statuses: `pending → running → (passed → waiting_user → completed |
  rejected → running with retry_count++ | failed)`.
- Member steps may only run while loop is `running` or `rejected`. On loop
  review reject, scheduler increments `loop.retry_count`, resets member steps
  via `prepare_retry`, and re-emits `LoopRetrying`.
- Failed loop recovery: when the last `failed` member step leaves the failed
  state (manual retry succeeds, or scheduler `restore_recovered_failed_loops`
  runs), loop returns to `running`.

### Rounds and final acceptance
- A `result` node in the plan triggers an implicit `lead_acceptance` checkpoint
  injected by the compiler.
- Round lifecycle is tracked in `chat_workflow_rounds`. On user reject:
  `execution → paused → recompiling`, lead produces a new plan revision (must
  be user-confirmed), new round is created.
- Round records are append-only — never overwritten — for audit. `work_items`
  are materialized only on final user acceptance.

### Known invariants and pitfalls (see `docs/workflow-state-deadlock-audit.md`)
- **Reducer is the only legal writer.** Bypassing it (raw `UPDATE`) is a bug.
- All state writes should be guarded by `WHERE id = ? AND status = ?`
  (compare-and-swap) to prevent duplicate scheduling races (P0 audit finding).
- Frontend control visibility must match backend-accepted states (Pause All,
  Retry for `interrupted`).
- Wire-format step status must be **snake_case** (`waiting_input`, not
  `waitinginput`). Do not emit raw `format!("{:?}", status).to_lowercase()`.
- `find_active_by_session` should not treat `completed` as active for new
  plan generation; use `find_non_terminal_by_session` for that gate.
- `final_review` parking must be atomic with the transition into the waiting
  execution status, or include a scheduler self-heal pass.

### Workflow API (`/workflow`)
All routes are wired in `crates/server/src/routes/workflow.rs`. Public surface
includes (non-exhaustive): plan get/update, execution start/pause/resume/
cancel, step interrupt/retry, transcript actions (resolve input/review),
final-review accept/reject, iteration feedback. The card projection and graph
patches are pushed over the same chat WebSocket stream (`/chat/sessions/
{id}/stream`).

### Runtime Storage (Workspace-Scoped)
- Agents are restricted to their configured workspace path.
- Chat context: `<workspace>/.openteams/context/<session_id>/messages.jsonl`
- Chat run records: `<workspace>/.openteams/runs/<session_id>/run_records/...`
- Per-run context snapshot: `<run_dir>/context.jsonl`
- Workflow transcripts live in DB (`chat_workflow_transcripts`); workflow
  events in `chat_workflow_events`. Internal `.openteams/` files are runtime
  artifacts, not user source.

## Design System Status

Two design systems coexist via CSS class scoping during transition:
- **New Design** (`.new-design`): `pages/ui-new/` (ChatSessions, Workspaces,
  ProjectKanban, all workflow UI). Components: `components/ui-new/` (50+
  primitives). Styles: `styles/new/index.css` + `tailwind.new.config.js`.
- **Legacy Design** (`.legacy-design`): `pages/` (Projects, ProjectTasks).
  Components: `components/ui/`, `components/legacy-design/`. Styles:
  `styles/legacy/index.css` + `tailwind.legacy.config.js`.

New features (including all workflow UI) use the **new design system**.

## Managing Shared Types Between Rust and TypeScript

`ts-rs` derives TypeScript types from Rust structs/enums. Annotate Rust types
with `#[derive(TS)]` and related macros; `ts-rs` generates `.ts` declarations.

**Key shared types** in `shared/types.ts`:
- **Chat**: `ChatSession`, `ChatMessage`, `ChatAgent`, `ChatSessionAgent`,
  `ChatRun`, `ChatPermission`, `ChatArtifact`, `ChatSkill`, `ChatWorkItem`
- **Workflow**: `WorkflowPlan`, `WorkflowPlanRevision`, `WorkflowExecution`,
  `WorkflowStep`, `WorkflowStepEdge`, `WorkflowLoop`, `WorkflowRound`,
  `WorkflowAgentSession`, `WorkflowTranscript`, `WorkflowEvent`,
  `WorkflowStepReview`, `WorkflowIterationFeedback`, plus their status enums
  in `workflow_types.rs` (`WorkflowExecutionStatus`, `WorkflowStepStatus`,
  `WorkflowLoopStatus`, `WorkflowRoundStatus`, ...)
- **Stream**: `ChatStreamEvent` (message_new, agent_delta, agent_state,
  workflow_card_update, workflow_graph_patch, ...)
- **Enums**: `ChatSessionStatus`, `ChatSenderType`, `ChatSessionAgentState`

Regenerate with `pnpm run generate-types`. Do **not** manually edit
`shared/types.ts`; edit `crates/server/src/bin/generate_types.rs` instead.

## Build, Test, and Development Commands
- Install: `pnpm i`
- Dev (frontend + backend, ports auto-assigned): `pnpm run dev`
- QA dev: `pnpm run dev:qa`
- Backend (watch): `pnpm run backend:dev:watch`
- Frontend (dev): `pnpm run frontend:dev`
- Type checks: `pnpm run check` (frontend) / `pnpm run backend:check` (cargo)
- Lint: `pnpm run lint` (frontend + backend clippy)
- Format: `pnpm run format` (cargo fmt + prettier)
- Rust tests: `cargo test --workspace`
- Generate TS types: `pnpm run generate-types` (`generate-types:check` in CI)
- Generate remote types: `pnpm run remote:generate-types`
- Prepare SQLx (offline): `pnpm run prepare-db`
- Prepare SQLx (check only): `pnpm run prepare-db:check`
- Prepare SQLx (remote, postgres): `pnpm run remote:prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in
  `npx/openteams-npx/`
- Desktop dev/build: `pnpm run desktop:dev` / `pnpm run desktop:build`

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate;
  snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols).
  PascalCase components, camelCase vars/functions, kebab-case file names where
  practical.
- Keep functions small; derive `Debug`/`Serialize`/`Deserialize` where useful.
- **Workflow code**: never bypass the reducer; never serialize step status via
  `Debug`; always use the typed snake_case `Display`/serde impl.

## Testing Guidelines
- Default to minimal verification instead of adding new tests. Do not add tests
  just to prove every small UI or copy change; prefer type checks, lint, build,
  or targeted manual verification when the risk is low.
- Add or update tests only when the change affects shared logic, protocol or
  state-machine behavior, security-sensitive code, workflow orchestration,
  data migrations, or a bug that is likely to regress without a focused guard.
- Rust: prefer unit tests alongside code (`#[cfg(test)]`); run
  `cargo test --workspace` when appropriate. Add tests for meaningful new logic
  and edge cases, not for incidental edits.
- Workflow orchestrator tests live in
  `crates/services/src/services/workflow_orchestrator/tests.rs`. New state
  transitions require a corresponding reducer test that asserts both the
  legal path and the rejection of illegal `from → to` pairs.
- Frontend: prioritize `pnpm run check` and `pnpm run lint`. Add lightweight
  tests only for risky runtime logic, shared helpers, or regressions that cannot
  be confidently verified by existing checks.

## Observability Requirements (workflow)
- Every state transition must emit a typed `chat_workflow_events` row through
  the projector. Direct DB writes that skip the event log are a bug.
- The card projection (`workflow_runtime.rs`) is the single source for
  frontend rendering; do not invent ad-hoc projections in route handlers.
- Reducer rejections (illegal `from → to` or illegal combinations) must
  increment a metric and be logged with `execution_id`, `step_id`, `from`,
  `to` for debuggability.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs:
  `FRONTEND_PORT`, `BACKEND_PORT`, `HOST`, `VK_ALLOWED_ORIGINS`
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
- SQLx offline mode requires the `.sqlx/` cache in `crates/db/.sqlx/` (must
  be committed for CI).
- Plan JSON write permission is restricted to `lead | system` — never accept
  user-edited plan JSON on routes that target the live execution.
