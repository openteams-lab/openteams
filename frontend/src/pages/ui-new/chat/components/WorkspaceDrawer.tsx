import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CaretDownIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ChatAgent, ChatMessage } from 'shared/types';
import RawLogText from '@/components/common/RawLogText';
import { formatDateShortWithTime } from '@/utils/date';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RunHistoryItem, RunRetentionState } from '../types';
import {
  detectApiError,
  extractErrorFromMeta,
  extractMentionFailureMeta,
  extractProtocolErrorMeta,
} from '../utils';

export interface FailedMessageInfo {
  message: ChatMessage;
  errorType: 'protocol' | 'api';
  errorSummary: string;
  errorDetail?: string;
}

export interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  agent: ChatAgent | null;
  workspacePath: string | null;
  runs: RunHistoryItem[];
  messages: ChatMessage[];
  retentionByRunId?: Map<string, RunRetentionState>;
  logRunId: string | null;
  logContent: string;
  logLoading: boolean;
  logError: string | null;
  onLoadLog: (runId: string) => void;
}

export function WorkspaceDrawer({
  isOpen,
  onClose,
  agent,
  runs,
  messages,
  retentionByRunId,
  logRunId,
  logContent,
  logLoading,
  logError,
  onLoadLog,
}: WorkspaceDrawerProps) {
  const { t } = useTranslation('chat');
  const [expandedRun, setExpandedRun] = useState<RunHistoryItem | null>(null);
  const [expandedError, setExpandedError] = useState<FailedMessageInfo | null>(
    null
  );
  const [isFailedMessagesExpanded, setIsFailedMessagesExpanded] =
    useState(true);

  // Filter and extract failed messages for this agent
  const failedMessages = useMemo<FailedMessageInfo[]>(() => {
    if (!agent) return [];
    const failed: FailedMessageInfo[] = [];

    for (const message of messages) {
      // 1. Agent messages with API errors
      if (message.sender_type === 'agent' && message.sender_id === agent.id) {
        const errorInfo = extractErrorFromMeta(message.meta);
        const apiError = errorInfo
          ? null
          : detectApiError(message.content, { requireStandalone: true });
        if (errorInfo || apiError) {
          failed.push({
            message,
            errorType: 'api',
            errorSummary: errorInfo?.summary ?? apiError?.message ?? '',
            errorDetail: errorInfo
              ? errorInfo.content !== errorInfo.summary
                ? errorInfo.content
                : undefined
              : apiError?.provider
                ? `Provider: ${apiError.provider}`
                : undefined,
          });
        }
        continue;
      }

      // 2. System messages about this agent
      if (message.sender_type === 'system') {
        // Protocol errors
        const protocolError = extractProtocolErrorMeta(message.meta);
        if (protocolError?.agentName === agent.name && protocolError.code) {
          failed.push({
            message,
            errorType: 'protocol',
            errorSummary:
              protocolError.reason || `Protocol error: ${protocolError.code}`,
            errorDetail:
              protocolError.detail || protocolError.rawOutput || undefined,
          });
          continue;
        }

        // Mention failures (executor startup errors, etc.)
        const mentionFailure = extractMentionFailureMeta(
          message.meta,
          agent.name
        );
        if (mentionFailure) {
          failed.push({
            message,
            errorType: 'protocol',
            errorSummary: mentionFailure.reason,
            errorDetail: mentionFailure.sourceMessageId
              ? `Source message: ${mentionFailure.sourceMessageId.slice(0, 8)}...`
              : undefined,
          });
        }
      }
    }

    // Sort by created_at descending (most recent first)
    return failed.sort(
      (a, b) =>
        new Date(b.message.created_at).getTime() -
        new Date(a.message.created_at).getTime()
    );
  }, [messages, agent]);

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full justify-end',
          !isOpen && 'pointer-events-none'
        )}
        onClick={onClose}
      >
        <div
          className={cn(
            'chat-session-workspace-drawer h-full w-[440px] max-w-full border-l border-border shadow-lg transition-transform flex flex-col',
            isOpen ? 'translate-x-0' : 'translate-x-full'
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-session-workspace-drawer-header px-base py-base border-b border-border shrink-0 flex items-center justify-between">
            <div className="chat-session-workspace-drawer-eyebrow min-w-0 truncate">
              {agent?.name ?? t('modals.workspaceDrawer.agentWorkspace')}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-low hover:text-normal transition-colors"
              aria-label={t('modals.workspaceDrawer.close')}
              title={t('modals.workspaceDrawer.close')}
            >
              <XIcon className="size-icon-sm" />
            </button>
          </div>
          <div className="p-base space-y-base overflow-y-auto flex-1 min-h-0">
            {/* Failed Messages Section */}
            {failedMessages.length > 0 && (
              <div className="space-y-half">
                <button
                  type="button"
                  className="chat-session-workspace-link flex w-full items-center justify-between text-sm font-medium text-normal transition-colors"
                  onClick={() =>
                    setIsFailedMessagesExpanded((expanded) => !expanded)
                  }
                  aria-expanded={isFailedMessagesExpanded}
                >
                  <span className="flex items-center gap-1.5">
                    <WarningCircleIcon
                      className="size-icon-sm text-[#EF4444]"
                      weight="fill"
                    />
                    <span>
                      {t('modals.workspaceDrawer.failedMessages', {
                        defaultValue: 'Failed Messages',
                      })}
                    </span>
                    <span className="text-xs text-[#EF4444] font-normal">
                      ({failedMessages.length})
                    </span>
                  </span>
                  <CaretDownIcon
                    className={cn(
                      'size-3.5 text-low transition-transform duration-200',
                      isFailedMessagesExpanded && 'rotate-180'
                    )}
                    weight="bold"
                  />
                </button>
                {isFailedMessagesExpanded && (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {failedMessages.map((failedMsg) => (
                      <div
                        key={failedMsg.message.id}
                        className="chat-session-workspace-error-card rounded-sm border p-base space-y-half"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <XCircleIcon
                              className="size-icon-xs flex-shrink-0 text-error"
                              weight="fill"
                            />
                            <span className="text-xs font-medium truncate text-error">
                              {failedMsg.errorSummary}
                            </span>
                          </div>
                          <span className="text-[10px] text-low flex-shrink-0">
                            {formatDateShortWithTime(
                              failedMsg.message.created_at
                            )}
                          </span>
                        </div>
                        {failedMsg.errorDetail && (
                          <div className="chat-session-workspace-error-detail max-h-[60px] overflow-y-auto rounded px-2 py-1 break-all font-mono text-xs text-low">
                            {failedMsg.errorDetail.slice(0, 200)}
                            {failedMsg.errorDetail.length > 200 && '...'}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            className="chat-session-workspace-link"
                            onClick={() => setExpandedError(failedMsg)}
                          >
                            {t('modals.workspaceDrawer.viewDetails', {
                              defaultValue: 'View Details',
                            })}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-half">
              <div className="text-sm text-normal font-medium">
                {t('modals.workspaceDrawer.runHistory')}
              </div>
              {runs.length === 0 && (
                <div className="text-xs text-low">
                  {t('modals.workspaceDrawer.noRunsYet')}
                </div>
              )}
              {runs.map((run: RunHistoryItem) => (
                <div
                  key={run.runId}
                  className={cn(
                    'chat-session-workspace-run-card rounded-sm p-base space-y-half',
                    run.hasError
                      ? 'chat-session-workspace-error-card border'
                      : 'bg-[#e5e9f3]'
                  )}
                >
                  <div className="flex items-center justify-between text-xs text-low">
                    <span className="flex items-center gap-1.5">
                      {run.hasError && (
                        <XCircleIcon
                          className="size-icon-xs text-error"
                          weight="fill"
                        />
                      )}
                      <span>
                        {t('modals.workspaceDrawer.run')}{' '}
                        {run.runId.slice(0, 8)}
                      </span>
                    </span>
                    <span>{formatDateShortWithTime(run.createdAt)}</span>
                  </div>
                  {run.hasError && run.errorSummary && (
                    <div className="space-y-1">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 truncate text-xs font-medium text-error">
                          {run.errorSummary}
                        </div>
                        {run.errorType?.type && (
                          <span className="chat-session-workspace-error-badge shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                            {run.errorType.type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {run.errorContent &&
                        run.errorContent !== run.errorSummary && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-error hover:underline">
                              {t('modals.workspaceDrawer.viewDetails', {
                                defaultValue: 'View Details',
                              })}
                            </summary>
                            <pre className="chat-session-workspace-error-detail mt-1 max-h-[100px] overflow-auto rounded p-2 font-mono text-[10px] text-low whitespace-pre-wrap break-all select-text">
                              {run.errorContent}
                            </pre>
                          </details>
                        )}
                    </div>
                  )}
                  {!run.hasError && (
                    <div className="text-xs text-normal font-mono truncate">
                      {run.content}
                    </div>
                  )}
                  {(() => {
                    const retention = retentionByRunId?.get(run.runId);
                    const isPruned = retention?.logState === 'pruned';
                    const isTail = retention?.logState === 'tail';
                    const isTruncated = retention?.logTruncated;
                    const isDegraded = retention?.logCaptureDegraded;
                    const isArtifactStub = retention?.artifactState === 'stub';
                    const isArtifactPruned =
                      retention?.artifactState === 'pruned';
                    return (
                      <>
                        {(isTruncated ||
                          isDegraded ||
                          isArtifactStub ||
                          isArtifactPruned) && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {isTruncated && (
                              <span className="chat-session-workspace-error-badge rounded px-1.5 py-0.5 text-[10px]">
                                {t('modals.workspaceDrawer.logTruncated', {
                                  defaultValue: '日志已截断',
                                })}
                              </span>
                            )}
                            {isDegraded && (
                              <span className="chat-session-workspace-error-badge rounded px-1.5 py-0.5 text-[10px]">
                                {t(
                                  'modals.workspaceDrawer.logCaptureDegraded',
                                  {
                                    defaultValue: '采集降级',
                                  }
                                )}
                              </span>
                            )}
                            {isArtifactStub && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] bg-[#e5e9f3] text-low">
                                {t('modals.workspaceDrawer.artifactStub', {
                                  defaultValue: '仅摘要',
                                })}
                              </span>
                            )}
                            {isArtifactPruned && (
                              <span className="rounded px-1.5 py-0.5 text-[10px] bg-[#e5e9f3] text-low">
                                {t('modals.workspaceDrawer.artifactPruned', {
                                  defaultValue: '已清理',
                                })}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-3">
                            {isPruned ? (
                              <span
                                className="text-low cursor-default"
                                title={
                                  retention?.pruneReason ??
                                  t('modals.workspaceDrawer.logPruned', {
                                    defaultValue: '日志已清理',
                                  })
                                }
                              >
                                {t('modals.workspaceDrawer.logPruned', {
                                  defaultValue: '日志已清理',
                                })}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="chat-session-workspace-link"
                                onClick={() => onLoadLog(run.runId)}
                                title={
                                  isTail
                                    ? t('modals.workspaceDrawer.logTailOnly', {
                                        defaultValue: '仅保留尾部日志',
                                      })
                                    : undefined
                                }
                              >
                                {t('modals.workspaceDrawer.viewLog')}
                                {isTail && (
                                  <span className="ml-1 text-[10px] text-low">
                                    (
                                    {t('modals.workspaceDrawer.tail', {
                                      defaultValue: '尾部',
                                    })}
                                    )
                                  </span>
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              className="chat-session-workspace-link"
                              onClick={() => setExpandedRun(run)}
                            >
                              {t('members.expand')}
                            </button>
                          </div>
                          {logRunId === run.runId && (
                            <span className="text-low">
                              {t('modals.workspaceDrawer.selected')}
                            </span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>

            <div className="space-y-half">
              <div className="text-sm text-normal font-medium">
                {t('modals.workspaceDrawer.runLog')}
              </div>
              {!logRunId && (
                <div className="text-xs text-low">
                  {t('modals.workspaceDrawer.selectRunToViewLog')}
                </div>
              )}
              {logRunId && (
                <div className="chat-session-workspace-log-card rounded-sm p-base">
                  <div className="flex items-center justify-between text-xs text-low pb-half">
                    <span>
                      {t('modals.workspaceDrawer.run')} {logRunId.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      className="chat-session-workspace-link"
                      onClick={() => onLoadLog(logRunId)}
                      disabled={logLoading}
                    >
                      {t('modals.workspaceDrawer.refresh')}
                    </button>
                  </div>
                  {logLoading && (
                    <div className="text-xs text-low">
                      {t('modals.workspaceDrawer.loadingLog')}
                    </div>
                  )}
                  {logError && (
                    <div className="text-xs text-error">{logError}</div>
                  )}
                  {!logLoading && !logError && (
                    <div className="chat-session-workspace-log-body min-h-[320px] max-h-[420px] overflow-y-auto border-t pt-base select-text">
                      {logContent ? (
                        <RawLogText
                          content={logContent}
                          className="select-text"
                        />
                      ) : (
                        <div className="text-xs text-low">
                          {t('modals.workspaceDrawer.logEmpty')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog
        className="chat-session-modal-surface max-w-3xl"
        open={!!expandedRun}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedRun(null);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {expandedRun?.hasError && (
              <XCircleIcon className="size-5 text-error" weight="fill" />
            )}
            <span>
              {expandedRun
                ? `${t('modals.workspaceDrawer.run')} ${expandedRun.runId.slice(0, 8)}`
                : t('modals.workspaceDrawer.run')}
            </span>
            {expandedRun?.errorType?.type && (
              <span className="chat-session-workspace-error-badge ml-2 rounded px-2 py-0.5 text-xs font-medium">
                {expandedRun.errorType.type.replace(/_/g, ' ')}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <DialogContent className="select-text">
          <div className="space-y-4">
            {/* Error section */}
            {expandedRun?.hasError && expandedRun.errorSummary && (
              <div className="chat-session-workspace-error-panel rounded-sm border p-base">
                <div className="text-xs text-low mb-1">
                  {t('modals.workspaceDrawer.errorSummary', {
                    defaultValue: 'Error Summary',
                  })}
                </div>
                <div className="text-sm font-medium text-error">
                  {expandedRun.errorSummary}
                </div>
                {expandedRun.errorContent &&
                  expandedRun.errorContent !== expandedRun.errorSummary && (
                    <div className="mt-2">
                      <div className="text-xs text-low mb-1">
                        {t('modals.workspaceDrawer.fullErrorLog', {
                          defaultValue: 'Full Error Log',
                        })}
                      </div>
                      <pre className="chat-session-workspace-error-detail max-h-[200px] overflow-auto rounded p-2 text-xs font-mono text-low whitespace-pre-wrap break-all select-text">
                        {expandedRun.errorContent}
                      </pre>
                    </div>
                  )}
              </div>
            )}
            {/* Content section */}
            <div className="chat-session-workspace-content-panel max-h-[50vh] overflow-y-auto rounded-sm p-base select-text">
              <div className="text-xs text-normal font-mono whitespace-pre-wrap break-all select-text">
                {expandedRun?.content ?? ''}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Failed Message Details Dialog */}
      <Dialog
        className="chat-session-modal-surface max-w-3xl"
        open={!!expandedError}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedError(null);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircleIcon className="size-5 text-error" weight="fill" />
            <span>
              {t('modals.workspaceDrawer.errorDetails', {
                defaultValue: 'Error Details',
              })}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogContent className="select-text">
          <div className="space-y-4">
            {/* Error Summary */}
            <div className="chat-session-workspace-error-panel rounded-sm border p-base">
              <div className="text-xs text-low mb-1">
                {t('modals.workspaceDrawer.errorSummary', {
                  defaultValue: 'Error Summary',
                })}
              </div>
              <div className="text-sm font-medium text-error">
                {expandedError?.errorSummary}
              </div>
              {expandedError?.errorDetail && (
                <div className="mt-2 text-xs text-low select-text">
                  {expandedError.errorDetail}
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className="text-xs text-low">
              {t('modals.workspaceDrawer.occurredAt', {
                defaultValue: 'Occurred at',
              })}
              :{' '}
              {expandedError?.message?.created_at
                ? formatDateShortWithTime(expandedError.message.created_at)
                : '—'}
            </div>

            {/* Full Message Content */}
            <div>
              <div className="text-xs text-low mb-1">
                {t('modals.workspaceDrawer.messageContent', {
                  defaultValue: 'Message Content',
                })}
              </div>
              <div className="chat-session-workspace-content-panel max-h-[50vh] overflow-y-auto rounded-sm p-base select-text">
                <div className="text-xs text-normal font-mono whitespace-pre-wrap break-all select-text">
                  {expandedError?.message?.content ?? ''}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
