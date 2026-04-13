import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowClockwiseIcon,
  ArrowSquareUpRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  GitBranchIcon,
  XIcon,
} from '@phosphor-icons/react';
import type {
  SessionWorkspace,
  WorkspaceChangedFile,
  WorkspaceChangesResponse,
} from 'shared/types';
import { Tooltip } from '@/components/ui-new/primitives/Tooltip';
import { cn } from '@/lib/utils';
import { chatApi, fileSystemApi } from '@/lib/api';
import { getRelativeWorkspaceFilePath } from '../utils';
import { WorkspaceSingleFileDiffModal } from './WorkspaceSingleFileDiffModal';
import { resolveLocalPathToAbsolutePath } from '@/utils/readOnlyLinks';

const MAX_VISIBLE_FILES = 200;

type WorkspaceSummaryState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  isGitRepo: boolean | null;
  files: WorkspaceFileRow[];
};

type WorkspaceFileRow = {
  key: string;
  status: 'M' | 'A' | 'D' | '?';
  path: string;
  additions: number;
  deletions: number;
};

type SelectedWorkspaceDiff = {
  workspacePath: string;
  filePath: string;
  loading: boolean;
  unifiedDiff: string | null;
  error: string | null;
};

export interface SessionWorkspacesPanelProps {
  isOpen: boolean;
  sessionId: string | null;
  initialWorkspacePath?: string | null;
  initialFilePath?: string | null;
  onClose: () => void;
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function createEmptyWorkspaceState(): WorkspaceSummaryState {
  return {
    loading: false,
    loaded: false,
    error: null,
    isGitRepo: null,
    files: [],
  };
}

function summarizeWorkspaceFiles(
  response: WorkspaceChangesResponse | null
): WorkspaceFileRow[] {
  if (!response?.changes) {
    return [];
  }

  const mapChangedFiles = (
    files: WorkspaceChangedFile[],
    status: 'M' | 'A'
  ): WorkspaceFileRow[] =>
    files.map((file) => ({
      key: `${status}:${file.path}`,
      status,
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    }));

  return [
    ...mapChangedFiles(response.changes.modified, 'M'),
    ...mapChangedFiles(response.changes.added, 'A'),
    ...response.changes.deleted.map((file) => ({
      key: `D:${file.path}`,
      status: 'D' as const,
      path: file.path,
      additions: 0,
      deletions: 0,
    })),
    ...response.changes.untracked.map((file) => ({
      key: `?:${file.path}`,
      status: '?' as const,
      path: file.path,
      additions: 0,
      deletions: 0,
    })),
  ];
}

function findWorkspaceFileDiff(
  response: WorkspaceChangesResponse,
  filePath: string
): string | null {
  const normalizedTarget = normalizeWorkspacePath(filePath).toLowerCase();
  const matchFile = (file: WorkspaceChangedFile) =>
    normalizeWorkspacePath(file.path).toLowerCase() === normalizedTarget;

  const changedFile =
    response.changes?.modified.find(matchFile) ??
    response.changes?.added.find(matchFile) ??
    null;

  return changedFile?.unified_diff?.trim() ? changedFile.unified_diff : null;
}

function TruncatedPathWithTooltip({
  path,
  className,
}: {
  path: string;
  className: string;
}) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const updateTruncation = useCallback(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    setIsTruncated(element.scrollWidth > element.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    updateTruncation();
  }, [path, updateTruncation]);

