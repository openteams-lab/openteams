import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight, ShieldCheck, Star, Trash2, X } from "lucide-react";
import type { DropdownSelectOption } from "@/components/DropdownSelect";
import { ProjectBreadcrumbAvatar } from "@/components/ProjectBreadcrumbAvatar";
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
import {
  TeamAddMemberButton,
  TeamMemberSidebar,
} from "./team/TeamMemberSidebar";
import {
  buildSessionAgentLookup,
  defaultOptionId,
  memberName,
  nonLeadRole,
  normalizeRunnerType,
  trimOrNull,
  type ProjectMemberWithExecution,
} from "./team/teamUtils";
import {
  ProjectMemberType,
  type BaseCodingAgent as ProjectBaseCodingAgent,
  type MemberExecutionConfig as ProjectMemberExecutionConfig,
} from "../../../shared/types";

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

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

const createModelOptions = (
  models: string[],
  t: TranslateFn,
): DropdownSelectOption[] => [
  {
    id: defaultOptionId,
    label: t("teamPage.options.defaultModel"),
    description: t("teamPage.options.runtimeDefault"),
  },
  ...models.map((model) => ({
    id: model,
    label: model,
    description: t("teamPage.options.discoveredModel"),
  })),
];

const createReasoningOptions = (
  t: TranslateFn,
  capability?: AgentRuntimeReasoningCapability | null,
): DropdownSelectOption[] => [
  {
    id: defaultOptionId,
    label: t("teamPage.options.default"),
    description: t("teamPage.options.runtimeDefault"),
  },
  ...(capability?.options ?? []).filter(Boolean).map((option) => ({
    id: option,
    label: option.replace(/^thinking-/u, ""),
    description:
      capability?.kind === "variant"
        ? t("teamPage.options.runtimeVariant")
        : t("teamPage.options.reasoningEffort"),
  })),
];

function TeamHeader({
  actions,
  projectName,
  t,
}: {
  actions?: ReactNode;
  projectName: string;
  t: TranslateFn;
}) {
  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px]">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-[7px]"
      >
        <ProjectBreadcrumbAvatar name={projectName} />
        <span className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
          {projectName}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
          strokeWidth={2.4}
        />
        <h1 className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
          {t("page.team")}
        </h1>
        <button
          type="button"
          className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
          aria-label="Favorite team page"
        >
          <Star aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
      </nav>

      <div className="flex min-w-0 items-center">{actions}</div>
    </header>
  );
}

function TeamRemoveMemberDialog({
  memberName,
  removing,
  t,
  onCancel,
  onConfirm,
}: {
  memberName: string;
  removing: boolean;
  t: TranslateFn;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="team-remove-member-title"
    >
      <div className="w-full max-w-[380px] rounded-[12px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-red-500/10 text-red-400">
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="team-remove-member-title"
              className="text-[15px] font-semibold text-[var(--ink)]"
            >
              {t("teamPage.dialog.removeMemberTitle")}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink-subtle)]">
              {t("teamPage.dialog.removeMemberDesc", {
                name: memberName,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("teamPage.action.cancel")}
            title={t("teamPage.action.cancel")}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 rounded-[8px] border border-red-500/15 bg-red-500/5 px-3 py-2 text-[12px] leading-relaxed text-red-300">
          {t("teamPage.dialog.removeMemberWarning")}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            className="h-9 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] px-4 text-[13px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("teamPage.action.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={removing}
            className="h-9 rounded-[8px] bg-red-500 px-4 text-[13px] font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {removing
              ? t("teamPage.action.removing")
              : t("teamPage.action.remove")}
          </button>
        </div>
      </div>
    </div>
  );
}

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

const noticeAutoDismissMs = 4200;

const createUniqueAgentName = (
  runnerType: BaseCodingAgent,
  agents: BackendChatAgent[],
) => {
  const baseName = `${getRunnerLabel(runnerType)} Agent`;
  const existingNames = new Set(
    agents.map((agent) => agent.name.trim().toLowerCase()).filter(Boolean),
  );
  if (!existingNames.has(baseName.toLowerCase())) return baseName;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!existingNames.has(candidate.toLowerCase())) return candidate;
  }

  return `${baseName} ${Date.now()}`;
};

const removeAgentFromProjectSessions = async (
  projectId: string,
  agentId: string | null,
) => {
  if (!agentId) return;

  const projectSessions = await projectApi.listSessions(projectId);
  await Promise.all(
    projectSessions.map(async (session) => {
      const sessionMembers = await sessionAgentsApi.list(session.id);
      const matchingSessionMembers = sessionMembers.filter(
        (sessionMember) => sessionMember.agent_id === agentId,
      );

      await Promise.all(
        matchingSessionMembers.map((sessionMember) =>
          sessionAgentsApi.remove(session.id, sessionMember.id),
        ),
      );
    }),
  );
};

