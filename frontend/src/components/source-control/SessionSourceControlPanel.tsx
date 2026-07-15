import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { ScrollArea } from "@/components/ScrollArea";
import {
  useCommandHandler,
  useCommandPresentation,
  useShortcutScope,
} from "@/shortcuts/ShortcutProvider";
import { preventTabFocusChange } from "@/shortcuts/textInputFocus";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useSessionSourceControl } from "@/hooks/useSessionSourceControl";
import { useSessionWorktree } from "@/hooks/useSessionWorktree";
import { WorktreeMergeHistorySection } from "@/pages/worktree/WorktreeMergeHistorySection";
import { deliveryApi } from "@/lib/api";
import type {
  ChatSessionWorktreeMode,
  JsonValue,
  ProjectDeliveryRecord,
  SourceControlCommitResponse,
  SourceControlDiffArea,
  SourceControlFile,
} from "@/types";
import { SourceControlFileRow } from "./SourceControlFileRow";
import {
  SessionWorktreeBadge,
  type SessionWorktreeAction,
} from "./SessionWorktreeBadge";
import {
  buildSourceControlViewModel,
  sourceControlHasSharedFiles,
  sourceControlVisiblePaths,
  translateSourceControl,
  type SourceControlBatchAction,
  type SourceControlPanelViewModel,
  type SourceControlSectionViewModel,
  type SourceControlTranslator,
} from "./sourceControlViewModel";
import { sourceControlSelectionKey } from "./sourceControlSelection";

interface SessionSourceControlPanelProps {
  projectId: string | null;
  sessionId: string | null;
  enabled: boolean;
  worktreeMode?: ChatSessionWorktreeMode;
  fallbackRelatedFiles: React.ReactNode;
  linkedWorkItemIds?: string[];
  focusRequestKey?: number;
  commitFocusRequestKey?: number;
  onOpenDiff: (
    projectId: string,
    sessionId: string,
    filePath: string,
    area: SourceControlDiffArea,
  ) => void;
  onOpenConflictResolver: (projectId: string, sessionId: string) => void;
}

interface SourceControlConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "warning" | "danger";
  resolve: (confirmed: boolean) => void;
}

type ScopedErrorState = Record<string, string>;
type ScopedTextState = Record<string, string>;

type SelectableSourceControlFile = SourceControlFile & {
  area: SourceControlDiffArea;
};

interface SessionSourceControlShortcutBindingsProps {
  panelRootRef: React.RefObject<HTMLDivElement | null>;
  listRootRef: React.RefObject<HTMLDivElement | null>;
  commitMessageRef: React.RefObject<HTMLTextAreaElement | null>;
  worktreeActive: boolean;
  files: SelectableSourceControlFile[];
  selectedFile: SelectableSourceControlFile | null;
  viewModel: Pick<SourceControlPanelViewModel, "canCommit" | "commitDisabledReason">;
  canStageAll: boolean;
  commitMessage: string;
  mergeDisabledReason: string | null;
  onMoveSelection: (offset: -1 | 1) => void;
  onToggleStage: (file: SelectableSourceControlFile) => void;
  onOpenDiff: (file: SelectableSourceControlFile) => void;
  onStageAll: () => void;
  onCommit: () => void;
  requestWorktreeAction: (action: "merge" | "discard") => void;
}

const SessionSourceControlShortcutBindings: React.FC<
  SessionSourceControlShortcutBindingsProps
