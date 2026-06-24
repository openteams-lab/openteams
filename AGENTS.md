# Repository Guidelines

## Project Overview

**OpenTeams** is a local-first multi-agent collaboration workspace. It lets
multiple AI agents work in one shared project/session, either through free-form
chat or through structured workflow execution.

Primary product surfaces:
- **Free Chat**: shared multi-agent sessions with `@mentions`, streaming agent
  output, queues, approvals, attachments, activity logs, diffs, and team
  protocols.
- **Workflow mode**: a lead agent produces a React Flow plan, the backend
  compiles it into a deterministic execution graph, and the orchestrator runs
  worker/reviewer agents with pause, retry, review, input, and iteration
  controls.
- **Projects and issues**: project workspace shell with issues/work items,
  members, team templates, GitHub integration, source-control views, and build /
  token-cost statistics.
- **Session worktrees**: optional isolated Git worktrees per chat session so
  agent changes can be merged, discarded, or cleaned up separately from the
  main workspace.

Supported agent/runtime integrations include Claude Code, Gemini CLI, Codex,
Qwen Code, OpenCode, Amp, and the bundled OpenTeams CLI/runtime.

## Project Structure

### Backend

- `crates/db/`: SQLx models, migrations, and generated offline query cache.
  Important model groups:
  - Chat/session: `chat_session.rs`, `chat_session_agent.rs`,
    `chat_message.rs`, `chat_message_queue.rs`, `chat_run.rs`,
    `chat_permission.rs`, `chat_artifact.rs`, `chat_skill.rs`,
    `chat_agent_skill.rs`, `chat_work_item.rs`.
  - Session worktrees: `chat_session_worktree.rs`.
  - Workflow: `workflow_plan.rs`, `workflow_plan_revision.rs`,
    `workflow_execution.rs`, `workflow_step.rs`,
    `workflow_step_edge.rs`, `workflow_loop.rs`, `workflow_round.rs`,
    `workflow_agent_session.rs`, `workflow_transcript.rs`,
    `workflow_event.rs`, `workflow_step_review.rs`,
    `workflow_iteration_feedback.rs`, `workflow_types.rs`.
  - Projects/GitHub/source control: `project.rs`, `project_member.rs`,
    `project_work_item*.rs`, `project_delivery*.rs`, `project_repo.rs`,
    `repo.rs`, `repo_integration.rs`, `github_*`.
  - Analytics/build stats/pricing: `analytics.rs`, `model_pricing.rs`,
    `model_price_cache.rs`, `project_stats.rs`.
  - There are 120+ migrations under `crates/db/migrations/`.
- `crates/server/`: Axum API server and binaries.
  - Chat routes: `src/routes/chat/` with sessions, messages, agents, skills,
    queues, runs, workflow, presets, work items, and worktree routes.
  - Workflow action routes: `src/routes/workflow.rs`.
  - Project/source-control/GitHub routes: `src/routes/projects.rs`,
    `project_source_control.rs`, `project_github.rs`, `github.rs`.
  - Type generation: `src/bin/generate_types.rs`.
- `crates/services/`: business logic.
  - Chat: `chat/`, `chat_runner/`, `queued_message.rs`,
    `chat_history_file.rs`.
  - Workflow: `workflow/` with `compiler/`, `orchestrator/`, `runtime/`,
    `loop_executor/`, `iteration/`, `analytics/`, `review.rs`,
    `validator.rs`. Re-export aliases are in `services/workflow/mod.rs`.
  - Session worktrees: `session_worktree.rs`, `session_worktree/tests.rs`,
    `worktree_manager.rs`.
  - Projects/GitHub/source control: `project/`, `github/`, `git_host/`,
    `repo.rs`, `repo_integration.rs`, `workspace_change_capture.rs`.
  - Agent/runtime/config: `agent_runtime.rs`, `member_execution.rs`,
    `agent_skill_policy.rs`, `skill_registry/`, `native_skills.rs`,
    `config/presets/`.
  - Build stats and analytics: `build_stats/`, `analytics*.rs`.
- Other Rust crates: `crates/executors/`, `crates/utils/`, `crates/git/`,
  `crates/review/`, `crates/deployment/`, `crates/local-deployment/`.
  `crates/remote/` and `src-tauri/` are excluded from the main Rust workspace.

### Frontend and Packages

