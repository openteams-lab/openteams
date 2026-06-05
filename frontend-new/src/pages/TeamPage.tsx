import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { DropdownSelectOption } from "@/components/DropdownSelect";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  agentRuntimeApi,
  chatAgentsApi,
  mcpServersApi,
  projectApi,
  sessionAgentsApi,
  skillsApi,
} from "@/lib/api";
import { McpConfigStrategyGeneral } from "@/lib/mcpConfigStrategy";
import type {
  AgentRuntimeReasoningCapability,
  AgentRuntimeStatus,
  BackendChatAgent,
  BackendChatSessionAgent,
  BackendChatSkill,
  BaseCodingAgent,
  JsonValue,
  McpConfig,
} from "@/types";
import {
  getRunnerLabel,
  getRuntimeDisplayState,
} from "./agent-runtime/agentRuntimeViewModel";
import { TeamConfigTabs } from "./team/TeamConfigTabs";
import { TeamMemberSidebar } from "./team/TeamMemberSidebar";
import {
  buildSessionAgentLookup,
  defaultOptionId,
  memberName,
  nonLeadRole,
  normalizeRunnerType,
  trimOrNull,
  type ProjectMemberWithExecution,
} from "./team/teamUtils";
import { ProjectMemberType } from "../../../shared/types";

const createRunnerOptions = (
  runners: AgentRuntimeStatus[],
): DropdownSelectOption[] => {
  return runners
    .filter((runner) => getRuntimeDisplayState(runner) === "available")
    .map((runner) => ({
      id: runner.runner_type,
      label: getRunnerLabel(runner.runner_type),
    }));
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
  capability?: AgentRuntimeReasoningCapability | null,
): DropdownSelectOption[] => [
  { id: defaultOptionId, label: "Default", description: "Use runtime default" },
  ...(capability?.options ?? []).filter(Boolean).map((option) => ({
    id: option,
    label: option.replace(/^thinking-/u, ""),
    description:
      capability?.kind === "variant" ? "Runtime variant" : "Reasoning effort",
  })),
];

const isObjectRecord = (value: unknown): value is Record<string, JsonValue> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const runtimeConfiguredModel = (
  runtime?: AgentRuntimeStatus | null,
): string => {
  return (
    isObjectRecord(runtime?.executor_options) &&
    typeof runtime.executor_options.model === "string"
      ? runtime.executor_options.model.trim()
      : ""
  );
};

type MemberFormState = {
  allowedSkillIds: string[];
  isLeader: boolean;
  memberName: string;
  modelName: string;
  modelVariant: string;
  roleDefinition: string;
  runnerType: BaseCodingAgent;
  thinkingEffort: string;
  workspacePath: string;
};

const resolveMemberFormState = (
  member: ProjectMemberWithExecution,
  agent: BackendChatAgent | null,
  projectWorkspacePath?: string | null,
): MemberFormState => {
  const config = member.execution_config ?? {};
  const runner =
    config.runner_type ??
    normalizeRunnerType(agent?.runner_type) ??
    normalizeRunnerType(
      member.member_type === "agent" ? agent?.runner_type : null,
    ) ??
    "CODEX";

  return {
    allowedSkillIds: member.allowed_skill_ids ?? [],
    isLeader: member.role === "lead",
    memberName: member.member_name?.trim() || agent?.name?.trim() || "",
    modelName: config.model_name ?? agent?.model_name ?? "",
    modelVariant: config.model_variant ?? "",
    roleDefinition: agent?.system_prompt ?? "",
    runnerType: runner,
    thinkingEffort: config.thinking_effort ?? config.model_variant ?? "",
    workspacePath: member.default_workspace_path ?? projectWorkspacePath ?? "",
  };
};

const sameStringSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

