import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Github,
  Link2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Tag,
  Trash2,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SVGProps,
} from 'react';
import { ProjectBreadcrumbAvatar } from '@/components/ProjectBreadcrumbAvatar';
import { AgentMarkdown } from '@/components/AgentMarkdown';
import {
  CommandSelectList,
  CommandSelectMenu,
  CommandSelectNoMatches,
  CommandSelectSearchRow,
} from '@/components/CommandSelectMenu';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { IssueWorktreeSessionDialog } from '@/components/IssueWorktreeSessionDialog';
import {
  NotificationToast,
  type NotificationToastTone,
} from '@/components/NotificationToast';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  chatSessionsApi,
  projectApi,
  projectGithubApi,
  projectWorkItemsApi,
} from '@/lib/api';
import {
  notifyChatInputPrefill,
  type ChatInputPrefillMode,
} from '@/lib/chatInputPrefill';
import {
  clearPendingIssueStatusSync,
  getPendingIssueStatusSync,
} from '@/lib/pendingIssueStatusSync';
import { notifyLinkedWorkItemsChanged } from '@/lib/linkedWorkItemsEvents';
import { notifyBuildStatsUsageUpdated } from '@/lib/buildStatsEvents';
import { mapSession } from '@/lib/mappers';
import type {
  BackendChatSession,
  ChatSessionWorktreeMode,
  GitHubAccount,
  ProjectRepoIntegration,
  ProjectWorkItem,
  ProjectWorkItemDetailResponse,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
} from '@/types';

type IssueDetailStatus = ProjectWorkItemStatus;
type RemoteProviderId = 'github' | 'linear' | 'jira';
type RemoteProviderIcon = (props: SVGProps<SVGSVGElement>) => ReactNode;

export type IssueDetailItem = {
  id: string;
  workItemId: string;
  title: string;
  status: string;
  workItem: ProjectWorkItem;
};

export type IssueDetailTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

export type IssueDetailSyncSnapshot = {
  workItem: ProjectWorkItem;
  labels?: string[];
};

export type IssueDetailPageProps = {
  projectId: string;
  projectName: string;
  issue: IssueDetailItem;
  availableLabels?: string[];
  onBack: () => void;
  onAction: (message: string) => void;
  onWorkItemChange?: (item: ProjectWorkItem) => void;
  onIssueDeleted?: (workItemId: string) => void;
  onIssueSync?: (snapshot: IssueDetailSyncSnapshot) => void;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoId?: string;
  linkedRepoName?: string;
  linkedGitHubRepos?: ProjectRepoIntegration[];
  githubAccount?: GitHubAccount | null;
  onOpenIntegrations: () => void;
  tr: IssueDetailTranslator;
};

type RemoteProviderIconConfig = {
  Icon: RemoteProviderIcon;
  iconClassName: string;
};

type StatusMenuOption = {
  value: IssueDetailStatus;
  label: string;
  shortcut: string;
};

type PriorityMenuValue = ProjectWorkItemPriority | 'none';

type PriorityMenuOption = {
  value: PriorityMenuValue;
  label: string;
  shortcut: string;
};

type LabelMenuOption = {
  value: string;
  label: string;
  color: string;
  shortcut: string;
};

type SessionMenuOption = {
  value: string;
  label: string;
};

export type IssueCommentAttachment = {
  name: string;
  size: number;
};

type IssueDetailSyncNotice = {
  id: number;
  title: string;
  message: string;
  tone: NotificationToastTone;
};

export const COMMON_GITHUB_LABELS = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'question',
  'help wanted',
  'good first issue',
] as const;

const statusMenuValues: Array<{ value: IssueDetailStatus; shortcut: string; key: string; fallback: string }> = [
  { value: 'blocked', shortcut: '1', key: 'issue.status.backlog', fallback: 'Backlog' },
  { value: 'open', shortcut: '2', key: 'issue.status.todo', fallback: 'Todo' },
  { value: 'in_progress', shortcut: '3', key: 'issue.status.in_progress', fallback: 'In Progress' },
  { value: 'ready_to_merge', shortcut: '4', key: 'issue.status.ready_to_merge', fallback: 'Ready to Merge' },
  { value: 'merging', shortcut: '5', key: 'issue.status.merging', fallback: 'Merging' },
  { value: 'done', shortcut: '6', key: 'issue.status.done', fallback: 'Done' },
  { value: 'cancelled', shortcut: '7', key: 'issue.status.cancelled', fallback: 'Canceled' },
  { value: 'duplicate', shortcut: '8', key: 'issue.status.duplicate', fallback: 'Duplicate' },
];

const priorityMenuValues: Array<{ value: PriorityMenuValue; shortcut: string; key: string; fallback: string }> = [
  { value: 'none', shortcut: '0', key: 'issue.priority.none', fallback: 'No priority' },
  { value: 'urgent', shortcut: '4', key: 'issue.priority.urgent', fallback: 'Urgent' },
  { value: 'high', shortcut: '3', key: 'issue.priority.high', fallback: 'High' },
  { value: 'medium', shortcut: '2', key: 'issue.priority.medium', fallback: 'Medium' },
  { value: 'low', shortcut: '1', key: 'issue.priority.low', fallback: 'Low' },
];

const buildStatusMenuOptions = (
  tr: IssueDetailTranslator,
): StatusMenuOption[] =>
  statusMenuValues.map((entry) => ({
    value: entry.value,
    label: tr(entry.key, entry.fallback),
    shortcut: entry.shortcut,
  }));

const buildPriorityMenuOptions = (
  tr: IssueDetailTranslator,
): PriorityMenuOption[] =>
  priorityMenuValues.map((entry) => ({
    value: entry.value,
    label: tr(entry.key, entry.fallback),
    shortcut: entry.shortcut,
  }));

const statusValueKey = (status: IssueDetailStatus) =>
  statusMenuValues.find((entry) => entry.value === status);

const priorityValueKey = (priority: ProjectWorkItemPriority) =>
  priorityMenuValues.find((entry) => entry.value === priority);

const labelColorByName: Record<string, string> = {
  bug: '#f25f67',
  feature: '#b987ff',
  enhancement: '#5aaef7',
  improvement: '#5aaef7',
  documentation: '#8ddfcb',
  question: '#f3c86b',
  'help wanted': '#f59fb7',
  'good first issue': '#7edc8f',
};

const labelDisplayKeysByName: Record<
  string,
  { key: string; fallback: string }
> = {
  bug: { key: 'issue.detail.labelBug', fallback: 'Bug' },
  feature: { key: 'issue.detail.labelFeature', fallback: 'Feature' },
  task: { key: 'issue.detail.labelTask', fallback: 'Task' },
  deploy: { key: 'issue.detail.labelDeploy', fallback: 'Deploy' },
  test: { key: 'issue.detail.labelTest', fallback: 'Test' },
  doc: { key: 'issue.detail.labelDocumentation', fallback: 'Documentation' },
  refactor: { key: 'issue.detail.labelRefactor', fallback: 'Refactor' },
  enhancement: {
    key: 'issue.detail.labelImprovement',
    fallback: 'Improvement',
  },
  improvement: {
    key: 'issue.detail.labelImprovement',
    fallback: 'Improvement',
  },
  documentation: {
    key: 'issue.detail.labelDocumentation',
    fallback: 'Documentation',
  },
  question: { key: 'issue.detail.labelQuestion', fallback: 'Question' },
  'help wanted': {
    key: 'issue.detail.labelHelpWanted',
    fallback: 'Help Wanted',
  },
  'good first issue': {
    key: 'issue.detail.labelGoodFirstIssue',
    fallback: 'Good First Issue',
  },
};

const remoteProviderIcons: Record<RemoteProviderId, RemoteProviderIconConfig> =
  {
    github: {
      Icon: GitHubProviderIcon,
      iconClassName: 'text-[#f4f4f5]',
    },
    linear: {
      Icon: LinearProviderIcon,
      iconClassName: 'text-[#5e6ad2]',
    },
    jira: {
      Icon: JiraProviderIcon,
      iconClassName: 'text-[#2684ff]',
    },
  };

const ISSUE_ID_BASE_FONT_SIZE_PX = 16;
const ISSUE_ID_MIN_FONT_SIZE_PX = 1;
const ISSUE_ID_AVERAGE_CHAR_WIDTH_EM = 0.6;
const ISSUE_SESSION_TITLE_MAX_LENGTH = 60;
const WORKFLOW_MODE_LABEL_KEYS = new Set([
  'feature',
  'enhancement',
  'improvement',
]);

const cn = (...classes: Array<string | false | undefined>) =>
  classes.filter(Boolean).join(' ');

function truncateIssueSessionTitle(title: string, fallback: string) {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) return fallback;

  const chars = Array.from(normalized);
  if (chars.length <= ISSUE_SESSION_TITLE_MAX_LENGTH) return normalized;

  return `${chars.slice(0, ISSUE_SESSION_TITLE_MAX_LENGTH - 3).join('')}...`;
}

function issuePromptLabel(
  labels: string[],
  issueType: ProjectWorkItem['type'],
  tr: IssueDetailTranslator,
) {
  const cleanLabels = labels.map((label) => label.trim()).filter(Boolean);
  return cleanLabels.length > 0
    ? cleanLabels.join(', ')
    : labelDisplayName(issueType, tr);
}

function buildIssueSessionPrompt({
  label,
  title,
  description,
  tr,
}: {
  label: string;
  title: string;
  description: string;
  tr: IssueDetailTranslator;
}) {
  return [
    tr('issue.detail.prompt.currentMatter', 'Current item is {label}', {
      label,
    }),
    tr('issue.detail.prompt.title', 'Issue title: {title}', {
      title: title.trim(),
    }),
    tr('issue.detail.prompt.description', 'Issue description: {description}', {
      description: description.trim(),
    }),
  ].join('\n');
}

function shouldUseWorkflowModeForIssue(
  labels: string[],
  issueType: ProjectWorkItem['type'],
) {
  if (issueType === 'feature') return true;
  return labels.some((label) => WORKFLOW_MODE_LABEL_KEYS.has(labelKey(label)));
}

