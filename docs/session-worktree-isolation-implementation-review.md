# Session Worktree Isolation Implementation Review

Review basis: `docs/session-worktree-isolation-design.md` and current working tree.

## Verdict

Partially compliant after the current repair pass. The core Phase 1 path is present: session-level opt-in, DB model, lazy creation before runner fallback, source-control workspace switching, squash merge, in-app conflict routes/UI, discard, cleanup, retry, and generated shared types. The blocking smoke-test failures found during review were fixed; the remaining items below are design-completeness gaps rather than the basic unusable path.

## Findings

1. Medium: post-merge agent runs fall back to main workspace rather than presenting the explicit user choice required by the design.
   - Design: after `merged`, a later run in the same session must require `Continue in main workspace` or `Create new worktree from current main`.
   - Current code: `ChatRunner::resolve_workspace_path_for_agent` now reads the latest worktree row first. Active rows use the worktree; terminal rows use their recorded base workspace and no longer silently create a fresh worktree. The remaining gap is the missing explicit UI choice to create a new post-merge worktree.
   - References: `crates/services/src/services/chat_runner/prompting.rs:25`, `crates/services/src/services/chat_runner/tests.rs`.

2. High: archive/delete does not apply the worktree cleanup policy.
   - Design: session archive/delete should trigger a safe cleanup policy; archive is not equivalent to deleting an unmerged worktree.
   - Current code: `archive_session` and `delete_session` update/delete the chat session directly and do not call `SessionWorktreeService` or mark any worktree `cleanup_pending`/`archived`.
   - References: `crates/server/src/routes/chat/sessions.rs:114`, `crates/server/src/routes/chat/sessions.rs:1871`.

3. Medium: startup reconciliation is not implemented.
   - Design: app startup should reconcile DB rows, missing directories, stale directories, and Git worktree metadata.
   - Current code: there are cleanup/discard/retry paths, but no startup reconciliation service for `chat_session_worktrees`; `touch_last_used` also has no caller.
   - References: `crates/db/src/models/chat_session_worktree.rs:565`, no `touch_last_used` call sites.

4. Medium: `dirty` status is mostly a declared state, not an observed state.
   - Design: UI/state model distinguishes `active` and `dirty`.
   - Current code: merge/discard allow both, but there is no normal source-control or runner path that transitions an active worktree to `dirty` when Git status becomes dirty. The UI still works because actions are allowed for `active`, but the persisted state is less accurate than the design.
   - References: `crates/services/src/services/session_worktree.rs:258`, no normal `Active -> Dirty` call sites outside abort/error handling.

5. Medium: explicit per-agent workspace can bypass session isolation.
   - Design: Phase 1 uses one shared session worktree for all session agents.
   - Current code: `resolve_workspace_path_for_agent` returns `session_agent_workspace_path` before checking `worktree_mode`. New isolated project sessions avoid backfilling this path, but any explicit per-agent workspace still bypasses the isolated session worktree.
   - References: `crates/services/src/services/chat_runner/prompting.rs:10`.

## Confirmed Matches

- Session-level `worktree_mode: inherit | disabled | isolated` exists and is generated to shared types.
- `SessionWorktreeService` is the main reducer for status transitions and uses CAS-style model helpers.
- Runner lazy creation before default workspace fallback is implemented for isolated sessions.
- Source-control resolves active worktree path first and switches back to base workspace for terminal/audit states.
- Merge uses squash semantics, auto-commits worktree changes, persists `needs_conflict_resolution`, and does not delete the worktree on conflicts.
- App conflict UI supports listing conflicts, reading stage-based content, resolving, continuing, and aborting.
- Merged cleanup and discard use `WorktreeManager::cleanup_worktree` and preserve `cleanup_failed` for retry.

## Verification Run During Review

- `pnpm -C frontend exec tsx src/lib/chatSessionsApi.test.ts`
- `pnpm run frontend:check`
- `cargo test -p services resolve_workspace_path_for_merged_isolated_session_returns_base_workspace`
- `cargo test -p services select_workspace_path`
- `cargo test -p server --test worktree_integration_smoke session_worktree_routes_cover_main_merge_conflict_and_cleanup_flows -- --nocapture`
- `pnpm run generate-types`
- `pnpm run backend:check`
- `pnpm run check`

Verification in this workspace exposed and fixed these integration issues:
- frontend workspace validation URL now uses `/api/chat/validate-workspace-path`.
- project-session creation now returns `pinned_at` in the `ChatSession` row.
- project-session creation now persists the requested `worktree_mode`.
- isolated project sessions no longer backfill per-agent workspace paths that bypass lazy worktree resolution.
- conflict detail/resolve endpoints now support nested file paths and the body-based resolve contract used by the frontend.
- post-merge isolated sessions no longer auto-create a new worktree on the next run.
