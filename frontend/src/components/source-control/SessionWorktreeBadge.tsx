import React, { useMemo } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FolderGit2,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import type {
  SessionWorktree,
  SessionWorktreeStatus,
} from '@/types';
import { WorktreeActionButton } from '@/components/worktree/WorktreeActionButton';
import { openInSystemFileManager } from '@/lib/systemFileManager';
import { useWorkspace } from '@/context/WorkspaceContext';

export type SessionWorktreeAction =
  | 'prepare'
  | 'merge'
  | 'discard'
  | 'cleanup'
  | 'retry-cleanup'
  | 'force-remove'
  | 'resolve-conflicts'
  | 'view-history';

interface SessionWorktreeBadgeProps {
  worktree: SessionWorktree | null;
  // `pendingCreate` represents the normal automatic path: the session opted
  // into isolation, but the backend has not needed to create the worktree yet.
  pendingCreate: boolean;
  busy: boolean;
  mergeDisabledReason?: string | null;
  onAction: (action: SessionWorktreeAction) => void;
  tr: (key: string, fallback: string, replacements?: Record<string, string | number>) => string;
}

interface BadgeConfig {
  tone: 'pending' | 'preparing' | 'active' | 'conflict' | 'merged' | 'failed';
  label: string;
  title: string;
}

// Map the authoritative backend status to the badge tone + copy. Only the
// reducer writes `status`; this mapping must stay in sync with the
// transitions documented in crates/db/src/models/chat_session_worktree.rs.
const badgeConfigFor = (
  worktree: SessionWorktree | null,
  pendingCreate: boolean,
  tr: SessionWorktreeBadgeProps['tr'],
): BadgeConfig => {
  if (!worktree || pendingCreate) {
    return {
      tone: 'pending',
      label: tr('worktree.badge.pending', 'Worktree not created'),
      title: tr(
        'worktree.badge.pendingHint',
        'The isolated worktree will be created automatically when the first agent run starts.',
      ),
    };
  }
  switch (worktree.status) {
    case 'creating':
      return {
        tone: 'preparing',
        label: tr('worktree.badge.creating', 'Creating worktree'),
        title: tr(
          'worktree.badge.creatingHint',
          'Creating isolated worktree...',
        ),
      };
    case 'active':
    case 'dirty':
      return {
        tone: 'active',
        label: tr('worktree.badge.isolated', 'Isolated workspace'),
        title: tr(
          'worktree.badge.isolatedHint',
          'Changes are isolated in this session worktree',
        ),
      };
    case 'merging':
      return {
        tone: 'active',
        label: tr('worktree.badge.merging', 'Merging...'),
        title: tr(
          'worktree.badge.mergingHint',
          'Merging session changes into the base workspace',
        ),
      };
    case 'needs_conflict_resolution':
      return {
        tone: 'conflict',
        label: tr('worktree.badge.conflicts', 'Merge conflicts'),
        title: tr(
          'worktree.badge.conflictsHint',
          'Resolve conflicts to finish the merge',
        ),
      };
    case 'merged':
      return {
        tone: 'merged',
        label: tr('worktree.badge.merged', 'Merged'),
        title: tr(
          'worktree.badge.mergedHint',
          'Session changes merged into the base workspace',
        ),
      };
    case 'cleanup_pending':
      return {
        tone: 'merged',
        label: tr('worktree.badge.cleaning', 'Cleaning up...'),
        title: tr(
          'worktree.badge.cleaningHint',
          'Removing the merged worktree in the background',
        ),
      };
    case 'cleanup_failed':
      return {
        tone: 'failed',
        label: tr('worktree.badge.cleanupFailed', 'Cleanup failed'),
        title: worktree.cleanup_error?.trim()
          ? worktree.cleanup_error
          : tr(
              'worktree.badge.cleanupFailedHint',
              'Worktree cleanup failed; retry to remove it',
            ),
      };
    case 'archived':
    default:
      return {
        tone: 'merged',
        label: tr('worktree.badge.archived', 'Archived'),
        title: tr(
          'worktree.badge.archivedHint',
          'This worktree is archived',
        ),
      };
  }
};

const toneClassName: Record<BadgeConfig['tone'], string> = {
  pending:
    'text-[var(--ink-subtle)]',
  preparing:
    'text-[var(--ink-subtle)]',
  active:
    'text-[var(--ink-subtle)]',
  conflict:
    'text-[var(--ink-subtle)]',
  merged:
    'text-[var(--ink-subtle)]',
  failed:
    'text-[var(--ink-subtle)]',
};

const toneIcon = (tone: BadgeConfig['tone'], busy: boolean) => {
  if (busy) return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  switch (tone) {
    case 'pending':
      return (
        <FolderGit2 className="h-3 w-3 text-[var(--ink-tertiary)]" aria-hidden />
      );
    case 'preparing':
      return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
    case 'active':
      return (
        <FolderGit2 className="h-3 w-3 text-[var(--primary)]" aria-hidden />
      );
    case 'conflict':
      return <AlertTriangle className="h-3 w-3" aria-hidden />;
    case 'merged':
      return <CheckCircle2 className="h-3 w-3 text-[var(--success)]" aria-hidden />;
    case 'failed':
      return <XCircle className="h-3 w-3" aria-hidden />;
  }
};

