import type { ChatRunActivityLine } from "@/types";

export type AgentActivityToolKind =
  | "command"
  | "file_read"
  | "file_edit"
  | "search"
  | "web_fetch"
  | "tool"
  | "mcp_tool"
  | "task"
  | "plan"
  | "activity";

export type AgentActivityToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "waiting_approval"
  | "timed_out";

export interface AgentActivityDisplayRow {
  row_id: string;
  line_type: ChatRunActivityLine["line_type"];
  sequence: number;
  content: string;
  title: string;
  detail?: string;
  resultDetail?: string;
  toolKind?: AgentActivityToolKind;
  toolStatus?: AgentActivityToolStatus;
  sourceLineIds: string[];
}

export type AgentActivityTranslator = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

interface ParsedToolActivity {
  kind: AgentActivityToolKind;
  status: AgentActivityToolStatus;
  detail: string;
}

const DEFAULT_TOOL_LABELS: Record<string, string> = {
  "agentActivity.tool.command.running": "Running command",
  "agentActivity.tool.command.completed": "Command completed",
  "agentActivity.tool.command.failed": "Command failed",
  "agentActivity.tool.command.denied": "Command denied",
  "agentActivity.tool.command.waiting_approval": "Waiting to run command",
  "agentActivity.tool.command.timed_out": "Command timed out",
  "agentActivity.tool.file_read.running": "Reading file",
  "agentActivity.tool.file_read.completed": "File read",
  "agentActivity.tool.file_read.failed": "File read failed",
  "agentActivity.tool.file_read.denied": "File read denied",
  "agentActivity.tool.file_read.waiting_approval": "Waiting to read file",
  "agentActivity.tool.file_read.timed_out": "File read timed out",
  "agentActivity.tool.file_edit.running": "Editing file",
  "agentActivity.tool.file_edit.completed": "File edit completed",
  "agentActivity.tool.file_edit.failed": "File edit failed",
  "agentActivity.tool.file_edit.denied": "File edit denied",
  "agentActivity.tool.file_edit.waiting_approval": "Waiting to edit file",
  "agentActivity.tool.file_edit.timed_out": "File edit timed out",
  "agentActivity.tool.search.running": "Searching",
  "agentActivity.tool.search.completed": "Search completed",
  "agentActivity.tool.search.failed": "Search failed",
  "agentActivity.tool.search.denied": "Search denied",
  "agentActivity.tool.search.waiting_approval": "Waiting to search",
  "agentActivity.tool.search.timed_out": "Search timed out",
  "agentActivity.tool.web_fetch.running": "Fetching page",
  "agentActivity.tool.web_fetch.completed": "Page fetched",
  "agentActivity.tool.web_fetch.failed": "Page fetch failed",
  "agentActivity.tool.web_fetch.denied": "Page fetch denied",
  "agentActivity.tool.web_fetch.waiting_approval": "Waiting to fetch page",
  "agentActivity.tool.web_fetch.timed_out": "Page fetch timed out",
  "agentActivity.tool.tool.running": "Calling tool",
  "agentActivity.tool.tool.completed": "Tool call completed",
  "agentActivity.tool.tool.failed": "Tool call failed",
  "agentActivity.tool.tool.denied": "Tool call denied",
  "agentActivity.tool.tool.waiting_approval": "Waiting for tool approval",
  "agentActivity.tool.tool.timed_out": "Tool call timed out",
  "agentActivity.tool.mcp_tool.running": "Calling MCP tool",
  "agentActivity.tool.mcp_tool.completed": "MCP tool completed",
  "agentActivity.tool.mcp_tool.failed": "MCP tool failed",
  "agentActivity.tool.mcp_tool.denied": "MCP tool denied",
  "agentActivity.tool.mcp_tool.waiting_approval": "Waiting for MCP approval",
  "agentActivity.tool.mcp_tool.timed_out": "MCP tool timed out",
  "agentActivity.tool.task.running": "Starting subtask",
  "agentActivity.tool.task.completed": "Subtask completed",
  "agentActivity.tool.task.failed": "Subtask failed",
  "agentActivity.tool.task.denied": "Subtask denied",
  "agentActivity.tool.task.waiting_approval": "Waiting to start subtask",
  "agentActivity.tool.task.timed_out": "Subtask timed out",
  "agentActivity.tool.plan.running": "Updating plan",
  "agentActivity.tool.plan.completed": "Plan updated",
  "agentActivity.tool.plan.failed": "Plan update failed",
  "agentActivity.tool.plan.denied": "Plan update denied",
  "agentActivity.tool.plan.waiting_approval": "Waiting to update plan",
  "agentActivity.tool.plan.timed_out": "Plan update timed out",
  "agentActivity.tool.activity.running": "Working",
  "agentActivity.tool.activity.completed": "Activity completed",
  "agentActivity.tool.activity.failed": "Activity failed",
  "agentActivity.tool.activity.denied": "Activity denied",
  "agentActivity.tool.activity.waiting_approval": "Waiting for approval",
  "agentActivity.tool.activity.timed_out": "Activity timed out",
};