  useEffect(() => {
    const element = textRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateTruncation();
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [updateTruncation]);

  const content = (
    <div
      ref={textRef}
      className={className}
      title={isTruncated ? undefined : path}
    >
      {path}
    </div>
  );

  if (!isTruncated) {
    return content;
  }

  return (
    <Tooltip content={path} side="bottom" className="text-base" maxWidth={720}>
      {content}
    </Tooltip>
  );
}

export function SessionWorkspacesPanel({
  isOpen,
  sessionId,
  initialWorkspacePath = null,
  initialFilePath = null,
  onClose,
}: SessionWorkspacesPanelProps) {
  const { t } = useTranslation('chat');
  const [workspaces, setWorkspaces] = useState<SessionWorkspace[]>([]);
  const [workspaceStates, setWorkspaceStates] = useState<
    Record<string, WorkspaceSummaryState>
  >({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedDiff, setSelectedDiff] =
    useState<SelectedWorkspaceDiff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [openingWorkspacePath, setOpeningWorkspacePath] = useState<
    string | null
  >(null);
  const [openNotice, setOpenNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const workspaceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!openNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setOpenNotice(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [openNotice]);

  const handleRefresh = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
    setSelectedDiff(null);
  }, []);

  const handleOpenInExplorer = useCallback(
    async (targetPath: string) => {
      setOpeningWorkspacePath(targetPath);
      setOpenNotice(null);
      try {
        const result = await fileSystemApi.openInExplorer(targetPath);
        if (!result.ok) {
          setOpenNotice({
            kind: 'error',
            message: t('panel.workspaces.openExplorerError'),
          });
          return;
        }

        setOpenNotice({
          kind: 'success',
          message: t('panel.workspaces.openExplorerSuccess'),
        });
      } catch (error) {
        console.warn('Failed to open path in explorer', error);
        setOpenNotice({
          kind: 'error',
          message: t('panel.workspaces.openExplorerError'),
        });
      } finally {
        setOpeningWorkspacePath(null);
      }
    },
    [t]
  );

  const loadWorkspaceSummary = useCallback(
    async (workspacePath: string) => {
      if (!sessionId) return;

      const currentState = workspaceStates[workspacePath];
      if (currentState?.loading || currentState?.loaded) {
        return;
      }

      setWorkspaceStates((prev) => ({
        ...prev,
        [workspacePath]: {
          ...(prev[workspacePath] ?? createEmptyWorkspaceState()),
          loading: true,
          error: null,
        },
      }));

      try {
        const response = await chatApi.getSessionWorkspaceChanges(
          sessionId,
          workspacePath,
          { includeDiff: false }
        );

        setWorkspaceStates((prev) => ({
          ...prev,
          [workspacePath]: {
            loading: false,
            loaded: true,
            error: response.error,
            isGitRepo: response.is_git_repo,
            files: summarizeWorkspaceFiles(response),
          },
        }));
      } catch (error) {
        console.warn('Failed to load workspace changes', error);
        setWorkspaceStates((prev) => ({
          ...prev,
          [workspacePath]: {
            ...(prev[workspacePath] ?? createEmptyWorkspaceState()),
            loading: false,
            loaded: true,
            error: t('panel.workspaces.loadWorkspaceError'),
          },
        }));
      }
    },
    [sessionId, t, workspaceStates]
  );

  const handleToggleWorkspace = useCallback(
    (workspacePath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(workspacePath)) {
          next.delete(workspacePath);
        } else {
          next.add(workspacePath);
        }
        return next;
      });

