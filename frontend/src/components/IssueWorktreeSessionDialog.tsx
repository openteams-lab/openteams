import { Check, FolderGit2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  canUseIsolatedWorktree,
  isolatedWorktreeModeOrNull,
  nextIsolatedWorktreeSelection,
} from '@/components/worktreeWorkspaceGuard';
import type { ChatSessionWorktreeMode } from '@/types';

// "事项创建会话弹窗": a lightweight dialog shown before creating a session from
// a work item. It asks the user whether to isolate the new session in a Git
// worktree. The default (toggle off) preserves the historical main-workspace
// behavior. Non-Git projects get a disabled toggle with an explanation so the
// user understands why isolation is unavailable.
export interface IssueWorktreeSessionDialogProps {
  open: boolean;
  projectName: string;
  gitAvailable: boolean | null;
  tr: (key: string, fallback: string, replacements?: Record<string, string | number>) => string;
  onClose: () => void;
  onCreate: (worktreeMode: ChatSessionWorktreeMode | null) => Promise<void> | void;
}

export function IssueWorktreeSessionDialog({
  open,
  projectName,
  gitAvailable,
  tr,
  onClose,
  onCreate,
}: IssueWorktreeSessionDialogProps) {
  const [isolate, setIsolate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsolate(false);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (canUseIsolatedWorktree(gitAvailable)) return;
    setIsolate(false);
  }, [gitAvailable]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, submitting]);

  if (!open) return null;

  const gitUnavailable = gitAvailable === false;
  const gitChecking = gitAvailable === null;
  const projectLabel =
    projectName.trim() || tr('issue.createDialog.projectFallback', 'Project');
  const toggleDisabled = !canUseIsolatedWorktree(gitAvailable);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onCreate(isolatedWorktreeModeOrNull(isolate, gitAvailable));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs"
      role="presentation"
    >
      <button
        type="button"
        aria-label={tr('cancel', 'Cancel')}
        className="absolute inset-0 cursor-default"
        disabled={submitting}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-worktree-session-title"
        className="relative w-full max-w-[460px] overflow-hidden rounded-[16px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        <div className="relative px-7 pb-5 pt-6">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
            {projectLabel}
          </p>
          <h2
            id="issue-worktree-session-title"
            className="mt-1 text-[18px] font-semibold leading-[1.2] text-[var(--ink)]"
          >
            {tr('issue.worktreeSession.title', 'Create session')}
          </h2>
          <p className="mt-2 text-[13px] leading-[1.55] text-[var(--ink-subtle)]">
            {tr(
              'issue.worktreeSession.description',
              'Choose whether to isolate this session in a Git worktree. The default keeps the session in the main workspace.',
            )}
          </p>

          <button
            type="button"
            disabled={toggleDisabled || submitting}
            aria-pressed={isolate}
            aria-label={tr(
              'createSession.isolateWorktree',
              'Isolate this session in a Git worktree',
            )}
            className={`mt-5 flex w-full items-start gap-3 rounded-[12px] border px-4 py-3 text-left transition ${
              isolate && !toggleDisabled
                ? 'border-[var(--primary)] bg-[var(--primary-tint)]'
                : 'border-[var(--hairline)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
            } ${toggleDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            onClick={() =>
              setIsolate((current) =>
                nextIsolatedWorktreeSelection(current, gitAvailable),
              )
            }
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                isolate && !toggleDisabled
                  ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                  : 'border-[var(--hairline-strong)] bg-[var(--surface-1)] text-transparent'
              }`}
            >
              <Check className="h-3 w-3" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-start gap-1.5 text-[14px] font-semibold leading-snug text-[var(--ink)]">
                <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 break-words">
                  {tr(
                    'createSession.isolateWorktree',
                    'Isolate this session in a Git worktree',
                  )}
                </span>
              </span>
              <span className="mt-1 block text-[12px] leading-[1.5] text-[var(--ink-tertiary)]">
                {gitUnavailable
                  ? tr(
                      'issue.worktreeSession.requiresGit',
                      'This project has no Git repository connected. Use the main workspace instead.',
                    )
                  : gitChecking
                  ? tr(
                      'issue.worktreeSession.checkingGit',
                      'Checking whether the selected workspace is a Git repository.',
                    )
                  : tr(
                      'issue.worktreeSession.toggleHint',
                      'Changes will be isolated in a dedicated worktree and merged back when ready.',
                    )}
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="absolute right-5 top-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={tr('cancel', 'Cancel')}
            title={tr('cancel', 'Cancel')}
          >
            <X className="h-[13px] w-[13px]" strokeWidth={1.6} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-[var(--hairline)] bg-[var(--surface-2)] px-7 py-4">
          <button
            type="button"
            className="h-9 cursor-pointer rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-4 text-[13px] font-medium text-[var(--ink-muted)] transition hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting}
            onClick={onClose}
          >
            {tr('cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="h-9 cursor-pointer rounded-[8px] border border-[var(--primary)] bg-[var(--primary)] px-4 text-[13px] font-semibold text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting
              ? tr('issue.detail.action.creatingSession', 'Creating...')
              : tr('issue.detail.createSession', 'Create session')}
          </button>
        </div>
      </div>
    </div>
  );
}

