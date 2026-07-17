import {
  ArrowLeftRight,
  BarChart3,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Github,
  Link2,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
  type SVGProps,
} from 'react';
import {
  DropdownSelect,
  type DropdownSelectOption,
} from '@/components/DropdownSelect';
import {
  IssueCreateDialog,
  type IssueCreateDialogSubmitValue,
} from '@/components/IssueCreateDialog';
import { IssueImportDialog } from '@/components/IssueImportDialog';
import {
  NotificationToast,
  type NotificationToastTone,
} from '@/components/NotificationToast';
import { ProjectBreadcrumbAvatar } from '@/components/ProjectBreadcrumbAvatar';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  useCommandHandler,
  useCommandPresentation,
  useShortcutScope,
} from '@/shortcuts/ShortcutProvider';
import {
  githubAuthApi,
  projectApi,
  projectGithubApi,
  projectWorkItemsApi,
} from '@/lib/api';
import {
  ISSUE_NAVIGATION_TARGET_CHANGED_EVENT,
  clearIssueNavigationTarget,
  readIssueNavigationTarget,
  type IssueNavigationTarget,
} from '@/lib/issueNavigation';
import { notifyBuildStatsUsageUpdated } from '@/lib/buildStatsEvents';
import {
  IssueDetailPage,
  PriorityMenuIcon,
  labelDisplayName,
  projectWorkItemLabelList,
  type IssueDetailSyncSnapshot,
} from '@/pages/IssueDetailPage';
import type {
  BackendChatSession,
  GitHubAccount,
  GitHubDeviceFlowStartResponse,
  GitHubIssueSummary,
  GitHubOAuthStartResponse,
  GitHubOAuthStatusResponse,
  GitHubRepositorySummary,
  IssueIntegrationProvider,
  ProjectIssueIntegrationsResponse,
  ProjectRepoIntegration,
  ProjectWorkItem,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
} from '@/types';

type IssueLabel = {
  name: string;
  color: 'red' | 'blue' | 'cyan';
};

type IssueItem = {
  id: string;
  workItemId: string;
  title: string;
  status: IssueStatusGroupId;
  labels?: IssueLabel[];
  date: string;
  workItem: ProjectWorkItem;
};

type IssueRowOverride = {
  status?: ProjectWorkItemStatus;
  priority?: ProjectWorkItem['priority'];
  externalLabels?: IssueLabel[];
};

type IssueRowOverrides = Record<string, IssueRowOverride>;

type IssueStatusGroupId =
  | 'todo'
  | 'in_progress'
  | 'backlog'
  | 'ready_to_merge'
  | 'merging'
  | 'done'
  | 'cancelled'
  | 'duplicate';

type IssueGroup = {
  id: IssueStatusGroupId;
  title: string;
  count: number;
  items: IssueItem[];
};

type IssueFilter = 'all' | 'active' | 'backlog';

type IssueRowPropertyMenu = 'status' | 'priority' | null;

type IssueRowMenuOption<TValue extends string> = {
  value: TValue;
  label: string;
  shortcut: string;
};

type RemoteProviderId = 'github' | 'linear' | 'jira';

type RemoteProvider = {
  id: RemoteProviderId;
  name: string;
  description: string;
  supported: boolean;
  Icon: RemoteProviderIcon;
  iconClassName: string;
};

type RemoteProviderIcon = (props: SVGProps<SVGSVGElement>) => ReactNode;

type IssueNotification = {
  id: number;
  title: string;
  message: string;
  tone: NotificationToastTone;
};

type IssueTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

const issueGroupStatusKey: Record<IssueGroup['id'], string> = {
  todo: 'issue.status.todo',
  in_progress: 'issue.status.in_progress',
  backlog: 'issue.status.backlog',
  ready_to_merge: 'issue.status.ready_to_merge',
  merging: 'issue.status.merging',
  done: 'issue.status.done',
  cancelled: 'issue.status.cancelled',
  duplicate: 'issue.status.duplicate',
};

const issueGroupTitleFallback: Record<IssueGroup['id'], string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  backlog: 'Backlog',
  ready_to_merge: 'Ready to Merge',
  merging: 'Merging',
  done: 'Done',
  cancelled: 'Canceled',
  duplicate: 'Duplicate',
};

const labelColorClass: Record<IssueLabel['color'], string> = {
  red: 'bg-[#ff5f59]',
  blue: 'bg-[#4aa3ff]',
  cyan: 'bg-[#92ecec]',
};

const issueGroupOrder: Array<IssueGroup['id']> = [
  'todo',
  'in_progress',
  'backlog',
  'ready_to_merge',
  'merging',
  'done',
  'cancelled',
  'duplicate',
];

const issueGroupHeaderBgClass: Record<IssueGroup['id'], string> = {
  backlog: 'bg-[var(--issue-section-backlog-bg)]',
  todo: 'bg-[var(--issue-section-todo-bg)]',
  in_progress: 'bg-[var(--issue-section-in-progress-bg)]',
  ready_to_merge: 'bg-[var(--issue-section-ready-to-merge-bg)]',
  merging: 'bg-[var(--issue-section-merging-bg)]',
  done: 'bg-[var(--issue-section-done-bg)]',
  cancelled: 'bg-[var(--issue-section-cancelled-bg)]',
  duplicate: 'bg-[var(--issue-section-duplicate-bg)]',
};

const issueRowStatusMenuValues: Array<{
  value: ProjectWorkItemStatus;
  shortcut: string;
  key: string;
  fallback: string;
}> = [
  {
    value: 'blocked',
    shortcut: '1',
    key: 'issue.status.backlog',
    fallback: 'Backlog',
  },
  {
    value: 'open',
    shortcut: '2',
    key: 'issue.status.todo',
    fallback: 'Todo',
  },
  {
    value: 'in_progress',
    shortcut: '3',
    key: 'issue.status.in_progress',
    fallback: 'In Progress',
  },
  {
    value: 'ready_to_merge',
    shortcut: '4',
    key: 'issue.status.ready_to_merge',
    fallback: 'Ready to Merge',
  },
  {
    value: 'merging',
    shortcut: '5',
    key: 'issue.status.merging',
    fallback: 'Merging',
  },
  {
    value: 'done',
    shortcut: '6',
    key: 'issue.status.done',
    fallback: 'Done',
  },
  {
    value: 'cancelled',
    shortcut: '7',
    key: 'issue.status.cancelled',
    fallback: 'Canceled',
  },
  {
    value: 'duplicate',
    shortcut: '8',
    key: 'issue.status.duplicate',
    fallback: 'Duplicate',
  },
];

const issueRowPriorityMenuValues: Array<{
  value: ProjectWorkItemPriority;
  shortcut: string;
  key: string;
  fallback: string;
}> = [
  {
    value: 'urgent',
    shortcut: '4',
    key: 'issue.priority.urgent',
    fallback: 'Urgent',
  },
  {
    value: 'high',
    shortcut: '3',
    key: 'issue.priority.high',
    fallback: 'High',
  },
  {
    value: 'medium',
    shortcut: '2',
    key: 'issue.priority.medium',
    fallback: 'Medium',
  },
  {
    value: 'low',
    shortcut: '1',
    key: 'issue.priority.low',
    fallback: 'Low',
  },
];

export const projectWorkItemToIssueItem = (
  item: ProjectWorkItem,
  projectName: string | null | undefined,
  sequence: number,
  override?: IssueRowOverride,
): IssueItem => ({
  id: projectWorkItemDisplayId(projectName, sequence),
  workItemId: item.id,
  title: item.title,
  status: projectWorkItemIssueStatus(effectiveWorkItem(item, override).status),
  labels: projectWorkItemLabels(
    effectiveWorkItem(item, override),
    override?.externalLabels,
  ),
  date: formatSimpleDate(item.updated_at),
  workItem: effectiveWorkItem(item, override),
});

export const projectWorkItemsToIssueGroups = (
  items: ProjectWorkItem[],
  filter: IssueFilter,
  projectName?: string | null,
  overrides: IssueRowOverrides = {},
): IssueGroup[] => {
  const allowedGroups = new Set<IssueGroup['id']>(
    filter === 'backlog'
      ? ['backlog']
      : filter === 'active'
        ? ['todo', 'in_progress', 'backlog', 'ready_to_merge', 'merging']
        : issueGroupOrder,
  );
  let sequence = 0;

  return issueGroupOrder
    .map((groupId) => {
      const groupItems = items
        .filter(
          (item) =>
            projectWorkItemIssueStatus(
              effectiveWorkItem(item, overrides[item.id]).status,
            ) === groupId,
        )
        .map((item) =>
          projectWorkItemToIssueItem(
            item,
            projectName,
            ++sequence,
            overrides[item.id],
          ),
        );
      return {
        id: groupId,
        title: issueGroupTitleFallback[groupId],
        count: groupItems.length,
        items: groupItems,
      };
    })
    .filter((group) => allowedGroups.has(group.id) && group.items.length > 0);
};

export const projectWorkItemIssueStatus = (
  status: ProjectWorkItemStatus,
): IssueItem['status'] => {
  if (status === 'open') return 'todo';
  if (status === 'done') return 'done';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'blocked') return 'backlog';
  return status;
};

const issueGroupInitialWorkItemStatus = (
  groupId: IssueStatusGroupId,
): ProjectWorkItemStatus => {
  if (groupId === 'todo') return 'open';
  if (groupId === 'backlog') return 'blocked';
  return groupId;
};

const buildIssueRowStatusOptions = (
  tr: IssueTranslator,
): Array<IssueRowMenuOption<ProjectWorkItemStatus>> =>
  issueRowStatusMenuValues.map((entry) => ({
    value: entry.value,
    label: tr(entry.key, entry.fallback),
    shortcut: entry.shortcut,
  }));

const buildIssueRowPriorityOptions = (
  tr: IssueTranslator,
): Array<IssueRowMenuOption<ProjectWorkItemPriority>> =>
  issueRowPriorityMenuValues.map((entry) => ({
    value: entry.value,
    label: tr(entry.key, entry.fallback),
    shortcut: entry.shortcut,
  }));

const issueRowStatusLabel = (
  status: ProjectWorkItemStatus,
  tr: IssueTranslator,
) => {
  const entry = issueRowStatusMenuValues.find(
    (candidate) => candidate.value === status,
  );
  return entry ? tr(entry.key, entry.fallback) : titleCaseToken(status);
};

const issueRowPriorityLabel = (
  priority: ProjectWorkItemPriority,
  tr: IssueTranslator,
) => {
  const entry = issueRowPriorityMenuValues.find(
    (candidate) => candidate.value === priority,
  );
  return entry ? tr(entry.key, entry.fallback) : titleCaseToken(priority);
};

const filterIssueRowMenuOptions = <TValue extends string>(
  options: Array<IssueRowMenuOption<TValue>>,
  query: string,
) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(normalized) ||
      option.value.toLowerCase().includes(normalized),
  );
};

export const projectIssueIdPrefix = (projectName?: string | null) => {
  const normalized = Array.from((projectName ?? '').trim().replace(/\s+/g, ''))
    .slice(0, 3)
    .join('')
    .toUpperCase();
  return normalized || 'PRO';
};

export const projectWorkItemDisplayId = (
  projectName: string | null | undefined,
  sequence: number,
) => `${projectIssueIdPrefix(projectName)}-${Math.max(1, sequence)}`;

const ISSUE_ID_BASE_FONT_SIZE_PX = 16;
const ISSUE_ID_MIN_FONT_SIZE_PX = 1;
const ISSUE_ID_AVERAGE_CHAR_WIDTH_EM = 0.6;

export const issueDisplayIdFontSizePx = (
  displayId: string,
  maxWidthPx = 70,
) => {
  const length = Math.max(displayId.length, 1);
  const fitSize = Math.floor(
    maxWidthPx / (length * ISSUE_ID_AVERAGE_CHAR_WIDTH_EM),
  );
  return Math.min(
    ISSUE_ID_BASE_FONT_SIZE_PX,
    Math.max(ISSUE_ID_MIN_FONT_SIZE_PX, fitSize),
  );
};

type IssueSourceProviderId = RemoteProviderId | 'local';

export const issueSourceProviderId = (
  source: ProjectWorkItem['source'] | string,
): IssueSourceProviderId => {
  switch (source) {
    case 'github':
    case 'github_issue':
      return 'github';
    case 'linear':
    case 'linear_issue':
      return 'linear';
    case 'jira':
    case 'jira_issue':
      return 'jira';
    default:
      return 'local';
  }
};

const projectWorkItemLabels = (
  item: ProjectWorkItem,
  externalLabels: IssueLabel[] = [],
): IssueLabel[] => {
  return dedupeIssueLabels([
    ...githubLabelsToIssueLabels(projectWorkItemLabelList(item.labels_json)),
    ...externalLabels,
  ]);
};

const effectiveWorkItem = (
  item: ProjectWorkItem,
  override?: IssueRowOverride,
): ProjectWorkItem =>
  override
    ? {
        ...item,
        status: override.status ?? item.status,
        priority: override.priority ?? item.priority,
      }
    : item;