      const state = workspaceStates[workspacePath];
      if (!state?.loaded && !state?.loading) {
        void loadWorkspaceSummary(workspacePath);
      }
    },
    [loadWorkspaceSummary, workspaceStates]
  );

  const handleOpenDiff = useCallback(
    async (workspacePath: string, filePath: string) => {
      if (!sessionId) return;

      setSelectedDiff({
        workspacePath,
        filePath,
        loading: true,
        unifiedDiff: null,
        error: null,
      });

      try {
        const response = await chatApi.getSessionWorkspaceChanges(
          sessionId,
          workspacePath,
          { includeDiff: true }
        );
        const unifiedDiff = findWorkspaceFileDiff(response, filePath);

        setWorkspaceStates((prev) => ({
          ...prev,
          [workspacePath]: {
            loading: false,
            loaded: true,
            error: response.error,
            isGitRepo: response.is_git_repo,
            files: summarizeWorkspaceFiles(response),
          },
        }));

        setSelectedDiff({
          workspacePath,
          filePath,
          loading: false,
          unifiedDiff,
          error:
            unifiedDiff === null
              ? t('modals.workspaceSingleFileDiff.notFound')
              : null,
        });
      } catch (error) {
        console.warn('Failed to load workspace file diff', error);
        setSelectedDiff({
          workspacePath,
          filePath,
          loading: false,
          unifiedDiff: null,
          error: t('modals.workspaceSingleFileDiff.loadError'),
        });
      }
    },
    [sessionId, t]
  );

  useEffect(() => {
    if (!isOpen || !sessionId) {
      setSelectedDiff(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      setOpenNotice(null);

      try {
        const nextWorkspaces = await chatApi.getSessionWorkspaces(sessionId);
        if (cancelled) return;

        setWorkspaces(nextWorkspaces);
        setWorkspaceStates(
          Object.fromEntries(
            nextWorkspaces.map((item) => [
              item.workspace_path,
              createEmptyWorkspaceState(),
            ])
          )
        );
        setExpandedPaths((prev) => {
          const next = new Set(
            Array.from(prev).filter((path) =>
              nextWorkspaces.some((item) => item.workspace_path === path)
            )
          );
          if (
            initialWorkspacePath &&
            nextWorkspaces.some(
              (item) => item.workspace_path === initialWorkspacePath
            )
          ) {
            next.add(initialWorkspacePath);
          }
          return next;
        });
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to load session workspaces', error);
        setWorkspaces([]);
        setWorkspaceStates({});
        setLoadError(t('panel.workspaces.loadError'));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [initialWorkspacePath, isOpen, refreshToken, sessionId, t]);

  useEffect(() => {
    if (!isOpen || expandedPaths.size === 0) return;

    for (const workspacePath of expandedPaths) {
      const state = workspaceStates[workspacePath];
      if (!state?.loaded && !state?.loading) {
        void loadWorkspaceSummary(workspacePath);
      }
    }
  }, [expandedPaths, isOpen, loadWorkspaceSummary, workspaceStates]);

  useEffect(() => {
    if (!isOpen || !initialWorkspacePath) return;
    const timer = window.setTimeout(() => {
      workspaceRefs.current[initialWorkspacePath]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }, 60);

    return () => window.clearTimeout(timer);
  }, [initialWorkspacePath, isOpen, workspaces]);

  const highlightedWorkspacePath = initialWorkspacePath?.trim() || null;
  const highlightedFilePath = useMemo(() => {
    if (!initialFilePath || !highlightedWorkspacePath) {
      return null;
    }

    return (
      getRelativeWorkspaceFilePath(initialFilePath, highlightedWorkspacePath) ??
      normalizeWorkspacePath(initialFilePath)
    );
  }, [highlightedWorkspacePath, initialFilePath]);

  useEffect(() => {
    if (!isOpen || !highlightedWorkspacePath || !highlightedFilePath) return;

    const state = workspaceStates[highlightedWorkspacePath];
    if (!state?.loaded || state.loading) {
      return;
    }

    const targetKey = `${highlightedWorkspacePath}::${highlightedFilePath.toLowerCase()}`;
    const timer = window.setTimeout(() => {
      fileRefs.current[targetKey]?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [highlightedFilePath, highlightedWorkspacePath, isOpen, workspaceStates]);

  const panelBody = useMemo(() => {
    if (isLoading) {
      return (
        <div className="text-xs text-low">{t('panel.workspaces.loading')}</div>
      );
    }

    if (loadError) {
      return <div className="text-xs text-error">{loadError}</div>;
    }

    if (workspaces.length === 0) {
      return (
        <div className="text-xs text-low">{t('panel.workspaces.empty')}</div>
      );
    }

    return workspaces.map((workspace) => {
      const workspacePath = workspace.workspace_path;
      const state =
        workspaceStates[workspacePath] ?? createEmptyWorkspaceState();
      const isExpanded = expandedPaths.has(workspacePath);
      const visibleFiles = state.files.slice(0, MAX_VISIBLE_FILES);
      const isTruncated = state.files.length > MAX_VISIBLE_FILES;
      const isHighlighted = highlightedWorkspacePath === workspacePath;

      return (
        <div
          key={workspacePath}
          ref={(node) => {
            workspaceRefs.current[workspacePath] = node;
          }}
          className={cn(
            'chat-session-workspaces-panel-card overflow-hidden',
            isHighlighted && 'is-highlighted'
          )}
        >
          <div className="chat-session-workspaces-panel-card-header flex items-start gap-base px-base py-base">
            <button
              type="button"
              className="chat-session-workspaces-panel-toggle inline-flex items-center justify-center p-2 transition-colors"
              onClick={() => handleToggleWorkspace(workspacePath)}
              aria-label={
                isExpanded ? t('members.collapse') : t('members.expand')
              }
              title={isExpanded ? t('members.collapse') : t('members.expand')}
            >
              <CaretDownIcon
                className={cn(
                  'size-icon-sm transition-transform',
                  !isExpanded && '-rotate-90'
                )}
              />
            </button>
            <button
              type="button"
              className="chat-session-workspaces-panel-path-button min-w-0 flex-1 text-left"
              onClick={() => handleToggleWorkspace(workspacePath)}
            >
              <TruncatedPathWithTooltip
                path={workspacePath}
                className="chat-session-workspaces-panel-path truncate text-sm font-medium text-normal"
              />
              <div className="chat-session-workspaces-panel-meta mt-1 text-xs text-low">
                {t('panel.workspaces.members', {
                  names: workspace.agent_names.join(', '),
                })}
              </div>
            </button>
            <button
              type="button"
              className="chat-session-workspaces-panel-open-button inline-flex items-center justify-center p-2 transition-colors disabled:opacity-60"
              onClick={() => void handleOpenInExplorer(workspacePath)}
              disabled={openingWorkspacePath === workspacePath}
              title={t('panel.workspaces.openWorkspace')}
              aria-label={t('panel.workspaces.openWorkspace')}
            >
              <ArrowSquareUpRightIcon className="size-icon-sm" />
            </button>
          </div>

          {isExpanded && (
            <div className="chat-session-workspaces-panel-card-body space-y-base px-base py-base">
              {state.loading && (
                <div className="text-xs text-low">
                  {t('panel.workspaces.loadingWorkspace')}
                </div>
              )}

              {!state.loading && state.error && (
                <div className="text-xs text-error">{state.error}</div>
              )}

              {!state.loading &&
                !state.error &&
                state.loaded &&
                state.isGitRepo === false && (
                  <div className="flex items-center gap-half text-xs text-low">
                    <GitBranchIcon className="size-icon-sm" />
                    <span>{t('panel.workspaces.notGitRepo', {})}</span>
                  </div>
                )}

              {!state.loading &&
                !state.error &&
                state.loaded &&
                state.files.length === 0 && (
                  <div className="text-xs text-low">
                    {t('panel.workspaces.noChanges')}
                  </div>
                )}

              {!state.loading &&
                !state.error &&
                state.loaded &&
                state.files.length > 0 && (
                  <div className="space-y-half">
                    {isTruncated && (
                      <div className="chat-session-workspaces-panel-note rounded-sm px-base py-half text-xs text-low">
                        {t('panel.workspaces.truncated', {})}
                      </div>
                    )}

                    {visibleFiles.map((file) => (
                      <div
                        key={file.key}
                        ref={(node) => {
                          fileRefs.current[
                            `${workspacePath}::${normalizeWorkspacePath(file.path).toLowerCase()}`
                          ] = node;
                        }}
                        className={cn(
                          'chat-session-workspaces-file-row flex items-center gap-base rounded-sm px-base py-half',
                          highlightedWorkspacePath === workspacePath &&
                            highlightedFilePath !== null &&
                            normalizeWorkspacePath(file.path).toLowerCase() ===
                              highlightedFilePath.toLowerCase() &&
                            'is-highlighted'
                        )}
                        data-path={file.path}
                      >
                        <span
                          className={cn(
                            'chat-session-workspaces-file-status w-5 shrink-0 text-xs font-medium',
                            file.status === 'A' && 'is-added',
                            file.status === 'M' && 'is-modified',
                            file.status === 'D' && 'is-deleted',
                            file.status === '?' && 'is-untracked'
                          )}
                        >
                          {file.status}
                        </span>
                        <TruncatedPathWithTooltip
                          path={file.path}
                          className="chat-session-workspaces-file-path min-w-0 flex-1 truncate font-ibm-plex-mono text-xs"
                        />
                        <span className="chat-session-workspaces-file-stats shrink-0 text-xs">
                          {file.additions > 0 && (
                            <span className="text-success">
                              +{file.additions}
                            </span>
                          )}
                          {file.additions > 0 && file.deletions > 0 && ' '}
                          {file.deletions > 0 && (
                            <span className="text-error">
                              -{file.deletions}
                            </span>
                          )}
                        </span>
                        {state.isGitRepo &&
                          (file.status === 'M' || file.status === 'A') && (
                            <button
                              type="button"
                              className="chat-session-workspaces-file-action shrink-0 text-xs"
                              onClick={() =>
                                void handleOpenDiff(workspacePath, file.path)
                              }
                            >
                              {t('panel.workspaces.diffAction')}
                            </button>
                          )}
                        <button
                          type="button"
                          className="chat-session-workspaces-file-action shrink-0 text-xs"
                          onClick={() => {
                            const targetPath =
                              resolveLocalPathToAbsolutePath(
                                file.path,
                                workspacePath
                              ) ?? workspacePath;
                            void handleOpenInExplorer(targetPath);
                          }}
                          title={t('panel.workspaces.openWorkspace')}
                        >
                          [↗]
                        </button>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          )}
        </div>
      );
    });
  }, [
    expandedPaths,
    handleOpenDiff,
    handleOpenInExplorer,
    handleToggleWorkspace,
    highlightedFilePath,
    highlightedWorkspacePath,
    isLoading,
    loadError,
    openingWorkspacePath,
    t,
    workspaceStates,
    workspaces,
  ]);

  if (!isOpen || !sessionId) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full justify-end"
        onClick={onClose}
      >
        <div
          className="chat-session-workspaces-panel flex h-full w-[680px] max-w-full flex-col border-l border-border shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-session-workspaces-panel-header flex items-center justify-between border-b border-border px-base py-base">
            <div className="min-w-0">
              <div className="chat-session-workspaces-panel-eyebrow">
                {t('panel.workspaces.eyebrow', {})}
              </div>
              <div className="chat-session-workspaces-panel-title">
                {t('panel.workspaces.title', {})}
              </div>
            </div>
            <div className="chat-session-workspaces-panel-actions flex items-center gap-half">
              <button
                type="button"
                className="chat-session-workspaces-panel-action inline-flex items-center justify-center p-2 transition-colors"
                onClick={handleRefresh}
                title={t('panel.workspaces.refresh')}
                aria-label={t('panel.workspaces.refresh')}
              >
                <ArrowClockwiseIcon className="size-icon-sm" />
              </button>
              <button
                type="button"
                className="chat-session-workspaces-panel-action inline-flex items-center justify-center p-2 transition-colors"
                onClick={onClose}
                title={t('panel.workspaces.close')}
                aria-label={t('panel.workspaces.close')}
              >
                <XIcon className="size-icon-sm" />
              </button>
            </div>
          </div>

          <div className="chat-session-workspaces-panel-body flex-1 space-y-base overflow-y-auto p-base">
            {panelBody}
          </div>
          {openNotice && (
            <div
              className={cn(
                'chat-session-workspaces-panel-notice',
                openNotice.kind === 'success' && 'is-success',
                openNotice.kind === 'error' && 'is-error'
              )}
              role="status"
              aria-live="polite"
            >
              {openNotice.kind === 'success' ? (
                <CheckCircleIcon
                  className="chat-session-workspaces-panel-notice-icon"
                  weight="fill"
                />
              ) : null}
              {openNotice.message}
            </div>
          )}
        </div>
      </div>

      {selectedDiff && (
        <WorkspaceSingleFileDiffModal
          isOpen
          workspacePath={selectedDiff.workspacePath}
          filePath={selectedDiff.filePath}
          loading={selectedDiff.loading}
          unifiedDiff={selectedDiff.unifiedDiff}
          error={selectedDiff.error}
          onClose={() => setSelectedDiff(null)}
        />
      )}
    </>
  );
}