- `frontend/`: React 19 + TypeScript + Vite + Tailwind v4 application.
  - `src/App.tsx`: main workspace shell, sidebar, tabs, project/session routing.
  - `src/components/`: app components including `WorkflowWorkspace`,
    `FreeChatWorkspace`, `ProjectSidebar`, settings, source-control, and
    analytics components.
  - `src/components/workflow/`: workflow card/window/graph/review/input UI.
  - `src/components/source-control/`: session source-control panel,
    worktree badge, and merge-conflict UI.
  - `src/pages/`: top-level pages for issues, projects, team, team templates,
    routing, GitHub, settings, agents, tasks, and build stats.
  - `src/context/`: workspace and scaling contexts.
  - `src/hooks/`: session source-control and session worktree hooks.
  - `src/lib/api.ts`: API clients; shared mapping/helpers live in `src/lib/`.
  - `src/index.css`: global design tokens and Tailwind v4 styles.
- `shared/types.ts`: generated TypeScript declarations from Rust `ts-rs`.
  Do not edit by hand.
- `openteams-cli/`: Bun workspace for the bundled OpenTeams CLI packages.
- `npx/`: package wrappers for `openteams-npx`, `openteams-web-npx`, and
  `openteams-cli-npx`.
- `docs/`: Mintlify documentation plus architecture/debugging notes.
- `src-tauri/`: desktop app configuration.

## Chat System

### Chat Data Model

- `ChatSession`: title, status, lead agent, summary/archive metadata, team
  protocol fields, default workspace, input mode, `project_id`, and
  `worktree_mode`.
- `ChatSessionWorktreeMode`: `inherit | disabled | isolated`.
- `ChatAgent`: reusable member definition, runner type, prompt, tools, owner
  project.
- `ChatSessionAgent`: per-session member join row with state, workspace path,
  and allowed skills.
- `ChatMessage`: user/agent/system messages, mentions, metadata, attachments,
  workflow card metadata.
- `ChatMessageQueue`: queued member work for continuation/backpressure.
- `ChatRun`: execution run with run index, run dir, log/output, token/model
  metadata, and file-change capture.
- `ChatPermission`, `ChatArtifact`, `ChatSkill`, `ChatAgentSkill`,
  `ChatWorkItem`: permissions, pinned artifacts, skill registry/assignment,
  and session-scoped work tracking.

### Chat Routes

Main routes are mounted under `/chat`:
- `/chat/sessions`: list/create.
- `/chat/sessions/{session_id}`: get/update/delete, archive/restore, stream,
  workspaces/changes, agents, queues, messages, work-items, team protocol,
  preset snapshots.
- `/chat/sessions/{session_id}/workflow/...`: plan generation, execution,
  review settings, pause all, transcripts, step input/interrupt/stop/approve/
  permission/retry, and action resolution.
- `/chat/sessions/{session_id}/worktree/...`: isolated worktree status,
  prepare, merge, discard, cleanup, retry cleanup, conflicts, resolve,
  continue, and abort.
- `/chat/agents`, `/chat/messages`, `/chat/skills`, `/chat/registry`,
  `/chat/builtin`, `/chat/runs/{run_id}/...`.

### Chat Runtime Storage

- Runtime files are under `<workspace>/.openteams/`.
- Chat context: `.openteams/context/<session_id>/messages.jsonl`.
- Shared blackboard/work records are also under the session context directory.
- Run records: `.openteams/runs/<session_id>/run_records/...`.
- Per-run context snapshots: `<run_dir>/context.jsonl`.
- Workflow transcripts/events live in DB tables, not flat files.

## Session Worktree Architecture

Session worktree isolation is opt-in through `ChatSession.worktree_mode =
isolated`. `inherit` and `disabled` keep legacy/main-workspace behavior.

Authoritative backend pieces:
- `crates/db/src/models/chat_session_worktree.rs`: DB row, status/mode/merge
  enums, typed snake_case `Display`, and compare-and-swap model helpers.
- `crates/services/src/services/session_worktree.rs`: only legal service-level
  state machine for worktree status transitions, Git merge/conflict handling,
  cleanup safety, and tests.
- `crates/services/src/services/worktree_manager.rs`: low-level git worktree
  add/remove helpers.
- `crates/server/src/routes/chat/worktree.rs`: HTTP API surface.

Lifecycle statuses:
`creating`, `active`, `dirty`, `merging`, `needs_conflict_resolution`,
`merged`, `cleanup_pending`, `cleanup_failed`, `archived`.

Important invariants:
- Treat `SessionWorktreeService` as the reducer for worktree state. Do not add
  ad-hoc status updates in route handlers or unrelated services.
- Status writes must use compare-and-swap helpers (`WHERE id = ? AND status = ?`)
  so duplicate actions cannot race.
- Wire values must be snake_case via the enum serde/`Display` implementation.
  Do not use `format!("{:?}", status).to_lowercase()`.
