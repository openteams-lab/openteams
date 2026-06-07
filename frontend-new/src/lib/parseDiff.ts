export interface DiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diffText: string): DiffHunk[] {
  const lines = diffText.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of lines) {
    if (
      rawLine.startsWith("diff --git") ||
      rawLine.startsWith("index ") ||
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("+++ ")
    ) {
      continue;
    }

    const hunkMatch = HUNK_RE.exec(rawLine);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      oldLine = Number(hunkMatch[1]);
      const oldCount = hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1;
      newLine = Number(hunkMatch[3]);
      const newCount = hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1;
      currentHunk = {
        oldStart: oldLine,
        oldCount,
        newStart: newLine,
        newCount,
        header: rawLine,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    if (rawLine.startsWith("+")) {
      currentHunk.lines.push({
        type: "addition",
        content: rawLine.slice(1),
        newLineNo: newLine++,
      });
    } else if (rawLine.startsWith("-")) {
      currentHunk.lines.push({
        type: "deletion",
        content: rawLine.slice(1),
        oldLineNo: oldLine++,
      });
    } else if (rawLine.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: rawLine.slice(1),
        oldLineNo: oldLine++,
        newLineNo: newLine++,
      });
    } else if (rawLine === "") {
      currentHunk.lines.push({
        type: "context",
        content: "",
        oldLineNo: oldLine++,
        newLineNo: newLine++,
      });
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

export function alignSplitLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i].type === "context") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];

    while (i < lines.length && lines[i].type === "deletion") {
      deletions.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === "addition") {
      additions.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(deletions.length, additions.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        left: deletions[j] ?? null,
        right: additions[j] ?? null,
      });
    }
  }

  return rows;
}