// The set of backend statuses where each action is acceptable. Buttons only
// render when the current status permits them so the UI can never fire a
// request the reducer would reject.
const ALLOWED_ACTIONS: Record<SessionWorktreeAction, SessionWorktreeStatus[]> =
  {
    prepare: [],
    merge: ['active', 'dirty'],
    discard: [
      'active',
      'dirty',
      'needs_conflict_resolution',
      'merging',
      'merged',
    ],
    cleanup: [],
    'retry-cleanup': ['cleanup_failed'],
    'force-remove': ['cleanup_failed'],
    'resolve-conflicts': ['needs_conflict_resolution'],
    'view-history': ['merged'],
  };

const isProcessLockedCleanupError = (message?: string | null): boolean => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('os error 32') ||
    normalized.includes('being used by another process') ||
    normalized.includes('used by another process') ||
    normalized.includes('另一个程序正在使用') ||
    normalized.includes('进程无法访问')
  );
};

const isActionAllowed = (
  action: SessionWorktreeAction,
  worktree: SessionWorktree | null,
): boolean => {
  if (!worktree) return false;
  return ALLOWED_ACTIONS[action].includes(worktree.status);
};

export const SessionWorktreeBadge: React.FC<SessionWorktreeBadgeProps> = ({
  worktree,
  pendingCreate,
  busy,
  mergeDisabledReason = null,
  onAction,
  tr,
}) => {
  const { showToast } = useWorkspace();
  const config = useMemo(
    () => badgeConfigFor(worktree, pendingCreate, tr),
    [worktree, pendingCreate, tr],
  );

  const can = (action: SessionWorktreeAction) =>
    isActionAllowed(action, worktree);
  const canForceRemove =
    can('force-remove') &&
    isProcessLockedCleanupError(worktree?.cleanup_error);
  const worktreePath = worktree?.worktree_path;
  const canOpenWorkspace = Boolean(worktreePath);
  const mergeDisabled = Boolean(mergeDisabledReason);
  const title = worktreePath
    ? `${tr(
        'worktree.badge.openHint',
        'Double-click to open isolated workspace',
      )}\n${worktreePath}`
    : config.title;

  const handleOpenWorkspace = async () => {
    if (!worktreePath) return;
    try {
      const response = await openInSystemFileManager(worktreePath);
      if (!response.ok) {
        showToast(
          response.error ||
            tr('worktree.badge.openFailed', 'Failed to open workspace folder'),
          'warning',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'warning');
    }
  };

  return (
    <div className="mb-3 border-y border-[color-mix(in_srgb,var(--hairline)_42%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_46%,transparent)] px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              className={`inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] text-[11px] font-semibold leading-none outline-none transition ${toneClassName[config.tone]} ${
                canOpenWorkspace
                  ? 'cursor-pointer hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_42%,transparent)]'
                  : 'cursor-default'
              }`}
              title={title}
              onDoubleClick={() => void handleOpenWorkspace()}
              disabled={!canOpenWorkspace}
            >
              {toneIcon(config.tone, busy)}
              <span>{config.label}</span>
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {can('merge') && (
            <WorktreeActionButton
              label={tr('worktree.action.merge', 'Merge')}
              title={mergeDisabledReason ?? tr('worktree.action.merge', 'Merge')}
              tone="primary"
              busy={busy}
              disabled={mergeDisabled}
              icon={<RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('merge')}
            />
          )}
          {can('resolve-conflicts') && (
            <WorktreeActionButton
              label={tr('worktree.action.resolve', 'Resolve')}
              tone="primary"
              busy={busy}
              disabled={false}
              icon={<AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('resolve-conflicts')}
            />
          )}
          {can('discard') && (
            <WorktreeActionButton
              label={tr('worktree.action.discard', 'Delete')}
              tone="danger"
              busy={busy}
              disabled={false}
              icon={<Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('discard')}
            />
          )}
          {can('view-history') && (
            <WorktreeActionButton
              label={tr('worktree.action.history', 'History')}
              tone="ghost"
              busy={busy}
              disabled={false}
              icon={<BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('view-history')}
            />
          )}
          {can('retry-cleanup') && (
            <WorktreeActionButton
              label={tr('worktree.action.retryCleanup', 'Retry')}
              tone="ghost"
              busy={busy}
              disabled={false}
              icon={<RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('retry-cleanup')}
            />
          )}
          {canForceRemove && (
            <WorktreeActionButton
              label={tr('worktree.action.forceRemove', 'Force delete')}
              tone="danger"
              busy={busy}
              disabled={false}
              icon={<Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              onClick={() => onAction('force-remove')}
            />
          )}
        </div>
      </div>
      {config.tone === 'failed' && worktree?.cleanup_error?.trim() && (
        <p className="mt-1.5 text-[11px] leading-snug text-rose-600">
          {worktree.cleanup_error}
        </p>
      )}
    </div>
  );
};
