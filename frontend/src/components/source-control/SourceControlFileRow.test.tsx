// Smoke tests for source-control file row source.
//
// Run with:
//     pnpm exec tsx src/components/source-control/SourceControlFileRow.test.tsx

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

console.log("SourceControlFileRow");

const source = readFileSync(
  new URL("./SourceControlFileRow.tsx", import.meta.url),
  "utf8",
);
const warningRenderCount =
  source.match(/<FileWarningIndicator file={file} t={t} \/>/g)?.length ?? 0;
const actionOverlayIndex = source.indexOf(
  "group-hover/source-file:pointer-events-auto",
);
const hoverWarningIndex = source.indexOf(
  "<FileWarningIndicator file={file} t={t} />",
  actionOverlayIndex,
);

check(
  "renders the file warning in both the idle metadata and hover action areas",
  warningRenderCount === 2 && hoverWarningIndex > actionOverlayIndex,
  { warningRenderCount, actionOverlayIndex, hoverWarningIndex },
);

check(
  "keeps shared-session warning copy on the badge",
  source.includes("Shared with another active session") &&
    source.includes("file.shared ? \"text-amber-500\" : \"text-rose-500\""),
  source,
);

check(
  "resolves file-row hover title to the workspace absolute path",
  source.includes("resolveLocalPathToAbsolutePath(file.path, viewModel.workspacePath)") &&
    source.includes("title={fullPath}"),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} SourceControlFileRow assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll SourceControlFileRow assertions passed.");
}
