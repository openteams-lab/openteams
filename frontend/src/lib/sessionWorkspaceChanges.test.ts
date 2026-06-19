// Smoke tests for session workspace change normalization.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/lib/sessionWorkspaceChanges.test.ts

import type { WorkspaceChangesResponse } from "../types";
import {
  flattenWorkspaceChanges,
  hasRelatedFileDiff,
} from "./sessionWorkspaceChanges";

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

console.log("sessionWorkspaceChanges");

const response: WorkspaceChangesResponse = {
  workspace_path: "E:/workspace/demo",
  is_git_repo: true,
  error: null,
  changes: {
    modified: [
      {
        path: "src/App.tsx",
        additions: 4,
        deletions: 2,
        unified_diff: "@@ app diff",
        has_diff: true,
      },
    ],
    added: [
      {
        path: "src/new.ts",
        additions: 9,
        deletions: 0,
        unified_diff: "@@ added diff",
        has_diff: true,
      },
    ],
    deleted: [{ path: "src/old.ts" }],
    untracked: [
      {
        path: "notes.txt",
        additions: 3,
        deletions: 0,
        unified_diff: null,
        has_diff: false,
      },
    ],
  },
};

const files = flattenWorkspaceChanges(response);

check(
  "keeps all four change categories",
  files.map((file) => `${file.kind}:${file.path}`).join("|") ===
    "modified:src/App.tsx|added:src/new.ts|deleted:src/old.ts|untracked:notes.txt",
  files,
);

check(
  "maps status badges without collapsing untracked into added",
  files.map((file) => file.status).join("") === "MADU",
  files,
);

check(
  "detects usable inline diff only when both flag and diff text exist",
  hasRelatedFileDiff(files[0]) &&
    !hasRelatedFileDiff(files[2]) &&
    !hasRelatedFileDiff(files[3]),
  files,
);

check("returns an empty list for null data", flattenWorkspaceChanges(null).length === 0);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("\nAll session workspace change checks passed");
