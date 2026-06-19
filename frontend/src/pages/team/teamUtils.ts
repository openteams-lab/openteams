import type {
  BackendChatAgent,
  BackendChatSessionAgent,
  BaseCodingAgent,
  ChatSessionAgentState,
} from "@/types";
import type { ProjectMemberWithRuntime } from "../../../../shared/types";
import { getRunnerLabel } from "../agent-runtime/agentRuntimeViewModel";

export type MemberExecutionConfig = {
  runner_type?: BaseCodingAgent | null;
  model_name?: string | null;
  thinking_effort?: string | null;
  model_variant?: string | null;
};

export type ProjectMemberWithExecution = ProjectMemberWithRuntime & {
  execution_config?: MemberExecutionConfig | null;
};

export type SessionAgentLookup = {
  byAgentId: Map<string, BackendChatSessionAgent>;
  byMemberId: Map<string, BackendChatSessionAgent>;
};

export type MemberRunState = "idle" | "running" | "dead";

export const defaultOptionId = "__openteams_default__";
export const nonLeadRole = "member";

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export const normalizeRunnerType = (
  value?: string | null,
): BaseCodingAgent | null => {
  if (!value) return null;
  let normalized = value.trim().replaceAll("-", "_").toUpperCase();
  if (normalized === "OPENTEAMS_CLI") {
    normalized = "OPEN_TEAMS_CLI";
  }
  const known: BaseCodingAgent[] = [
    "CLAUDE_CODE",
    "AMP",
    "GEMINI",
    "CODEX",
    "OPENCODE",
    "OPEN_TEAMS_CLI",
    "CURSOR_AGENT",
    "QWEN_CODE",
    "COPILOT",
    "DROID",
    "KIMI_CODE",
  ];
  return known.includes(normalized as BaseCodingAgent)
    ? (normalized as BaseCodingAgent)
    : null;
};

export const trimOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const compactRunnerLabel = (
  runner?: BaseCodingAgent | null,
  fallback = "Runtime",
) => (runner ? getRunnerLabel(runner) : fallback);

export const memberName = (
  member: ProjectMemberWithExecution,
  agent?: BackendChatAgent | null,
) => member.member_name?.trim() || agent?.name || member.role || "Member";

export const normalizeMemberRunState = (
  state?: ChatSessionAgentState | null,
): MemberRunState => {
  if (state === "dead") return "dead";
  if (
    state === "running" ||
    state === "stopping" ||
    state === "waitingapproval"
  ) {
    return "running";
  }
  return "idle";
};

export const buildSessionAgentLookup = (
  sessionAgents: BackendChatSessionAgent[],
): SessionAgentLookup => {
  const byMemberId = new Map<string, BackendChatSessionAgent>();
  const byAgentId = new Map<string, BackendChatSessionAgent>();
  for (const sessionAgent of sessionAgents) {
    if (sessionAgent.project_member_id) {
      byMemberId.set(sessionAgent.project_member_id, sessionAgent);
    }
    byAgentId.set(sessionAgent.agent_id, sessionAgent);
  }
  return { byAgentId, byMemberId };
};
