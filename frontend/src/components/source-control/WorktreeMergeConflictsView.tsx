import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileWarning,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';

import {
  chatSessionWorktreeApi,
  type ResolveSessionWorktreeConflictRequest,
} from '@/lib/api';
import type {
  ConflictFileContent,
  ConflictFileInfo,
} from '@/types';
import { ScrollArea } from '@/components/ScrollArea';
import {
  WorktreeConflictActionButton,
  WorktreeConflictChoiceCard,
  WorktreeMergeConflictFrame,
  WorktreeQuickActionButton,
} from '@/components/worktree/WorktreeMergeConflictSurface';

export interface WorktreeMergeConflictsViewProps {
  sessionId: string;
  tr: (key: string, fallback: string, replacements?: Record<string, string | number>) => string;
  onCompleted: () => void;
  onAbort: () => void;
}

export type FileResolution =
  | { kind: 'text'; content: string }
  | { kind: 'binary'; choice: 'current' | 'session' | 'deleted' };

interface ResolvedFile {
  path: string;
  resolution: FileResolution;
}

// `deleted_by_us` (session removed the file) and `deleted_by_them` (base
// removed it) are conflicts where the working tree has no mergeable text; we
// surface them as binary-style keep/use/delete choices so the user does not
// have to hand-edit a missing file.
const NON_TEXT_STATUSES = new Set([
  'deleted_by_us',
  'deleted_by_them',
  'both_deleted',
  'renamed',
]);

export const isNonTextConflict = (
  info: ConflictFileInfo,
  detail: ConflictFileContent | undefined,
): boolean =>
  NON_TEXT_STATUSES.has(info.status) ||
  Boolean(detail?.is_binary) ||
  Boolean(detail?.is_too_large);

export const buildResolveConflictRequest = (
  path: string,
  resolution: FileResolution,
): ResolveSessionWorktreeConflictRequest => {
  if (resolution.kind === 'text') {
    return { path, content: resolution.content };
  }
  if (resolution.choice === 'deleted') {
    return { path, delete_file: true };
  }
  return { path, use_stage: resolution.choice };
};

export const canContinueMerge = (
  files: ConflictFileInfo[],
  listLoaded: boolean,
  listLoading: boolean,
): boolean => listLoaded && !listLoading && files.length === 0;

export const WorktreeMergeConflictsView: React.FC<
  WorktreeMergeConflictsViewProps