export function IssueDetailPage({
  projectId,
  projectName,
  issue,
  availableLabels = [],
  onBack,
  onAction,
  onWorkItemChange,
  onIssueDeleted,
  onIssueSync,
  linkedProviderId,
  linkedRepoId,
  linkedRepoName,
  linkedGitHubRepos = [],
  githubAccount,
  onOpenIntegrations,
  tr,
}: IssueDetailPageProps) {
  const { projects, setSessions, setActiveSessionId, refreshSessions } =
    useWorkspace();
  const [detail, setDetail] = useState<ProjectWorkItemDetailResponse | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [syncNotice, setSyncNotice] = useState<IssueDetailSyncNotice | null>(
    null,
  );
  const [labelDraft, setLabelDraft] = useState('');
  const [projectSessions, setProjectSessions] = useState<BackendChatSession[]>(
    [],
  );
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [openPropertyMenu, setOpenPropertyMenu] = useState<
    'status' | 'priority' | 'labels' | 'session' | null
  >(null);
  const [statusQuery, setStatusQuery] = useState('');
  const [priorityQuery, setPriorityQuery] = useState('');
  const [labelQuery, setLabelQuery] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [worktreeSessionOpen, setWorktreeSessionOpen] = useState(false);
  const [worktreeSessionGit, setWorktreeSessionGit] = useState<boolean | null>(
    null,
  );
  const propertyMenuRef = useRef<HTMLDivElement | null>(null);
  const labelMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const detailRequestIdRef = useRef(0);
  const pendingStatusSyncAttemptRef = useRef<string | null>(null);
  const projectWorkspacePath = useMemo(
    () =>
      projects.find((project) => project.id === projectId)
        ?.default_workspace_path ?? null,
    [projectId, projects],
  );

  const loadDetail = useCallback(async () => {
    if (!projectId || !issue.workItemId) {
      setDetail(null);
      return;
    }
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setDetailLoading(true);
    setDetailError('');
    try {
      const nextDetail = await projectWorkItemsApi.get(
        projectId,
        issue.workItemId,
        {
          includeGithubDetail: false,
        },
      );
      if (detailRequestIdRef.current !== requestId) return;
      setDetail(nextDetail);
      setDetailLoading(false);
    } catch (error) {
      if (detailRequestIdRef.current !== requestId) return;
      setDetailError(errorMessage(error, tr));
      setDetailLoading(false);
    }
  }, [issue.workItemId, projectId, tr]);

  useEffect(() => {
    if (!syncNotice) return;
    const timer = window.setTimeout(() => {
      setSyncNotice(null);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setProjectSessions([]);
      return;
    }
    setSessionsLoading(true);
    void projectApi
      .listSessions(projectId)
      .then((sessions) => {
        if (!cancelled) setProjectSessions(sessions);
      })
      .catch((error) => {
        if (!cancelled) setActionError(errorMessage(error, tr));
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, tr]);

  useEffect(() => {
    void loadDetail();
    return () => {
      detailRequestIdRef.current += 1;
    };
  }, [loadDetail]);

  useEffect(() => {
    if (!openPropertyMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !propertyMenuRef.current?.contains(event.target as Node) &&
        !labelMenuRef.current?.contains(event.target as Node) &&
        !sessionMenuRef.current?.contains(event.target as Node)
      ) {
        setOpenPropertyMenu(null);
        setStatusQuery('');
        setPriorityQuery('');
        setLabelQuery('');
        setSessionQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openPropertyMenu]);

  const current = detail?.work_item ?? issue.workItem;
  const githubIssue = detail?.github_issue_detail ?? null;
  const githubIssueLink = findGitHubIssueLink(detail);
  const linkedGitHubIssueNumber =
    githubIssueLink?.number ?? githubIssue?.summary.number ?? null;
  const hasGitHubIssue = Boolean(githubIssueLink || githubIssue);
  const issueRepoIntegrationId = findIssueRepoIntegrationId(
    linkedGitHubRepos,
    githubIssueLink?.repo_id,
    githubIssue?.summary?.url ?? githubIssueLink?.url,
  );
  const targetRepoIntegrationId = hasGitHubIssue
    ? issueRepoIntegrationId
    : linkedRepoId;
  const canWriteGitHub = Boolean(
    targetRepoIntegrationId && linkedGitHubIssueNumber,
  );
  const canSyncActivity = Boolean(
    targetRepoIntegrationId && linkedGitHubIssueNumber,
  );
  const issueTitle = githubIssue?.summary.title ?? current.title;
  const issueBody = githubIssue?.body ?? current.description;
  const localIssueLabels = useMemo(
    () => projectWorkItemLabelList(current.labels_json),
    [current.labels_json],
  );
  const issueLabels = useMemo(
    () => githubIssue?.summary.labels ?? localIssueLabels,
    [githubIssue?.summary.labels, localIssueLabels],
  );
  const canEditLabels = !hasGitHubIssue || canWriteGitHub;
  const issueBodyText = issueBody ?? '';
  const descriptionForPrompt = descriptionEditing
    ? descriptionDraft
    : descriptionDraft || issueBodyText;
  const issueLabelKey = issueLabels.join('\u0000');
  const issueStatus = current.status;
  const statusMenuOptions = useMemo(() => buildStatusMenuOptions(tr), [tr]);
  const priorityMenuOptions = useMemo(() => buildPriorityMenuOptions(tr), [tr]);
  const localCreatorIdentity = defaultIssueUserIdentity(
    githubAccount ?? null,
    tr,
  );
  const canComment = hasGitHubIssue ? canWriteGitHub : Boolean(current.id);
  const issueComments = useMemo(
    () =>
      githubIssue
        ? githubIssue.comments
        : (detail?.comments ?? []).map((comment) => ({
            id: comment.id,
            body: comment.body,
            author: comment.author ?? localCreatorIdentity.name,
            author_avatar_url: comment.author
              ? null
              : localCreatorIdentity.avatarUrl,
            created_at: comment.created_at,
            url: null,
          })),
    [
      detail?.comments,
      githubIssue,
      localCreatorIdentity.avatarUrl,
      localCreatorIdentity.name,
    ],
  );
  const creatorName = githubIssue?.summary.author ?? localCreatorIdentity.name;
  const creatorAvatarUrl =
    githubIssue?.summary.author_avatar_url ??
    (githubIssue ? null : localCreatorIdentity.avatarUrl);
  const creatorFallback = githubIssue
    ? 'initials'
    : localCreatorIdentity.fallback;
  const creatorDate = githubIssue?.summary.created_at ?? current.created_at;
  const linkedSessionLinks = (detail?.execution_links ?? []).flatMap((link) =>
    link.session_id ? [{ linkId: link.id, sessionId: link.session_id }] : [],
  );
  const linkedSessionIds = linkedSessionLinks.map((link) => link.sessionId);
  const linkedSessionIdSet = new Set(linkedSessionIds);
  const sessionMenuOptions: SessionMenuOption[] = projectSessions
    .filter((session) => !linkedSessionIdSet.has(session.id))
    .map((session) => ({
      value: session.id,
      label: session.title?.trim() || session.id,
    }));
  const trimmedTitleDraft = titleDraft.trim();
  const titleSaveDisabled =
    action === 'rename-issue' ||
    action === 'delete-issue' ||
    !trimmedTitleDraft ||
    trimmedTitleDraft === issueTitle;

  useEffect(() => {
    if (!titleEditing) {
      setTitleDraft(issueTitle);
    }
  }, [issueTitle, titleEditing]);

  useEffect(() => {
    if (titleEditing) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [titleEditing]);

  useEffect(() => {
    setLabelDraft(issueLabels.join(', '));
  }, [issue.workItemId, issueLabelKey, issueLabels]);

  useEffect(() => {
    setDescriptionDraft(issueBodyText);
  }, [issue.workItemId, issueBodyText]);

  const patchCurrentWorkItem = (updated: ProjectWorkItem) => {
    setDetail((existing) =>
      existing ? { ...existing, work_item: updated } : existing,
    );
    onWorkItemChange?.(updated);
    onIssueSync?.({
      workItem: updated,
      labels: githubIssue ? issueLabels : undefined,
    });
  };

  useEffect(() => {
    if (!detail) return;
    onIssueSync?.({
      workItem: current,
      labels: githubIssue ? issueLabels : undefined,
    });
  }, [current, detail, githubIssue, issueLabels, onIssueSync]);

  const runAction = async (name: string, task: () => Promise<void>) => {
    setAction(name);
    setActionError('');
    try {
      await task();
    } catch (error) {
      setActionError(errorMessage(error, tr));
    } finally {
      setAction(null);
    }
  };

  const showSyncNotice = (
    title: string,
    message: string,
    tone: NotificationToastTone = 'success',
  ) => {
    setSyncNotice({
      id: Date.now(),
      title,
      message,
      tone,
    });
  };

  const handleRenameIssue = async (nextTitle: string) => {
    const title = nextTitle.trim();
    if (!title || title === current.title) return true;

    setAction('rename-issue');
    setActionError('');
    try {
      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        title,
      });
      setDetail((existing) =>
        existing
          ? {
              ...existing,
              work_item: updated,
              github_issue_detail: existing.github_issue_detail
                ? {
                    ...existing.github_issue_detail,
                    summary: {
                      ...existing.github_issue_detail.summary,
                      title,
                    },
                  }
                : existing.github_issue_detail,
            }
          : existing,
      );
      onWorkItemChange?.(updated);
      onIssueSync?.({
        workItem: updated,
        labels: githubIssue ? issueLabels : undefined,
      });
      onAction(tr('issue.detail.action.nameUpdated', 'Issue name updated'));
      return true;
    } catch (error) {
      setActionError(errorMessage(error, tr));
      return false;
    } finally {
      setAction(null);
    }
  };

  const handleSaveTitleDraft = async () => {
    const saved = await handleRenameIssue(trimmedTitleDraft);
    if (saved) {
      setTitleEditing(false);
    }
  };

  const handleDeleteIssue = async () => {
    setAction('delete-issue');
    setActionError('');
    try {
      await projectWorkItemsApi.delete(projectId, current.id);
      notifyBuildStatsUsageUpdated(projectId);
      onAction(tr('issue.detail.action.deleted', 'Issue deleted'));
      onIssueDeleted?.(current.id);
      return true;
    } catch (error) {
      setActionError(errorMessage(error, tr));
      return false;
    } finally {
      setAction(null);
    }
  };

  useEffect(() => {
    if (!detail || !targetRepoIntegrationId || !linkedGitHubIssueNumber) {
      return;
    }

    const pendingSync = getPendingIssueStatusSync(projectId, current.id);
    if (!pendingSync) return;

    if (pendingSync.status !== current.status) {
      clearPendingIssueStatusSync(projectId, current.id);
      return;
    }

    const attemptKey = [
      pendingSync.projectId,
      pendingSync.workItemId,
      pendingSync.status,
      pendingSync.updatedAt,
    ].join(':');
    if (pendingStatusSyncAttemptRef.current === attemptKey) return;
    pendingStatusSyncAttemptRef.current = attemptKey;

    setAction('status-sync');
    setActionError('');
    void projectGithubApi
      .updateIssueState(
        projectId,
        targetRepoIntegrationId,
        linkedGitHubIssueNumber,
        issueStatusSyncsToClosed(current.status) ? 'closed' : 'open',
      )
      .then((githubSummary) => {
        setDetail((existing) =>
          existing
            ? {
                ...existing,
                github_issue_detail: {
                  summary: githubSummary,
                  body:
                    existing.github_issue_detail?.body ?? current.description,
                  comments: existing.github_issue_detail?.comments ?? [],
                },
              }
            : existing,
        );
        clearPendingIssueStatusSync(projectId, current.id);
        onAction(
          tr('issue.detail.action.statusSynced', 'GitHub issue status synced'),
        );
        showSyncNotice(
          tr('issue.detail.syncNotice.complete.title', 'GitHub sync complete'),
          tr(
            'issue.detail.syncNotice.statusSynced.message',
            'Status synced to GitHub.',
          ),
          'success',
        );
      })
      .catch((error) => {
        setActionError(errorMessage(error, tr));
        onAction(
          tr(
            'issue.detail.action.statusSyncFailed',
            'GitHub issue status sync failed',
          ),
        );
        showSyncNotice(
          tr('issue.detail.syncNotice.pending.title', 'GitHub sync pending'),
          tr(
            'issue.detail.syncNotice.pending.message',
            'Could not sync status to GitHub. It will retry when you reopen this issue.',
          ),
          'warning',
        );
      })
      .finally(() => {
        setAction((currentAction) =>
          currentAction === 'status-sync' ? null : currentAction,
        );
      });
  }, [
    current.description,
    current.id,
    current.status,
    detail,
    linkedGitHubIssueNumber,
    onAction,
    projectId,
    targetRepoIntegrationId,
    tr,
  ]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setSelectedFiles(files);
    if (files.length > 0) {
      onAction(
        tr(
          'issue.detail.action.attachmentsSelected',
          '{count} attachment(s) selected',
          {
            count: files.length,
          },
        ),
      );
    }
  };

  const handleSubmitDescription = async () => {
    if (!targetRepoIntegrationId || !linkedGitHubIssueNumber) {
      onAction(
        tr(
          'issue.detail.action.connectGithubDescription',
          'Connect a GitHub issue to sync description',
        ),
      );
      return;
    }
    await runAction('description', async () => {
      const body = descriptionDraft;
      const summary = await projectGithubApi.updateIssueBody(
        projectId,
        targetRepoIntegrationId,
        linkedGitHubIssueNumber,
        body,
      );
      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        description: body,
      });
      setDetail((existing) =>
        existing
          ? {
              ...existing,
              github_issue_detail: {
                summary,
                body,
                comments: existing.github_issue_detail?.comments ?? [],
              },
            }
          : existing,
      );
      patchCurrentWorkItem(updated);
      onAction(
        tr(
          'issue.detail.action.descriptionSynced',
          'Description synced to GitHub',
        ),
      );
      showSyncNotice(
        tr('issue.detail.syncNotice.complete.title', 'GitHub sync complete'),
        tr(
          'issue.detail.syncNotice.descriptionSynced.message',
          'Description synced to GitHub.',
        ),
        'success',
      );
    });
  };

  const handleSaveDescriptionDraft = async () => {
    const body = descriptionDraft;
    if (body === issueBodyText) return;
    setActionError('');
    try {
      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        description: body,
      });
      setDetail((existing) =>
        existing
          ? {
              ...existing,
              work_item: updated,
              github_issue_detail: existing.github_issue_detail
                ? {
                    ...existing.github_issue_detail,
                    body,
                  }
                : existing.github_issue_detail,
            }
          : existing,
      );
      onWorkItemChange?.(updated);
      onIssueSync?.({
        workItem: updated,
        labels: githubIssue ? issueLabels : undefined,
      });
      onAction(tr('issue.detail.action.descriptionSaved', 'Description saved'));
    } catch (error) {
      setActionError(errorMessage(error, tr));
    }
  };

  const handleSyncActivity = async () => {
    if (!targetRepoIntegrationId || !linkedGitHubIssueNumber) {
      onAction(
        tr(
          'issue.detail.action.connectGithubActivity',
          'Connect a GitHub issue to sync activity',
        ),
      );
      return;
    }
    await runAction('activity-sync', async () => {
      const githubDetail = await projectGithubApi.refreshIssue(
        projectId,
        targetRepoIntegrationId,
        linkedGitHubIssueNumber,
      );
      setDetail((existing) =>
        existing
          ? { ...existing, github_issue_detail: githubDetail }
          : existing,
      );
      onAction(
        tr(
          'issue.detail.action.activitySynced',
          'Activity synced from GitHub',
        ),
      );
      showSyncNotice(
        tr('issue.detail.syncNotice.complete.title', 'GitHub sync complete'),
        tr(
          'issue.detail.syncNotice.activitySynced.message',
          'Activity synced from GitHub.',
        ),
        'success',
      );
    });
  };

  const handleSubmitComment = async () => {
    const body = composeIssueCommentBody(commentText, selectedFiles, tr);
    if (!body) return;
    if (
      hasGitHubIssue &&
      (!targetRepoIntegrationId || !linkedGitHubIssueNumber)
    ) {
      return;
    }
    await runAction('comment', async () => {
      if (targetRepoIntegrationId && linkedGitHubIssueNumber) {
        await projectGithubApi.commentIssue(
          projectId,
          targetRepoIntegrationId,
          linkedGitHubIssueNumber,
          body,
        );
      } else {
        const comment = await projectWorkItemsApi.comment(
          projectId,
          current.id,
          body,
        );
        setDetail((existing) =>
          existing
            ? {
                ...existing,
                comments: [...existing.comments, comment],
              }
            : {
                work_item: current,
                external_links: [],
                comments: [comment],
                execution_links: [],
                delivery_records: [],
                github_audits: [],
                github_issue_detail: null,
              },
        );
      }
      setCommentText('');
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (targetRepoIntegrationId && linkedGitHubIssueNumber) {
        const githubDetail = await projectGithubApi.refreshIssue(
          projectId,
          targetRepoIntegrationId,
          linkedGitHubIssueNumber,
        );
        setDetail((existing) =>
          existing
            ? { ...existing, github_issue_detail: githubDetail }
            : existing,
        );
      }
      onAction(
        hasGitHubIssue
          ? tr('issue.detail.action.commentSynced', 'Comment synced to GitHub')
          : tr('issue.detail.action.commentAdded', 'Comment added'),
      );
      if (hasGitHubIssue) {
        showSyncNotice(
          tr('issue.detail.syncNotice.complete.title', 'GitHub sync complete'),
          tr(
            'issue.detail.syncNotice.commentSynced.message',
            'Comment synced to GitHub.',
          ),
          'success',
        );
      }
    });
  };

  const handleStatusChange = async (nextStatus: IssueDetailStatus) => {
    if (nextStatus === issueStatus) return;
    await runAction(`status-${nextStatus}`, async () => {
      if (targetRepoIntegrationId && linkedGitHubIssueNumber) {
        const githubSummary = await projectGithubApi.updateIssueState(
          projectId,
          targetRepoIntegrationId,
          linkedGitHubIssueNumber,
          issueStatusSyncsToClosed(nextStatus) ? 'closed' : 'open',
        );
        setDetail((existing) =>
          existing
            ? {
                ...existing,
                github_issue_detail: {
                  summary: githubSummary,
                  body:
                    existing.github_issue_detail?.body ?? current.description,
                  comments: existing.github_issue_detail?.comments ?? [],
                },
              }
            : existing,
        );
      }
      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        status: nextStatus,
      });
      patchCurrentWorkItem(updated);
      clearPendingIssueStatusSync(projectId, current.id);
      notifyBuildStatsUsageUpdated(projectId);
      onAction(
        tr(
          'issue.detail.action.statusUpdated',
          'Issue status updated to {status}',
          {
            status: statusLabel(nextStatus, tr),
          },
        ),
      );
    });
  };

  const handlePriorityChange = async (priority: ProjectWorkItemPriority) => {
    if (priority === current.priority) return;
    await runAction(`priority-${priority}`, async () => {
      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        priority,
      });
      patchCurrentWorkItem(updated);
      onAction(
        tr(
          'issue.detail.action.priorityUpdated',
          'Priority updated to {priority}',
          {
            priority: priorityLabel(priority, tr),
          },
        ),
      );
    });
  };

  const handleStatusMenuSelect = (status: IssueDetailStatus) => {
    setOpenPropertyMenu(null);
    setStatusQuery('');
    setLabelQuery('');
    void handleStatusChange(status);
  };

  const handlePriorityMenuSelect = (priority: PriorityMenuValue) => {
    setOpenPropertyMenu(null);
    setPriorityQuery('');
    setLabelQuery('');
    if (priority === 'none') {
      onAction(
        tr(
          'issue.detail.action.priorityRequired',
          'Project work items require a priority',
        ),
      );
      return;
    }
    void handlePriorityChange(priority);
  };

  const handleSaveLabels = async (labels: string[]) => {
    await runAction('labels', async () => {
      if (hasGitHubIssue) {
        if (!targetRepoIntegrationId || !linkedGitHubIssueNumber) return;
        const nextLabels = await projectGithubApi.updateIssueLabels(
          projectId,
          targetRepoIntegrationId,
          linkedGitHubIssueNumber,
          labels,
        );
        const mirrored = await projectWorkItemsApi.update(
          projectId,
          current.id,
          { labels_json: JSON.stringify(nextLabels) },
        );
        setDetail((existing) =>
          existing
            ? {
                ...existing,
                work_item: mirrored,
                github_issue_detail: existing.github_issue_detail
                  ? {
                      ...existing.github_issue_detail,
                      summary: {
                        ...existing.github_issue_detail.summary,
                        labels: nextLabels,
                      },
                    }
                  : existing.github_issue_detail,
              }
            : existing,
        );
        onWorkItemChange?.(mirrored);
        onIssueSync?.({ workItem: mirrored, labels: nextLabels });
        onAction(
          tr('issue.detail.action.labelsSynced', 'Labels synced to GitHub'),
        );
        return;
      }

      const updated = await projectWorkItemsApi.update(projectId, current.id, {
        labels_json: JSON.stringify(labels),
      });
      patchCurrentWorkItem(updated);
      onAction(tr('issue.detail.action.labelsUpdated', 'Labels updated'));
    });
  };

  const handleLabelMenuSelect = (label: string) => {
    const nextLabels = toggleLabel(labelDraftToList(labelDraft), label);
    setLabelDraft(nextLabels.join(', '));
    setLabelQuery('');
    if (!canEditLabels) {
      onAction(
        tr(
          'issue.detail.action.connectGithubLabels',
          'Connect a GitHub issue to sync labels',
        ),
      );
      return;
    }
    void handleSaveLabels(nextLabels);
  };

  useEffect(() => {
    if (!openPropertyMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPropertyMenu(null);
        setStatusQuery('');
        setPriorityQuery('');
        setLabelQuery('');
        setSessionQuery('');
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (openPropertyMenu === 'status') {
          const option = filterMenuOptions(statusMenuOptions, statusQuery)[0];
          if (option) handleStatusMenuSelect(option.value);
          return;
        }
        if (openPropertyMenu === 'priority') {
          const option = filterMenuOptions(
            priorityMenuOptions,
            priorityQuery,
          )[0];
          if (option) handlePriorityMenuSelect(option.value);
          return;
        }
        if (openPropertyMenu === 'session') {
          const option = filterMenuOptions(sessionMenuOptions, sessionQuery)[0];
          if (option) handleAssignSession(option.value);
          return;
        }
        const trimmedLabelQuery = labelQuery.trim();
        const labelOptions = filterMenuOptions(
          buildLabelMenuOptions(
            labelDraftToList(labelDraft),
            tr,
            availableLabels,
          ),
          labelQuery,
        );
        const exactLabelMatch = labelOptions.find(
          (candidate) =>
            labelKey(candidate.value) === labelKey(trimmedLabelQuery),
        );
        if (exactLabelMatch) {
          handleLabelMenuSelect(exactLabelMatch.value);
        } else if (trimmedLabelQuery) {
          handleLabelMenuSelect(trimmedLabelQuery);
        } else if (labelOptions[0]) {
          handleLabelMenuSelect(labelOptions[0].value);
        }
        return;
      }

      if (openPropertyMenu === 'status') {
        const option = statusMenuOptions.find(
          (candidate) => candidate.shortcut === event.key,
        );
        if (option) {
          event.preventDefault();
          handleStatusMenuSelect(option.value);
        }
        return;
      }

      if (openPropertyMenu === 'priority') {
        const option = priorityMenuOptions.find(
          (candidate) => candidate.shortcut === event.key,
        );
        if (option) {
          event.preventDefault();
          handlePriorityMenuSelect(option.value);
        }
        return;
      }

      const option = buildLabelMenuOptions(
        labelDraftToList(labelDraft),
        tr,
        availableLabels,
      ).find((candidate) => candidate.shortcut === event.key);
      if (option) {
        event.preventDefault();
        handleLabelMenuSelect(option.value);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  const linkSession = async (sessionId: string) => {
    const executionLink = await projectWorkItemsApi.linkExecution(
      projectId,
      current.id,
      {
        session_id: sessionId,
        workflow_execution_id: null,
        workflow_step_id: null,
        run_id: null,
        link_type: 'discussed_in',
      },
    );
    setDetail((existing) =>
      existing
        ? {
            ...existing,
            execution_links: [...existing.execution_links, executionLink],
          }
        : existing,
    );
  };

  const handleAssignSession = async (sessionId: string) => {
    if (!sessionId || linkedSessionIdSet.has(sessionId)) return;
    await runAction(`assign-session-${sessionId}`, async () => {
      await linkSession(sessionId);
      setOpenPropertyMenu(null);
      setSessionQuery('');
      onAction(
        tr('issue.detail.action.sessionLinked', 'Session linked to issue'),
      );
    });
  };

  const performCreateSession = async (
    worktreeMode: ChatSessionWorktreeMode | null,
  ) => {
    await runAction('create-session', async () => {
      const labelsForPrompt =
        issueLabels.length > 0 ? issueLabels : labelDraftToList(labelDraft);
      const prompt = buildIssueSessionPrompt({
        label: issuePromptLabel(labelsForPrompt, current.type, tr),
        title: issueTitle,
        description: descriptionForPrompt,
        tr,
      });
      const useWorkflowMode = shouldUseWorkflowModeForIssue(
        labelsForPrompt,
        current.type,
      );
      const mode: ChatInputPrefillMode | undefined = useWorkflowMode
        ? 'workflow'
        : undefined;
      const createdSession = await projectApi.createSession(projectId, {
        title: truncateIssueSessionTitle(
          issueTitle,
          tr('issue.detail.issueSessionDefault', 'Issue session'),
        ),
        workspace_path: projectWorkspacePath,
        ...(worktreeMode ? { worktree_mode: worktreeMode } : {}),
      });

      await linkSession(createdSession.id);

      setProjectSessions((sessions) => [
        createdSession,
        ...sessions.filter((session) => session.id !== createdSession.id),
      ]);
      setSessions((sessions) => [
        mapSession(createdSession, { activeSessionId: createdSession.id }),
        ...sessions
          .filter((session) => session.id !== createdSession.id)
          .map((session) => ({ ...session, active: false })),
      ]);
      setActiveSessionId(createdSession.id);
      setOpenPropertyMenu(null);
      setSessionQuery('');

      notifyLinkedWorkItemsChanged({
        projectId,
        sessionId: createdSession.id,
        workItemId: current.id,
      });
      window.dispatchEvent(
        new CustomEvent('openteams:navigate-session', {
          detail: createdSession.id,
        }),
      );
      notifyChatInputPrefill({
        sessionId: createdSession.id,
        text: prompt,
        ...(mode ? { mode } : {}),
      });
      void refreshSessions().catch(() => undefined);
      onAction(
        mode === 'workflow'
          ? tr(
              'issue.detail.action.sessionCreatedWorkflow',
              'Session created and workflow prompt prepared',
            )
          : tr(
              'issue.detail.action.sessionCreated',
              'Session created and prompt prepared',
            ),
      );
    });
  };

  // The work-item "Create session" entry opens a dialog first so the user can
  // decide whether to isolate the new session in a Git worktree (per the
  // session-worktree-isolation-design doc). The dialog defaults to off,
  // preserving the historical main-workspace behavior.
  const handleOpenCreateSessionDialog = async () => {
    setWorktreeSessionGit(null);
    setWorktreeSessionOpen(true);
    const trimmedWorkspacePath = projectWorkspacePath?.trim() ?? '';
    if (!trimmedWorkspacePath) {
      setWorktreeSessionGit(false);
      return;
    }
    try {
      const workspace = await chatSessionsApi.validateWorkspacePath(
        trimmedWorkspacePath,
      );
      setWorktreeSessionGit(workspace.valid && workspace.is_git_repo);
    } catch {
      setWorktreeSessionGit(false);
    }
  };

  const handleWorktreeSessionCreate = async (
    worktreeMode: ChatSessionWorktreeMode | null,
  ) => {
    setWorktreeSessionOpen(false);
    await performCreateSession(worktreeMode);
  };

  const handleUnlinkSession = async (linkId: string) => {
    await runAction(`unlink-session-${linkId}`, async () => {
      await projectWorkItemsApi.unlinkExecution(projectId, current.id, linkId);
      setDetail((existing) =>
        existing
          ? {
              ...existing,
              execution_links: existing.execution_links.filter(
                (link) => link.id !== linkId,
              ),
            }
          : existing,
      );
      onAction(
        tr('issue.detail.action.sessionUnlinked', 'Session unlinked from issue'),
      );
    });
  };

  const commentBody = composeIssueCommentBody(commentText, selectedFiles, tr);
  const labelList = labelDraftToList(labelDraft);
  const labelMenuOptions = buildLabelMenuOptions(
    labelList,
    tr,
    availableLabels,
  );
  const filteredLabelOptions = filterMenuOptions(labelMenuOptions, labelQuery);
  const filteredSessionOptions = filterMenuOptions(
    sessionMenuOptions,
    sessionQuery,
  );
  const filteredStatusOptions = filterMenuOptions(
    statusMenuOptions,
    statusQuery,
  );
  const filteredPriorityOptions = filterMenuOptions(
    priorityMenuOptions,
    priorityQuery,
  );

  return (
    <>
      {syncNotice && (
        <NotificationToast
          key={syncNotice.id}
          title={syncNotice.title}
          message={syncNotice.message}
          tone={syncNotice.tone}
          onClose={() => setSyncNotice(null)}
        />
      )}
      <IssueDetailHeader
        issue={{ ...issue, title: issueTitle, status: issueStatus }}
        projectName={projectName}
        onBack={onBack}
        onAction={onAction}
        onStartRename={() => setTitleEditing(true)}
        onDeleteIssue={handleDeleteIssue}
        renaming={action === 'rename-issue'}
        deleting={action === 'delete-issue'}
        linkedProviderId={linkedProviderId}
        linkedRepoName={linkedRepoName}
        onOpenIntegrations={onOpenIntegrations}
        tr={tr}
        worktreeSessionOpen={worktreeSessionOpen}
        worktreeSessionGit={worktreeSessionGit}
        onCloseWorktreeSession={() => setWorktreeSessionOpen(false)}
        onCreateWorktreeSession={handleWorktreeSessionCreate}
      />

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--surface-2)] text-[var(--ink)]">
        <div className="grid min-w-[820px] grid-cols-[minmax(0,1fr)_268px] gap-8 px-[15px] pb-14 pt-[6px]">
          <section className="min-w-0 pl-2 pr-1 pt-6">
            {titleEditing ? (
              <form
                className="flex min-w-0 items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!titleSaveDisabled) void handleSaveTitleDraft();
                }}
              >
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  className="h-10 min-w-0 flex-1 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 text-[23px] font-bold leading-tight text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-tertiary)] focus:border-[var(--hairline-strong)]"
                  placeholder={tr(
                    'issue.detail.actions.namePlaceholder',
                    'Issue name',
                  )}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setTitleEditing(false);
                      setTitleDraft(issueTitle);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={titleSaveDisabled}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline)] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={tr(
                    'issue.detail.actions.saveName',
                    'Save name',
                  )}
                >
                  <Save aria-hidden="true" className="h-[18px] w-[18px]" />
                </button>
              </form>
            ) : (
              <h2 className="text-[23px] font-bold leading-tight text-[var(--ink)]">
                {issueTitle}
              </h2>
            )}
            <div className="mt-2 flex items-center gap-2 text-[12px] font-medium text-[var(--ink-subtle)]">
              <IssueAvatar
                avatarUrl={creatorAvatarUrl}
                name={creatorName}
                fallback={creatorFallback}
                size="normal"
              />
              <span className="min-w-0 truncate">
                {tr('issue.detail.openedBy', '{name} opened this issue on {date}', {
                  name: creatorName,
                  date: formatSimpleDate(creatorDate),
                })}
              </span>
            </div>

            {detailError && (
              <InlineError className="mt-4">{detailError}</InlineError>
            )}
            {actionError && (
              <InlineError className="mt-4">{actionError}</InlineError>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {detailLoading ? (
              <div className="mt-[22px] rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px] text-[14px] font-medium leading-relaxed text-[var(--ink-tertiary)]">
                {tr(
                  'issue.detail.loadingDescription',
                  'Loading description...',
                )}
              </div>
            ) : descriptionEditing ? (
              <textarea
                autoFocus
                value={descriptionDraft}
                placeholder={tr(
                  'issue.detail.addDescription',
                  'Add a description...',
                )}
                className="mt-[22px] min-h-[126px] w-full resize-y rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px] text-[14px] leading-relaxed text-[var(--ink-muted)] outline-none transition placeholder:text-[var(--ink-tertiary)] focus:border-[var(--hairline-strong)]"
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={() => {
                  void handleSaveDescriptionDraft();
                  setDescriptionEditing(false);
                }}
              />
            ) : descriptionDraft ? (
              <div
                className="mt-[22px] cursor-text rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px]"
                onClick={() => setDescriptionEditing(true)}
              >
                <AgentMarkdown content={descriptionDraft} fontSize={14} />
              </div>
            ) : (
              <div
                className="mt-[22px] cursor-text rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px] text-[14px] leading-relaxed text-[var(--ink-tertiary)]"
                onClick={() => setDescriptionEditing(true)}
              >
                {tr(
                  'issue.detail.addDescription',
                  'Add a description...',
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-[18px] text-[var(--ink-subtle)]">
              <button
                type="button"
                disabled={action === 'description' || !canWriteGitHub}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={tr(
                  'issue.detail.syncDescriptionToGithub',
                  'Sync description to GitHub',
                )}
                title={tr(
                  'issue.detail.syncDescriptionToGithub',
                  'Sync description to GitHub',
                )}
                onClick={() => void handleSubmitDescription()}
              >
                <CloudUpload
                  aria-hidden="true"
                  className="h-[15px] w-[15px]"
                  strokeWidth={2.2}
                />
              </button>
            </div>

            <button
              type="button"
              className="mt-[22px] flex items-center gap-2 text-[13px] font-medium leading-none text-[var(--ink-subtle)] transition hover:text-[var(--ink)]"
              onClick={() =>
                onAction(
                  tr(
                    'issue.detail.action.subIssuesOpened',
                    'Sub-issues opened for {id}',
                    { id: issue.id },
                  ),
                )
              }
            >
              <Plus aria-hidden="true" className="h-[14px] w-[14px]" />
              <span>{tr('issue.detail.addSubIssues', 'Add sub-issues')}</span>
            </button>

            <div className="mt-3 border-t border-[var(--hairline)] pt-5">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-[17px] font-bold leading-none text-[var(--ink)]">
                  {tr('issue.detail.activity', 'Activity')}
                </h3>
                <button
                  type="button"
                  disabled={action === 'activity-sync' || !canSyncActivity}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={tr(
                    'issue.detail.syncCommentsFromGithub',
                    'Sync comments from GitHub',
                  )}
                  title={tr(
                    'issue.detail.syncCommentsFromGithub',
                    'Sync comments from GitHub',
                  )}
                  onClick={() => void handleSyncActivity()}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`h-[18px] w-[18px] ${
                      action === 'activity-sync' ? 'animate-spin' : ''
                    }`}
                    strokeWidth={2.2}
                  />
                </button>
              </div>

              <div className="flex items-center gap-3 pl-[10px] text-[13px] font-medium leading-none text-[var(--ink-muted)]">
                <IssueAvatar
                  avatarUrl={creatorAvatarUrl}
                  name={creatorName}
                  fallback={creatorFallback}
                  size="normal"
                />
                <span>
                  {creatorName}{' '}
                  {tr('issue.detail.createdIssue', 'created the issue')}{' '}
                  <span className="text-[var(--ink-tertiary)]">
                    {formatSimpleDate(creatorDate)}
                  </span>
                </span>
              </div>

              {issueComments.length > 0 ? (
                <div className="mt-5 space-y-3">
                  {issueComments.map((comment) => (
                    <article
                      key={String(comment.id)}
                      className="flex gap-3 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px]"
                    >
                      <IssueAvatar
                        avatarUrl={commentAvatarUrl(
                          comment,
                          githubAccount ?? null,
                        )}
                        name={
                          comment.author ??
                          tr('issue.detail.unknownUser', 'unknown')
                        }
                        size="large"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-[var(--ink-subtle)]">
                          {comment.author ??
                            tr('issue.detail.unknownUser', 'unknown')}{' '}
                          <span className="font-medium text-[var(--ink-tertiary)]">
                            {formatSimpleDate(comment.created_at)}
                          </span>
                        </p>
                        <div className="mt-2">
                          <AgentMarkdown
                            content={commentBodyText(comment.body, tr)}
                            fontSize={14}
                          />
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-5 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-[15px] text-[13px] font-medium text-[var(--ink-tertiary)]">
                  {tr('issue.detail.noComments', 'No comments yet.')}
                </p>
              )}

              <div className="mt-6 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-[12px]">
                <textarea
                  value={commentText}
                  placeholder={tr(
                    'issue.detail.commentPlaceholder',
                    'Leave a comment...',
                  )}
                  className="min-h-[82px] w-full resize-y bg-transparent text-[14px] leading-relaxed text-[var(--ink-muted)] outline-none placeholder:text-[var(--ink-tertiary)]"
                  onChange={(event) => setCommentText(event.target.value)}
                  onFocus={() =>
                    onAction(
                      tr(
                        'issue.detail.commentFocused',
                        'Comment focused for {id}',
                        { id: issue.id },
                      ),
                    )
                  }
                />
                {selectedFiles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedFiles.map((file) => (
                      <span
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="inline-flex max-w-[260px] items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-1 text-[12px] font-semibold text-[var(--ink-subtle)]"
                      >
                        <Paperclip
                          aria-hidden="true"
                          className="h-[12px] w-[12px] shrink-0"
                        />
                        <span className="truncate">
                          {file.name} ({formatFileSize(file.size)})
                        </span>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="inline-flex h-6 items-center rounded-full px-2 text-[12px] font-semibold text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                      onClick={() => {
                        setSelectedFiles([]);
                        if (fileInputRef.current)
                          fileInputRef.current.value = '';
                      }}
                    >
                      {tr('issue.detail.clear', 'Clear')}
                    </button>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--ink-subtle)] transition hover:text-[var(--ink)]"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip
                      aria-hidden="true"
                      className="h-[14px] w-[14px]"
                    />
                    {tr('issue.detail.attach', 'Attach')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      action === 'comment' || !commentBody || !canComment
                    }
                    className="flex h-8 items-center gap-2 rounded-[8px] bg-[var(--primary)] px-3 text-[13px] font-bold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[var(--surface-4)] disabled:text-[var(--ink-tertiary)]"
                    onClick={() => void handleSubmitComment()}
                  >
                    <Send
                      aria-hidden="true"
                      className="h-[14px] w-[14px]"
                      strokeWidth={2.4}
                    />
                    {action === 'comment'
                      ? tr('issue.detail.sending', 'Sending...')
                      : tr('issue.detail.comment', 'Comment')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="min-w-0 pt-4">
            <DetailPanel
              panelId="properties"
              title={tr('issue.detail.panel.properties', 'Properties')}
              tr={tr}
            >
              <div ref={propertyMenuRef} className="relative space-y-3">
                <StatusDropdown
                  disabled={Boolean(action?.startsWith('status-'))}
                  open={openPropertyMenu === 'status'}
                  options={filteredStatusOptions}
                  query={statusQuery}
                  tr={tr}
                  value={issueStatus}
                  onOpenChange={(open) => {
                    setOpenPropertyMenu(open ? 'status' : null);
                    setStatusQuery('');
                    setPriorityQuery('');
                    setLabelQuery('');
                    setSessionQuery('');
                  }}
                  onQueryChange={setStatusQuery}
                  onSelect={handleStatusMenuSelect}
                />
                <PriorityDropdown
                  disabled={Boolean(action?.startsWith('priority-'))}
                  open={openPropertyMenu === 'priority'}
                  options={filteredPriorityOptions}
                  query={priorityQuery}
                  tr={tr}
                  value={current.priority}
                  onOpenChange={(open) => {
                    setOpenPropertyMenu(open ? 'priority' : null);
                    setPriorityQuery('');
                    setStatusQuery('');
                    setLabelQuery('');
                    setSessionQuery('');
                  }}
                  onQueryChange={setPriorityQuery}
                  onSelect={handlePriorityMenuSelect}
                />
              </div>
            </DetailPanel>

            <DetailPanel
              panelId="labels"
              title={tr('issue.detail.panel.labels', 'Labels')}
              tr={tr}
            >
              <LabelDropdown
                menuRef={labelMenuRef}
                disabled={action === 'labels' || !canEditLabels}
                labels={labelList}
                open={openPropertyMenu === 'labels'}
                options={filteredLabelOptions}
                query={labelQuery}
                saving={action === 'labels'}
                tr={tr}
                onOpenChange={(open) => {
                  setOpenPropertyMenu(open ? 'labels' : null);
                  setLabelQuery('');
                  setStatusQuery('');
                  setPriorityQuery('');
                  setSessionQuery('');
                }}
                onQueryChange={setLabelQuery}
                onSelect={handleLabelMenuSelect}
              />
            </DetailPanel>

            <DetailPanel
              panelId="project"
              title={tr('issue.detail.panel.project', 'Project')}
              tr={tr}
            >
              {linkedSessionLinks.length > 0 ? (
                <div className="space-y-2">
                  {linkedSessionLinks.map(({ linkId, sessionId }) => {
                    const unlinking = action === `unlink-session-${linkId}`;
                    return (
                      <div
                        key={linkId}
                        className="flex w-full items-center gap-[10px] text-left text-[14px] font-semibold leading-none text-[var(--ink)]"
                      >
                        <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center text-[var(--ink)]">
                          <Box
                            aria-hidden="true"
                            className="h-[16px] w-[16px]"
                            strokeWidth={2.2}
                          />
                        </span>
                        <button
                          type="button"
                          className="min-w-0 flex-1 cursor-pointer truncate text-left transition hover:text-[var(--primary)]"
                          title={sessionTitle(projectSessions, sessionId)}
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('openteams:navigate-session', {
                                detail: sessionId,
                              }),
                            );
                          }}
                        >
                          {sessionTitle(projectSessions, sessionId)}
                        </button>
                        <button
                          type="button"
                          disabled={unlinking}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={tr(
                            'issue.detail.unlinkSessionAria',
                            'Unlink {title}',
                            {
                              title: sessionTitle(projectSessions, sessionId),
                            },
                          )}
                          title={tr(
                            'issue.detail.unlinkSession',
                            'Unlink session',
                          )}
                          onClick={() => void handleUnlinkSession(linkId)}
                        >
                          <X
                            aria-hidden="true"
                            className="h-[12px] w-[12px]"
                            strokeWidth={2.4}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <SessionDropdown
                  menuRef={sessionMenuRef}
                  disabled={
                    sessionsLoading ||
                    Boolean(action?.startsWith('assign-session-')) ||
                    action === 'create-session' ||
                    detailLoading
                  }
                  loading={sessionsLoading}
                  open={openPropertyMenu === 'session'}
                  options={filteredSessionOptions}
                  query={sessionQuery}
                  tr={tr}
                  onOpenChange={(open) => {
                    setOpenPropertyMenu(open ? 'session' : null);
                    setSessionQuery('');
                    setStatusQuery('');
                    setPriorityQuery('');
                    setLabelQuery('');
                  }}
                  onQueryChange={setSessionQuery}
                  onSelect={(sessionId) => void handleAssignSession(sessionId)}
                />
                {linkedSessionLinks.length === 0 && (
                  <button
                    type="button"
                    disabled={action === 'create-session' || detailLoading || worktreeSessionOpen}
                    className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[var(--primary)] px-2.5 text-[12px] font-bold leading-none text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
                    onClick={() => void handleOpenCreateSessionDialog()}
                  >
                    {action === 'create-session' ? (
                      <RefreshCw
                        aria-hidden="true"
                        className="h-[14px] w-[14px] shrink-0 animate-spin"
                        strokeWidth={2.4}
                      />
                    ) : (
                      <Plus
                        aria-hidden="true"
                        className="h-[14px] w-[14px] shrink-0"
                        strokeWidth={2.4}
                      />
                    )}
                    <span className="min-w-0 truncate">
                      {tr('issue.detail.createSession', 'Create session')}
                    </span>
                  </button>
                )}
              </div>
            </DetailPanel>

            <DetailPanel
              panelId="external-link"
              title={tr('issue.detail.panel.externalLink', 'External link')}
              tr={tr}
            >
              {linkedGitHubIssueNumber && (
                <DetailStaticRow icon={Github}>
                  {tr(
                    'issue.detail.githubIssueNumber',
                    'GitHub Issue #{number}',
                    { number: linkedGitHubIssueNumber },
                  )}
                </DetailStaticRow>
              )}
              {(githubIssue?.summary.url ?? githubIssueLink?.url) && (
                <a
                  href={githubIssue?.summary.url ?? githubIssueLink?.url ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[13px] font-bold text-[#8d97ff] transition hover:text-[#b8bfff]"
                >
                  <Link2 aria-hidden="true" className="h-[14px] w-[14px]" />
                  {tr('issue.detail.openGithubIssue', 'Open GitHub issue')}
                </a>
              )}
            </DetailPanel>
          </aside>
        </div>
      </main>
    </>
  );
}

function IssueDetailHeader({
  issue,
  projectName,
  onBack,
  onAction,
  onStartRename,
  onDeleteIssue,
  renaming,
  deleting,
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
  worktreeSessionOpen,
  worktreeSessionGit,
  onCloseWorktreeSession,
  onCreateWorktreeSession,
}: {
  issue: IssueDetailItem;
  projectName: string;
  onBack: () => void;
  onAction: (message: string) => void;
  onStartRename: () => void;
  onDeleteIssue: () => Promise<boolean>;
  renaming: boolean;
  deleting: boolean;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueDetailTranslator;
  worktreeSessionOpen: boolean;
  worktreeSessionGit: boolean | null;
  onCloseWorktreeSession: () => void;
  onCreateWorktreeSession: (
    worktreeMode: ChatSessionWorktreeMode | null,
  ) => Promise<void> | void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const handleDelete = async () => {
    const deleted = await onDeleteIssue();
    if (deleted) {
      setDeleteDialogOpen(false);
    }
  };

  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <ProjectBreadcrumbAvatar name={projectName} />
        <button
          type="button"
          className="truncate text-[16px] font-semibold leading-none text-[var(--ink)] transition hover:text-[var(--ink)]"
          onClick={() =>
            onAction(
              tr('issue.detail.projectBreadcrumb', 'Project breadcrumb selected'),
            )
          }
        >
          {projectName}
        </button>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <button
          type="button"
          className="truncate text-[16px] font-semibold leading-none text-[var(--ink)] transition hover:text-[var(--ink)]"
          onClick={onBack}
        >
          {tr('issue.header.title', 'Issues')}
        </button>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="flex min-w-0 items-baseline gap-1 text-[16px] font-semibold leading-none text-[var(--ink)]">
          <IssueDisplayId
            id={issue.id}
            maxWidthPx={105}
            className="shrink-0 text-[var(--ink)]"
          />
          <span className="min-w-0 truncate">{issue.title}</span>
        </h1>
        <div ref={menuRef} className="relative ml-2 shrink-0">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={tr('issue.detail.actions.more', 'More issue options')}
            onClick={() => {
              setMenuOpen((open) => !open);
              onAction(
                tr(
                  'issue.detail.action.moreOptionsOpened',
                  'More options opened for {id}',
                  { id: issue.id },
                ),
              );
            }}
          >
            <MoreHorizontal aria-hidden="true" className="h-[17px] w-[17px]" />
          </button>

          {menuOpen && (
            <div className="absolute left-full top-full z-50 ml-2 mt-2 -translate-x-[30px]">
              <div
                role="menu"
                className="w-[226px] rounded-[8px] border border-[#34363a] bg-[#1b1b1c] p-2 text-[15px] shadow-[0_24px_70px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-12 w-full items-center gap-3 rounded-[8px] px-3 text-left font-semibold text-[#e9eaec] transition hover:bg-[#27282c]"
                  onClick={() => {
                    onStartRename();
                    setMenuOpen(false);
                  }}
                >
                  <Pencil
                    aria-hidden="true"
                    className="h-[18px] w-[18px] shrink-0 text-[#a6a8ad]"
                    strokeWidth={2.4}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {tr('issue.detail.actions.rename', 'Rename')}
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={renaming || deleting}
                  className="mt-1 flex h-12 w-full items-center gap-3 rounded-[8px] px-3 text-left font-semibold text-[#f1f2f3] transition hover:bg-[#27282c] disabled:cursor-not-allowed disabled:opacity-55"
                  onClick={() => {
                    setMenuOpen(false);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2
                    aria-hidden="true"
                    className="h-[19px] w-[19px] shrink-0 text-[#f1f2f3]"
                    strokeWidth={2.4}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {deleting
                      ? tr('issue.detail.actions.deleting', 'Deleting...')
                      : tr('issue.detail.actions.delete', 'Delete')}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <HeaderIntegrationControls
        linkedProviderId={linkedProviderId}
        linkedRepoName={linkedRepoName}
        onOpen={onOpenIntegrations}
        tr={tr}
      />
      {deleteDialogOpen && (
        <ConfirmationDialog
          title={tr('issue.detail.actions.confirmDelete', 'Confirm delete')}
          description={
            <span>
              {tr(
                'issue.detail.actions.deleteWarning',
                'This removes the issue from this project.',
              )}
            </span>
          }
          confirmLabel={
            deleting
              ? tr('issue.detail.actions.deleting', 'Deleting...')
              : tr('issue.detail.actions.confirmDelete', 'Confirm delete')
          }
          cancelLabel={tr('issue.detail.actions.cancelDelete', 'Cancel')}
          escLabel={tr('issue.detail.actions.escToCancel', 'Esc to cancel')}
          tone="danger"
          confirming={deleting}
          idPrefix="issue-delete-dialog"
          confirmIcon={<Trash2 className="h-3.5 w-3.5" />}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={() => void handleDelete()}
        />
      )}
      <IssueWorktreeSessionDialog
        open={worktreeSessionOpen}
        projectName={issue.title || tr('issue.detail.issueSessionDefault', 'Issue session')}
        gitAvailable={worktreeSessionGit}
        tr={tr}
        onClose={onCloseWorktreeSession}
        onCreate={(worktreeMode) =>
          onCreateWorktreeSession(worktreeMode)
        }
      />
    </header>
  );
}

function InlineError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[8px] border border-[#55343a] bg-[#28181b] px-4 py-[10px] text-[13px] font-semibold text-[#ffb4bf]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function DetailPlainButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="transition hover:text-[#f4f4f5]"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon
        aria-hidden="true"
        className="h-[15px] w-[15px]"
        strokeWidth={2.2}
      />
    </button>
  );
}

function DetailRoundButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-7 w-7 items-center justify-center rounded-full border border-[#2a2b2e] bg-[#202124] text-[#9fa2a9] transition hover:bg-[#292a2e] hover:text-[#f4f4f5] active:scale-95"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon
        aria-hidden="true"
        className="h-[14px] w-[14px]"
        strokeWidth={2.2}
      />
    </button>
  );
}

function DetailPanel({
  panelId,
  title,
  tr,
  children,
}: {
  panelId: string;
  title: string;
  tr: IssueDetailTranslator;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const contentId = `issue-detail-panel-${panelId}`;

  return (
    <section className="mb-[9px] rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-[15px]">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 text-left text-[15px] font-medium leading-none text-[var(--ink-subtle)] transition hover:text-[var(--ink)]',
          open && 'mb-[18px]',
        )}
        aria-expanded={open}
        aria-controls={contentId}
        aria-label={
          open
            ? tr('issue.detail.collapsePanel', 'Collapse {title}', { title })
            : tr('issue.detail.expandPanel', 'Expand {title}', { title })
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-[12px] w-[12px] shrink-0 transition-transform',
            !open && '-rotate-90',
          )}
          fill="#9da1a9"
          strokeWidth={0}
        />
      </button>
      <div id={contentId} hidden={!open} className="space-y-4">
        {children}
      </div>
    </section>
  );
}

function StatusDropdown({
  disabled,
  open,
  options,
  query,
  tr,
  value,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  disabled: boolean;
  open: boolean;
  options: StatusMenuOption[];
  query: string;
  tr: IssueDetailTranslator;
  value: IssueDetailStatus;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (status: IssueDetailStatus) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-7 max-w-full items-center gap-2 rounded-full px-1.5 text-[14px] font-normal leading-none text-[var(--ink)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onOpenChange(!open)}
      >
        <StatusMenuIcon status={value} />
        <span className="min-w-0 truncate">{statusLabel(value, tr)}</span>
      </button>

      {open && (
        <CommandMenuShell>
          <CommandSearchRow
            placeholder={tr('issue.detail.changeStatus', 'Change status...')}
            shortcut="S"
            value={query}
            onChange={onQueryChange}
          />
          <div className="space-y-0.5 px-1.5 py-1.5" role="listbox">
            {options.length > 0 ? (
              options.map((option, index) => {
                const selected = option.value === value;
                const active = index === 0;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      'flex h-8 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]',
                      active && 'bg-[var(--surface-4)]',
                    )}
                    onClick={() => onSelect(option.value)}
                  >
                    <StatusMenuIcon
                      status={option.value}
                      active={active}
                      inMenu
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="ml-auto flex w-9 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
                      {selected ? (
                        <Check
                          aria-hidden="true"
                          className="h-[14px] w-[14px]"
                          strokeWidth={3}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="h-[14px] w-[14px]"
                        />
                      )}
                      <span className="text-[13px] font-semibold">
                        {option.shortcut}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <CommandNoMatches tr={tr} />
            )}
          </div>
        </CommandMenuShell>
      )}
    </div>
  );
}

function PriorityDropdown({
  disabled,
  open,
  options,
  query,
  tr,
  value,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  disabled: boolean;
  open: boolean;
  options: PriorityMenuOption[];
  query: string;
  tr: IssueDetailTranslator;
  value: ProjectWorkItemPriority;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (priority: PriorityMenuValue) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-7 max-w-full items-center gap-2 rounded-full px-1.5 text-[14px] font-normal leading-none text-[var(--ink)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onOpenChange(!open)}
      >
        <PriorityMenuIcon priority={value} selected={value === 'urgent'} />
        <span className="min-w-0 truncate">{priorityLabel(value, tr)}</span>
      </button>

      {open && (
        <CommandMenuShell>
          <CommandSearchRow
            placeholder={tr('issue.detail.setPriority', 'Set priority to...')}
            shortcut="P"
            value={query}
            onChange={onQueryChange}
          />
          <div className="space-y-0.5 px-1.5 py-1.5" role="listbox">
            {options.length > 0 ? (
              options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="flex h-8 w-full items-center gap-2.5 whitespace-nowrap rounded-[8px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]"
                    onClick={() => onSelect(option.value)}
                  >
                    <PriorityMenuIcon priority={option.value} />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="ml-auto flex w-9 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
                      {selected ? (
                        <Check
                          aria-hidden="true"
                          className="h-[14px] w-[14px]"
                          strokeWidth={3}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="h-[14px] w-[14px]"
                        />
                      )}
                      <span className="text-[13px] font-semibold">
                        {option.shortcut}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <CommandNoMatches tr={tr} />
            )}
          </div>
        </CommandMenuShell>
      )}
    </div>
  );
}

function CommandMenuShell({ children }: { children: ReactNode }) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-[248px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
      {children}
    </div>
  );
}

function CommandSearchRow({
  placeholder,
  shortcut,
  value,
  onChange,
}: {
  placeholder: string;
  shortcut: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-10 items-center gap-2.5 border-b border-[var(--hairline)] px-3.5">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-none text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)]"
        onChange={(event) => onChange(event.target.value)}
      />
      <kbd className="flex h-6 min-w-6 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] px-1 text-[12px] font-medium leading-none text-[var(--ink-subtle)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {shortcut}
      </kbd>
    </div>
  );
}

function CommandNoMatches({ tr }: { tr: IssueDetailTranslator }) {
  return (
    <div className="px-3 py-2.5 text-[13px] font-semibold text-[var(--ink-tertiary)]">
      {tr('issue.detail.noMatches', 'No matches')}
    </div>
  );
}

function StatusMenuIcon({
  status,
  active = false,
  inMenu = false,
}: {
  status: IssueDetailStatus;
  active?: boolean;
  inMenu?: boolean;
}) {
  const ringBackground = active ? 'var(--surface-4)' : 'var(--surface-1)';
  const terminalBackground = inMenu ? '#7f8790' : '#acbac8';

  if (status === 'blocked') {
    return (
      <span
        aria-hidden="true"
        className="h-[14px] w-[14px] shrink-0 rounded-full"
        style={{
          background:
            'repeating-conic-gradient(#a9aab0 0deg 13deg, transparent 13deg 30deg)',
          WebkitMask:
            'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.4px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.4px))',
        }}
      />
    );
  }

  if (status === 'open') {
    return (
      <span
        aria-hidden="true"
        className="h-[14px] w-[14px] shrink-0 rounded-full border-2 border-[#d9d9de]"
      />
    );
  }

  if (status === 'in_progress') {
    return (
      <span
        aria-hidden="true"
        className="relative h-[14px] w-[14px] shrink-0 rounded-full border-2 border-[#f0c400]"
      >
        <span className="absolute left-1/2 top-[2px] h-[4.5px] w-0.5 -translate-x-1/2 rounded-full bg-[#f0c400]" />
        <span className="absolute left-1/2 top-1/2 h-0.5 w-1 -translate-y-1/2 rounded-full bg-[#f0c400]" />
      </span>
    );
  }

  if (status === 'ready_to_merge') {
    return (
      <span
        aria-hidden="true"
        className="relative h-[14px] w-[14px] shrink-0 overflow-hidden rounded-full border-2 border-[#4fc38b]"
      >
        <span className="absolute bottom-[1.5px] right-[1.5px] top-[1.5px] w-1 rounded-r-full bg-[#4fc38b]" />
        <span
          className="absolute inset-[3px] rounded-full"
          style={{ backgroundColor: ringBackground }}
        />
      </span>
    );
  }

  if (status === 'merging') {
    return (
      <span
        aria-hidden="true"
        className="relative h-[14px] w-[14px] shrink-0 rounded-full border-2 border-[#4fc38b]"
      >
        <span
          className="absolute left-[2.5px] top-[2px] h-[6.5px] w-[6.5px] rounded-full border-l-[3px] border-t-[3px] border-[#4fc38b]"
          style={{ backgroundColor: ringBackground }}
        />
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-[#6671e8] text-[#141519]"
      >
        <Check className="h-[9px] w-[9px]" strokeWidth={3.7} />
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span
        aria-hidden="true"
        className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: terminalBackground }}
      >
        <span className="absolute h-[2.4px] w-[7.4px] rotate-45 rounded-full bg-white" />
        <span className="absolute h-[2.4px] w-[7.4px] -rotate-45 rounded-full bg-white" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: terminalBackground }}
    >
      <span className="absolute h-[2.3px] w-[7.2px] -translate-y-[1.7px] -rotate-45 rounded-full bg-white" />
      <span className="absolute h-[2.3px] w-[7.2px] translate-y-[1.7px] -rotate-45 rounded-full bg-white" />
    </span>
  );
}

export function PriorityMenuIcon({
  priority,
  selected = false,
}: {
  priority: PriorityMenuValue;
  selected?: boolean;
}) {
  const iconFillClass = 'bg-[#a6a6aa]';
  const urgentFillClass = selected ? 'bg-[#ff5a36]' : iconFillClass;

  if (priority === 'none') {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-[14px] w-[14px] shrink-0 flex-nowrap items-center justify-center gap-[2px]"
      >
        {[0, 1, 2].map((bar) => (
          <span
            key={bar}
            className={cn('h-0.5 w-[3px] rounded-full', iconFillClass)}
          />
        ))}
      </span>
    );
  }

  if (priority === 'urgent') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[2px] text-[12px] font-black leading-none text-white',
          urgentFillClass,
        )}
      >
        !
      </span>
    );
  }

  const bars =
    priority === 'low' ? [5] : priority === 'medium' ? [5, 8] : [5, 8, 12];

  return (
    <span
      aria-hidden="true"
      className="flex h-[14px] w-[14px] shrink-0 items-end justify-start gap-0.5"
    >
      {bars.map((height) => (
        <span
          key={height}
          className={cn('w-[3px] rounded-full', iconFillClass)}
          style={{ height }}
        />
      ))}
    </span>
  );
}

function LabelDropdown({
  menuRef,
  disabled,
  labels,
  open,
  options,
  query,
  saving,
  tr,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  menuRef: { current: HTMLDivElement | null };
  disabled: boolean;
  labels: string[];
  open: boolean;
  options: LabelMenuOption[];
  query: string;
  saving: boolean;
  tr: IssueDetailTranslator;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (label: string) => void;
}) {
  const hasLabels = labels.length > 0;
  const addLabelLabel = tr('issue.detail.addLabel', 'Add label');
  const savingLabelsLabel = tr('issue.detail.savingLabels', 'Saving labels');
  const createLabelValue = query.trim();
  const canCreateLabel =
    createLabelValue !== '' &&
    !options.some(
      (option) => labelKey(option.value) === labelKey(createLabelValue),
    );

  return (
    <div ref={menuRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((label) => (
          <LabelChip
            key={label}
            disabled={disabled}
            label={label}
            tr={tr}
            onRemove={() => onSelect(label)}
          />
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={saving ? savingLabelsLabel : addLabelLabel}
          title={saving ? savingLabelsLabel : addLabelLabel}
          className={cn(
            'inline-flex h-7 max-w-full items-center rounded-full bg-[var(--surface-4)] text-[12px] font-bold leading-normal text-[var(--ink)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
            hasLabels ? 'w-7 justify-center px-0' : 'gap-1.5 px-2.5',
          )}
          onClick={() => onOpenChange(!open)}
        >
          {hasLabels ? (
            <Plus
              aria-hidden="true"
              className="h-[14px] w-[14px] shrink-0"
              strokeWidth={2.4}
            />
          ) : (
            <>
              <Tag
                aria-hidden="true"
                className="h-[13px] w-[13px] shrink-0"
                strokeWidth={2.3}
              />
              <span className="min-w-0 truncate">
                {saving
                  ? tr('issue.detail.saving', 'Saving...')
                  : addLabelLabel}
              </span>
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[8px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          <LabelSearchRow
            placeholder={tr(
              'issue.detail.addLabelsPlaceholder',
              'Add labels...',
            )}
            shortcut="L"
            value={query}
            onChange={onQueryChange}
          />
          <div className="space-y-1 px-3 py-3" role="listbox">
            {options.length > 0 ? (
              options.map((option) => {
                const selected = labels.some((label) =>
                  labelMatches(label, option.value),
                );
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    role="option"
                    aria-selected={selected}
                    className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[8px] px-3 text-left text-[13px] font-bold leading-normal text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onSelect(option.value)}
                  >
                    <LabelColorDot color={option.color} />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="ml-auto flex w-10 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
                      {selected ? (
                        <Check
                          aria-hidden="true"
                          className="h-[13px] w-[13px]"
                          strokeWidth={3}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="h-[13px] w-[13px]"
                        />
                      )}
                      {option.shortcut ? (
                        <span className="text-[12px] font-semibold">
                          {option.shortcut}
                        </span>
                      ) : (
                        <span aria-hidden="true" className="w-2" />
                      )}
                    </span>
                  </button>
                );
              })
            ) : canCreateLabel ? null : (
              <CommandNoMatches tr={tr} />
            )}
            {canCreateLabel && (
              <button
                key={`create-${createLabelValue}`}
                type="button"
                disabled={disabled}
                className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[8px] px-3 text-left text-[13px] font-bold leading-normal text-[var(--ink)] transition hover:bg-[var(--surface-4)] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => onSelect(createLabelValue)}
              >
                <Plus
                  aria-hidden="true"
                  className="h-[13px] w-[13px] shrink-0 text-[var(--primary)]"
                  strokeWidth={2.6}
                />
                <span className="min-w-0 flex-1 truncate">
                  {tr(
                    'issue.detail.createLabel',
                    "Create new label '{label}'",
                    { label: labelDisplayName(createLabelValue, tr) },
                  )}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionDropdown({
  menuRef,
  disabled,
  loading,
  open,
  options,
  query,
  tr,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  menuRef: { current: HTMLDivElement | null };
  disabled: boolean;
  loading: boolean;
  open: boolean;
  options: SessionMenuOption[];
  query: string;
  tr: IssueDetailTranslator;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-4)] px-2.5 text-[12px] font-bold leading-none text-[var(--ink)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onOpenChange(!open)}
      >
        <Box
          aria-hidden="true"
          className="h-[13px] w-[13px] shrink-0"
          strokeWidth={2.3}
        />
        <span className="min-w-0 truncate">
          {loading
            ? tr('issue.detail.loadingSessions', 'Loading sessions...')
            : tr('issue.detail.linkSession', 'Link session')}
        </span>
      </button>

      {open && (
        <CommandSelectMenu>
          <CommandSelectSearchRow
            placeholder={tr(
              'issue.detail.linkSessionPlaceholder',
              'Link session...',
            )}
            shortcut="S"
            value={query}
            onChange={onQueryChange}
          />
          <CommandSelectList>
            {options.length > 0 ? (
              options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[8px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]"
                  onClick={() => onSelect(option.value)}
                >
                  <Box
                    aria-hidden="true"
                    className="h-[13px] w-[13px] shrink-0 text-[var(--ink-subtle)]"
                    strokeWidth={2.3}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={option.label}
                  >
                    {option.label}
                  </span>
                </button>
              ))
            ) : (
              <CommandSelectNoMatches>
                {tr('issue.detail.noMatches', 'No matches')}
              </CommandSelectNoMatches>
            )}
          </CommandSelectList>
        </CommandSelectMenu>
      )}
    </div>
  );
}

function LabelSearchRow({
  placeholder,
  shortcut,
  value,
  onChange,
}: {
  placeholder: string;
  shortcut: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2.5 border-b border-[var(--hairline)] px-4">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-normal text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)]"
        onChange={(event) => onChange(event.target.value)}
      />
      <kbd className="flex h-6 min-w-6 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 text-[12px] font-medium leading-normal text-[var(--ink-subtle)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        {shortcut}
      </kbd>
    </div>
  );
}

function DetailStaticRow({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-[10px] text-left text-[14px] font-semibold leading-none text-[var(--ink)]">
      <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center text-[var(--ink)]">
        <Icon
          aria-hidden="true"
          className="h-[16px] w-[16px]"
          strokeWidth={2.2}
        />
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function LabelChip({
  disabled,
  label,
  tr,
  onRemove,
}: {
  disabled: boolean;
  label: string;
  tr: IssueDetailTranslator;
  onRemove: () => void;
}) {
  const displayLabel = labelDisplayName(label, tr);

  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--surface-4)] px-2.5 text-[12px] font-bold leading-normal text-[var(--ink-muted)]">
      <LabelColorDot color={labelColor(label)} />
      <span className="min-w-0 truncate">{displayLabel}</span>
      <button
        type="button"
        disabled={disabled}
        className="rounded-full text-[var(--ink-tertiary)] transition hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={tr('issue.detail.removeLabel', 'Remove {label}', {
          label: displayLabel,
        })}
        onClick={onRemove}
      >
        <X aria-hidden="true" className="h-[10px] w-[10px]" />
      </button>
    </span>
  );
}

function LabelColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function IssueAvatar({
  avatarUrl,
  name,
  fallback = 'initials',
  size = 'normal',
}: {
  avatarUrl?: string | null;
  name: string;
  fallback?: 'initials' | 'user';
  size?: 'normal' | 'large';
}) {
  const className = cn(
    'shrink-0 rounded-full border border-[#33353a] bg-[#202124]',
    size === 'large' ? 'h-8 w-8' : 'h-4 w-4',
  );

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(className, 'object-cover')}
      />
    );
  }

  if (fallback === 'user') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          className,
          'flex items-center justify-center text-[#9ca0a7]',
        )}
      >
        <User
          aria-hidden="true"
          className={
            size === 'large' ? 'h-[18px] w-[18px]' : 'h-[11px] w-[11px]'
          }
          strokeWidth={2.4}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        className,
        'flex items-center justify-center bg-[linear-gradient(135deg,#30323a,#5e6ad2)] font-mono font-black text-white',
        size === 'large' ? 'text-[11px]' : 'text-[8px]',
      )}
    >
      {accountInitials(name)}
    </span>
  );
}

