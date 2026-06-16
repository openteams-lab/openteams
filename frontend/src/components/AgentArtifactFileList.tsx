import React from "react";
import { ChevronRight } from "lucide-react";
import { SourceControlFileTypeIcon } from "@/components/source-control/SourceControlFileRow";
import { normalizeArtifactPath } from "@/lib/parseStructuredReply";
import type { ArtifactItem } from "@/types";

/**
 * Maximum number of artifact rows rendered inline. Beyond this, a
 * "+N more" footer is shown so a single agent message can't overwhelm the
 * conversation.
 */
const MAX_VISIBLE_ROWS = 50;

export interface ArtifactDiffStat {
  add: number;
  del: number;
}

interface AgentArtifactFileListProps {
  artifacts: ArtifactItem[];
  /** Optional per-path diff stats (additions/deletions). When a path has no
   * entry, the row renders path-only (no counts column, no spinner). */
  diffStats?: Map<string, ArtifactDiffStat>;
  onOpen: (path: string) => void;
  title: string;
  moreLabel: (hiddenCount: number) => string;
}

/**
 * Compact, Linear-style list of artifact file paths pinned to the bottom of
 * an agent message. Reuses the file-type icon and design tokens from the
 * source-control file row.
 */
export const AgentArtifactFileList: React.FC<AgentArtifactFileListProps> = ({
  artifacts,
  diffStats,
  onOpen,
  title,
  moreLabel,
}) => {
  if (artifacts.length === 0) return null;

  const visible = artifacts.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = artifacts.length - visible.length;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-tertiary)]">
        <span>{title}</span>
        <span className="rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-1.5 py-px font-mono text-[10px] text-[var(--ink-subtle)]">
          {artifacts.length}
        </span>
      </div>
      <div className="flex flex-col">
        {visible.map((artifact, index) => {
          const stat = diffStats?.get(normalizeArtifactPath(artifact.path));
          const hasCounts = Boolean(stat && (stat.add > 0 || stat.del > 0));
          return (
            <button
              key={`${artifact.path}-${index}`}
              type="button"
              onClick={() => onOpen(artifact.path)}
              title={artifact.path}
              className="group/artifact flex min-h-9 w-full items-center gap-2 px-2 py-1 text-left transition-colors hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
            >
              <SourceControlFileTypeIcon path={artifact.path} />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--ink)]">
                {artifact.path}
              </span>
              {hasCounts && stat && (
                <span className="flex shrink-0 items-center gap-1 font-mono text-[12px] font-semibold">
                  {stat.add > 0 && (
                    <span className="text-emerald-600">+{stat.add}</span>
                  )}
                  {stat.del > 0 && (
                    <span className="text-rose-500">-{stat.del}</span>
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
