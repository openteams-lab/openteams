import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkspaceProvider, useWorkspace } from "@/context/WorkspaceContext";
import { RunActivityProvider } from "@/context/RunActivityContext";
import { AppScaleContext } from "@/context/AppScaleContext";
import { ShortcutProvider } from "@/shortcuts/ShortcutProvider";
import { ShortcutOverlays } from "@/shortcuts/ShortcutOverlays";
import { useCommandHandler } from "@/shortcuts/ShortcutProvider";
import { detectShortcutRuntime } from "@/shortcuts/platform";
import { getTauriInvoke } from "@/lib/tauriBridge";
import { WorkflowWorkspace } from "@/components/WorkflowWorkspace";
import { CreateAgentSessionModal } from "@/components/CreateAgentSessionModal";
import { DiffViewTab } from "@/components/DiffViewTab";
import { WorktreeMergeConflictsSection } from "@/pages/worktree/WorktreeMergeConflictsSection";
import { NotificationToast } from "@/components/NotificationToast";
import {
  ProjectSidebar,
  prioritizeSessions,
} from "@/components/ProjectSidebar";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";
import {
  OnboardingGuide,
} from "@/components/onboarding/OnboardingGuide";
import { VersionUpdatePage } from "@/components/version-update/VersionUpdatePage";
import { GitHubRepositoryPage } from "@/pages/GitHubRepositoryPage";
import { IssuePage } from "@/pages/IssuePage";
import { RoutingPage } from "@/pages/RoutingPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { BuildStatsPage } from "@/pages/BuildStatsPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { TeamPage } from "@/pages/TeamPage";
import { TeamTemplatesPage } from "@/pages/TeamTemplatesPage";
import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  CircleDot,
  FileText,
  Github,
  Menu,
  Network,
  Plus,
  Route,
  Settings2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  agentRuntimeApi,
  chatAgentsApi,
  chatMessagesApi,
  chatSessionsApi,
  onboardingApi,
  projectApi,
  projectWorkItemsApi,
  teamPresetsApi,
  type VersionCheckResponse,
} from "@/lib/api";
import { useVersionUpdate } from "@/hooks/useVersionUpdate";
import {
  ONBOARDING_GUIDE_RESET_EVENT,
  ONBOARDING_UPGRADE_REPLAY_EVENT,
} from "@/lib/onboardingEvents";
import { notifyChatInputPrefill } from "@/lib/chatInputPrefill";
import {
  ISSUE_NAVIGATION_EVENT,
  ISSUE_NAVIGATION_TARGET_CHANGED_EVENT,
  requestIssueNavigation,
  storeIssueNavigationTarget,
  type IssueNavigationTarget,
} from "@/lib/issueNavigation";
import {
  TEAM_MEMBER_INVITE_NAVIGATION_EVENT,
  TEAM_MEMBER_INVITE_TARGET_CHANGED_EVENT,
  requestTeamMemberInviteNavigation,
  storeTeamMemberInviteTarget,
  type TeamMemberInviteNavigationTarget,
} from "@/lib/teamNavigation";
import { notifyLinkedWorkItemsChanged } from "@/lib/linkedWorkItemsEvents";
import { notifySourceControlRefreshRequested } from "@/lib/sourceControlEvents";
import { resolveGlobalSearchNavigationAction } from "@/lib/globalSearchNavigation";
import { getRelativeSessionId } from "@/lib/sessionNavigation";
import { notifyInboxWorkflowFocus } from "@/lib/inboxNavigation";
import { mapSession } from "@/lib/mappers";
import { mockFrontendApi } from "@/lib/mockFrontendApi";
import { projectDisplayName } from "@/lib/projectDisplay";
import {
  buildTemplateMemberSpecs,
} from "@/lib/teamTemplateRuntime";
import type { ShellOptionsMock } from "@/mockApiData";
import {
  type BaseCodingAgent as ProjectBaseCodingAgent,
  type ChatMemberPreset,
  type ChatSearchResult,
  type ChatTeamPreset,
  type InboxItem,
  OnboardingAppearance,
  type OnboardingState,
  type OnboardingTeamMemberConfig,
  ProjectMemberType,
  type CreateProjectRequest,
  type ProjectMemberWithRuntime,
  type TeamPresetSummary,
  type UpdateProject,
} from "../../shared/types";
import rootPackage from "../../package.json";
import type {
  AgentRuntimeStatus,
  ChatSessionWorktreeMode,
  JsonValue,
  Member,
  SidebarNavigationItem,
  SidebarNavigationTarget,
  SidebarPrimaryAction,
  SourceControlDiffArea,
} from "@/types";
import { monogramFromName } from "@/lib/mappers";

type WorkspaceTab =
  | { id: string; kind: "session"; sessionId: string }
  | { id: string; kind: "page"; page: SidebarNavigationTarget; label: string }
  | {
      id: string;
      kind: "diff";
      sessionId: string;
      filePath: string;
      runId?: string;
      status: string;
      unified_diff: string;
    }
  | {
      id: string;
      kind: "sc-diff";
      projectId: string;
      sessionId: string;
      filePath: string;
      area: SourceControlDiffArea;
    }
  | {
      id: string;
      kind: "worktree-conflicts";
      projectId: string;
      sessionId: string;
    };

type RenderedWorkspaceTab = {
  tab: WorkspaceTab;
  label: string;
  Icon: LucideIcon;
};

const extractAgentMentions = (text: string): string[] =>
  Array.from(
    new Set(
      Array.from(text.matchAll(/@([\p{L}\p{N}_-]+)/gu), (match) =>
        match[1],
      ),
    ),
  );

const attachmentInitialMessage = (files: File[]): string => {
  if (files.length === 1) return `Uploaded ${files[0].name}`;
  return `Uploaded ${files.length} files`;
};

const pageTabConfig: Record<
  SidebarNavigationTarget,
  { label: string; icon: LucideIcon }
> = {
  workspace: { label: "Workspace", icon: Network },
  issue: { label: "Issues", icon: CircleDot },
  team: { label: "Members", icon: Users },
  "team-templates": { label: "Team templates", icon: Users },
  routing: { label: "Routing engine", icon: Route },
  github: { label: "GitHub", icon: Github },
  providers: { label: "Settings", icon: Settings2 },
  agents: { label: "Agent runtime", icon: Bot },
  "build-stats": { label: "Build Statistics", icon: Activity },
};

const createSessionTabId = (sessionId: string) => `session:${sessionId}`;
const createPageTabId = (page: SidebarNavigationTarget) => `page:${page}`;
const createWorktreeConflictTabId = (sessionId: string) =>
  `worktree-conflicts:${sessionId}`;

const createSessionTab = (sessionId: string): WorkspaceTab => ({
  id: createSessionTabId(sessionId),
  kind: "session",
  sessionId,
});

const createPageTab = (
  page: SidebarNavigationTarget,
  label?: string,
): WorkspaceTab => ({
  id: createPageTabId(page),
  kind: "page",
  page,
  label: label ?? pageTabConfig[page].label,
});

const createWorktreeConflictTab = (
  projectId: string,
  sessionId: string,
): WorkspaceTab => ({
  id: createWorktreeConflictTabId(sessionId),
  kind: "worktree-conflicts",
  projectId,
  sessionId,
});

const isDiffWorkspaceTab = (
  tab: WorkspaceTab,
): tab is Extract<WorkspaceTab, { kind: "diff" | "sc-diff" }> =>
  tab.kind === "diff" || tab.kind === "sc-diff";

const findLastDiffTabIndex = (tabs: WorkspaceTab[]) => {
  for (let index = tabs.length - 1; index >= 0; index -= 1) {
    if (isDiffWorkspaceTab(tabs[index])) return index;
  }
  return -1;
};

const defaultSidebarWidth = 224;
const minSidebarWidth = 180;
const maxSidebarWidth = 360;
const appDesignWidth = 1440;
const appDesignHeight = 900;
const minScaledViewportWidth = 1024;
const minAppScale = 0.8;
const maxAppScale = 1.2;
const compactViewportLayoutRelief = 0.06;
const compactViewportFontScale = 1.06;
const blankTeamId = "blank_team";
const currentUpgradeVersion = rootPackage.version || "0.0.0";
type OnboardingOverlay =
  | { mode: "onboarding"; state: OnboardingState | null }
  | { mode: "upgrade" }
  | null;

type CreateProjectOptions = {
  teamId?: string;
  createDefaultSession?: boolean;
  forceMemberWorkspacePath?: boolean;
  onboardingTeamConfig?: OnboardingTeamMemberConfig[];
};

type ChatPresetConfigView = {
  members?: ChatMemberPreset[];
  teams?: ChatTeamPreset[];
};

const isWorktreeConflictInboxItem = (item: InboxItem): boolean =>
  item.kind === "worktree_conflict" ||
  item.source_type === "worktree_conflict";

const isWorktreeCleanupFailedInboxItem = (item: InboxItem): boolean =>
  item.kind === "worktree_cleanup_failed" ||
  item.source_type === "worktree_cleanup";

const isExecutorApprovalInboxItem = (item: InboxItem): boolean =>
  item.kind === "executor_approval" ||
  item.source_type === "executor_approval";

