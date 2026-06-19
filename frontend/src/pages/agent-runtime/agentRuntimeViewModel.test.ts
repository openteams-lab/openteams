// Lightweight runtime state tests. Run with:
//     pnpm exec tsx src/pages/agent-runtime/agentRuntimeViewModel.test.ts

import type { AgentRuntimeStatus } from "@/types";
import {
  AGENT_RUNTIME_EDITABLE_FIELDS,
  buildLocalMachineSummary,
  envSummaryToText,
  filterRuntimeRunners,
  getRuntimeDisplayState,
  parseEnvText,
} from "./agentRuntimeViewModel";

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
    return;
  }
  failures += 1;
  // eslint-disable-next-line no-console
  console.error(`  FAIL ${label}`, detail ?? "");
};

const same = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected);

const baseRunner = {
  runner_type: "CODEX",
  installed: true,
  executable: true,
  availability: { type: "INSTALLATION_FOUND" },
  discovered_models: ["gpt-5.2-codex"],
  model_source: "runner",
  version: "1.2.3",
  last_checked_at: "2026-06-02T00:00:00Z",
  last_error: null,
  run_mode: "auto",
  env_summary: [{ key: "OPENAI_API_KEY", value: "sk-live-test" }],
  executor_options: {},
} satisfies AgentRuntimeStatus;

const runners = [
  baseRunner,
  {
    ...baseRunner,
    runner_type: "GEMINI",
    installed: true,
    executable: false,
    discovered_models: [],
    last_error: "command not found",
  },
  {
    ...baseRunner,
    runner_type: "QWEN_CODE",
    installed: false,
    executable: false,
    availability: { type: "NOT_FOUND" },
    discovered_models: [],
    version: null,
    env_summary: [],
  },
] satisfies AgentRuntimeStatus[];

console.log("Agent runtime view model");

check(
  "classifies runtime states",
  same(
    runners.map((runner) => getRuntimeDisplayState(runner)),
    ["available", "error", "not_installed"],
  ),
);
check(
  "filters by query and status",
  same(
    filterRuntimeRunners(runners, "codex", "available").map(
      (runner) => runner.runner_type,
    ),
    ["CODEX"],
  ),
);
check(
  "filters error runners",
  same(
    filterRuntimeRunners(runners, "", "error").map(
      (runner) => runner.runner_type,
    ),
    ["GEMINI"],
  ),
);
check(
  "filters by discovered model name",
  same(
    filterRuntimeRunners(runners, "gpt-5.2-codex", "all").map(
      (runner) => runner.runner_type,
    ),
    ["CODEX"],
  ),
);
check(
  "builds local machine summary",
  same(buildLocalMachineSummary(runners), {
    name: "Localhost",
    total: 3,
    online: 1,
    errors: 1,
    notInstalled: 1,
    workloadLabel: "2 env keys configured",
  }),
);
check(
  "renders env summaries with raw values",
  envSummaryToText([
    { key: "OPENAI_API_KEY", value: "sk-live-test" },
    { key: "DEBUG", value: "true" },
  ]) === "OPENAI_API_KEY=sk-live-test\nDEBUG=true",
);
check(
  "parses env text",
  same(parseEnvText("OPENAI_API_KEY=secret\nEMPTY_VALUE\nMODEL=gpt-5"), {
    OPENAI_API_KEY: "secret",
    EMPTY_VALUE: "",
    MODEL: "gpt-5",
  }),
);
check(
  "editable fields exclude unsupported model-tuning controls",
  same(AGENT_RUNTIME_EDITABLE_FIELDS, [
    "run_mode",
    "env_json",
    "executor_options",
  ]),
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("\nAll agent runtime view model assertions passed.");