- Automated cleanup must not remove unmerged `creating`, `active`, `dirty`,
  `merging`, or `needs_conflict_resolution` worktrees. Only explicit discard
  can move unmerged worktrees toward cleanup.
- Conflict file paths must be validated as relative paths inside the target
  workspace before reading or writing.

Frontend worktree pieces:
- `frontend/src/hooks/useSessionWorktree.ts`.
- `frontend/src/components/source-control/SessionWorktreeBadge.tsx`.
- `frontend/src/components/source-control/WorktreeMergeConflictsView.tsx`.
- `frontend/src/components/IssueWorktreeSessionDialog.tsx`.

## Workflow Architecture

Workflow code lives under `crates/services/src/services/workflow/` and is
re-exported with names such as `workflow_orchestrator`, `workflow_runtime`, and
`workflow_compiler`.

Core layers:
1. **Truth source**: `chat_workflow_plans` and
   `chat_workflow_plan_revisions` store the React Flow plan JSON (`nodes`,
   `edges`, `viewport`, `loops`, policies). Plan JSON revisions are edited by
   lead/system code paths, not arbitrary user JSON writes.
2. **Compiler**: `workflow/compiler/` validates the plan and materializes
   executions, rounds, steps, step edges, loops, and agent sessions. Steps use
   stable `step_key` values.
3. **Orchestrator**: `workflow/orchestrator/` owns command handling, scheduler
   wakeups, step execution, retries/resume, plan control, transcript actions,
   projection, and the reducer.
4. **Reducer/projector**: `orchestrator/reducer.rs` is the legal writer for
   workflow runtime state. `orchestrator/projection.rs` and
   `workflow/runtime/` emit events/card projections used by the frontend.
5. **Frontend projection**: `frontend/src/components/workflow/` renders
   `ChatWorkflowCard`, `WorkflowWindow`, `WorkflowGraphBoard`, pending
   input/review/final-review cards, logs, and iteration feedback.

Current key statuses from `workflow_types.rs`:
- `WorkflowExecutionStatus`: `pending`, `running`, `failed`, `paused`,
  `recompiling`, `completed`, `waiting`.
- `WorkflowRoundStatus`: `running`, `waiting_user_acceptance`, `accepted`,
  `rejected`, `archived`.
- `WorkflowStepStatus`: `pending`, `ready`, `running`, `pre_completed`,
  `interrupt_requested`, `interrupted`, `waiting_input`, `waiting_review`,
  `blocked`, `revising`, `completed`, `failed`, `skipped`.
- `WorkflowLoopStatus`: `pending`, `running`, `waiting_review`, `passed`,
  `rejected`, `waiting_user`, `completed`, `failed`.

Workflow invariants:
- Do not bypass `workflow/orchestrator/reducer.rs` for runtime status changes.
- Guard state writes with the expected previous state where possible.
- Every meaningful workflow state transition should produce a typed
  `chat_workflow_events` row and update the card/runtime projection.
- Frontend controls must match backend-accepted states; do not expose controls
  that the route/reducer rejects.
- Wire-format status values must be serde snake_case/lowercase values. Prefer
  typed serde helpers such as `to_workflow_wire_value`; do not introduce new
  raw `Debug` lowercasing.
- Final acceptance is a user decision. Lead agents may summarize/review but
  should not complete the user-acceptance checkpoint on their own.

## Projects, Issues, and GitHub

- Project backend routes live in `crates/server/src/routes/projects.rs`,
  `project_source_control.rs`, and `project_github.rs`.
- Project services live under `crates/services/src/services/project/` and are
  re-exported from `services/mod.rs`.
- GitHub auth/issue/PR/audit/pending-operation logic lives under
  `crates/services/src/services/github/` and related DB models.
- Frontend project pages/components live in `frontend/src/pages/projects/`,
  `frontend/src/pages/Issue*.tsx`, `frontend/src/pages/Team*.tsx`, and
  `frontend/src/components/source-control/`.
- Source-control data should be scoped to the selected project/session/worktree
  and must not leak files from unrelated session roots.

## Shared Types

Rust structs/enums intended for the frontend should derive `TS` and be listed
in `crates/server/src/bin/generate_types.rs`.

Generated output:
- `shared/types.ts`.

Important generated groups:
- Chat/session: `ChatSession`, `CreateChatSession`, `UpdateChatSession`,
  `ChatAgent`, `ChatSessionAgent`, `ChatMessage`, `ChatRun`, queue types,
  skills, permissions, artifacts, work items.
