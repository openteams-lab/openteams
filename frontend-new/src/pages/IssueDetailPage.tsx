import {
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  Clock3,
  GitBranch,
  Github,
  Link2,
  MoreHorizontal,
  MousePointer2,
  Paperclip,
  Plus,
  Send,
  SmilePlus,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  useEffect,
  useState,
  type ReactNode,
  type SVGProps,
} from 'react';
import { ProjectBreadcrumbAvatar } from '@/components/ProjectBreadcrumbAvatar';
import { projectWorkItemsApi } from '@/lib/api';
import type {
  ProjectWorkItem,
  ProjectWorkItemDetailResponse,
} from '@/types';

type IssueDetailStatus = 'todo' | 'backlog' | 'done';
type RemoteProviderId = 'github' | 'linear' | 'jira';
type RemoteProviderIcon = (props: SVGProps<SVGSVGElement>) => ReactNode;

export type IssueDetailItem = {
  id: string;
  workItemId: string;
  title: string;
  status: IssueDetailStatus;
  workItem: ProjectWorkItem;
};

export type IssueDetailTranslator = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

export type IssueDetailPageProps = {
  projectId: string;
  projectName: string;
  issue: IssueDetailItem;
  onBack: () => void;
  onAction: (message: string) => void;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueDetailTranslator;
};

