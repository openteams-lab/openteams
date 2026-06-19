// Smoke tests for source-control panel view model derivation.
//
// Run with:
//     pnpm exec tsx src/components/source-control/sourceControlViewModel.test.ts

import type { SessionSourceControlStatus, SourceControlFile } from "@/types";
import {
  buildSourceControlViewModel,
  sourceControlHasSharedFiles,
  sourceControlStatusLabel,
  sourceControlVisiblePaths,
} from "./sourceControlViewModel";

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

const file = (
  path: string,
  status: SourceControlFile["status"],
  shared = false,
): SourceControlFile => ({
  path,
  old_path: null,
  status,
  additions: 2,
  deletions: 1,
  has_diff: true,
  is_binary: false,
  is_too_large: false,
  shared,
  shared_session_ids: shared ? ["session-b"] : [],
  blocked_reason: shared ? "Also changed by another session" : null,
});

console.log("sourceControlViewModel");

const gitStatus: SessionSourceControlStatus = {
  mode: "git",
  workspace_id: "workspace-1",
  workspace_path: "E:/repo",
  branch: "main",
  head_sha: "abc123",
  changes: [file("src/App.tsx", "modified", true)],
  staged_changes: [file("src/lib.ts", "added")],
  external_staged_paths: [],
  operation_in_progress: null,
  detached_head: false,
  blocked_reason: null,
};

const gitModel = buildSourceControlViewModel(gitStatus);

check(
  "keeps git changes and staged changes in separate sections",
  gitModel.mode === "git" &&
    gitModel.sections.map((section) => section.id).join("|") ===
      "staged|changes" &&
    gitModel.sections[0].files[0].path === "src/lib.ts" &&
    gitModel.sections[1].files[0].path === "src/App.tsx",
  gitModel,
);

check(
  "derives batch actions for changes and staged sections",
  gitModel.sections[0].batchActions.map((action) => action.id).join("|") ===
    "unstage-all" &&
    gitModel.sections[1].batchActions.map((action) => action.id).join("|") ===
      "stage-all|discard-all",
  gitModel.sections,
);

check(
  "uses rendered staged paths as commit expectation",
  gitModel.canCommit &&
    sourceControlVisiblePaths(gitStatus.staged_changes).join("|") ===
      "src/lib.ts" &&
    gitModel.stagedPaths.join("|") === "src/lib.ts",
  gitModel,
);

check(
  "marks shared files for force confirmation",
  sourceControlHasSharedFiles(gitStatus.changes) &&
    !sourceControlHasSharedFiles(gitStatus.staged_changes),
  gitStatus,
);

const blockedCommit = buildSourceControlViewModel({
  ...gitStatus,
  external_staged_paths: ["README.md"],
});

check(
  "blocks commit when the real index has external staged paths",
  !blockedCommit.canCommit &&
    blockedCommit.commitDisabledReason ===
      "There are staged files outside this session.",
  blockedCommit,
);

const plainModel = buildSourceControlViewModel({
  mode: "plain",
  workspace_id: "workspace-plain",
  workspace_path: "E:/plain",
  reason: "not_git_repo",
  files: [file("notes.txt", "untracked")],
});

check(
  "plain mode exposes related files without git actions",
  plainModel.mode === "plain" &&
    plainModel.sections.length === 1 &&
    plainModel.sections[0].batchActions.length === 0 &&
    plainModel.sections[0].files[0].path === "notes.txt" &&
    !plainModel.canCommit,
  plainModel,
);

check(
  "maps source-control statuses to compact badges",
  [
    sourceControlStatusLabel("modified"),
    sourceControlStatusLabel("added"),
    sourceControlStatusLabel("deleted"),
    sourceControlStatusLabel("untracked"),
    sourceControlStatusLabel("renamed"),
  ].join("") === "MADUR",
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} sourceControlViewModel assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll sourceControlViewModel assertions passed.");
}
