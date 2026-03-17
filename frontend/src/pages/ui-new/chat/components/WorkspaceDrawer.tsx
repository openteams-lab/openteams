import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CaretDownIcon,
  FolderNotchOpenIcon,
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
import type { RunHistoryItem } from '../types';
import {
  detectApiError,
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
  workspacePath,
  runs,
  messages,
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
      if (
        message.sender_type === 'agent' &&
        message.sender_id === agent.id
      ) {
        const apiError = detectApiError(message.content);
        if (apiError) {
          failed.push({
            message,
            errorType: 'api',
            errorSummary: apiError.message,
            errorDetail: apiError.provider
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
        const mentionFailure = extractMentionFailureMeta(message.meta, agent.name);
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
          'chat-session-workspace-drawer absolute top-0 right-0 h-full w-[440px] max-w-full border-l border-border shadow-lg transition-transform z-50 flex flex-col',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="chat-session-workspace-drawer-header px-base py-base border-b border-border shrink-0 flex items-center justify-between">
          <div className="min-w-0">
            <div className="chat-session-workspace-drawer-eyebrow text-[#5094FB]">
              {t('modals.workspaceDrawer.workspaceTrail')}
            </div>
            <div className="text-sm text-normal font-medium truncate">
              {agent?.name ?? t('modals.workspaceDrawer.agentWorkspace')}
            </div>
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
          <div className="space-y-half">
            <div className="text-xs text-low">
              {t('modals.workspaceDrawer.workspacePathCreatedOnFirstRun')}
            </div>
            {workspacePath && (
              <div
                className="chat-session-workspace-path-card"
                title={workspacePath}
              >
                <div className="chat-session-workspace-path-label text-[#5094FB]">
                  <FolderNotchOpenIcon className="size-icon-xs" />
                  <span>{t('modals.workspaceDrawer.workspacePath')}</span>
                </div>
                <div className="chat-session-workspace-path-raw">
                  {workspacePath}
                </div>
              </div>
            )}
          </div>

          {/* Failed Messages Section */}
          {failedMessages.length > 0 && (
            <div className="space-y-half">
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium text-normal hover:text-[#4084EB] transition-colors"
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
                      className="rounded-sm p-base space-y-half bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <XCircleIcon
                            className="size-icon-xs text-[#EF4444] flex-shrink-0"
                            weight="fill"
                          />
                          <span className="text-xs text-[#EF4444] font-medium truncate">
                            {failedMsg.errorSummary}
                          </span>
                        </div>
                        <span className="text-[10px] text-low flex-shrink-0">
                          {formatDateShortWithTime(failedMsg.message.created_at)}
                        </span>
                      </div>
                      {failedMsg.errorDetail && (
                        <div className="text-xs text-low font-mono bg-[rgba(239,68,68,0.04)] rounded px-2 py-1 break-all max-h-[60px] overflow-y-auto">
                          {failedMsg.errorDetail.slice(0, 200)}
                          {failedMsg.errorDetail.length > 200 && '...'}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          className="text-[#5094FB] hover:text-[#4084EB]"
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
                className="chat-session-workspace-run-card rounded-sm p-base space-y-half bg-[#e5e9f3]"
              >
                <div className="flex items-center justify-between text-xs text-low">
                  <span>
                    {t('modals.workspaceDrawer.run')} {run.runId.slice(0, 8)}
                  </span>
                  <span>{formatDateShortWithTime(run.createdAt)}</span>
                </div>
                <div className="text-xs text-normal font-mono truncate">
                  {run.content}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-[#5094FB] hover:text-[#4084EB]"
                      onClick={() => onLoadLog(run.runId)}
                    >
                      {t('modals.workspaceDrawer.viewLog')}
                    </button>
                    <button
                      type="button"
                      className="text-[#5094FB] hover:text-[#4084EB]"
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
              <div className="chat-session-workspace-log-card rounded-sm bg-[#ecedf1] p-base">
                <div className="flex items-center justify-between text-xs text-low pb-half">
                  <span>
                    {t('modals.workspaceDrawer.run')} {logRunId.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className="text-[#5094FB] hover:text-[#4084EB]"
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
                  <div className="chat-session-workspace-log-body min-h-[320px] max-h-[420px] overflow-y-auto border-t border-[#d8dce6] bg-[#ecedf1] pt-base">
                    {logContent ? (
                      <RawLogText content={logContent} />
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
          <DialogTitle>
            {expandedRun
              ? `${t('modals.workspaceDrawer.run')} ${expandedRun.runId.slice(0, 8)}`
              : t('modals.workspaceDrawer.run')}
          </DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="max-h-[70vh] overflow-y-auto rounded-sm bg-[#ecedf1] p-base">
            <div className="text-xs text-normal font-mono whitespace-pre-wrap break-all">
              {expandedRun?.content ?? ''}
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
            <XCircleIcon className="size-5 text-[#EF4444]" weight="fill" />
            <span>
              {t('modals.workspaceDrawer.errorDetails', {
                defaultValue: 'Error Details',
              })}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            {/* Error Summary */}
            <div className="rounded-sm bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] p-base">
              <div className="text-xs text-low mb-1">
                {t('modals.workspaceDrawer.errorSummary', {
                  defaultValue: 'Error Summary',
                })}
              </div>
              <div className="text-sm text-[#EF4444] font-medium">
                {expandedError?.errorSummary}
              </div>
              {expandedError?.errorDetail && (
                <div className="mt-2 text-xs text-low">
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
              <div className="max-h-[50vh] overflow-y-auto rounded-sm bg-[#ecedf1] p-base">
                <div className="text-xs text-normal font-mono whitespace-pre-wrap break-all">
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
