import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsOutSimpleIcon,
  ArrowsInSimpleIcon,
  XIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DiffViewBody } from '@/components/ui-new/primitives/conversation/PierreConversationDiff';
import { chatApi } from '@/lib/api';
import type { RunDiffState, UntrackedFileState } from '../types';

export interface DiffViewerModalProps {
  isOpen: boolean;
  runId: string | null;
  hasDiff: boolean;
  isFullscreen: boolean;
  runDiff: RunDiffState | null;
  untrackedFiles: string[];
  untrackedContent: Record<string, UntrackedFileState>;
  theme: 'light' | 'dark';
  onClose: () => void;
  onToggleFullscreen: () => void;
  onToggleUntracked: (runId: string, path: string) => void;
}

const MAX_INLINE_FILE_PATCH_CHARS = 300_000;

export function DiffViewerModal({
  isOpen,
  runId,
  hasDiff,
  isFullscreen,
  runDiff,
  untrackedFiles,
  untrackedContent,
  theme,
  onClose,
  onToggleFullscreen,
  onToggleUntracked,
}: DiffViewerModalProps) {
  const { t } = useTranslation('chat');
  const [expandedFileKey, setExpandedFileKey] = useState<string | null>(null);

  useEffect(() => {
    setExpandedFileKey(null);
  }, [runId, isOpen]);

  if (!isOpen || !runId) return null;

  const DiffViewerIcon = isFullscreen
    ? ArrowsInSimpleIcon
    : ArrowsOutSimpleIcon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={cn(
          'chat-session-modal-surface border border-border shadow-xl flex flex-col overflow-hidden',
          isFullscreen
            ? 'w-full h-full rounded-none'
            : 'w-[92vw] h-[85vh] max-w-[1200px] rounded-xl'
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-base py-half">
          <div>
            <div className="text-sm text-normal font-medium">
              {t('modals.diffViewer.title')}
            </div>
            <div className="text-xs text-low">
              {t('modals.diffViewer.run')} {runId.slice(0, 8)}
            </div>
          </div>
          <div className="flex items-center gap-half">
            <button
              type="button"
              className="text-low hover:text-normal"
              onClick={onToggleFullscreen}
              aria-label={
                isFullscreen
                  ? t('modals.diffViewer.exitFullScreen')
                  : t('modals.diffViewer.fullScreen')
              }
            >
              <DiffViewerIcon className="size-icon-sm" />
            </button>
            <button
              type="button"
              className="text-low hover:text-normal"
              onClick={onClose}
              aria-label={t('modals.diffViewer.closeDiffViewer')}
            >
              <XIcon className="size-icon-sm" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-base space-y-base">
          {hasDiff ? (
            <>
              {runDiff?.loading && (
                <div className="text-xs text-low">
                  {t('modals.diffViewer.loadingDiff')}
                </div>
              )}
              {runDiff?.error && (
                <div className="text-xs text-error">{runDiff.error}</div>
              )}
              {!runDiff?.loading &&
                !runDiff?.error &&
                runDiff?.files?.length === 0 && (
                  <div className="text-xs text-low">
                    {t('modals.diffViewer.noTrackedDiff')}
                  </div>
                )}
              {runDiff?.files?.map((file, index) => {
                const fileKey = `${runId}:${index}:${file.path}`;
                const isExpanded = expandedFileKey === fileKey;

                return (
                  <div
                    key={fileKey}
                    className="border border-border rounded-sm bg-panel"
                  >
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-base px-base py-half text-xs text-normal border-b border-border"
                      onClick={() =>
                        setExpandedFileKey((prev) =>
                          prev === fileKey ? null : fileKey
                        )
                      }
                    >
                      <span className="font-ibm-plex-mono break-all text-left">
                        {file.path}
                      </span>
                      <span className="flex items-center gap-half shrink-0">
                        <span className="text-xs text-low">
                          {file.additions > 0 && (
                            <span className="text-success">
                              +{file.additions}
                            </span>
                          )}
                          {file.additions > 0 && file.deletions > 0 && ' '}
                          {file.deletions > 0 && (
                            <span className="text-error">
                              -{file.deletions}
                            </span>
                          )}
                        </span>
                        <CaretDownIcon
                          className={cn(
                            'size-icon-sm text-low transition-transform',
                            isExpanded ? 'rotate-180' : ''
                          )}
                        />
                      </span>
                    </button>
                    {isExpanded &&
                      (file.patch.length > MAX_INLINE_FILE_PATCH_CHARS ? (
                        <div className="px-base py-half text-xs text-low">
                          File diff too large to render inline. Open raw diff
                          instead.
                        </div>
                      ) : (
                        <DiffViewBody
                          fileDiffMetadata={null}
                          unifiedDiff={file.patch}
                          isValid={file.patch.trim().length > 0}
                          hideLineNumbers={false}
                          theme={theme}
                          wrapText={false}
                          modeOverride="split"
                        />
                      ))}
                  </div>
                );
              })}
              <div>
                <button
                  type="button"
                  className="text-brand hover:text-brand-hover text-xs"
                  onClick={() =>
                    window.open(
                      chatApi.getRunDiffUrl(runId),
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                >
                  {t('modals.diffViewer.openRawDiff')}
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-low">
              {t('modals.diffViewer.noTrackedDiff')}
            </div>
          )}
          {untrackedFiles.length > 0 && (
            <div className="space-y-half">
              <div className="text-xs text-low">
                {t('modals.diffViewer.untrackedFiles')}
              </div>
              {untrackedFiles.map((path) => {
                const key = `${runId}:${path}`;
                const entry = untrackedContent[key];
                return (
                  <div
                    key={key}
                    className="border border-border rounded-sm bg-panel px-base py-half"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-ibm-plex-mono break-all">
                        {path}
                      </span>
                      <button
                        type="button"
                        className="text-brand hover:text-brand-hover"
                        onClick={() => onToggleUntracked(runId, path)}
                      >
                        {entry?.open
                          ? t('modals.diffViewer.hide')
                          : t('modals.diffViewer.view')}
                      </button>
                    </div>
                    {entry?.open && (
                      <div className="mt-half">
                        {entry.loading && (
                          <div className="text-xs text-low">
                            {t('modals.diffViewer.loadingFile')}
                          </div>
                        )}
                        {entry.error && (
                          <div className="text-xs text-error">
                            {entry.error}
                          </div>
                        )}
                        {!entry.loading && !entry.error && entry.content && (
                          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs font-ibm-plex-mono text-normal">
                            {entry.content}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
