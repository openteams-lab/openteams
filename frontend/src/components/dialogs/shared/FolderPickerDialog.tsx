import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircle,
  ChevronUp,
  File,
  Folder,
  FolderOpen,
  Home,
  Loader2,
  Search,
} from 'lucide-react';
import { fileSystemApi } from '@/lib/api';
import { DirectoryEntry, DirectoryListResponse } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from './ConfirmationDialogChrome';
import { cn } from '@/lib/utils';

export interface FolderPickerDialogProps {
  value?: string;
  title?: string;
  description?: string;
}

const fieldClassName =
  'h-11 rounded-[14px] border border-[#DCE4EF] bg-[#F9FBFF] px-4 text-[14px] text-[#223044] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-[#94A0B2] focus-visible:border-[#4A90E2] focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-[#4A90E2]/12 dark:border-[#2A3445] dark:bg-[#111926] dark:text-[#F3F6FB] dark:shadow-none dark:placeholder:text-[#7F8AA3] dark:focus-visible:border-[#5EA2FF] dark:focus-visible:bg-[#111926] dark:focus-visible:ring-[#5EA2FF]/15';

const toolbarButtonClassName =
  'h-11 rounded-[14px] border-[#DCE4EF] bg-white text-[#4A5A70] hover:bg-[#F2F6FB] hover:text-[#223044] dark:border-[#2A3445] dark:bg-[#192233] dark:text-[#BAC4D6] dark:hover:bg-[#1A2433] dark:hover:text-[#F3F6FB]';