const isWorkflowInboxItem = (item: InboxItem): boolean =>
  item.source_type.startsWith("workflow_") ||
  item.kind.startsWith("workflow_") ||
  isExecutorApprovalInboxItem(item);

const findWorkflowProjectAgent = (projectMembers: ProjectMemberWithRuntime[]) =>
  projectMembers.find(
    (member) =>
      member.member_type === ProjectMemberType.agent &&
      member.role === "lead",
  ) ??
  projectMembers.find(
    (member) => member.member_type === ProjectMemberType.agent,
  );

type CreateSessionWorkspaceLookup = {
  workflowWorkspacePath: string | null;
  memberWorkspacePaths: Record<string, string | null>;
};

const normalizeMemberLookupName = (name?: string | null): string =>
  name?.replace(/^@/, "").trim().toLowerCase() ?? "";

const buildCreateSessionWorkspaceLookup = (
  projectMembers: ProjectMemberWithRuntime[],
): CreateSessionWorkspaceLookup => {
  const workflowProjectAgent = findWorkflowProjectAgent(projectMembers);
  const memberWorkspacePaths: Record<string, string | null> = {};
  for (const member of projectMembers) {
    const key = normalizeMemberLookupName(member.member_name);
    if (!key) continue;
    memberWorkspacePaths[key] = member.default_workspace_path ?? null;
  }
  return {
    workflowWorkspacePath: workflowProjectAgent?.default_workspace_path ?? null,
    memberWorkspacePaths,
  };
};

const buildCreateSessionMembers = (
  projectMembers: ProjectMemberWithRuntime[],
  agents: Awaited<ReturnType<typeof chatAgentsApi.list>>,
): Member[] => {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  return projectMembers
    .filter(
      (member) =>
        member.member_type === ProjectMemberType.agent && member.agent_id,
    )
    .map((projectMember) => {
      const agent = agentById.get(projectMember.agent_id as string);
      const displayName =
        projectMember.member_name?.trim() ||
        agent?.name?.trim() ||
        "agent";
      const name = displayName.startsWith("@") ? displayName : `@${displayName}`;
      const runnerLabel =
        projectMember.execution_config?.runner_type ??
        agent?.runner_type ??
        "agent";
      const modelName =
        projectMember.execution_config?.model_name ??
        agent?.model_name ??
        runnerLabel;
      return {
        id: projectMember.id,
        avatar: monogramFromName(displayName),
        status: "on",
        name,
        roleDetail: modelName,
        modelName,
      };
    });
};

const clampSidebarWidth = (width: number) =>
  Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));

const clampAppScale = (scale: number) =>
  Math.min(maxAppScale, Math.max(minAppScale, scale));

const macosTitlebarHeight = 28;

type AppScaleState = {
  enabled: boolean;
  scale: number;
  fontScale: number;
  viewportWidth: number;
  viewportHeight: number;
  frameWidth: number;
  frameHeight: number;
};

const getAppScaleState = (): AppScaleState => {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      scale: 1,
      fontScale: 1,
      viewportWidth: appDesignWidth,
      viewportHeight: appDesignHeight,
      frameWidth: appDesignWidth,
      frameHeight: appDesignHeight,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight =
    window.innerHeight -
    (document.documentElement.dataset.tauriPlatform === "macos"
      ? macosTitlebarHeight
      : 0);
  const enabled = viewportWidth >= minScaledViewportWidth;
  const rawScale = Math.min(
    viewportWidth / appDesignWidth,
    viewportHeight / appDesignHeight,
  );
  const layoutScale =
    viewportHeight < appDesignHeight
      ? rawScale - compactViewportLayoutRelief
      : rawScale;
  const scale = enabled ? clampAppScale(layoutScale) : 1;
  const fontScale =
    enabled && viewportHeight < appDesignHeight
      ? compactViewportFontScale
      : 1;

  return {
    enabled,
    scale,
    fontScale,
    viewportWidth,
    viewportHeight,
    frameWidth: viewportWidth / scale,
    frameHeight: viewportHeight / scale,
  };
};

function AppScaleFrame({ children }: { children: React.ReactNode }) {
  const [scaleState, setScaleState] = useState(getAppScaleState);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    let frameId = 0;

    const updateScale = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        setScaleState(getAppScaleState());
      });
    };

    updateScale();
    window.addEventListener("resize", updateScale);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateScale);
    };
  }, []);

  const scaleContext = useMemo(
    () => ({
      ...scaleState,
      portalRoot,
    }),
    [portalRoot, scaleState],
  );

  return (
    <AppScaleContext.Provider value={scaleContext}>
      <div
        className="ot-app-scale-viewport"
        style={
          {
            "--ot-app-scale": String(scaleState.scale),
            "--ot-compact-font-scale": String(scaleState.fontScale),
            "--ot-app-frame-width": `${scaleState.frameWidth}px`,
            "--ot-app-frame-height": `${scaleState.frameHeight}px`,
          } as React.CSSProperties
        }
      >
        <div className="ot-app-scale-frame">
          <div ref={setPortalRoot} className="ot-app-portal-root" />
          {children}
        </div>
      </div>
    </AppScaleContext.Provider>
  );
}