function HeaderIntegrationControls({
  linkedProviderId,
  linkedRepoName,
  onOpen,
  tr,
}: {
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpen: () => void;
  tr: IssueDetailTranslator;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[var(--ink-tertiary)]">
      {linkedProviderId && (
        <span
          className="relative flex h-6 w-6 items-center justify-center text-[var(--ink)]"
          aria-label={tr(
            'issue.linkDialog.header.linkedTo',
            'Linked to {repoName}',
            {
              repoName:
                linkedRepoName ??
                tr(
                  'issue.linkDialog.header.externalRepository',
                  'external repository',
                ),
            },
          )}
          title={
            linkedRepoName ??
            tr(
              'issue.linkDialog.header.linkedExternalRepository',
              'Linked external repository',
            )
          }
        >
          <ProviderIcon
            providerId={linkedProviderId}
            className="h-[15px] w-[15px]"
          />
          <span className="absolute bottom-[3px] right-[2px] h-[6px] w-[6px] rounded-full border border-[var(--surface-1)] bg-[#39d353] shadow-[0_0_0_1px_rgba(57,211,83,0.28)]" />
        </span>
      )}
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
        aria-label={tr(
          'issue.linkDialog.openButton',
          'Link external project tool',
        )}
        title={tr('issue.linkDialog.openButton', 'Link external project tool')}
        onClick={onOpen}
      >
        <Link2 aria-hidden="true" className="h-[14px] w-[14px]" />
      </button>
    </div>
  );
}

