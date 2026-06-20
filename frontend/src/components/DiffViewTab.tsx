import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ScrollArea";
import { filesystemApi, projectSourceControlApi } from "@/lib/api";
import { parseUnifiedDiff, alignSplitLines } from "@/lib/parseDiff";
import type { DiffLine, DiffHunk, SplitRow } from "@/lib/parseDiff";
import type {
  SourceControlDiffArea,
  SourceControlDiffResponse,
} from "@/types";

interface DiffViewTabProps {
  filePath?: string;
  status?: string;
  unifiedDiff?: string;
  workspacePath?: string;
  sourceControlRef?: {
    projectId: string;
    sessionId: string;
    filePath: string;
    area: SourceControlDiffArea;
  };
}

const MAX_DIFF_SIZE = 300_000;

const countStats = (hunks: DiffHunk[]) => {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "addition") additions++;
      if (line.type === "deletion") deletions++;
    }
  }
  return { additions, deletions };
};

const DIFF_VIEW_COLORS = {
  canvas: "var(--diff-view-canvas, #0b0b0c)",
  surface: "var(--diff-view-surface, #121316)",
  separator: "var(--diff-view-separator, rgba(255, 255, 255, 0.08))",
  separatorSolid: "var(--diff-view-separator-solid, #1c1c1f)",
  addedBg: "var(--diff-view-added-bg, rgba(46, 214, 137, 0.08))",
  addedBorder: "var(--diff-view-added-border, #2ed689)",
  addedSymbol: "var(--diff-view-added-symbol, rgba(74, 222, 128, 0.9))",
  removedBg: "var(--diff-view-removed-bg, rgba(242, 95, 114, 0.08))",
  removedBorder: "var(--diff-view-removed-border, #f25f72)",
  removedSymbol: "var(--diff-view-removed-symbol, rgba(248, 113, 113, 0.9))",
};

const getDiffLineStyle = (lineType: DiffLine["type"]) => {
  if (lineType === "addition") {
    return {
      backgroundColor: DIFF_VIEW_COLORS.addedBg,
      borderLeftColor: DIFF_VIEW_COLORS.addedBorder,
    };
  }

  if (lineType === "deletion") {
    return {
      backgroundColor: DIFF_VIEW_COLORS.removedBg,
      borderLeftColor: DIFF_VIEW_COLORS.removedBorder,
    };
  }

  return { borderLeftColor: "transparent" };
};

const getDiffSignColor = (lineType: DiffLine["type"]) => {
  if (lineType === "addition") return DIFF_VIEW_COLORS.addedSymbol;
  if (lineType === "deletion") return DIFF_VIEW_COLORS.removedSymbol;
  return "var(--ink-tertiary)";
};

const DiffLineRow: React.FC<{
  line: DiffLine;
}> = ({ line }) => {
  const prefix =
    line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";

  return (
    <div
      className="flex border-l-2 font-mono text-[13px] leading-[1.5]"
      style={getDiffLineStyle(line.type)}
    >
      <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
        {line.oldLineNo ?? ""}
      </span>
      <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
        {line.newLineNo ?? ""}
      </span>
      <span
        className="w-4 shrink-0 text-center select-none"
        style={{ color: getDiffSignColor(line.type) }}
      >
        {prefix}
      </span>
      <span className="flex-1 px-2 whitespace-pre-wrap break-words text-[var(--ink)]">
        {line.content}
      </span>
    </div>
  );
};

const SplitLineRow: React.FC<{
  row: SplitRow;
}> = ({ row }) => {
  const renderSide = (line: DiffLine | null, side: "left" | "right") => {
    if (!line) {
      return (
        <div className="flex-1 flex border-l-2 border-transparent font-mono text-[13px] leading-[1.5] min-w-0">
          <span className="w-12 text-right pr-2 text-[12px] select-none shrink-0" />
          <span className="w-4 shrink-0 select-none" />
          <span className="flex-1 px-2 whitespace-pre-wrap break-words" />
        </div>
      );
    }

    const prefix =
      line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
    const lineNo = side === "left" ? line.oldLineNo : line.newLineNo;

    return (
      <div
        className="flex-1 flex border-l-2 font-mono text-[13px] leading-[1.5] min-w-0"
        style={getDiffLineStyle(line.type)}
      >
        <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
          {lineNo ?? ""}
        </span>
        <span
          className="w-4 shrink-0 text-center select-none"
          style={{ color: getDiffSignColor(line.type) }}
        >
          {prefix}
        </span>
        <span className="flex-1 px-2 whitespace-pre-wrap break-words text-[var(--ink)]">
          {line.content}
        </span>
      </div>
    );
  };

  return (
    <div className="flex font-mono text-[13px] leading-[1.5]">
      {renderSide(row.left, "left")}
      <div
        className="w-px shrink-0"
        style={{ backgroundColor: DIFF_VIEW_COLORS.separator }}
      />
      {renderSide(row.right, "right")}
    </div>
  );
};