> = ({ sessionId, tr, onCompleted, onAbort }) => {
  const [files, setFiles] = useState<ConflictFileInfo[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConflictFileContent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolved, setResolved] = useState<Map<string, FileResolution>>(
    new Map(),
  );
  const [listLoading, setListLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setActionError(null);
    try {
      const list = await chatSessionWorktreeApi.listMergeConflicts(sessionId);
      setFiles(list);
      setListLoaded(true);
      if (list.length > 0 && !selectedPath) {
        setSelectedPath(list[0].path);
      }
      if (list.length === 0) {
        setSelectedPath(null);
      } else if (selectedPath && !list.some((f) => f.path === selectedPath)) {
        setSelectedPath(list[0].path);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [sessionId, selectedPath]);

  useEffect(() => {
    void refreshList();
    // Only run on mount; subsequent refreshes are triggered after resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!selectedPath) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    void chatSessionWorktreeApi
      .getMergeConflictDetail(sessionId, selectedPath)
      .then((content) => {
        if (cancelled) return;
        setDetail(content);
        // Seed the result editor with the working tree content (markers
        // included) so the user has a starting point. They can use the
        // quick actions to replace it with one side or accept both.
        setResolved((prev) => {
          if (prev.has(selectedPath)) return prev;
          const next = new Map(prev);
          if (
            isNonTextConflict(
              files.find((f) => f.path === selectedPath) ?? {
                path: selectedPath,
                status: 'both_modified',
              },
              content,
            )
          ) {
            next.set(selectedPath, { kind: 'binary', choice: 'current' });
          } else {
            next.set(selectedPath, { kind: 'text', content: content.working_tree });
          }
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setActionError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [files, sessionId, selectedPath]);

  const selectedInfo = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const isNonText = useMemo(
    () =>
      Boolean(selectedInfo) &&
      isNonTextConflict(selectedInfo as ConflictFileInfo, detail ?? undefined),
    [selectedInfo, detail],
  );

  const canContinue = canContinueMerge(files, listLoaded, listLoading);

  const setResolution = useCallback((path: string, resolution: FileResolution) => {
    setResolved((prev) => {
      const next = new Map(prev);
      next.set(path, resolution);
      return next;
    });
  }, []);

  const handleUseCurrent = () => {
    if (!selectedPath || !detail) return;
    setResolution(selectedPath, {
      kind: 'text',
      content: detail.current ?? '',
    });
  };
  const handleUseSession = () => {
    if (!selectedPath || !detail) return;
    setResolution(selectedPath, {
      kind: 'text',
      content: detail.session ?? '',
    });
  };
  const handleAcceptBoth = () => {
    if (!selectedPath || !detail) return;
    // Concatenate both sides with a clear separator; this is the simplest
    // "accept both" that keeps both changes without requiring a manual merge.
    const parts = [detail.current ?? '', detail.session ?? ''].filter(
      (s) => s.length > 0,
    );
    setResolution(selectedPath, {
      kind: 'text',
      content: parts.join('\n\n'),
    });
  };

  const handleBinaryChoice = (choice: 'current' | 'session' | 'deleted') => {
    if (!selectedPath) return;
    setResolution(selectedPath, { kind: 'binary', choice });
  };

  const runResolve = async (file: ResolvedFile) => {
    await chatSessionWorktreeApi.resolveMergeConflict(sessionId, {
      ...buildResolveConflictRequest(file.path, file.resolution),
    });
  };

  const handleMarkResolved = async () => {
    if (!selectedPath) return;
    const resolution = resolved.get(selectedPath);
    if (!resolution) return;
    setPendingAction(`resolve:${selectedPath}`);
    setActionError(null);
    try {
      await runResolve({ path: selectedPath, resolution });
      // Re-read the conflict list: the backend marks the path resolved and
      // removes it from the unmerged set. If no conflicts remain, the user
      // can Continue.
      await refreshList();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  const handleContinue = async () => {
    if (!canContinue) return;
    setPendingAction('continue');
    setActionError(null);
    try {
      // Resolve any files the user marked but did not explicitly submit via
      // "Mark resolved" (defensive; the explicit button is the primary path).
      for (const file of files) {
        const r = resolved.get(file.path);
        if (!r) continue;
        try {
          await runResolve({ path: file.path, resolution: r });
        } catch {
          // Surface upstream; continue loop so the final `continue/merge`
          // error is the most informative.
        }
      }
      await chatSessionWorktreeApi.continueMerge(sessionId, {
        commit_message: commitMessage.trim() || null,
      });
      onCompleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      await refreshList().catch(() => undefined);
    } finally {
      setPendingAction(null);
    }
  };

  const handleAbort = async () => {
    setPendingAction('abort');
    setActionError(null);
    try {
      await chatSessionWorktreeApi.abortMerge(sessionId);
      onAbort();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  const currentResolution = selectedPath
    ? resolved.get(selectedPath)
    : undefined;

  return (
    <WorktreeMergeConflictFrame>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--hairline)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <h2 className="truncate text-[14px] font-semibold text-[var(--ink)]">
            {tr('worktree.merge.title', 'Merge Conflicts')}
          </h2>
          <span className="rounded-full bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]">
            {files.length}/{files.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refreshList()}
          disabled={listLoading || Boolean(pendingAction)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-40"
          title={tr('sourceControl.refresh', 'Refresh')}
        >
          <RefreshCw
            aria-hidden
            className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {actionError && (
        <div className="mx-3 mt-2 rounded-md bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600">
          {actionError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="max-h-40 shrink-0 border-b border-[var(--hairline)]">
          <ScrollArea className="h-full">
            {files.length === 0 && !listLoading ? (
              <div className="px-3 py-4 text-[12px] text-[var(--ink-tertiary)]">
                {tr(
                  'worktree.merge.noConflicts',
                  'No conflicts remaining',
                )}
              </div>
            ) : (
              <ul className="py-1">
                {files.map((file) => {
                  const isResolved = resolved.has(file.path);
                  const isSelected = file.path === selectedPath;
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition hover:bg-[var(--surface-3)] ${
                          isSelected
                            ? 'bg-[var(--surface-3)] text-[var(--ink)]'
                            : 'text-[var(--ink-subtle)]'
                        }`}
                        onClick={() => setSelectedPath(file.path)}
                        title={file.path}
                      >
                        {isResolved ? (
                          <Check
                            aria-hidden
                            className="h-3 w-3 shrink-0 text-emerald-600"
                          />
                        ) : (
                          <FileWarning
                            aria-hidden
                            className="h-3 w-3 shrink-0 text-amber-600"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {file.path}
                        </span>
                        <span className="max-w-[40%] shrink-0 truncate text-[10px] text-[var(--ink-tertiary)]">
                          {file.status.replaceAll('_', ' ')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!selectedPath ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-[var(--ink-tertiary)]">
              {tr(
                'worktree.merge.selectPrompt',
                'Select a file to resolve',
              )}
            </div>
          ) : detailLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-[var(--ink-tertiary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tr('worktree.merge.loading', 'Loading conflict…')}
            </div>
          ) : !detail ? (
            <div className="flex flex-1 items-center justify-center px-4 text-[12px] text-rose-600">
              {tr(
                'worktree.merge.loadFailed',
                'Failed to load conflict content',
              )}
            </div>
          ) : isNonText ? (
            <BinaryConflictEditor
              path={selectedPath}
              status={selectedInfo?.status ?? ''}
              detail={detail}
              choice={
                currentResolution?.kind === 'binary'
                  ? currentResolution.choice
                  : undefined
              }
              tr={tr}
              onChoose={handleBinaryChoice}
            />
          ) : (
            <TextConflictEditor
              path={selectedPath}
              detail={detail}
              resolution={currentResolution}
              tr={tr}
              onUseCurrent={handleUseCurrent}
              onUseSession={handleUseSession}
              onAcceptBoth={handleAcceptBoth}
              onChange={(content) =>
                setResolution(selectedPath, { kind: 'text', content })
              }
            />
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t border-[var(--hairline)] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WorktreeConflictActionButton
            onClick={() => void handleAbort()}
            disabled={Boolean(pendingAction)}
            icon={<X className="h-3 w-3" aria-hidden />}
          >
            {tr('worktree.merge.abort', 'Abort merge')}
          </WorktreeConflictActionButton>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <WorktreeConflictActionButton
              onClick={() => void handleMarkResolved()}
              disabled={
                !selectedPath ||
                !currentResolution ||
                Boolean(pendingAction)
              }
              title={tr(
                'worktree.merge.markResolvedHint',
                'Save this file and mark it resolved',
              )}
              icon={
                pendingAction === `resolve:${selectedPath}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-3 w-3" aria-hidden />
                )
              }
            >
              {tr('worktree.merge.markResolved', 'Mark resolved')}
            </WorktreeConflictActionButton>
            <WorktreeConflictActionButton
              variant="primary"
              onClick={() => void handleContinue()}
              disabled={!canContinue || Boolean(pendingAction)}
              title={
                canContinue
                  ? tr(
                      'worktree.merge.continueHint',
                      'Finish the merge',
                    )
                  : tr(
                      'worktree.merge.continueDisabled',
                      'Resolve all files to continue',
                    )
              }
              icon={
                pendingAction === 'continue' ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <ChevronRight className="h-3 w-3" aria-hidden />
                )
              }
            >
              {tr('worktree.merge.continue', 'Continue merge')}
            </WorktreeConflictActionButton>
          </div>
        </div>
        <input
          type="text"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder={tr(
            'worktree.merge.commitPlaceholder',
            'Merge commit message (optional)',
          )}
          className="h-8 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)]"
        />
      </div>
    </WorktreeMergeConflictFrame>
  );
};

interface TextConflictEditorProps {
  path: string;
  detail: ConflictFileContent;
  resolution: FileResolution | undefined;
  tr: WorktreeMergeConflictsViewProps['tr'];
  onUseCurrent: () => void;
  onUseSession: () => void;
  onAcceptBoth: () => void;
  onChange: (content: string) => void;
}

const TextConflictEditor: React.FC<TextConflictEditorProps> = ({
  path,
  detail,
  resolution,
  tr,
  onUseCurrent,
  onUseSession,
  onAcceptBoth,
  onChange,
}) => {
  const resultContent =
    resolution?.kind === 'text' ? resolution.content : detail.working_tree;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-tertiary)]">
          {path}
        </span>
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
          <QuickAction
            label={tr('worktree.merge.useCurrent', 'Use current')}
            onClick={onUseCurrent}
          />
          <QuickAction
            label={tr('worktree.merge.useSession', 'Use session')}
            onClick={onUseSession}
          />
          <QuickAction
            label={tr('worktree.merge.acceptBoth', 'Accept both')}
            onClick={onAcceptBoth}
          />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--hairline)] overflow-auto">
        <ConflictPane
          title={tr('worktree.merge.pane.current', 'Current')}
          content={detail.current ?? ''}
          emptyHint={tr(
            'worktree.merge.emptyCurrent',
            'No current-side content',
          )}
        />
        <ConflictPane
          title={tr('worktree.merge.pane.session', 'Session Worktree')}
          content={detail.session ?? ''}
          emptyHint={tr(
            'worktree.merge.emptySession',
            'No session-side content',
          )}
        />
        <div className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-[var(--hairline)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
            {tr('worktree.merge.pane.result', 'Result')}
          </div>
          <textarea
            value={resultContent}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-2 font-mono text-[11px] leading-snug text-[var(--ink)] outline-none"
          />
        </div>
      </div>
    </div>
  );
};

const ConflictPane: React.FC<{
  title: string;
  content: string;
  emptyHint: string;
}> = ({ title, content, emptyHint }) => (
  <div className="flex min-h-0 flex-col">
    <div className="shrink-0 border-b border-[var(--hairline)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
      {title}
    </div>
    {content.length === 0 ? (
      <div className="flex flex-1 items-center justify-center px-2 text-center text-[10px] text-[var(--ink-tertiary)]">
        {emptyHint}
      </div>
    ) : (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-snug text-[var(--ink-subtle)]">
        {content}
      </pre>
    )}
  </div>
);

const QuickAction: React.FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <WorktreeQuickActionButton label={label} onClick={onClick} />
);

interface BinaryConflictEditorProps {
  path: string;
  status: string;
  detail: ConflictFileContent;
  choice: 'current' | 'session' | 'deleted' | undefined;
  tr: WorktreeMergeConflictsViewProps['tr'];
  onChoose: (choice: 'current' | 'session' | 'deleted') => void;
}

const BinaryConflictEditor: React.FC<BinaryConflictEditorProps> = ({
  path,
  status,
  detail,
  choice,
  tr,
  onChoose,
}) => (
  <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
    <div className="mb-3 flex min-w-0 items-start gap-2">
      <FileWarning className="h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px] text-[var(--ink)]">
          {path}
        </p>
        <p className="text-[11px] text-[var(--ink-tertiary)]">
          {tr(
            'worktree.merge.binaryHint',
            'Binary, large, or deleted/renamed conflict - pick one version',
          )}
          {' - '}
          {status.replaceAll('_', ' ')}
        </p>
      </div>
    </div>
    <div className="grid grid-cols-1 gap-2">
      <BinaryChoiceCard
        title={tr('worktree.merge.keepCurrent', 'Keep current')}
        description={
          detail.current !== null
            ? tr(
                'worktree.merge.keepCurrentHint',
                'Use the base workspace version',
              )
            : tr(
                'worktree.merge.keepCurrentMissing',
                'File does not exist in base',
              )
        }
        disabled={detail.current === null}
        selected={choice === 'current'}
        onSelect={() => onChoose('current')}
      />
      <BinaryChoiceCard
        title={tr('worktree.merge.useSession', 'Use session version')}
        description={
          detail.session !== null
            ? tr(
                'worktree.merge.useSessionHint',
                'Use the session worktree version',
              )
            : tr(
                'worktree.merge.useSessionMissing',
                'File does not exist in session',
              )
        }
        disabled={detail.session === null}
        selected={choice === 'session'}
        onSelect={() => onChoose('session')}
      />
      <BinaryChoiceCard
        title={tr('worktree.merge.deleteFile', 'Delete file')}
        description={tr(
          'worktree.merge.deleteHint',
          'Remove the file from the result',
        )}
        selected={choice === 'deleted'}
        onSelect={() => onChoose('deleted')}
      />
    </div>
  </div>
);

const BinaryChoiceCard: React.FC<{
  title: string;
  description: string;
  disabled?: boolean;
  selected: boolean;
  onSelect: () => void;
}> = ({ title, description, disabled, selected, onSelect }) => (
  <WorktreeConflictChoiceCard
    title={title}
    description={description}
    disabled={disabled}
    selected={selected}
    selectedIcon={<Check className="h-3 w-3 text-[var(--primary)]" />}
    onSelect={onSelect}
  />
);