function ProviderIcon({
  providerId,
  className,
}: {
  providerId: RemoteProviderId;
  className?: string;
}) {
  const provider = remoteProviderIcons[providerId];
  const Icon = provider.Icon;

  return (
    <Icon
      aria-hidden="true"
      className={cn(className, provider.iconClassName)}
    />
  );
}

function GitHubProviderIcon(props: SVGProps<SVGSVGElement>) {
  return <Github {...props} />;
}

function LinearProviderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      focusable="false"
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

function JiraProviderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="currentColor"
      focusable="false"
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005Zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001ZM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z" />
    </svg>
  );
}

function issueDisplayIdFontSizePx(displayId: string, maxWidthPx = 70) {
  const length = Math.max(displayId.length, 1);
  const fitSize = Math.floor(
    maxWidthPx / (length * ISSUE_ID_AVERAGE_CHAR_WIDTH_EM),
  );
  return Math.min(
    ISSUE_ID_BASE_FONT_SIZE_PX,
    Math.max(ISSUE_ID_MIN_FONT_SIZE_PX, fitSize),
  );
}

function IssueDisplayId({
  id,
  maxWidthPx = 70,
  className,
}: {
  id: string;
  maxWidthPx?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'block min-w-0 overflow-hidden whitespace-nowrap font-mono font-medium leading-none text-[#8f9298]',
        className,
      )}
      style={{
        maxWidth: maxWidthPx,
        fontSize: issueDisplayIdFontSizePx(id, maxWidthPx),
      }}
      title={id}
    >
      {id}
    </span>
  );
}