export const DiffViewTab: React.FC<DiffViewTabProps> = ({
  filePath,
  status,
  unifiedDiff,
  workspacePath,
  sourceControlRef,
}) => {
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");
  const [sourceDiff, setSourceDiff] = useState<SourceControlDiffResponse | null>(
    null,
  );
  const [sourceDiffLoading, setSourceDiffLoading] = useState(false);
  const [sourceDiffError, setSourceDiffError] = useState<string | null>(null);
  const [openExplorerError, setOpenExplorerError] = useState<string | null>(
    null,
  );
  const sourceProjectId = sourceControlRef?.projectId;
  const sourceSessionId = sourceControlRef?.sessionId;
  const sourceFilePath = sourceControlRef?.filePath;
  const sourceArea = sourceControlRef?.area;

  useEffect(() => {
    if (!sourceProjectId || !sourceSessionId || !sourceFilePath || !sourceArea) {
      setSourceDiff(null);
      setSourceDiffLoading(false);
      setSourceDiffError(null);
      return;
    }

    let cancelled = false;
    setSourceDiff(null);
    setSourceDiffLoading(true);
    setSourceDiffError(null);
    projectSourceControlApi
      .getDiff(sourceProjectId, {
        session_id: sourceSessionId,
        path: sourceFilePath,
        area: sourceArea,
      })
      .then((response) => {
        if (!cancelled) {
          setSourceDiff(response);
          setSourceDiffLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSourceDiffError(err instanceof Error ? err.message : String(err));
          setSourceDiffLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceArea, sourceFilePath, sourceProjectId, sourceSessionId]);

  const effectiveFilePath =
    sourceDiff?.path ?? sourceFilePath ?? filePath ?? "";
  const effectiveStatus = status ?? sourceArea ?? "";
  const effectiveUnifiedDiff = sourceControlRef
    ? (sourceDiff?.unified_diff ?? "")
    : (unifiedDiff ?? "");

  useEffect(() => {
    setOpenExplorerError(null);
  }, [effectiveFilePath]);

  const hunks = useMemo(
    () => parseUnifiedDiff(effectiveUnifiedDiff),
    [effectiveUnifiedDiff],
  );

  const stats = useMemo(
    () =>
      sourceDiff
        ? { additions: sourceDiff.additions, deletions: sourceDiff.deletions }
        : countStats(hunks),
    [hunks, sourceDiff],
  );

  const handleOpenInExplorer = useCallback(() => {
    if (!effectiveFilePath) return;
    setOpenExplorerError(null);
    void filesystemApi
      .openInExplorer(effectiveFilePath, workspacePath)
      .then((response) => {
        if (!response.ok) {
          setOpenExplorerError(response.error ?? "Failed to open in Explorer");
        }
      })
      .catch((error) => {
        setOpenExplorerError(
          error instanceof Error ? error.message : "Failed to open in Explorer",
        );
      });
  }, [effectiveFilePath, workspacePath]);

  const openExplorerButton = effectiveFilePath ? (
    <button
      type="button"
      onClick={handleOpenInExplorer}
      title="Open in file explorer"
      aria-label="Open in file explorer"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--hairline)] text-[var(--ink-subtle)] transition hover:bg-[var(--surface-1)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
    >
      <FolderOpen className="h-3.5 w-3.5" />
    </button>
  ) : null;

  if (sourceDiffLoading && !sourceDiff) {
    return (
      <div
        className="diff-view-tab flex h-full w-full items-center justify-center"
        style={{ backgroundColor: DIFF_VIEW_COLORS.canvas }}
      >
        <div className="text-[13px] text-[var(--ink-tertiary)]">
          Loading diff...
        </div>
      </div>
    );
  }

  if (sourceDiffError && !sourceDiff) {
    return (
      <div
        className="diff-view-tab flex h-full w-full items-center justify-center"
        style={{ backgroundColor: DIFF_VIEW_COLORS.canvas }}
      >
        <div className="max-w-md rounded-md bg-[var(--surface-1)] px-4 py-3 text-[13px] text-rose-500">
          {sourceDiffError}
        </div>
      </div>
    );
  }

  if (!effectiveUnifiedDiff) {
    return (
      <div
        className="diff-view-tab flex h-full w-full items-center justify-center"
        style={{ backgroundColor: DIFF_VIEW_COLORS.canvas }}
      >
        <div className="text-center space-y-2">
          <span className="block text-[13px] text-[var(--ink-tertiary)]">
            {sourceDiff?.message ??
              (effectiveStatus === "D"
                ? "File deleted - no diff content available"
                : "No diff content available")}
          </span>
          <div className="flex items-center justify-center gap-2">
            <span className="block font-mono text-[12px] text-[var(--ink-subtle)]">
              {effectiveFilePath}
            </span>
            {openExplorerButton}
          </div>
          {openExplorerError && (
            <span className="block text-[12px] text-rose-500">
              {openExplorerError}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (effectiveUnifiedDiff.length > MAX_DIFF_SIZE) {
    return (
      <div
        className="diff-view-tab flex h-full w-full items-center justify-center"
        style={{ backgroundColor: DIFF_VIEW_COLORS.canvas }}
      >
        <div className="space-y-2 text-center">
          <div className="text-[13px] text-[var(--ink-tertiary)]">
            Diff too large to render (
            {(effectiveUnifiedDiff.length / 1024).toFixed(0)} KB)
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="block font-mono text-[12px] text-[var(--ink-subtle)]">
              {effectiveFilePath}
            </span>
            {openExplorerButton}
          </div>
          {openExplorerError && (
            <span className="block text-[12px] text-rose-500">
              {openExplorerError}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="diff-view-tab flex h-full w-full flex-col"
      style={{ backgroundColor: DIFF_VIEW_COLORS.canvas }}
    >
      <div
        className="h-10 shrink-0 flex items-center justify-between px-3 border-b"
        style={{
          backgroundColor: DIFF_VIEW_COLORS.surface,
          borderColor: DIFF_VIEW_COLORS.separator,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[13px] text-[var(--ink)] truncate">
            {effectiveFilePath}
          </span>
          {sourceDiff && (
            <span className="hidden shrink-0 font-mono text-[11px] text-[var(--ink-tertiary)] sm:inline">
              {sourceDiff.base_label} -&gt; {sourceDiff.compare_label}
            </span>
          )}
          {stats.additions > 0 && (
            <span
              className="font-mono text-[13px]"
              style={{ color: DIFF_VIEW_COLORS.addedSymbol }}
            >
              +{stats.additions}
            </span>
          )}
          {stats.deletions > 0 && (
            <span
              className="font-mono text-[13px]"
              style={{ color: DIFF_VIEW_COLORS.removedSymbol }}
            >
              -{stats.deletions}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {openExplorerButton}
          <div
            className="flex items-center gap-0.5 rounded-md p-0.5"
            style={{ backgroundColor: DIFF_VIEW_COLORS.separatorSolid }}
          >
            <button
              type="button"
              onClick={() => setDiffMode("unified")}
              className={`px-2.5 py-1 rounded text-[12px] ${
                diffMode === "unified"
                  ? "bg-[var(--surface-1)] text-[var(--ink)] font-medium"
                  : "bg-transparent text-[var(--ink-subtle)]"
              }`}
            >
              Unified
            </button>
            <button
              type="button"
              onClick={() => setDiffMode("split")}
              className={`px-2.5 py-1 rounded text-[12px] ${
                diffMode === "split"
                  ? "bg-[var(--surface-1)] text-[var(--ink)] font-medium"
                  : "bg-transparent text-[var(--ink-subtle)]"
              }`}
            >
              Split
            </button>
          </div>
        </div>
      </div>
      {openExplorerError && (
        <div className="shrink-0 border-b border-[var(--hairline)] px-3 py-1 text-[12px] text-rose-500">
          {openExplorerError}
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        {hunks.map((hunk, hunkIndex) => (
          <React.Fragment key={hunkIndex}>
            <div
              className="flex font-mono text-[12px] leading-[1.5] text-[var(--ink-subtle)]"
              style={{ backgroundColor: DIFF_VIEW_COLORS.separatorSolid }}
            >
              {diffMode === "unified" ? (
                <>
                  <span className="w-12 shrink-0" />
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre-wrap break-words">
                    {hunk.header}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre-wrap break-words">
                    {hunk.header}
                  </span>
                  <div
                    className="w-px shrink-0"
                    style={{ backgroundColor: DIFF_VIEW_COLORS.separator }}
                  />
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre-wrap break-words">
                    {hunk.header}
                  </span>
                </>
              )}
            </div>
            {diffMode === "unified"
              ? hunk.lines.map((line, lineIndex) => (
                  <DiffLineRow key={`${hunkIndex}-${lineIndex}`} line={line} />
                ))
              : alignSplitLines(hunk.lines).map((row, rowIndex) => (
                  <SplitLineRow key={`${hunkIndex}-${rowIndex}`} row={row} />
                ))}
          </React.Fragment>
        ))}
      </ScrollArea>
    </div>
  );
};
