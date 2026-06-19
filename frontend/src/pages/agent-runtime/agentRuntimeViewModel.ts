import type {
  AgentRuntimeEnvSummary,
  AgentRuntimeStatus,
  AvailabilityInfo,
  BaseCodingAgent,
} from "@/types";

export type AgentRuntimeFilter = "all" | "available" | "error" | "not_installed";

export type RuntimeDisplayState = "available" | "error" | "not_installed";

export const AGENT_RUNTIME_EDITABLE_FIELDS = [
  "run_mode",
  "env_json",
  "executor_options",
] as const;

export interface MachineSummary {
  name: string;
  total: number;
  online: number;
  errors: number;
  notInstalled: number;
  workloadLabel: string;
}

export function getRunnerLabel(runner: BaseCodingAgent | string): string {
  return runner
    .toString()
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getAvailabilityLabel(availability: AvailabilityInfo): string {
  switch (availability.type) {
    case "LOGIN_DETECTED":
      return "Login detected";
    case "INSTALLATION_FOUND":
      return "Installation found";
    case "NOT_FOUND":
      return "Not found";
    default:
      return "Unknown";
  }
}

export function getRuntimeDisplayState(
  runner: Pick<AgentRuntimeStatus, "installed" | "executable" | "last_error">,
): RuntimeDisplayState {
  if (!runner.installed) return "not_installed";
  if (!runner.executable || runner.last_error) return "error";
  return "available";
}

export function filterRuntimeRunners(
  runners: AgentRuntimeStatus[],
  query: string,
  filter: AgentRuntimeFilter,
): AgentRuntimeStatus[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return runners.filter((runner) => {
    const displayState = getRuntimeDisplayState(runner);
    if (filter !== "all" && displayState !== filter) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      getRunnerLabel(runner.runner_type),
      runner.runner_type,
      runner.run_mode,
      runner.version ?? "",
      runner.last_error ?? "",
      runner.discovered_models.join(" "),
      runner.env_summary.map((entry) => entry.key).join(" "),
    ]
      .join(" ")
      .toLocaleLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function buildLocalMachineSummary(
  runners: AgentRuntimeStatus[],
): MachineSummary {
  const total = runners.length;
  const online = runners.filter(
    (runner) => getRuntimeDisplayState(runner) === "available",
  ).length;
  const errors = runners.filter(
    (runner) => getRuntimeDisplayState(runner) === "error",
  ).length;
  const notInstalled = runners.filter(
    (runner) => getRuntimeDisplayState(runner) === "not_installed",
  ).length;
  const configuredEnvCount = runners.reduce(
    (sum, runner) => sum + runner.env_summary.length,
    0,
  );

  return {
    name: "Localhost",
    total,
    online,
    errors,
    notInstalled,
    workloadLabel:
      configuredEnvCount > 0
        ? `${configuredEnvCount} env keys configured`
        : "No active workload reported",
  };
}

export function envSummaryToText(envSummary: AgentRuntimeEnvSummary[]): string {
  return envSummary.map((entry) => `${entry.key}=${entry.value}`).join("\n");
}

export function parseEnvText(text: string): Record<string, string> {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex <= 0) {
        acc[line] = "";
        return acc;
      }

      const key = line.slice(0, equalsIndex).trim();
      if (key) acc[key] = line.slice(equalsIndex + 1);
      return acc;
    }, {});
}