export function composeIssueCommentBody(
  comment: string,
  attachments: ReadonlyArray<IssueCommentAttachment>,
  tr?: IssueDetailTranslator,
) {
  const body = comment.trim();
  if (attachments.length === 0) return body;
  const attachmentLines = attachments.map(
    (file) => `- ${file.name} (${formatFileSize(file.size)})`,
  );
  const attachmentHeading = tr
    ? tr('issue.detail.attachmentsHeading', 'Attachments:')
    : 'Attachments:';
  const attachmentBlock = `${attachmentHeading}\n${attachmentLines.join('\n')}`;
  return body ? `${body}\n\n${attachmentBlock}` : attachmentBlock;
}

export function labelDraftToList(value: string) {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function projectWorkItemLabelList(value?: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((label): label is string => typeof label === 'string')
      .map((label) => label.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildLabelMenuOptions(
  selectedLabels: string[],
  tr: IssueDetailTranslator,
  availableLabels: string[] = [],
): LabelMenuOption[] {
  const values: string[] = [];
  const seen = new Set<string>();

  [...COMMON_GITHUB_LABELS, ...availableLabels, ...selectedLabels].forEach(
    (label) => {
      const key = labelKey(label);
      if (seen.has(key)) return;
      seen.add(key);
      values.push(label);
    },
  );

  return values.map((value, index) => ({
    value,
    label: labelDisplayName(value, tr),
    color: labelColor(value),
    shortcut: index < 9 ? String(index + 1) : '',
  }));
}

function toggleLabel(labels: string[], label: string) {
  return labels.some((item) => labelMatches(item, label))
    ? labels.filter((item) => !labelMatches(item, label))
    : [...labels, label];
}

function labelMatches(left: string, right: string) {
  return labelKey(left) === labelKey(right);
}

function labelKey(label: string) {
  return label.trim().toLowerCase();
}

export function labelDisplayName(label: string, tr?: IssueDetailTranslator) {
  const normalized = labelKey(label);
  const displayConfig = labelDisplayKeysByName[normalized];
  if (displayConfig) {
    return tr
      ? tr(displayConfig.key, displayConfig.fallback)
      : displayConfig.fallback;
  }
  return label
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function labelColor(label: string) {
  const normalized = labelKey(label);
  if (labelColorByName[normalized]) return labelColorByName[normalized];

  const palette = [
    '#f25f67',
    '#b987ff',
    '#5aaef7',
    '#8ddfcb',
    '#f3c86b',
    '#f59fb7',
    '#7edc8f',
  ];
  const hash = Array.from(normalized).reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  return palette[hash % palette.length];
}

export function findGitHubIssueLink(
  detail: ProjectWorkItemDetailResponse | null,
) {
  return (
    detail?.external_links.find(
      (link) =>
        link.provider === 'github' && link.external_type === 'github_issue',
    ) ?? null
  );
}

function findIssueRepoIntegrationId(
  repos: ProjectRepoIntegration[],
  repoId: string | null | undefined,
  issueUrl?: string | null,
) {
  if (repoId) {
    const directMatch =
      repos.find(
        (repo) => repo.repo_id === repoId && repo.sync_status === 'connected',
      )?.id ?? null;
    if (directMatch) return directMatch;
  }

  if (!issueUrl) return null;
  const match = issueUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\//i);
  if (!match) return null;
  const [, owner, repoName] = match;
  const cleanRepoName = repoName.replace(/\.git$/i, '');
  return (
    repos.find(
      (repo) =>
        repo.owner === owner &&
        repo.name === cleanRepoName &&
        repo.sync_status === 'connected',
    )?.id ?? null
  );
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: IssueDetailStatus, tr?: IssueDetailTranslator) {
  const entry = statusValueKey(status);
  if (entry) return tr ? tr(entry.key, entry.fallback) : entry.fallback;
  return status;
}

function priorityLabel(
  priority: ProjectWorkItemPriority,
  tr?: IssueDetailTranslator,
) {
  const entry = priorityValueKey(priority);
  if (entry) return tr ? tr(entry.key, entry.fallback) : entry.fallback;
  return titleCaseToken(priority);
}

export function defaultIssueUserIdentity(
  account: GitHubAccount | null,
  tr?: IssueDetailTranslator,
): {
  name: string;
  avatarUrl: string | null;
  fallback: 'initials' | 'user';
} {
  if (account) {
    return {
      name: account.login,
      avatarUrl: account.avatar_url,
      fallback: account.avatar_url ? 'initials' : 'user',
    };
  }
  return {
    name: tr ? tr('issue.detail.you', 'you') : 'you',
    avatarUrl: null,
    fallback: 'user',
  };
}

function commentAvatarUrl(
  comment: { author: string | null; author_avatar_url?: string | null },
  account: GitHubAccount | null,
) {
  if (comment.author_avatar_url) return comment.author_avatar_url;
  if (account && comment.author === account.login) return account.avatar_url;
  return null;
}

function commentBodyText(body: unknown, tr?: IssueDetailTranslator) {
  const text = typeof body === 'string' ? body : '';
  return text.trim()
    ? text
    : tr
      ? tr('issue.detail.noCommentBody', 'No comment body.')
      : 'No comment body.';
}

function filterMenuOptions<TOption extends { label: string }>(
  options: TOption[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;
  return options.filter((option) =>
    option.label.toLowerCase().includes(normalizedQuery),
  );
}

function issueStatusSyncsToClosed(status: IssueDetailStatus) {
  return status === 'done' || status === 'cancelled' || status === 'duplicate';
}

function titleCaseToken(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatSimpleDate(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function accountInitials(login: string) {
  return login
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
    .padEnd(2, login[0]?.toUpperCase() ?? 'G');
}

function sessionTitle(sessions: BackendChatSession[], sessionId: string) {
  const session = sessions.find((candidate) => candidate.id === sessionId);
  return session?.title?.trim() || sessionId;
}

function errorMessage(error: unknown, tr?: IssueDetailTranslator) {
  if (error && typeof error === 'object') {
    const data = (error as { errorData?: { message?: string; code?: string } })
      .errorData;
    if (data?.message) return data.message;
    if (data?.code) return data.code;
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return tr
    ? tr('issue.error.requestFailed', 'Request failed. Please try again.')
    : 'Request failed. Please try again.';
}