- Worktrees: `ChatSessionWorktreeMode`, `SessionWorktree`,
  `SessionWorktreeStatus`, `SessionWorktreeMode`,
  `SessionWorktreeMergeOperation`, `MergeResult`.
- Workflow: plan/execution/round/step/loop/transcript/event/review/feedback
  types and runtime card projection types.
- Projects/GitHub/build stats: project, member, work item, delivery, source
  control, GitHub, model pricing, and token/cost statistic types.

Regenerate with:
```bash
pnpm run generate-types
```

Check generated types in CI style with:
```bash
pnpm run generate-types:check
```

Do not manually edit `shared/types.ts`.

## Build, Test, and Development Commands

Root package scripts currently include:
- Install: `pnpm install`
- Frontend dev: `pnpm run frontend:dev`
- Frontend build: `pnpm run frontend:build`
- Frontend type check: `pnpm run frontend:check`
- Backend dev watch: `pnpm run backend:dev:watch`
- Backend check: `pnpm run backend:check`
- Backend lint/clippy: `pnpm run backend:lint`
- Combined check: `pnpm run check`
- Combined lint: `pnpm run lint`
- Rust format: `pnpm run format`
- Rust format check: `pnpm run format:check`
- Generate TS types: `pnpm run generate-types`
- Check generated TS types: `pnpm run generate-types:check`
- Prepare SQLx offline cache: `pnpm run prepare-db`
- Check SQLx offline cache: `pnpm run prepare-db:check`
- Build local NPX package: `pnpm run build:npx`
- Pack web NPX alias: `pnpm run build:npx:alias`
- Desktop dev/build: `pnpm run desktop:dev` / `pnpm run desktop:build`

Notes:
- The root `format` script only runs `cargo fmt --all`; it does not run
  Prettier for the frontend.
- `frontend:check` runs `tsc --noEmit` through the frontend `lint` script.
- `backend:lint` runs clippy with `--features qa-mode`.
- The OpenTeams CLI under `openteams-cli/` is a separate Bun workspace; use
  its local scripts when changing that package.

## Coding Style

- Rust: use `rustfmt`, snake_case modules/functions, PascalCase types, and
  typed enums for persisted/wire state. Prefer small service methods with clear
  ownership over route-handler business logic.
- TypeScript/React: 2-space indentation, single quotes are common in frontend
  files, PascalCase components, camelCase variables/functions. Keep API shapes
  in `src/lib/api.ts` or generated shared types; UI-specific shapes belong in
  `src/types.ts` and mappers in `src/lib/mappers.ts`.
- Use existing service boundaries and frontend component patterns before adding
  new abstractions.
- Do not introduce broad refactors while fixing a scoped bug.
- Do not commit secrets or local `.env` values.

## Testing Guidelines

- Default to targeted verification. Use type checks, clippy, builds, or focused
  tests based on the risk of the change.
- Add or update tests for shared logic, protocol/state-machine behavior,
  migrations, security-sensitive code, workflow orchestration, worktree
  lifecycle, source-control scoping, and likely regressions.
- Workflow orchestrator tests live in
  `crates/services/src/services/workflow/orchestrator/tests.rs`.
- Session worktree tests live in
  `crates/services/src/services/session_worktree/tests.rs`.
- Frontend tests are colocated as `*.test.ts` / `*.test.tsx`; prefer focused
  tests for mappers, view models, source-control/worktree behavior, and API
  adapters.
- Run the narrowest meaningful command first; broaden to `pnpm run check`,
  `pnpm run lint`, or `cargo test --workspace` when touching shared behavior.

## Observability and Runtime Safety

- Workflow state transitions should be observable through
  `chat_workflow_events` and card/runtime projection updates.
- Reducer/state-machine rejections should log enough context to debug:
  execution/session/worktree id, from state, target state, and action.
- Chat runner changes should preserve run logs, activity lines, token/model
  metadata, and file-change capture.
- Source-control and worktree actions must use the resolved session/project
  workspace; avoid falling back to process cwd for user data operations.
- Internal `.openteams/` files are runtime artifacts, not user source files.

## Security and Config

- Use `.env` for local overrides. Important envs include `FRONTEND_PORT`,
  `BACKEND_PORT`, `HOST`, and `VK_ALLOWED_ORIGINS`.
- Dev ports/assets are managed by scripts under `scripts/`.
- SQLx offline cache files under `crates/db/.sqlx/` are part of backend CI and
  should be updated with schema/query changes.
- Plan JSON write permission remains restricted to lead/system code paths.
- Worktree merge/cleanup/discard endpoints must validate session ownership,
  paths, merge state, and conflict paths before mutating the filesystem.