export function TeamPage() {
  const {
    projects,
    selectedProjectId,
    activeSessionId,
    refreshMembers,
    refreshMessages,
  } = useWorkspace();
  const [members, setMembers] = useState<ProjectMemberWithExecution[]>([]);
  const [agents, setAgents] = useState<BackendChatAgent[]>([]);
  const [runners, setRunners] = useState<AgentRuntimeStatus[]>([]);
  const [skills, setSkills] = useState<BackendChatSkill[]>([]);
  const [runtimeSkills, setRuntimeSkills] = useState<BackendChatSkill[]>([]);
  const [runtimeSkillsLoading, setRuntimeSkillsLoading] = useState(false);
  const [runtimeSkillsError, setRuntimeSkillsError] = useState<string | null>(
    null,
  );
  const [sessionAgents, setSessionAgents] = useState<BackendChatSessionAgent[]>(
    [],
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [memberNameValue, setMemberNameValue] = useState("");
  const [isLeader, setIsLeader] = useState(false);
  const [allowedSkillIds, setAllowedSkillIds] = useState<string[]>([]);
  const [runnerType, setRunnerType] = useState<BaseCodingAgent>("CODEX");
  const [modelName, setModelName] = useState("");
  const [thinkingEffort, setThinkingEffort] = useState("");
  const [modelVariant, setModelVariant] = useState("");
  const [roleDefinition, setRoleDefinition] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [memberSuccess, setMemberSuccess] = useState(false);
  const [switchingLeadMemberId, setSwitchingLeadMemberId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mcpConfig, setMcpConfig] = useState<McpConfig | null>(null);
  const [mcpServersJson, setMcpServersJson] = useState("{}");
  const [originalMcpServersJson, setOriginalMcpServersJson] = useState("{}");
  const [mcpConfigPath, setMcpConfigPath] = useState("");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpApplying, setMcpApplying] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpSuccess, setMcpSuccess] = useState(false);

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
  const memberFormState = useMemo(
    () =>
      selectedMember
        ? resolveMemberFormState(
            selectedMember,
            selectedAgent,
            currentProject?.default_workspace_path,
          )
        : null,
    [currentProject?.default_workspace_path, selectedAgent, selectedMember],
  );
  const sessionAgentLookup = useMemo(
    () => buildSessionAgentLookup(sessionAgents),
    [sessionAgents],
  );
  const runtimeOptions = useMemo(
    () => createRunnerOptions(runners),
    [runners],
  );
  const selectedRuntime = useMemo(
    () => runners.find((runner) => runner.runner_type === runnerType),
    [runnerType, runners],
  );
  const modelOptions = useMemo(() => {
    const discovered = selectedRuntime?.discovered_models ?? [];
    const models = Array.from(
      new Set([modelName, ...discovered].filter(Boolean)),
    );
    return createModelOptions(models);
  }, [modelName, selectedRuntime]);
  const capability = selectedMember?.reasoning_capability ?? null;
  const reasoningOptions = useMemo(
    () => createReasoningOptions(capability),
    [capability],
  );
  const selectedModelValue = modelName || defaultOptionId;
  const selectedReasoningValue =
    (capability?.kind === "variant" ? modelVariant : thinkingEffort) ||
    defaultOptionId;
  const mcpDirty = mcpServersJson !== originalMcpServersJson;
  const memberDirty =
    memberFormState !== null &&
    (workspacePath !== memberFormState.workspacePath ||
      memberNameValue !== memberFormState.memberName ||
      isLeader !== memberFormState.isLeader ||
      runnerType !== memberFormState.runnerType ||
      modelName !== memberFormState.modelName ||
      thinkingEffort !== memberFormState.thinkingEffort ||
      modelVariant !== memberFormState.modelVariant ||
      roleDefinition !== memberFormState.roleDefinition ||
      !sameStringSet(allowedSkillIds, memberFormState.allowedSkillIds));
  const configuredMcpServerKeys = useMemo(() => {
    if (!mcpConfig || mcpLoading) return [];
    try {
      const fullConfig = mcpServersJson.trim()
        ? (JSON.parse(mcpServersJson) as JsonValue)
        : {};
      return McpConfigStrategyGeneral.configuredServerKeys(
        mcpConfig,
        fullConfig,
      );
    } catch {
      return [];
    }
  }, [mcpConfig, mcpLoading, mcpServersJson]);

  const load = async () => {
    if (!selectedProjectId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const sessionAgentPromise = activeSessionId
        ? sessionAgentsApi.list(activeSessionId).catch(() => [])
        : Promise.resolve([]);
      const [
        projectMembers,
        chatAgents,
        runtimeData,
        skillList,
        activeSessionAgents,
      ] = await Promise.all([
        projectApi.listMembers(selectedProjectId),
        chatAgentsApi.list(),
        agentRuntimeApi.list(),
        skillsApi.list(),
        sessionAgentPromise,
      ]);
      const nextMembers = projectMembers as ProjectMemberWithExecution[];
      setMembers(nextMembers);
      setAgents(chatAgents);
      setRunners(runtimeData.runners);
      setSkills(skillList);
      setSessionAgents(activeSessionAgents);

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
  }, [activeSessionId, selectedProjectId]);

  useEffect(() => {
    setMemberSuccess(false);
  }, [selectedMember?.id]);

  useEffect(() => {
    if (!memberSuccess) return;
    const timeoutId = window.setTimeout(() => setMemberSuccess(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [memberSuccess]);

  useEffect(() => {
    if (!mcpSuccess) return;
    const timeoutId = window.setTimeout(() => setMcpSuccess(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [mcpSuccess]);

  useEffect(() => {
    if (memberDirty && memberSuccess) setMemberSuccess(false);
  }, [memberDirty, memberSuccess]);

  useEffect(() => {
    if (mcpDirty && mcpSuccess) setMcpSuccess(false);
  }, [mcpDirty, mcpSuccess]);

  useEffect(() => {
    if (!memberFormState) return;
    setWorkspacePath(memberFormState.workspacePath);
    setMemberNameValue(memberFormState.memberName);
    setIsLeader(memberFormState.isLeader);
    setAllowedSkillIds(memberFormState.allowedSkillIds);
    setRunnerType(memberFormState.runnerType);
    setModelName(memberFormState.modelName);
    setThinkingEffort(memberFormState.thinkingEffort);
    setModelVariant(memberFormState.modelVariant);
    setRoleDefinition(memberFormState.roleDefinition);
    setNotice(null);
  }, [memberFormState]);

  useEffect(() => {
    if (!selectedMember) {
      setRuntimeSkills([]);
      setRuntimeSkillsLoading(false);
      setRuntimeSkillsError(null);
      setMcpConfig(null);
      setMcpServersJson("{}");
      setOriginalMcpServersJson("{}");
      setMcpConfigPath("");
      setMcpError(null);
      setMcpLoading(false);
      setMcpSuccess(false);
      return;
    }

    let cancelled = false;
    setRuntimeSkillsLoading(true);
    setRuntimeSkillsError(null);
    void skillsApi
      .listNative(runnerType)
      .then((items) => {
        if (cancelled) return;
        setRuntimeSkills(items.map((item) => item.skill));
      })
      .catch((err) => {
        if (cancelled) return;
        setRuntimeSkills([]);
        setRuntimeSkillsError(
          err instanceof Error
            ? err.message
            : "Installed skills are unavailable for this runtime.",
        );
      })
      .finally(() => {
        if (!cancelled) setRuntimeSkillsLoading(false);
      });

    setMcpLoading(true);
    setMcpError(null);
    setMcpSuccess(false);
    void mcpServersApi
      .load(runnerType)
      .then((response) => {
        if (cancelled) return;
        const fullConfig = McpConfigStrategyGeneral.createFullConfig(
          response.mcp_config,
        );
        const configJson = JSON.stringify(fullConfig, null, 2);
        setMcpConfig(response.mcp_config);
        setMcpServersJson(configJson);
        setOriginalMcpServersJson(configJson);
        setMcpConfigPath(response.config_path);
      })
      .catch((err) => {
        if (cancelled) return;
        setMcpConfig(null);
        setMcpServersJson("{}");
        setOriginalMcpServersJson("{}");
        setMcpConfigPath("");
        setMcpError(
          err instanceof Error
            ? err.message
            : "MCP server config is unavailable.",
        );
      })
      .finally(() => {
        if (!cancelled) setMcpLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runnerType, selectedMember]);

  const setLeadMember = async (member: ProjectMemberWithExecution) => {
    if (!selectedProjectId) return;
    setSelectedMemberId(member.id);
    if (member.role === "lead") return;

    const agent = agents.find((item) => item.id === member.agent_id);
    const membersToUpdate = currentProjectMembers.filter(
      (item) => item.id === member.id || item.role === "lead",
    );
    setSaving(true);
    setSwitchingLeadMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const updatedMembers = await Promise.all(
        membersToUpdate.map((item) =>
          projectApi.updateMember(selectedProjectId, item.id, {
            role: item.id === member.id ? "lead" : nonLeadRole,
            display_order: null,
            default_workspace_path: null,
            is_default: null,
            allowed_skill_ids: null,
            execution_config: null,
          } as never),
        ),
      );
      setMembers((current) =>
        current.map((item) => {
          const updated = updatedMembers.find(
            (updatedMember) => updatedMember.id === item.id,
          );
          return updated ? (updated as ProjectMemberWithExecution) : item;
        }),
      );
      setSelectedMemberId(member.id);
      setNotice(`${memberName(member, agent)} is now the main agent.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to switch main agent",
      );
    } finally {
      setSaving(false);
      setSwitchingLeadMemberId(null);
    }
  };

  const saveMember = async () => {
    if (!selectedProjectId || !selectedMember) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setMemberSuccess(false);
    try {
      const explicitMemberName = selectedMember.member_name?.trim() ?? "";
      const fallbackAgentName = selectedAgent?.name?.trim() ?? "";
      const nextMemberName = memberNameValue.trim();
      const memberNamePayload =
        !explicitMemberName &&
        fallbackAgentName &&
        nextMemberName === fallbackAgentName
          ? null
          : trimOrNull(memberNameValue);
      const memberUpdate = projectApi.updateMember(
        selectedProjectId,
        selectedMember.id,
        {
          role: isLeader ? "lead" : nonLeadRole,
          member_name: memberNamePayload,
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
        current.map((member) => {
          const nextMember =
            member.id === updatedMember.id
              ? (updatedMember as ProjectMemberWithExecution)
              : member;
          if (
            updatedMember.role === "lead" &&
            member.project_id === updatedMember.project_id &&
            member.member_type === "agent" &&
            member.id !== updatedMember.id &&
            member.role === "lead"
          ) {
            return { ...nextMember, role: nonLeadRole };
          }
          return nextMember;
        }),
      );
      if (updatedAgent) {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updatedAgent.id ? updatedAgent : agent,
          ),
        );
      }
      await Promise.all([
        activeSessionId
          ? sessionAgentsApi
              .list(activeSessionId)
              .then((activeSessionAgents) =>
                setSessionAgents(activeSessionAgents),
              )
              .catch(() => undefined)
          : Promise.resolve(),
        refreshMembers().catch(() => undefined),
        refreshMessages().catch(() => undefined),
      ]);
      setMemberSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save project member",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleMcpServersChange = (value: string) => {
    setMcpServersJson(value);
    setMcpSuccess(false);
    setMcpError(null);
    if (!value.trim() || !mcpConfig) return;
    try {
      const parsed = JSON.parse(value) as JsonValue;
      McpConfigStrategyGeneral.validateFullConfig(mcpConfig, parsed);
    } catch (err) {
      setMcpError(
        err instanceof SyntaxError
          ? "Invalid JSON"
          : err instanceof Error
            ? err.message
            : "Invalid MCP configuration",
      );
    }
  };

  const toggleMcpServer = (serverKey: string) => {
    if (!mcpConfig) return;
    try {
      const existing = mcpServersJson.trim()
        ? (JSON.parse(mcpServersJson) as JsonValue)
        : {};
      const selected = McpConfigStrategyGeneral.hasPreconfiguredInConfig(
        mcpConfig,
        existing,
        serverKey,
      );
      const updated = selected
        ? McpConfigStrategyGeneral.removePreconfiguredFromConfig(
            mcpConfig,
            existing,
            serverKey,
          )
        : McpConfigStrategyGeneral.addPreconfiguredToConfig(
            mcpConfig,
            existing,
            serverKey,
          );
      setMcpServersJson(JSON.stringify(updated, null, 2));
      setMcpError(null);
      setMcpSuccess(false);
    } catch (err) {
      setMcpError(
        err instanceof Error ? err.message : "Failed to add MCP server",
      );
    }
  };

  const applyMcpServers = async () => {
    if (!mcpConfig) return;
    setMcpApplying(true);
    setMcpError(null);
    setMcpSuccess(false);
    try {
      const fullConfig = JSON.parse(mcpServersJson) as JsonValue;
      McpConfigStrategyGeneral.validateFullConfig(mcpConfig, fullConfig);
      const servers = McpConfigStrategyGeneral.extractServersForApi(
        mcpConfig,
        fullConfig,
      );
      await mcpServersApi.save(runnerType, { servers });
      setOriginalMcpServersJson(mcpServersJson);
      setMcpSuccess(true);
    } catch (err) {
      setMcpError(
        err instanceof SyntaxError
          ? "Invalid JSON"
          : err instanceof Error
            ? err.message
            : "Failed to save MCP configuration",
      );
    } finally {
      setMcpApplying(false);
    }
  };

  const handleRunnerTypeChange = (nextRunnerType: BaseCodingAgent) => {
    if (nextRunnerType === runnerType) return;
    const nextRuntime = runners.find(
      (runner) => runner.runner_type === nextRunnerType,
    );

    setRunnerType(nextRunnerType);
    setModelName(runtimeConfiguredModel(nextRuntime));
    setThinkingEffort("");
    setModelVariant("");
  };

  const discardMcpChanges = () => {
    setMcpServersJson(originalMcpServersJson);
    setMcpError(null);
    setMcpSuccess(false);
  };

  const discardMemberChanges = () => {
    if (!memberFormState) return;
    setMemberSuccess(false);
    setWorkspacePath(memberFormState.workspacePath);
    setMemberNameValue(memberFormState.memberName);
    setIsLeader(memberFormState.isLeader);
    setAllowedSkillIds(memberFormState.allowedSkillIds);
    setRunnerType(memberFormState.runnerType);
    setModelName(memberFormState.modelName);
    setThinkingEffort(memberFormState.thinkingEffort);
    setModelVariant(memberFormState.modelVariant);
    setRoleDefinition(memberFormState.roleDefinition);
    setNotice(null);
  };

  const addMember = async (agentId: string) => {
    if (!selectedProjectId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const agent = agents.find((item) => item.id === agentId);
      const newMember = await projectApi.addMember(selectedProjectId, {
        member_type: ProjectMemberType.agent,
        user_id: null,
        agent_id: agentId,
        member_name: trimOrNull(agent?.name ?? ""),
        role: nonLeadRole,
        display_order: members.length as unknown as bigint,
        default_workspace_path: null,
        allowed_skill_ids: [],
        execution_config: {},
        is_default: true,
      });
      const memberWithExec = newMember as ProjectMemberWithExecution;
      setMembers((current) => [...current, memberWithExec]);
      setSelectedMemberId(memberWithExec.id);
      await Promise.all([
        activeSessionId
          ? sessionAgentsApi
              .list(activeSessionId)
              .then((activeSessionAgents) =>
                setSessionAgents(activeSessionAgents),
              )
              .catch(() => undefined)
          : Promise.resolve(),
        refreshMembers().catch(() => undefined),
        refreshMessages().catch(() => undefined),
      ]);
      setNotice(`Added ${agent?.name ?? "agent"} as a project member.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add project member",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="mx-auto max-w-6xl rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] p-4 text-[14px] text-[var(--ink-subtle)]">
        Select a project to configure project members.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="shrink-0 bg-[var(--canvas)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-medium tracking-[0.4px] text-[var(--ink-subtle)]">
              TEAM · PROJECT MEMBER CONFIG
            </p>
            <h1 className="mt-1 text-[28px] font-semibold leading-[1.15] tracking-[-0.6px] text-[var(--ink)]">
              Project Members
            </h1>
            <p className="mt-1 max-w-[680px] text-[16px] leading-[1.5] text-[var(--ink-subtle)]">
              Configure project member runtimes, responsibilities, skills, and
              MCP servers.
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-4 pt-0">
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)]">
          {(error || notice) && (
            <div className="shrink-0 space-y-2 border-b border-[var(--hairline)] p-3">
              {error && (
                <div className="flex items-start gap-2 rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}
              {notice && (
                <div className="rounded-[8px] border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-[14px] text-[var(--success)]">
                  {notice}
                </div>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(260px,280px)_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-[var(--hairline)] bg-[var(--surface-1)] ot-scroll-area-styled lg:border-b-0 lg:border-r">
              <TeamMemberSidebar
                agents={agents}
                loading={loading}
                members={currentProjectMembers}
                saving={saving}
                selectedMemberId={selectedMemberId}
                sessionAgentLookup={sessionAgentLookup}
                switchingLeadMemberId={switchingLeadMemberId}
                onSelectMember={setSelectedMemberId}
                onSetLeadMember={(member) => void setLeadMember(member)}
                onAddMember={addMember}
              />
            </aside>

            <main className="min-h-0 overflow-y-auto bg-[var(--surface-1)] ot-scroll-area-styled">
              <TeamConfigTabs
                allowedSkillIds={allowedSkillIds}
                capability={capability}
                configuredMcpServerKeys={configuredMcpServerKeys}
                isLeader={isLeader}
                memberName={memberNameValue}
                memberNamePlaceholder={selectedAgent?.name ?? "Member name"}
                memberDirty={memberDirty}
                memberSuccess={memberSuccess}
                mcpApplying={mcpApplying}
                mcpConfig={mcpConfig}
                mcpConfigPath={mcpConfigPath}
                mcpDirty={mcpDirty}
                mcpError={mcpError}
                mcpLoading={mcpLoading}
                mcpServersJson={mcpServersJson}
                mcpSuccess={mcpSuccess}
                modelOptions={modelOptions}
                reasoningOptions={reasoningOptions}
                roleDefinition={roleDefinition}
                runnerType={runnerType}
                runtimeOptions={runtimeOptions}
                saving={saving}
                selectedMember={selectedMember}
                selectedModelValue={selectedModelValue}
                selectedReasoningValue={selectedReasoningValue}
                skillLookup={skills}
                skills={runtimeSkills}
                skillsError={runtimeSkillsError}
                skillsLoading={runtimeSkillsLoading}
                workspacePath={workspacePath}
                onDiscardMemberChanges={discardMemberChanges}
                onApplyMcpServers={applyMcpServers}
                onDiscardMcpChanges={discardMcpChanges}
                onMcpServersChange={handleMcpServersChange}
                onSaveMember={saveMember}
                onToggleMcpServer={toggleMcpServer}
                setAllowedSkillIds={setAllowedSkillIds}
                setIsLeader={setIsLeader}
                setMemberName={setMemberNameValue}
                setModelName={setModelName}
                setModelVariant={setModelVariant}
                setRoleDefinition={setRoleDefinition}
                setRunnerType={handleRunnerTypeChange}
                setThinkingEffort={setThinkingEffort}
                setWorkspacePath={setWorkspacePath}
              />
            </main>
          </div>
        </section>
      </div>
    </div>
  );
}
