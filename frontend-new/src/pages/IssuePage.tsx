import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  BarChart3,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  Clock3,
  Flame,
  GitBranch,
  Github,
  Layers2,
  Link2,
  ListFilter,
  MousePointer2,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Plus,
  Send,
  SlidersHorizontal,
  SmilePlus,
  Tag,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  DropdownSelect,
  type DropdownSelectOption,
} from '@/components/DropdownSelect';
import {
  NotificationToast,
  type NotificationToastTone,
} from '@/components/NotificationToast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { githubAuthApi, projectGithubApi } from '@/lib/api';
import type {
  GitHubAccount,
  GitHubDeviceFlowStartResponse,
  GitHubOAuthStartResponse,
  GitHubRepositorySummary,
  IssueIntegrationProvider,
  ProjectIssueIntegrationsResponse,
  ProjectRepoIntegration,
} from '@/types';

type IssueLabel = {
  name: string;
  color: 'red' | 'blue' | 'cyan';
};

type IssueItem = {
  id: string;
  title: string;
  status: 'todo' | 'backlog' | 'done';
  labels?: IssueLabel[];
  date: string;
};

type IssueGroup = {
  id: 'todo' | 'backlog' | 'done';
  title: string;
  count: number;
  items: IssueItem[];
};

type IssueFilter = 'all' | 'active' | 'backlog';

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