const dedupeIssueLabels = (labels: IssueLabel[]) => {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = label.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const githubLabelsToIssueLabels = (labels: string[]): IssueLabel[] =>
  labels.map((label) => ({
    name: label,
    color: githubIssueLabelColor(label),
  }));

const githubIssueLabelColor = (label: string): IssueLabel['color'] => {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'bug' || normalized === 'urgent') return 'red';
  if (normalized === 'enhancement' || normalized === 'feature') return 'blue';
  return 'cyan';
};

export const collectProjectIssueLabels = (
  items: ProjectWorkItem[],
  overrides: IssueRowOverrides = {},
) => {
  const seen = new Set<string>();
  const labels: string[] = [];

  items.forEach((item) => {
    projectWorkItemLabels(item, overrides[item.id]?.externalLabels).forEach(
      (label) => {
        const key = label.name.trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        labels.push(label.name);
      },
    );
  });

  return labels;
};

const titleCaseToken = (value: string) =>
  value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const mergeWorkItem = (
  item: ProjectWorkItem,
  setItems: Dispatch<SetStateAction<ProjectWorkItem[]>>,
) => {
  setItems((current) => {
    const existingIndex = current.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex === -1) return [item, ...current];
    return current.map((candidate) =>
      candidate.id === item.id ? item : candidate,
    );
  });
};

const mergeIssueRowOverride = (
  snapshot: IssueDetailSyncSnapshot,
  setOverrides: Dispatch<SetStateAction<IssueRowOverrides>>,
) => {
  setOverrides((current) => {
    const existing = current[snapshot.workItem.id];
    const nextOverride = issueRowOverrideFromSnapshot(snapshot, existing);
    if (issueRowOverrideEqual(existing, nextOverride)) return current;
    return { ...current, [snapshot.workItem.id]: nextOverride };
  });
};

const issueRowOverrideFromSnapshot = (
  snapshot: IssueDetailSyncSnapshot,
  existing?: IssueRowOverride,
): IssueRowOverride => ({
  status: snapshot.workItem.status,
  priority: snapshot.workItem.priority,
  externalLabels:
    snapshot.labels === undefined
      ? (existing?.externalLabels ?? [])
      : githubLabelsToIssueLabels(snapshot.labels),
});

const issueRowOverrideEqual = (
  left: IssueRowOverride | undefined,
  right: IssueRowOverride,
) => {
  if (!left) return false;
  if (left.status !== right.status || left.priority !== right.priority) {
    return false;
  }
  const leftLabels = left.externalLabels ?? [];
  const rightLabels = right.externalLabels ?? [];
  return (
    leftLabels.length === rightLabels.length &&
    leftLabels.every(
      (label, index) =>
        label.name === rightLabels[index]?.name &&
        label.color === rightLabels[index]?.color,
    )
  );
};

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

const remoteProviders: RemoteProvider[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Connect issues and repository context from GitHub.',
    supported: true,
    Icon: GitHubProviderIcon,
    iconClassName: 'text-[#f4f4f5]',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Linear workspace and team issue sync.',
    supported: false,
    Icon: LinearProviderIcon,
    iconClassName: 'text-[#5e6ad2]',
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Jira project and issue sync.',
    supported: false,
    Icon: JiraProviderIcon,
    iconClassName: 'text-[#2684ff]',
  },
];

const cn = (...classes: Array<string | false | undefined>) =>
  classes.filter(Boolean).join(' ');

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

