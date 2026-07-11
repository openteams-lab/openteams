// Smoke tests for tool activity UI formatting.
//
// Run with:
//     pnpm exec tsx src/lib/agentActivityFormatter.test.ts

import type { ChatRunActivityLine } from "@/types";
import { formatAgentActivityLines } from "./agentActivityFormatter";

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? "");
  }
};

const line = (
  sequence: number,
  line_type: ChatRunActivityLine["line_type"],
  content: string,
  agent_name = "codex",
): ChatRunActivityLine => ({
  line_id: `line-${sequence}`,
  run_id: "run-1",
  session_id: "session-1",
  session_agent_id: "session-agent-1",
  agent_id: "agent-1",
  agent_name,
  sequence,
  line_type,
  stream_type: line_type === "error" ? "error" : "thinking",
  content,
  created_at: "2026-06-02T00:00:00.000Z",
});

console.log("agentActivityFormatter");

{
  const rows = formatAgentActivityLines([
    line(1, "tool", "Started command: cargo test -p services"),
    line(2, "tool", "Completed command: cargo test -p services"),
  ]);

  check("merges started/completed command into one row", rows.length === 1, rows);
  check("shows completed command copy", rows[0]?.title === "Command completed", rows);
  check("keeps command detail visible", rows[0]?.detail === "cargo test -p services", rows);
}

{
  const zh = (key: string): string =>
    ({
      "agentActivity.tool.file_read.completed": "文件已读取",
    })[key] ?? key;
  const rows = formatAgentActivityLines(
    [
      line(1, "tool", "start read: frontend-new/src/App.tsx"),
      line(2, "tool", "end read: frontend-new/src/App.tsx"),
    ],
    zh,
  );

  check("merges legacy start/end read into one row", rows.length === 1, rows);
  check("uses translated file read copy", rows[0]?.title === "文件已读取", rows);
}

{
  const rows = formatAgentActivityLines([
    line(1, "tool", "Started command: pnpm run frontend-new:check"),
  ]);

  check("keeps running-only start as in-progress", rows[0]?.title === "Running command", rows);
}

{
  const failedRows = formatAgentActivityLines([
    line(1, "tool", "Started command: pnpm test"),
    line(2, "tool", "Failed command: pnpm test"),
  ]);
  const deniedRows = formatAgentActivityLines([
    line(1, "tool", "Started tool: ApplyPatch"),
    line(2, "tool", "Denied tool: ApplyPatch"),
  ]);
  const timedOutRows = formatAgentActivityLines([
    line(1, "tool", "Started command: pnpm build"),
    line(2, "tool", "Timed out command: pnpm build"),
  ]);

  check("failed status overrides running status", failedRows[0]?.title === "Command failed", failedRows);
  check("denied status overrides running status", deniedRows[0]?.title === "Tool call denied", deniedRows);
  check("timed out status overrides running status", timedOutRows[0]?.title === "Command timed out", timedOutRows);
}

{
  const rows = formatAgentActivityLines([
    line(1, "tool", "Started command: pnpm test"),
    line(2, "tool", "Completed command: pnpm test"),
    line(3, "tool", "Started command: pnpm test"),
    line(4, "tool", "Completed command: pnpm test"),
  ]);

  check("does not merge repeated same command rounds into one row", rows.length === 2, rows);
  check(
    "keeps both repeated command rounds completed",
    rows.every((row) => row.title === "Command completed"),
    rows,
  );
}

{
  const rows = formatAgentActivityLines([
    line(1, "tool", "Started Tool: ApplyPatch"),
    line(2, "tool", "Completed Tool: ApplyPatch: patch applied"),
  ]);

  check("merges tool completion lines with result previews", rows.length === 1, rows);
  check("keeps the completed tool target visible", rows[0]?.detail === "ApplyPatch", rows);
  check("separates the completed tool result for disclosure", rows[0]?.resultDetail === "patch applied", rows);
}

{
  const rows = formatAgentActivityLines([
    line(1, "thinking", "I am checking the workspace."),
    line(2, "tool", "Raw tool log without a known prefix"),
  ]);

  check("leaves non-tool lines unchanged", rows[0]?.content === "I am checking the workspace.", rows);
  check("leaves unparsed tool lines unchanged", rows[1]?.content === "Raw tool log without a known prefix", rows);
}

{
  const rows = formatAgentActivityLines([
    line(1, "thinking", "<!-- -->**Planning code inspection**"),
    line(2, "thinking", "<!--  -->"),
  ]);

  check("strips Codex empty HTML comment prefixes from thinking lines", rows.length === 1, rows);
  check("keeps the visible thinking markdown after stripping", rows[0]?.content === "**Planning code inspection**", rows);
}

{
  const rows = formatAgentActivityLines([
    line(1, "thinking", "<!-- -->visible non-codex text", "Claude"),
  ]);

  check("does not strip empty HTML comments for non-Codex activity lines", rows[0]?.content === "<!-- -->visible non-codex text", rows);
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} agentActivityFormatter assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll agentActivityFormatter assertions passed.");
}