type RemoteProviderIconConfig = {
  Icon: RemoteProviderIcon;
  iconClassName: string;
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

const cn = (...classes: Array<string | false | undefined>) =>
  classes.filter(Boolean).join(' ');

export function IssueDetailPage({
  projectId,
  projectName,
  issue,
  onBack,
  onAction,
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: IssueDetailPageProps) {
  const [detail, setDetail] = useState<ProjectWorkItemDetailResponse | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    if (!projectId || !issue.workItemId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');
    void projectWorkItemsApi
      .get(projectId, issue.workItemId)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((error) => {
        if (!cancelled) setDetailError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issue.workItemId, projectId]);

  const current = detail?.work_item ?? issue.workItem;
  const githubIssue = detail?.github_issue_detail ?? null;
  const githubIssueLink =
    detail?.external_links.find(
      (link) =>
        link.provider === 'github' && link.external_type === 'github_issue',
    ) ?? null;
  const issueBody = githubIssue?.body ?? current.description;
  const issueComments = githubIssue?.comments ?? [];
  const issueLabels = githubIssue?.summary.labels ?? [];
  const issueAssignees = githubIssue?.summary.assignees ?? [];
  const issueStatus = projectWorkItemIssueStatus(current.status);

  return (
    <>
      <IssueDetailHeader
        issue={{ ...issue, title: current.title, status: issueStatus }}
        projectName={projectName}
        onBack={onBack}
        onAction={onAction}
        linkedProviderId={linkedProviderId}
        linkedRepoName={linkedRepoName}
        onOpenIntegrations={onOpenIntegrations}
        tr={tr}
      />

      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#0c0c0d]">
        <div className="grid min-w-[820px] grid-cols-[minmax(0,1fr)_242px] gap-8 px-[15px] pb-14 pt-[6px]">
          <section className="min-w-0 pl-2 pr-1 pt-6">
            <h2 className="truncate text-[23px] font-bold leading-tight text-[#fbfbfc]">
              {current.title}
            </h2>

            {detailLoading && (
              <p className="mt-4 text-[13px] font-semibold text-[#777b83]">
                Loading issue detail...
              </p>
            )}
            {detailError && (
              <div className="mt-4 rounded-[10px] border border-[#55343a] bg-[#28181b] px-4 py-[10px] text-[13px] font-semibold text-[#ffb4bf]">
                {detailError}
              </div>
            )}

            {issueBody ? (
              <div className="mt-[26px] whitespace-pre-wrap rounded-[10px] border border-[#242528] bg-[#131415] p-[15px] text-[14px] leading-relaxed text-[#d6d8de]">
                {issueBody}
              </div>
            ) : (
              <button
                type="button"
                className="mt-8 block text-left text-[16px] font-medium leading-none text-[#60636a] transition hover:text-[#a7aab1]"
                onClick={() => onAction(`Description focused for ${issue.id}`)}
              >
                Add description...
              </button>
            )}

            <div className="mt-5 flex items-center gap-[18px] text-[#9ca0a7]">
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
              className="mt-[22px] flex items-center gap-2 text-[13px] font-medium leading-none text-[#b0b3ba] transition hover:text-[#f2f2f3]"
              onClick={() => onAction(`Sub-issues opened for ${issue.id}`)}
            >
              <Plus aria-hidden="true" className="h-[14px] w-[14px]" />
              <span>Add sub-issues</span>
            </button>

            <div className="mt-3 border-t border-[#242528] pt-5">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-[17px] font-bold leading-none text-[#fbfbfc]">
                  Activity
                </h3>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    className="text-[13px] font-semibold leading-none text-[#a3a7af] transition hover:text-[#f2f2f3]"
                    onClick={() => onAction(`Unsubscribed from ${issue.id}`)}
                  >
                    Unsubscribe
                  </button>
                  <IssueAvatar size="large" />
                </div>
              </div>

              <div className="flex items-center gap-3 pl-[10px] text-[13px] font-medium leading-none text-[#aeb1b8]">
                <IssueAvatar />
                <span>
                  {githubIssue?.summary.author ?? current.created_by ?? 'OpenTeams'}{' '}
                  created the issue{' '}
                  <span className="text-[#82858d]">
                    · {formatSimpleDate(current.created_at)}
                  </span>
                </span>
              </div>

              {issueComments.length > 0 && (
                <div className="mt-5 space-y-3">
                  {issueComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-[10px] border border-[#242528] bg-[#151617] p-[15px]"
                    >
                      <p className="text-[13px] font-semibold text-[#8f939b]">
                        {comment.author ?? 'unknown'} ·{' '}
                        {formatSimpleDate(comment.created_at)}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-[#d8d9de]">
                        {comment.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex h-[76px] items-end rounded-[9px] border border-[#232427] bg-[#161617] px-[15px] pb-3 pt-[15px]">
                <button
                  type="button"
                  className="self-start text-left text-[16px] font-medium leading-none text-[#666a72] transition hover:text-[#a6aab2]"
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
              <div className="flex h-7 items-center rounded-full border border-[#2a2b2e] bg-[#202124] text-[#9fa2a9]">
                <button
                  type="button"
                  className="flex h-full w-9 items-center justify-center rounded-l-full transition hover:bg-[#292a2e] hover:text-[#f4f4f5]"
                  aria-label="Issue actions"
                  onClick={() => onAction(`Issue actions opened for ${issue.id}`)}
                >
                  <MousePointer2
                    aria-hidden="true"
                    className="h-[14px] w-[14px]"
                    strokeWidth={2.2}
                  />
                </button>
                <span className="h-4 w-px bg-[#303136]" />
                <button
                  type="button"
                  className="flex h-full w-7 items-center justify-center rounded-r-full transition hover:bg-[#292a2e] hover:text-[#f4f4f5]"
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
              <DetailPropertyRow
                iconNode={<StatusIcon status={issueStatus} size="row" />}
              >
                <span className="font-bold text-[#e3e4e8]">
                  {statusLabel(issueStatus)}
                </span>
              </DetailPropertyRow>
              <DetailPropertyRow prefix="---">
                {titleCaseToken(current.priority)}
              </DetailPropertyRow>
              <DetailPropertyRow icon={Users}>
                {issueAssignees.length > 0
                  ? issueAssignees.join(', ')
                  : 'Unassigned'}
              </DetailPropertyRow>
              <DetailPropertyRow icon={Clock3}>Add to cycle</DetailPropertyRow>
            </DetailPanel>

            <DetailPanel title="Labels">
              {issueLabels.length > 0 ? (
                issueLabels.map((label) => (
                  <DetailPropertyRow key={label} icon={Tag}>
                    {label}
                  </DetailPropertyRow>
                ))
              ) : (
                <DetailPropertyRow icon={Tag}>No labels</DetailPropertyRow>
              )}
            </DetailPanel>

            <DetailPanel title="Project">
              <DetailPropertyRow icon={Box}>
                {titleCaseToken(current.source)}
              </DetailPropertyRow>
              {githubIssueLink?.number && (
                <DetailPropertyRow icon={Github}>
                  GitHub #{githubIssueLink.number}
                </DetailPropertyRow>
              )}
              {githubIssueLink?.url && (
                <a
                  href={githubIssueLink.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-[14px] inline-flex text-[13px] font-bold text-[#8d97ff] transition hover:text-[#b8bfff]"
                >
                  Open GitHub issue
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
  linkedProviderId,
  linkedRepoName,
  onOpenIntegrations,
  tr,
}: {
  issue: IssueDetailItem;
  projectName: string;
  onBack: () => void;
  onAction: (message: string) => void;
  linkedProviderId: RemoteProviderId | null;
  linkedRepoName?: string;
  onOpenIntegrations: () => void;
  tr: IssueDetailTranslator;
}) {
  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-[#1e1f20] bg-[#101112] px-6">
      <div className="flex min-w-0 items-center gap-[7px]">
        <ProjectBreadcrumbAvatar name={projectName} />
        <button
          type="button"
          className="truncate text-[15px] font-semibold leading-none text-[#f2f2f3] transition hover:text-white"
          onClick={() => onAction('Project breadcrumb selected')}
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
          className="truncate text-[15px] font-semibold leading-none text-[#f2f2f3] transition hover:text-white"
          onClick={onBack}
        >
          Issues
        </button>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="flex min-w-0 items-baseline gap-1 text-[15px] font-semibold leading-none text-[#f2f2f3]">
          <IssueDisplayId
            id={issue.id}
            maxWidthPx={105}
            className="shrink-0 text-[#f2f2f3]"
          />
          <span className="min-w-0 truncate">{issue.title}</span>
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

      <div className="flex shrink-0 items-center gap-[14px] text-[#8f9298]">
        <HeaderIntegrationControls
          linkedProviderId={linkedProviderId}
          linkedRepoName={linkedRepoName}
          onOpen={onOpenIntegrations}
          tr={tr}
        />
        <span className="font-mono text-[15px] font-medium leading-none">
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
        <span className="h-9 w-px bg-[#242528]" />
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
      className="flex h-7 w-7 items-center justify-center rounded-full border border-[#2a2b2e] bg-[#202124] text-[#9fa2a9] transition hover:bg-[#292a2e] hover:text-[#f4f4f5] active:scale-95"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="h-[14px] w-[14px]" strokeWidth={2.2} />
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
    <section className="mb-[9px] rounded-[10px] border border-[#242528] bg-[#161617] px-4 py-[15px]">
      <button
        type="button"
        className="mb-[18px] flex items-center gap-2 text-[15px] font-medium leading-none text-[#aeb2ba] transition hover:text-[#f2f2f3]"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-[12px] w-[12px]"
          fill="#9da1a9"
          strokeWidth={0}
        />
      </button>
      <div className="space-y-4">{children}</div>
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
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-[10px] text-left text-[14px] font-semibold leading-none text-[#979aa1] transition hover:text-[#f2f2f3]"
    >
      <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center text-[#979aa1]">
        {iconNode}
        {Icon && (
          <Icon
            aria-hidden="true"
            className="h-[16px] w-[16px]"
            strokeWidth={2.2}
          />
        )}
        {prefix && (
          <span className="font-mono text-[15px] font-bold leading-none">
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

function StatusIcon({
  status,
  size,
}: {
  status: IssueDetailStatus;
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

function projectWorkItemIssueStatus(
  status: ProjectWorkItem['status'],
): IssueDetailStatus {
  if (status === 'done' || status === 'cancelled') return 'done';
  if (status === 'blocked') return 'backlog';
  return 'todo';
}

function statusLabel(status: IssueDetailStatus) {
  if (status === 'backlog') return 'Backlog';
  if (status === 'done') return 'Done';
  return 'Todo';
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