const issueGroups: IssueGroup[] = [
  {
    id: 'todo',
    title: 'Todo',
    count: 1,
    items: [
      {
        id: 'OPE-12',
        title: '你好',
        status: 'todo',
        date: 'Jun 6',
      },
    ],
  },
  {
    id: 'backlog',
    title: 'Backlog',
    count: 6,
    items: [
      {
        id: 'OPE-5',
        title: 'openteams/plugin@1.2.27 failed to resolve',
        status: 'backlog',
        labels: [
          { name: 'Bug', color: 'red' },
          { name: 'Migrated', color: 'blue' },
        ],
        date: 'Apr 16',
      },
      {
        id: 'OPE-10',
        title: '对话响应较慢且点击停止需等待1分钟左右',
        status: 'backlog',
        labels: [{ name: 'Migrated', color: 'blue' }],
        date: 'May 26',
      },
      {
        id: 'OPE-8',
        title:
          '建议： 直接增加对本地模型的支持： Custom provider endpoint must use ...',
        status: 'backlog',
        labels: [
          { name: 'enhancem...', color: 'cyan' },
          { name: 'Migrated', color: 'blue' },
        ],
        date: 'May 13',
      },
      {
        id: 'OPE-6',
        title: 'Sneak Peek: Version 0.4.0 Features',
        status: 'backlog',
        labels: [
          { name: 'enhancem...', color: 'cyan' },
          { name: 'Migrated', color: 'blue' },
        ],
        date: 'Apr 22',
      },
      {
        id: 'OPE-9',
        title: 'workflow状态错误',
        status: 'backlog',
        labels: [
          { name: 'Bug', color: 'red' },
          { name: 'Migrated', color: 'blue' },
        ],
        date: 'May 19',
      },
      {
        id: 'OPE-7',
        title: '增加对DeepSeek-TUI支持',
        status: 'backlog',
        labels: [
          { name: 'enhancem...', color: 'cyan' },
          { name: 'Migrated', color: 'blue' },
        ],
        date: 'May 13',
      },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    count: 4,
    items: [
      {
        id: 'OPE-1',
        title: 'Get familiar with Linear',
        status: 'done',
        date: 'Apr 24',
      },
      {
        id: 'OPE-2',
        title: 'Set up your teams',
        status: 'done',
        date: 'Apr 24',
      },
      {
        id: 'OPE-3',
        title: 'Connect your tools',
        status: 'done',
        date: 'Apr 24',
      },
      {
        id: 'OPE-4',
        title: 'Import your data',
        status: 'done',
        date: 'Apr 24',
      },
    ],
  },
];

const labelColorClass: Record<IssueLabel['color'], string> = {
  red: 'bg-[#ff5f59]',
  blue: 'bg-[#4aa3ff]',
  cyan: 'bg-[#92ecec]',
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

export function IssuePage() {
  const { selectedProjectId, t } = useWorkspace();
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
  const [selectedIssueId, setSelectedIssueId] = useState(
    issueGroups[0]?.items[0]?.id ?? '',
  );
  const [activeIssue, setActiveIssue] = useState<IssueItem | null>(null);
  const [interactionMessage, setInteractionMessage] = useState('');
  const [repoNotice, setRepoNotice] = useState<IssueNotification | null>(null);
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
  const visibleGroups = useMemo(() => {
    if (activeFilter === 'backlog') {
      return issueGroups.filter((group) => group.id === 'backlog');
    }
    if (activeFilter === 'active') {
      return issueGroups.filter((group) => group.id !== 'done');
    }
    return issueGroups;
  }, [activeFilter]);
  const visibleIssueCount = visibleGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const linkedRepo = integrationState?.primary_repository ?? null;
  const linkedProviderId: RemoteProviderId | null =
    linkedRepo?.provider === 'github' ? 'github' : null;
  const linkedRepoName = linkedRepo ? repoIntegrationLabel(linkedRepo) : undefined;
  const linkedRepoOptionId = linkedRepo
    ? resolveLinkedGitHubRepoOptionId(
        integrationState?.github_repositories ?? [],
        linkedRepo,
      )
    : '';

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

  useEffect(() => {
    void loadIssueIntegrations();
  }, [loadIssueIntegrations]);

  useEffect(() => {
    if (!oauthFlow) return;
    let cancelled = false;
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
          setOauthFlow(null);
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
        }
      } catch (error) {
        if (!cancelled) {
          setOauthFlow(null);
          setIntegrationError(
            tr(
              'issue.linkDialog.error.oauthFallback',
              '{reason}. Starting device authorization fallback.',
              { reason: errorMessage(error) },
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
                'issue.linkDialog.error.deviceFallbackOnlyFailed',
                'Device fallback failed: {error}',
                { error: errorMessage(fallbackError) },
              ),
            );
          }
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadIssueIntegrations, oauthFlow, startDeviceAuthorization, tr]);

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
    setInteractionMessage(`Showing ${filter} issues`);
  };

  const handleGroupToggle = (groupId: IssueGroup['id']) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
        setInteractionMessage(`Expanded ${groupId}`);
      } else {
        next.add(groupId);
        setInteractionMessage(`Collapsed ${groupId}`);
      }
      return next;
    });
  };

  const handleIssueSelect = (issue: IssueItem) => {
    setSelectedIssueId(issue.id);
    setActiveIssue(issue);
    setInteractionMessage(`Opened ${issue.id}`);
  };

  const handleIssueBack = () => {
    setActiveIssue(null);
    setInteractionMessage('Returned to issues');
  };

  const handleAction = (message: string) => {
    setInteractionMessage(message);
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
      setOauthFlow(null);
      setAuthFlow(null);
      try {
        const flow = await githubAuthApi.startOAuthFlow();
        setOauthFlow(flow);
        setAuthStatus('pending');
        openGitHubOAuthFlow(flow, authWindow);
        setInteractionMessage(message);
      } catch (error) {
        authWindow?.close();
        const reason = errorMessage(error);
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
      }
    },
    [startDeviceAuthorization, tr],
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
    <div className="issue-page flex h-full min-h-0 flex-col overflow-hidden bg-[#0c0c0d] text-[#f4f4f5]">
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
      {activeIssue ? (
        <IssueDetailPage
          issue={activeIssue}
          onBack={handleIssueBack}
          onAction={handleAction}
          linkedProviderId={linkedProviderId}
          linkedRepoName={linkedRepoName}
          onOpenIntegrations={handleOpenIntegrations}
          tr={tr}
        />
      ) : (
        <>
          <IssueHeader
            linkedProviderId={linkedProviderId}
            linkedRepoName={linkedRepoName}
            onOpenIntegrations={handleOpenIntegrations}
            tr={tr}
          />
          <IssueToolbar
            activeFilter={activeFilter}
            onFilterChange={handleFilterChange}
            onAction={handleAction}
          />

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#0c0c0d] pb-10">
            {visibleIssueCount === 0 ? (
              <IssueEmptyState
                filter={activeFilter}
                onAction={handleAction}
                onOpenIntegrations={handleOpenIntegrations}
                tr={tr}
              />
            ) : (
              <div className="min-w-[820px] px-[19px] pt-0">
                {visibleGroups.map((group) => (
                  <IssueSection
                    key={group.id}
                    group={group}
                    collapsed={collapsedGroups.has(group.id)}
                    selectedIssueId={selectedIssueId}
                    onToggle={() => handleGroupToggle(group.id)}
                    onIssueSelect={handleIssueSelect}
                    onAction={handleAction}
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
    </div>
  );
}

const emptyIssueCopy: Record<
  IssueFilter,
  { description: string; title: string }
> = {
  all: {
    title: 'No issues',
    description:
      'Issues represent work that should be tracked by this team. There are currently no issues here. Create a new issue or link an external repository to start tracking work.',
  },
  active: {
    title: 'Active issues',
    description:
      'Active issues represent work that is currently in flight or should be worked on next. There are currently no active issues in this team. Once an issue moves to the Todo or In Progress state, it will show up here.',
  },
  backlog: {
    title: 'Backlog issues',
    description:
      'Backlog issues represent work that is waiting to be prioritized. There are currently no backlog issues in this team. New deferred work will show up here.',
  },
};

function IssueEmptyState({
  filter,
  onAction,
  onOpenIntegrations,
  tr,
}: {
  filter: IssueFilter;
  onAction: (message: string) => void;
  onOpenIntegrations: () => void;
  tr: IssueTranslator;
}) {
  const copy = emptyIssueCopy[filter];

  return (
    <div className="flex min-h-full min-w-[820px] items-center justify-center px-[19px] pb-[120px] pt-[120px]">
      <section className="w-[510px] max-w-full">
        <IssueEmptyIllustration />

        <h2 className="mt-[31px] text-[20px] font-bold leading-none text-[#f7f7f8]">
          {copy.title}
        </h2>
        <p className="mt-[25px] text-[16px] font-medium leading-[1.45] text-[#a6a8ad]">
          {copy.description}
        </p>

        <div className="mt-[31px] flex items-center gap-[15px]">
          <button
            type="button"
            className="inline-flex h-[39px] items-center gap-2 rounded-full bg-[#5e6ad2] px-[18px] text-[16px] font-bold leading-none text-white transition hover:bg-[#6f78e2] active:scale-[0.99]"
            onClick={() => onAction('Create issue opened')}
          >
            <span>Create new issue</span>
            <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-[7px] border border-white/25 bg-white/10 font-mono text-[15px] font-bold leading-none text-white">
              C
            </span>
          </button>

          <button
            type="button"
            className="inline-flex h-[39px] items-center gap-2 rounded-full border border-[#2a2b2d] bg-[#1b1c1f] px-[18px] text-[16px] font-bold leading-none text-[#f2f2f3] transition hover:border-[#383a40] hover:bg-[#242529]"
            onClick={onOpenIntegrations}
          >
            <Link2 aria-hidden="true" className="h-[15px] w-[15px]" />
            <span>{tr('issue.linkDialog.title', 'Link external repository')}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function IssueEmptyIllustration() {
  return (
    <svg
      aria-hidden="true"
      className="h-[118px] w-[178px] text-[#aeb0b6]"
      fill="none"
      viewBox="0 0 178 118"
    >
      <g opacity="0.9" strokeLinecap="round" strokeLinejoin="round">
        <g transform="translate(0 0)">
          <ellipse
            cx="40"
            cy="31"
            rx="37"
            ry="29"
            stroke="#55565b"
            strokeWidth="4"
          />
          <ellipse
            cx="40"
            cy="24"
            rx="28"
            ry="19"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M12 40c4 13 18 22 35 22 14 0 27-6 33-16"
            stroke="#36373b"
            strokeWidth="4"
          />
          <path
            d="M13 32c6 14 21 23 38 21 13-1 24-7 29-16"
            stroke="#898b91"
            strokeWidth="4"
          />
        </g>

        <g transform="translate(91 0)">
          <ellipse
            cx="40"
            cy="31"
            rx="37"
            ry="29"
            stroke="#55565b"
            strokeWidth="4"
          />
          <ellipse
            cx="40"
            cy="24"
            rx="28"
            ry="19"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M40 6v18h25c-1-11-11-19-25-18Z"
            fill="#9a9ca2"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M12 40c4 13 18 22 35 22 14 0 27-6 33-16"
            stroke="#36373b"
            strokeWidth="4"
          />
          <path
            d="M13 32c6 14 21 23 38 21 13-1 24-7 29-16"
            stroke="#898b91"
            strokeWidth="4"
          />
        </g>

        <g transform="translate(0 64)">
          <ellipse
            cx="40"
            cy="31"
            rx="37"
            ry="29"
            stroke="#55565b"
            strokeWidth="4"
          />
          <ellipse
            cx="40"
            cy="24"
            rx="28"
            ry="19"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M13 25c4 14 18 24 36 24 12 0 24-5 31-13v16c-8 8-21 13-35 13-18 0-33-8-41-21Z"
            fill="#9a9ca2"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M12 40c4 13 18 22 35 22 14 0 27-6 33-16"
            stroke="#36373b"
            strokeWidth="4"
          />
        </g>

        <g transform="translate(91 64)">
          <ellipse
            cx="40"
            cy="31"
            rx="37"
            ry="29"
            stroke="#55565b"
            strokeWidth="4"
          />
          <ellipse
            cx="40"
            cy="24"
            rx="28"
            ry="19"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M40 5c16 1 28 10 29 22 1 12-11 22-29 23Z"
            fill="#9a9ca2"
            stroke="#b9bbc1"
            strokeWidth="4"
          />
          <path
            d="M12 40c4 13 18 22 35 22 14 0 27-6 33-16"
            stroke="#36373b"
            strokeWidth="4"
          />
          <path
            d="M13 32c6 14 21 23 38 21 13-1 24-7 29-16"
            stroke="#898b91"
            strokeWidth="4"
          />
        </g>
      </g>
    </svg>
  );
}

function IssueDetailPage({
  issue,
  onBack,
  onAction,
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: {
  issue: IssueItem;
  onBack: () => void;
  onAction: (message: string) => void;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueTranslator;
}) {
  return (
    <>
      <IssueDetailHeader
        issue={issue}
        onBack={onBack}
        onAction={onAction}
        linkedProviderId={linkedProviderId}
        linkedRepoName={linkedRepoName}
        onOpenIntegrations={onOpenIntegrations}
        tr={tr}
      />

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#0c0c0d]">
        <div className="grid min-w-[860px] grid-cols-[minmax(0,1fr)_255px] gap-[38px] px-[17px] pb-16 pt-[7px]">
          <section className="min-w-0 pl-2 pr-1 pt-[27px]">
            <h2 className="truncate text-[25px] font-bold leading-tight text-[#fbfbfc]">
              {issue.title}
            </h2>

            <button
              type="button"
              className="mt-[35px] block text-left text-[17px] font-medium leading-none text-[#60636a] transition hover:text-[#a7aab1]"
              onClick={() => onAction(`Description focused for ${issue.id}`)}
            >
              Add description...
            </button>

            <div className="mt-[22px] flex items-center gap-5 text-[#9ca0a7]">
              <DetailPlainButton
                icon={SmilePlus}
                label="Add reaction"
                onClick={() => onAction(`Reaction opened for ${issue.id}`)}
              />
              <DetailPlainButton
                icon={Paperclip}
                label="Attach file"
                onClick={() => onAction(`Attachment opened for ${issue.id}`)}
              />
            </div>

            <button
              type="button"
              className="mt-6 flex items-center gap-2 text-[14px] font-medium leading-none text-[#b0b3ba] transition hover:text-[#f2f2f3]"
              onClick={() => onAction(`Sub-issues opened for ${issue.id}`)}
            >
              <Plus aria-hidden="true" className="h-[14px] w-[14px]" />
              <span>Add sub-issues</span>
            </button>

            <div className="mt-3 border-t border-[#242528] pt-[22px]">
              <div className="mb-[26px] flex items-center justify-between">
                <h3 className="text-[18px] font-bold leading-none text-[#fbfbfc]">
                  Activity
                </h3>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    className="text-[14px] font-semibold leading-none text-[#a3a7af] transition hover:text-[#f2f2f3]"
                    onClick={() => onAction(`Unsubscribed from ${issue.id}`)}
                  >
                    Unsubscribe
                  </button>
                  <IssueAvatar size="large" />
                </div>
              </div>

              <div className="flex items-center gap-3 pl-[11px] text-[14px] font-medium leading-none text-[#aeb1b8]">
                <IssueAvatar />
                <span>
                  Mingy Davis created the issue{' '}
                  <span className="text-[#82858d]">· 4h ago</span>
                </span>
              </div>

              <div className="mt-[26px] flex h-[81px] items-end rounded-[9px] border border-[#232427] bg-[#161617] px-4 pb-[14px] pt-4">
                <button
                  type="button"
                  className="self-start text-left text-[17px] font-medium leading-none text-[#666a72] transition hover:text-[#a6aab2]"
                  onClick={() => onAction(`Comment focused for ${issue.id}`)}
                >
                  Leave a comment...
                </button>
                <div className="ml-auto flex items-center gap-4">
                  <button
                    type="button"
                    className="text-[#83868e] transition hover:text-[#f2f2f3]"
                    aria-label="Attach to comment"
                    onClick={() =>
                      onAction(`Comment attachment opened for ${issue.id}`)
                    }
                  >
                    <Paperclip
                      aria-hidden="true"
                      className="h-[15px] w-[15px]"
                      strokeWidth={2.2}
                    />
                  </button>
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[#25262a] text-[#a1a4ab] transition hover:bg-[#303136] hover:text-[#f4f4f5] active:scale-95"
                    aria-label="Send comment"
                    onClick={() => onAction(`Comment submitted for ${issue.id}`)}
                  >
                    <Send
                      aria-hidden="true"
                      className="h-[14px] w-[14px]"
                      strokeWidth={2.4}
                    />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <aside className="min-w-0">
            <div className="mb-[7px] flex justify-end gap-2">
              <DetailRoundButton
                icon={Link2}
                label="Copy issue link"
                onClick={() => onAction(`Copied link for ${issue.id}`)}
              />
              <DetailRoundButton
                label="Copy issue ID"
                onClick={() => onAction(`Copied ID for ${issue.id}`)}
              >
                <span className="text-[9px] font-black leading-none">ID</span>
              </DetailRoundButton>
              <DetailRoundButton
                icon={GitBranch}
                label="Create branch"
                onClick={() => onAction(`Branch opened for ${issue.id}`)}
              />
              <div className="flex h-[30px] items-center rounded-full border border-[#2a2b2e] bg-[#202124] text-[#9fa2a9]">
                <button
                  type="button"
                  className="flex h-full w-[39px] items-center justify-center rounded-l-full transition hover:bg-[#292a2e] hover:text-[#f4f4f5]"
                  aria-label="Issue actions"
                  onClick={() => onAction(`Issue actions opened for ${issue.id}`)}
                >
                  <MousePointer2
                    aria-hidden="true"
                    className="h-[15px] w-[15px]"
                    strokeWidth={2.2}
                  />
                </button>
                <span className="h-[18px] w-px bg-[#303136]" />
                <button
                  type="button"
                  className="flex h-full w-[31px] items-center justify-center rounded-r-full transition hover:bg-[#292a2e] hover:text-[#f4f4f5]"
                  aria-label="More issue actions"
                  onClick={() =>
                    onAction(`More issue actions opened for ${issue.id}`)
                  }
                >
                  <ChevronDown
                    aria-hidden="true"
                    className="h-[14px] w-[14px]"
                    strokeWidth={2.4}
                  />
                </button>
              </div>
            </div>

            <DetailPanel title="Properties">
              <DetailPropertyRow iconNode={<StatusIcon status={issue.status} size="row" />}>
                <span className="font-bold text-[#e3e4e8]">
                  {statusLabel(issue.status)}
                </span>
              </DetailPropertyRow>
              <DetailPropertyRow prefix="---">Set priority</DetailPropertyRow>
              <DetailPropertyRow icon={Users}>Assign</DetailPropertyRow>
              <DetailPropertyRow icon={Clock3}>Add to cycle</DetailPropertyRow>
            </DetailPanel>

            <DetailPanel title="Labels">
              <DetailPropertyRow icon={Tag}>Add label</DetailPropertyRow>
            </DetailPanel>

            <DetailPanel title="Project">
              <DetailPropertyRow icon={Box}>Add to project</DetailPropertyRow>
            </DetailPanel>
          </aside>
        </div>
      </main>
    </>
  );
}

function IssueDetailHeader({
  issue,
  onBack,
  onAction,
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: {
  issue: IssueItem;
  onBack: () => void;
  onAction: (message: string) => void;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueTranslator;
}) {
  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[#1e1f20] bg-[#101112] px-[29px]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[#f15b1a] text-[#0b0b0c]">
          <Flame aria-hidden="true" className="h-[11px] w-[11px]" />
        </span>
        <button
          type="button"
          className="truncate text-[16px] font-semibold leading-none text-[#f2f2f3] transition hover:text-white"
          onClick={() => onAction('Project breadcrumb selected')}
        >
          Openteams
        </button>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <button
          type="button"
          className="truncate text-[16px] font-semibold leading-none text-[#f2f2f3] transition hover:text-white"
          onClick={onBack}
        >
          Issues
        </button>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="truncate text-[16px] font-semibold leading-none text-[#f2f2f3]">
          {issue.id} {issue.title}
        </h1>
        <button
          type="button"
          className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8a8d93] transition hover:bg-[#191a1b] hover:text-[#f2f2f3]"
          aria-label="More issue options"
          onClick={() => onAction(`More options opened for ${issue.id}`)}
        >
          <MoreHorizontal aria-hidden="true" className="h-[17px] w-[17px]" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-4 text-[#8f9298]">
        <HeaderIntegrationControls
          linkedProviderId={linkedProviderId}
          linkedRepoName={linkedRepoName}
          onOpen={onOpenIntegrations}
          tr={tr}
        />
        <span className="font-mono text-[16px] font-medium leading-none">
          <span className="text-[#a7aab1]">1</span> / 11
        </span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[#191a1b] hover:text-[#f2f2f3]"
          aria-label="Next issue"
          onClick={() => onAction('Next issue selected')}
        >
          <ArrowDown aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
        <span className="h-[39px] w-px bg-[#242528]" />
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[#191a1b] hover:text-[#f2f2f3]"
          aria-label="Previous issue"
          onClick={() => onAction('Previous issue selected')}
        >
          <ArrowUp aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
      </div>
    </header>
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
      <Icon aria-hidden="true" className="h-[15px] w-[15px]" strokeWidth={2.2} />
    </button>
  );
}

function DetailRoundButton({
  icon: Icon,
  label,
  onClick,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-[#2a2b2e] bg-[#202124] text-[#9fa2a9] transition hover:bg-[#292a2e] hover:text-[#f4f4f5] active:scale-95"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="h-[15px] w-[15px]" strokeWidth={2.2} />
      ) : (
        children
      )}
    </button>
  );
}

function DetailPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-[10px] rounded-[10px] border border-[#242528] bg-[#161617] px-[18px] py-[17px]">
      <button
        type="button"
        className="mb-5 flex items-center gap-2 text-[16px] font-medium leading-none text-[#aeb2ba] transition hover:text-[#f2f2f3]"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-[12px] w-[12px]"
          fill="#9da1a9"
          strokeWidth={0}
        />
      </button>
      <div className="space-y-[18px]">{children}</div>
    </section>
  );
}

function DetailPropertyRow({
  icon: Icon,
  iconNode,
  prefix,
  children,
}: {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  prefix?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 text-left text-[15px] font-semibold leading-none text-[#979aa1] transition hover:text-[#f2f2f3]"
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[#979aa1]">
        {iconNode}
        {Icon && (
          <Icon
            aria-hidden="true"
            className="h-[17px] w-[17px]"
            strokeWidth={2.2}
          />
        )}
        {prefix && (
          <span className="font-mono text-[16px] font-bold leading-none">
            {prefix}
          </span>
        )}
      </span>
      <span>{children}</span>
    </button>
  );
}

function IssueAvatar({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border border-[#2e8cff] bg-[radial-gradient(circle_at_36%_30%,#ffd6a4_0_18%,#f06b35_19%_46%,#1779ff_47%_100%)] text-[8px] font-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset]',
        size === 'large' ? 'h-5 w-5' : 'h-4 w-4',
      )}
    >
      M
    </span>
  );
}

function statusLabel(status: IssueItem['status']) {
  if (status === 'backlog') return 'Backlog';
  if (status === 'done') return 'Done';
  return 'Todo';
}

function IssueHeader({
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: {
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueTranslator;
}) {
  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[#1e1f20] bg-[#101112] px-[29px]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[#f15b1a] text-[#0b0b0c]">
          <Flame aria-hidden="true" className="h-[11px] w-[11px]" />
        </span>
        <span className="truncate text-[16px] font-semibold leading-none text-[#f2f2f3]">
          Openteams
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="truncate text-[16px] font-semibold leading-none text-[#f2f2f3]">
          Issues
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
    <div className="flex shrink-0 items-center gap-1.5 text-[#9b9da3]">
      {linkedProviderId && (
        <span
          className="relative flex h-6 w-6 items-center justify-center text-[#f2f2f3]"
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
          <span className="absolute bottom-[3px] right-[2px] h-[6px] w-[6px] rounded-full border border-[#101112] bg-[#39d353] shadow-[0_0_0_1px_rgba(57,211,83,0.28)]" />
        </span>
      )}
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full transition hover:bg-[#191a1b] hover:text-[#f2f2f3]"
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
) {
  if (typeof window === 'undefined') return;
  if (authWindow && !authWindow.closed) {
    authWindow.opener = null;
    authWindow.location.href = flow.authorization_url;
    return;
  }
  window.open(flow.authorization_url, '_blank', 'noopener,noreferrer');
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
  onFilterChange,
  onAction,
}: {
  activeFilter: IssueFilter;
  onFilterChange: (filter: IssueFilter) => void;
  onAction: (message: string) => void;
}) {
  return (
    <section className="flex h-[49px] shrink-0 items-center justify-between bg-[#101112] px-[19px]">
      <div className="flex items-center gap-1.5">
        <FilterTab
          active={activeFilter === 'all'}
          label="All issues"
          onClick={() => onFilterChange('all')}
        />
        <FilterTab
          active={activeFilter === 'active'}
          label="Active"
          onClick={() => onFilterChange('active')}
        />
        <FilterTab
          active={activeFilter === 'backlog'}
          label="Backlog"
          onClick={() => onFilterChange('backlog')}
        />
        <button
          type="button"
          className="ml-[23px] flex h-7 w-7 items-center justify-center rounded-full text-[#8a8d93] transition hover:bg-[#1d1e20] hover:text-[#f4f4f5]"
          aria-label="Group by status"
          onClick={() => onAction('Group menu opened')}
        >
          <Layers2 aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton
          icon={ListFilter}
          label="Filter issues"
          onClick={() => onAction('Filter menu opened')}
        />
        <ToolbarButton
          icon={SlidersHorizontal}
          label="Display settings"
          onClick={() => onAction('Display settings opened')}
        />
        <ToolbarButton
          icon={BarChart3}
          label="Analytics"
          onClick={() => onAction('Analytics opened')}
        />
        <ToolbarButton
          icon={PanelRight}
          label="Open side panel"
          onClick={() => onAction('Side panel opened')}
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
        'h-[35px] rounded-[18px] border px-[13px] text-[16px] font-semibold leading-none transition',
        active
          ? 'border-[#2c2d30] bg-[#202123] text-[#fbfbfc]'
          : 'border-[#292a2d] bg-[#121314] text-[#979a9f] hover:bg-[#191a1b] hover:text-[#d8d9dc]',
      )}
    >
      {label}
    </button>
  );
}

function ToolbarButton({
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
      className="flex h-[35px] w-[35px] items-center justify-center rounded-full border border-[#2a2b2d] bg-[#202123] text-[#a1a3a8] transition hover:bg-[#292a2d] hover:text-[#f4f4f5]"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="h-[15px] w-[15px]" strokeWidth={2.2} />
    </button>
  );
}

function IssueSection({
  group,
  collapsed,
  selectedIssueId,
  onToggle,
  onIssueSelect,
  onAction,
}: {
  group: IssueGroup;
  collapsed: boolean;
  selectedIssueId: string;
  onToggle: () => void;
  onIssueSelect: (issue: IssueItem) => void;
  onAction: (message: string) => void;
}) {
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
          'flex h-[42px] items-center justify-between rounded-[9px] px-5',
          group.id === 'done' ? 'bg-[#191a21]' : 'bg-[#191a1b]',
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
            <h2 className="text-[17px] font-semibold leading-none text-[#e5e5e7]">
              {group.title}
            </h2>
            <span className="text-[17px] font-medium leading-none text-[#8f939b]">
              {group.count}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-[#979aa1] transition hover:bg-[#27282a] hover:text-[#f4f4f5]"
          aria-label={`Add issue to ${group.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onAction(`Add issue to ${group.title}`);
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
              onSelect={() => onIssueSelect(issue)}
              onAction={onAction}
            />
          ))}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  selected,
  onSelect,
  onAction,
}: {
  issue: IssueItem;
  selected: boolean;
  onSelect: () => void;
  onAction: (message: string) => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'grid h-[51px] grid-cols-[35px_74px_27px_minmax(0,1fr)_auto_37px_67px] items-center px-11 text-[#f2f2f3] transition hover:bg-[#131415]',
        selected && 'bg-[#131415]',
      )}
    >
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-full text-[#91949a] opacity-90 transition hover:bg-[#1d1e20] hover:text-[#f2f2f3]"
        aria-label={`Open actions for ${issue.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onAction(`Actions opened for ${issue.id}`);
        }}
      >
        <MoreHorizontal
          aria-hidden="true"
          className="h-[17px] w-[17px]"
          strokeWidth={2.2}
        />
      </button>

      <span className="font-mono text-[16px] font-medium leading-none text-[#8f9298]">
        {issue.id}
      </span>

      <StatusIcon status={issue.status} size="row" />

      <h3 className="min-w-0 truncate pr-2.5 text-[14px] font-semibold leading-none text-[#f4f4f5]">
        {issue.title}
      </h3>

      <div className="hidden min-w-[210px] items-center justify-end gap-1.5 xl:flex">
        {issue.labels?.map((label) => (
          <IssueLabel key={`${issue.id}-${label.name}`} label={label} />
        ))}
      </div>

      <div className="flex justify-center">
        <Users
          aria-hidden="true"
          className="h-[19px] w-[19px] text-[#6d7076]"
          strokeWidth={2.2}
        />
      </div>

      <time className="whitespace-nowrap text-right text-[14px] font-medium leading-none text-[#999ba0]">
        {issue.date}
      </time>
    </article>
  );
}

function IssueLabel({ label }: { label: IssueLabel }) {
  return (
    <span className="inline-flex h-[29px] max-w-[124px] items-center gap-2 rounded-full border border-[#28292c] bg-[#101112] px-[11px] text-[14px] font-medium leading-none text-[#9b9da3]">
      <span
        className={cn(
          'h-[11px] w-[11px] shrink-0 rounded-full',
          labelColorClass[label.color],
        )}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function StatusIcon({
  status,
  size,
}: {
  status: IssueItem['status'] | IssueGroup['id'];
  size: 'header' | 'row';
}) {
  const iconSize = size === 'header' ? 'h-[17px] w-[17px]' : 'h-[18px] w-[18px]';

  if (status === 'done') {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-[#5e6ad2] text-[#111216]',
          iconSize,
        )}
      >
        <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }

  if (status === 'backlog') {
    return (
      <CircleDashed
        aria-hidden="true"
        className={cn('shrink-0 text-[#a6a9b0]', iconSize)}
        strokeWidth={2.4}
      />
    );
  }

  return (
    <Circle
      aria-hidden="true"
      className={cn('shrink-0 text-[#d7d9de]', iconSize)}
      strokeWidth={2.4}
    />
  );
}
