// Smoke tests for the session source-control panel source.
//
// Run with:
//     pnpm exec tsx src/components/source-control/SessionSourceControlPanel.test.tsx

import { readFileSync } from "node:fs";
import { refreshAfterWorktreeResolution } from "./SessionSourceControlPanel";

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

console.log("SessionSourceControlPanel");

const source = readFileSync(
  new URL("./SessionSourceControlPanel.tsx", import.meta.url),
  "utf8",
);

check(
  "hides the session commits list when there are no commits",
  source.includes("if (commits.length === 0) return null;") &&
    !source.includes("No commits yet"),
  source,
);

check(
  "keeps the session commits list transparent",
  source.includes('className="rounded-md text-[11px]"') &&
    !source.includes(
      'className="rounded-md bg-[var(--surface-1)] text-[11px]"',
    ),
  source,
);

check(
  "accepts a worktreeMode prop",
  source.includes("worktreeMode?: ChatSessionWorktreeMode") &&
    source.includes("worktreeMode,"),
  source,
);

check(
  "uses the session worktree hook only when isolated",
  source.includes('const worktreeEnabled = worktreeMode === "isolated";') &&
    source.includes("useSessionWorktree") &&
    source.includes("enabled: worktreeEnabled && enabled"),
  source,
);

check(
  "renders the worktree badge conditionally",
  source.includes("{worktreeEnabled && (") &&
    source.includes("<SessionWorktreeBadge"),
  source,
);

check(
  "renders the ui-new merge history section for merged worktrees",
  source.includes("@/pages/worktree/WorktreeMergeHistorySection") &&
    source.includes("<WorktreeMergeHistorySection") &&
    source.includes("showWorktreeHistory"),
  source,
);

check(
  "does not render worktree UI when worktree is not enabled",
  source.includes('worktreeMode === "isolated"'),
  source,
);

check(
  "renders the ui-new merge conflicts section when conflict resolution is active",
  source.includes("@/pages/worktree/WorktreeMergeConflictsSection") &&
    source.includes("<WorktreeMergeConflictsSection") &&
    source.includes("showConflictResolution") &&
    source.includes('worktree?.status === "needs_conflict_resolution"') &&
    source.includes("onClose={() => closeConflictResolutionForScope(scopeKey)}"),
  source,
);

check(
  "renders conflict resolution as an overlay instead of replacing the panel",
  !source.includes("When the user opens the conflict resolver, it takes over") &&
    source.includes("</div>") &&
    source.includes("{showConflictResolution &&"),
  source,
);

check(
  "auto-exits conflict resolution when status changes away from needs_conflict_resolution",
  source.includes(
    'worktree?.status !== "needs_conflict_resolution"',
  ) && source.includes("closeConflictResolutionForScope(scopeKey)"),
  source,
);

check(
  "wires worktree actions through handleWorktreeAction",
  source.includes("handleWorktreeAction") &&
    source.includes('"prepare"') &&
    source.includes('"merge"') &&
    source.includes('"discard"') &&
    source.includes('"cleanup"') &&
    source.includes('"retry-cleanup"') &&
    source.includes('"resolve-conflicts"') &&
    source.includes('"view-history"'),
  source,
);

check(
  "displays worktree action errors alongside source-control errors",
  source.includes("worktreeActionError") &&
    source.includes("viewModel.blockedReason || actionError || worktreeActionError") &&
    source.includes("select-text whitespace-pre-wrap break-words"),
  source,
);

check(
  "isolates source-control errors by session scope",
  source.includes("type ScopedErrorState = Record<string, string>") &&
    source.includes("actionErrorsByScope") &&
    source.includes("worktreeActionErrorsByScope") &&
    source.includes("scopedError(actionErrorsByScope, scopeKey)") &&
    source.includes("scopedError(worktreeActionErrorsByScope, scopeKey)") &&
    source.includes("updateScopedError(current, key, message)"),
  source,
);

check(
  "records late async errors under their original session scope",
  source.includes("const actionScopeKey = scopeKeyRef.current") &&
    source.includes("const operationScopeKey = scopeKeyRef.current") &&
    source.includes("scopeKeyRef.current === key") &&
    source.includes("setWorktreeActionErrorForScope(actionScopeKey, message)") &&
    source.includes("setActionErrorForScope(operationScopeKey"),
  source,
);

check(
  "confirms staged shared files before commit",
  source.includes('const stagedSection = findSection(viewModel, "staged")') &&
    source.includes("const stagedFiles = stagedSection?.files ?? []") &&
    source.includes("const forceShared = await getSharedForce(stagedFiles, commitLabel)") &&
    source.includes("force_shared: forceShared || undefined"),
  source,
);

check(
  "refreshes source-control after conflict resolution completes",
  source.includes("onCompleted") &&
    source.includes("closeConflictResolutionForScope(scopeKey)") &&
    source.includes("refreshAfterWorktreeResolution"),
  source,
);

{
  let sourceRefreshes = 0;
  let worktreeRefreshes = 0;
  await refreshAfterWorktreeResolution(
    async () => {
      sourceRefreshes += 1;
    },
    async () => {
      worktreeRefreshes += 1;
    },
  );
  check(
    "refresh helper refreshes source-control and worktree state",
    sourceRefreshes === 1 && worktreeRefreshes === 1,
    { sourceRefreshes, worktreeRefreshes },
  );
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} SessionSourceControlPanel assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll SessionSourceControlPanel assertions passed.");
}
