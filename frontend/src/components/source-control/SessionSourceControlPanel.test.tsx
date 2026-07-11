// Smoke tests for the session source-control panel source.
//
// Run with:
//     pnpm exec tsx src/components/source-control/SessionSourceControlPanel.test.tsx

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
  "delegates merge conflict resolution to the workspace tab opener",
  source.includes("onOpenConflictResolver:") &&
    source.includes("onOpenConflictResolver,") &&
    source.includes('case "resolve-conflicts":') &&
    source.includes("onOpenConflictResolver(projectId, sessionId)"),
  source,
);

check(
  "does not render conflict resolution as an overlay inside the panel",
  !source.includes("@/pages/worktree/WorktreeMergeConflictsSection") &&
    !source.includes("<WorktreeMergeConflictsSection") &&
    !source.includes("showConflictResolution"),
  source,
);

check(
  "does not keep panel-local conflict resolution state",
  !source.includes("conflictResolutionScopeKey") &&
    !source.includes("closeConflictResolutionForScope"),
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
  "disables worktree merge when there are no unmerged worktree commits",
  source.includes("const worktreeMergeDisabledReason =") &&
    source.includes("worktree?.has_unmerged_commits") &&
    source.includes('"worktree.reason.noUnmergedCommits"') &&
    source.includes('if (action === "merge" && worktreeMergeDisabledReason) return;') &&
    source.includes("mergeDisabledReason={worktreeMergeDisabledReason}"),
  source,
);

check(
  "refreshes worktree merge availability immediately after commit",
  source.includes("refresh: refreshWorktree") &&
    source.includes("await refreshWorktree();"),
);

{
  const confirmIndex = source.indexOf(
    'title: tr("worktree.confirm.deleteTitle", "Delete worktree?")',
  );
  const discardIndex = source.indexOf("await discardWorktree();");
  check(
    "confirms worktree delete before calling discard",
    confirmIndex >= 0 &&
      discardIndex > confirmIndex &&
      source.includes(
        '"worktree.confirm.deleteDescription"',
      ) &&
      source.includes('confirmLabel: tr("worktree.action.discard", "Delete")'),
    { confirmIndex, discardIndex },
  );
}

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
  "isolates commit message drafts by session scope",
  source.includes("type ScopedTextState = Record<string, string>") &&
    source.includes("commitMessagesByScope") &&
    source.includes('const commitMessage = commitMessagesByScope[scopeKey] ?? "";') &&
    source.includes("setCommitMessageForScope(scopeKey, event.target.value)") &&
    source.includes('setCommitMessageForScope(commitScopeKey, "");'),
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
  "does not retain the old panel-local conflict refresh helper",
  !source.includes("refreshAfterWorktreeResolution"),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} SessionSourceControlPanel assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll SessionSourceControlPanel assertions passed.");
}
