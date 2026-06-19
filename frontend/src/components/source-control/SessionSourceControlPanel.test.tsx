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

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} SessionSourceControlPanel assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll SessionSourceControlPanel assertions passed.");
}
