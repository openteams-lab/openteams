import React, { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ScrollArea";
import { parseUnifiedDiff, alignSplitLines } from "@/lib/parseDiff";
import type { DiffLine, DiffHunk, SplitRow } from "@/lib/parseDiff";

interface DiffViewTabProps {
  filePath: string;
  status: string;
  unifiedDiff: string;
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

const DiffLineRow: React.FC<{
  line: DiffLine;
  mode: "unified";
}> = ({ line, mode }) => {
  const bg =
    line.type === "addition"
      ? "bg-emerald-500/10"
      : line.type === "deletion"
        ? "bg-rose-500/10"
        : "";

  const prefix =
    line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";

  return (
    <div className={`flex font-mono text-[13px] leading-[1.5] ${bg}`}>
      <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
        {line.oldLineNo ?? ""}
      </span>
      <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
        {line.newLineNo ?? ""}
      </span>
      <span
        className={`w-4 shrink-0 text-center select-none ${
          line.type === "addition"
            ? "text-emerald-500"
            : line.type === "deletion"
              ? "text-rose-500"
              : "text-[var(--ink-tertiary)]"
        }`}
      >
        {prefix}
      </span>
      <span className="flex-1 px-2 whitespace-pre text-[var(--ink)]">
        {line.content}
      </span>
    </div>
  );
};

const SplitLineRow: React.FC<{
  row: SplitRow;
}> = ({ row }) => {
  const renderSide = (
    line: DiffLine | null,
    side: "left" | "right",
  ) => {
    if (!line) {
      return (
        <div className="flex-1 flex font-mono text-[13px] leading-[1.5] min-w-0">
          <span className="w-12 text-right pr-2 text-[12px] select-none shrink-0" />
          <span className="w-4 shrink-0 select-none" />
          <span className="flex-1 px-2 whitespace-pre" />
        </div>
      );
    }

    const bg =
      line.type === "addition"
        ? "bg-emerald-500/10"
        : line.type === "deletion"
          ? "bg-rose-500/10"
          : "";

    const lineNo = side === "left" ? line.oldLineNo : line.newLineNo;
    const prefix =
      line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";

    return (
      <div className={`flex-1 flex font-mono text-[13px] leading-[1.5] min-w-0 ${bg}`}>
        <span className="w-12 text-right pr-2 text-[12px] text-[var(--ink-tertiary)] select-none shrink-0">
          {lineNo ?? ""}
        </span>
        <span
          className={`w-4 shrink-0 text-center select-none ${
            line.type === "addition"
              ? "text-emerald-500"
              : line.type === "deletion"
                ? "text-rose-500"
                : "text-[var(--ink-tertiary)]"
          }`}
        >
          {prefix}
        </span>
        <span className="flex-1 px-2 whitespace-pre text-[var(--ink)]">
          {line.content}
        </span>
      </div>
    );
  };

  return (
    <div className="flex font-mono text-[13px] leading-[1.5]">
      {renderSide(row.left, "left")}
      <div className="w-px bg-[var(--hairline)] shrink-0" />
      {renderSide(row.right, "right")}
    </div>
  );
};

export const DiffViewTab: React.FC<DiffViewTabProps> = ({
  filePath,
  status,
  unifiedDiff,
}) => {
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");

  const hunks = useMemo(
    () => parseUnifiedDiff(unifiedDiff),
    [unifiedDiff],
  );

  const stats = useMemo(() => countStats(hunks), [hunks]);

  if (!unifiedDiff) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--canvas)]">
        <div className="text-center space-y-2">
          <span className="block text-[13px] text-[var(--ink-tertiary)]">
            {status === "D"
              ? "File deleted — no diff content available"
              : "No diff content available"}
          </span>
          <span className="block font-mono text-[12px] text-[var(--ink-subtle)]">
            {filePath}
          </span>
        </div>
      </div>
    );
  }

  if (unifiedDiff.length > MAX_DIFF_SIZE) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--canvas)]">
        <div className="text-[13px] text-[var(--ink-tertiary)]">
          Diff too large to render ({(unifiedDiff.length / 1024).toFixed(0)} KB)
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)]">
      <div className="h-10 shrink-0 flex items-center justify-between px-3 bg-[var(--surface-1)] border-b border-[var(--hairline)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[13px] text-[var(--ink)] truncate">
            {filePath}
          </span>
          {stats.additions > 0 && (
            <span className="font-mono text-[13px] text-emerald-500">
              +{stats.additions}
            </span>
          )}
          {stats.deletions > 0 && (
            <span className="font-mono text-[13px] text-rose-500">
              -{stats.deletions}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 bg-[var(--surface-3)] rounded-md p-0.5">
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

      <ScrollArea className="flex-1 min-h-0">
        {hunks.map((hunk, hunkIndex) => (
          <React.Fragment key={hunkIndex}>
            <div className="flex font-mono text-[12px] leading-[1.5] bg-[var(--surface-3)] text-[var(--ink-subtle)]">
              {diffMode === "unified" ? (
                <>
                  <span className="w-12 shrink-0" />
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre">
                    {hunk.header}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre">
                    {hunk.header}
                  </span>
                  <div className="w-px bg-[var(--hairline)] shrink-0" />
                  <span className="w-12 shrink-0" />
                  <span className="w-4 shrink-0" />
                  <span className="flex-1 px-2 whitespace-pre">
                    {hunk.header}
                  </span>
                </>
              )}
            </div>
            {diffMode === "unified"
              ? hunk.lines.map((line, lineIndex) => (
                  <DiffLineRow
                    key={`${hunkIndex}-${lineIndex}`}
                    line={line}
                    mode="unified"
                  />
                ))
              : alignSplitLines(hunk.lines).map((row, rowIndex) => (
                  <SplitLineRow
                    key={`${hunkIndex}-${rowIndex}`}
                    row={row}
                  />
                ))}
          </React.Fragment>
        ))}
      </ScrollArea>
    </div>
  );
};
