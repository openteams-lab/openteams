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
const configTabsSource = readFileSync(
  new URL("./team/TeamConfigTabs.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const teamNavigationSource = readFileSync(
  new URL("../lib/teamNavigation.ts", import.meta.url),
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

check(
  "member invite navigation opens the team page add-member menu",
  appSource.includes("TEAM_MEMBER_INVITE_NAVIGATION_EVENT") &&
    appSource.includes('openPageTab("team", getPageTabLabel("team"))') &&
    source.includes("readTeamMemberInviteTarget()") &&
    source.includes("clearTeamMemberInviteTarget()") &&
    source.includes("setAddMemberMenuRequestId((current) => current + 1)") &&
    source.includes("openRequestKey={addMemberMenuRequestId}") &&
    sidebarSource.includes("openRequestKey?: number") &&
    sidebarSource.includes("setShowAddMenu(true)") &&
    teamNavigationSource.includes("window.sessionStorage.setItem") &&
    teamNavigationSource.includes("openteams:navigate-team-member-invite"),
  { appSource, source, sidebarSource, teamNavigationSource },
);

check(
  "team member configuration changes are auto-saved without a manual action footer",
  source.includes("const autoSaveDelayMs = 700") &&
    source.includes("memberAutoSaveTimerRef.current = window.setTimeout") &&
    source.includes("void saveMember()") &&
    source.includes("mcpAutoSaveTimerRef.current = window.setTimeout") &&
    source.includes("void applyMcpServers()") &&
    source.includes(
      "teamProtocolAutoSaveTimerRef.current = window.setTimeout",
    ) &&
    source.includes("void saveTeamProtocol()") &&
    !configTabsSource.includes("MemberSaveActions") &&
    !configTabsSource.includes("McpSaveActions") &&
    !configTabsSource.includes("TeamProtocolSaveActions") &&
    !configTabsSource.includes("shouldShowActionFooter") &&
    !configTabsSource.includes(
      'border-t border-[var(--hairline)] bg-[var(--surface-1)]',
    ),
  { source, configTabsSource },
);

check(
  "member name field keeps the inherited agent name as placeholder only",
  source.includes('memberName: member.member_name?.trim() ?? ""') &&
    source.includes(
      'selectedAgent?.name ?? t("teamPage.form.memberName")',
    ) &&
    configTabsSource.includes('autoComplete="off"') &&
    !source.includes(
      'memberName: member.member_name?.trim() || agent?.name?.trim() || ""',
    ),
  { source, configTabsSource },
);

check(
  "skill selection does not reload the installed skills list after save",
  source.includes(".listNative(runnerType)") &&
    source.includes("mcpServersApi\n      .load(runnerType)") &&
    source.includes("}, [runnerType, selectedMember?.id]);") &&
    !source.includes("}, [runnerType, selectedMember]);"),
  { source },
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} TeamPage assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll TeamPage assertions passed.");
}