export function IssuePage() {
  const { selectedProjectId, projects, projectsAsync, t } = useWorkspace();
  const tr = useCallback<IssueTranslator>(
    (key, fallback, replacements) => {
      const translated = t(key, replacements);
      return translated && translated !== key
        ? translated
        : formatFallback(fallback, replacements);
    },
    [t],
  );
  const [activeFilter, setActiveFilter] = useState<IssueFilter>('active');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<IssueGroup['id']>>(
    () => new Set(),
  );
  const [workItems, setWorkItems] = useState<ProjectWorkItem[]>([]);
  const [issueRowOverrides, setIssueRowOverrides] =
    useState<IssueRowOverrides>({});
  const [workItemsProjectId, setWorkItemsProjectId] = useState<string | null>(
    null,
  );
  const [workItemsLoading, setWorkItemsLoading] = useState(false);
  const [workItemsError, setWorkItemsError] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [activeIssue, setActiveIssue] = useState<IssueItem | null>(null);
  const [pendingIssueTarget, setPendingIssueTarget] =
    useState<IssueNavigationTarget | null>(() => readIssueNavigationTarget());
  const [interactionMessage, setInteractionMessage] = useState('');
  const [repoNotice, setRepoNotice] = useState<IssueNotification | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createIssueInitialStatus, setCreateIssueInitialStatus] =
    useState<ProjectWorkItemStatus>('open');
  const [createIssueSubmitting, setCreateIssueSubmitting] = useState(false);
  const [projectSessions, setProjectSessions] = useState<BackendChatSession[]>(
    [],
  );
  const [projectSessionsLoading, setProjectSessionsLoading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importIssues, setImportIssues] = useState<GitHubIssueSummary[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');
  const [importAction, setImportAction] = useState<string | null>(null);
  const [importQuery, setImportQuery] = useState('');
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [integrationState, setIntegrationState] =
    useState<ProjectIssueIntegrationsResponse | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [integrationAction, setIntegrationAction] = useState<string | null>(
    null,
  );
  const [linkingRepoName, setLinkingRepoName] = useState<string | null>(null);
  const [oauthFlow, setOauthFlow] =
    useState<GitHubOAuthStartResponse | null>(null);
  const [authFlow, setAuthFlow] =
    useState<GitHubDeviceFlowStartResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const oauthFallbackStartedRef = useRef(false);
  const workItemsRequestIdRef = useRef(0);
  const issueListRef = useRef<HTMLDivElement>(null);
  const issueDetailRef = useRef<HTMLDivElement>(null);
  const issueRowRefs = useRef(new Map<string, HTMLElement>());
  const originIssueRowIdRef = useRef<string | null>(null);
  const selectedProjectName = useMemo(
    () =>
      projects.find((project) => project.id === selectedProjectId)?.name ??
      'Project',
    [projects, selectedProjectId],
  );
  const visibleGroups = useMemo(
    () =>
      projectWorkItemsToIssueGroups(
        workItems,
        activeFilter,
        selectedProjectName,
        issueRowOverrides,
      ),
    [activeFilter, issueRowOverrides, selectedProjectName, workItems],
  );
  const projectIssueLabels = useMemo(
    () => collectProjectIssueLabels(workItems, issueRowOverrides),
    [issueRowOverrides, workItems],
  );
  const issueRowStatusOptions = useMemo(
    () => buildIssueRowStatusOptions(tr),
    [tr],
  );
  const issueRowPriorityOptions = useMemo(
    () => buildIssueRowPriorityOptions(tr),
    [tr],
  );
  const visibleIssueCount = visibleGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const visibleIssues = useMemo(
    () =>
      visibleGroups.flatMap((group) =>
        collapsedGroups.has(group.id) ? [] : group.items,
      ),
    [collapsedGroups, visibleGroups],
  );
  const linkedRepo = integrationState?.primary_repository ?? null;
  const linkedRepoId = linkedRepo?.id ?? '';
  const linkedProviderId: RemoteProviderId | null =
    linkedRepo?.provider === 'github' ? 'github' : null;
  const linkedRepoName = linkedRepo ? repoIntegrationLabel(linkedRepo) : undefined;
  const linkedRepoOptionId = linkedRepo
    ? resolveLinkedGitHubRepoOptionId(
        integrationState?.github_repositories ?? [],
        linkedRepo,
      )
    : '';
  const projectSelectionPending = projectsAsync.loading && !selectedProjectId;
  const workItemsReady = selectedProjectId
    ? workItemsProjectId === selectedProjectId
    : !projectSelectionPending;
  const suppressIssuePlaceholder =
    !workItemsReady || (workItemsLoading && workItems.length === 0);

  const loadWorkItems = useCallback(async () => {
    const requestId = ++workItemsRequestIdRef.current;
    if (!selectedProjectId) {
      setWorkItems([]);
      setWorkItemsError('');
      setWorkItemsProjectId(null);
      setWorkItemsLoading(false);
      return;
    }
    const projectId = selectedProjectId;
    setWorkItemsLoading(true);
    setWorkItemsError('');
    try {
      const result = await projectWorkItemsApi.list(projectId);
      if (workItemsRequestIdRef.current !== requestId) return;
      setWorkItems(result);
      setWorkItemsProjectId(projectId);
    } catch (error) {
      if (workItemsRequestIdRef.current !== requestId) return;
      setWorkItems([]);
      setWorkItemsError(errorMessage(error));
      setWorkItemsProjectId(projectId);
    } finally {
      if (workItemsRequestIdRef.current === requestId) {
        setWorkItemsLoading(false);
      }
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadWorkItems();
  }, [loadWorkItems]);

  useEffect(() => {
    setIssueRowOverrides({});
  }, [selectedProjectId]);

  useEffect(() => {
    const applyPendingTarget = () => {
      const target = readIssueNavigationTarget();
      if (target) setPendingIssueTarget(target);
    };

    applyPendingTarget();
    window.addEventListener(
      ISSUE_NAVIGATION_TARGET_CHANGED_EVENT,
      applyPendingTarget,
    );
    return () => {
      window.removeEventListener(
        ISSUE_NAVIGATION_TARGET_CHANGED_EVENT,
        applyPendingTarget,
      );
    };
  }, []);

  useEffect(() => {
    if (selectedProjectId && workItemsProjectId !== selectedProjectId) {
      setSelectedIssueId('');
      setActiveIssue(null);
      return;
    }
    const allIssues = projectWorkItemsToIssueGroups(
      workItems,
      'all',
      selectedProjectName,
      issueRowOverrides,
    ).flatMap((group) => group.items);
    const pendingTargetWorkItemId =
      pendingIssueTarget && 'workItemId' in pendingIssueTarget
        ? pendingIssueTarget.workItemId
        : null;
    const pendingTargetIssue =
      pendingTargetWorkItemId &&
      (!pendingIssueTarget?.projectId ||
        pendingIssueTarget.projectId === selectedProjectId)
        ? allIssues.find(
            (issue) => issue.workItemId === pendingTargetWorkItemId,
          )
        : null;
    if (pendingTargetIssue) {
      setSelectedIssueId(pendingTargetIssue.id);
      setActiveIssue(pendingTargetIssue);
      setPendingIssueTarget(null);
      clearIssueNavigationTarget();
      return;
    }
    if (
      pendingTargetWorkItemId &&
      (!pendingIssueTarget?.projectId ||
        pendingIssueTarget.projectId === selectedProjectId) &&
      !workItemsLoading
    ) {
      setPendingIssueTarget(null);
      clearIssueNavigationTarget();
    }
    setSelectedIssueId((current) =>
      current && allIssues.some((issue) => issue.id === current)
        ? current
        : allIssues[0]?.id ?? '',
    );
    setActiveIssue((current) =>
      current
        ? allIssues.find((issue) => issue.workItemId === current.workItemId) ??
          null
        : current,
    );
  }, [
    issueRowOverrides,
    pendingIssueTarget,
    selectedProjectId,
    selectedProjectName,
    workItems,
    workItemsLoading,
    workItemsProjectId,
  ]);

  useEffect(() => {
    if (!repoNotice) return;

    const timer = window.setTimeout(() => {
      setRepoNotice(null);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [repoNotice]);

  const loadIssueIntegrations = useCallback(async () => {
    if (!selectedProjectId) {
      setIntegrationState(null);
      setIntegrationError('');
      return;
    }
    setIntegrationLoading(true);
    setIntegrationError('');
    try {
      const result =
        await projectGithubApi.getIssueIntegrations(selectedProjectId);
      setIntegrationState(result);
    } catch (error) {
      setIntegrationError(errorMessage(error));
    } finally {
      setIntegrationLoading(false);
    }
  }, [selectedProjectId]);

  const startDeviceAuthorization = useCallback(async (message: string) => {
    const flow = await githubAuthApi.startDeviceFlow();
    setAuthFlow(flow);
    setAuthStatus('pending');
    openGitHubDeviceFlow(flow);
    setInteractionMessage(message);
  }, []);

  const startOAuthDeviceFallback = useCallback(
    async (reason: string, flowId?: string) => {
      if (oauthFallbackStartedRef.current) return;
      oauthFallbackStartedRef.current = true;
      setOauthFlow(null);
      if (flowId) {
        await githubAuthApi.cancelOAuthFlow(flowId).catch(() => undefined);
      }
      setIntegrationError(
        tr(
          'issue.linkDialog.error.oauthFallback',
          '{reason}. Starting device authorization fallback.',
          { reason },
        ),
      );
      try {
        await startDeviceAuthorization(
          tr(
            'issue.linkDialog.notice.deviceFallbackStarted',
            'GitHub device authorization fallback started',
          ),
        );
      } catch (fallbackError) {
        setIntegrationError(
          tr(
            'issue.linkDialog.error.deviceFallbackFailed',
            '{reason}. Device fallback failed: {error}',
            { reason, error: errorMessage(fallbackError) },
          ),
        );
      }
    },
    [startDeviceAuthorization, tr],
  );

  useEffect(() => {
    void loadIssueIntegrations();
  }, [loadIssueIntegrations]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProjectId) {
      setProjectSessions([]);
      setProjectSessionsLoading(false);
      return;
    }

    setProjectSessionsLoading(true);
    void projectApi
      .listSessions(selectedProjectId)
      .then((sessions) => {
        if (!cancelled) setProjectSessions(sessions);
      })
      .catch((error) => {
        if (!cancelled) {
          setProjectSessions([]);
          setInteractionMessage(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setProjectSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    if (!oauthFlow) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (delayMs: number) => {
      timer = window.setTimeout(
        () => void poll(),
        githubOAuthPollDelay(delayMs),
      );
    };
    const poll = async () => {
      try {
        const result = await githubAuthApi.getOAuthStatus(oauthFlow.flow_id);
        if (cancelled) return;
        setAuthStatus(result.status);
        if (result.account) {
          setOauthFlow(null);
          setAuthFlow(null);
          setIntegrationError('');
          setInteractionMessage(
            tr(
              'issue.linkDialog.notice.authorizedAs',
              'GitHub authorized as {login}',
              { login: result.account.login },
            ),
          );
          await loadIssueIntegrations();
          return;
        }
        if (result.status === 'error') {
          const reason =
            result.error ??
            tr(
              'issue.linkDialog.error.oauthFailed',
              'GitHub OAuth authorization failed',
            );
          if (shouldAutoFallbackToDevice(result)) {
            await startOAuthDeviceFallback(reason, oauthFlow.flow_id);
          } else {
            setOauthFlow(null);
            setIntegrationError(
              reason,
            );
          }
          return;
        }
        if (result.status === 'denied' || result.status === 'expired') {
          setOauthFlow(null);
          setIntegrationError(
            tr(
              'issue.linkDialog.error.authorizationStatus',
              'GitHub authorization {status}.',
              { status: result.status },
            ),
          );
          return;
        }
        schedule(result.retry_after_ms ?? oauthFlow.poll_after_ms);
      } catch (error) {
        if (!cancelled) {
          await startOAuthDeviceFallback(
            errorMessage(error),
            oauthFlow.flow_id,
          );
        }
      }
    };
    schedule(oauthFlow.poll_after_ms);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadIssueIntegrations, oauthFlow, startOAuthDeviceFallback, tr]);

  useEffect(() => {
    if (!authFlow) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await githubAuthApi.pollDeviceFlow(authFlow.device_code);
        if (cancelled) return;
        setAuthStatus(result.status);
        if (result.account) {
          setAuthFlow(null);
          setIntegrationError('');
          setInteractionMessage(
            tr(
              'issue.linkDialog.notice.authorizedAs',
              'GitHub authorized as {login}',
              { login: result.account.login },
            ),
          );
          await loadIssueIntegrations();
          return;
        }
        if (
          result.status === 'denied' ||
          result.status === 'expired' ||
          result.status === 'error'
        ) {
          setAuthFlow(null);
          setIntegrationError(
            typeof result.error === 'string'
              ? result.error
              : result.error?.message ??
                  tr(
                    'issue.linkDialog.error.authorizationStatusBare',
                    'GitHub authorization {status}',
                    { status: result.status },
                  ),
          );
        }
      } catch (error) {
        if (!cancelled) {
          setAuthFlow(null);
          setIntegrationError(errorMessage(error));
        }
      }
    };
    void poll();
    const timer = window.setInterval(
      () => void poll(),
      Math.max(1000, Number(authFlow.interval || 1) * 1000),
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authFlow, loadIssueIntegrations, tr]);

  const handleFilterChange = (filter: IssueFilter) => {
    setActiveFilter(filter);
    setInteractionMessage(
      tr('issue.action.showingFilter', 'Showing {filter} issues', { filter }),
    );
  };

  const handleGroupToggle = (groupId: IssueGroup['id']) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      const label = tr(issueGroupStatusKey[groupId], issueGroupTitleFallback[groupId]);
      if (next.has(groupId)) {
        next.delete(groupId);
        setInteractionMessage(tr('issue.action.expanded', 'Expanded {group}', { group: label }));
      } else {
        next.add(groupId);
        setInteractionMessage(tr('issue.action.collapsed', 'Collapsed {group}', { group: label }));
      }
      return next;
    });
  };

  const handleIssueSelect = (issue: IssueItem) => {
    originIssueRowIdRef.current = issue.id;
    setSelectedIssueId(issue.id);
    setActiveIssue(issue);
    setInteractionMessage(tr('issue.action.opened', 'Opened {id}', { id: issue.id }));
  };

  const focusIssueRow = (issueId: string) => {
    const row = issueRowRefs.current.get(issueId);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const focusSelectedOrFirstIssueRow = useCallback(() => {
    const nextIssue =
      visibleIssues.find((issue) => issue.id === selectedIssueId) ??
      visibleIssues[0];
    if (!nextIssue) return;
    setSelectedIssueId(nextIssue.id);
    focusIssueRow(nextIssue.id);
  }, [selectedIssueId, visibleIssues]);

  const handleIssueBack = () => {
    setActiveIssue(null);
    setInteractionMessage(tr('issue.action.returnedToIssues', 'Returned to issues'));
    window.requestAnimationFrame(() => {
      const originId = originIssueRowIdRef.current;
      if (originId && issueRowRefs.current.has(originId)) focusIssueRow(originId);
      else focusSelectedOrFirstIssueRow();
    });
  };

  const moveIssueSelection = (offset: -1 | 1) => {
    if (visibleIssues.length === 0) return;
    const currentIndex = Math.max(
      0,
      visibleIssues.findIndex((issue) => issue.id === selectedIssueId),
    );
    const nextIssue =
      visibleIssues[
        (currentIndex + offset + visibleIssues.length) % visibleIssues.length
      ];
    setSelectedIssueId(nextIssue.id);
    focusIssueRow(nextIssue.id);
  };

  const openSelectedIssue = () => {
    const issue =
      visibleIssues.find((candidate) => candidate.id === selectedIssueId) ??
      visibleIssues[0];
    if (issue) handleIssueSelect(issue);
  };

  useShortcutScope('issue-list', {
    active: activeIssue === null,
    rootRef: issueListRef,
  });
  useShortcutScope('issue-detail', {
    active: activeIssue !== null,
    rootRef: issueDetailRef,
  });
  useCommandHandler('issue.selection.next', {
    scope: 'focused-component',
    enabled: activeIssue === null && visibleIssues.length > 1,
    execute: () => moveIssueSelection(1),
  });
  useCommandHandler('issue.selection.previous', {
    scope: 'focused-component',
    enabled: activeIssue === null && visibleIssues.length > 1,
    execute: () => moveIssueSelection(-1),
  });
  useCommandHandler('issue.selection.open', {
    scope: 'focused-component',
    enabled: activeIssue === null && visibleIssues.length > 0,
    execute: openSelectedIssue,
  });

  const handleAction = (message: string) => {
    setInteractionMessage(message);
  };

  const handleIssueRowStatusChange = useCallback(
    async (issue: IssueItem, status: ProjectWorkItemStatus) => {
      if (status === issue.workItem.status) return;
      if (!selectedProjectId) {
        setInteractionMessage(
          tr(
            'issue.error.selectProject',
            'Select a project before creating an issue.',
          ),
        );
        return;
      }

      try {
        const updated = await projectWorkItemsApi.update(
          selectedProjectId,
          issue.workItemId,
          { status },
        );
        mergeWorkItem(updated, setWorkItems);
        mergeIssueRowOverride({ workItem: updated }, setIssueRowOverrides);
        notifyBuildStatsUsageUpdated(selectedProjectId);
        setInteractionMessage(
          tr(
            'issue.detail.action.statusUpdated',
            'Issue status updated to {status}',
            { status: issueRowStatusLabel(status, tr) },
          ),
        );
      } catch (error) {
        setInteractionMessage(errorMessage(error));
      }
    },
    [selectedProjectId, tr],
  );

  const handleIssueRowPriorityChange = useCallback(
    async (issue: IssueItem, priority: ProjectWorkItemPriority) => {
      if (priority === issue.workItem.priority) return;
      if (!selectedProjectId) {
        setInteractionMessage(
          tr(
            'issue.error.selectProject',
            'Select a project before creating an issue.',
          ),
        );
        return;
      }

      try {
        const updated = await projectWorkItemsApi.update(
          selectedProjectId,
          issue.workItemId,
          { priority },
        );
        mergeWorkItem(updated, setWorkItems);
        mergeIssueRowOverride({ workItem: updated }, setIssueRowOverrides);
        setInteractionMessage(
          tr(
            'issue.detail.action.priorityUpdated',
            'Priority updated to {priority}',
            { priority: issueRowPriorityLabel(priority, tr) },
          ),
        );
      } catch (error) {
        setInteractionMessage(errorMessage(error));
      }
    },
    [selectedProjectId, tr],
  );

  const handleIssueDetailSync = useCallback(
    (snapshot: IssueDetailSyncSnapshot) => {
      mergeWorkItem(snapshot.workItem, setWorkItems);
      mergeIssueRowOverride(snapshot, setIssueRowOverrides);
    },
    [],
  );

  const handleIssueDeleted = useCallback(
    (workItemId: string) => {
      setWorkItems((current) =>
        current.filter((item) => item.id !== workItemId),
      );
      setIssueRowOverrides((current) => {
        const next = { ...current };
        delete next[workItemId];
        return next;
      });
      setSelectedIssueId('');
      setActiveIssue(null);
      setInteractionMessage(
        tr('issue.action.issueDeleted', 'Issue deleted'),
      );
    },
    [tr],
  );

  const openCreateIssueDialog = useCallback(
    (initialStatus: ProjectWorkItemStatus = 'open') => {
      setCreateIssueInitialStatus(initialStatus);
      setCreateDialogOpen(true);
    },
    [],
  );

  useEffect(() => {
    if (!pendingIssueTarget || !workItemsReady) return;
    if (
      pendingIssueTarget.projectId &&
      pendingIssueTarget.projectId !== selectedProjectId
    ) {
      return;
    }
    if (pendingIssueTarget.kind === 'create') {
      clearIssueNavigationTarget();
      setPendingIssueTarget(null);
      openCreateIssueDialog('open');
      return;
    }
    if (pendingIssueTarget.kind === 'list') {
      clearIssueNavigationTarget();
      setPendingIssueTarget(null);
      setActiveIssue(null);
      window.requestAnimationFrame(() => focusSelectedOrFirstIssueRow());
    }
  }, [
    focusSelectedOrFirstIssueRow,
    openCreateIssueDialog,
    pendingIssueTarget,
    selectedProjectId,
    workItemsReady,
  ]);

  const handleCreateIssue = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      labels,
      sessionId,
    }: IssueCreateDialogSubmitValue) => {
      if (!selectedProjectId) {
        const message = tr(
          'issue.error.selectProject',
          'Select a project before creating an issue.',
        );
        setInteractionMessage(message);
        throw new Error(message);
      }

      setCreateIssueSubmitting(true);
      try {
        const created = await projectWorkItemsApi.create(selectedProjectId, {
          title,
          description: description || null,
          labels_json: labels.length > 0 ? JSON.stringify(labels) : null,
          status,
          priority,
          type: 'task',
          source: 'manual',
        });
        notifyBuildStatsUsageUpdated(selectedProjectId);
        let sessionLinkError = '';
        if (sessionId) {
          try {
            await projectWorkItemsApi.linkExecution(selectedProjectId, created.id, {
              session_id: sessionId,
              workflow_execution_id: null,
              workflow_step_id: null,
              run_id: null,
              link_type: 'discussed_in',
            });
          } catch (error) {
            sessionLinkError = errorMessage(error);
          }
        }
        const createdIssue = projectWorkItemToIssueItem(
          created,
          selectedProjectName,
          1,
        );
        mergeWorkItem(created, setWorkItems);
        setActiveFilter('active');
        setSelectedIssueId(createdIssue.id);
        setActiveIssue(createdIssue);
        setInteractionMessage(
          sessionLinkError
            ? tr(
                'issue.action.issueCreatedSessionLinkFailed',
                'Issue created, but session link failed: {error}',
                { error: sessionLinkError },
              )
            : tr('issue.action.issueCreated', 'Issue created: {title}', {
                title,
              }),
        );
      } catch (error) {
        setInteractionMessage(errorMessage(error));
        throw error;
      } finally {
        setCreateIssueSubmitting(false);
      }
    },
    [selectedProjectId, selectedProjectName, tr],
  );

  const loadImportIssues = useCallback(async () => {
    if (!selectedProjectId || !linkedRepoId) {
      setImportIssues([]);
      setImportError(
        tr(
          'issue.importDialog.error.noLinkedRepo',
          'Link a GitHub repository before importing issues.',
        ),
      );
      return;
    }
    setImportLoading(true);
    setImportError('');
    try {
      const result = await projectGithubApi.listIssues(selectedProjectId, {
        repoIntegrationId: linkedRepoId,
        query: importQuery.trim() || undefined,
      });
      setImportIssues(result);
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImportLoading(false);
    }
  }, [importQuery, linkedRepoId, selectedProjectId, tr]);

  const handleOpenImportDialog = () => {
    if (!linkedRepoId) {
      setImportDialogOpen(false);
      setInteractionMessage(
        tr(
          'issue.importDialog.notice.linkRepoFirst',
          'Link a GitHub repository before importing issues.',
        ),
      );
      handleOpenIntegrations();
      return;
    }
    setImportDialogOpen(true);
    setInteractionMessage(
      tr('issue.importDialog.notice.opened', 'GitHub issue import opened'),
    );
    void loadImportIssues();
  };

  const handleImportIssue = async (issue: GitHubIssueSummary) => {
    if (!selectedProjectId || !linkedRepoId) return;
    setImportAction(String(issue.number));
    setImportError('');
    try {
      const detail = await projectGithubApi.importIssue(selectedProjectId, {
        repo_integration_id: linkedRepoId,
        number: issue.number,
      });
      mergeWorkItem(detail.work_item, setWorkItems);
      mergeIssueRowOverride(
        {
          workItem: detail.work_item,
          labels: detail.github_issue_detail?.summary.labels ?? [],
        },
        setIssueRowOverrides,
      );
      setImportIssues((current) =>
        current.map((item) =>
          item.number === issue.number
            ? { ...item, work_item_id: detail.work_item.id }
            : item,
        ),
      );
      const importedIssue = projectWorkItemToIssueItem(
        detail.work_item,
        selectedProjectName,
        1,
        issueRowOverrideFromSnapshot({
          workItem: detail.work_item,
          labels: detail.github_issue_detail?.summary.labels ?? [],
        }),
      );
      setSelectedIssueId(importedIssue.id);
      setActiveIssue(importedIssue);
      setRepoNotice({
        id: Date.now(),
        title: tr('issue.importDialog.toast.imported.title', 'Issue imported'),
        message: tr(
          'issue.importDialog.toast.imported.message',
          'Imported #{number} as a project work item.',
          { number: issue.number },
        ),
        tone: 'success',
      });
    } catch (error) {
      setImportError(errorMessage(error));
    } finally {
      setImportAction(null);
    }
  };

  const handleOpenIntegrations = () => {
    setIntegrationDialogOpen(true);
    setInteractionMessage(
      tr(
        'issue.linkDialog.notice.opened',
        'External project tool connections opened',
      ),
    );
    void loadIssueIntegrations();
  };

  const startGitHubOAuthAuthorization = useCallback(
    async (message: string, authWindow?: Window | null) => {
      oauthFallbackStartedRef.current = false;
      setOauthFlow(null);
      setAuthFlow(null);
      try {
        const flow = await githubAuthApi.startOAuthFlow();
        if (!openGitHubOAuthFlow(flow, authWindow)) {
          authWindow?.close();
          await startOAuthDeviceFallback('GitHub authorization popup was blocked', flow.flow_id);
          return;
        }
        setOauthFlow(flow);
        setAuthStatus('pending');
        setInteractionMessage(message);
      } catch (error) {
        authWindow?.close();
        await startOAuthDeviceFallback(errorMessage(error));
      }
    },
    [startOAuthDeviceFallback],
  );

  const handleAuthorizeGitHub = async () => {
    const authWindow = openBlankAuthWindow();
    setIntegrationAction('authorize-github');
    setIntegrationError('');
    try {
      await startGitHubOAuthAuthorization(
        tr(
          'issue.linkDialog.notice.authorizationOpened',
          'GitHub authorization opened',
        ),
        authWindow,
      );
    } finally {
      setIntegrationAction(null);
    }
  };

  const handleSwitchGitHubAccount = async () => {
    const repoToUnlink = linkedRepo;
    const projectIdForUnlink = repoToUnlink ? selectedProjectId : null;
    if (repoToUnlink && !projectIdForUnlink) {
      setIntegrationError(
        tr(
          'issue.linkDialog.error.projectRequiredForSwitch',
          'Select a project before switching GitHub accounts.',
        ),
      );
      return;
    }
    const authWindow = openBlankAuthWindow();

    setIntegrationAction('switch-github-account');
    setIntegrationError('');
    try {
      if (repoToUnlink && projectIdForUnlink) {
        await projectGithubApi.disconnectRepo(projectIdForUnlink, repoToUnlink.id);
      }
      await githubAuthApi.disconnect();
      setIntegrationState((current) => {
        if (!current) return current;
        return {
          ...current,
          github_account: null,
          github_repositories: [],
          linked_repositories: repoToUnlink
            ? current.linked_repositories.map((repo) =>
                repo.id === repoToUnlink.id
                  ? {
                      ...repo,
                      sync_status: 'disconnected',
                      last_error: 'Disconnected during GitHub account switch',
                    }
                  : repo,
              )
            : current.linked_repositories,
          primary_repository: null,
          providers: current.providers.map((provider) =>
            provider.id === 'github'
              ? { ...provider, status: 'auth_required' }
              : provider,
          ),
        };
      });
      setInteractionMessage(
        repoToUnlink
          ? tr(
              'issue.linkDialog.notice.unlinkedAndAuthOpened',
              'Unlinked GitHub repository {repoName} and opened authorization',
              { repoName: repoIntegrationLabel(repoToUnlink) },
            )
          : tr(
              'issue.linkDialog.notice.authorizationOpened',
              'GitHub authorization opened',
            ),
      );
      await startGitHubOAuthAuthorization(
        tr(
          'issue.linkDialog.notice.switchAuthOpened',
          'GitHub authorization opened for account switch',
        ),
        authWindow,
      );
    } catch (error) {
      authWindow?.close();
      setIntegrationError(errorMessage(error));
    } finally {
      setIntegrationAction(null);
    }
  };

  const handleRepositoryLink = async (repoOptionId: string) => {
    if (!selectedProjectId || !integrationState?.github_account) {
      setIntegrationError(
        tr(
          'issue.linkDialog.error.authorizeBeforeRepo',
          'Authorize GitHub before selecting a repository.',
        ),
      );
      return;
    }
    const repo = integrationState.github_repositories.find(
      (candidate) => candidate.node_id === repoOptionId,
    );
    if (!repo) return;
    setIntegrationAction('link-repo');
    setLinkingRepoName(repo.full_name);
    setIntegrationError('');
    try {
      await projectGithubApi.createRepo(selectedProjectId, {
        owner: repo.owner,
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        default_branch: repo.default_branch,
        external_id: repo.node_id,
        github_account_id: String(integrationState.github_account.id),
        role: 'primary',
        repo_grant_json: {
          permissions: ['metadata', 'contents', 'issues', 'pull_requests'],
        },
      });
      await loadIssueIntegrations();
      setInteractionMessage(
        tr(
          'issue.linkDialog.notice.linkedRepo',
          'Linked GitHub repository {repoName}',
          { repoName: repo.full_name },
        ),
      );
      setRepoNotice({
        id: Date.now(),
        title: tr('issue.linkDialog.toast.repoLinked.title', 'Repository linked'),
        message: tr(
          'issue.linkDialog.toast.repoLinked.message',
          'GitHub repository {repoName} is connected.',
          { repoName: repo.full_name },
        ),
        tone: 'success',
      });
    } catch (error) {
      setIntegrationError(errorMessage(error));
    } finally {
      setLinkingRepoName(null);
      setIntegrationAction(null);
    }
  };

  const handleRepositoryUnlink = async () => {
    if (!selectedProjectId || !linkedRepo) {
      setIntegrationError(
        tr(
          'issue.linkDialog.error.noLinkedRepo',
          'No linked repository to unlink.',
        ),
      );
      return;
    }
    setIntegrationAction('unlink-repo');
    setIntegrationError('');
    const repoName = repoIntegrationLabel(linkedRepo);
    try {
      await projectGithubApi.disconnectRepo(selectedProjectId, linkedRepo.id);
      await loadIssueIntegrations();
      setInteractionMessage(
        tr(
          'issue.linkDialog.notice.unlinkedRepo',
          'Unlinked GitHub repository {repoName}',
          { repoName },
        ),
      );
      setRepoNotice({
        id: Date.now(),
        title: tr(
          'issue.linkDialog.toast.repoUnlinked.title',
          'Repository unlinked',
        ),
        message: tr(
          'issue.linkDialog.toast.repoUnlinked.message',
          'GitHub repository {repoName} is disconnected.',
          { repoName },
        ),
        tone: 'success',
      });
    } catch (error) {
      setIntegrationError(errorMessage(error));
    } finally {
      setIntegrationAction(null);
    }
  };

  return (
    <div className="issue-page flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
      <span className="sr-only" aria-live="polite">
        {interactionMessage}
      </span>
      {repoNotice && (
        <NotificationToast
          key={repoNotice.id}
          title={repoNotice.title}
          message={repoNotice.message}
          tone={repoNotice.tone}
          onClose={() => setRepoNotice(null)}
        />
      )}
      {activeIssue && workItemsReady ? (
        <div ref={issueDetailRef} className="contents">
        <IssueDetailPage
          projectId={selectedProjectId}
          projectName={selectedProjectName}
          issue={activeIssue}
          availableLabels={projectIssueLabels}
          onBack={handleIssueBack}
          onAction={handleAction}
          onWorkItemChange={(item) => mergeWorkItem(item, setWorkItems)}
          onIssueDeleted={handleIssueDeleted}
          onIssueSync={handleIssueDetailSync}
          linkedProviderId={linkedProviderId}
          linkedRepoId={linkedRepoId}
          linkedRepoName={linkedRepoName}
          linkedGitHubRepos={integrationState?.linked_repositories ?? []}
          githubAccount={integrationState?.github_account ?? null}
          onOpenIntegrations={handleOpenIntegrations}
          tr={tr}
        />
        </div>
      ) : (
        <>
          <IssueHeader
            projectName={selectedProjectName}
            linkedProviderId={linkedProviderId}
            linkedRepoName={linkedRepoName}
            onOpenIntegrations={handleOpenIntegrations}
            tr={tr}
          />
          <IssueToolbar
            activeFilter={activeFilter}
            importEnabled={Boolean(linkedRepoId)}
            onFilterChange={handleFilterChange}
            onCreateIssue={openCreateIssueDialog}
            onImport={handleOpenImportDialog}
            onAction={handleAction}
            tr={tr}
          />

          <div ref={issueListRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--surface-2)] pb-10">
            {suppressIssuePlaceholder ? (
              null
            ) : workItemsError ? (
              <div className="flex min-h-[244px] items-center justify-center px-5">
                <div className="max-w-[440px] rounded-[12px] border border-[#342a2d] bg-[#1b1214] p-4 text-center">
                  <p className="text-[17px] font-bold text-[#ffb3bd]">
                    {tr('issue.error.loadFailed', 'Issues failed to load')}
                  </p>
                  <p className="mt-2 text-[14px] leading-snug text-[#d5a4ab]">
                    {workItemsError}
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex h-8 items-center gap-2 rounded-[8px] border border-[#55343a] px-3 text-[13px] font-semibold text-[#ffbec7] transition hover:bg-[#28181b]"
                    onClick={() => void loadWorkItems()}
                  >
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                    {tr('issue.error.retry', 'Retry')}
                  </button>
                </div>
              </div>
            ) : visibleIssueCount === 0 ? (
              <IssueEmptyState
                filter={activeFilter}
                onAction={handleAction}
                onCreateIssue={openCreateIssueDialog}
                onOpenIntegrations={handleOpenIntegrations}
                linkedProviderId={linkedProviderId}
                tr={tr}
              />
            ) : (
              <div className="min-w-[780px] px-[17px] pt-0">
                {visibleGroups.map((group) => (
                  <IssueSection
                    key={group.id}
                    group={group}
                    collapsed={collapsedGroups.has(group.id)}
                    selectedIssueId={selectedIssueId}
                    issueRowRefs={issueRowRefs}
                    onToggle={() => handleGroupToggle(group.id)}
                    onIssueSelect={handleIssueSelect}
                    onCreateIssue={() =>
                      openCreateIssueDialog(
                        issueGroupInitialWorkItemStatus(group.id),
                      )
                    }
                    statusOptions={issueRowStatusOptions}
                    priorityOptions={issueRowPriorityOptions}
                    onStatusChange={handleIssueRowStatusChange}
                    onPriorityChange={handleIssueRowPriorityChange}
                    tr={tr}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <RemoteRepositoryDialog
        open={integrationDialogOpen}
        providers={integrationState?.providers ?? []}
        githubAccount={integrationState?.github_account ?? null}
        repositories={integrationState?.github_repositories ?? []}
        linkedRepository={linkedRepo}
        linkedRepoOptionId={linkedRepoOptionId}
        linkingRepoName={linkingRepoName}
        loading={integrationLoading}
        error={integrationError}
        action={integrationAction}
        oauthFlow={oauthFlow}
        authFlow={authFlow}
        authStatus={authStatus}
        tr={tr}
        onAuthorizeGitHub={handleAuthorizeGitHub}
        onSwitchGitHubAccount={handleSwitchGitHubAccount}
        onRepoChange={handleRepositoryLink}
        onRepoUnlink={handleRepositoryUnlink}
        onClose={() => setIntegrationDialogOpen(false)}
      />
      <IssueImportDialog
        open={importDialogOpen}
        issues={importIssues}
        loading={importLoading}
        error={importError}
        action={importAction}
        query={importQuery}
        tr={tr}
        onQueryChange={setImportQuery}
        onImport={handleImportIssue}
        onClose={() => setImportDialogOpen(false)}
      />
      <IssueCreateDialog
        open={createDialogOpen}
        projectName={selectedProjectName}
        initialStatus={createIssueInitialStatus}
        sessions={projectSessions}
        sessionsLoading={projectSessionsLoading}
        submitting={createIssueSubmitting}
        tr={tr}
        availableLabels={projectIssueLabels}
        onClose={() => setCreateDialogOpen(false)}
        onCreate={handleCreateIssue}
      />
    </div>
  );
}

const emptyIssueCopy: Record<
  IssueFilter,
  { description: string; descriptionKey: string; title: string; titleKey: string }
> = {
  all: {
    title: 'All issues',
    titleKey: 'issue.empty.all.title',
    description: 'There are no issues in this project yet.',
    descriptionKey: 'issue.empty.all.description',
  },
  active: {
    title: 'Active issues',
    titleKey: 'issue.empty.active.title',
    description:
      'There are no active issues right now. Active issues will appear here.',
    descriptionKey: 'issue.empty.active.description',
  },
  backlog: {
    title: 'Backlog issues',
    titleKey: 'issue.empty.backlog.title',
    description:
      'There are no backlog issues. Deferred or lower-priority work will appear here when it is added.',
    descriptionKey: 'issue.empty.backlog.description',
  },
};

function IssueEmptyState({
  filter,
  onAction,
  onCreateIssue,
  onOpenIntegrations,
  linkedProviderId,
  tr,
}: {
  filter: IssueFilter;
  onAction: (message: string) => void;
  onCreateIssue: () => void;
  onOpenIntegrations: () => void;
  linkedProviderId: RemoteProviderId | null;
  tr: IssueTranslator;
}) {
  const copy = emptyIssueCopy[filter];
  const createIssuePresentation = useCommandPresentation('issue.create');
  const repositoryButtonLabel = tr(
    'issue.linkDialog.title',
    'Link external repository',
  );

  return (
    <div className="flex min-h-full min-w-[780px] items-center justify-center px-[17px] pb-[108px] pt-[108px]">
      <section className="w-[486px] max-w-full">
        <IssueEmptyIllustration filter={filter} />

        <h2 className="mt-[28px] text-[19px] font-bold leading-none text-[#f7f7f8]">
          {tr(copy.titleKey, copy.title)}
        </h2>
        <p className="mt-[22px] min-h-[22px] text-[15px] font-medium leading-[1.45] text-[#a6a8ad]">
          {tr(copy.descriptionKey, copy.description)}
        </p>

        <div className="mt-[22px] flex items-center gap-[13px]">
          <button
            type="button"
            data-command-id="issue.create"
            className="inline-flex h-[37px] items-center gap-2 rounded-full bg-[#5e6ad2] px-4 text-[15px] font-bold leading-none text-white transition hover:bg-[#6f78e2] active:scale-[0.99]"
            aria-keyshortcuts={
              createIssuePresentation.ariaKeyShortcuts || undefined
            }
            onClick={() => {
              onCreateIssue();
              onAction(tr('issue.empty.createAction', 'Create issue opened'));
            }}
          >
            <span>
              {tr('issue.empty.createNew', 'Create new issue')}
            </span>
            {createIssuePresentation.sequence.length > 0 && (
              <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[7px] border border-white/25 bg-white/10 px-1.5 font-mono text-[14px] font-bold leading-none text-white">
                {createIssuePresentation.label}
              </span>
            )}
          </button>

          <button
            type="button"
            className="inline-flex h-[37px] max-w-[270px] items-center gap-2 rounded-full border border-[#2a2b2d] bg-[#1b1c1f] px-4 text-[15px] font-bold leading-none text-[#f2f2f3] transition hover:border-[#383a40] hover:bg-[#242529]"
            onClick={onOpenIntegrations}
            title={repositoryButtonLabel}
          >
            {linkedProviderId ? (
              <span className="relative flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-[#242529] text-[#f2f2f3]">
                <ProviderIcon
                  providerId={linkedProviderId}
                  className="h-[14px] w-[14px]"
                />
                <span className="absolute bottom-[-1px] right-[-1px] h-[7px] w-[7px] rounded-full border border-[#1b1c1f] bg-[#39d353] shadow-[0_0_0_1px_rgba(57,211,83,0.28)]" />
              </span>
            ) : (
              <Link2 aria-hidden="true" className="h-[15px] w-[15px]" />
            )}
            <span className="min-w-0 truncate">{repositoryButtonLabel}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function IssueEmptyIllustration({ filter }: { filter: IssueFilter }) {
  if (filter === 'backlog' || filter === 'all') {
    return (
      <div className="flex h-[112px] w-[112px] -translate-x-[8px] items-center justify-center">
        <svg
          aria-hidden="true"
          className="h-[112px] w-[112px]"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.22}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient
              id="backlog-empty-stack-layer"
              x1="12"
              x2="12"
              y1="8"
              y2="19.2"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#d5d8df" />
              <stop offset="1" stopColor="#767b86" />
            </linearGradient>
            <linearGradient
              id="backlog-empty-stack-top"
              x1="12"
              x2="12"
              y1="4.7"
              y2="11.3"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#fbfbfe" />
              <stop offset="0.56" stopColor="#c7cad2" />
              <stop offset="1" stopColor="#868b96" />
            </linearGradient>
            <linearGradient
              id="backlog-empty-stack-glow"
              x1="12"
              x2="12"
              y1="4.7"
              y2="11.3"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#ffffff" stopOpacity={0.2} />
              <stop offset="0.58" stopColor="#ffffff" stopOpacity={0.035} />
              <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <g stroke="url(#backlog-empty-stack-layer)">
            <path
              d="M5.05 15.95 12 18.92l6.95-2.97"
              opacity={0.28}
            />
            <path
              d="M5.05 15.95 7.25 15.02m9.5 0 2.2.93"
              opacity={0.22}
            />
            <path
              d="M4.65 12.15 12 15.28l7.35-3.13"
              opacity={0.58}
            />
            <path
              d="M4.65 12.15 6.92 11.18m10.16 0 2.27.97"
              opacity={0.46}
            />
          </g>
          <path
            d="M11.72 4.88q.28-.11.56 0l7.43 2.98q.34.14 0 .28l-7.43 2.98q-.28.11-.56 0L4.29 8.14q-.34-.14 0-.28l7.43-2.98Z"
            fill="var(--surface-2)"
            stroke="var(--surface-2)"
            strokeWidth={2.65}
          />
          <path
            d="M11.72 4.88q.28-.11.56 0l7.43 2.98q.34.14 0 .28l-7.43 2.98q-.28.11-.56 0L4.29 8.14q-.34-.14 0-.28l7.43-2.98Z"
            fill="url(#backlog-empty-stack-glow)"
            stroke="url(#backlog-empty-stack-top)"
          />
          <path
            d="M4.42 7.95 12 4.92l7.58 3.03"
            opacity={0.58}
            stroke="#ffffff"
            strokeWidth={0.58}
          />
          <path
            d="M4.42 8.06 12 11.1l7.58-3.04"
            opacity={0.32}
            stroke="#7f8490"
            strokeWidth={0.78}
          />
        </svg>
      </div>
    );
  }

  if (filter === 'active') {
    return (
      <div className="flex h-[112px] w-[112px] -translate-x-[8px] items-center justify-center">
        <svg
          aria-hidden="true"
          className="h-[80px] w-[80px] text-[#d5d8df]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <path d="M3 12h4l3 8l4 -16l3 8h4" />
        </svg>
      </div>
    );
  }

  return (
    <img
      aria-hidden="true"
      alt=""
      className="h-[220px] w-[300px] object-contain"
      src="/issue/issue_page.png"
    />
  );
}

function IssueHeader({
  projectName,
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: {
  projectName: string;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueTranslator;
}) {
  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <ProjectBreadcrumbAvatar name={projectName} />
        <span className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
          {projectName}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
          {tr('issue.header.title', 'Issues')}
        </h1>
      </div>

      <HeaderIntegrationControls
        linkedProviderId={linkedProviderId}
        linkedRepoName={linkedRepoName}
        onOpen={onOpenIntegrations}
        tr={tr}
      />
    </header>
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
  tr: IssueTranslator;
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
                tr('issue.linkDialog.header.externalRepository', 'external repository'),
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

function RemoteRepositoryDialog({
  open,
  providers,
  githubAccount,
  repositories,
  linkedRepository,
  linkedRepoOptionId,
  linkingRepoName,
  loading,
  error,
  action,
  oauthFlow,
  authFlow,
  authStatus,
  tr,
  onAuthorizeGitHub,
  onSwitchGitHubAccount,
  onRepoChange,
  onRepoUnlink,
  onClose,
}: {
  open: boolean;
  providers: IssueIntegrationProvider[];
  githubAccount: GitHubAccount | null;
  repositories: GitHubRepositorySummary[];
  linkedRepository: ProjectRepoIntegration | null;
  linkedRepoOptionId: string;
  linkingRepoName: string | null;
  loading: boolean;
  error: string;
  action: string | null;
  oauthFlow: GitHubOAuthStartResponse | null;
  authFlow: GitHubDeviceFlowStartResponse | null;
  authStatus: string | null;
  tr: IssueTranslator;
  onAuthorizeGitHub: () => void | Promise<void>;
  onSwitchGitHubAccount: () => void | Promise<void>;
  onRepoChange: (repoOptionId: string) => void | Promise<void>;
  onRepoUnlink: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [activeProviderId, setActiveProviderId] =
    useState<RemoteProviderId>('github');
  const activeProvider =
    remoteProviders.find((provider) => provider.id === activeProviderId) ??
    remoteProviders[0];
  const ActiveProviderIcon = activeProvider.Icon;
  const repoOptions = useMemo<DropdownSelectOption[]>(
    () =>
      repositories.map((repo) => ({
        id: repo.node_id,
        label: repo.full_name,
        description: `${
          repo.private
            ? tr('issue.linkDialog.repo.visibility.privateLabel', 'Private')
            : tr('issue.linkDialog.repo.visibility.publicLabel', 'Public')
        } / ${repo.default_branch}`,
        leading: (
          <Github
            aria-hidden="true"
            className="h-6 w-6 shrink-0 text-[var(--ink-tertiary)]"
          />
        ),
      })),
    [repositories, tr],
  );
  const selectedRepo =
    repositories.find((repo) => repo.node_id === linkedRepoOptionId) ?? null;
  const selectedRepoLabel =
    selectedRepo?.full_name ??
    (linkedRepository ? repoIntegrationLabel(linkedRepository) : null);
  const selectedRepoBranch =
    selectedRepo?.default_branch ?? linkedRepository?.default_branch ?? 'main';
  const selectedRepoPrivate = selectedRepo?.private;
  const selectedRepoVisibility =
    selectedRepoPrivate === undefined
      ? tr('issue.linkDialog.repo.status.linked', 'linked')
      : selectedRepoPrivate
        ? tr('issue.linkDialog.repo.visibility.private', 'private')
        : tr('issue.linkDialog.repo.visibility.public', 'public');
  const authActionInProgress =
    action === 'authorize-github' || action === 'switch-github-account';
  const switchActionInProgress = action === 'switch-github-account';
  const pendingStatus = tr('issue.linkDialog.auth.status.pending', 'pending');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(8,9,10,0.82)] p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-repository-dialog-title"
        className="issue-link-dialog relative flex h-[min(847px,calc(var(--ot-app-frame-height,100vh)-94px))] max-h-[calc(var(--ot-app-frame-height,100vh)-32px)] w-[min(1303px,calc(var(--ot-app-frame-width,100vw)-184px))] max-w-[calc(var(--ot-app-frame-width,100vw)-32px)] min-w-[720px] origin-center scale-[0.58] flex-col overflow-hidden rounded-[20px] border border-[#24252a] bg-[#141416] text-white shadow-[0_28px_75px_rgba(0,0,0,0.72)] select-none"
      >
        <header className="flex h-[92px] shrink-0 items-center justify-between border-b border-[#2a2b2f] px-[33px]">
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex h-[39px] w-[39px] items-center justify-center rounded-[8px] border border-[#2d2e34] bg-[#232427] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <Link2 aria-hidden="true" className="h-[23px] w-[23px]" />
            </div>
            <h2
              id="remote-repository-dialog-title"
              className="truncate text-[25px] font-bold leading-none text-[#f6f7f8]"
            >
              {tr(
                'issue.linkDialog.title',
                'Link external repository',
              )}
            </h2>
          </div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-[8px] text-[#8f9096] transition hover:bg-white/[0.04] hover:text-[#f6f7f8]"
            aria-label={tr('issue.linkDialog.action.close', 'Close')}
            onClick={onClose}
          >
            <X aria-hidden="true" className="h-[26px] w-[26px]" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[423px_minmax(0,1fr)]">
          <aside className="border-r border-[#2a2b2f] px-5 py-9">
            <div className="mb-[19px] px-[13px] text-[18px] font-semibold uppercase tracking-[0.14em] text-[#6f737b]">
              {tr('issue.linkDialog.integrations', 'Integrations')}
            </div>
            <div className="space-y-5">
              {remoteProviders.map((provider) => {
                const ProviderListIcon = provider.Icon;
                const providerState = providers.find(
                  (candidate) => candidate.id === provider.id,
                );
                const status =
                  providerState?.status === 'linked'
                    ? tr('issue.linkDialog.status.linked', 'Linked')
                    : provider.supported
                      ? tr('issue.linkDialog.status.supported', 'Supported')
                      : tr(
                          'issue.linkDialog.status.notSupported',
                          'Not supported yet',
                        );
                const providerName = tr(
                  `issue.linkDialog.provider.${provider.id}.name`,
                  provider.name,
                );

                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={cn(
                      'flex h-[93px] w-full cursor-pointer items-center gap-5 rounded-[12px] border px-5 text-left transition',
                      activeProviderId === provider.id
                        ? 'border-[#4550a0] bg-[#1c1d2c] text-[#f7f7f8]'
                        : 'border-transparent text-[#a3a5ad] hover:bg-white/[0.035] hover:text-[#f7f7f8]',
                    )}
                    onClick={() => setActiveProviderId(provider.id)}
                  >
                    <span className="flex h-[45px] w-[45px] shrink-0 items-center justify-center rounded-[9px] border border-[#303137] bg-[#242529] text-[#f0f1f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <ProviderListIcon
                        aria-hidden="true"
                        className={cn(
                          'h-[25px] w-[25px]',
                          provider.iconClassName,
                        )}
                      />
                    </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[23px] font-bold leading-[1.1] text-[#f8f8f9]">
                          {providerName}
                        </span>
                      <span className="mt-[7px] block truncate text-[20px] leading-none text-[#a5a7af]">
                        {status}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col overflow-hidden">
            <main className="min-h-0 flex-1 overflow-y-auto px-[52px] py-[52px]">
              {error && (
                <div className="issue-link-warning mb-7 rounded-[12px] border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.1)] px-4 py-3 text-[15px] leading-[1.35] text-[#f6f0d0]">
                  {error}
                </div>
              )}

              <div className="flex items-start gap-[27px]">
                <div className="flex h-[65px] w-[65px] shrink-0 items-center justify-center rounded-[16px] border border-[#33343a] bg-[#28292d] text-[#f0f1f3] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_30px_rgba(0,0,0,0.22)]">
                  <ActiveProviderIcon
                    aria-hidden="true"
                    className={cn(
                      'h-9 w-9',
                      activeProvider.iconClassName,
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[30px] font-bold leading-[1.05] text-[#f8f8f9]">
                    {tr(
                      `issue.linkDialog.provider.${activeProvider.id}.name`,
                      activeProvider.name,
                    )}
                  </p>
                  <p className="mt-[19px] text-[23px] leading-[1.25] text-[#a4a6ad]">
                    {tr(
                      `issue.linkDialog.provider.${activeProvider.id}.description`,
                      activeProvider.description,
                    )}
                  </p>
                </div>
              </div>

              {activeProviderId === 'github' ? (
                <div className="mt-[54px]">
                  {!githubAccount ? (
                    <div className="min-h-[310px] rounded-[18px] border border-[#2b2c31] bg-[#18181a] px-8 py-7 shadow-[0_15px_30px_rgba(0,0,0,0.18)]">
                      <div className="mb-5 flex h-[52px] w-[52px] items-center justify-center rounded-[11px] border border-[#2e2f35] bg-[#222326] text-[#9fa2aa]">
                        <Github aria-hidden="true" className="h-[28px] w-[28px]" />
                      </div>
                      <p className="text-[25px] font-bold leading-none text-[#f8f8f9]">
                        {tr(
                          'issue.linkDialog.auth.title',
                          'GitHub authorization',
                        )}
                      </p>
                      <p className="mt-4 text-[22px] leading-[1.28] text-[#a5a7af]">
                        {tr(
                          'issue.linkDialog.auth.description',
                          'Connect an account before selecting a repository.',
                        )}
                      </p>
                      <button
                        type="button"
                        disabled={authActionInProgress}
                        className="mt-7 inline-flex h-[52px] min-w-[262px] cursor-pointer items-center justify-center gap-[13px] rounded-[8px] border border-[rgba(120,129,233,0.45)] bg-[#606bdb] px-7 text-[22px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_18px_rgba(0,0,0,0.2)] transition hover:bg-[#6c76e7] disabled:cursor-not-allowed disabled:opacity-70"
                        onClick={() => void onAuthorizeGitHub()}
                      >
                        <Github aria-hidden="true" className="h-[22px] w-[22px]" />
                        {switchActionInProgress
                          ? tr('issue.linkDialog.auth.switching', 'Switching...')
                          : action === 'authorize-github'
                            ? tr('issue.linkDialog.auth.starting', 'Starting...')
                            : tr(
                                'issue.linkDialog.auth.authorize',
                                'Authorize GitHub',
                              )}
                      </button>

                      {oauthFlow && (
                        <div className="mt-6 rounded-[12px] border border-[#2b2c31] bg-[#141416] p-4">
                          <p className="text-[17px] font-semibold text-[#f8f8f9]">
                            {tr(
                              'issue.linkDialog.auth.completeInBrowser',
                              'Complete authorization in your browser',
                            )}
                          </p>
                          <p className="mt-2 text-[15px] text-[#a5a7af]">
                            {tr('issue.linkDialog.auth.status', 'Status: {status}', {
                              status: authStatus ?? pendingStatus,
                            })}
                          </p>
                          <a
                            href={oauthFlow.authorization_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex h-[34px] items-center rounded-[7px] border border-[#34363c] px-3 text-[15px] text-[#d4d5da] transition hover:bg-white/[0.04] hover:text-white"
                          >
                            {tr(
                              'issue.linkDialog.auth.reopen',
                              'Reopen GitHub authorization',
                            )}
                          </a>
                        </div>
                      )}

                      {authFlow && (
                        <div className="mt-6 rounded-[12px] border border-[#2b2c31] bg-[#141416] p-4">
                          <p className="text-[17px] font-semibold text-[#f8f8f9]">
                            {tr(
                              'issue.linkDialog.auth.deviceCode',
                              'Device fallback code: {code}',
                              { code: authFlow.user_code },
                            )}
                          </p>
                          <p className="mt-2 text-[15px] text-[#a5a7af]">
                            {tr('issue.linkDialog.auth.status', 'Status: {status}', {
                              status: authStatus ?? pendingStatus,
                            })}
                          </p>
                          <a
                            href={
                              authFlow.verification_uri_complete ??
                              authFlow.verification_uri
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex h-[34px] items-center rounded-[7px] border border-[#34363c] px-3 text-[15px] text-[#d4d5da] transition hover:bg-white/[0.04] hover:text-white"
                          >
                            {tr(
                              'issue.linkDialog.auth.open',
                              'Open GitHub authorization',
                            )}
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 rounded-[18px] border border-[#2b2c31] bg-[#18181a] p-5 shadow-[0_15px_30px_rgba(0,0,0,0.18)]">
                      <div className="flex items-center justify-between gap-5">
                        <div className="flex min-w-0 items-center gap-4">
                          <RepoDialogAvatar account={githubAccount} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="min-w-0 truncate text-[22px] font-bold text-[#f8f8f9]">
                                {githubAccount.login}
                              </p>
                              <button
                                type="button"
                                disabled={loading || Boolean(action)}
                                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] text-[var(--ink-subtle)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-4)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-55"
                                aria-label={tr(
                                  'issue.linkDialog.auth.switchAccountFrom',
                                  'Switch GitHub account from {login}',
                                  { login: githubAccount.login },
                                )}
                                title={tr(
                                  'issue.linkDialog.auth.switchAccount',
                                  'Switch GitHub account',
                                )}
                                onClick={() => void onSwitchGitHubAccount()}
                              >
                                <ArrowLeftRight
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                />
                              </button>
                            </div>
                            <p className="mt-1 text-[17px] text-[#a5a7af]">
                              {tr(
                                'issue.linkDialog.auth.authorizedAccount',
                                'Authorized GitHub account',
                              )}
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#2f5d38] bg-[#15351c] px-3 py-1.5 text-[15px] font-semibold text-[#6ee188]">
                          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                          {tr('issue.linkDialog.auth.authorized', 'Authorized')}
                        </span>
                      </div>

                      <div>
                        <label className="mb-3 block text-[22px] font-semibold uppercase tracking-[0.12em] text-[#777a82]">
                          {tr('issue.linkDialog.repo.label', 'Repository')}
                        </label>
                        <DropdownSelect
                          value={linkedRepoOptionId}
                          options={repoOptions}
                          placeholder={tr(
                            'issue.linkDialog.repo.placeholder',
                            'Select repository',
                          )}
                          searchPlaceholder={tr(
                            'issue.linkDialog.repo.searchPlaceholder',
                            'Search repositories...',
                          )}
                          emptyLabel={tr(
                            'issue.linkDialog.repo.empty',
                            'No repositories found.',
                          )}
                          triggerIcon={
                            <Github className="h-7 w-7 text-[var(--ink-tertiary)]" />
                          }
                          className="issue-link-repo-select w-full [&>button]:h-[58px] [&>button]:rounded-[10px] [&>button]:border-[var(--hairline)] [&>button]:bg-[var(--surface-2)] [&>button]:px-4 [&>button]:py-0 [&>button]:text-[22px] [&>button]:font-semibold [&>button]:text-[var(--ink)] [&>button]:hover:border-[var(--hairline-strong)] [&>button>span]:!text-[26px] [&>button>span]:!font-semibold"
                          panelClassName="issue-link-repo-select-panel !rounded-[12px] !border-[var(--hairline)] !bg-[var(--surface-1)] !text-[18px] [&_*]:!text-[18px]"
                          panelMinWidth={420}
                          maxPanelHeightClassName="max-h-[300px]"
                          disabled={loading || action === 'link-repo'}
                          onChange={(repoId) => void onRepoChange(repoId)}
                        />
                      </div>

                      {linkingRepoName ? (
                        <div
                          className="rounded-[12px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4 text-[24px] font-bold leading-tight text-[var(--ink)]"
                          aria-live="polite"
                        >
                          {tr(
                            'issue.linkDialog.repo.linking',
                            'Linking {repoName}...',
                            { repoName: linkingRepoName },
                          )}
                        </div>
                      ) : selectedRepoLabel ? (
                        <div className="rounded-[12px] border border-[#2b2c31] bg-[#141416] p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="truncate text-[24px] font-bold leading-tight text-[#f8f8f9]">
                                {selectedRepoLabel}
                              </p>
                              <p className="mt-2 font-mono text-[18px] leading-tight text-[#9a9da5]">
                                {selectedRepoVisibility} / {selectedRepoBranch}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="inline-flex items-center gap-2 rounded-full bg-[rgba(96,107,219,0.14)] px-3 py-1.5 text-[18px] font-semibold text-[#7d87f4]">
                                <Github
                                  aria-hidden="true"
                                  className="h-5 w-5"
                                />
                                {tr('issue.linkDialog.status.linked', 'Linked')}
                              </span>
                              <button
                                type="button"
                                disabled={action === 'unlink-repo'}
                                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-[#55343a] bg-[#28181b] px-3 text-[18px] font-semibold text-[#ff9aa8] transition hover:border-[#74434c] hover:bg-[#351f24] disabled:cursor-not-allowed disabled:opacity-60"
                                onClick={() => void onRepoUnlink()}
                              >
                                <X aria-hidden="true" className="h-5 w-5" />
                                {action === 'unlink-repo'
                                  ? tr(
                                      'issue.linkDialog.repo.unlinking',
                                      'Unlinking...',
                                    )
                                  : tr('issue.linkDialog.repo.unlink', 'Unlink')}
                              </button>
                            </div>
                          </div>
                          {selectedRepo?.updated_at && (
                            <p className="mt-3 text-[18px] text-[#a5a7af]">
                              {tr(
                                'issue.linkDialog.repo.updated',
                                'Updated {date}',
                                { date: formatSimpleDate(selectedRepo.updated_at) },
                              )}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-[12px] border border-dashed border-[#303137] bg-[#141416] p-4 text-[28px] text-[#9a9da5]">
                          {tr(
                            'issue.linkDialog.repo.noneLinked',
                            'No repository linked.',
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-[54px] flex min-h-[310px] items-center justify-center rounded-[18px] border border-dashed border-[#2b2c31] bg-[#18181a] p-7 text-center">
                  <div className="max-w-[433px]">
                    <div className="mx-auto mb-7 flex h-[65px] w-[65px] items-center justify-center rounded-[16px] border border-[#33343a] bg-[#28292d] text-[#f0f1f3]">
                      <ActiveProviderIcon
                        aria-hidden="true"
                        className={cn(
                          'h-9 w-9',
                          activeProvider.iconClassName,
                        )}
                      />
                    </div>
                    <p className="text-[25px] font-bold text-[#f8f8f9]">
                      {tr(
                        'issue.linkDialog.providerUnsupportedTitle',
                        '{providerName} is not supported yet',
                        {
                          providerName: tr(
                            `issue.linkDialog.provider.${activeProvider.id}.name`,
                            activeProvider.name,
                          ),
                        },
                      )}
                    </p>
                    <p className="mt-4 text-[20px] leading-[1.3] text-[#a5a7af]">
                      {tr(
                        'issue.linkDialog.providerUnsupportedDesc',
                        'Only GitHub can be connected from this page right now.',
                      )}
                    </p>
                  </div>
                </div>
              )}
            </main>

            <footer className="flex h-[97px] shrink-0 items-center justify-between gap-5 border-t border-[#2a2b2f] px-10">
              <span className="min-w-0 flex-1 truncate font-mono text-[22px] text-[#a6a8af]">
                {selectedRepoLabel ??
                  tr('issue.linkDialog.repo.noneLinked', 'No repository linked.')}
              </span>
              <button
                type="button"
                className="h-[53px] min-w-[105px] cursor-pointer rounded-[10px] border border-[#303137] bg-[#151618] px-7 text-[21px] font-bold text-[#f8f8f9] transition hover:border-[#45474f] hover:bg-[#1b1c1f]"
                onClick={onClose}
              >
                {tr('issue.linkDialog.action.done', 'Done')}
              </button>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}

function RepoDialogAvatar({ account }: { account: GitHubAccount }) {
  if (account.avatar_url) {
    return (
      <img
        src={account.avatar_url}
        alt=""
        className="h-[47px] w-[47px] rounded-full border border-[#33353a]"
      />
    );
  }

  return (
    <span className="flex h-[47px] w-[47px] shrink-0 items-center justify-center rounded-full border border-[#3a3c42] bg-[linear-gradient(135deg,#30323a,#5e6ad2)] font-mono text-[15px] font-black text-white">
      {accountInitials(account.login)}
    </span>
  );
}

function repoIntegrationLabel(repo: ProjectRepoIntegration) {
  if (repo.owner && repo.name) return `${repo.owner}/${repo.name}`;
  return repo.name ?? repo.repo_id;
}

function formatFallback(
  fallback: string,
  replacements?: Record<string, string | number>,
) {
  if (!replacements) return fallback;

  return Object.entries(replacements).reduce(
    (value, [key, replacement]) =>
      value.replace(`{${key}}`, String(replacement)),
    fallback,
  );
}

function resolveLinkedGitHubRepoOptionId(
  repositories: GitHubRepositorySummary[],
  linkedRepo: ProjectRepoIntegration,
) {
  const match = repositories.find((repo) => {
    if (linkedRepo.external_id && repo.node_id === linkedRepo.external_id) {
      return true;
    }
    return (
      repo.owner === linkedRepo.owner &&
      repo.name === linkedRepo.name
    );
  });
  return match?.node_id ?? '';
}

function providerStatusLabel(status: string) {
  if (status === 'linked') return 'Linked';
  if (status === 'authorized') return 'Authorized';
  if (status === 'auth_required') return 'Authorization required';
  if (status === 'unsupported') return 'Not supported yet';
  return status;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const data = (error as { errorData?: { message?: string; code?: string } })
      .errorData;
    if (data?.message) return data.message;
    if (data?.code) return data.code;
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return 'Request failed. Please try again.';
}

function openGitHubDeviceFlow(flow: GitHubDeviceFlowStartResponse) {
  if (typeof window === 'undefined') return;
  window.open(
    flow.verification_uri_complete ?? flow.verification_uri,
    '_blank',
    'noopener,noreferrer',
  );
}

function openBlankAuthWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  return window.open('about:blank', '_blank');
}

function openGitHubOAuthFlow(
  flow: GitHubOAuthStartResponse,
  authWindow?: Window | null,
): boolean {
  if (typeof window === 'undefined') return false;
  if (authWindow && !authWindow.closed) {
    authWindow.opener = null;
    authWindow.location.href = flow.authorization_url;
    return true;
  }
  return Boolean(
    window.open(flow.authorization_url, '_blank', 'noopener,noreferrer'),
  );
}

export function githubOAuthPollDelay(value: number | null | undefined): number {
  const delay = Number.isFinite(value) ? Number(value) : 2_000;
  return Math.min(15_000, Math.max(1_000, delay));
}

export function shouldAutoFallbackToDevice(
  result: GitHubOAuthStatusResponse,
): boolean {
  return result.status === 'error' && result.fallback_to_device;
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

function ProviderIcon({
  providerId,
  className,
}: {
  providerId: RemoteProviderId;
  className?: string;
}) {
  const provider =
    remoteProviders.find((candidate) => candidate.id === providerId) ??
    remoteProviders[0];
  const Icon = provider.Icon;

  return (
    <Icon
      aria-hidden="true"
      className={cn(className, provider.iconClassName)}
    />
  );
}

function IssueToolbar({
  activeFilter,
  importEnabled,
  onFilterChange,
  onCreateIssue,
  onImport,
  onAction,
  tr,
}: {
  activeFilter: IssueFilter;
  importEnabled: boolean;
  onFilterChange: (filter: IssueFilter) => void;
  onCreateIssue: () => void;
  onImport: () => void;
  onAction: (message: string) => void;
  tr: IssueTranslator;
}) {
  return (
    <section className="flex h-[46px] shrink-0 items-center justify-between bg-[var(--surface-2)] px-[17px]">
      <div className="flex items-center gap-1.5">
        <FilterTab
          active={activeFilter === 'all'}
          label={tr('issue.toolbar.filter.all', 'All issues')}
          onClick={() => onFilterChange('all')}
        />
        <FilterTab
          active={activeFilter === 'active'}
          label={tr('issue.toolbar.filter.active', 'Active')}
          onClick={() => onFilterChange('active')}
        />
        <FilterTab
          active={activeFilter === 'backlog'}
          label={tr('issue.toolbar.filter.backlog', 'Backlog')}
          onClick={() => onFilterChange('backlog')}
        />
        <button
          type="button"
          data-command-id="issue.create"
          className="ml-5 flex h-[26px] w-[26px] items-center justify-center rounded-full text-[#8a8d93] transition hover:bg-[#1d1e20] hover:text-[#f4f4f5]"
          aria-label={tr('issue.toolbar.createIssue', 'Create issue')}
          title={tr('issue.toolbar.createIssue', 'Create issue')}
          onClick={() => onCreateIssue()}
        >
          <Plus aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton
          icon={ListFilter}
          label={tr('issue.toolbar.filterIssues', 'Filter issues')}
          onClick={() =>
            onAction(tr('issue.action.filterMenuOpened', 'Filter menu opened'))
          }
        />
        <ToolbarButton
          disabled
          icon={SlidersHorizontal}
          label={tr('issue.toolbar.displaySettings', 'Display settings')}
          onClick={() =>
            onAction(
              tr('issue.action.displaySettingsOpened', 'Display settings opened'),
            )
          }
        />
        <ToolbarButton
          disabled
          icon={BarChart3}
          label={tr('issue.toolbar.analytics', 'Analytics')}
          onClick={() =>
            onAction(tr('issue.action.analyticsOpened', 'Analytics opened'))
          }
        />
        <ToolbarButton
          disabled={!importEnabled}
          disabledTitle={tr(
            'issue.toolbar.importDisabled',
            'Connect a GitHub repository to import issues',
          )}
          icon={CloudDownload}
          label={tr('issue.toolbar.importIssues', 'Import issues')}
          onClick={onImport}
        />
      </div>
    </section>
  );
}

function FilterTab({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-[33px] rounded-[17px] border px-3 text-[15px] font-semibold leading-none transition',
        active
          ? 'border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)]'
          : 'border-[var(--hairline)] bg-[var(--surface-3)] text-[var(--ink-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
      )}
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  disabled = false,
  disabledTitle,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  disabledTitle?: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const buttonLabel = disabled ? (disabledTitle ?? label) : label;

  return (
    <button
      type="button"
      className={cn(
        'flex h-[33px] w-[33px] items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)] transition',
        disabled
          ? 'cursor-not-allowed opacity-45'
          : 'hover:bg-[var(--surface-3)] hover:text-[var(--ink)]',
      )}
      aria-label={buttonLabel}
      disabled={disabled}
      title={buttonLabel}
      onClick={disabled ? undefined : onClick}
    >
      <Icon aria-hidden="true" className="h-[14px] w-[14px]" strokeWidth={2.2} />
    </button>
  );
}

function IssueSection({
  group,
  collapsed,
  selectedIssueId,
  issueRowRefs,
  onToggle,
  onIssueSelect,
  onCreateIssue,
  statusOptions,
  priorityOptions,
  onStatusChange,
  onPriorityChange,
  tr,
}: {
  group: IssueGroup;
  collapsed: boolean;
  selectedIssueId: string;
  issueRowRefs: MutableRefObject<Map<string, HTMLElement>>;
  onToggle: () => void;
  onIssueSelect: (issue: IssueItem) => void;
  onCreateIssue: () => void;
  statusOptions: Array<IssueRowMenuOption<ProjectWorkItemStatus>>;
  priorityOptions: Array<IssueRowMenuOption<ProjectWorkItemPriority>>;
  onStatusChange: (
    issue: IssueItem,
    status: ProjectWorkItemStatus,
  ) => Promise<void>;
  onPriorityChange: (
    issue: IssueItem,
    priority: ProjectWorkItemPriority,
  ) => Promise<void>;
  tr: IssueTranslator;
}) {
  const groupTitle = tr(
    issueGroupStatusKey[group.id],
    issueGroupTitleFallback[group.id],
  );
  return (
    <section className="group/section">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'flex h-[39px] items-center justify-between rounded-[9px] px-4',
          issueGroupHeaderBgClass[group.id],
        )}
      >
        <div className="flex items-center gap-[10px]">
          <ChevronDown
            aria-hidden="true"
            className="h-3 w-3 text-[#333744]"
            fill="#333744"
            strokeWidth={0}
          />
          <StatusIcon status={group.id} size="header" />
          <div className="flex items-baseline gap-3">
            <h2 className="text-[16px] font-semibold leading-none text-[var(--ink)]">
              {groupTitle}
            </h2>
            <span className="text-[16px] font-medium leading-none text-[var(--ink-subtle)]">
              {group.count}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
          aria-label={tr('issue.section.addIssue', 'Add issue to {title}', {
            title: groupTitle,
          })}
          onClick={(event) => {
            event.stopPropagation();
            onCreateIssue();
          }}
        >
          <Plus aria-hidden="true" className="h-[14px] w-[14px]" />
        </button>
      </div>

      <div>
        {!collapsed &&
          group.items.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              selected={selectedIssueId === issue.id}
              rowRef={(node) => {
                if (node) issueRowRefs.current.set(issue.id, node);
                else issueRowRefs.current.delete(issue.id);
              }}
              onSelect={() => onIssueSelect(issue)}
              statusOptions={statusOptions}
              priorityOptions={priorityOptions}
              onStatusChange={onStatusChange}
              onPriorityChange={onPriorityChange}
              tr={tr}
            />
          ))}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  selected,
  rowRef: registerRowRef,
  onSelect,
  statusOptions,
  priorityOptions,
  onStatusChange,
  onPriorityChange,
  tr,
}: {
  issue: IssueItem;
  selected: boolean;
  rowRef: (node: HTMLElement | null) => void;
  onSelect: () => void;
  statusOptions: Array<IssueRowMenuOption<ProjectWorkItemStatus>>;
  priorityOptions: Array<IssueRowMenuOption<ProjectWorkItemPriority>>;
  onStatusChange: (
    issue: IssueItem,
    status: ProjectWorkItemStatus,
  ) => Promise<void>;
  onPriorityChange: (
    issue: IssueItem,
    priority: ProjectWorkItemPriority,
  ) => Promise<void>;
  tr: IssueTranslator;
}) {
  const rowRef = useRef<HTMLElement | null>(null);
  const [openPropertyMenu, setOpenPropertyMenu] =
    useState<IssueRowPropertyMenu>(null);
  const [statusQuery, setStatusQuery] = useState('');
  const [priorityQuery, setPriorityQuery] = useState('');
  const [pendingProperty, setPendingProperty] =
    useState<IssueRowPropertyMenu>(null);
  const filteredStatusOptions = filterIssueRowMenuOptions(
    statusOptions,
    statusQuery,
  );
  const filteredPriorityOptions = filterIssueRowMenuOptions(
    priorityOptions,
    priorityQuery,
  );

  useEffect(() => {
    if (!openPropertyMenu) return;

    const closeMenu = () => {
      setOpenPropertyMenu(null);
      setStatusQuery('');
      setPriorityQuery('');
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rowRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openPropertyMenu]);

  const handleOpenChange = (menu: Exclude<IssueRowPropertyMenu, null>) => {
    const nextMenu = openPropertyMenu === menu ? null : menu;
    setOpenPropertyMenu(nextMenu);
    if (nextMenu !== 'status') setStatusQuery('');
    if (nextMenu !== 'priority') setPriorityQuery('');
  };

  const handleStatusSelect = async (status: ProjectWorkItemStatus) => {
    setOpenPropertyMenu(null);
    setStatusQuery('');
    if (status === issue.workItem.status) return;
    setPendingProperty('status');
    try {
      await onStatusChange(issue, status);
    } finally {
      setPendingProperty(null);
    }
  };

  const handlePrioritySelect = async (priority: ProjectWorkItemPriority) => {
    setOpenPropertyMenu(null);
    setPriorityQuery('');
    if (priority === issue.workItem.priority) return;
    setPendingProperty('priority');
    try {
      await onPriorityChange(issue, priority);
    } finally {
      setPendingProperty(null);
    }
  };

  return (
    <article
      ref={(node) => {
        rowRef.current = node;
        registerRowRef(node);
      }}
      role="button"
      data-issue-row-id={issue.id}
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group grid min-h-[48px] grid-cols-[20px_70px_25px_minmax(0,1fr)_48px_62px] items-center gap-x-1 px-9 text-[var(--ink)] transition hover:bg-[var(--issue-row-hover-bg)]',
        selected && 'bg-[var(--issue-row-selected-bg)]',
      )}
    >
      <IssueRowPriorityDropdown
        disabled={pendingProperty !== null}
        open={openPropertyMenu === 'priority'}
        options={filteredPriorityOptions}
        tr={tr}
        value={issue.workItem.priority}
        onOpenChange={() => handleOpenChange('priority')}
        onQueryChange={setPriorityQuery}
        onSelect={(priority) => void handlePrioritySelect(priority)}
      />

      <IssueDisplayId
        id={issue.id}
        className={
          selected
            ? 'text-[var(--issue-row-active-muted)]'
            : 'group-hover:text-[var(--issue-row-active-muted)]'
        }
      />

      <IssueRowStatusDropdown
        disabled={pendingProperty !== null}
        open={openPropertyMenu === 'status'}
        options={filteredStatusOptions}
        tr={tr}
        value={issue.workItem.status}
        onOpenChange={() => handleOpenChange('status')}
        onQueryChange={setStatusQuery}
        onSelect={(status) => void handleStatusSelect(status)}
      />

      <div className="flex min-w-0 items-center gap-2 pr-2">
        <h3
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-semibold leading-normal',
            selected
              ? 'text-[var(--issue-row-active-ink)]'
              : 'text-[var(--ink)] group-hover:text-[var(--issue-row-active-ink)]',
          )}
        >
          {issue.title}
        </h3>

        {issue.labels && issue.labels.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {issue.labels.map((label) => (
              <IssueLabel
                key={`${issue.id}-${label.name}`}
                label={label}
                tr={tr}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <IssueSourceIcon source={issue.workItem.source} tr={tr} />
      </div>

      <time
        className={cn(
          'whitespace-nowrap text-right text-[13px] font-medium leading-none',
          selected
            ? 'text-[var(--issue-row-active-muted)]'
            : 'text-[var(--ink-subtle)] group-hover:text-[var(--issue-row-active-muted)]',
        )}
      >
        {issue.date}
      </time>
    </article>
  );
}

function IssueRowPriorityDropdown({
  disabled,
  open,
  options,
  tr,
  value,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  disabled: boolean;
  open: boolean;
  options: Array<IssueRowMenuOption<ProjectWorkItemPriority>>;
  tr: IssueTranslator;
  value: ProjectWorkItemPriority;
  onOpenChange: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (priority: ProjectWorkItemPriority) => void;
}) {
  const label = issueRowPriorityLabel(value, tr);
  return (
    <div
      className="relative flex h-5 w-5 items-center justify-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={tr('issue.detail.setPriority', 'Set priority to...')}
        title={label}
        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onOpenChange}
      >
        <PriorityMenuIcon priority={value} selected={value === 'urgent'} />
      </button>

      {open && (
        <IssueRowPropertyMenu
          emptyLabel={tr('issue.detail.noMatches', 'No matches')}
          options={options}
          searchPlaceholder={tr(
            'issue.detail.setPriority',
            'Set priority to...',
          )}
          searchShortcut="P"
          selectedValue={value}
          onQueryChange={onQueryChange}
          onSelect={onSelect}
          renderOptionIcon={(option) => (
            <PriorityMenuIcon priority={option.value} />
          )}
        />
      )}
    </div>
  );
}

function IssueRowStatusDropdown({
  disabled,
  open,
  options,
  tr,
  value,
  onOpenChange,
  onQueryChange,
  onSelect,
}: {
  disabled: boolean;
  open: boolean;
  options: Array<IssueRowMenuOption<ProjectWorkItemStatus>>;
  tr: IssueTranslator;
  value: ProjectWorkItemStatus;
  onOpenChange: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (status: ProjectWorkItemStatus) => void;
}) {
  const label = issueRowStatusLabel(value, tr);
  return (
    <div
      className="relative flex h-6 w-6 items-center justify-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={tr('issue.detail.changeStatus', 'Change status...')}
        title={label}
        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onOpenChange}
      >
        <StatusIcon status={projectWorkItemIssueStatus(value)} size="row" />
      </button>

      {open && (
        <IssueRowPropertyMenu
          emptyLabel={tr('issue.detail.noMatches', 'No matches')}
          options={options}
          searchPlaceholder={tr('issue.detail.changeStatus', 'Change status...')}
          searchShortcut="S"
          selectedValue={value}
          onQueryChange={onQueryChange}
          onSelect={onSelect}
          renderOptionIcon={(option) => (
            <StatusIcon
              status={projectWorkItemIssueStatus(option.value)}
              size="menu"
            />
          )}
        />
      )}
    </div>
  );
}

function IssueRowPropertyMenu<TValue extends string>({
  emptyLabel,
  options,
  searchPlaceholder,
  searchShortcut,
  selectedValue,
  onQueryChange,
  onSelect,
  renderOptionIcon,
}: {
  emptyLabel: string;
  options: Array<IssueRowMenuOption<TValue>>;
  searchPlaceholder: string;
  searchShortcut: string;
  selectedValue: TValue;
  onQueryChange: (query: string) => void;
  onSelect: (value: TValue) => void;
  renderOptionIcon: (option: IssueRowMenuOption<TValue>) => ReactNode;
}) {
  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
      <div className="flex h-12 items-center gap-2.5 border-b border-[var(--hairline)] px-4">
        <Search
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]"
        />
        <input
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-none text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)]"
          placeholder={searchPlaceholder}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-[5px] border border-[var(--hairline)] px-1 font-mono text-[11px] font-bold text-[var(--ink-tertiary)]">
          {searchShortcut}
        </span>
      </div>
      <div
        className="max-h-[220px] space-y-1 overflow-y-auto px-3 py-3 ot-scroll-area-styled"
        role="listbox"
      >
        {options.length > 0 ? (
          options.map((option) => {
            const selected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[7px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]"
                onClick={() => onSelect(option.value)}
              >
                {renderOptionIcon(option)}
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                </span>
                <IssueRowOptionShortcut
                  selected={selected}
                  shortcut={option.shortcut}
                />
              </button>
            );
          })
        ) : (
          <p className="px-3 py-2 text-[13px] font-bold text-[var(--ink-tertiary)]">
            {emptyLabel}
          </p>
        )}
      </div>
    </div>
  );
}

function IssueRowOptionShortcut({
  selected,
  shortcut,
}: {
  selected: boolean;
  shortcut: string;
}) {
  return (
    <span className="ml-auto flex w-10 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
      {selected ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--ink)]" />
      ) : (
        <span />
      )}
      <span className="font-mono text-[11px] font-bold text-[var(--ink-tertiary)]">
        {shortcut}
      </span>
    </span>
  );
}

function IssueSourceIcon({
  source,
  tr,
}: {
  source: ProjectWorkItem['source'] | string;
  tr: IssueTranslator;
}) {
  const providerId = issueSourceProviderId(source);
  const title =
    providerId === 'local'
      ? tr('issue.detail.sourceLocal', 'Local issue')
      : tr('issue.detail.sourceProvider', '{provider} issue', {
          provider: titleCaseToken(providerId),
        });

  if (providerId === 'local') {
    return (
      <span title={title}>
        <Box
          aria-hidden="true"
          className="h-[18px] w-[18px] text-[#6d7076]"
          strokeWidth={2.2}
        />
      </span>
    );
  }

  return (
    <span title={title}>
      <ProviderIcon providerId={providerId} className="h-[18px] w-[18px]" />
    </span>
  );
}

function IssueLabel({
  label,
  tr,
}: {
  label: IssueLabel;
  tr: IssueTranslator;
}) {
  const displayName = labelDisplayName(label.name, tr);

  return (
    <span className="inline-flex h-[27px] min-w-0 max-w-[116px] items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface-1)] px-[10px] text-[13px] font-medium leading-normal text-[var(--ink-subtle)]">
      <span
        className={cn(
          'h-[11px] w-[11px] shrink-0 rounded-full',
          labelColorClass[label.color],
        )}
      />
      <span className="min-w-0 truncate" title={displayName}>
        {displayName}
      </span>
    </span>
  );
}

function StatusIcon({
  status,
  size,
}: {
  status: IssueItem['status'] | IssueGroup['id'];
  size: 'header' | 'row' | 'menu';
}) {
  const dimension = size === 'header' ? 17 : size === 'row' ? 18 : 14;
  const borderWidth = size === 'row' ? 2.2 : 2;
  const iconSizeStyle = { height: dimension, width: dimension };

  if (status === 'backlog') {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full"
        style={{
          ...iconSizeStyle,
          background:
            'repeating-conic-gradient(#a9aab0 0deg 13deg, transparent 13deg 30deg)',
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
        }}
      />
    );
  }

  if (status === 'todo') {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full border-[#d9d9de]"
        style={{ ...iconSizeStyle, borderWidth }}
      />
    );
  }

  if (status === 'in_progress') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#f0c400]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute left-1/2 top-[3px] -translate-x-1/2 rounded-full bg-[#f0c400]"
          style={{ height: dimension * 0.32, width: borderWidth }}
        />
        <span
          className="absolute left-1/2 top-1/2 -translate-y-1/2 rounded-full bg-[#f0c400]"
          style={{ height: borderWidth, width: dimension * 0.32 }}
        />
      </span>
    );
  }

  if (status === 'ready_to_merge') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 overflow-hidden rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-r-full bg-[#4fc38b]"
          style={{
            bottom: borderWidth,
            right: borderWidth,
            top: borderWidth,
            width: dimension * 0.29,
          }}
        />
      </span>
    );
  }

  if (status === 'merging') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-full border-l-[#4fc38b] border-t-[#4fc38b]"
          style={{
            borderLeftWidth: borderWidth * 1.6,
            borderTopWidth: borderWidth * 1.6,
            height: dimension * 0.48,
            left: dimension * 0.19,
            top: dimension * 0.16,
            width: dimension * 0.48,
          }}
        />
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-[#6671e8] text-[#141519]"
        style={iconSizeStyle}
      >
        <Check
          aria-hidden="true"
          className={
            size === 'header'
              ? 'h-3 w-3'
              : size === 'row'
                ? 'h-[13px] w-[13px]'
                : 'h-[9px] w-[9px]'
          }
          strokeWidth={3.2}
        />
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span
        aria-hidden="true"
        className="relative flex shrink-0 items-center justify-center rounded-full bg-[#acbac8]"
        style={iconSizeStyle}
      >
        <span
          className="absolute rotate-45 rounded-full bg-white"
          style={{
            height: borderWidth * 1.08,
            width: dimension * 0.46,
          }}
        />
        <span
          className="absolute -rotate-45 rounded-full bg-white"
          style={{
            height: borderWidth * 1.08,
            width: dimension * 0.46,
          }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center rounded-full bg-[#acbac8]"
      style={iconSizeStyle}
    >
      <span
        className="absolute rounded-full bg-white"
        style={{
          height: borderWidth * 0.96,
          transform: `translateY(${-dimension * 0.12}px) rotate(-45deg)`,
          width: dimension * 0.45,
        }}
      />
      <span
        className="absolute rounded-full bg-white"
        style={{
          height: borderWidth * 0.96,
          transform: `translateY(${dimension * 0.12}px) rotate(-45deg)`,
          width: dimension * 0.45,
        }}
      />
    </span>
  );
}
