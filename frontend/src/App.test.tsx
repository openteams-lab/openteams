// Smoke tests for wiring the shared project sidebar into the app shell.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/App.test.tsx
// Exits non-zero if any assertion fails.

import { readFileSync } from "node:fs";
import { resolveGlobalSearchNavigationAction } from "@/lib/globalSearchNavigation";
import {
  ChatSenderType,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
  SessionWorktreeStatus,
  type ChatSearchResult,
} from "../../shared/types";

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
const createAgentSessionSource = source.slice(
  source.indexOf("const handleCreateAgentSession"),
);
const legacyDefaultMemberFlag = ["is", "default"].join("_");
const projectSidebarUsages = source.match(/<ProjectSidebar\b/g) ?? [];
const sidebarPropsMatches =
  source.match(/\{\.\.\.projectSidebarProps\}/g) ?? [];
const searchSessionResult: ChatSearchResult = {
  type: "session",
  session_id: "sess-1",
  title: "Fix login flicker",
  snippet: null,
  updated_at: "2026-07-04T00:00:00Z",
};
const searchMessageResult: ChatSearchResult = {
  type: "message",
  message_id: "msg-1",
  session_id: "sess-2",
  session_title: "Stripe checkout",
  snippet: "checkout copy",
  sender_type: ChatSenderType.user,
  sender_id: null,
  sender_label: "User",
  message_time: "2026-07-04T00:00:00Z",
};
const searchWorktreeResult: ChatSearchResult = {
  type: "worktree",
  session_id: "sess-3",
  session_title: "Worktree QA",
  worktree_id: "wt-1",
  status: SessionWorktreeStatus.active,
  branch_name: "session/wt-1",
  path_summary: "sessions/wt-1",
  updated_at: "2026-07-04T00:00:00Z",
};
const searchIssueResult: ChatSearchResult = {
  type: "issue",
  issue_id: "issue-1",
  project_id: "project-main",
  title: "Fix issue drawer",
  snippet: "drawer overflows",
  status: ProjectWorkItemStatus.open,
  priority: ProjectWorkItemPriority.high,
  updated_at: "2026-07-04T00:00:00Z",
};