> = ({
  panelRootRef,
  listRootRef,
  commitMessageRef,
  worktreeActive,
  files,
  selectedFile,
  viewModel,
  canStageAll,
  commitMessage,
  mergeDisabledReason,
  onMoveSelection,
  onToggleStage,
  onOpenDiff,
  onStageAll,
  onCommit,
  requestWorktreeAction,
}) => {
  useShortcutScope('worktree', {
    active: worktreeActive,
    rootRef: panelRootRef,
  });
  useShortcutScope('source-control-list', {
    active: files.length > 0,
    rootRef: listRootRef,
  });
  useShortcutScope('source-control-commit', {
    active: viewModel.canCommit,
    rootRef: commitMessageRef,
  });

  useCommandHandler('source-control.selection.next', {
    scope: "focused-component",
    enabled: files.length > 1,
    execute: () => onMoveSelection(1),
  });
  useCommandHandler('source-control.selection.previous', {
    scope: "focused-component",
    enabled: files.length > 1,
    execute: () => onMoveSelection(-1),
  });
  useCommandHandler('source-control.selection.toggle-stage', {
    scope: "focused-component",
    enabled: Boolean(selectedFile),
    execute: () => {
      if (selectedFile) onToggleStage(selectedFile);
    },
  });
  useCommandHandler('source-control.selection.open-diff', {
    scope: "focused-component",
    enabled: Boolean(selectedFile),
    execute: () => {
      if (selectedFile) onOpenDiff(selectedFile);
    },
  });
  useCommandHandler('source-control.stage-all', {
    scope: "focused-component",
    enabled: canStageAll,
    execute: onStageAll,
  });
  useCommandHandler('source-control.commit', {
    scope: "focused-component",
    enabled: viewModel.canCommit && commitMessage.trim().length > 0,
    disabledReason: viewModel.commitDisabledReason ?? undefined,
    allowInEditable: true,
    ownsEventTarget: (target) => target === commitMessageRef.current,
    execute: onCommit,
  });
  useCommandHandler('worktree.merge', {
    scope: "focused-component",
    enabled: worktreeActive && !mergeDisabledReason,
    disabledReason: mergeDisabledReason ?? undefined,
    execute: () => requestWorktreeAction('merge'),
  });
  useCommandHandler('worktree.discard', {
    scope: "focused-component",
    enabled: worktreeActive,
    execute: () => requestWorktreeAction('discard'),
  });

  return null;
};

const scopedError = (errors: ScopedErrorState, scopeKey: string) =>
  errors[scopeKey] ?? null;

const updateScopedError = (
  errors: ScopedErrorState,
  scopeKey: string,
  message: string | null,
): ScopedErrorState => {
  const next = { ...errors };
  if (message?.trim()) {
    next[scopeKey] = message;
  } else {
    delete next[scopeKey];
  }
  return next;
};

const updateScopedText = (
  values: ScopedTextState,
  scopeKey: string,
  value: string,
): ScopedTextState => {
  const next = { ...values };
  if (value.length > 0) {
    next[scopeKey] = value;
  } else {
    delete next[scopeKey];
  }
  return next;
};

interface SessionCommitSummary {
  id: string;
  sha: string;
  message: string;
}

const actionErrorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const describePaths = (files: SourceControlFile[], t: SourceControlTranslator) =>
  files.length === 1
    ? files[0].path
    : translateSourceControl(t, "sourceControl.pathCount", "{count} files", {
        count: files.length,
      });

const findSection = (
  viewModel: SourceControlPanelViewModel,
  id: SourceControlSectionViewModel["id"],
) => viewModel.sections.find((section) => section.id === id);

const isObjectMetadata = (
  value: JsonValue | null,
): value is { [key: string]: JsonValue } =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseRecordMetadata = (
  metadata: ProjectDeliveryRecord["metadata_json"],
): { [key: string]: JsonValue } => {
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as JsonValue;
      return isObjectMetadata(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isObjectMetadata(metadata) ? metadata : {};
};

const firstCommitLine = (message: string) =>
  message.split(/\r?\n/)[0]?.trim() || "";

const mergeCommitSummaries = (
  commits: SessionCommitSummary[],
): SessionCommitSummary[] => {
  const seen = new Set<string>();
  return commits.filter((commit) => {
    if (seen.has(commit.sha)) return false;
    seen.add(commit.sha);
    return true;
  });
};

const commitSummaryFromRecord = (
  record: ProjectDeliveryRecord,
): SessionCommitSummary | null => {
  if (record.event_type !== "commit_created") return null;
  const metadata = parseRecordMetadata(record.metadata_json);
  const shaValue = metadata.commit_sha;
  const messageValue = metadata.message;
  const sha = typeof shaValue === "string" ? shaValue : record.external_id;
  if (!sha) return null;

  return {
    id: record.id,
    sha,
    message:
      typeof messageValue === "string"
        ? firstCommitLine(messageValue)
        : "Commit",
  };
};

const commitSummaryFromResponse = (
  response: SourceControlCommitResponse,
): SessionCommitSummary => ({
  id: response.commit_sha,
  sha: response.commit_sha,
  message: firstCommitLine(response.message),
});

function BatchActionButton({
  action,
  pending,
  onClick,
}: {
  action: SourceControlBatchAction;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || action.disabled}
      className="rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35"
      title={action.disabledReason ?? action.label}
    >
      {action.label}
    </button>
  );
}

