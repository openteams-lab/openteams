// Smoke tests for migration project display helpers.
//
// Run with:
//     pnpm exec tsx src/lib/projectDisplay.test.ts

import {
  isLegacyMigrationProject,
  projectDisplayDescription,
  projectDisplayName,
} from "./projectDisplay";

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

console.log("projectDisplay");

const migratedProject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "已迁移会话",
  description: "__migrate__:legacy_chat_sessions",
};
const regularProject = {
  id: "project-1",
  name: "API Project",
  description: "Loaded from project API",
};

check(
  "labels migrated projects as legacy sessions",
  projectDisplayName(migratedProject) === "旧版本会话",
);
check(
  "hides migration marker descriptions",
  projectDisplayDescription(migratedProject) === "",
);
check(
  "detects migrated projects",
  isLegacyMigrationProject(migratedProject),
);
check(
  "keeps regular project display text unchanged",
  projectDisplayName(regularProject) === "API Project" &&
    projectDisplayDescription(regularProject) === "Loaded from project API",
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} projectDisplay assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll projectDisplay assertions passed.");
}