const FolderPickerDialogImpl = NiceModal.create<FolderPickerDialogProps>(
  ({
    value = '',
    title = 'Select Folder',
    description = 'Choose a folder for your project',
  }) => {
    const modal = useModal();
    const { t } = useTranslation('common');
    const [currentPath, setCurrentPath] = useState<string>('');
    const [entries, setEntries] = useState<DirectoryEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [manualPath, setManualPath] = useState(value);
    const [searchTerm, setSearchTerm] = useState('');

    const filteredEntries = useMemo(() => {
      if (!searchTerm.trim()) return entries;
      return entries.filter((entry) =>
        entry.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }, [entries, searchTerm]);

    useEffect(() => {
      if (modal.visible) {
        setManualPath(value);
        setSearchTerm('');
        void loadDirectory();
      }
    }, [modal.visible, value]);

    const loadDirectory = async (path?: string) => {
      setLoading(true);
      setError('');

      try {
        const result: DirectoryListResponse = await fileSystemApi.list(path);

        if (!result || typeof result !== 'object') {
          throw new Error('Invalid response from file system API');
        }

        const nextEntries = Array.isArray(result.entries) ? result.entries : [];
        setEntries(nextEntries);
        const newPath = result.current_path || '';
        setCurrentPath(newPath);

        if (path) {
          setManualPath(newPath);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load directory'
        );
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };

    const handleFolderClick = (entry: DirectoryEntry) => {
      if (!entry.is_directory) return;
      setSearchTerm('');
      void loadDirectory(entry.path);
      setManualPath(entry.path);
    };

    const handleParentDirectory = () => {
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      const newPath = parentPath || '/';
      void loadDirectory(newPath);
      setManualPath(newPath);
    };

    const handleHomeDirectory = () => {
      void loadDirectory();
    };

    const handleManualPathSubmit = () => {
      void loadDirectory(manualPath);
    };

    const handleSelectCurrent = () => {
      const selectedPath = manualPath || currentPath;
      modal.resolve(selectedPath);
      modal.hide();
    };

    const handleSelectManual = () => {
      modal.resolve(manualPath);
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
        title={title}
        message={description}
        tone="info"
        closeLabel={t('buttons.close', 'Close')}
        className="!max-w-[760px] !border-[#DCE4EF] !bg-[linear-gradient(180deg,#FFFFFF_0%,#F4F8FC_100%)] !shadow-[0_28px_84px_rgba(15,23,42,0.18)] dark:!border-[#2A3445] dark:!bg-[linear-gradient(180deg,rgba(25,34,51,0.98)_0%,rgba(16,23,34,1)_100%)] dark:!shadow-[0_28px_84px_rgba(0,0,0,0.42)]"
        bodyExtra={
          <div className="space-y-4">
            <div className="rounded-[16px] border border-white/70 bg-[rgba(247,250,252,0.92)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-[#2A3445] dark:bg-[rgba(25,34,51,0.76)] dark:shadow-none">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                  {t('folderPicker.legend')}
                </p>
                <span className="rounded-full border border-[#DCE4EF] bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8B98AA] dark:border-[#2A3445] dark:bg-[#111926] dark:text-[#7F8AA3]">
                  {t('folderPicker.itemCount', {
                    count: filteredEntries.length,
                    defaultValue: '{{count}} items',
                  })}
                </span>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
              <div className="rounded-[20px] border border-[#E4EBF3] bg-white/90 p-4 shadow-[0_12px_32px_rgba(148,163,184,0.08)] dark:border-[#2A3445] dark:bg-[#192233] dark:shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Label className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                    {t('folderPicker.manualPathLabel')}
                  </Label>
                  <span className="rounded-full bg-[#EEF5FF] px-3 py-1 text-[11px] font-medium text-[#4A90E2] dark:bg-[rgba(94,162,255,0.14)] dark:text-[#7DB6FF]">
                    {t('folderPicker.pathBadge', 'Path')}
                  </span>
                </div>

                <div className="flex gap-3">
                  <Input
                    value={manualPath}
                    onChange={(e) => setManualPath(e.target.value)}
                    placeholder="/path/to/your/project"
                    className={cn(
                      fieldClassName,
                      'flex-1 min-w-0 font-mono text-[13px]'
                    )}
                  />
                  <Button
                    type="button"
                    onClick={handleManualPathSubmit}
                    variant="outline"
                    className={cn(toolbarButtonClassName, 'px-5')}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('folderPicker.go')
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-[20px] border border-[#E4EBF3] bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FBFF_100%)] p-4 shadow-[0_12px_32px_rgba(148,163,184,0.08)] dark:border-[#2A3445] dark:bg-[linear-gradient(180deg,rgba(25,34,51,0.94)_0%,rgba(17,25,38,1)_100%)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Label className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                    {t('folderPicker.searchLabel')}
                  </Label>
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#A0A9B8] dark:text-[#7F8AA3]">
                    {t('folderPicker.filterBadge', 'Filter')}
                  </span>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A0B2] dark:text-[#7F8AA3]" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Filter folders and files..."
                    className={cn(fieldClassName, 'pl-11')}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-[#DCE4EF] bg-white/95 p-4 shadow-[0_18px_42px_rgba(148,163,184,0.1)] dark:border-[#2A3445] dark:bg-[#141C28] dark:shadow-[0_18px_42px_rgba(0,0,0,0.26)]">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleHomeDirectory}
                  variant="outline"
                  size="icon"
                  className={toolbarButtonClassName}
                >
                  <Home className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  onClick={handleParentDirectory}
                  variant="outline"
                  size="icon"
                  disabled={!currentPath || currentPath === '/'}
                  className={toolbarButtonClassName}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1 rounded-[14px] border border-[#E6EDF5] bg-[#F8FBFF] px-4 py-3 dark:border-[#2A3445] dark:bg-[#111926]">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#A0A9B8] dark:text-[#7F8AA3]">
                    {t('folderPicker.currentLocation', 'Current Location')}
                  </div>
                  <div className="truncate font-mono text-[13px] text-[#334155] dark:text-[#F3F6FB]">
                    {currentPath || 'Home'}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleSelectCurrent}
                  variant="outline"
                  disabled={!currentPath}
                  className={cn(toolbarButtonClassName, 'px-5')}
                >
                  {t('folderPicker.selectCurrent')}
                </Button>
              </div>

              <div className="overflow-hidden rounded-[18px] border border-[#E6EDF5] bg-[linear-gradient(180deg,#FBFDFF_0%,#F5F8FC_100%)] dark:border-[#2A3445] dark:bg-[linear-gradient(180deg,rgba(25,34,51,0.94)_0%,rgba(17,25,38,1)_100%)]">
                <div className="flex items-center justify-between border-b border-[#E6EDF5] px-4 py-3 dark:border-[#2A3445]">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#7A8699] dark:text-[#7F8AA3]">
                      {t('folderPicker.browserTitle', 'Directory Browser')}
                    </div>
                    <div className="mt-1 text-sm text-[#6B778C] dark:text-[#BAC4D6]">
                      {t(
                        'folderPicker.browserDescription',
                        'Click folders to drill down, then confirm the selected path.'
                      )}
                    </div>
                  </div>
                  {loading && (
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#DCE4EF] bg-white px-3 py-1 text-xs font-medium text-[#6B778C] dark:border-[#2A3445] dark:bg-[#111926] dark:text-[#BAC4D6]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('folderPicker.loading', 'Loading')}
                    </div>
                  )}
                </div>

                <div className="max-h-[340px] overflow-auto p-3">
                  {error ? (
                    <Alert
                      variant="destructive"
                      className="rounded-[16px] border border-[#F2D5D8] bg-[#FFF7F8] px-4 py-3 text-[#C25B63] dark:border-[rgba(248,113,113,0.28)] dark:bg-[rgba(248,113,113,0.12)] dark:text-[#FCA5A5]"
                    >
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : filteredEntries.length === 0 ? (
                      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[#DCE4EF] bg-white/70 px-6 text-center dark:border-[#2A3445] dark:bg-[#192233]">
                        <div className="mb-2 rounded-full bg-[#EEF5FF] p-3 text-[#4A90E2] dark:bg-[rgba(94,162,255,0.14)] dark:text-[#7DB6FF]">
                          <Search className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-medium text-[#334155] dark:text-[#F3F6FB]">
                        {searchTerm.trim()
                          ? t(
                              'folderPicker.emptySearchTitle',
                              'No matches found'
                            )
                          : t(
                              'folderPicker.emptyDirectoryTitle',
                              'No folders found'
                            )}
                      </p>
                        <p className="mt-1 text-sm text-[#7A8699] dark:text-[#7F8AA3]">
                        {searchTerm.trim()
                          ? t(
                              'folderPicker.emptySearchHint',
                              'Try a broader keyword or clear the filter.'
                            )
                          : t(
                              'folderPicker.emptyDirectoryHint',
                              'This directory does not contain visible entries.'
                            )}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredEntries.map((entry) => {
                        const isDirectory = entry.is_directory;

                        return (
                          <button
                            key={entry.path}
                            type="button"
                            disabled={!isDirectory}
                            onClick={() => handleFolderClick(entry)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition-all duration-150',
                              isDirectory
                                 ? 'border-[#E6EDF5] bg-white hover:border-[#C9D8EA] hover:bg-[#F7FBFF] hover:shadow-[0_8px_20px_rgba(148,163,184,0.12)] dark:border-[#2A3445] dark:bg-[#192233] dark:hover:border-[#344257] dark:hover:bg-[#1A2433] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.22)]'
                                 : 'cursor-not-allowed border-transparent bg-transparent opacity-55'
                            )}
                            title={entry.name}
                          >
                            <span
                              className={cn(
                                'flex h-10 w-10 flex-none items-center justify-center rounded-[12px]',
                                isDirectory
                                  ? entry.is_git_repo
                                     ? 'bg-[#EEF9F0] text-[#4F9D69] dark:bg-[rgba(34,197,94,0.14)] dark:text-[#86EFAC]'
                                     : 'bg-[#EEF5FF] text-[#4A90E2] dark:bg-[rgba(94,162,255,0.14)] dark:text-[#7DB6FF]'
                                   : 'bg-[#F3F4F6] text-[#9CA3AF] dark:bg-[#111926] dark:text-[#7F8AA3]'
                               )}
                            >
                              {isDirectory ? (
                                entry.is_git_repo ? (
                                  <FolderOpen className="h-4 w-4" />
                                ) : (
                                  <Folder className="h-4 w-4" />
                                )
                              ) : (
                                <File className="h-4 w-4" />
                              )}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-[#223044] dark:text-[#F3F6FB]">
                                {entry.name}
                              </div>
                              <div className="mt-1 truncate text-xs text-[#7A8699] dark:text-[#7F8AA3]">
                                {entry.path}
                              </div>
                            </div>

                            {entry.is_git_repo && (
                              <span className="rounded-full border border-[#D7EEDB] bg-[#F2FAEC] px-3 py-1 text-[11px] font-medium text-[#4F9D69] dark:border-[rgba(52,211,153,0.24)] dark:bg-[rgba(34,197,94,0.12)] dark:text-[#86EFAC]">
                                {t('folderPicker.gitRepo')}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        }
        footer={
          <>
            <button
              type="button"
              onClick={handleCancel}
              className={getConfirmationButtonClasses('info', 'cancel')}
            >
              {t('buttons.cancel')}
            </button>
            <button
              type="submit"
              onClick={handleSelectManual}
              disabled={!manualPath.trim()}
              className={getConfirmationButtonClasses('info', 'confirm')}
            >
              {t('folderPicker.selectPath')}
            </button>
          </>
        }
      />
    );
  }
);

export const FolderPickerDialog = defineModal<
  FolderPickerDialogProps,
  string | null
>(FolderPickerDialogImpl);
