import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { FolderIcon } from '@phosphor-icons/react';
import { chatApi } from '@/lib/api';
import { defineModal } from '@/lib/modals';
import { FolderPickerDialog } from '@/components/dialogs/shared/FolderPickerDialog';
import type { ChatSession } from 'shared/types';

export interface CreateSessionDialogProps {
  existingSessions: ChatSession[];
}

export type CreateSessionResult = {
  title?: string;
  workspace_path?: string;
};

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
          setValidationError(result.valid ? '' : (result.error ?? 'Invalid path'));
        } catch {
          setValidationError('Validation failed');
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCreate();
      if (e.key === 'Escape') modal.hide();
    };

    if (!modal.visible) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onKeyDown={handleKeyDown}
      >
        <div className="bg-primary border rounded w-[480px] p-base space-y-base shadow-xl">
          <h2 className="text-base text-high font-medium">
            {t('session.createNew', 'New Session')}
          </h2>

          <div className="space-y-half">
            <label className="text-xs text-normal">
              {t('session.title', 'Title')}
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('session.titlePlaceholder', 'Optional title…')}
              className="w-full px-base py-half bg-secondary border rounded text-sm text-normal placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <div className="space-y-half">
            <label className="text-xs text-normal">
              {t('session.workspacePath', 'Default Workspace')}
            </label>
            <div className="flex gap-half">
              <div className="flex-1 relative">
                <input
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder={t(
                    'session.workspacePathPlaceholder',
                    '/path/to/project'
                  )}
                  list="create-session-workspace-history"
                  className="w-full px-base py-half bg-secondary border rounded text-sm text-normal placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <datalist id="create-session-workspace-history">
                  {workspaceHistory.map((path) => (
                    <option key={path} value={path} />
                  ))}
                </datalist>
                {isValidating && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-low">
                    …
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleBrowse}
                className="px-base py-half bg-secondary border rounded hover:bg-panel"
                title={t('session.browse', 'Browse')}
              >
                <FolderIcon className="size-4 text-normal" />
              </button>
            </div>
            {validationError && (
              <p className="text-xs text-error">{validationError}</p>
            )}
          </div>

          <div className="flex justify-end gap-half">
            <button
              type="button"
              onClick={() => modal.hide()}
              className="px-base py-half bg-secondary border rounded text-sm text-normal hover:bg-panel"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!!validationError || isValidating}
              className="px-base py-half bg-brand border rounded text-sm text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('session.create', 'Create')}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

export const CreateSessionDialog = defineModal<
  CreateSessionDialogProps,
  CreateSessionResult | null
>(CreateSessionDialogImpl);
