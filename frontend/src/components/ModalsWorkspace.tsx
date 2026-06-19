import React, { useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { AlertTriangle, RefreshCw, Plus, Route, Rocket } from 'lucide-react';
import { ResourceStateNotice } from '@/components/ResourceState';

export const ModalsWorkspace: React.FC = () => {
  const {
    t,
    addNewTask,
    retryWorkflowFromStep3,
    showToast,
    membersAsync,
    refreshMembers,
    workflowCardAsync
  } = useWorkspace();

  // Local state for on-page confirmation showcase
  const [retryingLocal, setRetryingLocal] = useState(false);

  // Local state for on-page task creation showcase
  const [draftTitle, setDraftTitle] = useState('Add Stripe subscription checkout');
  const [draftDetails, setDraftDetails] = useState('Add monthly + annual plans. Use Stripe Checkout (not Elements). Test mode keys only.');
  const [showcaseChips, setShowcaseChips] = useState<string[]>(['Lead', 'Backend', 'Frontend', 'QA']);

  const handleToggleLocalChip = (chip: string) => {
    if (showcaseChips.includes(chip)) {
      setShowcaseChips(showcaseChips.filter(c => c !== chip));
    } else {
      setShowcaseChips([...showcaseChips, chip]);
    }
  };

  const handleLocalRetryClick = () => {
    setRetryingLocal(true);
    retryWorkflowFromStep3();
    setTimeout(() => {
      setRetryingLocal(false);
    }, 4000);
  };

  const handleLocalCreateClick = () => {
    if (!draftTitle.trim()) {
      showToast("Please provide a task title first!");
      return;
    }
    addNewTask(draftTitle, draftDetails, showcaseChips);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none">
      
      {/* Confirmation Dialog Showcase */}
      <div>
        <div className="text-[10px] font-bold text-[var(--ink-tertiary)] uppercase tracking-wider mb-2.5 px-1">Confirmation Prompt</div>
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-2)] p-6 min-h-[280px] flex items-center justify-center">
          
          <div className="w-full max-w-sm rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] overflow-hidden shadow-xs">
            <div className="p-4">
              <ResourceStateNotice
                resource={workflowCardAsync}
                labels={{
                  loading: 'Retry state is loading...',
                  empty: 'No backend workflow retry state yet.',
                  error: 'Workflow retry state could not be loaded.',
                }}
                compact
                className="mb-3"
              />
              <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-xs font-semibold text-[var(--ink)] tracking-tight">
                {t('dialogTitleRetry')}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-subtle)]">
                {t('dialogSubRetry')}
              </p>
            </div>
            
            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-2 text-[10px]">
              <span className="font-mono text-[var(--ink-tertiary)]">{t('escToCancel')}</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => showToast("Canceled retry operation locally")}
                  className="rounded border border-[var(--hairline-strong)] px-2.5 py-1 text-[10px] text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleLocalRetryClick}
                  disabled={retryingLocal}
                  className="flex items-center gap-1.5 rounded bg-[var(--primary)] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[var(--primary-hover)] cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${retryingLocal ? 'animate-spin' : ''}`} />
                  <span>{retryingLocal ? "Retrying..." : t('retryFromStep3')}</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Create New Task Showcase */}
      <div>
        <div className="text-[10px] font-bold text-[var(--ink-tertiary)] uppercase tracking-wider mb-2.5 px-1">Integrator creation form</div>
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-2)] p-6 min-h-[280px] flex items-center justify-center">
          
          <div className="w-full max-w-sm rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-[var(--hairline)] bg-[var(--surface-1)]">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--primary-tint)]">
                  <Plus className="h-3.5 w-3.5 text-[var(--primary)]" />
                </div>
                <span className="text-xs font-semibold text-[var(--ink)] tracking-tight">{t('dialogTitleNewTask')}</span>
              </div>
            </div>

            <div className="p-4 space-y-3.5">
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
                <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  {t('titleInputLabel')}
                </label>
                <input 
                  className="w-full rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 select-text"
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1">
                  {t('detailsInputLabel')}
                </label>
                <textarea 
                  className="w-full rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-1.5 text-[11px] text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]/30 min-h-[40px] leading-relaxed select-text"
                  value={draftDetails}
                  onChange={e => setDraftDetails(e.target.value)}
                />
                <div className="mt-1 flex items-center gap-1 text-[9.5px] text-[var(--ink-tertiary)]">
                  <Route className="h-3 w-3 text-[var(--primary)]" />
                  <span>{t('smartRoutingRecommend')}</span>
                </div>
              </div>

              <div>
                <label className="block text-[9.5px] font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-1.5">
                  {t('teamLabel')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {['Lead', 'Backend', 'Frontend', 'QA', 'Security'].map(chip => {
                    const active = showcaseChips.includes(chip);
                    const avtName = chip === 'Lead' ? 'LD' : chip === 'Backend' ? 'BE' : chip === 'Frontend' ? 'FE' : chip === 'QA' ? 'QA' : 'SE';
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => handleToggleLocalChip(chip)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border cursor-pointer ${
                          active 
                            ? 'bg-[var(--primary-tint)] border-[var(--primary)] text-[var(--ink)] font-semibold' 
                            : 'bg-[var(--surface-3)] border-[var(--hairline-strong)] text-[var(--ink-muted)] hover:bg-[var(--surface-4)]'
                        }`}
                      >
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--canvas)] border border-[var(--hairline)] text-[7px] font-mono">{avtName}</span>
                        <span>{chip}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] p-3 py-2 text-[10px]">
              <span className="rounded bg-[var(--surface-4)] px-1 py-0.5 font-mono text-[9px] text-[var(--ink-muted)]">⌘↵</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => showToast("Discarded changes")}
                  className="rounded border border-[var(--hairline-strong)] px-2.5 py-1 text-[10px] text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer"
                >
                  {t('cancel')}
                </button>
                <button 
                  onClick={handleLocalCreateClick}
                  disabled={membersAsync.loading}
                  className="flex items-center gap-1 rounded bg-[var(--primary)] px-3 py-1 text-[10px] font-semibold text-white hover:bg-[var(--primary-hover)] cursor-pointer disabled:cursor-wait disabled:opacity-60"
                >
                  <Rocket className="h-3 w-3" />
                  <span>{t('start')}</span>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