check("imports ProjectSidebar", source.includes("import { ProjectSidebar }"));
check(
  "imports GlobalSearchDialog",
  source.includes("GlobalSearchDialog") &&
    source.includes("@/components/GlobalSearchDialog"),
  source,
);
check(
  "imports CreateAgentSessionModal",
  source.includes("import { CreateAgentSessionModal }"),
);
check(
  "imports app scale context",
  source.includes("import { AppScaleContext }"),
);
check(
  "defines the approved desktop scale baseline",
  source.includes("const appDesignWidth = 1440") &&
    source.includes("const appDesignHeight = 900") &&
    source.includes("const minAppScale = 0.8") &&
    source.includes("const maxAppScale = 1.2") &&
    source.includes("const compactViewportLayoutRelief = 0.06") &&
    source.includes("const compactViewportFontScale = 1.06"),
  source,
);
check(
  "relaxes layout density for compact-height desktop screens",
  source.includes("viewportHeight < appDesignHeight") &&
    source.includes("rawScale - compactViewportLayoutRelief"),
  source,
);
check(
  "keeps compact font scale separate from layout scale",
  source.includes("fontScale: number") &&
    source.includes("fontScale,") &&
    source.includes('"--ot-compact-font-scale": String(scaleState.fontScale)'),
  source,
);
check(
  "wraps the workspace in the app scale frame",
  source.includes("<AppScaleFrame>") &&
    source.includes("</AppScaleFrame>") &&
    source.includes("ot-app-scale-viewport") &&
    source.includes("ot-app-scale-frame"),
  source,
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
  "creates and opens a default session after sidebar project creation",
  source.includes("createDefaultSession?: boolean") &&
    source.includes("if (options?.createDefaultSession)") &&
    source.includes("projectId: project.id") &&
    source.includes("workspacePath: data.default_workspace_path") &&
    source.includes("await handleCreateDefaultSession({"),
  source,
);
check(
  "creates blank teams through backend presets without a frontend fallback",
  source.includes("agentRuntimeApi.list()") &&
    source.includes("chatAgentsApi.create({") &&
    source.includes("owner_project_id: projectId") &&
    source.includes("projectApi.addMember(projectId") &&
    !source.includes("createBlankTeamStarterMember") &&
    source.includes("Selected team preset was not returned by the backend"),
  source,
);
check(
  "creates selected team preset members during project creation",
  source.includes("createTeamPresetMembers") &&
    source.includes("buildTemplateMemberSpecs") &&
    source.includes("options?.forceWorkspacePath && workspacePath") &&
    source.includes("teamPresets.find") &&
    source.includes("for (const spec of memberSpecs)") &&
    source.includes("toast.projectCreatedWithTeam") &&
    source.includes("setPendingProjectSessionProtocol"),
  source,
);
check(
  "onboarding creates a real project before opening a default focused session",
  source.includes("handleCreateOnboardingProject") &&
    source.includes("onCreateProjectFromOnboarding={handleCreateOnboardingProject}") &&
    source.includes("default_workspace_path: path") &&
    source.includes("forceMemberWorkspacePath: true") &&
    source.includes("return { project }") &&
    source.includes("return { projectId: project.id, sessionId: null }") &&
    source.includes("onComplete={handleOnboardingCompleted}") &&
    source.includes("setIsCreateSessionModalOpen(false)") &&
    source.includes("await handleCreateDefaultSession({"),
  source,
);
check(
  "onboarding handoff animates the app after default session creation",
  source.includes("onboardingAppTransitionActive") &&
    source.includes("startOnboardingAppTransition()") &&
    source.includes("animate-onboarding-app-enter"),
  source,
);
check(
  "onboarding previews locale and appearance through existing app setters",
  source.includes("onPreviewLocaleChange={setLocale}") &&
    source.includes("handleOnboardingPreviewAppearanceChange") &&
    source.includes('setTheme("system")') &&
    source.includes("OnboardingAppearance.system"),
  source,
);
check(
  "passes configured team presets through sidebar props",
  source.includes("chat_presets?: ChatPresetConfigView") &&
    source.includes("const teamPresets =") &&
    source.includes("teamPresets,"),
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
  "passes search/new-session primary action callback through sidebar props",
  source.includes("onPrimaryAction: handlePrimarySidebarAction"),
  source,
);
check(
  "opens global search from search primary action",
  source.includes("const [isGlobalSearchOpen") &&
    source.includes('action.id === "search"') &&
    source.includes("setIsGlobalSearchOpen(true)") &&
    source.includes("<GlobalSearchDialog"),
  source,
);
check(
  "global search opens sessions, messages, worktrees, and issues centrally",
  source.includes("handleGlobalSearchResultOpen") &&
    source.includes("resolveGlobalSearchNavigationAction(result)") &&
    source.includes("openIssueTarget(action.target)") &&
    source.includes("replaceActiveTab(createSessionTab(action.sessionId))"),
  source,
);
check(
  "resolves global search session result to a session tab jump",
  JSON.stringify(resolveGlobalSearchNavigationAction(searchSessionResult)) ===
    JSON.stringify({ kind: "session", sessionId: "sess-1" }),
);
check(
  "resolves global search message and worktree results to session tab jumps",
  JSON.stringify(resolveGlobalSearchNavigationAction(searchMessageResult)) ===
    JSON.stringify({ kind: "session", sessionId: "sess-2" }) &&
    JSON.stringify(resolveGlobalSearchNavigationAction(searchWorktreeResult)) ===
      JSON.stringify({ kind: "session", sessionId: "sess-3" }),
);
check(
  "resolves global search issue result to issue navigation target",
  JSON.stringify(resolveGlobalSearchNavigationAction(searchIssueResult)) ===
    JSON.stringify({
      kind: "issue",
      target: { projectId: "project-main", workItemId: "issue-1" },
    }),
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
  "passes project members into create-agent modal",
  source.includes("members={createSessionMembers}") &&
    source.includes("loadCreateSessionMembers"),
  source,
);
check(
  "create-agent project member list shows configured model names",
  source.includes("const modelName =") &&
    source.includes("projectMember.execution_config?.model_name") &&
    source.includes("roleDetail: modelName"),
  source,
);
check(
  "passes selected project into create-agent modal",
  source.includes("projectId={selectedProjectId}"),
  source,
);
check(
  "passes project lead agent into create-agent modal",
  source.includes("leadMember={leadMember}"),
  source,
);
check(
  "passes resolved member workspaces into create-agent modal",
  source.includes("workflowWorkspacePath={") &&
    source.includes("memberWorkspacePaths={createSessionWorkspaceLookup.memberWorkspacePaths}") &&
    source.includes("buildCreateSessionWorkspaceLookup"),
  source,
);
check(
  "refreshes create-agent modal member data when opened",
  source.includes("if (!isCreateSessionModalOpen || !selectedProjectId) return") &&
    source.includes("void refreshMembers().catch(() => undefined)") &&
    source.includes("void loadCreateSessionMembers(selectedProjectId)") &&
    source.includes("void loadCreateSessionWorkspaceLookup(selectedProjectId)") &&
    source.includes("void loadLeadMember(selectedProjectId)"),
  source,
);
check(
  "workflow session creation uses lead role then first agent rather than default member",
  source.includes('member.role === "lead"') &&
    source.includes("ProjectMemberType.agent") &&
    source.includes("findWorkflowProjectAgent") &&
    source.includes("??") &&
    !source.includes(`pm.${legacyDefaultMemberFlag}`) &&
    !source.includes(`find((pm) => pm.${legacyDefaultMemberFlag})`),
  source,
);
check(
  "workflow member display uses project member or agent name instead of ids",
  source.includes("workflowProjectAgent.member_name?.trim()") &&
    source.includes("agent?.name?.trim()") &&
    source.includes("const runnerLabel =") &&
    source.includes("avatar: monogramFromName(displayName)") &&
    source.includes("id: workflowProjectAgent.id") &&
    !source.includes("workflowProjectAgent.agent_id ?? 'lead'") &&
    !source.includes("monogramFromName(rawName)"),
  source,
);
check(
  "create-agent modal send toast includes selected member",
  source.includes("createSession.taskSentToast") &&
    source.includes("memberName"),
  source,
);
check(
  "new free-chat session routes to selected member without prefixing content",
  source.includes("const extractAgentMentions = (text: string): string[]") &&
    source.includes("const mentions = extractAgentMentions(content)") &&
    source.includes("let freeChatSelectedAgentName: string | null = null") &&
    source.includes("freeChatSelectedAgentName =") &&
    source.includes("const routeMentions =") &&
    source.includes("freeChatSelectedAgentName.replace(/^@/, '')") &&
    !source.includes("freeChatSelectedAgentName.replace(/^@/, '').toLowerCase()") &&
    !source.includes("match[1].toLowerCase()") &&
    source.includes("sendMessageToSession(backendSession.id, content") &&
    !source.includes("let freeChatMainAgentName: string | null = null") &&
    !source.includes("content = `${handle} ${content}`"),
  source,
);
check(
  "new session first prompt uses shared optimistic send pipeline",
  source.includes("sendMessageToSession,") &&
    source.includes("sendMessageToSession(backendSession.id, content") &&
    source.includes("fallbackMention") &&
    source.includes("persistToBackend: true") &&
    source.includes("placeholderMember,") &&
    !source.includes("chatMessagesApi.send(backendSession.id"),
  source,
);
check(
  "new session first prompt gives optimistic placeholder member display data",
  source.includes("const placeholderMemberFromCurrentSession = placeholderMention") &&
    source.includes("members.find(") &&
    source.includes("options.memberAvatar ?? monogramFromName(options.memberName)") &&
    source.includes("options.memberModelName ?? 'agent'") &&
    source.includes("placeholderMember,"),
  source,
);
check(
  "workflow session creation routes the first prompt through the main agent",
  source.includes("chatSessionsApi") &&
    source.includes("let workflowLeadAgentId: string | null = null") &&
    source.includes("workflowLeadAgentId = workflowProjectAgent?.agent_id ?? null") &&
    source.includes("chat_input_mode: 'workflow'") &&
    source.includes("setSessionChatInputMode(backendSession.id, nextChatInputMode)") &&
    source.includes("workflowLeadAgentId,") &&
    source.includes("chatInputMode: nextChatInputMode"),
  source,
);
check(
  "isolated new session is revalidated against the final workspace before submit",
  source.includes("if (worktreeMode === 'isolated')") &&
    source.includes("const workspacePathForWorktree =") &&
    source.includes("chatSessionsApi.validateWorkspacePath(") &&
    source.includes("worktreeMode = undefined"),
  source,
);
check(
  "new session stages the initial message before activation",
  createAgentSessionSource.indexOf("sendMessageToSession(backendSession.id, content") <
    createAgentSessionSource.indexOf("setActiveSessionId(backendSession.id)") &&
    createAgentSessionSource.indexOf("setSessionChatInputMode(backendSession.id, nextChatInputMode)") <
      createAgentSessionSource.indexOf("sendMessageToSession(backendSession.id, content"),
  createAgentSessionSource,
);
check(
  "create-agent session can link the new session to a work item",
  source.includes("projectWorkItemsApi.linkExecution") &&
    source.includes("notifyLinkedWorkItemsChanged") &&
    source.includes("options.workItemId") &&
    source.includes("session_id: backendSession.id") &&
    source.includes("workItemId: options.workItemId") &&
    source.includes("link_type: 'discussed_in'"),
  source,
);
check(
  "new session attachments upload through the backend attachment endpoint",
  source.includes("chatMessagesApi.uploadAttachment") &&
    source.includes("attachmentInitialMessage(attachedFiles)") &&
    source.includes("mentions: shouldPersistRouteMentions"),
  source,
);
check(
  "worktree conflict resolution opens as a workspace tab page",
  source.includes('kind: "worktree-conflicts"') &&
    source.includes("createWorktreeConflictTabId") &&
    source.includes("openWorktreeConflictTab") &&
    source.includes("<WorktreeMergeConflictsSection") &&
    source.includes('surface="page"') &&
    source.includes("onOpenWorktreeConflictTab={openWorktreeConflictTab}"),
  source,
);
check(
  "worktree conflict tab refreshes source control when finished",
  source.includes("notifySourceControlRefreshRequested") &&
    source.includes("completeWorktreeConflictTab") &&
    source.includes("closeWorktreeConflictTab(tab)"),
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
  "models source-control diff tabs by project/session/path reference",
  source.includes('kind: "sc-diff"') &&
    source.includes("projectId: string") &&
    source.includes("area: SourceControlDiffArea") &&
    source.includes("createSourceControlDiffTabId") &&
    source.includes("sourceControlRef={{"),
  source,
);
check(
  "passes source-control diff opener into the workspace",
  source.includes("openSourceControlDiffTab") &&
    source.includes("onOpenSourceControlDiffTab={openSourceControlDiffTab}") &&
    source.includes('activeTab?.kind === "sc-diff"'),
  source,
);
check(
  "opens diffs by reusing the most recent diff tab",
  source.includes("const openReusableDiffTab") &&
    source.includes("findLastDiffTabIndex(currentTabs)") &&
    source.includes("openReusableDiffTab(nextTab)"),
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
  "closing tabs does not show a success toast",
  !source.includes("toast.closedTab"),
  source,
);
check(
  "frame-filling pages use the rounded content frame directly",
  source.includes('activeAppPage === "providers"') &&
    source.includes('activeAppPage === "agents"') &&
    source.includes('activeAppPage === "team"') &&
    source.includes("overflow-hidden p-0"),
  source,
);
check(
  "imports non-session pages from pages directory",
  source.includes("@/pages/GitHubRepositoryPage") &&
    source.includes("@/pages/IssuePage") &&
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
  "renders issue placeholder page",
  source.includes('case "issue"') && source.includes("<IssuePage />"),
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
  "does not expose the removed skill library page",
  !source.includes('case "tokens"') &&
    !source.includes('activeAppPage !== "tokens"'),
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
