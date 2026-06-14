import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkspaceProvider, useWorkspace } from "@/context/WorkspaceContext";
import { AppScaleContext } from "@/context/AppScaleContext";
import { WorkflowWorkspace } from "@/components/WorkflowWorkspace";
import { CreateAgentSessionModal } from "@/components/CreateAgentSessionModal";
import { DialogManager } from "@/components/DialogManager";
import { DiffViewTab } from "@/components/DiffViewTab";
import { NotificationToast } from "@/components/NotificationToast";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { GitHubRepositoryPage } from "@/pages/GitHubRepositoryPage";
import { IssuePage } from "@/pages/IssuePage";
import { RoutingPage } from "@/pages/RoutingPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TasksPage } from "@/pages/TasksPage";
import { BuildStatsPage } from "@/pages/BuildStatsPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { TeamPage } from "@/pages/TeamPage";
import { TeamTemplatesPage } from "@/pages/TeamTemplatesPage";
import {
  Activity,
  BookOpen,
  Bot,
  Box,
  FileText,
  Github,
  Menu,
  Network,
  Plus,
  Route,
  Settings2,
  SquareCheckBig,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  chatAgentsApi,
  chatMessagesApi,
  chatSessionsApi,
  projectApi,
  projectWorkItemsApi,
} from "@/lib/api";
import {
  ISSUE_NAVIGATION_EVENT,
  ISSUE_NAVIGATION_TARGET_CHANGED_EVENT,
  storeIssueNavigationTarget,
  type IssueNavigationTarget,
} from "@/lib/issueNavigation";
import { notifyLinkedWorkItemsChanged } from "@/lib/linkedWorkItemsEvents";
import { mapSession } from "@/lib/mappers";
import { mockFrontendApi } from "@/lib/mockFrontendApi";
import { projectDisplayName } from "@/lib/projectDisplay";
import type { ShellOptionsMock } from "@/mockApiData";
import {
  ProjectMemberType,
  type ChatTeamPreset,
  type CreateProjectRequest,
  type ProjectMemberWithRuntime,
  type UpdateProject,
} from "../../shared/types";
import type {
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
    };

type RenderedWorkspaceTab = {
  tab: WorkspaceTab;
  label: string;
  Icon: LucideIcon;
};

const pageTabConfig: Record<
  SidebarNavigationTarget,
  { label: string; icon: LucideIcon }
> = {
  workspace: { label: "Workspace", icon: Network },
  issue: { label: "Issues", icon: FileText },
  team: { label: "Members", icon: Users },
  "team-templates": { label: "Team templates", icon: Users },
  tasks: { label: "Action center", icon: SquareCheckBig },
  routing: { label: "Routing engine", icon: Route },
  github: { label: "GitHub", icon: Github },
  providers: { label: "Settings", icon: Settings2 },
  tokens: { label: "Skill library", icon: BookOpen },
  agents: { label: "Agents", icon: Bot },
  "build-stats": { label: "Build Statistics", icon: Activity },
};

const createSessionTabId = (sessionId: string) => `session:${sessionId}`;
const createPageTabId = (page: SidebarNavigationTarget) => `page:${page}`;

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

const findWorkflowProjectAgent = (projectMembers: ProjectMemberWithRuntime[]) =>
  projectMembers.find(
    (member) =>
      member.member_type === ProjectMemberType.agent &&
      member.role === "lead",
  ) ??
  projectMembers.find(
    (member) => member.member_type === ProjectMemberType.agent,
  );

const clampSidebarWidth = (width: number) =>
  Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));

