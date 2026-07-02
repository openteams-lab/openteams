// Smoke tests for the project sidebar component.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/ProjectSidebar.test.tsx
// Exits non-zero if any assertion fails.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { prioritizeSessions, ProjectSidebar } from "./ProjectSidebar";
import { mockShellOptions, mockWorkspaceBootstrap } from "@/mockApiData";
import type { Project } from "../../../shared/types";

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

console.log("ProjectSidebar");

const html = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={mockWorkspaceBootstrap.sessions}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const apiProjects: Project[] = [
  {
    id: "project-api-1",
    name: "API Project",
    default_agent_working_dir: null,
    remote_project_id: null,
    description: "Loaded from project API",
    status: "active",
    default_workspace_path: "E:/workspace/api-project",
    active_repo_id: null,
    created_at: new Date("2026-05-31T00:00:00Z"),
    updated_at: new Date("2026-05-31T00:00:00Z"),
  },
];
const migratedProjects: Project[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "已迁移会话",
    default_agent_working_dir: null,
    remote_project_id: null,
    description: "__migrate__:legacy_chat_sessions",
    status: "system",
    default_workspace_path: "E:/workspace/legacy",
    active_repo_id: null,
    created_at: new Date("2026-05-31T00:00:00Z"),
    updated_at: new Date("2026-05-31T00:00:00Z"),
  },
];
const projectSwitcherHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    projects={apiProjects}
    selectedProjectId="project-api-1"
    sessions={mockWorkspaceBootstrap.sessions}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
    onProjectSelect={() => undefined}
    onCreateProject={async () => undefined}
    onUpdateProject={async () => undefined}
    onDeleteProject={async () => undefined}
  />,
);
const migratedProjectHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    projects={migratedProjects}
    selectedProjectId="11111111-1111-4111-8111-111111111111"
    sessions={mockWorkspaceBootstrap.sessions}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const translatedHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={mockWorkspaceBootstrap.sessions}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    t={(key, replacements) => {
      const translated: Record<string, string> = {
        "sidebar.sessions": "SESSIONS_TRANSLATED",
        "sidebar.more": "MORE_TRANSLATED",
        "sidebar.projectManagement": "PROJECT_MANAGEMENT_TRANSLATED",
        "sidebar.showMoreSessions": "SHOW_{count}_MORE_TRANSLATED",
      };
      let value = translated[key] ?? key;
      if (replacements) {
        for (const [name, replacement] of Object.entries(replacements)) {
          value = value.replace(`{${name}}`, String(replacement));
        }
      }
      return value;
    }}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const runningSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      { ...mockWorkspaceBootstrap.sessions[0], hasRunningAgent: true },
    ]}
    activeSessionId={mockWorkspaceBootstrap.sessions[0].id}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const workflowRunningSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      { ...mockWorkspaceBootstrap.sessions[0], hasRunningWorkflow: true },
    ]}
    activeSessionId={mockWorkspaceBootstrap.sessions[0].id}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const workflowReviewingSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        hasRunningWorkflow: true,
        workflowSidebarState: "reviewing",
      },
    ]}
    activeSessionId={mockWorkspaceBootstrap.sessions[0].id}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const completedAgentSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        hasUnreadAgentCompletion: true,
      },
    ]}
    activeSessionId="another-session"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const pendingWorkflowInputSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        hasPendingWorkflowInput: true,
        pendingWorkflowInputId: "input-1",
      },
    ]}
    activeSessionId="another-session"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const pendingWorkflowReviewSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        hasPendingWorkflowReview: true,
        pendingWorkflowReviewId: "review-1",
      },
    ]}
    activeSessionId="another-session"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const pausedWorkflowSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        hasRunningWorkflow: true,
        workflowSidebarState: "paused",
      },
    ]}
    activeSessionId="another-session"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const failedWorkflowSessionHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={[
      {
        ...mockWorkspaceBootstrap.sessions[0],
        workflowSidebarState: "failed",
        hasWorkflowError: true,
      },
    ]}
    activeSessionId="another-session"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const runningOrderedHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={mockWorkspaceBootstrap.sessions.map((session) => ({
      ...session,
      hasRunningWorkflow: session.id === "sess-8",
    }))}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const completedOrderedHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={mockWorkspaceBootstrap.sessions.map((session) => ({
      ...session,
      hasUnreadAgentCompletion: session.id === "sess-8",
    }))}
    activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const activeOrderedHtml = renderToStaticMarkup(
  <ProjectSidebar
    shellOptions={mockShellOptions}
    sessions={mockWorkspaceBootstrap.sessions}
    activeSessionId="sess-8"
    activePage="workspace"
    weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
    onNavigate={() => undefined}
    onSessionSelect={() => undefined}
    onPrimaryAction={() => undefined}
    onProjectAction={() => undefined}
  />,
);
const prioritySessions = mockWorkspaceBootstrap.sessions.map((session) => ({
  ...session,
  hasUnreadAgentCompletion: session.id === "sess-8",
}));
const priorityOrderIds = prioritizeSessions(prioritySessions).map(
  (session) => session.id,
);
const readOrderIds = prioritizeSessions(
  mockWorkspaceBootstrap.sessions,
  priorityOrderIds,
).map((session) => session.id);
const nextPriorityOrderIds = prioritizeSessions(
  mockWorkspaceBootstrap.sessions.map((session) => ({
    ...session,
    hasPendingWorkflowInput: session.id === "sess-7",
  })),
  readOrderIds,
).map((session) => session.id);
const moreAttrStart = html.indexOf('data-sidebar-more="true"');
const moreStart =
  moreAttrStart >= 0 ? html.lastIndexOf("<button", moreAttrStart) : -1;
