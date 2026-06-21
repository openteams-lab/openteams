import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ChevronUp,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Github,
  Hash,
  History,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  PlusCircle,
  Settings2,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  DirectoryEntry,
  Session,
  SidebarBuildStats,
  SidebarNavigationItem,
  SidebarNavigationTarget,
  SidebarPrimaryAction,
  SidebarProjectDisplay,
} from "@/types";
import { DropdownSelect, type DropdownSelectOption } from "./DropdownSelect";
import { useAppScale } from "@/context/AppScaleContext";
import { filesystemApi } from "@/lib/api";
import { buildStatsApi } from "@/lib/buildStatsApi";
import { onBuildStatsUpdated } from "@/lib/buildStatsEvents";
import { formatNumber } from "@/lib/buildStatsUtils";
import {
  projectDisplayDescription,
  projectDisplayName,
} from "@/lib/projectDisplay";
import type { ShellOptionsMock } from "@/mockApiData";
import type {
  ChatTeamPreset,
  CreateProjectRequest,
  Project,
  UpdateProject,
} from "../../../shared/types";

type EditableProjectDraft = {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  defaultWorkspacePath: string | null;
  activeRepoId: string | null;
};

type SessionContextMenuState = {
  sessionId: string;
  left: number;
  top: number;
};

interface ProjectSidebarProps {
  shellOptions: ShellOptionsMock | null;
  projects?: Project[];
  selectedProjectId?: string;
  projectsLoading?: boolean;
  projectsError?: string | null;
  sessions: Session[];
  activeSessionId: string;
  activePage: SidebarNavigationTarget;
  weeklyCost: number;
  t?: (key: string, replacements?: Record<string, string | number>) => string;
  onNavigate: (item: SidebarNavigationItem) => void;
  onSessionSelect: (sessionId: string) => void;
  onPrimaryAction: (action: SidebarPrimaryAction) => void;
  onProjectAction: (actionId: string) => void;
  onProjectSelect?: (projectId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession?: (sessionId: string) => Promise<void>;
  onDeleteSession?: (sessionId: string) => Promise<void>;
  onCreateProject?: (
    data: CreateProjectRequest,
    options?: { teamId?: string },
  ) => Promise<void>;
  onUpdateProject?: (projectId: string, data: UpdateProject) => Promise<void>;
  onDeleteProject?: (projectId: string) => Promise<void>;
  teamPresets?: ChatTeamPreset[];
}

const primaryActionIcons: Record<SidebarPrimaryAction["icon"], LucideIcon> = {
  inbox: Inbox,
  "plus-circle": PlusCircle,
};

const navigationIcons: Record<string, LucideIcon> = {
  bot: Bot,
  "file-text": FileText,
  github: Github,
  settings: Settings2,
  users: Users,
};

const topControlClass =
  "flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--ink-tertiary)] transition hover:border-[var(--hairline)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]";

const sectionLabelClass =
  "px-2 text-[14px] font-medium uppercase tracking-[0.04em] text-[var(--ink-tertiary)]";

const sidebarItemClass =
  "flex w-full items-center gap-[6px] rounded-sm border px-[7px] py-[4px] text-left text-[14px] leading-[1.4] transition";

const visibleSessionLimit = 6;
const blankTeamId = "blank_team";

const hasRunningSessionActivity = (session: Session): boolean =>
  Boolean(session.hasRunningAgent || session.hasRunningWorkflow);

const hasSidebarPrioritySessionActivity = (session: Session): boolean =>
  hasRunningSessionActivity(session) ||
  Boolean(session.hasPendingWorkflowInput) ||
  Boolean(session.hasPendingWorkflowReview);

const prioritizeRunningSessions = (sessions: Session[]): Session[] => [
  ...sessions.filter(hasSidebarPrioritySessionActivity),
  ...sessions.filter((session) => !hasSidebarPrioritySessionActivity(session)),
];

const blankTeamOptions: DropdownSelectOption[] = [
  {
    id: blankTeamId,
    label: "Blank team",
    description: "One starter AI member",
    hint: "1",
  },
];

const getNavigationIcon = (icon: string): LucideIcon =>
  navigationIcons[icon] ?? CircleDot;

const projectMonogram = (name: string): string => {
  const letters = name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
  return (letters || name).slice(0, 2).toUpperCase();
};

const projectDisplayFromApi = (
  project: Project,
  selectedProjectId?: string,
): SidebarProjectDisplay => {
  const label = projectDisplayName(project);
  return {
    id: project.id,
    label,
    active: project.id === selectedProjectId,
    monogram: projectMonogram(label),
    repository: project.default_workspace_path ?? "",
    description: projectDisplayDescription(project),
  };
};

const getParentPath = (path: string): string => {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";

  const slash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (slash < 0) return "";
  if (slash === 0) return "/";
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, slash))) {
    return `${trimmed.slice(0, slash)}\\`;
  }
  return trimmed.slice(0, slash);
};