function SessionCommitList({
  commits,
  expanded,
  onToggle,
  title,
  commitFallback,
}: {
  commits: SessionCommitSummary[];
  expanded: boolean;
  onToggle: () => void;
  title: string;
  commitFallback: string;
}) {
  if (commits.length === 0) return null;

  return (
    <div className="rounded-md text-[11px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-6 w-full items-center gap-1.5 px-2 text-left text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
          {commits.length}
        </span>
      </button>
      {expanded && (
        <div className="space-y-0.5 border-t border-[var(--hairline)] px-2 py-1">
          {commits.map((commit) => (
            <div
              key={commit.id}
              className="flex min-w-0 items-center gap-2 leading-5"
              title={`${commit.sha.slice(0, 5)} ${commit.message}`}
            >
              <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                {commit.sha.slice(0, 5)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--ink-subtle)]">
                {commit.message || commitFallback}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const SessionSourceControlPanel: React.FC<
  SessionSourceControlPanelProps
> = ({
  projectId,
  sessionId,
  enabled,
  worktreeMode,
  fallbackRelatedFiles,
  linkedWorkItemIds = [],
  focusRequestKey = 0,
  commitFocusRequestKey = 0,
  onOpenDiff,
  onOpenConflictResolver,
}) => {
  const { t, showToast } = useWorkspace();
  const commitCommandPresentation = useCommandPresentation(
    "source-control.commit",
  );
  const {
    status,
    loading,
    error,
    refresh: refreshSourceControl,
    stage,
    unstage,
    discard,
    commit,
  } = useSessionSourceControl({ projectId, sessionId, enabled });
  const worktreeEnabled = worktreeMode === "isolated";
  const {
    worktree,
    loading: worktreeLoading,
    error: worktreeError,
    refresh: refreshWorktree,
    prepare,
    merge: mergeWorktree,
    discard: discardWorktree,
    cleanup,
    retryCleanup,
    forceRemove,
  } = useSessionWorktree({
    sessionId,
    enabled: worktreeEnabled && enabled,
  });
  const scopeKey = `${enabled ? "1" : "0"}:${projectId ?? ""}:${
    sessionId ?? ""
  }:${worktreeMode ?? ""}`;
  const [commitMessagesByScope, setCommitMessagesByScope] =
    useState<ScopedTextState>({});
  const [pendingActionState, setPendingActionState] = useState<{
    scopeKey: string;
    key: string;
  } | null>(null);
  const [actionErrorsByScope, setActionErrorsByScope] =
    useState<ScopedErrorState>({});
  const [sessionCommits, setSessionCommits] = useState<
    SessionCommitSummary[]
  >([]);
  const [commitListExpanded, setCommitListExpanded] = useState(true);
  const [confirmDialog, setConfirmDialog] =
    useState<SourceControlConfirmDialogState | null>(null);
  const [worktreeHistoryScopeKey, setWorktreeHistoryScopeKey] = useState<
    string | null
  >(null);
  const [worktreeBusyScopeKey, setWorktreeBusyScopeKey] = useState<
    string | null
  >(null);
  const [worktreeActionErrorsByScope, setWorktreeActionErrorsByScope] =
    useState<ScopedErrorState>({});
  const [selectedFileKeysByScope, setSelectedFileKeysByScope] =
    useState<Record<string, string>>({});
  const scopeKeyRef = useRef(scopeKey);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const sourceControlListRef = useRef<HTMLDivElement>(null);
  const emptyStateHeadingRef = useRef<HTMLHeadingElement>(null);
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const fileRowRefs = useRef(new Map<string, HTMLDivElement>());
  const shortcutSelectionFocusKeyRef = useRef<string | null>(null);
  scopeKeyRef.current = scopeKey;

  const isCurrentScope = (key: string) => scopeKeyRef.current === key;
  const commitMessage = commitMessagesByScope[scopeKey] ?? "";
  const pendingAction =
    pendingActionState?.scopeKey === scopeKey ? pendingActionState.key : null;
  const actionError = scopedError(actionErrorsByScope, scopeKey);
  const worktreeActionError = scopedError(worktreeActionErrorsByScope, scopeKey);
  const showWorktreeHistory = worktreeHistoryScopeKey === scopeKey;
  const worktreeBusy = worktreeBusyScopeKey === scopeKey;
  const setActionErrorForScope = (key: string, message: string | null) => {
    setActionErrorsByScope((current) =>
      updateScopedError(current, key, message),
    );
  };
  const setWorktreeActionErrorForScope = (
    key: string,
    message: string | null,
  ) => {
    setWorktreeActionErrorsByScope((current) =>
      updateScopedError(current, key, message),
    );
  };
  const setCommitMessageForScope = (key: string, message: string) => {
    setCommitMessagesByScope((current) =>
      updateScopedText(current, key, message),
    );
  };
  const closeWorktreeHistoryForScope = (key: string) => {
    setWorktreeHistoryScopeKey((current) =>
      current === key ? null : current,
    );
  };

  const viewModel = useMemo(
    () => buildSourceControlViewModel(status, t),
    [status, t],
  );
  const files = useMemo<SelectableSourceControlFile[]>(
    () =>
      viewModel.sections.flatMap((section) =>
        section.files.map((file) => ({ ...file, area: section.area })),
      ),
    [viewModel],
  );
  const selectableFileKeys = files
    .map((file) => sourceControlSelectionKey(file.area, file.path))
    .join("\n");
  const selectedFileKey = selectedFileKeysByScope[scopeKey] ?? null;
  const selectedFile =
    files.find(
      (file) =>
        sourceControlSelectionKey(file.area, file.path) === selectedFileKey,
    ) ?? null;
  const tr = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => translateSourceControl(t, key, fallback, replacements);
  const title = tr("sourceControl.title", "File Changes");
  const refreshLabel = tr("sourceControl.refresh", "Refresh source control");
  const discardLabel = tr("sourceControl.action.discard", "Discard");
  const commitLabel = tr("sourceControl.action.commit", "Commit");
  const worktreeMergeDisabledReason =
    worktree?.has_unmerged_commits
      ? null
      : tr(
          "worktree.reason.noUnmergedCommits",
          "No new worktree commits to merge.",
        );

  useEffect(() => {
    if (!enabled || !projectId || !sessionId) {
      setSessionCommits([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const records = await deliveryApi.listRecords(projectId);
        if (cancelled) return;
        setSessionCommits(
          mergeCommitSummaries(
            records
              .filter((record) => record.source_session_id === sessionId)
              .map(commitSummaryFromRecord)
              .filter(
                (commit): commit is SessionCommitSummary => commit !== null,
              ),
          ),
        );
      } catch {
        if (!cancelled) setSessionCommits([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, sessionId]);

  useEffect(() => {
    if (worktree?.status !== "merged") {
      closeWorktreeHistoryForScope(scopeKey);
    }
  }, [scopeKey, worktree?.status]);

  useEffect(() => {
    const firstFile = files[0];
    const nextKey = files.some(
      (file) =>
        sourceControlSelectionKey(file.area, file.path) === selectedFileKey,
    )
      ? selectedFileKey
      : firstFile
        ? sourceControlSelectionKey(firstFile.area, firstFile.path)
        : null;
    setSelectedFileKeysByScope((current) => {
      if ((current[scopeKey] ?? null) === nextKey) return current;
      const next = { ...current };
      if (nextKey) next[scopeKey] = nextKey;
      else delete next[scopeKey];
      return next;
    });
  }, [scopeKey, selectableFileKeys, selectedFileKey]);

  useLayoutEffect(() => {
    const key = shortcutSelectionFocusKeyRef.current;
    if (!key || selectedFileKey !== key || !selectedFile) return;
    fileRowRefs.current.get(key)?.focus();
    shortcutSelectionFocusKeyRef.current = null;
  }, [selectableFileKeys, selectedFile, selectedFileKey]);

  useEffect(() => {
    if (!focusRequestKey || !enabled || !projectId || !sessionId) return;
    const frame = window.requestAnimationFrame(() => {
      const firstFile = files[0];
      const key =
        selectedFileKeysByScope[scopeKey] ??
        (firstFile
          ? sourceControlSelectionKey(firstFile.area, firstFile.path)
          : null);
      if (key) fileRowRefs.current.get(key)?.focus();
      else emptyStateHeadingRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    enabled,
    focusRequestKey,
    projectId,
    scopeKey,
    selectableFileKeys,
    selectedFileKeysByScope,
    sessionId,
  ]);

  useEffect(() => {
    if (
      !commitFocusRequestKey ||
      !enabled ||
      !projectId ||
      !sessionId ||
      viewModel.stagedPaths.length === 0
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      commitMessageRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    commitFocusRequestKey,
    enabled,
    projectId,
    sessionId,
    viewModel.stagedPaths.length,
  ]);

  if (!enabled || !projectId || !sessionId) {
    return <>{fallbackRelatedFiles}</>;
  }

  const handleConfirmedWorktreeAction = async (
    action: SessionWorktreeAction,
  ) => {
    if (worktreeBusy) return;
    const actionScopeKey = scopeKeyRef.current;
    if (action === "merge" && worktreeMergeDisabledReason) return;
    setWorktreeBusyScopeKey(actionScopeKey);
    setWorktreeActionErrorForScope(actionScopeKey, null);
    try {
      switch (action) {
        case "prepare":
          await prepare();
          break;
        case "merge":
          await mergeWorktree();
          break;
        case "discard":
          await discardWorktree();
          break;
        case "cleanup":
          await cleanup();
          break;
        case "retry-cleanup":
          await retryCleanup();
          break;
        case "force-remove":
          await forceRemove();
          break;
        case "resolve-conflicts":
          onOpenConflictResolver(projectId, sessionId);
          break;
        case "view-history":
          setWorktreeHistoryScopeKey(actionScopeKey);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWorktreeActionErrorForScope(actionScopeKey, message);
      if (isCurrentScope(actionScopeKey)) {
        showToast(
          tr(
            "worktree.error.actionFailed",
            "Worktree action failed: {message}",
            { message },
          ),
          "error",
        );
      }
    } finally {
      setWorktreeBusyScopeKey((current) =>
        current === actionScopeKey ? null : current,
      );
    }
  };

  const runOperation = async (
    key: string,
    operation: () => Promise<{ ok?: boolean; failed?: { message: string }[] }>,
    options: { trackPending?: boolean } = {},
  ) => {
    const trackPending = options.trackPending ?? true;
    const operationScopeKey = scopeKeyRef.current;
    if (trackPending) {
      setPendingActionState({ scopeKey: operationScopeKey, key });
    }
    setActionErrorForScope(operationScopeKey, null);
    try {
      const response = await operation();
      const firstFailure = response.failed?.[0]?.message;
      if (response.ok === false && firstFailure) {
        setActionErrorForScope(operationScopeKey, firstFailure);
      }
    } catch (err) {
      setActionErrorForScope(operationScopeKey, actionErrorMessage(err));
    } finally {
      if (trackPending) {
        setPendingActionState((current) =>
          current?.scopeKey === operationScopeKey && current.key === key
            ? null
            : current,
        );
      }
    }
  };

  const requestConfirm = (
    request: Omit<SourceControlConfirmDialogState, "resolve">,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      setConfirmDialog({ ...request, resolve });
    });

  const confirmCopy: Record<
    "merge" | "discard",
    Omit<SourceControlConfirmDialogState, "resolve">
  > = {
    merge: {
      title: tr("worktree.confirm.mergeTitle", "Merge worktree?"),
      description: tr(
        "worktree.confirm.mergeDescription",
        "Merge this session worktree into the base workspace?",
      ),
      confirmLabel: tr("worktree.action.merge", "Merge"),
      tone: "warning",
    },
    discard: {
      title: tr("worktree.confirm.deleteTitle", "Delete worktree?"),
      description: tr(
        "worktree.confirm.deleteDescription",
        "Delete this session worktree? Unmerged changes in the isolated workspace will be removed. This cannot be undone.",
      ),
      confirmLabel: tr("worktree.action.discard", "Delete"),
      tone: "danger",
    },
  };

  const requestWorktreeAction = async (action: "merge" | "discard") => {
    const requestScopeKey = scopeKeyRef.current;
    const confirmed = await requestConfirm(confirmCopy[action]);
    if (!isCurrentScope(requestScopeKey)) return;
    if (confirmed) await handleConfirmedWorktreeAction(action);
  };

  const closeConfirmDialog = (confirmed: boolean) => {
    const request = confirmDialog;
    if (!request) return;
    setConfirmDialog(null);
    request.resolve(confirmed);
  };

  const getSharedForce = async (
    files: SourceControlFile[],
    actionLabel: string,
  ): Promise<boolean | null> => {
    if (!sourceControlHasSharedFiles(files)) return false;
    const confirmed = await requestConfirm({
      title: tr(
        "sourceControl.confirm.sharedTitle",
        "{action} shared files?",
        { action: actionLabel },
      ),
      description: tr(
        "sourceControl.confirm.sharedDescription",
        "This operation includes files touched by another active session. Continue only if you intend to override that shared protection.",
      ),
      confirmLabel: actionLabel,
      tone: "warning",
    });
    return confirmed ? true : null;
  };

  const handleStageFiles = (files: SourceControlFile[]) => {
    if (files.length === 0) return;
    const paths = sourceControlVisiblePaths(files);
    void runOperation(`stage:${paths.join("|")}`, () =>
      stage({
        workspace_id: viewModel.workspaceId,
        paths,
      }),
      { trackPending: false },
    );
  };

  const handleUnstageFiles = (files: SourceControlFile[]) => {
    if (files.length === 0) return;
    const paths = sourceControlVisiblePaths(files);
    void runOperation(`unstage:${paths.join("|")}`, () =>
      unstage({
        workspace_id: viewModel.workspaceId,
        paths,
      }),
      { trackPending: false },
    );
  };

  const handleDiscardFiles = (files: SourceControlFile[]) => {
    if (files.length === 0) return;
    const operationScopeKey = scopeKeyRef.current;
    void (async () => {
      const discardConfirmed = await requestConfirm({
        title: tr("sourceControl.confirm.discardTitle", "Discard changes?"),
        description: tr(
          "sourceControl.confirm.discardDescription",
          "Discard changes for {paths}? This cannot be undone.",
          { paths: describePaths(files, t) },
        ),
        confirmLabel: discardLabel,
        tone: "danger",
      });
      if (!isCurrentScope(operationScopeKey)) return;
      if (!discardConfirmed) return;
      const forceShared = await getSharedForce(files, discardLabel);
      if (!isCurrentScope(operationScopeKey)) return;
      if (forceShared === null) return;
      const paths = sourceControlVisiblePaths(files);
      await runOperation(`discard:${paths.join("|")}`, () =>
        discard({
          workspace_id: viewModel.workspaceId,
          paths,
          force_shared: forceShared || undefined,
          expected_head_sha: viewModel.headSha,
        }),
      );
    })();
  };

  const handleOpenDiff = (
    file: SourceControlFile,
    area: SourceControlDiffArea,
  ) => {
    onOpenDiff(projectId, sessionId, file.path, area);
  };

  const handleBatchAction = (
    action: SourceControlBatchAction,
    section: SourceControlSectionViewModel,
  ) => {
    if (action.disabled || pendingAction) return;
    if (action.id === 'stage-all') {
      handleStageFiles(section.files);
      return;
    }
    if (action.id === "unstage-all") {
      handleUnstageFiles(section.files);
      return;
    }
    handleDiscardFiles(section.files);
  };

  const handleCommit = () => {
    const message = commitMessage.trim();
    if (!message || !viewModel.canCommit) return;
    const stagedSection = findSection(viewModel, "staged");
    const stagedFiles = stagedSection?.files ?? [];
    const commitScopeKey = scopeKeyRef.current;
    void (async () => {
      const forceShared = await getSharedForce(stagedFiles, commitLabel);
      if (!isCurrentScope(commitScopeKey)) return;
      if (forceShared === null) return;

      await runOperation("commit", async () => {
        const response = await commit({
          workspace_id: viewModel.workspaceId,
          message,
          expected_staged_paths: viewModel.stagedPaths,
          force_shared: forceShared || undefined,
          work_item_ids: linkedWorkItemIds,
          expected_head_sha: viewModel.headSha,
        });
        await refreshWorktree();
        if (!isCurrentScope(commitScopeKey)) return { ok: true, failed: [] };
        setSessionCommits((current) =>
          mergeCommitSummaries([
            commitSummaryFromResponse(response),
            ...current,
          ]),
        );
        setCommitMessageForScope(commitScopeKey, "");
        return { ok: true, failed: [] };
      });
    })();
  };

  const changesSection = findSection(viewModel, "changes");
  const stageAllAction = changesSection?.batchActions.find(
    (action) => action.id === 'stage-all',
  );
  const canStageAll = Boolean(
    changesSection &&
      stageAllAction &&
      changesSection.files.length > 0 &&
      !stageAllAction.disabled &&
      !pendingAction,
  );

  const selectFile = (area: SourceControlDiffArea, path: string) => {
    const key = sourceControlSelectionKey(area, path);
    setSelectedFileKeysByScope((current) => ({
      ...current,
      [scopeKey]: key,
    }));
  };

  const moveSelection = (offset: -1 | 1) => {
    if (files.length === 0) return;
    const currentIndex = Math.max(
      0,
      files.findIndex(
        (file) =>
          sourceControlSelectionKey(file.area, file.path) === selectedFileKey,
      ),
    );
    const nextFile = files[(currentIndex + offset + files.length) % files.length];
    const nextKey = sourceControlSelectionKey(nextFile.area, nextFile.path);
    selectFile(nextFile.area, nextFile.path);
    window.requestAnimationFrame(() =>
      fileRowRefs.current.get(nextKey)?.focus(),
    );
  };

  const handleToggleSelectedStage = (
    selectedFile: SelectableSourceControlFile,
  ) => {
    const nextArea = selectedFile.area === "changes" ? "staged" : "changes";
    const nextKey = sourceControlSelectionKey(nextArea, selectedFile.path);
    shortcutSelectionFocusKeyRef.current = nextKey;
    selectFile(nextArea, selectedFile.path);
    if (selectedFile.area === "changes") handleStageFiles([selectedFile]);
    else handleUnstageFiles([selectedFile]);
  };

  const handleOpenSelectedDiff = (
    selectedFile: SelectableSourceControlFile,
  ) => handleOpenDiff(selectedFile, selectedFile.area);

  const handleStageAll = () => {
    if (changesSection && stageAllAction) {
      handleBatchAction(stageAllAction, changesSection);
    }
  };

  if (!status && !error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
          {title}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-3 py-3 text-[12px] text-[var(--ink-tertiary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {tr("sourceControl.loading", "Loading source-control status...")}
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[var(--ink)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => void refreshSourceControl()}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-3 py-3 text-[12px] text-rose-500">
          {error.message}
        </div>
      </div>
    );
  }

  const externalStagedCount = viewModel.externalStagedPaths.length;
  const externalStagedHint =
    externalStagedCount > 0
      ? tr("sourceControl.externalStagedCount", "External staged: {count}", {
          count: externalStagedCount,
        })
      : "";
  return (
    <>
      <div ref={panelRootRef} className="flex min-h-0 flex-1 flex-col">
      <SessionSourceControlShortcutBindings
        panelRootRef={panelRootRef}
        listRootRef={sourceControlListRef}
        commitMessageRef={commitMessageRef}
        worktreeActive={Boolean(worktree)}
        files={files}
        selectedFile={selectedFile}
        viewModel={viewModel}
        canStageAll={canStageAll}
        commitMessage={commitMessage}
        mergeDisabledReason={worktreeMergeDisabledReason}
        onMoveSelection={moveSelection}
        onToggleStage={handleToggleSelectedStage}
        onOpenDiff={handleOpenSelectedDiff}
        onStageAll={handleStageAll}
        onCommit={handleCommit}
        requestWorktreeAction={(action) => void requestWorktreeAction(action)}
      />
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[14px] font-semibold text-[var(--ink)]">
            {title}
          </h2>
          {viewModel.branch && (
            <span
              className="truncate rounded border border-[color-mix(in_srgb,var(--hairline)_46%,transparent)] bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]"
              title={viewModel.branch}
            >
              {viewModel.branch}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshSourceControl()}
          disabled={loading || Boolean(pendingAction)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
          title={refreshLabel}
          aria-label={refreshLabel}
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {worktreeEnabled && (
        <>
          <SessionWorktreeBadge
            worktree={worktree}
            pendingCreate={!worktree && !worktreeLoading}
            busy={worktreeBusy}
            mergeDisabledReason={worktreeMergeDisabledReason}
            onAction={(action) =>
              void (action === "merge" || action === "discard"
                ? requestWorktreeAction(action)
                : handleConfirmedWorktreeAction(action))
            }
            tr={tr}
          />
          {showWorktreeHistory && worktree?.status === "merged" && (
            <WorktreeMergeHistorySection
              worktree={worktree}
              commits={sessionCommits}
              tr={tr}
              onClose={() => closeWorktreeHistoryForScope(scopeKey)}
            />
          )}
        </>
      )}

      <ScrollArea className="flex-1 px-3 pb-3">
        {externalStagedCount > 0 && (
          <div className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-2.5 py-2 text-[11px] text-[var(--ink-tertiary)]">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ink-tertiary)]" />
              <span>{externalStagedHint}</span>
            </div>
          </div>
        )}
        {(viewModel.blockedReason || actionError || worktreeActionError) && (
          <div className="mb-3 space-y-1">
            {viewModel.blockedReason && (
              <div className="flex gap-2 rounded-lg border border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-2.5 py-2 text-[11px] text-[var(--ink-tertiary)]">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink-subtle)]" />
                <span>{viewModel.blockedReason}</span>
              </div>
            )}
            {actionError && (
              <div className="select-text whitespace-pre-wrap break-words rounded-lg border border-[color-mix(in_srgb,#f43f5e_20%,var(--hairline))] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-2.5 py-2 text-[11px] text-rose-500">
                {actionError}
              </div>
            )}
            {worktreeActionError && (
              <div className="select-text whitespace-pre-wrap break-words rounded-lg border border-[color-mix(in_srgb,#f43f5e_20%,var(--hairline))] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-2.5 py-2 text-[11px] text-rose-500">
                {worktreeActionError}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <SessionCommitList
            commits={sessionCommits}
            expanded={commitListExpanded}
            onToggle={() => setCommitListExpanded((expanded) => !expanded)}
            title={tr("sourceControl.sessionCommits", "Session commits")}
            commitFallback={tr("sourceControl.commit.fallback", "Commit")}
          />
          {files.length === 0 && (
            <h3
              ref={emptyStateHeadingRef}
              tabIndex={-1}
              className="rounded-lg border border-dashed border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] px-3 py-2 text-[12px] font-normal text-[var(--ink-tertiary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
            >
              {tr('sourceControl.empty.noChanges', 'No file changes')}
            </h3>
          )}
          <div ref={sourceControlListRef} className="space-y-4">
          {viewModel.sections.map((section) => (
            <section key={section.id} className="space-y-1.5">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h3 className="truncate text-[13px] font-medium text-[var(--ink-subtle)]">
                    {section.title}
                  </h3>
                  <span className="rounded border border-[color-mix(in_srgb,var(--hairline)_76%,transparent)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {section.files.length}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {section.batchActions.map((action) => (
                    <BatchActionButton
                      key={action.id}
                      action={action}
                      pending={Boolean(pendingAction)}
                      onClick={() => handleBatchAction(action, section)}
                    />
                  ))}
                </div>
              </div>
              {section.files.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] px-3 py-2 text-[12px] text-[var(--ink-tertiary)]">
                  {section.emptyLabel}
                </div>
              ) : (
                <div className="space-y-1">
                  {section.files.map((file) => {
                    const fileKey = sourceControlSelectionKey(
                      section.area,
                      file.path,
                    );
                    return (
                      <SourceControlFileRow
                        key={`${section.id}-${file.status}-${file.path}`}
                        file={file}
                        area={section.area}
                        viewModel={viewModel}
                        pending={Boolean(pendingAction)}
                        selected={selectedFileKey === fileKey}
                        rowRef={(node) => {
                          if (node) fileRowRefs.current.set(fileKey, node);
                          else fileRowRefs.current.delete(fileKey);
                        }}
                        t={t}
                        onOpenDiff={handleOpenDiff}
                        onStage={(target) => handleStageFiles([target])}
                        onUnstage={(target) => handleUnstageFiles([target])}
                        onDiscard={(target) => handleDiscardFiles([target])}
                        onSelect={(path) => selectFile(section.area, path)}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          ))}
          </div>
        </div>
      </ScrollArea>

      {viewModel.stagedPaths.length > 0 && (
        <div className="shrink-0 border-t border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] p-3">
          <textarea
            ref={commitMessageRef}
            tabIndex={-1}
            onKeyDown={preventTabFocusChange}
            aria-keyshortcuts={
              commitCommandPresentation.ariaKeyShortcuts || undefined
            }
            value={commitMessage}
            onChange={(event) =>
              setCommitMessageForScope(scopeKey, event.target.value)
            }
            rows={2}
            className="mb-2 min-h-14 w-full resize-none rounded-lg border border-[color-mix(in_srgb,var(--hairline)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-1)_76%,var(--canvas))] px-2.5 py-1.5 text-[12px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[color-mix(in_srgb,var(--primary)_60%,var(--hairline))]"
            placeholder={tr("sourceControl.commitPlaceholder", "commit message")}
          />
          <button
            type="button"
            data-command-id="source-control.commit"
            onClick={handleCommit}
            disabled={
              Boolean(pendingAction) ||
              !viewModel.canCommit ||
              !commitMessage.trim()
            }
            className="flex h-7 w-full items-center justify-center whitespace-nowrap rounded-[6px] bg-[color-mix(in_srgb,var(--primary)_82%,var(--surface-1))] px-3 text-[12px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary)] disabled:cursor-not-allowed disabled:bg-[var(--surface-3)] disabled:text-[var(--ink-tertiary)] disabled:opacity-80"
            title={
              !commitMessage.trim()
                ? tr(
                    "sourceControl.commit.enterMessage",
                    "Enter a commit message",
                  )
                : (viewModel.commitDisabledReason ??
                  tr(
                    "sourceControl.commit.stagedChanges",
                    "Commit staged changes",
                  ))
            }
          >
            {pendingAction === "commit"
              ? tr("sourceControl.commit.committing", "Committing...")
              : viewModel.externalStagedPaths.length > 0 &&
                  !viewModel.blockedReason
                ? tr(
                    "sourceControl.commit.externalStagedBlocked",
                    "存在外部暂存",
                  )
                : commitLabel}
          </button>
        </div>
      )}
      </div>
      {confirmDialog && (
        <ConfirmationDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={t("cancel")}
          escLabel={t("escToCancel")}
          tone={confirmDialog.tone}
          idPrefix="source-control-confirm"
          onCancel={() => closeConfirmDialog(false)}
          onConfirm={() => closeConfirmDialog(true)}
        />
      )}
    </>
  );
};