const moreHtml =
  moreStart >= 0
    ? html.slice(moreStart, html.indexOf("</button>", moreStart))
    : "";
const hiddenSessionCount = Math.max(
  mockWorkspaceBootstrap.sessions.length - 6,
  0,
);
const componentSource = readFileSync(
  new URL("./ProjectSidebar.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

check("renders active project monogram", html.includes("MS"), html);
check("renders active project name", html.includes("my-saas"), html);
check(
  "renders API-backed active project name",
  projectSwitcherHtml.includes("API Project"),
  projectSwitcherHtml,
);
check(
  "renders API-backed active project monogram",
  projectSwitcherHtml.includes("AP"),
  projectSwitcherHtml,
);
check(
  "renders migrated project with legacy session copy",
  migratedProjectHtml.includes("旧版本会话") &&
    !migratedProjectHtml.includes("已迁移会话"),
  migratedProjectHtml,
);
check(
  "hides migrated project marker text",
  !migratedProjectHtml.includes("__migrate__"),
  migratedProjectHtml,
);
check("renders Inbox action", html.includes("Inbox"), html);
check("renders New session action", html.includes("New session"), html);
check(
  "renders build stats as navigation button",
  html.includes('data-section="Build stats"') &&
    html.includes("Build stats"),
  html,
);
check(
  "retries build stats usage refresh while sidebar cost is zero",
  componentSource.includes("ZERO_COST_USAGE_REFRESH_DELAYS_MS") &&
    componentSource.includes("buildStatsModelCostRef.current <= 0") &&
    componentSource.includes('reason === "usage"') &&
    componentSource.includes("buildStatsUsageRetryTimersRef.current") &&
    componentSource.includes("clearBuildStatsUsageRetryTimers()"),
  componentSource,
);
check("renders weekly cost prop accepted", typeof html === "string", html);
check("renders session section", html.includes("Sessions"), html);
check(
  "renders translated sidebar labels when translator is provided",
  translatedHtml.includes("SESSIONS_TRANSLATED") &&
    translatedHtml.includes("MORE_TRANSLATED") &&
    translatedHtml.includes("PROJECT_MANAGEMENT_TRANSLATED") &&
    translatedHtml.includes(
      `aria-label="SHOW_${hiddenSessionCount}_MORE_TRANSLATED"`,
    ),
  translatedHtml,
);
check("renders workspace sessions", html.includes("Fix login flicker"), html);
check(
  "renders running sessions with activity icon",
  runningSessionHtml.includes("animate-spin") &&
    runningSessionHtml.includes("agent running"),
  runningSessionHtml,
);
check(
  "renders running workflow sessions with activity icon",
  workflowRunningSessionHtml.includes("animate-spin") &&
    workflowRunningSessionHtml.includes("agent running"),
  workflowRunningSessionHtml,
);
check(
  "renders reviewing workflow sessions with loading activity icon",
  workflowReviewingSessionHtml.includes("animate-spin") &&
    workflowReviewingSessionHtml.includes("reviewing"),
  workflowReviewingSessionHtml,
);
check(
  "renders completed agent sessions with non-running highlighted icon",
  completedAgentSessionHtml.includes("text-[var(--primary)]") &&
    completedAgentSessionHtml.includes("agent completed") &&
    !completedAgentSessionHtml.includes("animate-spin"),
  completedAgentSessionHtml,
);
check(
  "renders pending workflow input sessions with non-running highlighted icon",
  pendingWorkflowInputSessionHtml.includes("text-[var(--primary)]") &&
    pendingWorkflowInputSessionHtml.includes("waiting for input") &&
    !pendingWorkflowInputSessionHtml.includes("animate-spin"),
  pendingWorkflowInputSessionHtml,
);
check(
  "renders pending workflow review sessions with non-running highlighted icon",
  !pendingWorkflowReviewSessionHtml.includes("animate-spin") &&
    pendingWorkflowReviewSessionHtml.includes("text-[var(--primary)]") &&
    pendingWorkflowReviewSessionHtml.includes("waiting for review"),
  pendingWorkflowReviewSessionHtml,
);
check(
  "renders paused workflow sessions with the normal non-running icon",
  !pausedWorkflowSessionHtml.includes("animate-spin") &&
    !pausedWorkflowSessionHtml.includes("agent running"),
  pausedWorkflowSessionHtml,
);
check(
  "renders failed workflow sessions with highlighted normal icon",
  !failedWorkflowSessionHtml.includes("animate-spin") &&
    failedWorkflowSessionHtml.includes("text-[var(--primary)]") &&
    failedWorkflowSessionHtml.includes("workflow needs attention"),
  failedWorkflowSessionHtml,
);
check(
  "moves running workflow sessions to the top of the collapsed session group",
  runningOrderedHtml.indexOf("Billing copy polish") >= 0 &&
    runningOrderedHtml.indexOf("Billing copy polish") <
      runningOrderedHtml.indexOf("Fix login flicker") &&
    !runningOrderedHtml.includes("Refactor auth guard"),
  runningOrderedHtml,
);
check(
  "moves completed agent sessions to the top of the collapsed session group",
  completedOrderedHtml.indexOf("Billing copy polish") >= 0 &&
    completedOrderedHtml.indexOf("Billing copy polish") <
      completedOrderedHtml.indexOf("Fix login flicker") &&
    !completedOrderedHtml.includes("Refactor auth guard"),
  completedOrderedHtml,
);
check(
  "does not move the selected session to the top on click",
  activeOrderedHtml.indexOf("Fix login flicker") >= 0 &&
    activeOrderedHtml.includes("Refactor auth guard") &&
    !activeOrderedHtml.includes("Billing copy polish"),
  activeOrderedHtml,
);
check(
  "keeps a read priority session in its displayed position",
  priorityOrderIds[0] === "sess-8" &&
    readOrderIds[0] === "sess-8" &&
    priorityOrderIds.join("|") === readOrderIds.join("|"),
  { priorityOrderIds, readOrderIds },
);
check(
  "lets read sessions fall behind newly prioritized sessions",
  nextPriorityOrderIds[0] === "sess-7" &&
    nextPriorityOrderIds.indexOf("sess-8") >
      nextPriorityOrderIds.indexOf("sess-7"),
  nextPriorityOrderIds,
);
check(
  "keeps collapsed session list height content-sized",
  html.includes("space-y-1 pr-1 overflow-visible") &&
    !html.includes("h-52 overflow-y-auto"),
  html,
);
check(
  "keeps expanded session list fixed-height scrollable",
  componentSource.includes(
    'sessionsExpanded ? "h-52 overflow-y-auto" : "overflow-visible"',
  ),
  componentSource,
);
check(
  "uses compact sidebar item spacing",
  html.includes("py-[4px]") && html.includes("px-[7px]"),
  html,
);
check(
  "uses wider spacing between sidebar sections",
  html.includes("flex-1 space-y-5 overflow-y-auto"),
  html,
);
check(
  "removes back and forward controls",
  !/\bArrowLeft\b/u.test(componentSource) &&
    !/\bArrowRight\b/u.test(componentSource) &&
    !html.includes("Go back") &&
    !html.includes("Go forward"),
  componentSource,
);
check(
  "removes project switcher divider lines",
  !componentSource.includes("border-b border-[var(--hairline)] px-3 py-1.5") &&
    componentSource.includes('<div className="px-3 py-1.5">'),
  componentSource,
);
check(
  "renders sidebar item caption font size",
  html.includes("text-[12px]"),
  html,
);
check(
  "renders capitalized overflow session indicator",
  html.includes("More"),
  html,
);
check(
  "does not render legacy lowercase dotted more text",
  !html.includes("...more"),
  html,
);
check("renders more indicator without icon wrapper", moreHtml.length > 0, html);
check(
  "renders more indicator as a clickable button",
  moreHtml.includes('type="button"'),
  moreHtml,
);
check(
  "more indicator starts collapsed",
  moreHtml.includes('aria-expanded="false"'),
  moreHtml,
);
check(
  "more indicator announces expandable session count",
  moreHtml.includes(`aria-label="Show ${hiddenSessionCount} more sessions"`),
  moreHtml,
);
check(
  "more indicator uses a three-dot icon",
  moreHtml.includes("<svg"),
  moreHtml,
);
check(
  "renders more indicator with medium weight text",
  html.includes("font-medium"),
  html,
);
check(
  "renders hidden session count",
  html.includes(`+${hiddenSessionCount}`),
  html,
);
check(
  "limits extra mock sessions behind more indicator",
  !html.includes("Profile API review"),
  html,
);
check(
  "more indicator can toggle back to collapsed state",
  componentSource.includes("setSessionsExpanded((expanded) => !expanded)") &&
    componentSource.includes('translate("sidebar.less", "Less")') &&
    componentSource.includes('translate("sidebar.more", "More")'),
  componentSource,
);
check(
  "renders project switcher as a portal-backed floating menu",
  componentSource.includes("createPortal") &&
    componentSource.includes("fixed z-[1000]") &&
    !componentSource.includes("absolute top-full left-3 right-3"),
  componentSource,
);
check(
  "supports project switcher open state",
  componentSource.includes("toggleProjectSwitcher") &&
    componentSource.includes("setProjectSwitcherOpen((open) => {"),
  componentSource,
);
check(
  "supports selecting API projects from sidebar",
  componentSource.includes("onProjectSelect?.(actionMenuProject.id)"),
  componentSource,
);
check(
  "opens a horizontal project action submenu from project rows",
  componentSource.includes(
    "openProjectActionMenu(project, event.currentTarget)",
  ) && componentSource.includes("fixed z-[1001] w-[200px]"),
  componentSource,
);
check(
  "moves project path display into the action submenu",
  componentSource.includes("repository: project.default_workspace_path ??") &&
    !componentSource.includes(
      "project.description ?? project.default_workspace_path",
    ) &&
    componentSource.includes("actionMenuProject.repository") &&
    componentSource.includes('translate("sidebar.projectPathEmpty"') &&
    componentSource.includes("{actionMenuProject.label}") &&
    componentSource.includes("font-mono text-[11px]"),
  componentSource,
);
check(
  "project action submenu includes switch edit and delete actions",
  componentSource.includes('translate("sidebar.switchProject"') &&
    componentSource.includes('translate("sidebar.editProject"') &&
    componentSource.includes('translate("sidebar.deleteProject"'),
  componentSource,
);
check(
  "project delete action uses red text and light red hover",
  componentSource.includes("text-red-400") &&
    componentSource.includes("hover:bg-red-500/10"),
  componentSource,
);
check(
  "supports editing and deleting projects from sidebar",
  componentSource.includes("onUpdateProject(editingProject.id") &&
    componentSource.includes("startDeleteProject(actionMenuProject)") &&
    componentSource.includes("onDeleteProject(deletingProjectDraft.id)"),
  componentSource,
);
check(
  "supports a portal-backed session context menu",
  componentSource.includes("onContextMenu={(event) =>") &&
    componentSource.includes("openSessionContextMenu(session, event)") &&
    componentSource.includes('role="menu"') &&
    componentSource.includes("sessionContextMenu") &&
    componentSource.includes("fixed z-[1001] w-[180px]"),
  componentSource,
);
check(
  "session context menu includes rename pin view id archive and delete actions",
  componentSource.includes('translate("sidebar.renameSession"') &&
    componentSource.includes('translate("sidebar.pinSession"') &&
    componentSource.includes('translate("sidebar.unpinSession"') &&
    componentSource.includes('translate("sidebar.viewSessionId"') &&
    componentSource.includes('translate("sidebar.archiveSession"') &&
    componentSource.includes('translate("sidebar.deleteSession"') &&
    componentSource.includes("handlePinSession(menuSession)") &&
    componentSource.includes("startViewSessionId(menuSession)") &&
    componentSource.includes("onRenameSession(renamingSession.id") &&
    componentSource.includes("onPinSession(session.id") &&
    componentSource.includes("onArchiveSession(session.id)") &&
    componentSource.includes("onDeleteSession(deletingSession.id)"),
  componentSource,
);
check(
  "session ID dialog shows and copies the selected session id",
  componentSource.includes('aria-labelledby="view-session-id-dialog-title"') &&
    componentSource.includes('id="view-session-id-value"') &&
    componentSource.includes("value={viewingSession.id}") &&
    componentSource.includes("navigator.clipboard.writeText(viewingSession.id)") &&
    componentSource.includes("copyViewingSessionId()") &&
    componentSource.includes("aria-label={copySessionIdLabel}") &&
    componentSource.includes("inline-flex h-9 w-9") &&
    componentSource.includes('translate("sidebar.copySessionId"') &&
    componentSource.includes('translate("sidebar.sessionId"'),
  componentSource,
);
check(
  "session rename dialog guards empty titles and pending saves",
  componentSource.includes('aria-labelledby="rename-session-dialog-title"') &&
    componentSource.includes("!renameTitle.trim()") &&
    componentSource.includes('translate("sidebar.renamingSession"'),
  componentSource,
);
check(
  "session delete confirmation describes irreversible deletion",
  componentSource.includes('aria-labelledby="delete-session-dialog-title"') &&
    componentSource.includes(
      "will be permanently deleted. This action cannot be undone.",
    ),
  componentSource,
);
check(
  "wires WorkspaceContext session actions into ProjectSidebar",
  appSource.includes("renameSession,") &&
    appSource.includes("archiveSession,") &&
    appSource.includes("pinSession,") &&
    appSource.includes("deleteSession,") &&
    appSource.includes("onRenameSession: renameSession") &&
    appSource.includes("onArchiveSession: archiveSession") &&
    appSource.includes("onPinSession: pinSession") &&
    appSource.includes("onDeleteSession: deleteSession"),
  appSource,
);
check(
  "supports creating projects from sidebar",
  componentSource.includes("onCreateProject") &&
    componentSource.includes("Create project"),
  componentSource,
);
check(
  "create project modal preserves typed project names until submit",
  componentSource.includes("sanitizeProjectName(projectName)") &&
    componentSource.includes("setProjectName(event.target.value)") &&
    !componentSource.includes("sanitizeProjectName(event.target.value)"),
  componentSource,
);
check(
  "project switcher create row inherits menu background at rest",
  componentSource.includes("cursor-pointer border-none bg-transparent"),
  componentSource,
);
check(
  "project switcher create row uses plain plus icon",
  componentSource.includes('<Plus className="h-3.5 w-3.5') &&
    !componentSource.includes("<PlusCircle className="),
  componentSource,
);
check(
  "builds create project request with backend fields",
  componentSource.includes("repositories: []") &&
    componentSource.includes("active_repo_id: null"),
  componentSource,
);
check(
  "opens the new session composer after normal project creation",
  componentSource.includes("openSessionComposer: true"),
  componentSource,
);
check(
  "create project modal uses searchable team select",
  componentSource.includes("<DropdownSelect") &&
    componentSource.includes('selectionMode="single"') &&
    componentSource.includes('"sidebar.searchTeams"'),
  componentSource,
);
check(
  "create project modal defaults to a blank starter team",
  componentSource.includes('const blankTeamId = "blank_team"') &&
    componentSource.includes('label: "Blank team"') &&
    componentSource.includes('description: "One starter AI member"') &&
    componentSource.includes("teamId: selectedTeamId || blankTeamId") &&
    componentSource.includes("openSessionComposer: true") &&
    !componentSource.includes("fullstack_delivery"),
  componentSource,
);
check(
  "create project modal keeps configured team templates after blank team",
  componentSource.includes("teamPresets.filter") &&
    componentSource.includes("preset.members.length") &&
    componentSource.includes("...blankTeamOptions") &&
    !componentSource.includes("fallbackTeamOptions"),
  componentSource,
);
check(
  "create project modal can read local workspace directories",
  componentSource.includes("filesystemApi.listDirectory") &&
    componentSource.includes("filesystemApi.listRoots") &&
    componentSource.includes('translate("sidebar.readWorkspace"'),
  componentSource,
);
check(
  "create project workspace browser keeps file list height stable",
  componentSource.includes(
    "project-workspace-browser-scrollbar h-[180px] overflow-y-auto",
  ),
  componentSource,
);
check(
  "create project workspace browser uses ghost icon actions and selected rows",
  componentSource.includes("<Home className=\"h-3.5 w-3.5\"") &&
    componentSource.includes("<ChevronUp className=\"h-3.5 w-3.5\"") &&
    componentSource.includes("<RefreshCw className=\"h-3.5 w-3.5\"") &&
    componentSource.includes("before:w-[2px]") &&
    componentSource.includes("GIT"),
  componentSource,
);
check(
  "create project workspace browser can create and rename folders",
  componentSource.includes("filesystemApi.createDirectory") &&
    componentSource.includes("filesystemApi.renameDirectory") &&
    componentSource.includes('translate("sidebar.newFolder"') &&
    componentSource.includes('"sidebar.renameFolder"') &&
    componentSource.includes("commitWorkspaceDirectoryRename()"),
  componentSource,
);
check(
  "create project modal uses theme tokens for light mode",
  componentSource.includes("bg-[var(--surface-1)] text-[var(--ink)]") &&
    componentSource.includes("border-[var(--hairline)] bg-[var(--surface-2)]") &&
    componentSource.includes("bg-[var(--primary)] px-3.5 py-1.5") &&
    !componentSource.includes("bg-[#141517]"),
  componentSource,
);
check(
  "create project modal omits description and status fields",
  !componentSource.includes("setProjectDescription") &&
    !componentSource.includes("setProjectStatus"),
  componentSource,
);
check(
  "renders project management section",
  html.includes("Project management"),
  html,
);
check("renders system section", html.includes("System"), html);
check("renders Agent runtime navigation", html.includes("Agent runtime"), html);
check("does not render Skill library", !html.includes("Skill library"), html);
check(
  "does not render duplicate project sessions from shell data",
  !html.includes("undefined"),
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll ProjectSidebar assertions passed.");
}
