import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { FolderSimpleIcon, SpinnerIcon } from '@phosphor-icons/react';
import { chatApi } from '@/lib/api';
import { defineModal } from '@/lib/modals';
import { FolderPickerDialog } from '@/components/dialogs/shared/FolderPickerDialog';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatSession } from 'shared/types';

export interface CreateSessionDialogProps {
  existingSessions: ChatSession[];
}

export type CreateSessionResult = {
  title?: string;
  workspace_path?: string;
};

const fieldClassName =
  'h-11 rounded-[14px] border border-[#DCE4EF] bg-[#F9FBFF] px-4 text-[14px] text-[#223044] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-[#94A0B2] focus-visible:border-[#4A90E2] focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#4A90E2]/12';

const CreateSessionDialogImpl = NiceModal.create<CreateSessionDialogProps>(
  ({ existingSessions }) => {
    const modal = useModal();
    const { t } = useTranslation('common');
    const [title, setTitle] = useState('');
    const [workspacePath, setWorkspacePath] = useState('');
    const [validationError, setValidationError] = useState('');
    const [isValidating, setIsValidating] = useState(false);

    const workspaceHistory = useMemo(() => {
      const paths = existingSessions
        .map((s) => s.default_workspace_path)
        .filter((p): p is string => !!p);
      return Array.from(new Set(paths));
    }, [existingSessions]);

    useEffect(() => {
      if (!workspacePath.trim()) {
        setValidationError('');
        return;
      }

      const timer = setTimeout(async () => {
        setIsValidating(true);
        try {
          const result = await chatApi.validateWorkspacePath(workspacePath);
          setValidationError(
            result.valid
              ? ''
              : (result.error ?? t('session.invalidPath', 'Invalid path'))
          );
        } catch {
          setValidationError(
            t('session.validationFailed', 'Validation failed')
          );
        } finally {
          setIsValidating(false);
        }
      }, 500);

      return () => clearTimeout(timer);
    }, [workspacePath]);

    const handleBrowse = async () => {
      const selected = await FolderPickerDialog.show({
        value: workspacePath,
        title: t('session.selectWorkspace', 'Select Workspace'),
        description: t(
          'session.selectWorkspaceDescription',
          'Choose a default workspace folder for this session'
        ),
      });
      if (selected) {
        setWorkspacePath(selected);
      }
    };

    const handleCreate = () => {
      if (validationError || isValidating) return;

      modal.resolve({
        title: title.trim() || undefined,
        workspace_path: workspacePath.trim() || undefined,
      } satisfies CreateSessionResult);
      modal.hide();
    };

    const handleCancel = () => {
      modal.resolve(null);
      modal.hide();
    };

    return (
      <ConfirmationDialogChrome
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) {
            handleCancel();
          }
        }}
        onClose={handleCancel}
        title={t('session.createNew', 'New Session')}
        message={t(
          'session.createNewDescription',
          'Start a fresh conversation and optionally attach a default workspace.'
        )}
        tone="info"
        closeLabel={t('buttons.close', 'Close')}
        className="!max-w-[560px] !border-[#DCE4EF] !bg-[linear-gradient(180deg,#FFFFFF_0%,#F6F9FC_100%)] !shadow-[0_24px_64px_rgba(15,23,42,0.14)]"
        bodyExtra={
          <div className="space-y-4">
            <div className="rounded-[18px] border border-white/70 bg-[rgba(247,250,252,0.9)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label
                  htmlFor="create-session-title"
                  className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#7A8699]"
                >
                  {t('session.title', 'Title')}
                </Label>
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A0A9B8]">
                  {t('session.optional', 'Optional')}
                </span>
              </div>
              <Input
                id="create-session-title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('session.titlePlaceholder', 'Optional title…')}
                className={fieldClassName}
              />
            </div>

            <div className="rounded-[18px] border border-[#E4EBF3] bg-white/90 p-4 shadow-[0_10px_30px_rgba(148,163,184,0.08)]">
              <div className="mb-2 space-y-1">
                <Label
                  htmlFor="create-session-workspace"
                  className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#7A8699]"
                >
                  {t('session.workspacePath', 'Default Workspace')}
                </Label>
                <p className="text-sm leading-6 text-[#6B778C]">
                  {t(
                    'session.workspacePathHelp',
                    'Set a starting folder so the team opens with the right project context.'
                  )}
                </p>
              </div>

              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Input
                    id="create-session-workspace"
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    placeholder={t(
                      'session.workspacePathPlaceholder',
                      '/path/to/project'
                    )}
                    list="create-session-workspace-history"
                    className={cn(
                      fieldClassName,
                      'pr-10 font-mono text-[13px]'
                    )}
                  />
                  <datalist id="create-session-workspace-history">
                    {workspaceHistory.map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                  {isValidating && (
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#7A8699]">
                      <SpinnerIcon className="h-4 w-4 animate-spin" />
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleBrowse}
                  className="h-11 w-11 rounded-[14px] border-[#DCE4EF] bg-white text-[#4A5A70] hover:bg-[#F2F6FB] hover:text-[#223044]"
                  title={t('session.browse', 'Browse')}
                >
                  <FolderSimpleIcon className="h-4 w-4" weight="fill" />
                </Button>
              </div>
            </div>

            {validationError && (
              <Alert
                variant="destructive"
                className="rounded-[16px] border border-[#F2D5D8] bg-[#FFF7F8] px-4 py-3 text-[#C25B63] [&>svg]:hidden [&>svg~*]:pl-0"
              >
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>
        }
        footer={
          <>
            <button
              type="button"
              onClick={handleCancel}
              className={getConfirmationButtonClasses('info', 'cancel')}
            >
              {t('buttons.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              onClick={handleCreate}
              disabled={!!validationError || isValidating}
              className={getConfirmationButtonClasses('info', 'confirm')}
            >
              {t('session.create', 'Create')}
            </button>
          </>
        }
      />
    );
  }
);

export const CreateSessionDialog = defineModal<
  CreateSessionDialogProps,
  CreateSessionResult | null
>(CreateSessionDialogImpl);
