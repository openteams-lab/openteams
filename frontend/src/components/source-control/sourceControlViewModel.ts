import type {
  SessionSourceControlStatus,
  SourceControlDiffArea,
  SourceControlFile,
  SourceControlFileStatus,
} from "@/types";

export type SourceControlPanelMode = "empty" | "git" | "plain";
export type SourceControlSectionId = "changes" | "staged";
export type SourceControlFileAction = "stage" | "unstage" | "discard";
export type SourceControlTranslator = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

export interface SourceControlBatchAction {
  id: "stage-all" | "unstage-all" | "discard-all";
  label: string;
  disabled: boolean;
  disabledReason: string | null;
}

export interface SourceControlSectionViewModel {
  id: SourceControlSectionId;
  area: SourceControlDiffArea;
  title: string;
  emptyLabel: string;
  files: SourceControlFile[];
  batchActions: SourceControlBatchAction[];
}

export interface SourceControlPanelViewModel {
  mode: SourceControlPanelMode;
  workspaceId: string | null;
  workspacePath: string | null;
  branch: string | null;
  headSha: string | null;
  blockedReason: string | null;
  externalStagedPaths: string[];
  detachedHead: boolean;
  operationInProgress: string | null;
  sections: SourceControlSectionViewModel[];
  stagedPaths: string[];
  canCommit: boolean;
  commitDisabledReason: string | null;
}

const statusLabels: Record<SourceControlFileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
  renamed: "R",
  copied: "C",
  type_changed: "T",
};

export const sourceControlStatusLabel = (
  status: SourceControlFileStatus,
): string => statusLabels[status];