const STATUS_PREFIXES: Array<{
  prefix: string;
  status: AgentActivityToolStatus;
}> = [
  { prefix: "waiting approval for", status: "waiting_approval" },
  { prefix: "timed out", status: "timed_out" },
  { prefix: "timeout", status: "timed_out" },
  { prefix: "completed", status: "completed" },
  { prefix: "complete", status: "completed" },
  { prefix: "finished", status: "completed" },
  { prefix: "finish", status: "completed" },
  { prefix: "ended", status: "completed" },
  { prefix: "end", status: "completed" },
  { prefix: "failed", status: "failed" },
  { prefix: "fail", status: "failed" },
  { prefix: "denied", status: "denied" },
  { prefix: "started", status: "running" },
  { prefix: "start", status: "running" },
];

const KIND_PREFIXES: Array<{ label: string; kind: AgentActivityToolKind }> = [
  { label: "mcp tool", kind: "mcp_tool" },
  { label: "file read", kind: "file_read" },
  { label: "read", kind: "file_read" },
  { label: "file edit", kind: "file_edit" },
  { label: "edit", kind: "file_edit" },
  { label: "web fetch", kind: "web_fetch" },
  { label: "fetch", kind: "web_fetch" },
  { label: "command", kind: "command" },
  { label: "search", kind: "search" },
  { label: "tool", kind: "tool" },
  { label: "task", kind: "task" },
  { label: "plan", kind: "plan" },
  { label: "activity", kind: "activity" },
];

const TERMINAL_STATUSES = new Set<AgentActivityToolStatus>([
  "completed",
  "failed",
  "denied",
  "timed_out",
]);

const normalizeDetail = (detail: string): string =>
  detail.trim().replace(/\s+/g, " ");

const matchPrefix = (
  value: string,
  prefixes: Array<{ prefix: string; status: AgentActivityToolStatus }>,
) => {
  const lower = value.toLocaleLowerCase();
  return prefixes.find(
    ({ prefix }) =>
      lower === prefix ||
      lower.startsWith(`${prefix} `) ||
      lower.startsWith(`${prefix}:`),
  );
};

const resolveKind = (rawKind: string): AgentActivityToolKind => {
  const normalized = rawKind.trim().toLocaleLowerCase();
  return (
    KIND_PREFIXES.find(({ label }) => normalized === label)?.kind ??
    KIND_PREFIXES.find(({ label }) => normalized.startsWith(`${label} `))
      ?.kind ??
    "activity"
  );
};

const parseKindAndDetail = (
  value: string,
): Pick<ParsedToolActivity, "kind" | "detail"> => {
  const trimmed = value.trim().replace(/^:\s*/u, "");
  const colonIndex = trimmed.indexOf(":");

  if (colonIndex >= 0) {
    return {
      kind: resolveKind(trimmed.slice(0, colonIndex)),
      detail: normalizeDetail(trimmed.slice(colonIndex + 1)),
    };
  }

  const lower = trimmed.toLocaleLowerCase();
  const matchedKind = KIND_PREFIXES.find(
    ({ label }) => lower === label || lower.startsWith(`${label} `),
  );
  if (!matchedKind) {
    return { kind: "activity", detail: normalizeDetail(trimmed) };
  }

  return {
    kind: matchedKind.kind,
    detail: normalizeDetail(trimmed.slice(matchedKind.label.length)),
  };
};

export const parseToolActivityContent = (
  content: string,
): ParsedToolActivity | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const statusMatch = matchPrefix(trimmed, STATUS_PREFIXES);
  if (!statusMatch) return null;

  const rest = trimmed.slice(statusMatch.prefix.length).trim();
  const { kind, detail } = parseKindAndDetail(rest);

  return {
    kind,
    status: statusMatch.status,
    detail,
  };
};

const labelForToolActivity = (
  kind: AgentActivityToolKind,
  status: AgentActivityToolStatus,
  translate?: AgentActivityTranslator,
): string => {
  const key = `agentActivity.tool.${kind}.${status}`;
  const translated = translate?.(key);
  if (translated && translated !== key) return translated;
  return (
    DEFAULT_TOOL_LABELS[key] ??
    DEFAULT_TOOL_LABELS[`agentActivity.tool.activity.${status}`] ??
    "Activity"
  );
};

const contentForRow = (title: string, detail?: string): string =>
  detail ? `${title}: ${detail}` : title;

const stripEmptyHtmlCommentPrefixes = (content: string): string =>
  content
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^(?:\s*<!--\s*-->\s*)+/u, ""))
    .join("\n")
    .trim();

const isCodexActivityLine = (line: ChatRunActivityLine): boolean =>
  line.agent_name.toLocaleLowerCase().includes("codex");