export function TeamPage() {
  const {
    projects,
    projectsAsync,
    selectedProjectId,
    activeSessionId,
    refreshMembers,
    refreshMessages,
    t,
  } = useWorkspace();
  const [members, setMembers] = useState<ProjectMemberWithExecution[]>([]);
  const [membersProjectId, setMembersProjectId] = useState<string | null>(null);
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
  const [saving, setSaving] = useState(false);
  const [memberSuccess, setMemberSuccess] = useState(false);
  const [memberPendingRemoval, setMemberPendingRemoval] =
    useState<ProjectMemberWithExecution | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
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
  const loadRequestIdRef = useRef(0);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const currentProjectName = currentProject?.name ?? "Project";
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
  const addableRuntimeOptions = useMemo(
    () =>
      runners.map((runner) => ({
        label: getRunnerLabel(runner.runner_type),
        modelName:
          runtimeConfiguredModel(runner) || runner.discovered_models[0] || null,
        runnerType: runner.runner_type,
      })),
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
    return createModelOptions(models, t);
  }, [modelName, selectedRuntime, t]);
  const capability = selectedMember?.reasoning_capability ?? null;
  const reasoningOptions = useMemo(
    () => createReasoningOptions(t, capability),
    [capability, t],
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
  const projectSelectionPending = projectsAsync.loading && !selectedProjectId;
  const teamDataReady = selectedProjectId
    ? membersProjectId === selectedProjectId
    : !projectSelectionPending;
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
    const requestId = ++loadRequestIdRef.current;
    if (!selectedProjectId) {
      setMembers([]);
      setMembersProjectId(null);
      return;
    }
    const projectId = selectedProjectId;
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
        projectApi.listMembers(projectId),
        chatAgentsApi.list({ projectId }),
        agentRuntimeApi.list(),
        skillsApi.list(),
        sessionAgentPromise,
      ]);
      if (loadRequestIdRef.current !== requestId) return;
      const nextMembers = projectMembers as ProjectMemberWithExecution[];
      setMembers(nextMembers);
      setMembersProjectId(projectId);
      setAgents(chatAgents);
      setRunners(runtimeData.runners);
      setSkills(skillList);
      setSessionAgents(activeSessionAgents);

      const nextProjectMembers = nextMembers.filter(
        (member) =>
          member.project_id === projectId &&
          member.member_type === "agent",
      );
      setSelectedMemberId((current) =>
        nextProjectMembers.some((member) => member.id === current)
          ? current
          : (nextProjectMembers[0]?.id ?? ""),
      );
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      setMembers([]);
      setMembersProjectId(projectId);
      setError(err instanceof Error ? err.message : t("teamPage.error.load"));
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
    if (!notice) return;
    const timeoutId = window.setTimeout(
      () => setNotice(null),
      noticeAutoDismissMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

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
            : t("teamPage.error.runtimeSkillsUnavailable"),
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
            : t("teamPage.error.mcpConfigUnavailable"),
        );
      })
      .finally(() => {
        if (!cancelled) setMcpLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runnerType, selectedMember]);

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
        err instanceof Error ? err.message : t("teamPage.error.saveMember"),
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
          ? t("teamPage.error.invalidJson")
          : err instanceof Error
            ? err.message
            : t("teamPage.error.invalidMcpConfig"),
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
        err instanceof Error ? err.message : t("teamPage.error.addMcpServer"),
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
          ? t("teamPage.error.invalidJson")
          : err instanceof Error
            ? err.message
            : t("teamPage.error.saveMcpConfig"),
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

  const addProjectMemberForAgent = async (
    agent: BackendChatAgent,
    executionConfig: ProjectMemberExecutionConfig = {},
  ) => {
    if (!selectedProjectId) return;
    const newMember = await projectApi.addMember(selectedProjectId, {
      member_type: ProjectMemberType.agent,
      user_id: null,
      agent_id: agent.id,
      member_name: trimOrNull(agent.name),
      role: nonLeadRole,
      display_order: members.length as unknown as bigint,
      default_workspace_path: null,
      allowed_skill_ids: [],
      execution_config: executionConfig ?? {},
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
    setNotice(
      t("teamPage.notice.memberAdded", {
        name: agent.name || t("teamPage.fallback.agent"),
      }),
    );
  };

  const addMember = async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!selectedProjectId || !agent) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await addProjectMemberForAgent(agent);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("teamPage.error.addMember"),
      );
    } finally {
      setSaving(false);
    }
  };

  const createMemberFromRuntime = async (runnerType: BaseCodingAgent) => {
    if (!selectedProjectId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const runtime = runners.find((item) => item.runner_type === runnerType);
      const modelName =
        (runtime ? runtimeConfiguredModel(runtime) : "") ||
        runtime?.discovered_models[0] ||
        null;
      const agent = await chatAgentsApi.create({
        name: createUniqueAgentName(runnerType, agents),
        runner_type: runnerType,
        system_prompt: null,
        tools_enabled: {},
        model_name: modelName,
        owner_project_id: selectedProjectId,
      });
      setAgents((current) =>
        current.some((item) => item.id === agent.id)
          ? current
          : [...current, agent],
      );
      await addProjectMemberForAgent(agent, {
        runner_type: runnerType as unknown as ProjectBaseCodingAgent,
        model_name: modelName,
        thinking_effort: null,
        model_variant: null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("teamPage.error.addMember"),
      );
    } finally {
      setSaving(false);
    }
  };

  const requestRemoveMember = (member: ProjectMemberWithExecution) => {
    setMemberPendingRemoval(member);
    setError(null);
    setNotice(null);
  };

  const removeMember = async () => {
    if (!selectedProjectId || !memberPendingRemoval) return;
    const member = memberPendingRemoval;
    const agent = agents.find((item) => item.id === member.agent_id);
    const removedName = memberName(member, agent);
    setSaving(true);
    setRemovingMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      await projectApi.removeMember(selectedProjectId, member.id);
      await removeAgentFromProjectSessions(selectedProjectId, member.agent_id);
      const nextMembers = members.filter((item) => item.id !== member.id);
      setMembers(nextMembers);
      setSelectedMemberId((current) => {
        if (current !== member.id) return current;
        return (
          nextMembers.find(
            (item) =>
              item.project_id === selectedProjectId &&
              item.member_type === "agent",
          )?.id ?? ""
        );
      });
      setMemberPendingRemoval(null);
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
      setNotice(
        t("teamPage.notice.memberRemoved", {
          name: removedName,
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("teamPage.error.removeMember"),
      );
    } finally {
      setSaving(false);
      setRemovingMemberId(null);
    }
  };

  const pendingRemovalAgent = memberPendingRemoval
    ? agents.find((item) => item.id === memberPendingRemoval.agent_id)
    : null;
  const pendingRemovalName = memberPendingRemoval
    ? memberName(memberPendingRemoval, pendingRemovalAgent)
    : "";

  if (!selectedProjectId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
        <TeamHeader projectName={currentProjectName} t={t} />
        {!projectSelectionPending && (
          <div className="p-[19px] text-[14px] text-[var(--ink-subtle)]">
            {t("teamPage.empty.noProject")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
      <TeamHeader
        projectName={currentProjectName}
        t={t}
        actions={
          teamDataReady ? (
            <TeamAddMemberButton
              agents={agents}
              members={currentProjectMembers}
              runtimeOptions={addableRuntimeOptions}
              saving={saving}
              onAddMember={addMember}
              onCreateMember={createMemberFromRuntime}
              t={t}
            />
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-2)]">
        {teamDataReady && (error || notice) && (
          <div className="shrink-0 space-y-2 border-b border-[var(--hairline)] p-3">
            {error && (
              <div className="flex items-start gap-2 rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-2 rounded-[8px] border border-[var(--success)]/30 bg-[var(--success)]/10 p-3 text-[14px] text-[var(--success)]">
                <span className="min-w-0 flex-1">{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[var(--success)] opacity-70 transition hover:bg-[var(--success)]/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--success)]/35"
                  aria-label="Close notification"
                  title="Close notification"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {teamDataReady && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(260px,280px)_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-[var(--hairline)] bg-[var(--surface-2)] ot-scroll-area-styled lg:border-b-0 lg:border-r">
            <TeamMemberSidebar
              agents={agents}
              loading={false}
              members={currentProjectMembers}
              saving={saving}
              selectedMemberId={selectedMemberId}
              sessionAgentLookup={sessionAgentLookup}
              onRemoveMember={requestRemoveMember}
              onSelectMember={setSelectedMemberId}
              t={t}
            />
          </aside>

          <main className="min-h-0 overflow-y-auto bg-[var(--surface-2)] text-[var(--ink)] ot-scroll-area-styled">
            <TeamConfigTabs
              allowedSkillIds={allowedSkillIds}
              capability={capability}
              configuredMcpServerKeys={configuredMcpServerKeys}
              isLeader={isLeader}
              memberName={memberNameValue}
              memberNamePlaceholder={
                selectedAgent?.name ?? t("teamPage.form.memberName")
              }
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
              t={t}
            />
          </main>
        </div>
        )}
      </div>
      {memberPendingRemoval && (
        <TeamRemoveMemberDialog
          memberName={pendingRemovalName}
          removing={removingMemberId === memberPendingRemoval.id}
          t={t}
          onCancel={() => {
            if (!removingMemberId) setMemberPendingRemoval(null);
          }}
          onConfirm={() => void removeMember()}
        />
      )}
    </div>
  );
}