export const translateSourceControl = (
  t: SourceControlTranslator | undefined,
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => {
  const translated = t?.(key, replacements);
  const text = translated && translated !== key ? translated : fallback;
  if (!replacements) return text;
  return Object.entries(replacements).reduce(
    (current, [name, value]) =>
      current.replace(`{${name}}`, String(value)),
    text,
  );
};

export const sourceControlVisiblePaths = (
  files: SourceControlFile[],
): string[] => files.map((file) => file.path);

export const sourceControlHasSharedFiles = (
  files: SourceControlFile[],
): boolean => files.some((file) => file.shared);

const writeBlockReason = (
  status: Extract<SessionSourceControlStatus, { mode: "git" }>,
  t?: SourceControlTranslator,
): string | null => {
  if (status.operation_in_progress) {
    return translateSourceControl(
      t,
      "sourceControl.reason.gitOperationInProgress",
      "Git {operation} is in progress.",
      { operation: status.operation_in_progress.replaceAll("_", " ") },
    );
  }
  if (status.detached_head) {
    return translateSourceControl(
      t,
      "sourceControl.reason.detachedHead",
      "Repository is in detached HEAD state.",
    );
  }
  return status.blocked_reason;
};

const makeBatchAction = (
  id: SourceControlBatchAction["id"],
  label: string,
  files: SourceControlFile[],
  writeDisabledReason: string | null,
  t?: SourceControlTranslator,
): SourceControlBatchAction => {
  const emptyReason =
    files.length === 0
      ? translateSourceControl(
          t,
          "sourceControl.reason.noFilesInSection",
          "No files in this section.",
        )
      : null;
  const disabledReason = writeDisabledReason ?? emptyReason;
  return {
    id,
    label,
    disabled: Boolean(disabledReason),
    disabledReason,
  };
};

const commitDisabledReason = (
  status: Extract<SessionSourceControlStatus, { mode: "git" }>,
  stagedPaths: string[],
  writeDisabledReason: string | null,
  t?: SourceControlTranslator,
): string | null => {
  if (writeDisabledReason) return writeDisabledReason;
  if (status.external_staged_paths.length > 0) {
    return translateSourceControl(
      t,
      "sourceControl.reason.externalStaged",
      "There are staged files outside this session.",
    );
  }
  if (stagedPaths.length === 0) {
    return translateSourceControl(
      t,
      "sourceControl.reason.noStagedFiles",
      "No staged files to commit.",
    );
  }
  return null;
};

export const buildSourceControlViewModel = (
  status: SessionSourceControlStatus | null,
  t?: SourceControlTranslator,
): SourceControlPanelViewModel => {
  if (!status) {
    return {
      mode: "empty",
      workspaceId: null,
      workspacePath: null,
      branch: null,
      headSha: null,
      blockedReason: null,
      externalStagedPaths: [],
      detachedHead: false,
      operationInProgress: null,
      sections: [],
      stagedPaths: [],
      canCommit: false,
      commitDisabledReason: translateSourceControl(
        t,
        "sourceControl.reason.statusNotLoaded",
        "Source control status is not loaded.",
      ),
    };
  }

  if (status.mode === "plain") {
    return {
      mode: "plain",
      workspaceId: status.workspace_id,
      workspacePath: status.workspace_path,
      branch: null,
      headSha: null,
      blockedReason: null,
      externalStagedPaths: [],
      detachedHead: false,
      operationInProgress: null,
      sections: [
        {
          id: "changes",
          area: "changes",
          title: translateSourceControl(
            t,
            "sourceControl.section.relatedFiles",
            "Related Files",
          ),
          emptyLabel: translateSourceControl(
            t,
            "sourceControl.section.noChangedFiles",
            "No changed files",
          ),
          files: status.files,
          batchActions: [],
        },
      ],
      stagedPaths: [],
      canCommit: false,
      commitDisabledReason: translateSourceControl(
        t,
        "sourceControl.reason.plainUnsupported",
        "Plain workspaces do not support commits here.",
      ),
    };
  }

  const stagedPaths = sourceControlVisiblePaths(status.staged_changes);
  const writeDisabledReason = writeBlockReason(status, t);
  const disabledCommitReason = commitDisabledReason(
    status,
    stagedPaths,
    writeDisabledReason,
    t,
  );

  return {
    mode: "git",
    workspaceId: status.workspace_id,
    workspacePath: status.workspace_path,
    branch: status.branch,
    headSha: status.head_sha,
    blockedReason: writeDisabledReason,
    externalStagedPaths: status.external_staged_paths,
    detachedHead: status.detached_head,
    operationInProgress: status.operation_in_progress,
    sections: [
      {
        id: "staged",
        area: "staged",
        title: translateSourceControl(
          t,
          "sourceControl.section.stagedChanges",
          "Staged Changes",
        ),
        emptyLabel: translateSourceControl(
          t,
          "sourceControl.section.noStagedChanges",
          "No staged changes",
        ),
        files: status.staged_changes,
        batchActions: [
          makeBatchAction(
            "unstage-all",
            translateSourceControl(
              t,
              "sourceControl.action.unstageAll",
              "Unstage All",
            ),
            status.staged_changes,
            writeDisabledReason,
            t,
          ),
        ],
      },
      {
        id: "changes",
        area: "changes",
        title: translateSourceControl(
          t,
          "sourceControl.section.changes",
          "Changes",
        ),
        emptyLabel: translateSourceControl(
          t,
          "sourceControl.section.noUnstagedChanges",
          "No unstaged changes",
        ),
        files: status.changes,
        batchActions: [
          makeBatchAction(
            "stage-all",
            translateSourceControl(
              t,
              "sourceControl.action.stageAll",
              "Stage All",
            ),
            status.changes,
            writeDisabledReason,
            t,
          ),
          makeBatchAction(
            "discard-all",
            translateSourceControl(
              t,
              "sourceControl.action.discardAll",
              "Discard All",
            ),
            status.changes,
            writeDisabledReason,
            t,
          ),
        ],
      },
    ],
    stagedPaths,
    canCommit: disabledCommitReason === null,
    commitDisabledReason: disabledCommitReason,
  };
};

export const getFileActionDisabledReason = (
  viewModel: SourceControlPanelViewModel,
  _file: SourceControlFile,
  _action: SourceControlFileAction,
  t?: SourceControlTranslator,
): string | null => {
  if (viewModel.mode !== "git") {
    return translateSourceControl(
      t,
      "sourceControl.reason.unavailable",
      "Source control is not available.",
    );
  }
  return viewModel.blockedReason;
};
