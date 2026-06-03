import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  Crown,
  FolderGit2,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
} from "lucide-react";
import {
  DropdownSelect,
  type DropdownSelectOption,
} from "@/components/DropdownSelect";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  agentRuntimeApi,
  chatAgentsApi,
  projectApi,
  skillsApi,
} from "@/lib/api";
import type {
  AgentRuntimeStatus,
  BackendChatAgent,
  BackendChatSkill,
  BaseCodingAgent,
} from "@/types";
import type { ProjectMember } from "../../../shared/types";
import { getRunnerLabel } from "./agent-runtime/agentRuntimeViewModel";

type MemberExecutionConfig = {
  runner_type?: BaseCodingAgent | null;
  model_name?: string | null;
  thinking_effort?: string | null;
  model_variant?: string | null;
};

type ProjectMemberWithExecution = ProjectMember & {
  execution_config?: MemberExecutionConfig | null;
};

type ThinkingCapability =
  | { kind: "effort"; options: string[] }
  | { kind: "variant"; options: string[] };

const defaultOptionId = "__openteams_default__";

const runnerCapabilities: Partial<Record<BaseCodingAgent, ThinkingCapability>> =
  {
    CLAUDE_CODE: { kind: "effort", options: ["low", "medium", "high"] },
    CODEX: { kind: "effort", options: ["low", "medium", "high", "xhigh"] },
    DROID: {
      kind: "effort",
      options: ["none", "dynamic", "off", "low", "medium", "high"],
    },
    GEMINI: {
      kind: "effort",
      options: ["off", "low", "medium", "high", "max"],
    },
    OPENCODE: { kind: "variant", options: [""] },
    QWEN_CODE: {
      kind: "effort",
      options: ["off", "low", "medium", "high", "max"],
    },
  };

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const normalizeRunnerType = (value?: string | null): BaseCodingAgent | null => {
  if (!value) return null;
  const normalized = value.trim().replaceAll("-", "_").toUpperCase();
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

const trimOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const compactRunnerLabel = (runner?: BaseCodingAgent | null) =>
  runner ? getRunnerLabel(runner) : "Runtime";

const memberName = (
  member: ProjectMemberWithExecution,
  agent?: BackendChatAgent,
) => agent?.name ?? member.role ?? "Member";

const monogram = (value: string) =>
  value
    .split(/[\s@._-]+/u)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "AI";

const createRunnerOptions = (
  runners: AgentRuntimeStatus[],
  runnerType: BaseCodingAgent,
): DropdownSelectOption[] => {
  const options = runners.map((runner) => ({
    id: runner.runner_type,
    label: getRunnerLabel(runner.runner_type),
    description: runner.installed
      ? (runner.version ?? undefined)
      : "Not installed",
  }));

  if (!options.some((option) => option.id === runnerType)) {
    options.unshift({
      id: runnerType,
      label: getRunnerLabel(runnerType),
      description: "Current runtime",
    });
  }

  return options;
};

const createModelOptions = (models: string[]): DropdownSelectOption[] => [
  {
    id: defaultOptionId,
    label: "Default model",
    description: "Use runtime default",
  },
  ...models.map((model) => ({
    id: model,
    label: model,
    description: "Discovered model",
  })),
];

const createReasoningOptions = (
  capability?: ThinkingCapability,
): DropdownSelectOption[] => [
  { id: defaultOptionId, label: "Default", description: "Use runtime default" },
  ...(capability?.options ?? []).filter(Boolean).map((option) => ({
    id: option,
    label: option,
    description:
      capability?.kind === "variant" ? "Runtime variant" : "Reasoning effort",
  })),
];

const createSkillOptions = (
  skills: BackendChatSkill[],
): DropdownSelectOption[] =>
  skills.map((skill) => ({
    id: skill.id,
    label: skill.name,
    description: skill.description,
    group: skill.category ?? "Skills",
    disabled: !skill.enabled,
  }));

export function TeamPage() {
  const { projects, selectedProjectId } = useWorkspace();
  const [members, setMembers] = useState<ProjectMemberWithExecution[]>([]);
  const [agents, setAgents] = useState<BackendChatAgent[]>([]);
  const [runners, setRunners] = useState<AgentRuntimeStatus[]>([]);
  const [skills, setSkills] = useState<BackendChatSkill[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [allowedSkillIds, setAllowedSkillIds] = useState<string[]>([]);
  const [runnerType, setRunnerType] = useState<BaseCodingAgent>("CODEX");
  const [modelName, setModelName] = useState("");
  const [thinkingEffort, setThinkingEffort] = useState("");
  const [modelVariant, setModelVariant] = useState("");
  const [roleDefinition, setRoleDefinition] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const currentProjectMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.project_id === selectedProjectId &&
          member.member_type === "agent",
      ),
    [members, selectedProjectId],
  );
  const selectedMember = useMemo(
    () =>
      currentProjectMembers.find((member) => member.id === selectedMemberId) ??
      null,
    [currentProjectMembers, selectedMemberId],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedMember?.agent_id) ?? null,
    [agents, selectedMember],
  );
  const memberByAgentId = useMemo(
    () =>
      new Set(
        currentProjectMembers
          .map((member) => member.agent_id)
          .filter((id): id is string => Boolean(id)),
      ),
    [currentProjectMembers],
  );
  const availableAgentOptions = useMemo(
    () =>
      agents
        .filter((agent) => !memberByAgentId.has(agent.id))
        .map((agent) => ({
          id: agent.id,
          label: agent.name,
          description: getRunnerLabel(
            normalizeRunnerType(agent.runner_type) ?? "CODEX",
          ),
        })),
    [agents, memberByAgentId],
  );
  const runtimeOptions = useMemo(
    () => createRunnerOptions(runners, runnerType),
    [runnerType, runners],
  );
  const modelOptions = useMemo(() => {
    const discovered =
      runners.find((runner) => runner.runner_type === runnerType)
        ?.discovered_models ?? [];
    const models = Array.from(
      new Set([modelName, ...discovered].filter(Boolean)),
    );
    return createModelOptions(models);
  }, [modelName, runnerType, runners]);
  const capability = runnerCapabilities[runnerType];
  const reasoningOptions = useMemo(
    () => createReasoningOptions(capability),
    [capability],
  );
  const skillOptions = useMemo(() => createSkillOptions(skills), [skills]);
  const skillLabel = (selectedOptions: DropdownSelectOption[]) => {
    if (selectedOptions.length === 0) return "No skills selected";
    if (selectedOptions.length === 1) return selectedOptions[0].label;
    return `${selectedOptions.length} skills selected`;
  };
  const activeMemberName = selectedMember
    ? memberName(selectedMember, selectedAgent ?? undefined)
    : "Member";
  const selectedRuntime = runners.find(
    (runner) => runner.runner_type === runnerType,
  );
  const selectedModelValue = modelName || defaultOptionId;
  const selectedReasoningValue =
    (capability?.kind === "variant" ? modelVariant : thinkingEffort) ||
    defaultOptionId;

  const load = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [projectMembers, chatAgents, runtimeData, skillList] =
        await Promise.all([
          projectApi.listMembers(selectedProjectId),
          chatAgentsApi.list(),
          agentRuntimeApi.list(),
          skillsApi.list(),
        ]);
      const nextMembers = projectMembers as ProjectMemberWithExecution[];
      setMembers(nextMembers);
      setAgents(chatAgents);
      setRunners(runtimeData.runners);
      setSkills(skillList);
      const nextProjectMembers = nextMembers.filter(
        (member) =>
          member.project_id === selectedProjectId &&
          member.member_type === "agent",
      );
      setSelectedMemberId((current) =>
        nextProjectMembers.some((member) => member.id === current)
          ? current
          : (nextProjectMembers[0]?.id ?? ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedMember) return;
    const agent = agents.find((item) => item.id === selectedMember.agent_id);
    const config = selectedMember.execution_config ?? {};
    const runner =
      config.runner_type ??
      normalizeRunnerType(agent?.runner_type) ??
      normalizeRunnerType(
        selectedMember.member_type === "agent" ? agent?.runner_type : null,
      ) ??
      "CODEX";

    setWorkspacePath(
      selectedMember.default_workspace_path ??
        currentProject?.default_workspace_path ??
        "",
    );
    setIsLeader(selectedMember.role === "lead");
    setAllowedSkillIds(selectedMember.allowed_skill_ids ?? []);
    setRunnerType(runner);
    setModelName(config.model_name ?? agent?.model_name ?? "");
    setThinkingEffort(config.thinking_effort ?? "");
    setModelVariant(config.model_variant ?? "");
    setRoleDefinition(agent?.system_prompt ?? "");
    setNotice(null);
  }, [selectedMember, agents, currentProject?.default_workspace_path]);

  const addMember = async () => {
    if (!selectedProjectId || !selectedAgentId) return;
    const agent = agents.find((item) => item.id === selectedAgentId);
    const runner = normalizeRunnerType(agent?.runner_type) ?? "CODEX";
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const member = await projectApi.addMember(selectedProjectId, {
        member_type: "agent",
        agent_id: selectedAgentId,
        user_id: null,
        role: null,
        display_order: currentProjectMembers.length + 1,
        default_workspace_path: currentProject?.default_workspace_path ?? null,
        allowed_skill_ids: [],
        is_default: true,
        execution_config: {
          runner_type: runner,
          model_name: agent?.model_name ?? null,
          thinking_effort: null,
          model_variant: null,
        },
      } as never);
      setMembers((current) => [
        ...current.filter((item) => item.id !== member.id),
        member as ProjectMemberWithExecution,
      ]);
      setSelectedMemberId(member.id);
      setSelectedAgentId("");
      setNotice("Member added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSaving(false);
    }
  };

  const saveMember = async () => {
    if (!selectedProjectId || !selectedMember) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const memberUpdate = projectApi.updateMember(
        selectedProjectId,
        selectedMember.id,
        {
          role: isLeader ? "lead" : null,
          display_order: null,
          default_workspace_path: trimOrNull(workspacePath),
          is_default: null,
          allowed_skill_ids: allowedSkillIds,
          execution_config: {
            runner_type: runnerType,
            model_name: trimOrNull(modelName),
            thinking_effort:
              capability?.kind === "effort" ? trimOrNull(thinkingEffort) : null,
            model_variant:
              capability?.kind === "variant" ? trimOrNull(modelVariant) : null,
          },
        } as never,
      );
      const agentUpdate =
        selectedAgent && selectedAgent.system_prompt !== roleDefinition
          ? chatAgentsApi.update(selectedAgent.id, {
              name: null,
              runner_type: null,
              system_prompt: roleDefinition,
              tools_enabled: null,
              model_name: null,
            })
          : Promise.resolve(selectedAgent);
      const [updatedMember, updatedAgent] = await Promise.all([
        memberUpdate,
        agentUpdate,
      ]);

      setMembers((current) =>
        current.map((member) =>
          member.id === updatedMember.id
            ? (updatedMember as ProjectMemberWithExecution)
            : member,
        ),
      );
      if (updatedAgent) {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updatedAgent.id ? updatedAgent : agent,
          ),
        );
      }
      setNotice("Member configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save member");
    } finally {
      setSaving(false);
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="mx-auto max-w-6xl rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-6 text-[14px] text-[var(--ink-subtle)]">
        Select a project to configure members.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
      <header className="shrink-0 border-b border-[var(--hairline)] bg-[var(--surface-2)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--primary)]">
              <UserRoundCog className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.4px] text-[var(--ink)]">
                Members
              </h1>
              <p className="mt-1 max-w-[600px] text-[14px] leading-[1.45] text-[var(--ink-subtle)]">
                Configure each project member runtime, model, leadership,
                workspace, role definition, and skill access.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
            <DropdownSelect
              value={selectedAgentId}
              options={availableAgentOptions}
              placeholder="Add agent"
              searchPlaceholder="Search agents..."
              emptyLabel="No available agents."
              triggerIcon={
                <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
              }
              className="min-w-[240px] [&>button]:h-9 [&>button]:bg-[var(--surface-1)] [&>button]:py-0"
              maxPanelHeightClassName="max-h-[260px]"
              onChange={(value) => setSelectedAgentId(value)}
            />
            <button
              type="button"
              onClick={() => void addMember()}
              disabled={!selectedAgentId || saving}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] bg-[var(--primary)] px-[14px] text-[14px] font-medium text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)]">
          {(error || notice) && (
            <div className="shrink-0 space-y-2 border-b border-[var(--hairline)] p-3">
              {error && (
                <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-[14px] text-red-300">
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-[8px] border border-[var(--primary)]/30 bg-[var(--primary-tint)] p-3 text-[14px] text-[var(--primary)]">
                  {notice}
                </div>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-[var(--hairline)] bg-[var(--surface-1)] ot-scroll-area-styled lg:border-b-0 lg:border-r">
              {loading ? (
                <div>
                  {[0, 1, 2, 3].map((item) => (
                    <div
                      key={item}
                      className="h-[72px] animate-pulse border-b border-[var(--hairline)] bg-[var(--surface-2)]"
                    />
                  ))}
                </div>
              ) : currentProjectMembers.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
                  <Bot className="h-8 w-8 text-[var(--ink-tertiary)]" />
                  <h3 className="mt-3 text-[14px] font-medium text-[var(--ink)]">
                    No members yet
                  </h3>
                  <p className="mt-1 max-w-[260px] text-[14px] leading-[1.5] text-[var(--ink-subtle)]">
                    Add an agent to start configuring this project team.
                  </p>
                </div>
              ) : (
                currentProjectMembers.map((member) => {
                  const agent = agents.find(
                    (item) => item.id === member.agent_id,
                  );
                  const runner =
                    member.execution_config?.runner_type ??
                    normalizeRunnerType(agent?.runner_type);
                  const active = selectedMemberId === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedMemberId(member.id)}
                      className={cx(
                        "grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--hairline)] px-3 py-3 text-left transition-colors last:border-b-0",
                        active
                          ? "bg-[var(--surface-3)] ring-1 ring-inset ring-[var(--primary)]/35"
                          : "bg-[var(--surface-1)] hover:bg-[var(--surface-2)]",
                      )}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--mono-border)] bg-[var(--mono-bg)] font-mono text-[10px] font-semibold text-[var(--ink-muted)]">
                        {monogram(memberName(member, agent))}
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[14px] font-medium text-[var(--ink)]">
                            {memberName(member, agent)}
                          </span>
                          {member.role === "lead" && (
                            <Crown className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                          )}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[12px] text-[var(--ink-tertiary)]">
                          {compactRunnerLabel(runner)}
                        </span>
                      </span>
                      <span className="rounded-[4px] border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
                        {(member.allowed_skill_ids ?? []).length}
                      </span>
                    </button>
                  );
                })
              )}
            </aside>

            <main className="min-h-0 overflow-y-auto bg-[var(--surface-1)] ot-scroll-area-styled">
              {selectedMember ? (
                <div className="mx-auto max-w-5xl p-4 md:p-5">
                  <div className="mb-4 flex flex-col gap-3 border-b border-[var(--hairline)] pb-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-[18px] font-semibold tracking-[-0.2px] text-[var(--ink)]">
                          {activeMemberName}
                        </h2>
                        {isLeader && (
                          <span className="inline-flex h-6 items-center gap-1 rounded-full border border-[var(--primary)]/30 bg-[var(--primary-tint)] px-2 text-[12px] font-medium text-[var(--primary)]">
                            <Crown className="h-3 w-3" />
                            Leader
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[14px] text-[var(--ink-subtle)]">
                        Runtime and collaboration defaults for this project
                        member.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveMember()}
                      disabled={saving}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-[var(--primary)] px-[14px] text-[14px] font-medium text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? "Saving" : "Save changes"}
                    </button>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
                    <section className="space-y-4">
                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]">
                            <Brain className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                              Execution
                            </h3>
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              Agent runtime, model, and reasoning behavior.
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-[12px] font-medium text-[var(--ink-subtle)]">
                              Agent runtime
                            </span>
                            <DropdownSelect
                              value={runnerType}
                              options={runtimeOptions}
                              searchPlaceholder="Search runtimes..."
                              triggerIcon={
                                <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                              }
                              onChange={(value) =>
                                setRunnerType(value as BaseCodingAgent)
                              }
                            />
                          </label>

                          <label className="space-y-1">
                            <span className="text-[12px] font-medium text-[var(--ink-subtle)]">
                              Model
                            </span>
                            <DropdownSelect
                              value={selectedModelValue}
                              options={modelOptions}
                              searchPlaceholder="Search models..."
                              maxPanelHeightClassName="max-h-[260px]"
                              onChange={(value) =>
                                setModelName(
                                  value === defaultOptionId ? "" : value,
                                )
                              }
                            />
                          </label>

                          <label className="space-y-1 md:col-span-2">
                            <span className="text-[12px] font-medium text-[var(--ink-subtle)]">
                              Reasoning effort
                            </span>
                            <DropdownSelect
                              value={selectedReasoningValue}
                              options={reasoningOptions}
                              showSearch={false}
                              onChange={(value) => {
                                const nextValue =
                                  value === defaultOptionId ? "" : value;
                                if (capability?.kind === "variant") {
                                  setModelVariant(nextValue);
                                } else {
                                  setThinkingEffort(nextValue);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]">
                            <FolderGit2 className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                              Workspace
                            </h3>
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              Default local path used when this member joins
                              sessions.
                            </p>
                          </div>
                        </div>
                        <input
                          value={workspacePath}
                          onChange={(event) =>
                            setWorkspacePath(event.target.value)
                          }
                          placeholder="Project or member workspace path"
                          className="h-10 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-3 font-mono text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)]"
                        />
                      </div>

                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]">
                            <Sparkles className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                              Role definition
                            </h3>
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              System prompt used to define this agent's project
                              role.
                            </p>
                          </div>
                        </div>
                        <textarea
                          value={roleDefinition}
                          onChange={(event) =>
                            setRoleDefinition(event.target.value)
                          }
                          rows={8}
                          spellCheck={false}
                          placeholder="Describe how this member should behave in the project..."
                          className="block w-full resize-y rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[14px] leading-[1.5] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)]"
                        />
                      </div>
                    </section>

                    <aside className="space-y-4">
                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]">
                            <Crown className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                              Leadership
                            </h3>
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              Mark this member as the workflow lead.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-pressed={isLeader}
                          onClick={() => setIsLeader((value) => !value)}
                          className={cx(
                            "flex w-full items-center justify-between rounded-[8px] border px-3 py-3 text-left transition",
                            isLeader
                              ? "border-[var(--primary)]/40 bg-[var(--primary-tint)] text-[var(--ink)]"
                              : "border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Crown
                              className={cx(
                                "h-4 w-4 shrink-0",
                                isLeader
                                  ? "text-[var(--primary)]"
                                  : "text-[var(--ink-tertiary)]",
                              )}
                            />
                            <span>
                              <span className="block text-[14px] font-medium">
                                {isLeader ? "Leader enabled" : "Not a leader"}
                              </span>
                              <span className="mt-0.5 block text-[12px] text-[var(--ink-tertiary)]">
                                Saved through member leadership metadata.
                              </span>
                            </span>
                          </span>
                          {isLeader && (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--primary)]" />
                          )}
                        </button>
                      </div>

                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)]">
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                          <div>
                            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                              Configurable skills
                            </h3>
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              Select skills this member may use in project
                              sessions.
                            </p>
                          </div>
                        </div>
                        <DropdownSelect
                          selectionMode="multiple"
                          values={allowedSkillIds}
                          options={skillOptions}
                          placeholder="Select skills"
                          searchPlaceholder="Search skills..."
                          emptyLabel="No skills are available."
                          maxPanelHeightClassName="max-h-[300px]"
                          formatValueLabel={skillLabel}
                          onChange={(values) => setAllowedSkillIds(values)}
                        />
                        <div className="mt-3 space-y-1">
                          {allowedSkillIds.length === 0 ? (
                            <p className="text-[13px] text-[var(--ink-tertiary)]">
                              No skills selected.
                            </p>
                          ) : (
                            allowedSkillIds.map((skillId) => {
                              const skill = skills.find(
                                (item) => item.id === skillId,
                              );
                              return (
                                <div
                                  key={skillId}
                                  className="flex items-center justify-between gap-2 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-1)] px-2 py-1.5"
                                >
                                  <span className="min-w-0 truncate text-[13px] text-[var(--ink-muted)]">
                                    {skill?.name ?? skillId}
                                  </span>
                                  <span className="shrink-0 rounded-[4px] bg-[var(--mono-bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]">
                                    skill
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4">
                        <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                          Runtime summary
                        </h3>
                        <dl className="mt-3 space-y-2 text-[13px]">
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-[var(--ink-tertiary)]">
                              Runtime
                            </dt>
                            <dd className="truncate text-right font-mono text-[var(--ink-muted)]">
                              {getRunnerLabel(runnerType)}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-[var(--ink-tertiary)]">
                              Model
                            </dt>
                            <dd className="truncate text-right font-mono text-[var(--ink-muted)]">
                              {modelName || "default"}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-[var(--ink-tertiary)]">
                              Status
                            </dt>
                            <dd className="truncate text-right text-[var(--ink-muted)]">
                              {selectedRuntime?.installed === false
                                ? "Not installed"
                                : "Ready to configure"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </aside>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
                  <Bot className="h-8 w-8 text-[var(--ink-tertiary)]" />
                  <h3 className="mt-3 text-[14px] font-medium text-[var(--ink)]">
                    Select a member
                  </h3>
                  <p className="mt-1 max-w-[280px] text-[14px] leading-[1.5] text-[var(--ink-subtle)]">
                    Choose a member from the list to edit runtime, model,
                    skills, workspace, and role definition.
                  </p>
                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    </div>
  );
}
