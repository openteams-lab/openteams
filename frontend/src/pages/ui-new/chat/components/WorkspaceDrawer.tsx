import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CaretRightIcon,
  FolderNotchOpenIcon,
  XIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ChatAgent } from 'shared/types';
import RawLogText from '@/components/common/RawLogText';
import { formatDateShortWithTime } from '@/utils/date';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RunHistoryItem } from '../types';

export interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  agent: ChatAgent | null;
  workspacePath: string | null;
  runs: RunHistoryItem[];
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
  logRunId,
  logContent,
  logLoading,
  logError,
  onLoadLog,
}: WorkspaceDrawerProps) {
  const { t } = useTranslation('chat');
  const [expandedRun, setExpandedRun] = useState<RunHistoryItem | null>(null);
  const workspaceSegments = workspacePath
    ? workspacePath
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
    : [];
  const condensedSegments =
    workspaceSegments.length > 5
      ? ['...', ...workspaceSegments.slice(-4)]
      : workspaceSegments;
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
            <div className="chat-session-workspace-drawer-eyebrow">
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
                <div className="chat-session-workspace-path-label">
                  <FolderNotchOpenIcon className="size-icon-xs" />
                  <span>{t('modals.workspaceDrawer.workspaceTrail')}</span>
                </div>
                <div className="chat-session-workspace-breadcrumbs">
                  {condensedSegments.map((segment, index) => (
                    <div
                      key={`${segment}-${index}`}
                      className="chat-session-workspace-breadcrumb-segment"
                    >
                      {index > 0 && (
                        <CaretRightIcon className="chat-session-workspace-breadcrumb-separator" />
                      )}
                      <span>{segment}</span>
                    </div>
                  ))}
                </div>
                <div className="chat-session-workspace-path-raw">
                  {workspacePath}
                </div>
              </div>
            )}
          </div>

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
    </>
  );
}