const directoryEntryTime = (entry: DirectoryEntry): number =>
  typeof entry.last_modified === "number" ? entry.last_modified : 0;

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" data-section={title}>
      <div className={sectionLabelClass}>{title}</div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function SidebarNavigationButton({
  item,
  label,
  badge,
  title,
  active,
  onClick,
}: {
  item: SidebarNavigationItem;
  label: string;
  badge?: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = getNavigationIcon(item.icon);

  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={onClick}
      title={title}
      className={`${sidebarItemClass} ${
        active
          ? "border-[var(--hairline)] bg-[var(--surface-1)] font-medium text-[var(--ink)]"
          : "border-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
      } ${item.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${
          active ? "text-[var(--primary)]" : "text-[var(--ink-tertiary)]"
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]">
          {badge}
        </span>
      )}
    </button>
  );
}

const ZERO_BUILD_STATS: SidebarBuildStats = {
  title: 'Build stats',
  defaultExpanded: true,
  summary: '',
  stats: [
    {
      id: 'features',
      label: 'Features shipped',
      value: '0',
      helper: '',
      tone: 'success',
    },
    {
      id: 'bugs-fixed',
      label: 'Bugs fixed',
      value: '0',
      helper: '',
      tone: 'accent',
    },
    {
      id: 'weekly-spend',
      label: 'Weekly spend',
      value: '$0.00',
      helper: '',
      tone: 'warning',
    },
  ],
};

export function ProjectSidebar({
  shellOptions,
  projects = [],
  selectedProjectId,
  projectsLoading = false,
  projectsError = null,
  sessions,
  activeSessionId,
  activePage,
  t,
  onNavigate,
  onSessionSelect,
  onPrimaryAction,
  onProjectAction,
  onProjectSelect,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  teamPresets = [],
}: ProjectSidebarProps) {
  const appScale = useAppScale();
  const projectSwitcherTriggerRef = useRef<HTMLButtonElement | null>(null);
  const projectSwitcherMenuRef = useRef<HTMLDivElement | null>(null);
  const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const [buildStatsVisible, setBuildStatsVisible] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [projectSwitcherPosition, setProjectSwitcherPosition] = useState({
    left: 0,
    top: 0,
    width: 280,
  });
  const [projectActionMenu, setProjectActionMenu] = useState<{
    projectId: string;
    left: number;
    top: number;
  } | null>(null);
  const [sessionContextMenu, setSessionContextMenu] =
    useState<SessionContextMenuState | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(
    null,
  );
  const [viewingSession, setViewingSession] = useState<Session | null>(null);
  const [copySessionIdState, setCopySessionIdState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameInFlight, setRenameInFlight] = useState(false);
  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(
    null,
  );
  const [deletingSession, setDeletingSession] = useState<Session | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState<string | null>(
    null,
  );
  const [deleteSessionInFlight, setDeleteSessionInFlight] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [editingProject, setEditingProject] =
    useState<EditableProjectDraft | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectWorkspacePath, setProjectWorkspacePath] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [workspaceBrowserOpen, setWorkspaceBrowserOpen] = useState(false);
  const [workspaceEntries, setWorkspaceEntries] = useState<DirectoryEntry[]>(
    [],
  );
  const [workspaceCurrentPath, setWorkspaceCurrentPath] = useState("");
  const [workspaceBrowserLoading, setWorkspaceBrowserLoading] = useState(false);
  const [workspaceBrowserError, setWorkspaceBrowserError] = useState<
    string | null
  >(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [deletingProjectDraft, setDeletingProjectDraft] =
    useState<SidebarProjectDisplay | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const [realBuildStats, setRealBuildStats] =
    useState<SidebarBuildStats | null>(null);
  const [buildStatsRefreshVersion, setBuildStatsRefreshVersion] = useState(0);
  const buildStatsProjectRef = useRef<string | null>(null);
  const portalTarget =
    appScale.portalRoot ??
    (typeof document === "undefined" ? null : document.body);
  const overlayScale =
    appScale.enabled && portalTarget === appScale.portalRoot
      ? appScale.scale
      : 1;
  const toOverlayValue = useCallback(
    (value: number) => value / overlayScale,
    [overlayScale],
  );
  const displayedProjects = useMemo(
    () =>
      projects.length > 0
        ? projects.map((project) =>
            projectDisplayFromApi(project, selectedProjectId),
          )
        : (shellOptions?.projects ?? []),
    [projects, selectedProjectId, shellOptions],
  );
  const activeProject = useMemo(
    () =>
      displayedProjects.find((project) =>
        selectedProjectId ? project.id === selectedProjectId : project.active,
      ) ?? displayedProjects[0],
    [displayedProjects, selectedProjectId],
  );
  const actionMenuProject = useMemo(
    () =>
      projectActionMenu
        ? displayedProjects.find(
            (project) => project.id === projectActionMenu.projectId,
          )
        : undefined,
    [displayedProjects, projectActionMenu],
  );
  const buildStats = realBuildStats ?? ZERO_BUILD_STATS;
  const orderedSessions = useMemo(
    () => prioritizeRunningSessions(sessions),
    [sessions],
  );
  const hasOverflowSessions = orderedSessions.length > visibleSessionLimit;
  const visibleSessions = sessionsExpanded
    ? orderedSessions
    : orderedSessions.slice(0, visibleSessionLimit);
  const menuSession = useMemo(
    () =>
      sessionContextMenu
        ? sessions.find((session) => session.id === sessionContextMenu.sessionId)
        : undefined,
    [sessionContextMenu, sessions],
  );
  const hiddenSessionCount = Math.max(
    orderedSessions.length - visibleSessionLimit,
    0,
  );
  const teamOptions = useMemo<DropdownSelectOption[]>(() => {
    const enabledTeamPresets = teamPresets.filter(
      (preset) => preset.enabled !== false,
    );
    return [
      ...blankTeamOptions,
      ...enabledTeamPresets.map((preset) => ({
        id: preset.id,
        label: preset.name,
        description: preset.description,
        hint: `${preset.member_ids.length}`,
      })),
    ];
  }, [teamPresets]);

  const translate = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const translated = t?.(key, replacements);
    return translated && translated !== key ? translated : fallback;
  };

  const copySessionIdLabel =
    copySessionIdState === "copied"
      ? translate("sidebar.sessionIdCopied", "Copied")
      : copySessionIdState === "error"
        ? translate("sidebar.sessionIdCopyFailed", "Copy failed")
        : translate("sidebar.copySessionId", "Copy");

  const sessionToggleLabel = sessionsExpanded
    ? translate("sidebar.less", "Less")
    : translate("sidebar.more", "More");
  const sessionToggleAriaLabel = sessionsExpanded
    ? translate("sidebar.collapseSessions", "Collapse sessions")
    : translate(
        "sidebar.showMoreSessions",
        `Show ${hiddenSessionCount} more sessions`,
        {
          count: hiddenSessionCount,
        },
      );

  const statValue = (_statId: string, value: string) => value;

  useEffect(() => {
    if (!selectedProjectId) {
      setRealBuildStats(null);
      buildStatsProjectRef.current = null;
      return;
    }

    let cancelled = false;
    const isProjectChanged =
      buildStatsProjectRef.current !== selectedProjectId;
    if (isProjectChanged) {
      setRealBuildStats(null);
      buildStatsProjectRef.current = selectedProjectId;
    }
    const loadSidebarBuildStats = async () => {
      try {
        const [activity, modelPricing] = await Promise.all([
          buildStatsApi.getActivity(selectedProjectId, "7d"),
          buildStatsApi.getModelPricing(selectedProjectId, "7d"),
        ]);
        if (cancelled) return;

        const activityDays = Array.isArray(activity?.days)
          ? activity.days
          : [];
        const featuresDelivered = activityDays.reduce(
          (sum, day) => sum + Number(day.features_delivered || 0),
          0,
        );
        const bugsFixed = activityDays.reduce(
          (sum, day) => sum + Number(day.bugs_fixed || 0),
          0,
        );
        const modelCost = (modelPricing?.models ?? []).reduce(
          (sum, model) => sum + Number(model.estimated_cost || 0),
          0,
        );

        setRealBuildStats({
          title: "Build stats",
          defaultExpanded: shellOptions?.buildStats?.defaultExpanded ?? true,
          summary: "",
          stats: [
            {
              id: "features",
              label: "Features shipped",
              value: formatNumber(featuresDelivered),
              helper: "Real feature delivery events in the last 7 days.",
              tone: "success",
            },
            {
              id: "bugs-fixed",
              label: "Bugs fixed",
              value: formatNumber(bugsFixed),
              helper: "Real bugfix delivery events in the last 7 days.",
              tone: "accent",
            },
            {
              id: "weekly-spend",
              label: "Weekly spend",
              value: `$${modelCost.toFixed(2)}`,
              helper: "Real 7-day model cost in USD from non-estimated token usage.",
              tone: "warning",
            },
          ],
        });
      } catch {
        if (!cancelled) {
          setRealBuildStats(null);
        }
      }
    };

    void loadSidebarBuildStats();
    return () => {
      cancelled = true;
    };
  }, [
    selectedProjectId,
    shellOptions?.buildStats?.defaultExpanded,
    buildStatsRefreshVersion,
  ]);

  useEffect(() => {
    if (!selectedProjectId) return undefined;
    return onBuildStatsUpdated((projectId) => {
      if (projectId === selectedProjectId) {
        setBuildStatsRefreshVersion((version) => version + 1);
      }
    });
  }, [selectedProjectId]);

  const openBuildStatsPage = () => {
    onNavigate({
      id: "build-stats",
      label: buildStats?.title ?? "Build stats",
      icon: "activity",
      helper: "Open build statistics",
      targetPage: "build-stats",
    });
  };

  const handleBuildStatsCardKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openBuildStatsPage();
  };

  const loadWorkspaceDirectory = useCallback(async (path?: string) => {
    setWorkspaceBrowserLoading(true);
    setWorkspaceBrowserError(null);
    try {
      const response = await filesystemApi.listDirectory(
        path?.trim() || undefined,
      );
      const sortedEntries = [...response.entries].sort((a, b) => {
        if (a.is_directory !== b.is_directory) {
          return a.is_directory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      setWorkspaceEntries(sortedEntries);
      setWorkspaceCurrentPath(response.current_path);
      setProjectWorkspacePath(response.current_path);
    } catch (err) {
      setWorkspaceBrowserError(
        err instanceof Error
          ? err.message
          : translate(
              "sidebar.workspaceReadFailed",
              "Workspace directory could not be read",
            ),
      );
    } finally {
      setWorkspaceBrowserLoading(false);
    }
  }, []);

  const loadWorkspaceRoots = useCallback(async () => {
    setWorkspaceBrowserLoading(true);
    setWorkspaceBrowserError(null);
    try {
      const roots = await filesystemApi.listRoots();
      setWorkspaceEntries(roots);
      setWorkspaceCurrentPath("");
    } catch (err) {
      setWorkspaceBrowserError(
        err instanceof Error
          ? err.message
          : translate(
              "sidebar.workspaceReadFailed",
              "Workspace roots could not be read",
            ),
      );
    } finally {
      setWorkspaceBrowserLoading(false);
    }
  }, []);

  const updateProjectSwitcherPosition = useCallback(() => {
    const trigger = projectSwitcherTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = toOverlayValue(window.innerWidth);
    const menuWidth = Math.min(240, Math.max(200, viewportWidth - 24));
    const rectLeft = toOverlayValue(rect.left);
    const left = Math.min(
      Math.max(12, rectLeft),
      Math.max(12, viewportWidth - menuWidth - 12),
    );

    setProjectSwitcherPosition({
      left,
      top: toOverlayValue(rect.bottom) + 4,
      width: menuWidth,
    });
  }, [toOverlayValue]);

  const toggleProjectSwitcher = () => {
    setProjectSwitcherOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) updateProjectSwitcherPosition();
      if (!nextOpen) setProjectActionMenu(null);
      return nextOpen;
    });
  };

  const draftFromProject = (
    project: SidebarProjectDisplay,
  ): EditableProjectDraft => {
    const apiProject = projects.find((item) => item.id === project.id);
    return {
      id: project.id,
      name: apiProject ? projectDisplayName(apiProject) : project.label,
      description: apiProject?.description ?? null,
      status: apiProject?.status ?? "active",
      defaultWorkspacePath:
        apiProject?.default_workspace_path ?? project.repository ?? null,
      activeRepoId: apiProject?.active_repo_id ?? null,
    };
  };

  const openProjectActionMenu = (
    project: SidebarProjectDisplay,
    trigger: HTMLElement,
  ) => {
    const rect = trigger.getBoundingClientRect();
    setProjectActionMenu({
      projectId: project.id,
      left: toOverlayValue(rect.right) + 6,
      top: toOverlayValue(rect.top),
    });
  };

  const closeProjectMenus = () => {
    setProjectSwitcherOpen(false);
    setProjectActionMenu(null);
  };

  const sessionErrorMessage = (error: unknown, fallback: string): string =>
    error instanceof Error ? error.message : fallback;

  const openSessionContextMenu = (
    session: Session,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    closeProjectMenus();
    setSessionActionError(null);

    const viewportWidth = toOverlayValue(window.innerWidth);
    const viewportHeight = toOverlayValue(window.innerHeight);
    const menuWidth = 180;
    const menuHeight = 164;
    setSessionContextMenu({
      sessionId: session.id,
      left: Math.min(
        Math.max(8, toOverlayValue(event.clientX)),
        Math.max(8, viewportWidth - menuWidth - 8),
      ),
      top: Math.min(
        Math.max(8, toOverlayValue(event.clientY)),
        Math.max(8, viewportHeight - menuHeight - 8),
      ),
    });
  };

  const startRenameSession = (session: Session) => {
    setRenamingSession(session);
    setRenameTitle(session.title);
    setRenameError(null);
    setSessionContextMenu(null);
    setSessionActionError(null);
  };

  const startViewSessionId = (session: Session) => {
    setViewingSession(session);
    setCopySessionIdState("idle");
    setSessionContextMenu(null);
    setSessionActionError(null);
  };

  const closeViewSessionIdDialog = () => {
    setViewingSession(null);
    setCopySessionIdState("idle");
  };

  const copyViewingSessionId = async () => {
    if (!viewingSession) return;
    setCopySessionIdState("idle");
    try {
      await navigator.clipboard.writeText(viewingSession.id);
      setCopySessionIdState("copied");
    } catch {
      setCopySessionIdState("error");
    }
  };

  const closeRenameDialog = () => {
    if (renameInFlight) return;
    setRenamingSession(null);
    setRenameTitle("");
    setRenameError(null);
  };

  const handleRenameSession = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    if (!renamingSession || !onRenameSession || !renameTitle.trim()) return;

    setRenameInFlight(true);
    setRenameError(null);
    try {
      await onRenameSession(renamingSession.id, renameTitle.trim());
      setRenamingSession(null);
      setRenameTitle("");
    } catch (error) {
      setRenameError(
        sessionErrorMessage(
          error,
          translate("sidebar.renameSessionFailed", "Failed to rename session"),
        ),
      );
    } finally {
      setRenameInFlight(false);
    }
  };

  const handleArchiveSession = async (session: Session) => {
    if (!onArchiveSession || archivingSessionId) return;

    setArchivingSessionId(session.id);
    setSessionActionError(null);
    try {
      await onArchiveSession(session.id);
      setSessionContextMenu(null);
    } catch (error) {
      setSessionActionError(
        sessionErrorMessage(
          error,
          translate("sidebar.archiveSessionFailed", "Failed to archive session"),
        ),
      );
    } finally {
      setArchivingSessionId(null);
    }
  };

  const startDeleteSession = (session: Session) => {
    setDeletingSession(session);
    setDeleteSessionError(null);
    setSessionContextMenu(null);
    setSessionActionError(null);
  };

  const closeDeleteSessionDialog = () => {
    if (deleteSessionInFlight) return;
    setDeletingSession(null);
    setDeleteSessionError(null);
  };

  const confirmDeleteSession = async () => {
    if (!deletingSession || !onDeleteSession) return;

    setDeleteSessionInFlight(true);
    setDeleteSessionError(null);
    try {
      await onDeleteSession(deletingSession.id);
      setDeletingSession(null);
    } catch (error) {
      setDeleteSessionError(
        sessionErrorMessage(
          error,
          translate("sidebar.deleteSessionFailed", "Failed to delete session"),
        ),
      );
    } finally {
      setDeleteSessionInFlight(false);
    }
  };

  const startEditProject = (project: SidebarProjectDisplay) => {
    const draft = draftFromProject(project);
    setEditingProject(draft);
    setProjectName(draft.name);
    setProjectWorkspacePath(draft.defaultWorkspacePath ?? "");
    setCreateError(null);
    setWorkspaceBrowserOpen(false);
    setCreateFormOpen(true);
    closeProjectMenus();
  };

  const startDeleteProject = (project: SidebarProjectDisplay) => {
    setDeletingProjectDraft(project);
    setDeleteError(null);
    closeProjectMenus();
  };

  const closeDeleteDialog = () => {
    if (deleteInFlight) return;
    setDeletingProjectDraft(null);
    setDeleteError(null);
  };

  const confirmDeleteProject = async () => {
    if (!onDeleteProject || !deletingProjectDraft) return;
    setDeleteInFlight(true);
    setDeleteError(null);
    try {
      await onDeleteProject(deletingProjectDraft.id);
      setDeletingProjectDraft(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : translate(
              "sidebar.deleteProjectFailed",
              "Failed to delete project",
            ),
      );
    } finally {
      setDeleteInFlight(false);
    }
  };

  const resetProjectForm = () => {
    setProjectName("");
    setProjectWorkspacePath("");
    setEditingProject(null);
  };

  useLayoutEffect(() => {
    if (projectSwitcherOpen) updateProjectSwitcherPosition();
  }, [projectSwitcherOpen, updateProjectSwitcherPosition]);

  useEffect(() => {
    if (!projectSwitcherOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        projectSwitcherMenuRef.current?.contains(target) ||
        projectActionMenuRef.current?.contains(target) ||
        projectSwitcherTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setProjectSwitcherOpen(false);
      setProjectActionMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeProjectMenus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateProjectSwitcherPosition);
    window.addEventListener("scroll", updateProjectSwitcherPosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateProjectSwitcherPosition);
      window.removeEventListener("scroll", updateProjectSwitcherPosition, true);
    };
  }, [projectSwitcherOpen, updateProjectSwitcherPosition]);

  useEffect(() => {
    if (!sessionContextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && sessionMenuRef.current?.contains(target)) return;
      if (!archivingSessionId) {
        setSessionContextMenu(null);
        setSessionActionError(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !archivingSessionId) {
        setSessionContextMenu(null);
        setSessionActionError(null);
      }
    };
    const closeOnViewportChange = () => {
      if (!archivingSessionId) {
        setSessionContextMenu(null);
        setSessionActionError(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [archivingSessionId, sessionContextMenu]);

  useEffect(() => {
    if (sessionContextMenu && !menuSession) {
      setSessionContextMenu(null);
      setSessionActionError(null);
    }
  }, [menuSession, sessionContextMenu]);

  useEffect(() => {
    if (!viewingSession && !renamingSession && !deletingSession) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (viewingSession) closeViewSessionIdDialog();
      if (renamingSession) closeRenameDialog();
      if (deletingSession) closeDeleteSessionDialog();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    deleteSessionInFlight,
    deletingSession,
    renameInFlight,
    renamingSession,
    viewingSession,
  ]);

  useEffect(() => {
    if (!createFormOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateFormOpen(false);
        setCreateError(null);
        setWorkspaceBrowserOpen(false);
        setEditingProject(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [createFormOpen]);

  useEffect(() => {
    if (!createFormOpen || teamOptions.length === 0) return;
    if (!teamOptions.some((option) => option.id === selectedTeamId)) {
      setSelectedTeamId(teamOptions[0].id);
    }
  }, [createFormOpen, selectedTeamId, teamOptions]);

  useEffect(() => {
    if (
      !createFormOpen ||
      !workspaceBrowserOpen ||
      workspaceEntries.length > 0
    ) {
      return;
    }
    void loadWorkspaceRoots();
  }, [
    createFormOpen,
    loadWorkspaceRoots,
    workspaceBrowserOpen,
    workspaceEntries.length,
  ]);

  const handleCreateProject = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || (!editingProject && !onCreateProject)) return;

    setCreatingProject(true);
    setCreateError(null);
    try {
      if (editingProject) {
        if (!onUpdateProject) return;
        await onUpdateProject(editingProject.id, {
          name,
          description: editingProject.description,
          status: editingProject.status ?? "active",
          default_workspace_path: projectWorkspacePath.trim() || null,
          active_repo_id: editingProject.activeRepoId,
        });
      } else {
        if (!onCreateProject) return;
        await onCreateProject(
          {
            name,
            repositories: [],
            description: null,
            status: "active",
            default_workspace_path: projectWorkspacePath.trim() || null,
            active_repo_id: null,
          },
          { teamId: selectedTeamId || blankTeamId },
        );
      }
      resetProjectForm();
      setCreateFormOpen(false);
      closeProjectMenus();
      setWorkspaceBrowserOpen(false);
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : translate("sidebar.projectCreateFailed", "Project creation failed"),
      );
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <nav
      className="flex h-full min-h-0 w-full max-w-full flex-col bg-[var(--canvas)] text-[var(--ink)] select-none"
      aria-label={translate(
        "sidebar.aria.projectNavigation",
        "Project navigation",
      )}
    >
      <div className="flex h-10 shrink-0 items-center px-2.5">
        <button
          type="button"
          className={topControlClass}
          onClick={() => onProjectAction("history")}
          aria-label={translate("sidebar.aria.openHistory", "Open history")}
        >
          <History className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-1.5">
        <button
          ref={projectSwitcherTriggerRef}
          type="button"
          className="flex w-full items-center gap-[6px] rounded-sm border border-transparent px-[6px] py-[5px] text-left transition hover:border-[var(--hairline)] hover:bg-[var(--surface-1)]"
          onClick={toggleProjectSwitcher}
          aria-expanded={projectSwitcherOpen}
          aria-label={translate(
            "sidebar.aria.openProjectSwitcher",
            "Open project switcher",
          )}
        >
          <span className="flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-1 font-mono text-[9px] font-medium text-white">
            {activeProject?.monogram ?? "--"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
              {activeProject?.label ??
                translate("sidebar.projectFallback", "Project")}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
        </button>
        {projectSwitcherOpen &&
          portalTarget &&
          createPortal(
            <div
              ref={projectSwitcherMenuRef}
              className="animate-fade-in-down fixed z-[1000] max-h-[min(440px,calc(100vh-72px))] overflow-y-auto rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-3)] p-1.5 ot-scroll-area-styled"
              style={{
                left: projectSwitcherPosition.left,
                top: projectSwitcherPosition.top,
                width: projectSwitcherPosition.width,
              }}
            >
              <div className="space-y-0.5" data-sidebar-project-list="true">
                {projectsLoading && (
                  <div className="px-2 py-1 text-[12px] text-[var(--ink-tertiary)]">
                    {translate(
                      "sidebar.projectsLoading",
                      "Loading projects...",
                    )}
                  </div>
                )}
                {projectsError && (
                  <div className="rounded-sm bg-[var(--surface-1)] px-2 py-1 text-[12px] text-red-400">
                    {projectsError}
                  </div>
                )}
                {!projectsLoading && displayedProjects.length === 0 && (
                  <div className="px-2 py-1 text-[12px] text-[var(--ink-tertiary)]">
                    {translate("sidebar.noProjects", "No projects yet")}
                  </div>
                )}
                {displayedProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`${sidebarItemClass} cursor-pointer ${
                      project.id === activeProject?.id
                        ? "border-[var(--hairline)] bg-[var(--surface-1)] font-medium text-[var(--ink)]"
                        : "border-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
                    }`}
                    title={project.description || project.label}
                    onClick={(event) =>
                      openProjectActionMenu(project, event.currentTarget)
                    }
                  >
                    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--mono-bg)] font-mono text-[8px] font-medium text-[var(--ink-muted)] border border-[var(--mono-border)]">
                      {project.monogram}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{project.label}</span>
                      {project.description && (
                        <span className="block truncate text-[11px] text-[var(--ink-tertiary)]">
                          {project.description}
                        </span>
                      )}
                    </span>
                    {project.id === activeProject?.id ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    )}
                  </button>
                ))}
              </div>
              {onCreateProject && (
                <div className="border-t border-[var(--hairline)] mt-1.5 pt-1.5">
                  <button
                    type="button"
                    className={`${sidebarItemClass} cursor-pointer border-none bg-transparent font-medium text-[var(--ink)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]`}
                    onClick={() => {
                      resetProjectForm();
                      setCreateFormOpen(true);
                      closeProjectMenus();
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    <span className="min-w-0 flex-1 truncate">
                      {translate("sidebar.createProject", "Create project")}
                    </span>
                  </button>
                </div>
              )}
            </div>,
            portalTarget,
          )}
        {projectSwitcherOpen &&
          projectActionMenu &&
          actionMenuProject &&
          portalTarget &&
          createPortal(
            <div
              ref={projectActionMenuRef}
              className="fixed z-[1001] w-[200px] overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-3)] shadow-none"
              style={{
                left: projectActionMenu.left,
                top: projectActionMenu.top,
              }}
            >
              <div className="border-b border-[var(--hairline)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--mono-border)] bg-[var(--mono-bg)] font-mono text-[8px] font-medium text-[var(--ink-muted)]">
                    {actionMenuProject.monogram}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ink)]">
                    {actionMenuProject.label}
                  </span>
                </div>
                <div
                  className="mt-1.5 truncate font-mono text-[11px] text-[var(--ink-tertiary)]"
                  title={
                    actionMenuProject.repository ||
                    translate("sidebar.projectPathEmpty", "No path set")
                  }
                >
                  {actionMenuProject.repository ||
                    translate("sidebar.projectPathEmpty", "No path set")}
                </div>
              </div>
              <div className="p-1">
                {actionMenuProject.id !== activeProject?.id && (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)] transition"
                    onClick={() => {
                      onProjectSelect?.(actionMenuProject.id);
                      closeProjectMenus();
                    }}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    {translate("sidebar.switchProject", "Switch project")}
                  </button>
                )}
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)] transition"
                  onClick={() => startEditProject(actionMenuProject)}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                  {translate("sidebar.editProject", "Edit project")}
                </button>
              </div>
              <div className="border-t border-[var(--hairline)] p-1">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition"
                  onClick={() => startDeleteProject(actionMenuProject)}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  {translate("sidebar.deleteProject", "Delete project")}
                </button>
              </div>
            </div>,
            portalTarget,
          )}
      </div>

      {createFormOpen &&
        onCreateProject &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1001] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              className="absolute inset-0 bg-[#000000]"
              onClick={() => {
                setCreateFormOpen(false);
                setCreateError(null);
                setWorkspaceBrowserOpen(false);
                setEditingProject(null);
              }}
            />
            <button
              type="button"
              className="sr-only"
              onClick={() => {
                setCreateFormOpen(false);
                setCreateError(null);
                setWorkspaceBrowserOpen(false);
                setEditingProject(null);
              }}
            >
              {translate("sidebar.cancel", "Cancel")}
            </button>
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-project-modal-title"
              className="relative w-full max-w-[480px] rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-4">
                <h2
                  id="create-project-modal-title"
                  className="text-[14px] font-semibold tracking-tight text-[var(--ink)]"
                >
                  {editingProject
                    ? translate("sidebar.editProject", "Edit project")
                    : translate("sidebar.createProject", "Create project")}
                </h2>
                <button
                  type="button"
                  className="rounded-md p-1 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                  onClick={() => {
                    setCreateFormOpen(false);
                    setCreateError(null);
                    setWorkspaceBrowserOpen(false);
                    setEditingProject(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <form className="space-y-4 p-6" onSubmit={handleCreateProject}>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium tracking-[0.4px] text-[var(--ink-tertiary)]">
                    {translate("sidebar.projectName", "Project name")}
                  </label>
                  <input
                    className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)]"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder={translate(
                      "sidebar.projectName",
                      "Project name",
                    )}
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[13px] font-medium tracking-[0.4px] text-[var(--ink-tertiary)]">
                    {translate("sidebar.assignTeam", "Assign team")}
                  </label>
                  <DropdownSelect
                    selectionMode="single"
                    value={selectedTeamId}
                    onChange={(value) => setSelectedTeamId(value)}
                    options={teamOptions}
                    placeholder={translate(
                      "sidebar.assignTeamPlaceholder",
                      "Select a team",
                    )}
                    searchPlaceholder={translate(
                      "sidebar.searchTeams",
                      "Search teams...",
                    )}
                    emptyLabel={translate(
                      "sidebar.noTeamMatch",
                      "No teams match this search.",
                    )}
                    triggerIcon={
                      <Users className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                    }
                    panelClassName="z-[1010] max-w-none"
                    maxPanelHeightClassName="max-h-[240px]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="mb-1.5 block text-[13px] font-medium tracking-[0.4px] text-[var(--ink-tertiary)]">
                    {translate(
                      "sidebar.workspaceSettings",
                      "Workspace settings",
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)]"
                      value={projectWorkspacePath}
                      onChange={(event) =>
                        setProjectWorkspacePath(event.target.value)
                      }
                      placeholder={translate(
                        "sidebar.projectWorkspacePath",
                        "Default workspace path",
                      )}
                    />
                    <button
                      type="button"
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-3 py-2 text-[14px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
                      onClick={() => {
                        setWorkspaceBrowserOpen((open) => !open);
                      }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {translate("sidebar.browseWorkspace", "Browse")}
                    </button>
                  </div>

                  {workspaceBrowserOpen && (
                    <div className="overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                      <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-[var(--surface-2)] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--ink-tertiary)]">
                          {workspaceCurrentPath ||
                            translate("sidebar.workspaceRoots", "Local roots")}
                        </span>
                        <button
                          type="button"
                          className="rounded-sm border border-[var(--hairline)] bg-[var(--surface-3)] px-2 py-1 text-[12px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
                          onClick={() => void loadWorkspaceRoots()}
                        >
                          {translate("sidebar.roots", "Roots")}
                        </button>
                        <button
                          type="button"
                          disabled={!workspaceCurrentPath}
                          className="rounded-sm border border-[var(--hairline)] bg-[var(--surface-3)] px-2 py-1 text-[12px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => {
                            const parent = getParentPath(workspaceCurrentPath);
                            if (parent) void loadWorkspaceDirectory(parent);
                          }}
                        >
                          {translate("sidebar.up", "Up")}
                        </button>
                        <button
                          type="button"
                          className="rounded-sm bg-[var(--primary)] px-2 py-1 text-[12px] font-medium text-white transition hover:bg-[var(--primary-hover)]"
                          onClick={() =>
                            void loadWorkspaceDirectory(projectWorkspacePath)
                          }
                        >
                          {translate("sidebar.readWorkspace", "Read")}
                        </button>
                      </div>
                      {workspaceBrowserError && (
                        <div className="border-b border-[var(--hairline)] px-3 py-2 text-[13px] text-red-400">
                          {workspaceBrowserError}
                        </div>
                      )}
                      <div className="max-h-[180px] overflow-y-auto py-1 ot-scroll-area-styled">
                        {workspaceBrowserLoading ? (
                          <div className="px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                            {translate(
                              "sidebar.workspaceLoading",
                              "Reading local files...",
                            )}
                          </div>
                        ) : workspaceEntries.length === 0 ? (
                          <div className="px-3 py-2 text-[13px] text-[var(--ink-tertiary)]">
                            {translate(
                              "sidebar.workspaceEmpty",
                              "No files were found here.",
                            )}
                          </div>
                        ) : (
                          workspaceEntries.map((entry) => {
                            const Icon = entry.is_directory ? Folder : FileText;
                            return (
                              <button
                                key={`${entry.path}-${directoryEntryTime(entry)}`}
                                type="button"
                                disabled={!entry.is_directory}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--ink-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50 transition"
                                onClick={() => {
                                  if (entry.is_directory) {
                                    void loadWorkspaceDirectory(entry.path);
                                  }
                                }}
                              >
                                <Icon
                                  className={`h-3.5 w-3.5 shrink-0 ${
                                    entry.is_git_repo
                                      ? "text-[var(--primary)]"
                                      : "text-[var(--ink-tertiary)]"
                                  }`}
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                                  {entry.name}
                                </span>
                                {entry.is_git_repo && (
                                  <span className="rounded-xs bg-[var(--primary-tint)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--primary)]">
                                    git
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {createError && (
                  <div className="text-[13px] text-red-400">{createError}</div>
                )}
                <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] -mx-6 -mb-6 mt-2 rounded-b-lg px-6 py-3">
                  <span className="rounded-xs border border-[var(--hairline)] bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                    {translate("escToCancel", "Esc to cancel")}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="cursor-pointer rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-3 py-1.5 text-[14px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
                      onClick={() => {
                        setCreateFormOpen(false);
                        setCreateError(null);
                        setWorkspaceBrowserOpen(false);
                        setEditingProject(null);
                      }}
                    >
                      {translate("sidebar.cancel", "Cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={creatingProject || !projectName.trim()}
                      className="cursor-pointer rounded-md bg-[var(--primary)] px-3.5 py-1.5 text-[14px] font-medium text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {creatingProject
                        ? translate("sidebar.creatingProject", "Creating...")
                        : editingProject
                          ? translate("sidebar.saveProject", "Save project")
                          : translate(
                              "sidebar.createProject",
                              "Create project",
                            )}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </div>,
          portalTarget,
        )}

      {deletingProjectDraft &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            role="presentation"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDeleteDialog();
            }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              onClick={closeDeleteDialog}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-project-dialog-title"
              aria-describedby="delete-project-dialog-desc"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] select-none"
            >
              <div className="p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <p
                  id="delete-project-dialog-title"
                  className="text-base font-semibold text-[var(--ink)] tracking-tight"
                >
                  {translate(
                    "sidebar.deleteProjectConfirmTitle",
                    "Delete project?",
                  )}
                </p>
                <p
                  id="delete-project-dialog-desc"
                  className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]"
                >
                  {translate(
                    "sidebar.deleteProjectConfirmDesc",
                    `"${deletingProjectDraft.label}" will be permanently deleted. This action cannot be undone.`,
                    { name: deletingProjectDraft.label },
                  )}
                </p>
                {deleteError && (
                  <p className="mt-2 text-xs text-red-400">{deleteError}</p>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
                <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                  {translate("escToCancel", "Esc to cancel")}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-3)] transition"
                    onClick={closeDeleteDialog}
                    disabled={deleteInFlight}
                  >
                    {translate("cancel", "Cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void confirmDeleteProject()}
                    disabled={deleteInFlight}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleteInFlight
                      ? translate("sidebar.deleting", "Deleting...")
                      : translate("sidebar.deleteProject", "Delete project")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          portalTarget,
        )}

      {sessionContextMenu &&
        menuSession &&
        portalTarget &&
        createPortal(
          <div
            ref={sessionMenuRef}
            role="menu"
            aria-label={translate("sidebar.sessionActions", "Session actions")}
            className="fixed z-[1001] w-[180px] overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-3)] p-1 shadow-none"
            style={{
              left: sessionContextMenu.left,
              top: sessionContextMenu.top,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => startRenameSession(menuSession)}
              disabled={!onRenameSession || Boolean(archivingSessionId)}
            >
              <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
              {translate("sidebar.renameSession", "Rename")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => startViewSessionId(menuSession)}
              disabled={Boolean(archivingSessionId)}
            >
              <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
              {translate("sidebar.viewSessionId", "View ID")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--ink-muted)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleArchiveSession(menuSession)}
              disabled={
                !onArchiveSession || archivingSessionId === menuSession.id
              }
            >
              {archivingSessionId === menuSession.id ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--primary)]" />
              ) : (
                <Archive className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
              )}
              {archivingSessionId === menuSession.id
                ? translate("sidebar.archivingSession", "Archiving...")
                : translate("sidebar.archiveSession", "Archive")}
            </button>
            <div className="my-1 border-t border-[var(--hairline)]" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-red-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => startDeleteSession(menuSession)}
              disabled={!onDeleteSession || Boolean(archivingSessionId)}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              {translate("sidebar.deleteSession", "Delete")}
            </button>
            {sessionActionError && (
              <p className="px-2.5 py-1 text-[11px] leading-snug text-red-400">
                {sessionActionError}
              </p>
            )}
          </div>,
          portalTarget,
        )}

      {viewingSession &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              onClick={closeViewSessionIdDialog}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="view-session-id-dialog-title"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
                <h2
                  id="view-session-id-dialog-title"
                  className="text-[14px] font-semibold tracking-tight text-[var(--ink)]"
                >
                  {translate("sidebar.viewSessionId", "View ID")}
                </h2>
                <button
                  type="button"
                  className="rounded-md p-1 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                  onClick={closeViewSessionIdDialog}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="space-y-4 p-5">
                <div>
                  <p className="mb-2 truncate text-[13px] font-medium text-[var(--ink-subtle)]">
                    {viewingSession.title}
                  </p>
                  <label
                    htmlFor="view-session-id-value"
                    className="mb-1.5 block text-[13px] font-medium tracking-[0.4px] text-[var(--ink-tertiary)]"
                  >
                    {translate("sidebar.sessionId", "Session ID")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="view-session-id-value"
                      className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[13px] text-[var(--ink)] outline-none focus:border-[var(--primary)]"
                      value={viewingSession.id}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      type="button"
                      aria-label={copySessionIdLabel}
                      title={copySessionIdLabel}
                      className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[var(--hairline-strong)] text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                      onClick={() => void copyViewingSessionId()}
                    >
                      {copySessionIdState === "copied" ? (
                        <Check className="h-3.5 w-3.5 text-[var(--success)]" />
                      ) : (
                        <Copy
                          className={`h-3.5 w-3.5 ${
                            copySessionIdState === "error"
                              ? "text-red-400"
                              : ""
                          }`}
                        />
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] -mx-5 -mb-5 mt-2 px-5 py-3">
                  <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {translate("escToCancel", "Esc to cancel")}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)]"
                    onClick={closeViewSessionIdDialog}
                  >
                    {translate("sidebar.closeSessionId", "Close")}
                  </button>
                </div>
              </div>
            </section>
          </div>,
          portalTarget,
        )}

      {renamingSession &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              onClick={closeRenameDialog}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-session-dialog-title"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] select-none"
            >
              <header className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-4">
                <h2
                  id="rename-session-dialog-title"
                  className="text-[14px] font-semibold tracking-tight text-[var(--ink)]"
                >
                  {translate("sidebar.renameSession", "Rename session")}
                </h2>
                <button
                  type="button"
                  className="rounded-md p-1 text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeRenameDialog}
                  disabled={renameInFlight}
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <form className="space-y-4 p-5" onSubmit={handleRenameSession}>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium tracking-[0.4px] text-[var(--ink-tertiary)]">
                    {translate("sidebar.sessionTitle", "Session title")}
                  </label>
                  <input
                    className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60"
                    value={renameTitle}
                    onChange={(event) => setRenameTitle(event.target.value)}
                    disabled={renameInFlight}
                    autoFocus
                  />
                </div>
                {renameError && (
                  <p className="text-[13px] text-red-400">{renameError}</p>
                )}
                <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] -mx-5 -mb-5 mt-2 px-5 py-3">
                  <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {translate("escToCancel", "Esc to cancel")}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="cursor-pointer rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={closeRenameDialog}
                      disabled={renameInFlight}
                    >
                      {translate("cancel", "Cancel")}
                    </button>
                    <button
                      type="submit"
                      disabled={renameInFlight || !renameTitle.trim()}
                      className="cursor-pointer rounded-md bg-[var(--primary)] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {renameInFlight
                        ? translate("sidebar.renamingSession", "Saving...")
                        : translate("sidebar.saveSession", "Save")}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </div>,
          portalTarget,
        )}

      {deletingSession &&
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
            role="presentation"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
              onClick={closeDeleteSessionDialog}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-session-dialog-title"
              aria-describedby="delete-session-dialog-desc"
              className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] select-none"
            >
              <div className="p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <p
                  id="delete-session-dialog-title"
                  className="text-base font-semibold tracking-tight text-[var(--ink)]"
                >
                  {translate("sidebar.deleteSessionConfirmTitle", "Delete session?")}
                </p>
                <p
                  id="delete-session-dialog-desc"
                  className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]"
                >
                  {translate(
                    "sidebar.deleteSessionConfirmDesc",
                    `"${deletingSession.title}" will be permanently deleted. This action cannot be undone.`,
                    { name: deletingSession.title },
                  )}
                </p>
                {deleteSessionError && (
                  <p className="mt-2 text-xs text-red-400">
                    {deleteSessionError}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
                <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                  {translate("escToCancel", "Esc to cancel")}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={closeDeleteSessionDialog}
                    disabled={deleteSessionInFlight}
                  >
                    {translate("cancel", "Cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void confirmDeleteSession()}
                    disabled={deleteSessionInFlight}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleteSessionInFlight
                      ? translate("sidebar.deletingSession", "Deleting...")
                      : translate("sidebar.deleteSession", "Delete")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          portalTarget,
        )}

      <div className="flex-1 space-y-5 overflow-y-auto px-2.5 py-2 ot-scroll-area-styled">
        <section className="space-y-1" data-section="Primary actions">
          {(shellOptions?.primaryActions ?? []).map((action) => {
            const Icon = primaryActionIcons[action.icon] ?? CircleDot;
            return (
              <button
                key={action.id}
                type="button"
                className={`${sidebarItemClass} cursor-pointer border-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]`}
                onClick={() => onPrimaryAction(action)}
                title={translate(
                  `sidebar.primary.${action.id}.helper`,
                  action.helper,
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                <span className="min-w-0 flex-1 truncate">
                  {translate(`sidebar.primary.${action.id}`, action.label)}
                </span>
              </button>
            );
          })}
        </section>

        <section
          className={`rounded-lg border bg-[var(--surface-1)] ${
            activePage === "build-stats"
              ? "border-[var(--hairline-strong)]"
              : "border-[var(--hairline)]"
          }`}
          data-section="Build stats"
        >
          <div className="flex items-center gap-1 px-2.5 py-2">
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none transition hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              onClick={openBuildStatsPage}
              title={translate(
                "sidebar.buildStats.open",
                "Open build statistics",
              )}
            >
              <Activity className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink)]">
                {translate(
                  "sidebar.buildStats.title",
                  buildStats?.title ?? "Build stats",
                )}
              </span>
            </button>
            <button
              type="button"
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              onClick={() => setBuildStatsVisible((visible) => !visible)}
              aria-expanded={buildStatsVisible}
              aria-controls="project-sidebar-build-stats"
            >
              <span>
                {buildStatsVisible
                  ? translate("sidebar.hide", "Hide")
                  : translate("sidebar.show", "Show")}
              </span>
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 transition ${
                  buildStatsVisible ? "rotate-90" : ""
                }`}
              />
            </button>
          </div>
          {buildStatsVisible && (
            <div
              role="button"
              tabIndex={0}
              id="project-sidebar-build-stats"
              className="block w-full cursor-pointer space-y-2 border-t border-[var(--hairline)] px-2.5 py-2 text-left transition hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              onClick={openBuildStatsPage}
              onKeyDown={handleBuildStatsCardKeyDown}
            >
              <div className="space-y-1">
                {(buildStats?.stats ?? []).map((stat) => (
                  <div
                    key={stat.id}
                    className="flex items-center justify-between gap-2 text-[12px]"
                  >
                    <span className="truncate text-[var(--ink-subtle)]">
                      {translate(`sidebar.stats.${stat.id}`, stat.label)}
                    </span>
                    <span
                      className={`shrink-0 font-mono font-medium ${
                        stat.tone === "accent"
                          ? "text-[var(--primary)]"
                          : stat.tone === "success"
                            ? "text-[var(--success)]"
                            : "text-[var(--ink)]"
                      }`}
                      title={translate(
                        `sidebar.stats.${stat.id}.helper`,
                        stat.helper,
                      )}
                    >
                      {statValue(stat.id, stat.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <SidebarSection title={translate("sidebar.sessions", "Sessions")}>
          {sessions.length > 0 ? (
            <>
              <div
                className={`space-y-1 pr-1 ${
                  sessionsExpanded ? "h-52 overflow-y-auto" : "overflow-visible"
                }`}
                data-sidebar-session-list="true"
              >
                {visibleSessions.map((session) => {
                  const active =
                    activePage === "workspace" &&
                    session.id === activeSessionId;
                  const isRunning = hasRunningSessionActivity(session);
                  const hasPendingWorkflowReview =
                    !isRunning && Boolean(session.hasPendingWorkflowReview);
                  const hasPendingWorkflowInput =
                    !isRunning &&
                    !hasPendingWorkflowReview &&
                    Boolean(session.hasPendingWorkflowInput);
                  const hasUnreadAgentCompletion =
                    !isRunning && Boolean(session.hasUnreadAgentCompletion);
                  const SessionIcon =
                    isRunning || hasPendingWorkflowReview
                      ? LoaderCircle
                      : hasPendingWorkflowInput
                        ? CircleDot
                        : Box;
                  const sessionLabel = isRunning
                    ? `${session.title} - ${translate(
                        "sidebar.sessionRunning",
                        "agent running",
                      )}`
                    : hasPendingWorkflowReview
                    ? `${session.title} - ${translate(
                        "sidebar.sessionWaitingReview",
                        "waiting for review",
                      )}`
                    : hasPendingWorkflowInput
                    ? `${session.title} - ${translate(
                        "sidebar.sessionNeedsInput",
                        "waiting for input",
                      )}`
                    : hasUnreadAgentCompletion
                    ? `${session.title} - ${translate(
                        "sidebar.sessionAgentCompleted",
                        "agent completed",
                      )}`
                    : session.title;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSessionSelect(session.id)}
                      onContextMenu={(event) =>
                        openSessionContextMenu(session, event)
                      }
                      aria-label={sessionLabel}
                      title={sessionLabel}
                      className={`${sidebarItemClass} cursor-pointer ${
                        active
                          ? "border-[var(--hairline)] bg-[var(--surface-1)] font-medium text-[var(--ink)]"
                          : "border-transparent text-[var(--ink-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
                      }`}
                    >
                      <SessionIcon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isRunning || hasPendingWorkflowReview
                            ? "animate-spin text-[var(--primary)]"
                            : hasPendingWorkflowInput
                            ? "text-[var(--primary)]"
                            : hasUnreadAgentCompletion
                            ? "text-[var(--primary)]"
                            : active
                            ? "text-[var(--primary)]"
                            : "text-[var(--ink-tertiary)]"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {session.title}
                      </span>
                    </button>
                  );
                })}
              </div>
              {hasOverflowSessions && (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between rounded-sm border border-transparent px-[7px] py-[4px] text-left text-[12px] font-medium text-[var(--ink-subtle)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)]"
                  data-sidebar-more="true"
                  aria-expanded={sessionsExpanded}
                  aria-label={sessionToggleAriaLabel}
                  onClick={() => setSessionsExpanded((expanded) => !expanded)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                    {sessionsExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    ) : (
                      <MoreHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    )}
                    <span className="truncate">{sessionToggleLabel}</span>
                  </span>
                  {!sessionsExpanded && (
                    <span className="shrink-0 font-mono text-[10px] font-medium text-[var(--ink-tertiary)]">
                      +{hiddenSessionCount}
                    </span>
                  )}
                </button>
              )}
            </>
          ) : (
            <div className="rounded-sm border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-2 text-[12px] text-[var(--ink-tertiary)]">
              {translate("sidebar.noSessions", "No sessions yet")}
            </div>
          )}
        </SidebarSection>

        <SidebarSection
          title={translate("sidebar.projectManagement", "Project management")}
        >
          {(shellOptions?.projectManagementItems ?? []).map((item) => {
            const label = translate(`sidebar.nav.${item.id}`, item.label);
            const title = translate(
              `sidebar.nav.${item.id}.helper`,
              item.helper,
            );
            const badge = item.badge
              ? translate(`sidebar.nav.${item.id}.badge`, item.badge)
              : undefined;
            return (
              <SidebarNavigationButton
                key={item.id}
                item={item}
                label={label}
                badge={badge}
                title={title}
                active={item.targetPage === activePage}
                onClick={() => {
                  if (item.targetPage) {
                    onNavigate(item);
                  } else {
                    onProjectAction(item.id);
                  }
                }}
              />
            );
          })}
        </SidebarSection>

        <SidebarSection title={translate("sidebar.system", "System")}>
          {(shellOptions?.systemItems ?? []).map((item) => {
            const label = translate(`sidebar.nav.${item.id}`, item.label);
            const title = translate(
              `sidebar.nav.${item.id}.helper`,
              item.helper,
            );
            const badge = item.badge
              ? translate(`sidebar.nav.${item.id}.badge`, item.badge)
              : undefined;
            return (
              <SidebarNavigationButton
                key={item.id}
                item={item}
                label={label}
                badge={badge}
                title={title}
                active={item.targetPage === activePage}
                onClick={() => {
                  if (item.targetPage) {
                    onNavigate(item);
                  } else {
                    onProjectAction(item.id);
                  }
                }}
              />
            );
          })}
        </SidebarSection>
      </div>
    </nav>
  );
}
