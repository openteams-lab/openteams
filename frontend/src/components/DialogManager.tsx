import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Plus, AlertTriangle, RefreshCw, X, Route, UserPlus, Key } from 'lucide-react';
import { ResourceStateNotice } from '@/components/ResourceState';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import type { DialogOptionsMock } from '@/mockApiData';

type DialogManagerProps = {
  preview?: boolean;
};

export const DialogManager: React.FC<DialogManagerProps> = ({
  preview = false,
}) => {
  const {
    t,
    isNewTaskModalOpen,
    setIsNewTaskModalOpen,
    isRetryModalOpen,
    setIsRetryModalOpen,
    isAddMemberModalOpen,
    setIsAddMemberModalOpen,
    isAddProviderModalOpen,
    setIsAddProviderModalOpen,
    addNewTask,
    retryWorkflowFromStep3,
    addMemberToOrganization,
    addProviderToKeychain,
    membersAsync,
    refreshMembers,
    providersAsync,
    refreshProviders,
    workflowCardAsync
  } = useWorkspace();

  const [dialogOptions, setDialogOptions] = useState<DialogOptionsMock | null>(null);

  // Create Task local state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDetails, setTaskDetails] = useState('');
  const [chosenChips, setChosenChips] = useState<string[]>([]);

  // Add Member local state
  const [memberName, setMemberName] = useState('');
  const [memberModel, setMemberModel] = useState('');

  // Add Provider local state
  const [providerName, setProviderName] = useState('');
  const [providerKey, setProviderKey] = useState('');

  useEffect(() => {
    void mockFrontendApi.getDialogOptions().then((options) => {
      setDialogOptions(options);
      setTaskTitle(options.taskTemplate.title);
      setTaskDetails(options.taskTemplate.details);
      setChosenChips(options.taskTemplate.chosenMembers);
      setMemberName(options.memberTemplate.name);
      setMemberModel(options.memberTemplate.model);
      setProviderName(options.providerTemplate.name);
      setProviderKey(options.providerTemplate.key);
    });
  }, []);
  const handleToggleChip = (chip: string) => {
    if (chosenChips.includes(chip)) {
      setChosenChips(chosenChips.filter(c => c !== chip));
    } else {
      setChosenChips([...chosenChips, chip]);
    }
  };

  const handleCreateTask = () => {
    addNewTask(taskTitle, taskDetails, chosenChips);
    setIsNewTaskModalOpen(false);
  };

  const handleRetry = () => {
    retryWorkflowFromStep3();
    setIsRetryModalOpen(false);
  };

  const handleAddMemberSubmit = () => {
    addMemberToOrganization(memberName, memberModel);
    setIsAddMemberModalOpen(false);
    setMemberName('@');
  };

  const handleAddProviderSubmit = () => {
    addProviderToKeychain(providerName, providerKey);
    setIsAddProviderModalOpen(false);
    setProviderKey('');
  };

  const dialogShellClass = preview
    ? 'relative flex min-h-[280px] items-center justify-center rounded-xl border border-[var(--hairline)] bg-[var(--surface-2)] p-4'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4';
  const showRetryModal = preview || isRetryModalOpen;
  const showNewTaskModal = preview || isNewTaskModalOpen;
  const showAddMemberModal = preview || isAddMemberModalOpen;
  const showAddProviderModal = preview || isAddProviderModalOpen;

  return (
    <div className={preview ? 'grid grid-cols-1 gap-6 xl:grid-cols-2' : undefined}>
      {/* 4A: RETRY CONFIRM MODAL */}
      {showRetryModal && (
        <div className={dialogShellClass}>
          {!preview && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setIsRetryModalOpen(false)} />
          )}
          <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] select-none">
            <div className="p-5">
              <ResourceStateNotice
                resource={workflowCardAsync}
                labels={{
                  loading: 'Loading workflow retry state...',
                  empty: 'No backend workflow retry state yet.',
                  error: 'Workflow retry state could not be loaded.',
                }}
                compact
                className="mb-3"
              />
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/15">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
              </div>
              <p className="text-base font-semibold text-[var(--ink)] tracking-tight">
                {t('dialogTitleRetry')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]">
                {t('dialogSubRetry')}
              </p>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
              <span className="text-[10px] font-mono text-[var(--ink-tertiary)]">{t('escToCancel')}</span>
              <div className="flex gap-2">
                <button 
                  className="rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                  onClick={() => setIsRetryModalOpen(false)}
                >
                  {t('cancel')}
                </button>
                <button 
                  className="flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover)] cursor-pointer"
                  onClick={preview ? undefined : handleRetry}
                >
                  <RefreshCw className="h-3.5 w-3.5 animate-spin-slow" />
                  {t('retryFromStep3')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4B: NEW TASK MODAL */}
      {showNewTaskModal && (
        <div className={dialogShellClass}>
          {!preview && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setIsNewTaskModalOpen(false)} />
          )}
          <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--primary-tint)]">
                  <Plus className="h-4 w-4 text-[var(--primary)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('dialogTitleNewTask')}</span>
              </div>
              <button 
                onClick={() => setIsNewTaskModalOpen(false)}
                className="text-[var(--ink-tertiary)] hover:text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <ResourceStateNotice
                resource={membersAsync}
                labels={{
                  loading: 'Loading assignable agents...',
                  empty: 'No agents are available for assignment.',
                  error: 'Assignable agents could not be refreshed.',
                  fallback: 'Showing local agent fallback.',
                }}
                onRetry={() => void refreshMembers()}
                compact
              />
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1.5Packed">
                  {t('titleInputLabel')}
                </label>
                <input 
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30"
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1.5">
                  {t('detailsInputLabel')}
                </label>
                <textarea 
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30 min-height-[80px]"
                  value={taskDetails}
                  onChange={e => setTaskDetails(e.target.value)}
                  placeholder={t('detailsPlaceholder')}
                />
                <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--ink-tertiary)]">
                  <Route className="h-3.5 w-3.5 text-[var(--primary)]" />
                  <span>{t('smartRoutingRecommend')}</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1.5">
                  {t('teamLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(dialogOptions?.roleChips ?? []).map(chip => {
                    const active = chosenChips.includes(chip.name);
                    return (
                      <button
                        key={chip.name}
                        type="button"
                        onClick={() => handleToggleChip(chip.name)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border cursor-pointer transition ${
                          active 
                            ? 'bg-[var(--primary-tint)] border-[var(--primary)] text-[var(--ink)]' 
                            : 'bg-[var(--surface-3)] border-[var(--hairline-strong)] text-[var(--ink-muted)] hover:bg-[var(--surface-4)]'
                        }`}
                      >
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--mono-bg)] border border-[var(--mono-border)] text-[8px] font-mono uppercase">
                          {chip.avatar}
                        </span>
                        {chip.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
              <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--ink-muted)] border border-[var(--hairline)]">{t('pressCmdEnter')}</span>
              <div className="flex gap-2">
                <button 
                  className="rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                  onClick={() => setIsNewTaskModalOpen(false)}
                >
                  {t('cancel')}
                </button>
                <button 
                  className="flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover)] cursor-pointer"
                  disabled={membersAsync.loading}
                  onClick={preview ? undefined : handleCreateTask}
                >
                  {t('start')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4C: ADD MEMBER MODAL */}
      {showAddMemberModal && (
        <div className={dialogShellClass}>
          {!preview && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setIsAddMemberModalOpen(false)} />
          )}
          <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--primary-tint)]">
                  <UserPlus className="h-4 w-4 text-[var(--primary)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('addMemberTitle')}</span>
              </div>
              <button onClick={() => setIsAddMemberModalOpen(false)} className="text-[var(--ink-tertiary)] hover:text-[var(--ink)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <ResourceStateNotice
                resource={membersAsync}
                labels={{
                  loading: 'Loading current members...',
                  empty: 'No members are configured yet.',
                  error: 'Members could not be refreshed.',
                  fallback: 'Showing local member fallback.',
                }}
                onRetry={() => void refreshMembers()}
                compact
              />
              <p className="text-xs text-[var(--ink-subtle)] leading-relaxed">
                {t('addMemberDesc')}
              </p>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  {t('newMemberName')}
                </label>
                <input 
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30"
                  value={memberName}
                  onChange={e => setMemberName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  {t('newMemberModel')}
                </label>
                <select 
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30"
                  value={memberModel}
                  onChange={e => setMemberModel(e.target.value)}
                >
                  {(dialogOptions?.modelOptions ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
              <button 
                className="rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                onClick={() => setIsAddMemberModalOpen(false)}
              >
                {t('cancel')}
              </button>
              <button 
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover)] cursor-pointer"
                disabled={membersAsync.loading}
                onClick={preview ? undefined : handleAddMemberSubmit}
              >
                {t('addMemberBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4D: ADD PROVIDER MODAL */}
      {showAddProviderModal && (
        <div className={dialogShellClass}>
          {!preview && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setIsAddProviderModalOpen(false)} />
          )}
          <div className="relative w-full max-w-sm overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)]">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--primary-tint)]">
                  <Key className="h-4 w-4 text-[var(--primary)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('addProviderTitle')}</span>
              </div>
              <button onClick={() => setIsAddProviderModalOpen(false)} className="text-[var(--ink-tertiary)] hover:text-[var(--ink)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <ResourceStateNotice
                resource={providersAsync}
                labels={{
                  loading: 'Loading provider keychain...',
                  empty: 'No providers are configured yet.',
                  error: 'Provider keychain could not be refreshed.',
                  fallback: 'Showing local provider fallback.',
                }}
                onRetry={() => void refreshProviders()}
                compact
              />
              <p className="text-xs text-[var(--ink-subtle)] leading-relaxed">
                {t('addProviderDesc')}
              </p>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  Provider Name
                </label>
                <input 
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30"
                  value={providerName}
                  onChange={e => setProviderName(e.target.value)}
                  placeholder="e.g. OpenAI (Custom), DeepSeek API"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  API Token Reference
                </label>
                <input 
                  type="password"
                  className="w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/30 font-mono"
                  value={providerKey}
                  placeholder="sk-..."
                  onChange={e => setProviderKey(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
              <button 
                className="rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                onClick={() => setIsAddProviderModalOpen(false)}
              >
                {t('cancel')}
              </button>
              <button 
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover)] cursor-pointer"
                disabled={providersAsync.loading}
                onClick={preview ? undefined : handleAddProviderSubmit}
              >
                {t('addProviderBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
