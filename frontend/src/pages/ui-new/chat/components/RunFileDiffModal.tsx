import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowSquareUpRightIcon } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DiffViewBody } from '@/components/ui-new/primitives/conversation/PierreConversationDiff';
import { useTheme } from '@/components/ThemeProvider';
import { chatApi, fileSystemApi } from '@/lib/api';
import { getActualTheme } from '@/utils/theme';
import { findRunDiffFile, getRelativeWorkspaceFilePath } from '../utils';
import type { DiffFileEntry } from '../types';

const MAX_INLINE_FILE_PATCH_CHARS = 300_000;

interface RunFileDiffModalState {
  loading: boolean;
  error: string | null;
  fileDiff: DiffFileEntry | null;
}

export interface RunFileDiffModalProps {
  runId: string;
  filePath: string;
  workspacePath: string;
  isOpen: boolean;
  onClose: () => void;
}

export function RunFileDiffModal({
  runId,
  filePath,
  workspacePath,
  isOpen,
  onClose,
}: RunFileDiffModalProps) {
  const { t } = useTranslation('chat');
  const { theme } = useTheme();
  const actualTheme = getActualTheme(theme);
  const [state, setState] = useState<RunFileDiffModalState>({
    loading: false,
    error: null,
    fileDiff: null,
  });
  const [openError, setOpenError] = useState<string | null>(null);
  const displayPath = useMemo(
    () => getRelativeWorkspaceFilePath(filePath, workspacePath) || filePath,
    [filePath, workspacePath]
  );

  useEffect(() => {
    if (!isOpen) {
      setState({ loading: false, error: null, fileDiff: null });
      setOpenError(null);
      return;
    }

    let cancelled = false;

    setState({ loading: true, error: null, fileDiff: null });
    setOpenError(null);

    void chatApi
      .getRunDiff(runId)
      .then((patch) => {
        if (cancelled) return;
        const fileDiff = findRunDiffFile(patch, filePath, workspacePath);
        setState({
          loading: false,
          error: fileDiff
            ? null
            : t('modals.runFileDiff.fileNotFound', {
                defaultValue: '未找到该文件在本次运行中的 diff。',
              }),
          fileDiff,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to load run file diff', error);
        setState({
          loading: false,
          error: t('modals.runFileDiff.loadError', {
            defaultValue: '无法加载该文件的运行 diff。',
          }),
          fileDiff: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, isOpen, runId, t, workspacePath]);

  const handleOpenWorkspace = async () => {
    setOpenError(null);

    try {
      const result = await fileSystemApi.openInExplorer(workspacePath);
      if (!result.ok) {
        setOpenError(
          result.error ||
            t('modals.runFileDiff.openWorkspaceError', {
              defaultValue: '无法打开工作区目录。',
            })
        );
      }
    } catch (error) {
      console.warn('Failed to open workspace in explorer', error);
      setOpenError(
        t('modals.runFileDiff.openWorkspaceError', {
          defaultValue: '无法打开工作区目录。',
        })
      );
    }
  };

  if (!isOpen) return null;

  const fileDiffTooLarge =
    !!state.fileDiff &&
    state.fileDiff.patch.length > MAX_INLINE_FILE_PATCH_CHARS;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      className="chat-session-modal-surface max-w-6xl p-0 overflow-hidden"
    >
      <DialogHeader className="border-b border-border px-base py-base">
        <DialogTitle className="flex items-center justify-between gap-base text-left">
          <div className="min-w-0">
            <div className="text-sm font-medium text-normal truncate">
              {displayPath}
            </div>
            <div className="text-xs font-normal text-low">
              {t('modals.diffViewer.run')} {runId.slice(0, 8)}
            </div>
          </div>
        </DialogTitle>
      </DialogHeader>
      <DialogContent className="max-h-[80vh] min-h-[240px] overflow-y-auto px-base py-base">
        <div className="space-y-base">
          {state.loading && (
            <div className="text-xs text-low">
              {t('modals.diffViewer.loadingDiff')}
            </div>
          )}

          {!state.loading && state.error && (
            <div className="text-xs text-error">{state.error}</div>
          )}

          {!state.loading &&
            !state.error &&
            state.fileDiff &&
            fileDiffTooLarge && (
              <div className="space-y-3 rounded-sm border border-border bg-panel p-base">
                <div className="text-xs text-low">
                  {t('modals.runFileDiff.tooLarge', {
                    defaultValue:
                      '该文件 diff 超过 300,000 字符，已降级为提示展示。你可以打开工作区目录继续查看。',
                  })}
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
                  onClick={handleOpenWorkspace}
                >
                  <ArrowSquareUpRightIcon className="size-icon-sm" />
                  <span>
                    {t('modals.runFileDiff.openWorkspace', {
                      defaultValue: '在文件管理器中打开',
                    })}
                  </span>
                </button>
              </div>
            )}

          {!state.loading &&
            !state.error &&
            state.fileDiff &&
            !fileDiffTooLarge && (
              <div className="rounded-sm border border-border overflow-hidden">
                <DiffViewBody
                  fileDiffMetadata={null}
                  unifiedDiff={state.fileDiff.patch}
                  isValid={state.fileDiff.patch.trim().length > 0}
                  hideLineNumbers={false}
                  theme={actualTheme}
                  wrapText={false}
                  modeOverride="split"
                />
              </div>
            )}

          {openError && <div className="text-xs text-error">{openError}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
