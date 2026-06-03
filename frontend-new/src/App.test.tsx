// Smoke tests for wiring the shared project sidebar into the app shell.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/App.test.tsx
// Exits non-zero if any assertion fails.

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

console.log("App ProjectSidebar wiring");

const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const projectSidebarUsages = source.match(/<ProjectSidebar\b/g) ?? [];
const sidebarPropsMatches =
  source.match(/\{\.\.\.projectSidebarProps\}/g) ?? [];

check("imports ProjectSidebar", source.includes("import { ProjectSidebar }"));
check(
  "imports CreateAgentSessionModal",
  source.includes("import { CreateAgentSessionModal }"),
);
check(
  "does not keep legacy renderSidebarContent helper",
  !source.includes("renderSidebarContent"),
);
check(
  "renders ProjectSidebar for desktop and mobile containers",
  projectSidebarUsages.length === 2,
  projectSidebarUsages.length,
);
check(
  "shares one explicit sidebar props object across both containers",
  sidebarPropsMatches.length === 2,
  sidebarPropsMatches.length,
);
check(
  "passes active page through sidebar props",
  source.includes("activePage: activeAppPage"),
  source,
);
check(
  "passes active session through sidebar props",
  source.includes("activeSessionId"),
  source,
);
check(
  "passes workspace sessions through sidebar props",
  source.includes("sessions"),
  source,
);
check(
  "passes shell options through sidebar props",
  source.includes("shellOptions"),
  source,
);
check(
  "passes API project list through sidebar props",
  source.includes("projects,") && source.includes("selectedProjectId"),
  source,
);
check(
  "passes project create/select/edit/delete callbacks through sidebar props",
  source.includes("onProjectSelect: handleProjectSelect") &&
    source.includes("onCreateProject: handleCreateProject") &&
    source.includes("onUpdateProject: handleUpdateProject") &&
    source.includes("onDeleteProject: handleDeleteProject"),
  source,
);
check(
  "creates a blank session after project creation",
  source.includes("projectApi.createSession(project.id") &&
    source.includes("replaceActiveTab(createSessionTab(session.id))"),
  source,
);
check(
  "updates and deletes projects through project API",
  source.includes("projectApi.updateProject(projectId, data)") &&
    source.includes("projectApi.deleteProject(projectId)") &&
    source.includes("refreshProjects()"),
  source,
);
check(
  "passes page navigation callback through sidebar props",
  source.includes("onNavigate: handleSidebarNavigate"),
  source,
);
check(
  "passes session selection callback through sidebar props",
  source.includes("onSessionSelect: handleSidebarSessionSelect"),
  source,
);
check(
  "passes new-session primary action callback through sidebar props",
  source.includes("onPrimaryAction: handlePrimarySidebarAction"),
  source,
);
check(
  "opens create-agent modal from new session action",
  source.includes("setIsCreateSessionModalOpen(true)") &&
    source.includes('action.id === "new-session"'),
  source,
);
check(
  "renders CreateAgentSessionModal in the app shell",
  source.includes("<CreateAgentSessionModal"),
  source,
);
check(
  "passes workspace members into create-agent modal",
  source.includes("members={members}"),
  source,
);
check(
  "create-agent modal send toast includes selected member",
  source.includes("createSession.taskSentToast") &&
    source.includes("memberName"),
  source,
);
check(
  "desktop sidebar keeps ProjectSidebar inside desktop-only aside",
  source.includes("hidden md:block"),
);
check(
  "desktop sidebar width is state-driven",
  source.includes("desktopSidebarWidth") &&
    source.includes("style={{ width: desktopSidebarWidth }}"),
  source,
);
check(
  "desktop sidebar has draggable resize handle",
  source.includes('data-sidebar-resize-handle="true"') &&
    source.includes("onPointerDown={handleSidebarResizePointerDown}"),
  source,
);
check(
  "desktop sidebar resize line aligns with content frame gap",
  source.includes("absolute -right-3 top-3 bottom-3") &&
    source.includes("items-stretch justify-end"),
  source,
);
check(
  "desktop sidebar resize highlight is thick dark gray",
  source.includes("h-full w-1 rounded-full") &&
    source.includes("bg-[var(--hairline-tertiary)]"),
  source,
);
check(
  "sidebar resize is clamped to min and max widths",
  source.includes("minSidebarWidth") &&
    source.includes("maxSidebarWidth") &&
    source.includes("clampSidebarWidth"),
  source,
);
check(
  "sidebar resize listens to global pointer movement",
  source.includes('window.addEventListener("pointermove"') &&
    source.includes('window.addEventListener("pointerup"'),
  source,
);
check(
  "mobile drawer keeps ProjectSidebar inside mobile-only drawer",
  source.includes("md:hidden"),
);
check(
  "models top navigation with unified workspace tabs",
  source.includes("type WorkspaceTab"),
  source,
);
check(
  "replaces active tab for sidebar page navigation",
  source.includes("const replaceActiveTab") &&
    source.includes("replaceActiveTab(createPageTab(page, label))"),
  source,
);
check(
  "replaces active tab for sidebar session navigation",
  source.includes("replaceActiveTab(createSessionTab(sessionId))"),
  source,
);
check(
  "top tab bar is not limited to workspace sessions",
  !source.includes('{activeAppPage === "workspace" && ('),
  source,
);
check(
  "top tabs flex with available width",
  source.includes('flex: "1 1 clamp(7rem, 22%, 15rem)"'),
  source,
);
check(
  "top tabs no longer rely on count-based compression",
  !source.includes("shouldCompressTabs"),
  source,
);
check(
  "all tab pages share the same rounded content frame",
  source.includes(
    "rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)]",
  ),
  source,
);
check(
  "settings page fills the rounded content frame",
  source.includes('activeAppPage === "providers"') &&
    source.includes("overflow-hidden p-0"),
  source,
);
check(
  "imports non-session pages from pages directory",
  source.includes("@/pages/GitHubRepositoryPage") &&
    source.includes("@/pages/TeamPage") &&
    source.includes("@/pages/TeamTemplatesPage") &&
    source.includes("@/pages/SettingsPage"),
  source,
);
check(
  "does not inline non-session page workspaces in app shell",
  !source.includes("import { OnboardingPro }") &&
    !source.includes("import { SettingsWorkspace }") &&
    !source.includes("import { TokensWorkspace }"),
  source,
);
check(
  "renders GitHub repository placeholder page",
  source.includes('case "github"') &&
    source.includes("<GitHubRepositoryPage />"),
  source,
);
check(
  "renders team templates as a standalone page",
  source.includes('case "team-templates"') &&
    source.includes("<TeamTemplatesPage />"),
  source,
);
check(
  "renders DialogManager preview in the skill library tab",
  source.includes('case "tokens"') &&
    source.includes("<DialogManager preview />") &&
    source.includes('activeAppPage !== "tokens"'),
  source,
);
check(
  "project switcher no longer uses placeholder toast path",
  !source.includes('"project-switcher": t("toast.projectSwitcherPlaceholder")'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll App sidebar wiring assertions passed.");
}