function WorkspaceLayout() {
  const {
    t,
    theme,
    themePreference,
    locale,
    setTheme,
    setLocale,
    toast,
    sessions,
    setSessions,
    projects,
    projectsAsync,
    config,
    selectedProjectId,
    setSelectedProjectId,
    refreshProjects,
    createProject,
    refreshSessions,
    renameSession,
    archiveSession,
    pinSession,
    deleteSession,
    members,
    refreshMembers,
    activeSessionId,
    setActiveSessionId,
    setSessionChatInputMode,
    sendMessageToSession,
    weeklyCost,
    showToast,
    setActiveSettingsTab,
    inboxSummaryAsync,
    inboxItemsAsync,
    refreshInbox,
    markInboxItemRead,
    markAllInboxRead,
    archiveInboxItem,
  } = useWorkspace();
  const appScale = React.useContext(AppScaleContext);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [desktopSidebarWidth, setDesktopSidebarWidth] =
    useState(defaultSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isCreateSessionModalOpen, setIsCreateSessionModalOpen] =
    useState(false);
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [onboardingOverlay, setOnboardingOverlay] =
    useState<OnboardingOverlay>(null);
  const [onboardingState, setOnboardingState] =
    useState<OnboardingState | null>(null);
  const [onboardingAppTransitionActive, setOnboardingAppTransitionActive] =
    useState(false);
  const [localizedTeamPresetSummaries, setLocalizedTeamPresetSummaries] =
    useState<TeamPresetSummary[]>([]);
  const [openTabs, setOpenTabs] = useState<WorkspaceTab[]>(() =>
    activeSessionId ? [createSessionTab(activeSessionId)] : [],
  );
  const [activeTabId, setActiveTabId] = useState<string>(() =>
    activeSessionId ? createSessionTabId(activeSessionId) : "",
  );
  const [shellOptions, setShellOptions] = useState<ShellOptionsMock | null>(
    null,
  );
  const [leadMember, setLeadMember] = useState<Member | null>(null);
  const [createSessionMembers, setCreateSessionMembers] = useState<Member[]>(
    [],
  );
  const [createSessionWorkspaceLookup, setCreateSessionWorkspaceLookup] =
    useState<CreateSessionWorkspaceLookup>({
      workflowWorkspacePath: null,
      memberWorkspacePaths: {},
    });
  const sidebarResizeRef = useRef({
    startX: 0,
    startWidth: defaultSidebarWidth,
    scale: 1,
  });
  const onboardingAppTransitionTimerRef = useRef<number | null>(null);
  const mainContentRef = useRef<HTMLElement | null>(null);
  const pendingFocusTargetRef = useRef<
    "build-stats-heading" | "tab-main-content" | null
  >(null);
  const shortcutSessionOrderRef = useRef<{
    rosterKey: string;
    orderIds: string[];
  }>({ rosterKey: "", orderIds: [] });

  const loadLeadMember = useCallback(
    async (projectId: string): Promise<Member | null> => {
      if (!projectId) return null;
      const [projectMembers, agents] = await Promise.all([
        projectApi.listMembers(projectId),
        chatAgentsApi.list({ projectId }).catch(() => []),
      ]);
      const workflowProjectAgent = findWorkflowProjectAgent(projectMembers);
      if (!workflowProjectAgent) {
        return null;
      }
      const agent = agents.find(
        (candidate) => candidate.id === workflowProjectAgent.agent_id,
      );
      const displayName =
        workflowProjectAgent.member_name?.trim() ||
        agent?.name?.trim() ||
        (workflowProjectAgent.role === 'lead' ? 'lead' : 'agent');
      const name = displayName.startsWith('@') ? displayName : `@${displayName}`;
      const runnerLabel =
        workflowProjectAgent.execution_config?.runner_type ??
        agent?.runner_type ??
        'agent';
      return {
        id: workflowProjectAgent.id,
        avatar: monogramFromName(displayName),
        status: 'on',
        name,
        roleDetail: runnerLabel,
        modelName:
          workflowProjectAgent.execution_config?.model_name ??
          agent?.model_name ??
          runnerLabel,
      };
    },
    [],
  );

  const loadCreateSessionWorkspaceLookup = useCallback(
    async (projectId: string): Promise<CreateSessionWorkspaceLookup> => {
      const projectMembers = await projectApi.listMembers(projectId);
      return buildCreateSessionWorkspaceLookup(projectMembers);
    },
    [],
  );

  const loadCreateSessionMembers = useCallback(
    async (projectId: string): Promise<Member[]> => {
      const [projectMembers, agents] = await Promise.all([
        projectApi.listMembers(projectId),
        chatAgentsApi.list({ projectId }).catch(() => []),
      ]);
      return buildCreateSessionMembers(projectMembers, agents);
    },
    [],
  );

  useEffect(() => {
    if (!selectedProjectId) {
      setLeadMember(null);
      setCreateSessionMembers([]);
      setCreateSessionWorkspaceLookup({
        workflowWorkspacePath: null,
        memberWorkspacePaths: {},
      });
      return;
    }
    setLeadMember(null);
    setCreateSessionMembers([]);
    let cancelled = false;
    void loadLeadMember(selectedProjectId)
      .then((nextLeadMember) => {
        if (!cancelled) setLeadMember(nextLeadMember);
      })
      .catch(() => {
        if (!cancelled) setLeadMember(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLeadMember, selectedProjectId]);

  useEffect(() => {
    if (!isCreateSessionModalOpen || !selectedProjectId) return;
    let cancelled = false;
    void refreshMembers().catch(() => undefined);
    void loadCreateSessionMembers(selectedProjectId)
      .then((nextMembers) => {
        if (!cancelled) setCreateSessionMembers(nextMembers);
      })
      .catch(() => {
        if (!cancelled) setCreateSessionMembers([]);
      });
    void loadCreateSessionWorkspaceLookup(selectedProjectId)
      .then((lookup) => {
        if (!cancelled) setCreateSessionWorkspaceLookup(lookup);
      })
      .catch(() => {
        if (!cancelled) {
          setCreateSessionWorkspaceLookup({
            workflowWorkspacePath: null,
            memberWorkspacePaths: {},
          });
        }
      });
    void loadLeadMember(selectedProjectId)
      .then((nextLeadMember) => {
        if (!cancelled) setLeadMember(nextLeadMember);
      })
      .catch(() => {
        if (!cancelled) setLeadMember(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isCreateSessionModalOpen,
    loadCreateSessionMembers,
    loadCreateSessionWorkspaceLookup,
    loadLeadMember,
    refreshMembers,
    selectedProjectId,
  ]);

  const translate = useCallback(
    (
      key: string,
      fallback: string,
      replacements?: Record<string, string | number>,
    ) => {
      const translated = t(key, replacements);
      const text = translated && translated !== key ? translated : fallback;
      if (!replacements) return text;
      return Object.entries(replacements).reduce(
        (current, [name, value]) =>
          current.replace(`{${name}}`, String(value)),
        text,
      );
    },
    [t],
  );

  const overlayForOnboardingState = (
    nextState: OnboardingState,
  ): OnboardingOverlay => {
    if (!nextState.onboarding_completed_at) {
      return { mode: "onboarding", state: nextState };
    }
    return null;
  };

  const loadRuntimeStatuses = async (): Promise<AgentRuntimeStatus[]> => {
    try {
      return (await agentRuntimeApi.list()).runners;
    } catch (err) {
      console.error("Failed to load agent runtimes", err);
      return [];
    }
  };

  const createProjectAgentMember = async ({
    projectId,
    workspacePath,
    name,
    runnerType,
    systemPrompt,
    toolsEnabled,
    modelName,
    allowedSkillIds,
    role,
    displayOrder,
  }: {
    projectId: string;
    workspacePath: string | null;
    name: string;
    runnerType: string;
    systemPrompt: string | null;
    toolsEnabled: JsonValue;
    modelName: string | null;
    allowedSkillIds: string[];
    role: string;
    displayOrder: number;
  }) => {
    const agent = await chatAgentsApi.create({
      name,
      runner_type: runnerType,
      system_prompt: systemPrompt,
      tools_enabled: toolsEnabled,
      model_name: modelName,
      owner_project_id: projectId,
    });

    await projectApi.addMember(projectId, {
      member_type: ProjectMemberType.agent,
      user_id: null,
      agent_id: agent.id,
      member_name: agent.name,
      role,
      display_order: displayOrder as unknown as bigint,
      default_workspace_path: workspacePath,
      allowed_skill_ids: allowedSkillIds,
      execution_config: {
        runner_type: runnerType as unknown as ProjectBaseCodingAgent,
        model_name: modelName,
        thinking_effort: null,
        model_variant: null,
      },
      is_default: true,
    });
  };

  const createTeamPresetMembers = async (
    projectId: string,
    workspacePath: string | null,
    teamPreset: ChatTeamPreset,
    runtimes: AgentRuntimeStatus[],
    options?: {
      forceWorkspacePath?: boolean;
      memberConfig?: OnboardingTeamMemberConfig[];
    },
  ): Promise<number> => {
    let created = 0;
    const onboardingConfigByMember = new Map(
      (options?.memberConfig ?? []).map((member) => [
        member.member.trim().toLowerCase(),
        member,
      ]),
    );
    const memberSpecs = buildTemplateMemberSpecs(
      teamPreset,
      workspacePath,
      runtimes,
    ).map((spec) => {
      const onboardingConfig = onboardingConfigByMember.get(
        spec.name.trim().toLowerCase(),
      );
      return {
        ...spec,
        ...(options?.forceWorkspacePath && workspacePath
          ? { workspacePath }
          : {}),
        ...(onboardingConfig?.runner_type
          ? { runnerType: onboardingConfig.runner_type }
          : {}),
        ...(onboardingConfig?.model_name
          ? { modelName: onboardingConfig.model_name }
          : {}),
      };
    });
    for (const spec of memberSpecs) {
      await createProjectAgentMember({
        projectId,
        ...spec,
      });
      created += 1;
    }

    return created;
  };

  const getPageTabLabel = (page: SidebarNavigationTarget) =>
    translate(`page.${page}`, pageTabConfig[page].label);

  useEffect(() => {
    void mockFrontendApi.getShellOptions().then(setShellOptions);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void onboardingApi.getState()
      .then((nextState) => {
        if (cancelled) return;
        setOnboardingState(nextState);
        setOnboardingOverlay(overlayForOnboardingState(nextState));
      })
      .catch((err) => {
        console.error("Failed to load onboarding state", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openVersionUpdatePage = useCallback(
    (_info?: VersionCheckResponse | null) => {
      setOnboardingOverlay({ mode: "upgrade" });
    },
    [],
  );

  const versionUpdate = useVersionUpdate({
    onOpenUpdatePage: openVersionUpdatePage,
    onInstallStarted: () =>
      showToast(t("onboarding.upgrade.installStarted"), "success"),
  });

  useEffect(() => {
    return () => {
      if (onboardingAppTransitionTimerRef.current !== null) {
        window.clearTimeout(onboardingAppTransitionTimerRef.current);
      }
    };
  }, []);

  const startOnboardingAppTransition = () => {
    if (typeof window === "undefined") return;
    if (onboardingAppTransitionTimerRef.current !== null) {
      window.clearTimeout(onboardingAppTransitionTimerRef.current);
    }
    setOnboardingAppTransitionActive(true);
    onboardingAppTransitionTimerRef.current = window.setTimeout(() => {
      setOnboardingAppTransitionActive(false);
      onboardingAppTransitionTimerRef.current = null;
    }, 420);
  };

  useEffect(() => {
    const handleGuideReset = (event: Event) => {
      const nextState = (event as CustomEvent<OnboardingState>).detail;
      setOnboardingState(nextState);
      setOnboardingOverlay({ mode: "onboarding", state: nextState });
    };
    const handleUpgradeReplay = (event: Event) => {
      const nextState = (event as CustomEvent<OnboardingState>).detail;
      setOnboardingState(nextState);
      openVersionUpdatePage(versionUpdate.info);
    };

    window.addEventListener(ONBOARDING_GUIDE_RESET_EVENT, handleGuideReset);
    window.addEventListener(
      ONBOARDING_UPGRADE_REPLAY_EVENT,
      handleUpgradeReplay,
    );
    return () => {
      window.removeEventListener(ONBOARDING_GUIDE_RESET_EVENT, handleGuideReset);
      window.removeEventListener(
        ONBOARDING_UPGRADE_REPLAY_EVENT,
        handleUpgradeReplay,
      );
    };
  }, [openVersionUpdatePage, versionUpdate.info]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX =
        (event.clientX - sidebarResizeRef.current.startX) /
        sidebarResizeRef.current.scale;
      setDesktopSidebarWidth(
        clampSidebarWidth(sidebarResizeRef.current.startWidth + deltaX),
      );
    };

    const handlePointerUp = () => {
      setIsSidebarResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isSidebarResizing]);

  useEffect(() => {
    const sessionIds = new Set(sessions.map((session) => session.id));
    setOpenTabs((currentTabs) => {
      const validTabs = currentTabs.filter(
        (tab) =>
          (tab.kind !== "session" && tab.kind !== "worktree-conflicts") ||
          sessionIds.has(tab.sessionId),
      );
      if (validTabs.length > 0) return validTabs;
      return activeSessionId ? [createSessionTab(activeSessionId)] : [];
    });
  }, [activeSessionId, sessions]);

  useEffect(() => {
    setActiveTabId((currentTabId) => {
      if (openTabs.some((tab) => tab.id === currentTabId)) return currentTabId;
      return openTabs[0]?.id ?? "";
    });
  }, [openTabs]);

  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const activeAppPage: SidebarNavigationTarget =
    activeTab?.kind === "page" ? activeTab.page : "workspace";
  const shortcutSessionRosterKey = sessions
    .map((session) => session.id)
    .join("\u001f");
  const shortcutPreviousSessionOrder =
    shortcutSessionOrderRef.current.rosterKey === shortcutSessionRosterKey
      ? shortcutSessionOrderRef.current.orderIds
      : [];
  const shortcutOrderedSessions = prioritizeSessions(
    sessions,
    shortcutPreviousSessionOrder,
  );
  useEffect(() => {
    shortcutSessionOrderRef.current = {
      rosterKey: shortcutSessionRosterKey,
      orderIds: shortcutOrderedSessions.map((session) => session.id),
    };
  }, [shortcutOrderedSessions, shortcutSessionRosterKey]);
  useLayoutEffect(() => {
    const pendingTarget = pendingFocusTargetRef.current;
    if (!pendingTarget) return;
    const selector = `[data-shortcut-focus="${pendingTarget}"]`;
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return;
    target.focus();
    pendingFocusTargetRef.current = null;
  }, [activeAppPage, activeTabId]);
  const renderedTabs = openTabs
    .map<RenderedWorkspaceTab | null>((tab) => {
      if (tab.kind === "session") {
        const session = sessions.find(
          (candidate) => candidate.id === tab.sessionId,
        );
        if (!session) return null;
        return { tab, label: session.title, Icon: Box };
      }
      if (tab.kind === "diff") {
        const fileName = tab.filePath.split("/").pop() ?? tab.filePath;
        return { tab, label: fileName, Icon: FileText };
      }
      if (tab.kind === "sc-diff") {
        const fileName = tab.filePath.split("/").pop() ?? tab.filePath;
        return { tab, label: fileName, Icon: FileText };
      }
      if (tab.kind === "worktree-conflicts") {
        return {
          tab,
          label: translate("worktree.merge.tabLabel", "Merge conflicts"),
          Icon: AlertTriangle,
        };
      }
      const config = pageTabConfig[tab.page];
      return { tab, label: getPageTabLabel(tab.page), Icon: config.icon };
    })
    .filter((tab): tab is RenderedWorkspaceTab => Boolean(tab));
  const openSessionTabIds = openTabs
    .filter(
      (tab): tab is Extract<WorkspaceTab, { kind: "session" }> =>
        tab.kind === "session",
    )
    .map((tab) => tab.sessionId);

  const renderActivePage = () => {
    if (activeTab?.kind === "diff") {
      const workspacePath = projects.find(
        (project) => project.id === selectedProjectId,
      )?.default_workspace_path ?? undefined;
      return (
        <DiffViewTab
          sessionId={activeTab.sessionId}
          filePath={activeTab.filePath}
          status={activeTab.status}
          unifiedDiff={activeTab.unified_diff}
          workspacePath={workspacePath}
        />
      );
    }
    if (activeTab?.kind === "sc-diff") {
      const workspacePath = projects.find(
        (project) => project.id === activeTab.projectId,
      )?.default_workspace_path ?? undefined;
      return (
        <DiffViewTab
          workspacePath={workspacePath}
          sourceControlRef={{
            projectId: activeTab.projectId,
            sessionId: activeTab.sessionId,
            filePath: activeTab.filePath,
            area: activeTab.area,
          }}
        />
      );
    }
    if (activeTab?.kind === "worktree-conflicts") {
      return (
        <WorktreeMergeConflictsSection
          sessionId={activeTab.sessionId}
          surface="page"
          tr={translate}
          onClose={() => closeWorktreeConflictTab(activeTab)}
          onCompleted={() => completeWorktreeConflictTab(activeTab)}
          onAbort={() => completeWorktreeConflictTab(activeTab)}
        />
      );
    }

    switch (activeAppPage) {
      case "team":
        return <TeamPage />;
      case "issue":
        return <IssuePage />;
      case "team-templates":
        return <TeamTemplatesPage />;
      case "routing":
        return <RoutingPage />;
      case "github":
        return <GitHubRepositoryPage />;
      case "providers":
        return <SettingsPage />;
      case "build-stats":
        return <BuildStatsPage />;
      case "agents":
        return <AgentsPage />;
      case "workspace":
      default:
        return (
          <div className="h-full w-full flex flex-col min-h-0">
            <WorkflowWorkspace
              onOpenDiffTab={openDiffTab}
              onOpenSourceControlDiffTab={openSourceControlDiffTab}
              onOpenWorktreeConflictTab={openWorktreeConflictTab}
            />
          </div>
        );
    }
  };

  const closeMobileSidebar = () => setIsMobileSidebarOpen(false);

  const replaceActiveTab = (nextTab: WorkspaceTab) => {
    setOpenTabs((currentTabs) => {
      if (currentTabs.length === 0) return [nextTab];

      const activeIndex = currentTabs.findIndex(
        (tab) => tab.id === activeTabId,
      );
      const replaceIndex = activeIndex >= 0 ? activeIndex : 0;

      return currentTabs.reduce<WorkspaceTab[]>((nextTabs, tab, index) => {
        if (index === replaceIndex) {
          nextTabs.push(nextTab);
          return nextTabs;
        }
        if (tab.id !== nextTab.id) nextTabs.push(tab);
        return nextTabs;
      }, []);
    });
    setActiveTabId(nextTab.id);
  };

  const openSessionTab = (sessionId: string) => {
    const nextTab = createSessionTab(sessionId);
    setOpenTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === nextTab.id)) return currentTabs;
      if (currentTabs.length === 0) return [nextTab];

      const activeSessionTabIndex = currentTabs.findIndex(
        (tab) => tab.id === activeTabId && tab.kind === "session",
      );
      if (activeSessionTabIndex < 0) return [...currentTabs, nextTab];

      return currentTabs.map((tab, index) =>
        index === activeSessionTabIndex ? nextTab : tab,
      );
    });
    setActiveTabId(nextTab.id);
  };

  const openPageTab = (page: SidebarNavigationTarget, label?: string) => {
    replaceActiveTab(createPageTab(page, label));
  };

  const openSettingsTab = (tab: string) => {
    setActiveSettingsTab(tab);
    openPageTab("providers", getPageTabLabel("providers"));
  };

  const openIssueTarget = (target: IssueNavigationTarget) => {
    storeIssueNavigationTarget(target);
    if (target.projectId && target.projectId !== selectedProjectId) {
      setSelectedProjectId(target.projectId);
    }
    openPageTab("issue", getPageTabLabel("issue"));
    window.dispatchEvent(
      new CustomEvent(ISSUE_NAVIGATION_TARGET_CHANGED_EVENT),
    );
  };

  const openReusableDiffTab = (
    nextTab: Extract<WorkspaceTab, { kind: "diff" | "sc-diff" }>,
  ) => {
    setOpenTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === nextTab.id)) {
        return currentTabs.map((tab) =>
          tab.id === nextTab.id ? nextTab : tab,
        );
      }
      if (currentTabs.length === 0) return [nextTab];

      const activeDiffIndex = currentTabs.findIndex(
        (tab) => tab.id === activeTabId && isDiffWorkspaceTab(tab),
      );
      const replaceIndex =
        activeDiffIndex >= 0
          ? activeDiffIndex
          : findLastDiffTabIndex(currentTabs);

      if (replaceIndex < 0) return [...currentTabs, nextTab];

      return currentTabs.reduce<WorkspaceTab[]>((nextTabs, tab, index) => {
        if (index === replaceIndex) {
          nextTabs.push(nextTab);
          return nextTabs;
        }
        if (tab.id !== nextTab.id) nextTabs.push(tab);
        return nextTabs;
      }, []);
    });
    setActiveTabId(nextTab.id);
  };

  useEffect(() => {
    const handleNavigateSession = (event: Event) => {
      const sessionId = (event as CustomEvent<string>).detail;
      if (sessionId) {
        replaceActiveTab(createSessionTab(sessionId));
        setActiveSessionId(sessionId);
      }
    };
    const handleNavigateIssue = (event: Event) => {
      const target = (event as CustomEvent<IssueNavigationTarget>).detail;
      if (!target) return;
      if (target.kind === 'list' || target.kind === 'create') {
        openIssueTarget(target);
        return;
      }
      if ('workItemId' in target && target.workItemId) openIssueTarget(target);
    };
    const handleNavigateTeamMemberInvite = (event: Event) => {
      const target =
        (event as CustomEvent<TeamMemberInviteNavigationTarget>).detail ?? {};

      storeTeamMemberInviteTarget(target);
      if (target.projectId && target.projectId !== selectedProjectId) {
        setSelectedProjectId(target.projectId);
      }
      openPageTab("team", getPageTabLabel("team"));
      window.dispatchEvent(
        new CustomEvent(TEAM_MEMBER_INVITE_TARGET_CHANGED_EVENT),
      );
    };
    window.addEventListener(
      "openteams:navigate-session",
      handleNavigateSession,
    );
    window.addEventListener(ISSUE_NAVIGATION_EVENT, handleNavigateIssue);
    window.addEventListener(
      TEAM_MEMBER_INVITE_NAVIGATION_EVENT,
      handleNavigateTeamMemberInvite,
    );
    return () => {
      window.removeEventListener(
        "openteams:navigate-session",
        handleNavigateSession,
      );
      window.removeEventListener(ISSUE_NAVIGATION_EVENT, handleNavigateIssue);
      window.removeEventListener(
        TEAM_MEMBER_INVITE_NAVIGATION_EVENT,
        handleNavigateTeamMemberInvite,
      );
    };
  });

  const createDiffTabId = (
    sessionId: string,
    filePath: string,
    runId?: string,
  ) => `diff:${sessionId}:${runId ?? "session"}:${filePath}`;
  const createSourceControlDiffTabId = (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => `sc-diff:${projectId}:${sessionId}:${area}:${filePath}`;

  const openDiffTab = (
    sessionId: string,
    filePath: string,
    status: string,
    unified_diff: string,
    runId?: string,
  ) => {
    const nextTab: WorkspaceTab = {
      id: createDiffTabId(sessionId, filePath, runId),
      kind: "diff",
      sessionId,
      filePath,
      runId,
      status,
      unified_diff,
    };
    openReusableDiffTab(nextTab);
  };

  const openSourceControlDiffTab = (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => {
    const nextTab: WorkspaceTab = {
      id: createSourceControlDiffTabId(projectId, sessionId, filePath, area),
      kind: "sc-diff",
      projectId,
      sessionId,
      filePath,
      area,
    };
    openReusableDiffTab(nextTab);
  };

  const openWorktreeConflictTab = (projectId: string, sessionId: string) => {
    const nextTab = createWorktreeConflictTab(projectId, sessionId);
    setOpenTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === nextTab.id)) {
        return currentTabs.map((tab) =>
          tab.id === nextTab.id ? nextTab : tab,
        );
      }
      return [...currentTabs, nextTab];
    });
    setActiveTabId(nextTab.id);
    setActiveSessionId(sessionId);
  };

  const openInboxSessionTab = (sessionId: string) => {
    replaceActiveTab(createSessionTab(sessionId));
    setActiveSessionId(sessionId);
    closeMobileSidebar();
  };

  const handleInboxItemOpen = (item: InboxItem) => {
    const sessionId = item.session_id ?? activeSessionId;
    const projectId = item.project_id ?? selectedProjectId;
    let openedTarget = false;
    if (projectId && projectId !== selectedProjectId) {
      setSelectedProjectId(projectId);
    }

    if (sessionId && projectId && isWorktreeConflictInboxItem(item)) {
      openWorktreeConflictTab(projectId, sessionId);
      closeMobileSidebar();
      openedTarget = true;
    } else if (sessionId && isWorktreeCleanupFailedInboxItem(item)) {
      openInboxSessionTab(sessionId);
      openedTarget = true;
      window.setTimeout(() => {
        notifySourceControlRefreshRequested({
          projectId,
          sessionId,
        });
      }, 0);
    } else if (sessionId) {
      openInboxSessionTab(sessionId);
      openedTarget = true;
      if (isWorkflowInboxItem(item)) {
        window.setTimeout(() => {
          notifyInboxWorkflowFocus({
            sessionId,
            kind: item.kind,
            sourceType: item.source_type,
            sourceId: item.source_id,
          });
        }, 0);
      }
    }

    if (openedTarget) {
      void markInboxItemRead(item.id).catch(() => undefined);
    }
  };

  const closeWorktreeConflictTab = (
    tab: Extract<WorkspaceTab, { kind: "worktree-conflicts" }>,
  ) => {
    replaceActiveTab(createSessionTab(tab.sessionId));
    setActiveSessionId(tab.sessionId);
  };

  const completeWorktreeConflictTab = (
    tab: Extract<WorkspaceTab, { kind: "worktree-conflicts" }>,
  ) => {
    notifySourceControlRefreshRequested({
      projectId: tab.projectId,
      sessionId: tab.sessionId,
    });
    closeWorktreeConflictTab(tab);
  };

  const handleSidebarNavigate = (item: SidebarNavigationItem) => {
    if (!item.targetPage) {
      handleSidebarProjectAction(item.id);
      return;
    }

    if (item.targetPage === "workspace") {
      const nextSessionId = activeSessionId || sessions[0]?.id;
      if (nextSessionId) {
        replaceActiveTab(createSessionTab(nextSessionId));
        setActiveSessionId(nextSessionId);
      }
      closeMobileSidebar();
      return;
    }

    if (item.targetPage === "providers") {
      openSettingsTab("appearance");
      closeMobileSidebar();
      return;
    }

    openPageTab(item.targetPage, item.label);
    closeMobileSidebar();
  };

  const handleSidebarSessionSelect = (sessionId: string) => {
    replaceActiveTab(createSessionTab(sessionId));
    setActiveSessionId(sessionId);
    closeMobileSidebar();
  };

  const handleGlobalSearchResultOpen = (result: ChatSearchResult) => {
    const action = resolveGlobalSearchNavigationAction(result);
    if (!action) return;

    if (action.kind === "issue") {
      openIssueTarget(action.target);
      closeMobileSidebar();
      return;
    }

    replaceActiveTab(createSessionTab(action.sessionId));
    setActiveSessionId(action.sessionId);
    closeMobileSidebar();
  };

  const handleAddSessionTab = () => {
    const nextSession = sessions.find(
      (session) => !openSessionTabIds.includes(session.id),
    );

    if (!nextSession) {
      showToast(t("toast.allSessionsOpen"), "warning");
      return;
    }

    setOpenTabs((currentTabs) => [
      ...currentTabs,
      createSessionTab(nextSession.id),
    ]);
    setActiveTabId(createSessionTabId(nextSession.id));
    setActiveSessionId(nextSession.id);
    closeMobileSidebar();
  };

  const handleCloseTab = (closingTab: WorkspaceTab) => {
    if (openTabs.length <= 1) {
      showToast(t("toast.keepOneTab"), "warning");
      return;
    }

    const closingIndex = openTabs.findIndex((tab) => tab.id === closingTab.id);
    const nextTabs = openTabs.filter((tab) => tab.id !== closingTab.id);

    setOpenTabs(nextTabs);

    if (closingTab.id === activeTabId) {
      const nextActiveTab =
        nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0];
      setActiveTabId(nextActiveTab.id);
      if (
        nextActiveTab.kind === "session" ||
        nextActiveTab.kind === "worktree-conflicts"
      ) {
        setActiveSessionId(nextActiveTab.sessionId);
      }
    }
  };

  const handleCreateDefaultSession = async (options?: {
    projectId?: string | null;
    workspacePath?: string | null;
  }) => {
    const projectId = options?.projectId?.trim() || selectedProjectId;
    if (!projectId) {
      showToast(
        translate(
          'createSession.noProject',
          'Please select a project first',
        ),
        'warning',
      );
      return;
    }
    const defaultSessionTitle = translate(
      'createSession.defaultTitle',
      'Default Session',
    );

    try {
      const backendSession = await projectApi.createSession(projectId, {
        title: defaultSessionTitle,
        workspace_path: options?.workspacePath ?? activeProjectWorkspacePath ?? null,
      });
      const mappedSession = mapSession(backendSession, {
        activeSessionId: backendSession.id,
      });

      setSessions((prev) => [
        mappedSession,
        ...prev
          .filter((session) => session.id !== backendSession.id)
          .map((session) => ({ ...session, active: false })),
      ]);
      replaceActiveTab(createSessionTab(backendSession.id));
      setActiveSessionId(backendSession.id);
      setSessionChatInputMode(backendSession.id, 'free');
      setIsCreateSessionModalOpen(false);
      closeMobileSidebar();
      notifyChatInputPrefill({
        sessionId: backendSession.id,
        text: '',
        mode: 'free',
      });
      void refreshSessions();
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : String(err ?? 'Failed to create session'),
        'error',
      );
    }
  };

  const handlePrimarySidebarAction = (action: SidebarPrimaryAction) => {
    if (action.id === "search") {
      setIsGlobalSearchOpen(true);
      closeMobileSidebar();
      return;
    }
    if (action.id === "new-session") {
      setIsCreateSessionModalOpen(true);
      closeMobileSidebar();
      return;
    }
    showToast(translate(`sidebar.primary.${action.id}.helper`, action.helper));
    closeMobileSidebar();
  };

  const activateRelativeTab = (offset: -1 | 1) => {
    if (openTabs.length < 2) return;
    const currentIndex = Math.max(
      0,
      openTabs.findIndex((tab) => tab.id === activeTabId),
    );
    const nextTab =
      openTabs[(currentIndex + offset + openTabs.length) % openTabs.length];
    pendingFocusTargetRef.current = 'tab-main-content';
    setActiveTabId(nextTab.id);
    if (nextTab.kind === 'session') setActiveSessionId(nextTab.sessionId);
  };

  const activateRelativeSession = (offset: -1 | 1) => {
    const nextSessionId = getRelativeSessionId(
      shortcutOrderedSessions.map((session) => session.id),
      activeSessionId,
      offset,
    );
    if (!nextSessionId) return;

    pendingFocusTargetRef.current = 'tab-main-content';
    replaceActiveTab(createSessionTab(nextSessionId));
    setActiveSessionId(nextSessionId);
  };

  useCommandHandler('search.open', {
    scope: 'global',
    enabled: true,
    execute: () => setIsGlobalSearchOpen(true),
  });
  useCommandHandler('session.create', {
    scope: 'global',
    enabled: Boolean(selectedProjectId),
    disabledReason: selectedProjectId ? undefined : t('shortcuts.reason.selectProject'),
    execute: () => setIsCreateSessionModalOpen(true),
  });
  useCommandHandler('build-stats.open', {
    scope: 'global',
    enabled: true,
    execute: () => {
      pendingFocusTargetRef.current = 'build-stats-heading';
      openPageTab('build-stats', getPageTabLabel('build-stats'));
    },
  });
  useCommandHandler('session-tab.next', {
    scope: 'global',
    enabled: openTabs.length > 1,
    execute: () => activateRelativeTab(1),
  });
  useCommandHandler('session-tab.previous', {
    scope: 'global',
    enabled: openTabs.length > 1,
    execute: () => activateRelativeTab(-1),
  });
  useCommandHandler('session.next', {
    scope: 'page',
    enabled: Boolean(activeSessionId) && shortcutOrderedSessions.length > 1,
    disabledReason:
      activeSessionId && shortcutOrderedSessions.length > 1
        ? undefined
        : t('shortcuts.reason.unavailable'),
    execute: () => activateRelativeSession(1),
  });
  useCommandHandler('session.previous', {
    scope: 'page',
    enabled: Boolean(activeSessionId) && shortcutOrderedSessions.length > 1,
    disabledReason:
      activeSessionId && shortcutOrderedSessions.length > 1
        ? undefined
        : t('shortcuts.reason.unavailable'),
    execute: () => activateRelativeSession(-1),
  });
  useCommandHandler('settings.open', {
    scope: 'global',
    enabled: true,
    execute: () => openSettingsTab('appearance'),
  });
  useCommandHandler('shortcuts.settings.open', {
    scope: 'global',
    enabled: true,
    execute: () => openSettingsTab('shortcuts'),
  });
  useCommandHandler('issue.open-list', {
    scope: 'global',
    enabled: Boolean(selectedProjectId),
    disabledReason: selectedProjectId ? undefined : t('shortcuts.reason.selectProject'),
    execute: () =>
      requestIssueNavigation({
        kind: 'list',
        projectId: selectedProjectId ?? undefined,
      }),
  });
  useCommandHandler('issue.create', {
    scope: 'global',
    enabled: Boolean(selectedProjectId),
    disabledReason: selectedProjectId ? undefined : t('shortcuts.reason.selectProject'),
    execute: () =>
      requestIssueNavigation({
        kind: 'create',
        projectId: selectedProjectId ?? undefined,
      }),
  });
  useCommandHandler('team.member.add', {
    scope: 'global',
    enabled: Boolean(selectedProjectId),
    disabledReason: selectedProjectId ? undefined : t('shortcuts.reason.selectProject'),
    execute: () =>
      requestTeamMemberInviteNavigation({
        projectId: selectedProjectId ?? undefined,
      }),
  });

  const handleCreateAgentSession = async (
    prompt: string,
    options: {
      taskMode: 'workflow' | 'freeChat';
      memberId?: string;
      memberName?: string;
      memberAvatar?: string;
      memberModelName?: string;
      workItemId?: string;
      worktreeMode?: ChatSessionWorktreeMode;
      attachments?: File[];
    },
  ) => {
    if (!selectedProjectId) {
      showToast(
        translate(
          'createSession.noProject',
          'Please select a project first',
        ),
        'warning',
      );
      return;
    }

    try {
      const attachedFiles = options.attachments ?? [];
      const sessionTitle =
        prompt.trim() ||
        (attachedFiles.length > 0
          ? attachmentInitialMessage(attachedFiles)
          : prompt);
      let workspacePath: string | null = null;
      let workflowLeadAgentId: string | null = null;
      let freeChatSelectedAgentName: string | null = null;
      try {
        const projectMembers = await projectApi.listMembers(selectedProjectId);
        const workflowProjectAgent = findWorkflowProjectAgent(projectMembers);
        if (options.taskMode === 'workflow') {
          workspacePath = workflowProjectAgent?.default_workspace_path ?? null;
          workflowLeadAgentId = workflowProjectAgent?.agent_id ?? null;
        } else {
          const normalizedName = normalizeMemberLookupName(options.memberName);
          const matched = projectMembers.find((pm) => {
            if (normalizedName && pm.member_name) {
              return normalizeMemberLookupName(pm.member_name) === normalizedName;
            }
            return false;
          });
          workspacePath = matched?.default_workspace_path ?? null;
          freeChatSelectedAgentName =
            matched?.member_name ?? options.memberName ?? null;
        }
      } catch {}

      let worktreeMode = options.worktreeMode;
      if (worktreeMode === 'isolated') {
        const workspacePathForWorktree =
          workspacePath?.trim() || activeProjectWorkspacePath?.trim() || '';
        if (!workspacePathForWorktree) {
          worktreeMode = undefined;
        } else {
          try {
            const workspace = await chatSessionsApi.validateWorkspacePath(
              workspacePathForWorktree,
            );
            if (!workspace.valid || !workspace.is_git_repo) {
              worktreeMode = undefined;
            }
          } catch {
            worktreeMode = undefined;
          }
        }
      }

      const backendSession = await projectApi.createSession(
        selectedProjectId,
        {
          title: sessionTitle,
          workspace_path: workspacePath,
          ...(worktreeMode ? { worktree_mode: worktreeMode } : {}),
        },
      );
      let sessionForUi = backendSession;

      if (options.taskMode === 'workflow') {
        await chatSessionsApi
          .update(backendSession.id, {
            title: null,
            status: null,
            ...(workflowLeadAgentId
              ? { lead_agent_id: workflowLeadAgentId }
              : {}),
            summary_text: null,
            archive_ref: null,
            last_seen_diff_key: null,
            default_workspace_path: null,
            chat_input_mode: 'workflow',
          })
          .then((updatedSession) => {
            sessionForUi = updatedSession;
          })
          .catch(() => undefined);
      }

      const nextChatInputMode =
        options.taskMode === 'workflow' ? 'workflow' : 'free';
      setSessionChatInputMode(backendSession.id, nextChatInputMode);

      if (prompt.trim() || attachedFiles.length > 0) {
        const content = prompt;
        const mentions = extractAgentMentions(content);
        const routeMentions =
          options.taskMode === 'freeChat'
            ? mentions.length > 0
              ? mentions
              : freeChatSelectedAgentName
                ? [freeChatSelectedAgentName.replace(/^@/, '')]
                : []
            : undefined;
        const fallbackMention =
          routeMentions && routeMentions.length > 0
            ? routeMentions[0]
            : (options.memberName ?? null);
        const placeholderMention =
          fallbackMention?.replace(/^@/, '').toLowerCase() ?? null;
        const placeholderMemberFromCurrentSession = placeholderMention
          ? members.find(
              (member) =>
                member.name.replace(/^@/, '').toLowerCase() ===
                placeholderMention,
            )
          : undefined;
        const placeholderMember =
          placeholderMemberFromCurrentSession ??
          (options.memberName
            ? {
                name: options.memberName,
                avatar:
                  options.memberAvatar ?? monogramFromName(options.memberName),
                modelName: options.memberModelName ?? 'agent',
              }
            : undefined);

        if (attachedFiles.length > 0) {
          const shouldPersistRouteMentions =
            Boolean(routeMentions?.length) &&
            (nextChatInputMode !== 'workflow' || mentions.length > 0);
          await chatMessagesApi.uploadAttachment(
            backendSession.id,
            attachedFiles,
            {
              chatInputMode: nextChatInputMode,
              content: content.trim() ? content : undefined,
              appLanguage: locale,
              mentions: shouldPersistRouteMentions
                ? routeMentions
                : undefined,
            },
          );
        } else {
          sendMessageToSession(backendSession.id, content, {
            chatInputMode: nextChatInputMode,
            routeMentions,
            fallbackMention,
            workflowLeadAgentId,
            persistToBackend: true,
            placeholderMember,
          });
        }
      }

      const mappedSession = mapSession(sessionForUi, {
        activeSessionId: backendSession.id,
      });

      setSessions((prev) => [
        mappedSession,
        ...prev.map((s) => ({ ...s, active: false })),
      ]);

      replaceActiveTab(createSessionTab(backendSession.id));
      setActiveSessionId(backendSession.id);
      closeMobileSidebar();

      if (options.workItemId) {
        await projectWorkItemsApi.linkExecution(
          selectedProjectId,
          options.workItemId,
          {
            session_id: backendSession.id,
            workflow_execution_id: null,
            workflow_step_id: null,
            run_id: null,
            link_type: 'discussed_in',
          },
        );
        notifyLinkedWorkItemsChanged({
          projectId: selectedProjectId,
          sessionId: backendSession.id,
          workItemId: options.workItemId,
        });
      }

      showToast(
        t('createSession.taskSentToast', {
          member: options.memberName ?? t('createSession.memberFallback'),
        }),
        'success',
      );

      void refreshSessions();
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : String(err ?? 'Failed to create session'),
        'error',
      );
    }
  };

  const handleSidebarResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: desktopSidebarWidth,
      scale: appScale.enabled ? appScale.scale : 1,
    };
    setIsSidebarResizing(true);
  };

  const handleSidebarProjectAction = (actionId: string) => {
    const messages: Record<string, string> = {
      history: t("toast.historyPlaceholder"),
    };
    showToast(messages[actionId] ?? t("toast.projectActionPlaceholder"));
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    const selectedProject = projects.find(
      (project) => project.id === projectId,
    );
    const projectName = selectedProject
      ? projectDisplayName(selectedProject)
      : projectId;
    showToast(
      translate("toast.projectSelected", `Switched to ${projectName}`, {
        name: projectName,
      }),
    );
    closeMobileSidebar();
  };

  const chatPresets = useMemo(
    () =>
      (config as { chat_presets?: ChatPresetConfigView } | null)
        ?.chat_presets ?? {},
    [config],
  );
  const configuredTeamPresets = useMemo(
    () =>
      (chatPresets.teams ?? []).filter((preset) => preset.enabled !== false),
    [chatPresets.teams],
  );

  useEffect(() => {
    let cancelled = false;
    void teamPresetsApi
      .list(locale)
      .then((response) => {
        if (!cancelled) setLocalizedTeamPresetSummaries(response.teams);
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalizedTeamPresetSummaries([]);
          console.error('Failed to load localized team templates', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const teamPresets = useMemo(() => {
    const localizedById = new Map(
      localizedTeamPresetSummaries.map((preset) => [preset.id, preset]),
    );
    return configuredTeamPresets.map((preset) => {
      const localized = localizedById.get(preset.id);
      return localized
        ? {
            ...preset,
            name: localized.name,
            description: localized.description,
            team_protocol: localized.team_protocol,
            enabled: localized.enabled,
            tier: localized.tier,
          }
        : preset;
    });
  }, [configuredTeamPresets, localizedTeamPresetSummaries]);

  const handleCreateProject = async (
    data: CreateProjectRequest,
    options?: CreateProjectOptions,
  ) => {
    const project = await createProject(data);
    const selectedTeamId = options?.teamId || blankTeamId;
    const selectedTeamPreset = teamPresets.find(
      (preset) => preset.id === selectedTeamId,
    );
    const selectedTeamProtocol = selectedTeamPreset?.team_protocol?.trim() ?? "";
    const runtimes = await loadRuntimeStatuses();
    let templateMemberCount: number | null = null;
    let teamSetupFailed = false;

    if (selectedTeamPreset) {
      try {
        templateMemberCount = await createTeamPresetMembers(
          project.id,
          data.default_workspace_path,
          selectedTeamPreset,
          runtimes,
          {
            forceWorkspacePath: options?.forceMemberWorkspacePath === true,
            memberConfig: options?.onboardingTeamConfig,
          },
        );
        if (templateMemberCount === 0) {
          teamSetupFailed = true;
        }
      } catch (err) {
        teamSetupFailed = true;
        console.error("Failed to create team preset members", err);
      }
    } else {
      console.error("Selected team preset was not returned by the backend", {
        selectedTeamId,
      });
      teamSetupFailed = true;
    }
    if (selectedTeamProtocol) {
      try {
        await projectApi.updateTeamProtocol(project.id, {
          content: selectedTeamProtocol,
          enabled: true,
        });
      } catch (err) {
        teamSetupFailed = true;
        console.error("Failed to save project team protocol", err);
      }
    }
    const createdProjectToast = teamSetupFailed
      ? translate(
          "toast.projectCreatedTeamSetupFailed",
          `Created ${project.name}, but team setup failed`,
          {
            name: project.name,
          },
        )
      : selectedTeamPreset && templateMemberCount
        ? translate(
            "toast.projectCreatedWithTeam",
            `Created ${project.name} with ${selectedTeamPreset.name}`,
            {
              name: project.name,
              team: selectedTeamPreset.name,
              count: templateMemberCount,
            },
          )
        : translate("toast.projectCreated", `Created ${project.name}`, {
              name: project.name,
            });
    showToast(createdProjectToast, teamSetupFailed ? 'warning' : 'success');
    if (options?.createDefaultSession) {
      await handleCreateDefaultSession({
        projectId: project.id,
        workspacePath: data.default_workspace_path,
      });
    }
    closeMobileSidebar();
    return { project };
  };

  const handleUpdateProject = async (
    projectId: string,
    data: UpdateProject,
  ) => {
    const project = await projectApi.updateProject(projectId, data);
    await refreshProjects();
    const projectName = projectDisplayName(project);
    showToast(
      translate("toast.projectUpdated", `Updated ${projectName}`, {
        name: projectName,
      }),
      'success',
    );
  };

  const handleDeleteProject = async (projectId: string) => {
    const deletingProject = projects.find(
      (project) => project.id === projectId,
    );
    const projectName = deletingProject
      ? projectDisplayName(deletingProject)
      : projectId;
    await projectApi.deleteProject(projectId);
    if (selectedProjectId === projectId) {
      const nextProject = projects.find((project) => project.id !== projectId);
      setSelectedProjectId(nextProject?.id ?? "");
    }
    await refreshProjects();
    await refreshSessions();
    showToast(
      translate("toast.projectDeleted", `Deleted ${projectName}`, {
        name: projectName,
      }),
      'success',
    );
  };

  const handleOnboardingCompleted = async (
    nextState: OnboardingState,
    options?: {
      createDefaultSession?: boolean;
      projectId?: string | null;
      workspacePath?: string | null;
    },
  ) => {
    setOnboardingState(nextState);
    setIsCreateSessionModalOpen(false);
    closeMobileSidebar();
    if (options?.createDefaultSession) {
      await handleCreateDefaultSession({
        projectId:
          options.projectId ??
          nextState.created_project_id ??
          selectedProjectId,
        workspacePath:
          options.workspacePath ??
          nextState.project_path ??
          activeProjectWorkspacePath,
      });
      startOnboardingAppTransition();
    }
    setOnboardingOverlay(null);
  };

  const handleCreateOnboardingProject = async ({
    name,
    path,
    teamId,
    teamConfig,
  }: {
    name: string;
    path: string;
    teamId: string | null;
    teamConfig: OnboardingTeamMemberConfig[];
  }) => {
    const { project } = await handleCreateProject(
      {
        name,
        repositories: [],
        description: null,
        status: null,
        default_workspace_path: path,
        active_repo_id: null,
      },
      {
        teamId: teamId ?? blankTeamId,
        forceMemberWorkspacePath: true,
        onboardingTeamConfig: teamConfig,
      },
    );
    return { projectId: project.id, sessionId: null };
  };

  const handleOnboardingPreviewAppearanceChange = (
    appearance: OnboardingAppearance,
  ) => {
    if (appearance === OnboardingAppearance.light) {
      setTheme("light");
      return;
    }
    if (appearance === OnboardingAppearance.system) {
      setTheme("system");
      return;
    }
    setTheme("dark");
  };

  const handleOnboardingStateChange = (nextState: OnboardingState) => {
    setOnboardingState(nextState);
  };

  const currentProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const activeProjectName = currentProject
    ? projectDisplayName(currentProject)
    : shellOptions?.projects.find((project) => project.active)?.label;
  const activeProjectWorkspacePath =
    currentProject?.default_workspace_path ?? null;

  const projectSidebarProps = {
    shellOptions,
    projects,
    selectedProjectId,
    projectsLoading: projectsAsync.loading,
    projectsError: projectsAsync.error,
    sessions,
    activeSessionId,
    activePage: activeAppPage,
    weeklyCost,
    t,
    onNavigate: handleSidebarNavigate,
    onSessionSelect: handleSidebarSessionSelect,
    onPrimaryAction: handlePrimarySidebarAction,
    onProjectAction: handleSidebarProjectAction,
    onProjectSelect: handleProjectSelect,
    onRenameSession: renameSession,
    onArchiveSession: archiveSession,
    onPinSession: pinSession,
    onDeleteSession: deleteSession,
    onCreateProject: handleCreateProject,
    onUpdateProject: handleUpdateProject,
    onDeleteProject: handleDeleteProject,
    inboxSummary: inboxSummaryAsync.data,
    inboxItems: inboxItemsAsync.data,
    inboxLoading: inboxSummaryAsync.loading || inboxItemsAsync.loading,
    inboxError: inboxSummaryAsync.error ?? inboxItemsAsync.error,
    onRefreshInbox: refreshInbox,
    onInboxItemOpen: handleInboxItemOpen,
    onMarkInboxItemRead: markInboxItemRead,
    onMarkAllInboxRead: markAllInboxRead,
    onArchiveInboxItem: archiveInboxItem,
    teamPresets,
  };
  return (
    <div
      className={`h-full w-full flex bg-[var(--canvas)] text-[var(--ink)] font-sans antialiased overflow-hidden selection:bg-[var(--primary)] selection:text-white transition-colors duration-200 ${
        onboardingAppTransitionActive ? "animate-onboarding-app-enter" : ""
      }`}
    >
      {toast && (
        <NotificationToast message={toast.message} tone={toast.tone} />
      )}
      {versionUpdate.reminder && (
        <NotificationToast
          title={t('onboarding.upgrade.toastTitle', {
            version: versionUpdate.reminder.latest_version,
          })}
          message={t('onboarding.upgrade.toastMessage', {
            current: versionUpdate.reminder.current_version,
            latest: versionUpdate.reminder.latest_version,
          })}
          tone="info"
          actionLabel={t('onboarding.upgrade.toastAction')}
          onAction={versionUpdate.openUpdatePage}
          secondaryActionLabel={t('onboarding.upgrade.later')}
          onSecondaryAction={versionUpdate.snooze}
          onClose={versionUpdate.snooze}
          closeAriaLabel={t('toast.dismissNotification')}
          className="min-h-[92px] max-w-[min(430px,calc(100vw-40px))] py-4"
        />
      )}

      <CreateAgentSessionModal
        open={isCreateSessionModalOpen}
        projectId={selectedProjectId}
        projectName={activeProjectName}
        workspacePath={activeProjectWorkspacePath}
        workflowWorkspacePath={
          createSessionWorkspaceLookup.workflowWorkspacePath ??
          activeProjectWorkspacePath
        }
        memberWorkspacePaths={createSessionWorkspaceLookup.memberWorkspacePaths}
        members={createSessionMembers}
        leadMember={leadMember}
        t={t}
        onClose={() => setIsCreateSessionModalOpen(false)}
        onCreate={handleCreateAgentSession}
      />

      <GlobalSearchDialog
        open={isGlobalSearchOpen}
        projectId={selectedProjectId}
        onClose={() => setIsGlobalSearchOpen(false)}
        onOpenResult={handleGlobalSearchResultOpen}
        translate={translate}
      />

      {onboardingOverlay?.mode === "onboarding" && (
        <OnboardingGuide
          initialState={onboardingOverlay.state ?? onboardingState}
          locale={locale}
          theme={theme}
          themePreference={themePreference}
          t={t}
          teamPresets={teamPresets}
          onCreateProjectFromOnboarding={handleCreateOnboardingProject}
          onPreviewLocaleChange={setLocale}
          onPreviewAppearanceChange={handleOnboardingPreviewAppearanceChange}
          onClose={() => setOnboardingOverlay(null)}
          onComplete={handleOnboardingCompleted}
          onStateChange={handleOnboardingStateChange}
        />
      )}
      {onboardingOverlay?.mode === "upgrade" && (
        <VersionUpdatePage
          currentVersion={currentUpgradeVersion}
          theme={theme}
          t={t}
          onClose={() => setOnboardingOverlay(null)}
          versionUpdateInfo={versionUpdate.info}
          versionUpdateCheckStatus={versionUpdate.checkStatus}
          versionUpdateCheckError={versionUpdate.checkError}
          versionUpdateState={versionUpdate.operation}
          versionUpdateBusy={versionUpdate.isBusy}
          onInstallUpdate={versionUpdate.executeUpdate}
          onCheckUpdate={versionUpdate.checkNow}
          onOpenManualFallback={versionUpdate.openManualFallback}
          manualFallbackAvailable={versionUpdate.manualFallbackAvailable}
        />
      )}

      <aside
        className="relative h-full hidden md:block shrink-0"
        style={{ width: desktopSidebarWidth }}
      >
        <ProjectSidebar {...projectSidebarProps} />
        <button
          type="button"
          className="group absolute -right-3 top-3 bottom-3 z-20 flex w-3 cursor-col-resize items-stretch justify-end outline-none"
          aria-label={translate("aria.resizeSidebar", "Resize sidebar")}
          data-sidebar-resize-handle="true"
          onPointerDown={handleSidebarResizePointerDown}
        >
          <span
            className={`h-full w-1 rounded-full transition-colors ${
              isSidebarResizing
                ? "bg-[var(--hairline-tertiary)]"
                : "bg-transparent group-hover:bg-[var(--hairline-tertiary)] group-focus-visible:bg-[var(--hairline-tertiary)]"
            }`}
          />
        </button>
      </aside>

      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden animate-fade-in">
          <div
            onClick={() => setIsMobileSidebarOpen(false)}
            className="absolute inset-0 bg-[#000000]/40 backdrop-blur-xs"
          />
          <div className="absolute top-0 left-0 bottom-0 w-64 bg-[var(--canvas)] animate-fade-in-right">
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-1 rounded border border-[var(--hairline)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] cursor-pointer"
                aria-label={t("aria.closeNavigationDrawer")}
              >
                <X className="h-4 w-4 text-[var(--ink-subtle)]" />
              </button>
            </div>
            <ProjectSidebar {...projectSidebarProps} />
          </div>
        </div>
      )}

      <div className="flex-1 h-full min-w-0 overflow-hidden bg-[var(--canvas)] p-2 md:p-3">
        <section className="flex h-full min-h-0 flex-col overflow-hidden gap-1">
          <header className="h-8 bg-[var(--canvas)] flex items-center justify-between shrink-0 select-none z-10">
            <div className="flex items-center gap-3 flex-1 min-w-0 h-full">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className="p-1.5 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] md:hidden hover:bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:text-[var(--ink)] cursor-pointer shrink-0"
                aria-label={t("aria.toggleNavigationDrawer")}
              >
                <Menu className="h-4 w-4" />
              </button>

              <nav className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
                <div className="flex h-8 w-full max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-md bg-[var(--canvas)]">
                  {renderedTabs.map(({ tab, label, Icon }) => {
                    const active = tab.id === activeTabId;
                    return (
                      <div
                        key={tab.id}
                        style={{ flex: "1 1 clamp(7rem, 22%, 15rem)" }}
                        className={`group flex h-8 min-w-0 max-w-60 items-center gap-2 rounded-md border px-2.5 text-left text-[11px] transition cursor-pointer relative ${
                          active
                            ? "border-transparent bg-[var(--surface-3)] text-[var(--ink)] font-semibold shadow-sm"
                            : "border-transparent bg-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)] opacity-75 hover:opacity-100"
                        }`}
                        onClick={() => {
                          setActiveTabId(tab.id);
                          if (
                            tab.kind === "session" ||
                            tab.kind === "worktree-conflicts"
                          ) {
                            setActiveSessionId(tab.sessionId);
                          }
                          setIsMobileSidebarOpen(false);
                        }}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 shrink-0 transition-colors ${active ? "text-[var(--primary)]" : "text-[var(--ink-tertiary)] group-hover:text-[var(--ink-subtle)]"}`}
                        />
                        <span className="truncate flex-1 pr-4">{label}</span>
                        <button
                          type="button"
                          className={`absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-sm hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ${active ? "text-[var(--ink-subtle)] opacity-100" : "text-[var(--ink-tertiary)]"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseTab(tab);
                          }}
                          aria-label={t("aria.closeTab")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={handleAddSessionTab}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                    aria-label={t("aria.openSessionTab")}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </nav>
            </div>
          </header>

          <main
            ref={mainContentRef}
            id="app-main-content"
            tabIndex={-1}
            data-shortcut-focus="tab-main-content"
            className={`relative flex-1 min-h-0 rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] outline-none ${
              activeAppPage === "providers" ||
              activeAppPage === "build-stats" ||
              activeAppPage === "github" ||
              activeAppPage === "issue" ||
              activeAppPage === "agents" ||
              activeAppPage === "team" ||
              activeAppPage === "team-templates" ||
              activeAppPage === "workspace" ||
              activeTab?.kind === "diff" ||
              activeTab?.kind === "sc-diff" ||
              activeTab?.kind === "worktree-conflicts"
                ? "overflow-hidden p-0"
                : "overflow-y-auto p-4 md:p-6"
            }`}
          >
            {renderActivePage()}
          </main>
        </section>
      </div>
    </div>
  );
}

let didLogShortcutPlatformFallback = false;

function ShortcutProviderBridge({ children }: React.PropsWithChildren) {
  const { config, environment, saveConfigPatch, showToast, t } = useWorkspace();
  const runtime = React.useMemo(
    () =>
      detectShortcutRuntime({
        osType: environment?.os_type,
        userAgentDataPlatform: (
          navigator as Navigator & { userAgentData?: { platform?: string } }
        ).userAgentData?.platform,
        navigatorPlatform: navigator.platform,
        userAgent: navigator.userAgent,
        hasTauriInvoke: getTauriInvoke() !== null,
      }),
    [environment?.os_type],
  );
  useEffect(() => {
    if (
      import.meta.env.DEV &&
      runtime.source === "fallback" &&
      !didLogShortcutPlatformFallback
    ) {
      didLogShortcutPlatformFallback = true;
      console.debug("shortcut_platform_fallback");
    }
  }, [runtime.source]);
  return (
    <ShortcutProvider
      runtime={runtime}
      translate={t}
      config={config}
      saveConfigPatch={saveConfigPatch}
      showToast={showToast}
    >
      {children}
      <ShortcutOverlays />
    </ShortcutProvider>
  );
}

export default function App() {
  return (
    <>
      <div className="macos-titlebar-drag-region" data-tauri-drag-region />
      <AppScaleFrame>
        <RunActivityProvider>
          <WorkspaceProvider>
            <ShortcutProviderBridge>
              <WorkspaceLayout />
            </ShortcutProviderBridge>
          </WorkspaceProvider>
        </RunActivityProvider>
      </AppScaleFrame>
    </>
  );
}
