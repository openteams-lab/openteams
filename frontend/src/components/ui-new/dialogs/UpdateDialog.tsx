import { useEffect, useMemo, useRef, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import {
  ArrowCircleUpIcon,
  ArrowClockwiseIcon,
  SpinnerIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { defineModal, getErrorMessage, type NoProps } from '@/lib/modals';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { cn } from '@/lib/utils';

type UpdateDialogStage = 'available' | 'updating' | 'restart';
type TauriUpdaterStatus = 'PENDING' | 'ERROR' | 'DONE' | 'UPTODATE';

const UpdateDialogImpl = NiceModal.create<NoProps>(() => {
  const modal = useModal();
  const { t } = useTranslation(['chat', 'common']);
  const {
    canSelfUpdate,
    checkNow,
    currentVersion,
    hasUpdate,
    isChecking,
    isNpx,
    isRestarting,
    isTauri,
    latestVersion,
    publishedAt,
    releaseNotes,
    releaseUrl,
    restartApp,
    updateNpx,
  } = useVersionCheck();
  const [stage, setStage] = useState<UpdateDialogStage>('available');
  const [actionError, setActionError] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const unlistenRef = useRef<null | (() => void)>(null);

  const isUpdating = stage === 'updating';
  const isBusy = isUpdating || isRestarting;
  const normalizedCurrentVersion = currentVersion.startsWith('v')
    ? currentVersion
    : `v${currentVersion}`;
  const normalizedLatestVersion =
    latestVersion && latestVersion.startsWith('v')
      ? latestVersion
      : latestVersion
        ? `v${latestVersion}`
        : null;

  const releaseNotesPreview = useMemo(() => {
    const trimmed = releaseNotes?.trim();
    if (!trimmed) return null;
    return trimmed;
  }, [releaseNotes]);

  const publishedAtLabel = useMemo(() => {
    if (!publishedAt) return null;
    const value = new Date(publishedAt);
    if (Number.isNaN(value.getTime())) return null;

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  }, [publishedAt]);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!modal.visible) return;
    checkNow();
  }, [checkNow, modal.visible]);

  const closeDialog = () => {
    if (isBusy) return;
    modal.resolve();
    modal.hide();
    modal.remove();
  };

  const resetProgressState = () => {
    setProgressValue(0);
    setStatusMessage('');
  };

  const handleTauriUpdate = async () => {
    setActionError(null);
    setStage('updating');
    setProgressValue(18);
    setStatusMessage(t('versionUpdate.status.checking'));

    try {
      const { checkUpdate, installUpdate, onUpdaterEvent } =
        await import('@tauri-apps/api/updater');

      unlistenRef.current?.();
      unlistenRef.current = await onUpdaterEvent(({ error, status }) => {
        const nextStatus = status as TauriUpdaterStatus;

        if (nextStatus === 'PENDING') {
          setProgressValue(72);
          setStatusMessage(t('versionUpdate.status.downloading'));
          return;
        }

        if (nextStatus === 'DONE') {
          setProgressValue(100);
          setStatusMessage(t('versionUpdate.status.ready'));
          return;
        }

        if (nextStatus === 'UPTODATE') {
          setProgressValue(100);
          setStatusMessage(t('versionUpdate.status.upToDate'));
          return;
        }

        if (nextStatus === 'ERROR') {
          setActionError(error || t('versionUpdate.status.error'));
        }
      });

      const update = await checkUpdate();
      if (!update.shouldUpdate) {
        setStage('available');
        setProgressValue(100);
        setStatusMessage(t('versionUpdate.status.upToDate'));
        return;
      }

      setProgressValue(36);
      setStatusMessage(t('versionUpdate.status.preparing'));

      await installUpdate();
      setStage('restart');
    } catch (error) {
      setStage('available');
      resetProgressState();
      setActionError(getErrorMessage(error));
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  const handleNpxUpdate = async () => {
    setActionError(null);
    setStage('updating');
    setProgressValue(56);
    setStatusMessage(t('versionUpdate.status.packageUpdating'));

    try {
      const result = await updateNpx();
      setProgressValue(100);
      setStatusMessage(result.message || t('versionUpdate.status.ready'));
      setStage('restart');
      await checkNow();
    } catch (error) {
      setStage('available');
      resetProgressState();
      setActionError(getErrorMessage(error));
    }
  };

  const handleUpdate = async () => {
    if (isBusy) return;
    if (!canSelfUpdate) return;

    if (isTauri) {
      await handleTauriUpdate();
      return;
    }

    await handleNpxUpdate();
  };

  const handleRestart = async () => {
    setActionError(null);
    try {
      await restartApp();
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleOpenRelease = async () => {
    if (!releaseUrl) return;

    setActionError(null);

    try {
      if (isTauri) {
        const { open } = await import('@tauri-apps/api/shell');
        await open(releaseUrl);
        return;
      }

      window.open(releaseUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const title =
    stage === 'restart'
      ? t('versionUpdate.restartTitle')
      : t('versionUpdate.title', {
          version: normalizedLatestVersion ?? normalizedCurrentVersion,
        });

  const message =
    stage === 'restart'
      ? t('versionUpdate.restartMessage', {
          runtime: isTauri
            ? t('versionUpdate.runtime.desktop')
            : t('versionUpdate.runtime.service'),
        })
      : t('versionUpdate.message');

  return (
    <ConfirmationDialogChrome
      open={modal.visible}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
      onClose={closeDialog}
      title={title}
      message={message}
      tone={stage === 'restart' ? 'success' : 'info'}
      closeLabel={t('common:buttons.close')}
      bodyExtra={
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-[#E4EBF3] bg-[#F7FAFD] p-4 dark:border-[#2A3445] dark:bg-[#141C28]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                {t('versionUpdate.currentVersion')}
              </div>
              <div className="mt-2 text-[18px] font-semibold text-[#223044] dark:text-[#F3F6FB]">
                {normalizedCurrentVersion}
              </div>
            </div>
            <div className="rounded-[16px] border border-[#DDEFD1] bg-[#F5FBF0] p-4 dark:border-[rgba(52,211,153,0.24)] dark:bg-[rgba(34,197,94,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6E8A58] dark:text-[#86EFAC]">
                  {t('versionUpdate.latestVersion')}
                </div>
                <span className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#4A5A70] dark:bg-[#111926] dark:text-[#BAC4D6]">
                  {isTauri ? 'Tauri' : 'npx'}
                </span>
              </div>
              <div className="mt-2 text-[18px] font-semibold text-[#223044] dark:text-[#F3F6FB]">
                {normalizedLatestVersion ?? t('versionUpdate.unknownVersion')}
              </div>
              {publishedAtLabel && (
                <div className="mt-1 text-xs text-[#6B778C] dark:text-[#BAC4D6]">
                  {t('versionUpdate.publishedAt', {
                    date: publishedAtLabel,
                  })}
                </div>
              )}
            </div>
          </div>

          {((isUpdating && statusMessage) || actionError) && (
            <div
              className={cn(
                'rounded-[16px] border px-4 py-3',
                actionError
                  ? 'border-[#F2D5D8] bg-[#FFF7F8] dark:border-[rgba(248,113,113,0.28)] dark:bg-[rgba(248,113,113,0.12)]'
                  : 'border-[#DCE4EF] bg-[#F8FBFF] dark:border-[#2A3445] dark:bg-[#141C28]'
              )}
            >
              {statusMessage && (
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#223044] dark:text-[#F3F6FB]">
                  {isUpdating && (
                    <SpinnerIcon
                      className="h-4 w-4 animate-spin text-[#4A90E2] dark:text-[#7DB6FF]"
                      weight="bold"
                    />
                  )}
                  <span>{statusMessage}</span>
                </div>
              )}

              {isUpdating && (
                <div className="overflow-hidden rounded-full bg-[#E5EDF7] dark:bg-[#1A2433]">
                  <div
                    className={cn(
                      'h-2 rounded-full bg-[#4A90E2] transition-[width] duration-300 ease-out dark:bg-[#5EA2FF]',
                      isNpx && 'animate-pulse'
                    )}
                    style={{ width: `${Math.max(progressValue, 14)}%` }}
                  />
                </div>
              )}

              {actionError && (
                <div className="text-sm leading-6 text-[#C25B63] dark:text-[#FCA5A5]">
                  {actionError}
                </div>
              )}
            </div>
          )}

          {!canSelfUpdate && stage !== 'restart' && !isChecking && (
            <div className="rounded-[16px] border border-[#DCE4EF] bg-[#F8FBFF] px-4 py-3 text-sm text-[#4A5A70] dark:border-[#2A3445] dark:bg-[#141C28] dark:text-[#BAC4D6]">
              {t('versionUpdate.unsupported')}
            </div>
          )}

          {!hasUpdate &&
            canSelfUpdate &&
            stage !== 'restart' &&
            !isChecking && (
              <div className="rounded-[16px] border border-[#DCE4EF] bg-[#F8FBFF] px-4 py-3 text-sm text-[#4A5A70] dark:border-[#2A3445] dark:bg-[#141C28] dark:text-[#BAC4D6]">
                {t('versionUpdate.noUpdate')}
              </div>
            )}

          {releaseNotesPreview && (
            <div className="rounded-[16px] border border-[#E4EBF3] bg-white p-4 dark:border-[#2A3445] dark:bg-[#141C28]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                  {t('versionUpdate.releaseNotes')}
                </div>
                {releaseUrl && (
                  <button
                    type="button"
                    onClick={handleOpenRelease}
                    className="text-xs font-medium text-[#4A90E2] hover:text-[#2E6FB7] dark:text-[#7DB6FF] dark:hover:text-[#CFE3FF]"
                  >
                    {t('versionUpdate.openRelease')}
                  </button>
                )}
              </div>
              <div className="max-h-[180px] overflow-auto rounded-[12px] border border-[#EAF0F6] bg-[#F8FBFF] p-3 dark:border-[#2A3445] dark:bg-[#111926]">
                <ChatMarkdown
                  content={releaseNotesPreview}
                  hideCopyButton
                  maxWidth="100%"
                  textClassName="text-sm text-[#5D6B7E] dark:text-[#BAC4D6]"
                />
              </div>
            </div>
          )}
        </div>
      }
      footer={
        stage === 'restart' ? (
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={isRestarting}
              className={getConfirmationButtonClasses('success', 'cancel')}
            >
              {t('versionUpdate.restartLater')}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={isRestarting}
              className={cn(
                getConfirmationButtonClasses('success', 'confirm'),
                'inline-flex items-center gap-2'
              )}
            >
              {isRestarting ? (
                <SpinnerIcon className="h-4 w-4 animate-spin" weight="bold" />
              ) : (
                <ArrowClockwiseIcon className="h-4 w-4" weight="bold" />
              )}
              {t('versionUpdate.restartNow')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={isBusy}
              className={getConfirmationButtonClasses('info', 'cancel')}
            >
              {t('common:buttons.cancel')}
            </button>
            <button
              type="button"
              onClick={handleUpdate}
              disabled={!hasUpdate || !canSelfUpdate || isBusy}
              className={cn(
                getConfirmationButtonClasses('info', 'confirm'),
                'inline-flex items-center gap-2'
              )}
            >
              {isUpdating ? (
                <SpinnerIcon className="h-4 w-4 animate-spin" weight="bold" />
              ) : (
                <ArrowCircleUpIcon className="h-4 w-4" weight="bold" />
              )}
              {isTauri
                ? t('versionUpdate.actions.desktop')
                : isNpx
                  ? t('versionUpdate.actions.npx')
                  : t('versionUpdate.actions.unavailable')}
            </button>
          </>
        )
      }
    />
  );
});

export const UpdateDialog = defineModal<void, void>(UpdateDialogImpl);
