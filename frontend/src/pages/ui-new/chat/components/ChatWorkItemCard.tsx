import {
  ArrowRightIcon,
  FolderNotchOpenIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  FileTextIcon,
  FlagIcon,
  SquareIcon,
} from '@phosphor-icons/react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { formatDateShortWithTime } from '@/utils/date';
import { resolveLocalPathToAbsolutePath } from '@/utils/readOnlyLinks';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import type { ChatWorkItemGroup } from '../types';

const ARTIFACT_FILE_PATH_RE =
  /(^|[\s([{"'])(?<path>(?:[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\){2,}[^\\\r\n<>:"|?*\s`"')\]}.,:;!?]+|[a-zA-Z]:\\(?:[^\\\r\n<>:"|?*]+\\)*[^\\\r\n<>:"|?*]+\.[a-zA-Z0-9]{1,16}|\/(?:[^/\r\n]+\/){2,}[^/\r\n\s`"')\]}.,:;!?]+|\/(?:[^/\r\n]+\/)*[^/\r\n]+\.[a-zA-Z0-9]{1,16}|(?:\.{1,2}[\\/])?(?:[^\\/\r\n\s`"')\]}.,:;!?]+[\\/])*[^\\/\r\n\s`"')\]}.,:;!?]+\.[a-zA-Z0-9]{1,16}))/g;

type ExtractedArtifactPath = {
  rawPath: string;
  absolutePath: string;
};

function isArtifactPathCandidate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) &&
    !/^[a-zA-Z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith('file://')
  ) {
    return false;
  }

  ARTIFACT_FILE_PATH_RE.lastIndex = 0;
  return ARTIFACT_FILE_PATH_RE.test(` ${trimmed}`);
}