const clampAppScale = (scale: number) =>
  Math.min(maxAppScale, Math.max(minAppScale, scale));

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
  const viewportHeight = window.innerHeight;
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
    members,
    refreshMembers,
    activeSessionId,
    setActiveSessionId,
    weeklyCost,
    showToast,
  } = useWorkspace();
  const appScale = React.useContext(AppScaleContext);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [desktopSidebarWidth, setDesktopSidebarWidth] =
    useState(defaultSidebarWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isCreateSessionModalOpen, setIsCreateSessionModalOpen] =
    useState(false);
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
  const sidebarResizeRef = useRef({
    startX: 0,
    startWidth: defaultSidebarWidth,
    scale: 1,
  });

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

  useEffect(() => {
    if (!selectedProjectId) {
      setLeadMember(null);
      return;
    }
    setLeadMember(null);
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
    loadLeadMember,
    refreshMembers,
    selectedProjectId,
  ]);

  const translate = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const translated = t(key, replacements);
    return translated && translated !== key ? translated : fallback;
  };

  const getPageTabLabel = (page: SidebarNavigationTarget) =>
    translate(`page.${page}`, pageTabConfig[page].label);

  useEffect(() => {
    void mockFrontendApi.getShellOptions().then(setShellOptions);
  }, []);

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
        (tab) => tab.kind !== "session" || sessionIds.has(tab.sessionId),
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
      return (
        <DiffViewTab
          filePath={activeTab.filePath}
          status={activeTab.status}
          unifiedDiff={activeTab.unified_diff}
        />
      );
    }
    if (activeTab?.kind === "sc-diff") {
      return (
        <DiffViewTab
          sourceControlRef={{
            projectId: activeTab.projectId,
            sessionId: activeTab.sessionId,
            filePath: activeTab.filePath,
            area: activeTab.area,
          }}
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
      case "tasks":
        return <TasksPage />;
      case "routing":
        return <RoutingPage />;
      case "github":
        return <GitHubRepositoryPage />;
      case "providers":
        return <SettingsPage />;
      case "build-stats":
        return <BuildStatsPage />;
      case "tokens":
        return (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="pb-4 mb-2 select-all">
              <h1 className="text-base font-bold tracking-tight text-[var(--ink)]">
                Dialog Manager
              </h1>
              <p className="text-xs text-[var(--ink-subtle)] mt-1">
                DialogManager.tsx UI content preview for the skill library tab.
              </p>
            </div>
            <DialogManager preview />
          </div>
        );
      case "agents":
        return <AgentsPage />;
      case "workspace":
      default:
        return (
          <div className="h-full w-full flex flex-col min-h-0">
            <WorkflowWorkspace
              onOpenDiffTab={openDiffTab}
              onOpenSourceControlDiffTab={openSourceControlDiffTab}
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
      if (!target?.workItemId) return;

      storeIssueNavigationTarget(target);
      if (target.projectId && target.projectId !== selectedProjectId) {
        setSelectedProjectId(target.projectId);
      }
      openPageTab("issue", getPageTabLabel("issue"));
      window.dispatchEvent(
        new CustomEvent(ISSUE_NAVIGATION_TARGET_CHANGED_EVENT),
      );
    };
    window.addEventListener(
      "openteams:navigate-session",
      handleNavigateSession,
    );
    window.addEventListener(ISSUE_NAVIGATION_EVENT, handleNavigateIssue);
    return () => {
      window.removeEventListener(
        "openteams:navigate-session",
        handleNavigateSession,
      );
      window.removeEventListener(ISSUE_NAVIGATION_EVENT, handleNavigateIssue);
    };
  });

  const createDiffTabId = (sessionId: string, filePath: string) =>
    `diff:${sessionId}:${filePath}`;
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
  ) => {
    const nextTab: WorkspaceTab = {
      id: createDiffTabId(sessionId, filePath),
      kind: "diff",
      sessionId,
      filePath,
      status,
      unified_diff,
    };
    setOpenTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === nextTab.id)) return currentTabs;
      return [...currentTabs, nextTab];
    });
    setActiveTabId(nextTab.id);
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
    setOpenTabs((currentTabs) => {
      if (currentTabs.some((tab) => tab.id === nextTab.id)) return currentTabs;
      return [...currentTabs, nextTab];
    });
    setActiveTabId(nextTab.id);
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

    openPageTab(item.targetPage, item.label);
    closeMobileSidebar();
  };

  const handleSidebarSessionSelect = (sessionId: string) => {
    replaceActiveTab(createSessionTab(sessionId));
    setActiveSessionId(sessionId);
    closeMobileSidebar();
  };

  const handleAddSessionTab = () => {
    const nextSession = sessions.find(
      (session) => !openSessionTabIds.includes(session.id),
    );

    if (!nextSession) {
      showToast(t("toast.allSessionsOpen"));
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
      showToast(t("toast.keepOneTab"));
      return;
    }

    const closingIndex = openTabs.findIndex((tab) => tab.id === closingTab.id);
    const nextTabs = openTabs.filter((tab) => tab.id !== closingTab.id);

    setOpenTabs(nextTabs);

    if (closingTab.id === activeTabId) {
      const nextActiveTab =
        nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0];
      setActiveTabId(nextActiveTab.id);
      if (nextActiveTab.kind === "session") {
        setActiveSessionId(nextActiveTab.sessionId);
      }
    }
  };

  const handlePrimarySidebarAction = (action: SidebarPrimaryAction) => {
    if (action.id === "new-session") {
      setIsCreateSessionModalOpen(true);
      closeMobileSidebar();
      return;
    }
    showToast(translate(`sidebar.primary.${action.id}.helper`, action.helper));
    closeMobileSidebar();
  };

  const handleCreateAgentSession = async (
    prompt: string,
    options: {
      taskMode: 'workflow' | 'freeChat';
      memberId?: string;
      memberName?: string;
      workItemId?: string;
    },
  ) => {
    if (!selectedProjectId) {
      showToast(
        translate(
          'createSession.noProject',
          'Please select a project first',
        ),
      );
      return;
    }

    try {
      let workspacePath: string | null = null;
      let workflowLeadAgentId: string | null = null;
      try {
        const projectMembers = await projectApi.listMembers(selectedProjectId);
        if (options.taskMode === 'workflow') {
          const workflowProjectAgent = findWorkflowProjectAgent(projectMembers);
          workspacePath = workflowProjectAgent?.default_workspace_path ?? null;
          workflowLeadAgentId = workflowProjectAgent?.agent_id ?? null;
        } else {
          const normalizedName = options.memberName?.replace(/^@/, '').toLowerCase();
          const matched = projectMembers.find((pm) => {
            if (normalizedName && pm.member_name) {
              return pm.member_name.replace(/^@/, '').toLowerCase() === normalizedName;
            }
            return false;
          });
          workspacePath = matched?.default_workspace_path ?? null;
        }
      } catch {}

      const backendSession = await projectApi.createSession(
        selectedProjectId,
        {
          title: prompt,
          workspace_path: workspacePath,
        },
      );

      const mappedSession = mapSession(backendSession, {
        activeSessionId: backendSession.id,
      });

      setSessions((prev) => [
        mappedSession,
        ...prev.map((s) => ({ ...s, active: false })),
      ]);

      replaceActiveTab(createSessionTab(backendSession.id));
      setActiveSessionId(backendSession.id);
      closeMobileSidebar();

      if (prompt.trim()) {
        try {
          let content = prompt;
          const meta: { [key: string]: JsonValue } = {};

          if (options.taskMode === 'workflow') {
            meta.chat_input_mode = 'workflow';
            if (workflowLeadAgentId) {
              await chatSessionsApi
                .update(backendSession.id, {
                  title: null,
                  status: null,
                  lead_agent_id: workflowLeadAgentId,
                  summary_text: null,
                  archive_ref: null,
                  last_seen_diff_key: null,
                  team_protocol: null,
                  team_protocol_enabled: null,
                  default_workspace_path: null,
                  chat_input_mode: null,
                })
                .catch(() => undefined);
            }
          }

          if (options.taskMode === 'freeChat' && options.memberName) {
            const handle = options.memberName.startsWith('@')
              ? options.memberName
              : `@${options.memberName}`;
            if (!content.toLowerCase().includes(handle.toLowerCase())) {
              content = `${handle} ${content}`;
            }
            const mentionName = options.memberName.replace(/^@/, '');
            meta.mentions = [mentionName.toLowerCase()];
          }

          await chatMessagesApi.send(backendSession.id, {
            sender_type: 'user',
            sender_id: null,
            content,
            meta: Object.keys(meta).length > 0 ? meta : null,
          });
        } catch {}
      }

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
      );

      void refreshSessions();
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : String(err ?? 'Failed to create session'),
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

  const handleCreateProject = async (data: CreateProjectRequest) => {
    const project = await createProject(data);
    const session = await projectApi.createSession(project.id, {
      title: null,
      workspace_path: data.default_workspace_path,
    });
    const mappedSession = mapSession(session, {
      activeSessionId: session.id,
    });
    setSessions((currentSessions) => [
      mappedSession,
      ...currentSessions
        .filter((item) => item.id !== mappedSession.id)
        .map((item) => ({ ...item, active: false })),
    ]);
    replaceActiveTab(createSessionTab(session.id));
    setActiveSessionId(session.id);
    showToast(
      translate("toast.projectCreated", `Created ${project.name}`, {
        name: project.name,
      }),
    );
    closeMobileSidebar();
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
    );
  };

  const teamPresets =
    (config as { chat_presets?: { teams?: ChatTeamPreset[] } } | null)
      ?.chat_presets?.teams ?? [];

  const currentProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const activeProjectName = currentProject
    ? projectDisplayName(currentProject)
    : shellOptions?.projects.find((project) => project.active)?.label;

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
    onCreateProject: handleCreateProject,
    onUpdateProject: handleUpdateProject,
    onDeleteProject: handleDeleteProject,
    teamPresets,
  };
  return (
    <div className="h-full w-full flex bg-[var(--canvas)] text-[var(--ink)] font-sans antialiased overflow-hidden selection:bg-[var(--primary)] selection:text-white transition-colors duration-200">
      {toast && (
        <NotificationToast message={toast.message} tone={toast.tone} />
      )}

      {activeAppPage !== "tokens" && <DialogManager />}
      <CreateAgentSessionModal
        open={isCreateSessionModalOpen}
        projectId={selectedProjectId}
        projectName={activeProjectName}
        members={members}
        leadMember={leadMember}
        t={t}
        onClose={() => setIsCreateSessionModalOpen(false)}
        onCreate={handleCreateAgentSession}
      />

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
        <section className="flex h-full min-h-0 flex-col overflow-hidden gap-2">
          <header className="h-10 bg-[var(--canvas)] flex items-center justify-between shrink-0 select-none z-10">
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
                <div className="flex h-9 w-full max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-md bg-[var(--canvas)]">
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
                          if (tab.kind === "session") {
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
            id="app-main-content"
            className={`relative flex-1 min-h-0 rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] ${
              activeAppPage === "providers" ||
              activeAppPage === "build-stats" ||
              activeAppPage === "github" ||
              activeAppPage === "issue" ||
              activeAppPage === "agents" ||
              activeAppPage === "team" ||
              activeTab?.kind === "diff" ||
              activeTab?.kind === "sc-diff"
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

export default function App() {
  return (
    <AppScaleFrame>
      <WorkspaceProvider>
        <WorkspaceLayout />
      </WorkspaceProvider>
    </AppScaleFrame>
  );
}
