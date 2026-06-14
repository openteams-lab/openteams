// Smoke tests for TeamPage member/session-agent synchronization.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/pages/TeamPage.test.ts

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

console.log("TeamPage member removal");

const source = readFileSync(new URL("./TeamPage.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(
  new URL("./team/TeamMemberSidebar.tsx", import.meta.url),
  "utf8",
);
const removeProjectMemberIndex = source.indexOf(
  "await projectApi.removeMember(selectedProjectId, member.id)",
);
const removeSessionAgentIndex = source.indexOf(
  "await removeAgentFromProjectSessions(selectedProjectId, member.agent_id)",
);

check(
  "removes matching agent from every project session after project member deletion",
  source.includes("const removeAgentFromProjectSessions = async") &&
    source.includes("projectApi.listSessions(projectId)") &&
    source.includes("sessionAgentsApi.list(session.id)") &&
    source.includes("sessionMember.agent_id === agentId") &&
    source.includes("sessionAgentsApi.remove(session.id, sessionMember.id)") &&
    removeProjectMemberIndex >= 0 &&
    removeSessionAgentIndex > removeProjectMemberIndex,
  { removeProjectMemberIndex, removeSessionAgentIndex },
);

check(
  "loads and creates agents within the selected project scope",
  source.includes("chatAgentsApi.list({ projectId })") &&
    source.includes("owner_project_id: selectedProjectId"),
  { source },
);

check(
  "add member menu includes every runtime option by default",
  source.includes("const addableRuntimeOptions = useMemo(") &&
    source.includes("runners.map((runner) => ({") &&
    !source.includes(
      "runners\n        .filter((runner) => getRuntimeDisplayState(runner) === \"available\")\n        .map((runner) => ({",
    ) &&
    sidebarSource.includes("filteredRuntimeOptions.map((option) => (") &&
    sidebarSource.includes(
      "filteredAgents.length > 0 || filteredRuntimeOptions.length > 0",
    ) &&
    !sidebarSource.includes("const showRuntimeOptions") &&
    !sidebarSource.includes("showRuntimeOptions &&"),
  { source, sidebarSource },
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} TeamPage assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll TeamPage assertions passed.");
}