const displayContentForLine = (line: ChatRunActivityLine): string =>
  isCodexActivityLine(line)
    ? stripEmptyHtmlCommentPrefixes(line.content)
    : line.content;

const displayRowFromLine = (
  line: ChatRunActivityLine,
  content = line.content,
): AgentActivityDisplayRow => ({
  row_id: line.line_id,
  line_type: line.line_type,
  sequence: line.sequence,
  content,
  title: content,
  sourceLineIds: [line.line_id],
  ...(line.line_type === "tool" ? { toolKind: "activity" as const } : {}),
});

const rowKeyForTool = (tool: ParsedToolActivity): string =>
  `${tool.kind}:${tool.detail.toLocaleLowerCase()}`;

const findPendingMatch = (
  parsed: ParsedToolActivity,
  pendingByKey: Map<string, number[]>,
  rows: AgentActivityDisplayRow[],
): { key: string; index: number; indexes: number[] } | null => {
  const exactKey = rowKeyForTool(parsed);
  const exactIndexes = pendingByKey.get(exactKey) ?? [];
  if (exactIndexes[0] !== undefined) {
    return { key: exactKey, index: exactIndexes[0], indexes: exactIndexes };
  }

  const normalizedDetail = parsed.detail.toLocaleLowerCase();
  for (const [key, indexes] of pendingByKey) {
    const index = indexes[0];
    const pendingRow = index === undefined ? undefined : rows[index];
    const pendingDetail = pendingRow?.detail?.toLocaleLowerCase();
    if (
      pendingRow?.toolKind === parsed.kind &&
      pendingDetail &&
      normalizedDetail.startsWith(`${pendingDetail}:`)
    ) {
      return { key, index, indexes };
    }
  }

  return null;
};

const applyParsedToolToRow = (
  row: AgentActivityDisplayRow,
  line: ChatRunActivityLine,
  parsed: ParsedToolActivity,
  translate?: AgentActivityTranslator,
): AgentActivityDisplayRow => {
  const title = labelForToolActivity(parsed.kind, parsed.status, translate);
  const existingDetail = row.detail?.trim();
  const resultPrefix = existingDetail ? `${existingDetail}:` : undefined;
  const hasResultDetail =
    resultPrefix !== undefined && parsed.detail.startsWith(resultPrefix);
  const detail = hasResultDetail ? existingDetail : parsed.detail;
  const resultDetail = hasResultDetail
    ? parsed.detail.slice(resultPrefix.length).trim()
    : undefined;
  return {
    ...row,
    line_type: "tool",
    content: contentForRow(title, parsed.detail),
    title,
    detail: detail || undefined,
    resultDetail: resultDetail || undefined,
    toolKind: parsed.kind,
    toolStatus: parsed.status,
    sourceLineIds: [...row.sourceLineIds, line.line_id],
  };
};

export const formatAgentActivityLines = (
  lines: ChatRunActivityLine[],
  translate?: AgentActivityTranslator,
): AgentActivityDisplayRow[] => {
  const rows: AgentActivityDisplayRow[] = [];
  const pendingByKey = new Map<string, number[]>();

  for (const line of lines) {
    if (line.line_type !== "tool") {
      const content = displayContentForLine(line);
      if (content.trim()) {
        rows.push(displayRowFromLine(line, content));
      }
      continue;
    }

    const parsed = parseToolActivityContent(line.content);
    if (!parsed) {
      const content = displayContentForLine(line);
      if (content.trim()) {
        rows.push(displayRowFromLine(line, content));
      }
      continue;
    }

    const key = rowKeyForTool(parsed);
    const pendingIndexes = pendingByKey.get(key) ?? [];
    const pendingMatch =
      parsed.status === "running"
        ? null
        : findPendingMatch(parsed, pendingByKey, rows);
    const pendingIndex = pendingMatch?.index;

    if (parsed.status === "running" || pendingIndex === undefined) {
      const title = labelForToolActivity(parsed.kind, parsed.status, translate);
      const nextIndex = rows.length;
      rows.push({
        row_id: line.line_id,
        line_type: "tool",
        sequence: line.sequence,
        content: contentForRow(title, parsed.detail),
        title,
        detail: parsed.detail || undefined,
        toolKind: parsed.kind,
        toolStatus: parsed.status,
        sourceLineIds: [line.line_id],
      });

      if (!TERMINAL_STATUSES.has(parsed.status)) {
        pendingByKey.set(key, [...pendingIndexes, nextIndex]);
      }
      continue;
    }

    rows[pendingIndex] = applyParsedToolToRow(
      rows[pendingIndex],
      line,
      parsed,
      translate,
    );

    if (TERMINAL_STATUSES.has(parsed.status)) {
      const remaining = (pendingMatch?.indexes ?? pendingIndexes).slice(1);
      if (remaining.length > 0) {
        pendingByKey.set(pendingMatch?.key ?? key, remaining);
      } else {
        pendingByKey.delete(pendingMatch?.key ?? key);
      }
    }
  }

  return rows;
};