function extractArtifactPaths(
  content: string,
  workspacePath: string | undefined
): ExtractedArtifactPath[] {
  if (!workspacePath) {
    return [];
  }

  const paths = new Map<string, ExtractedArtifactPath>();
  const addPath = (rawPath: string) => {
    if (!isArtifactPathCandidate(rawPath)) {
      return;
    }

    const absolutePath = resolveLocalPathToAbsolutePath(rawPath, workspacePath);
    if (!absolutePath) {
      return;
    }

    if (!paths.has(absolutePath)) {
      paths.set(absolutePath, {
        rawPath: rawPath.trim(),
        absolutePath,
      });
    }
  };

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    addPath(match[1] ?? '');
  }

  for (const match of content.matchAll(/`([^`]+)`/g)) {
    addPath(match[1] ?? '');
  }

  for (const match of content.matchAll(ARTIFACT_FILE_PATH_RE)) {
    addPath(match.groups?.path ?? '');
  }

  return Array.from(paths.values());
}

export interface ChatWorkItemCardProps {
  group: ChatWorkItemGroup;
  senderLabel: string;
  senderRunnerType: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  workspacePath?: string;
  onOpenWorkspaceChanges?: (workspacePath: string, filePath?: string) => void;
  isCleanupMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return !!target.closest(
    'button, a, input, textarea, select, summary, details, [role="button"]'
  );
};

export function ChatWorkItemCard({
  group,
  senderLabel,
  senderRunnerType,
  isExpanded,
  onToggleExpand,
  workspacePath,
  onOpenWorkspaceChanges,
  isCleanupMode = false,
  isSelected = false,
  onToggleSelect,
}: ChatWorkItemCardProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const agentAvatarSeed = getAgentAvatarSeed(
    group.agentId,
    senderRunnerType,
    senderLabel
  );
  const agentAvatarStyle = getAgentAvatarStyle(agentAvatarSeed);
  const hasWorkspacePath = !!workspacePath;
  const fileChanges = hasWorkspacePath
    ? (() => {
        const paths = new Map<string, ExtractedArtifactPath>();

        for (const item of group.artifacts) {
          for (const path of extractArtifactPaths(
            item.content,
            workspacePath
          )) {
            if (!paths.has(path.absolutePath)) {
              paths.set(path.absolutePath, path);
            }
          }
        }

        return Array.from(paths.values());
      })()
    : [];
  const fileChangesTitle = t('timeline.workItem.filesChanged', {
    count: fileChanges.length,
  });

  const handleCardSelect = () => {
    if (!isCleanupMode || !onToggleSelect) return;
    onToggleSelect();
  };

  const handleCardClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) {
      return;
    }
    handleCardSelect();
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isCleanupMode || isInteractiveTarget(event.target)) {
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    handleCardSelect();
  };

  return (
    <div
      className={cn(
        'chat-session-work-item-row flex justify-start',
        isCleanupMode && 'is-cleanup-mode'
      )}
    >
      {isCleanupMode && (
        <button
          type="button"
          className="chat-session-work-item-select"
          onClick={handleCardSelect}
          aria-label={t('message.select')}
        >
          {isSelected ? (
            <CheckSquareIcon className="size-icon text-brand" weight="fill" />
          ) : (
            <SquareIcon className="size-icon text-low" />
          )}
        </button>
      )}
      <div
        className={cn(
          'chat-session-work-item-card',
          isCleanupMode && 'is-cleanup-mode',
          isSelected && 'is-selected'
        )}
        style={agentAvatarStyle}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
        role={isCleanupMode ? 'checkbox' : undefined}
        aria-checked={isCleanupMode ? isSelected : undefined}
        tabIndex={isCleanupMode ? 0 : undefined}
      >
        <div className="chat-session-work-item-header">
          <button
            type="button"
            className="chat-session-work-item-toggle"
            onClick={onToggleExpand}
            aria-expanded={isExpanded}
          >
            <div
              className="chat-session-work-item-avatar"
              style={agentAvatarStyle}
            >
              <AgentBrandIcon
                runnerType={senderRunnerType}
                className="chat-session-agent-avatar-logo"
              />
            </div>
            <div className="chat-session-work-item-heading">
              <div className="chat-session-work-item-eyebrow">
                {tCommon('conversation.taskCompleted')}
              </div>
              <div className="chat-session-work-item-title-row">
                <div className="chat-session-work-item-title">
                  {senderLabel}
                </div>
                {group.artifacts.length > 0 && (
                  <span className="chat-session-work-item-pill">
                    {t('timeline.workItem.artifactCount', {
                      count: group.artifacts.length,
                    })}
                  </span>
                )}
                {group.conclusions.length > 0 && (
                  <span className="chat-session-work-item-pill is-muted">
                    {t('timeline.workItem.statusCount', {
                      count: group.conclusions.length,
                    })}
                  </span>
                )}
              </div>
              <div className="chat-session-work-item-meta">
                {formatDateShortWithTime(group.createdAt)}
              </div>
            </div>
          </button>
          <div className="chat-session-work-item-header-actions">
            {hasWorkspacePath && (
              <button
                type="button"
                className={cn(
                  'chat-session-work-item-workspace-button',
                  onOpenWorkspaceChanges
                    ? 'is-enabled'
                    : 'cursor-not-allowed opacity-60'
                )}
                onClick={() => onOpenWorkspaceChanges?.(workspacePath!)}
                disabled={!onOpenWorkspaceChanges}
                title={t('timeline.workItem.openWorkspaceChanges')}
                aria-label={t('timeline.workItem.openWorkspaceChanges')}
              >
                <FolderNotchOpenIcon className="size-icon-xs" />
              </button>
            )}
            <button
              type="button"
              className="chat-session-work-item-expand-button"
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded ? t('members.collapse') : t('members.expand')
              }
            >
              <CaretDownIcon
                className={cn(
                  'chat-session-work-item-expand-icon',
                  !isExpanded && '-rotate-90'
                )}
              />
            </button>
            <CheckCircleIcon
              className="chat-session-work-item-complete-icon"
              weight="fill"
            />
          </div>
        </div>

        {isExpanded && group.artifacts.length > 0 && (
          <section className="chat-session-work-item-section">
            <div className="chat-session-work-item-section-label">
              <FileTextIcon className="size-icon-base" />
              <span>{t('timeline.workItem.artifacts')}</span>
            </div>
            <div className="chat-session-work-item-section-body">
              {group.artifacts.map((item) => (
                <div
                  key={item.id}
                  className="chat-session-work-item-entry is-artifact"
                >
                  <ChatMarkdown
                    content={item.content}
                    maxWidth="100%"
                    hideCopyButton
                    textClassName="text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {isExpanded &&
          workspacePath &&
          onOpenWorkspaceChanges &&
          fileChanges.length > 0 && (
            <section className="chat-session-work-item-section">
              <div className="chat-session-work-item-section-label">
                <FileTextIcon className="size-icon-base" />
                <span>{fileChangesTitle}</span>
              </div>
              <div className="chat-session-work-item-section-body">
                <div className="chat-session-work-item-file-group">
                  <div className="chat-session-work-item-file-links">
                    {fileChanges.map((path) => (
                      <button
                        key={path.absolutePath}
                        type="button"
                        className="chat-session-work-item-file-link"
                        onClick={() =>
                          onOpenWorkspaceChanges(
                            workspacePath,
                            path.absolutePath
                          )
                        }
                        title={path.absolutePath}
                      >
                        <span className="chat-session-work-item-file-link-label">
                          {path.rawPath}
                        </span>
                        <ArrowRightIcon
                          className="chat-session-work-item-file-link-icon"
                          weight="bold"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

        {isExpanded && group.conclusions.length > 0 && (
          <section className="chat-session-work-item-section">
            <div className="chat-session-work-item-section-label">
              <FlagIcon className="size-icon-base" />
              <span>{t('timeline.workItem.conclusion')}</span>
            </div>
            <div className="chat-session-work-item-section-body">
              {group.conclusions.map((item) => (
                <div
                  key={item.id}
                  className="chat-session-work-item-entry is-conclusion"
                >
                  <ChatMarkdown
                    content={item.content}
                    maxWidth="100%"
                    hideCopyButton
                    textClassName="text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
