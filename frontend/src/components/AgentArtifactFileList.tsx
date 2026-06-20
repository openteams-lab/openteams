import React from "react";
import { ChevronRight } from "lucide-react";
import { SourceControlFileTypeIcon } from "@/components/source-control/SourceControlFileRow";
import type { AgentFileRow } from "@/lib/agentFileRows";

/**
 * Maximum number of file rows rendered inline. Beyond this, a "+N more"
 * footer is shown so a single agent message can't overwhelm the conversation.
 */
const MAX_VISIBLE_ROWS = 50;

interface AgentArtifactFileListProps {
  files: AgentFileRow[];
  onOpen: (file: AgentFileRow) => void;
  title: string;
  moreLabel: (hiddenCount: number) => string;
}

/**
 * Compact, Linear-style list of changed/artifact files pinned to the bottom of
 * an agent message. Rows come from the per-run diff (with +/- counts and
 * status) plus supplementary artifact-mentioned paths. Reuses the file-type
 * icon and design tokens from the source-control file row.
 */
export const AgentArtifactFileList: React.FC<AgentArtifactFileListProps> = ({
  files,
  onOpen,
  title,
  moreLabel,
}) => {
  if (files.length === 0) return null;

  const visible = files.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = files.length - visible.length;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-tertiary)]">
        <span>{title}</span>
        <span className="rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-1.5 py-px font-mono text-[10px] text-[var(--ink-subtle)]">
          {files.length}
        </span>
      </div>
      <div className="flex flex-col">
        {visible.map((file, index) => {
          const hasCounts =
            typeof file.additions === "number" ||
            typeof file.deletions === "number";
          const additions = file.additions ?? 0;
          const deletions = file.deletions ?? 0;
          const showCounts = hasCounts && (additions > 0 || deletions > 0);
          return (
            <button
              key={`${file.path}-${index}`}
              type="button"
              onClick={() => onOpen(file)}
              title={file.path}
              className="group/artifact flex min-h-9 w-full items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
            >
              <SourceControlFileTypeIcon path={file.path} />
              <span
                className={`min-w-0 flex-1 truncate font-mono text-[13px] ${
                  file.supplementary
                    ? "text-[var(--ink-subtle)]"
                    : "text-[var(--ink)]"
                }`}
              >
                {file.path}
              </span>
              {showCounts && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[12px] font-semibold">
                  {additions > 0 && (
                    <span className="text-emerald-600">+{additions}</span>
                  )}
                  {deletions > 0 && (
                    <span className="text-rose-500">-{deletions}</span>
                  )}
                </span>
              )}
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)] opacity-0 transition group-hover/artifact:opacity-100" />
            </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div className="border-t border-[var(--hairline)] px-2.5 py-1 text-center text-[11px] text-[var(--ink-tertiary)]">
          {moreLabel(hiddenCount)}
        </div>
      )}
    </div>
  );
};
