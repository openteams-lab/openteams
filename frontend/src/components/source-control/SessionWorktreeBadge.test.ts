// Tests for the session worktree badge action gating.
//
// The badge must only render action buttons for backend-accepted statuses.
// This is security-sensitive: showing a "delete" button on an unmerged
// worktree, or a "merge" button on a merged one, would let the UI fire a
// request the reducer must reject.
//
// Run with:
//     pnpm exec tsx src/components/source-control/SessionWorktreeBadge.test.ts

import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? "");
  }
};

console.log("SessionWorktreeBadge");

const source = readFileSync(
  new URL("./SessionWorktreeBadge.tsx", import.meta.url),
  "utf8",
);

// Extract the ALLOWED_ACTIONS mapping from the source and verify the
// status sets match the backend reducer's accepted transitions.
const allowedActionsMatch = source.match(
  /ALLOWED_ACTIONS[^{]*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s,
);

check(
  "defines ALLOWED_ACTIONS gating map",
  Boolean(allowedActionsMatch),
  "ALLOWED_ACTIONS not found",
);

check(
  "prepare action is hidden during normal automatic creation",
  source.includes("prepare: []") &&
    !source.includes("onAction('prepare')"),
);

check(
  "merge only allowed in active and dirty states",
  source.includes("merge: ['active', 'dirty']"),
);

check(
  "discard allowed in active, dirty, needs_conflict_resolution, merging, merged",
  source.includes("discard: [") &&
    source.includes("'active'") &&
    source.includes("'dirty'") &&
    source.includes("'needs_conflict_resolution'") &&
    source.includes("'merging'") &&
    source.includes("'merged'"),
);

check(
  "cleanup action is hidden; merged worktrees are removed through discard",
  source.includes("cleanup: []") && !source.includes("onAction('cleanup')"),
);

check(
  "view-history only allowed in merged state",
  source.includes("'view-history': ['merged']"),
);

check(
  "retry-cleanup only allowed in cleanup_failed state",
  source.includes("'retry-cleanup': ['cleanup_failed']"),
);

check(
  "force-remove only allowed in cleanup_failed state",
  source.includes("'force-remove': ['cleanup_failed']"),
);

check(
  "force-remove button requires a process-lock cleanup error",
  source.includes("isProcessLockedCleanupError(worktree?.cleanup_error)") &&
    source.includes("os error 32") &&
    source.includes("进程无法访问") &&
    source.includes("onAction('force-remove')"),
);

check(
  "resolve-conflicts only allowed in needs_conflict_resolution state",
  source.includes(
    "'resolve-conflicts': ['needs_conflict_resolution']",
  ),
);

// Verify the badge does NOT render for sessions without worktree enabled.
// The panel must guard the badge with a worktreeEnabled check.
check(
  "pendingCreate shows pending tone when no worktree row exists",
  source.includes("if (!worktree || pendingCreate)") &&
    source.includes("tone: 'pending'"),
);

check(
  "uses ui-new worktree action button",
  source.includes("@/components/worktree/WorktreeActionButton") &&
    source.includes("<WorktreeActionButton"),
);

check(
  "uses FolderGit2 for worktree identity states",
  source.includes("FolderGit2") &&
    source.includes('<FolderGit2 className="h-3 w-3 text-[var(--ink-tertiary)]"') &&
    source.includes('<FolderGit2 className="h-3 w-3 text-[var(--primary)]"'),
);

// Verify all backend statuses are mapped in badgeConfigFor.
const statuses = [
  "creating",
  "active",
  "dirty",
  "merging",
  "needs_conflict_resolution",
  "merged",
  "cleanup_pending",
  "cleanup_failed",
  "archived",
];
for (const status of statuses) {
  check(
    `maps status '${status}'`,
    source.includes(`case '${status}':`),
    `Missing case for status '${status}'`,
  );
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} SessionWorktreeBadge assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll SessionWorktreeBadge assertions passed.");
}
