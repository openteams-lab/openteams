import {
  ArrowLeft,
  Bot,
  Box,
  Bug,
  ChevronRight,
  Code2,
  Flame,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  Save,
  Settings,
  PenTool,
  Telescope,
  Terminal,
  TrendingUp,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AgentMarkdown } from "@/components/AgentMarkdown";
import {
  DropdownSelect,
  type DropdownSelectOption,
} from "@/components/DropdownSelect";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  agentRuntimeApi,
  chatAgentsApi,
  chatSessionsApi,
  projectApi,
  sessionAgentsApi,
  skillsApi,
  teamPresetsApi,
} from "@/lib/api";
import {
  getRuntimeDisplayState,
  getRunnerLabel,
} from "@/pages/agent-runtime/agentRuntimeViewModel";
import type {
  AgentRuntimeStatus,
  BackendChatSkill,
  JsonValue as FrontendJsonValue,
  UpdateChatSession,
} from "@/types";
import { ProjectMemberType } from "../../../shared/types";
import type {
  BaseCodingAgent as ProjectBaseCodingAgent,
  ChatMemberPreset,
  ChatTeamPreset,
  CreateTeamPresetRequest,
  JsonValue,
  ProjectMemberWithRuntime,
  TeamPresetMemberSummary,
  TeamPresetSummary,
  UpdateTeamPresetRequest,
} from "../../../shared/types";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

type WorkflowStepForm = {
  title: string;
  description: string;
};

type MemberForm = {
  id: string;
  name: string;
  description: string;
  runnerType: string;
  recommendedModel: string;
  systemPrompt: string;
  selectedSkillIdsText: string;
  toolsEnabledText: string;
};

type TeamPresetForm = {
  id: string;
  name: string;
  description: string;
  leadMemberId: string;
  workflowSteps: WorkflowStepForm[];
  teamProtocol: string;
  enabled: boolean;
  members: MemberForm[];
};

type EditorMode = "create" | "edit" | null;

type DraftCommitOptions = {
  autoSave?: boolean;
  validateTools?: boolean;
};

type FormValidationIssue = {
  fieldKey?: string;
  memberId?: string;
  message: string;
};

const emptyToolsEnabledText = "{}";
const defaultRunnerOptionId = "__default_runner";
const defaultModelOptionId = "__default_model";

const jsonValueToText = (value: JsonValue | null | undefined): string => {
  if (value === null || value === undefined) return emptyToolsEnabledText;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return emptyToolsEnabledText;
  }
};

const createUniqueTemplateId = (): string =>
  `custom_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const blankMember = (index: number): MemberForm => ({
  id: index === 0 ? "lead" : `member_${index + 1}`,
  name: index === 0 ? "Lead" : `Member ${index + 1}`,
  description: "",
  runnerType: "",
  recommendedModel: "",
  systemPrompt: "",
  selectedSkillIdsText: "",
  toolsEnabledText: emptyToolsEnabledText,
});

const blankForm = (): TeamPresetForm => ({
  id: createUniqueTemplateId(),
  name: "",
  description: "",
  leadMemberId: "lead",
  workflowSteps: [],
  teamProtocol: "",
  enabled: true,
  members: [blankMember(0)],
});

const detailToForm = (detail: ChatTeamPreset): TeamPresetForm => ({
  id: detail.id,
  name: detail.name,
  description: detail.description || "",
  leadMemberId: detail.lead_member_id ?? "",
  workflowSteps: detail.workflow_steps.map((step) => ({
    title: step.title,
    description: step.description,
  })),
  teamProtocol: detail.team_protocol || "",
  enabled: detail.enabled,
  members: detail.members.map((member) => ({
    id: member.id,
    name: member.name,
    description: member.description || "",
    runnerType: member.runner_type ?? "",
    recommendedModel: member.recommended_model ?? "",
    systemPrompt: member.system_prompt || "",
    selectedSkillIdsText: member.selected_skill_ids.join(", "),
    toolsEnabledText: jsonValueToText(member.tools_enabled),
  })),
});

const parseSkillIds = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseToolsEnabled = (value: string): JsonValue | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as JsonValue;
};

const normalizeWorkflowSteps = (
  steps: WorkflowStepForm[],
): WorkflowStepForm[] =>
  steps
    .map((step) => ({
      title: step.title.trim(),
      description: step.description.trim(),
    }))
    .filter((step) => step.title || step.description);

const formToPayload = (
  form: TeamPresetForm,
): CreateTeamPresetRequest | UpdateTeamPresetRequest => ({
  id: form.id.trim(),
  name: form.name.trim(),
  description: form.description.trim() || null,
  lead_member_id: form.leadMemberId.trim() || null,
  workflow_steps: normalizeWorkflowSteps(form.workflowSteps),
  team_protocol: form.teamProtocol.trim() || null,
  enabled: form.enabled,
  members: form.members.map((member) => ({
    id: member.id.trim(),
    name: member.name.trim(),
    description: member.description.trim() || null,
    runner_type: member.runnerType.trim() || null,
    recommended_model: member.recommendedModel.trim() || null,
    system_prompt: member.systemPrompt.trim() || null,
    default_workspace_path: null,
    selected_skill_ids: parseSkillIds(member.selectedSkillIdsText),
    tools_enabled: parseToolsEnabled(member.toolsEnabledText),
    enabled: true,
  })),
});

const validateTeamPresetForm = (
  form: TeamPresetForm,
): { issue: FormValidationIssue; payload?: never } | {
  issue?: never;
  payload: CreateTeamPresetRequest | UpdateTeamPresetRequest;
} => {
  if (!form.name.trim()) {
    return {
      issue: { fieldKey: "team:name", message: "Team name is required." },
    };
  }

  if (form.members.length === 0) {
    return {
      issue: { fieldKey: "team:members", message: "At least one member is required." },
    };
  }

  const memberIds = new Set<string>();
  for (const member of form.members) {
    const memberId = member.id.trim();
    if (!member.name.trim()) {
      return {
        issue: {
          fieldKey: `member:${member.id}:name`,
          memberId: member.id,
          message: "Member name is required.",
        },
      };
    }
    if (memberId && memberIds.has(memberId)) {
      return {
        issue: {
          fieldKey: `member:${member.id}:id`,
          memberId: member.id,
          message: "Member IDs must be unique.",
        },
      };
    }
    if (memberId) memberIds.add(memberId);
  }

  const leadMemberId = form.leadMemberId.trim();
  if (
    leadMemberId &&
    !form.members.some((member) => member.id.trim() === leadMemberId)
  ) {
    return {
      issue: {
        fieldKey: "team:lead_member_id",
        message: "Lead member must reference an existing member.",
      },
    };
  }

  for (const member of form.members) {
    try {
      parseToolsEnabled(member.toolsEnabledText);
    } catch {
      return {
        issue: {
          fieldKey: `member:${member.id}:tools_enabled`,
          memberId: member.id,
          message: "Invalid JSON format. Please check your syntax.",
        },
      };
    }
  }

  return { payload: formToPayload(form) };
};

const validateMemberToolsEnabled = (
  form: TeamPresetForm,
  memberId: string,
): FormValidationIssue | null => {
  const member = form.members.find((item) => item.id === memberId);
  if (!member) return null;

  try {
    parseToolsEnabled(member.toolsEnabledText);
    return null;
  } catch {
    return {
      fieldKey: `member:${member.id}:tools_enabled`,
      memberId: member.id,
      message: "Invalid JSON format. Please check your syntax.",
    };
  }
};

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export type TemplateMemberBuild = {
  allowedSkillIds: string[];
  displayOrder: number;
  modelName: string | null;
  name: string;
  role: string;
  runnerType: string;
  systemPrompt: string | null;
  toolsEnabled: FrontendJsonValue;
  workspacePath: string | null;
};

const isObjectRecord = (
  value: unknown,
): value is Record<string, FrontendJsonValue> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const runtimeConfiguredModel = (
  runtime?: AgentRuntimeStatus | null,
): string =>
  isObjectRecord(runtime?.executor_options) &&
  typeof runtime.executor_options.model === "string"
    ? runtime.executor_options.model.trim()
    : "";

const firstAvailableRuntime = (
  runtimes: AgentRuntimeStatus[],
): AgentRuntimeStatus | undefined =>
  runtimes.find((runner) => getRuntimeDisplayState(runner) === "available");

export const teamTemplateSessionUpdatePayload = (
  patch: Partial<UpdateChatSession>,
): UpdateChatSession => ({
  title: null,
  status: null,
  summary_text: null,
  archive_ref: null,
  last_seen_diff_key: null,
  team_protocol: null,
  team_protocol_enabled: null,
  default_workspace_path: null,
  ...patch,
});

export const buildTemplateMemberSpecs = (
  detail: ChatTeamPreset,
  workspacePath: string | null,
  runtimes: AgentRuntimeStatus[],
): TemplateMemberBuild[] => {
  const selectedMembers = detail.members.filter(
    (member) => member.enabled !== false,
  );
  const leadMemberId =
    detail.lead_member_id &&
    selectedMembers.some((member) => member.id === detail.lead_member_id)
      ? detail.lead_member_id
      : selectedMembers[0]?.id;

  return selectedMembers.flatMap((member, index) => {
    const configuredRunnerType = member.runner_type?.trim() ?? "";
    const runtime = configuredRunnerType
      ? runtimes.find((runner) => runner.runner_type === configuredRunnerType)
      : firstAvailableRuntime(runtimes);
    const runnerType = configuredRunnerType || runtime?.runner_type;
    if (!runnerType) return [];

    const recommendedModel = member.recommended_model?.trim() ?? "";
    const modelName =
      recommendedModel ||
      (runtime
        ? runtimeConfiguredModel(runtime) || runtime.discovered_models[0]
        : "") ||
      null;

    return [
      {
        allowedSkillIds: member.selected_skill_ids,
        displayOrder: index + 1,
        modelName,
        name: member.name,
        role: member.id === leadMemberId ? "lead" : "agent",
        runnerType,
        systemPrompt: member.system_prompt,
        toolsEnabled: (member.tools_enabled ?? {}) as unknown as FrontendJsonValue,
        workspacePath: member.default_workspace_path?.trim() || workspacePath,
      },
    ];
  });
};

const isAgentProjectMember = (member: ProjectMemberWithRuntime): boolean =>
  member.member_type === ProjectMemberType.agent;

const normalizeMemberIdentity = (value?: string | null): string =>
  (value ?? "").replace(/^@/, "").trim().toLowerCase();

const resolveProjectActiveTemplate = (
  projectMembers: ProjectMemberWithRuntime[],
  templates: TeamPresetSummary[],
): TeamPresetSummary | null => {
  const agentMembers = projectMembers.filter(isAgentProjectMember);
  if (agentMembers.length === 0) return null;

  const projectMemberNames = new Set(
    agentMembers
      .map((member) => normalizeMemberIdentity(member.member_name))
      .filter(Boolean),
  );
  if (projectMemberNames.size !== agentMembers.length) return null;

  const projectLeadName = normalizeMemberIdentity(
    agentMembers.find((member) => member.role === "lead")?.member_name,
  );

  return (
    templates.find((template) => {
      const templateMemberNames = template.members
        .map((member) => normalizeMemberIdentity(member.name))
        .filter(Boolean);
      if (
        templateMemberNames.length === 0 ||
        templateMemberNames.length !== projectMemberNames.size
      ) {
        return false;
      }
      if (!templateMemberNames.every((name) => projectMemberNames.has(name))) {
        return false;
      }

      const templateLeadName = normalizeMemberIdentity(
        template.members.find((member) => member.id === template.lead_member_id)
          ?.name,
      );
      return !templateLeadName || !projectLeadName || templateLeadName === projectLeadName;
    }) ?? null
  );
};

type ScenarioCategory = "开发" | "设计" | "科研" | "调研";

type WorkflowStepPreview = {
  title: string;
  description: string;
};

type TeamTemplatePresentation = {
  categories: ScenarioCategory[];
  workflow: WorkflowStepPreview[];
};

const scenarioBadgeClassName =
  "inline-flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase text-[var(--team-template-muted)]";

const hairlineSurfaceClassName =
  "relative overflow-hidden border border-[var(--team-template-border)] bg-[linear-gradient(180deg,var(--team-template-surface-top),var(--team-template-surface))] shadow-[inset_0_1px_0_var(--team-template-top-highlight)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[var(--team-template-top-glow)]";

const interactiveSurfaceClassName =
  "transition-all duration-150 ease-out hover:border-[var(--team-template-border-strong)] hover:bg-[var(--team-template-surface-hover)] hover:shadow-[inset_0_1px_0_var(--team-template-top-highlight-strong)]";

const quietButtonClassName =
  `inline-flex items-center justify-center rounded-[4px] ${hairlineSurfaceClassName} text-[var(--team-template-title)] ${interactiveSurfaceClassName}`;

const activeSurfaceClassName =
  "border border-[var(--team-template-border)] bg-[var(--team-template-active-surface)] shadow-[inset_0_1px_0_var(--team-template-top-highlight-strong)]";

const dangerGhostButtonClassName =
  "inline-flex items-center justify-center rounded-[4px] text-red-300/85 transition-colors duration-150 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50 disabled:hover:bg-transparent";

const recommendedBadgeClassName =
  "inline-flex text-[var(--team-template-muted)] transition-colors duration-150 group-hover:text-[var(--team-template-accent)]";

const categoryDotClassName: Record<ScenarioCategory, string> = {
  开发: "bg-[#4DAAFB]",
  设计: "bg-[#FF8A65]",
  科研: "bg-[#5DE4A7]",
  调研: "bg-[#C4A7FF]",
};

const defaultTemplatePresentation: TeamTemplatePresentation = {
  categories: ["开发"],
  workflow: [
    {
      title: "目标澄清",
      description: "确认输入、约束和交付标准。",
    },
    {
      title: "分工执行",
      description: "成员按角色推进任务并同步状态。",
    },
    {
      title: "复审交付",
      description: "汇总结果、检查风险并形成交付物。",
    },
  ],
};

const templatePresentationById: Record<string, TeamTemplatePresentation> = {
  "advanced-release-command": {
    categories: ["开发"],
    workflow: [
      {
        title: "版本范围",
        description: "确认变更、风险和发布窗口。",
      },
      {
        title: "质量校验",
        description: "执行 QA、回归检查和阻塞项整理。",
      },
      {
        title: "发布叙事",
        description: "生成 release notes 与用户沟通材料。",
      },
      {
        title: "上线复盘",
        description: "跟踪信号、缺陷和后续行动。",
      },
    ],
  },
  "advanced-growth-ops": {
    categories: ["调研"],
    workflow: [
      {
        title: "假设收集",
        description: "梳理实验目标、用户洞察和核心指标。",
      },
      {
        title: "实验设计",
        description: "确定变量、样本和成功判定方式。",
      },
      {
        title: "数据解读",
        description: "分析漏斗变化和显著性风险。",
      },
      {
        title: "决策建议",
        description: "沉淀结论并规划下一轮动作。",
      },
    ],
  },
};

const getTemplatePresentation = (teamId: string): TeamTemplatePresentation =>
  templatePresentationById[teamId] ?? defaultTemplatePresentation;

const getCategoryIcon = (category?: ScenarioCategory): typeof Box => {
  switch (category) {
    case "开发":
      return Terminal;
    case "设计":
      return PenTool;
    case "科研":
    case "调研":
      return Telescope;
    default:
      return Box;
  }
};

const getTemplateIcon = (
  teamId: string,
  teamName = "",
  category?: ScenarioCategory,
): typeof Box => {
  const signature = `${teamId} ${teamName}`.toLowerCase();

  if (/(release|launch|deploy|rollout)/.test(signature)) return Rocket;
  if (/(growth|marketing|funnel|experiment)/.test(signature)) {
    return TrendingUp;
  }
  if (/(campaign|content|copy|brand)/.test(signature)) return Megaphone;
  if (/(prompt|ai|agent|llm)/.test(signature)) return Bot;
  if (/(bug|fix|qa|quality|test|review)/.test(signature)) return Bug;
  if (/(full.?stack|delivery|code|dev|engineer|frontend|backend)/.test(signature)) {
    return Code2;
  }

  return getCategoryIcon(category);
};

const createMockMemberSummary = (
  id: string,
  name: string,
  description: string,
): TeamPresetMemberSummary => ({
  id,
  name,
  description,
  runner_type: null,
  recommended_model: null,
  is_builtin: true,
  enabled: true,
});

const advancedReleaseMemberSummaries = [
  createMockMemberSummary(
    "release_lead",
    "Release lead",
    "Owns release scope, risk triage, and final go/no-go framing.",
  ),
  createMockMemberSummary(
    "qa_reviewer",
    "QA reviewer",
    "Checks regression risk, verifies acceptance criteria, and records blockers.",
  ),
  createMockMemberSummary(
    "growth_writer",
    "Growth writer",
    "Turns release details into clear user-facing updates and follow-up notes.",
  ),
];

const advancedGrowthMemberSummaries = [
  createMockMemberSummary(
    "growth_lead",
    "Growth lead",
    "Defines experiment goals, prioritizes opportunities, and keeps the weekly decision loop tight.",
  ),
  createMockMemberSummary(
    "analytics",
    "Analytics",
    "Reads funnel movement, checks data quality, and summarizes decision confidence.",
  ),
  createMockMemberSummary(
    "copywriter",
    "Copywriter",
    "Drafts experiment variants, messaging angles, and post-test recommendations.",
  ),
];

const advancedTeamTemplates: TeamPresetSummary[] = [
  {
    id: "advanced-release-command",
    name: "Release command center",
    description:
      "Coordinate release notes, QA checks, rollout signals, and post-launch follow-up.",
    lead_member_id: "release_lead",
    team_protocol: "Mock professional release workflow placeholder.",
    is_builtin: true,
    enabled: true,
    member_count: advancedReleaseMemberSummaries.length,
    members: advancedReleaseMemberSummaries,
  },
  {
    id: "advanced-growth-ops",
    name: "Growth operations",
    description:
      "Plan experiments, analyze funnel deltas, and prepare weekly growth decisions.",
    lead_member_id: "growth_lead",
    team_protocol: "Mock professional growth workflow placeholder.",
    is_builtin: true,
    enabled: true,
    member_count: advancedGrowthMemberSummaries.length,
    members: advancedGrowthMemberSummaries,
  },
];

const createMockMemberPreset = (
  id: string,
  name: string,
  description: string,
  selectedSkillIds: string[],
): ChatMemberPreset => ({
  id,
  name,
  description,
  runner_type: null,
  recommended_model: null,
  system_prompt: description,
  default_workspace_path: null,
  selected_skill_ids: selectedSkillIds,
  tools_enabled: null as JsonValue,
  is_builtin: true,
  enabled: true,
});

const mockTeamTemplateDetails: Record<string, ChatTeamPreset> = {
  "advanced-release-command": {
    id: "advanced-release-command",
    name: "Release command center",
    description:
      "Coordinate release notes, QA checks, rollout signals, and post-launch follow-up.",
    lead_member_id: "release_lead",
    workflow_steps: [],
    team_protocol:
      "Release lead coordinates scope, QA signs off blockers, and growth writer prepares launch communication.",
    is_builtin: true,
    enabled: true,
    members: [
      createMockMemberPreset("release_lead", "Release lead", "Owns release scope, risk triage, and final go/no-go framing.", ["planning", "source-control"]),
      createMockMemberPreset("qa_reviewer", "QA reviewer", "Checks regression risk, verifies acceptance criteria, and records blockers.", ["review", "testing"]),
      createMockMemberPreset("growth_writer", "Growth writer", "Turns release details into clear user-facing updates and follow-up notes.", ["writing", "launch"]),
    ],
  },
  "advanced-growth-ops": {
    id: "advanced-growth-ops",
    name: "Growth operations",
    description:
      "Plan experiments, analyze funnel deltas, and prepare weekly growth decisions.",
    lead_member_id: "growth_lead",
    workflow_steps: [],
    team_protocol:
      "Growth lead frames the hypothesis, analytics validates results, and copywriter prepares experiment messaging.",
    is_builtin: true,
    enabled: true,
    members: [
      createMockMemberPreset("growth_lead", "Growth lead", "Defines experiment goals, prioritizes opportunities, and keeps the weekly decision loop tight.", ["planning", "metrics"]),
      createMockMemberPreset("analytics", "Analytics", "Reads funnel movement, checks data quality, and summarizes decision confidence.", ["analysis", "research"]),
      createMockMemberPreset("copywriter", "Copywriter", "Drafts experiment variants, messaging angles, and post-test recommendations.", ["writing", "experiments"]),
    ],
  },
};

function TeamTemplatesHeader({
  onCreate,
  t,
}: {
  onCreate: () => void;
  t: TranslateFn;
}) {
  const systemBreadcrumbLabel = t("agents.breadcrumb.system");

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--team-template-border)] bg-transparent px-6 shadow-[inset_0_-1px_0_rgba(255,255,255,0.02)]">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5"
      >
        <span
          role="img"
          aria-label={systemBreadcrumbLabel}
          title={systemBreadcrumbLabel}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--team-template-muted)]"
        >
          <Settings aria-hidden="true" className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[var(--team-template-border-strong)]"
          strokeWidth={1.5}
        />
        <h1 className="truncate text-[13px] font-medium leading-none text-[var(--team-template-title)]">
          {t("page.team-templates")}
        </h1>
      </nav>

      <button
        type="button"
        onClick={onCreate}
        className={`${quietButtonClassName} h-[28px] gap-1.5 px-3 text-[12px] font-medium hover:text-white`}
      >
        <Plus aria-hidden="true" className="h-3.5 w-3.5 -ml-0.5" strokeWidth={1.5} />
        新建模板
        <kbd className="ml-1 rounded border border-[var(--team-template-border)] px-1.5 py-px font-mono text-[10px] font-medium text-[var(--team-template-aux)]">
          N
        </kbd>
      </button>
    </header>
  );
}

function FormInput({
  disabled,
  error,
  label,
  onChange,
  variant = "default",
  value,
}: {
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  variant?: "default" | "bare" | "inline";
  value: string;
}) {
  const bare = variant === "bare";
  const inline = variant === "inline";

  if (inline) {
    return (
      <label className="team-template-compact-field grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 border-b border-[var(--team-template-border)] py-1.5 last:border-b-0">
        <span className="pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--team-template-aux)]">
          {label}
        </span>
        <span className="min-w-0">
          <input
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={[
              "team-template-field h-7 w-full rounded-[3px] border-0 bg-transparent px-1 text-[13px] text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] hover:bg-white/[0.035] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60",
              error ? "bg-red-500/10 text-red-200" : "",
            ].join(" ")}
          />
          {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        </span>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="font-mono text-[10px] font-semibold uppercase text-[var(--team-template-muted)]">
        {label}
      </span>
      <input
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={[
          "team-template-field mt-1.5 h-8 w-full border text-[13px] text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] disabled:cursor-not-allowed disabled:opacity-60",
          bare
            ? "rounded-none border-x-0 border-t-0 bg-transparent px-0 shadow-none focus:border-[var(--team-template-field-focus)]"
            : "rounded-[4px] bg-[var(--team-template-field-surface)] px-3 shadow-[inset_0_1px_0_var(--team-template-field-highlight)] focus:border-[var(--team-template-field-focus)] focus:shadow-[inset_0_0_0_1px_var(--team-template-field-focus)]",
          error ? "border-red-400/70" : "border-[var(--team-template-border)]",
        ].join(" ")}
      />
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </label>
  );
}

function FormTextarea({
  disabled,
  error,
  label,
  onChange,
  rows = 3,
  variant = "default",
  value,
}: {
  disabled?: boolean;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  variant?: "default" | "bare" | "inline";
  value: string;
}) {
  const bare = variant === "bare";
  const inline = variant === "inline";
  const inlineTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!inline) return;
    const textarea = inlineTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [inline, value]);

  if (inline) {
    return (
      <label className="team-template-compact-field grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 border-b border-[var(--team-template-border)] py-1.5 last:border-b-0">
        <span className="pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--team-template-aux)]">
          {label}
        </span>
        <span className="min-w-0">
          <textarea
            ref={inlineTextareaRef}
            disabled={disabled}
            value={value}
            rows={rows}
            onChange={(event) => onChange(event.target.value)}
            className={[
              "team-template-field min-h-7 w-full resize-none overflow-hidden rounded-[3px] border-0 bg-transparent px-1 py-1 text-[13px] leading-[1.45] text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] hover:bg-white/[0.035] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60",
              error ? "bg-red-500/10 text-red-200" : "",
            ].join(" ")}
          />
          {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
        </span>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="font-mono text-[10px] font-semibold uppercase text-[var(--team-template-muted)]">
        {label}
      </span>
      <textarea
        disabled={disabled}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className={[
          "team-template-field mt-1.5 w-full resize-y border text-[13px] leading-relaxed text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] disabled:cursor-not-allowed disabled:opacity-60",
          bare
            ? "rounded-none border-x-0 border-t-0 bg-transparent px-0 py-1 shadow-none focus:border-[var(--team-template-field-focus)]"
            : "rounded-[4px] bg-[var(--team-template-field-surface)] px-3 py-2 shadow-[inset_0_1px_0_var(--team-template-field-highlight)] focus:border-[var(--team-template-field-focus)] focus:shadow-[inset_0_0_0_1px_var(--team-template-field-focus)]",
          error ? "border-red-400/70" : "border-[var(--team-template-border)]",
        ].join(" ")}
      />
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </label>
  );
}

function AutoGrowingTextarea({
  disabled,
  onChange,
  placeholder,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      disabled={disabled}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="team-template-document-description -mx-1 mt-1.5 w-full resize-none overflow-hidden rounded-[4px] border-0 bg-transparent px-1 py-1 text-[14px] leading-relaxed text-[var(--team-template-muted)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-aux)] hover:bg-white/[0.035] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function WorkflowStepDescriptionTextarea({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      disabled={disabled}
      value={value}
      rows={1}
      placeholder="Add a step description..."
      onChange={(event) => onChange(event.target.value)}
      className="team-template-workflow-step-description -mx-1 mt-0.5 min-h-6 w-full resize-none overflow-hidden rounded-[3px] border-0 bg-transparent px-1 py-0.5 text-[12px] leading-[1.45] text-[var(--team-template-member-description)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-aux)] hover:bg-white/[0.035] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
    />
  );
}

function MarkdownEditableField({
  compact = false,
  disabled,
  editable,
  onCommit,
  placeholder,
  rows = 5,
  value,
}: {
  compact?: boolean;
  disabled?: boolean;
  editable: boolean;
  onCommit: (value: string) => void;
  placeholder: string;
  rows?: number;
  value: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = () => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  };

  if (editable && editing) {
    return (
      <textarea
        autoFocus
        disabled={disabled}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onBlur={commitDraft}
        onChange={(event) => setDraft(event.target.value)}
        className={
          compact
            ? "team-template-field w-full resize-y rounded-[3px] border border-transparent bg-transparent px-1 py-1 text-[13px] leading-[1.45] text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] hover:bg-white/[0.035] focus:border-[var(--team-template-field-focus)] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
            : "team-template-field w-full resize-y rounded-[4px] border border-[var(--team-template-border)] bg-[var(--team-template-field-surface)] px-3 py-2 text-[13px] leading-relaxed text-[var(--team-template-title)] shadow-[inset_0_1px_0_var(--team-template-field-highlight)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] focus:border-[var(--team-template-field-focus)] focus:shadow-[inset_0_0_0_1px_var(--team-template-field-focus)] disabled:cursor-not-allowed disabled:opacity-60"
        }
      />
    );
  }

  return (
    <div
      className={[
        compact
          ? "min-h-7 max-h-12 overflow-hidden rounded-[3px] border border-transparent bg-transparent px-1 py-1 text-[13px] leading-[1.45] text-[var(--team-template-title)]"
          : "min-h-[72px] rounded-[4px] border border-[var(--team-template-border)] bg-[var(--team-template-field-surface)] p-3 text-[13px] leading-relaxed text-[var(--team-template-title)] shadow-[inset_0_1px_0_var(--team-template-field-highlight)]",
        editable && !disabled
          ? compact
            ? "cursor-text hover:bg-white/[0.035] hover:text-[var(--team-template-title)]"
            : "cursor-text hover:border-[var(--team-template-border-strong)]"
          : "",
      ].join(" ")}
      onClick={() => {
        if (editable && !disabled) setEditing(true);
      }}
    >
      {value.trim() ? (
        <AgentMarkdown content={value} fontSize={13} />
      ) : (
        <span className="text-[var(--team-template-muted)]">{placeholder}</span>
      )}
    </div>
  );
}

function ScenarioBadges({ categories }: { categories: ScenarioCategory[] }) {
  const visibleCategories = categories.slice(0, 1);

  return (
    <div className="flex flex-wrap gap-2">
      {visibleCategories.map((category) => (
        <span
          key={category}
          className={scenarioBadgeClassName}
          data-category={category}
        >
          <span
            className={`h-1 w-1 rounded-full ${categoryDotClassName[category]}`}
          />
          {category}
        </span>
      ))}
    </div>
  );
}

function RecommendedBadge() {
  return (
    <span className={recommendedBadgeClassName} aria-label="热门" title="热门">
      <Flame aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.2} />
    </span>
  );
}

const getAvatarInitials = (label: string): string => {
  const parts = label
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const initials = (parts.length > 1 ? parts.slice(0, 2) : parts)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "AI";
};

const getTemplateAgentInitials = (template: TeamPresetSummary): string[] => {
  const source = template.members
    .map((member) => member.name)
    .filter(Boolean);

  if (source.length === 0) {
    return Array.from(
      { length: Math.min(template.member_count, 3) },
      (_, index) => `A${index + 1}`,
    );
  }

  return source.slice(0, 3).map(getAvatarInitials);
};

const getTemplateVersionLabel = (template: TeamPresetSummary): string =>
  template.is_builtin ? "v1.2" : "v1.0";

const memberDotClassNames = [
  "bg-[#4DAAFB]",
  "bg-[#C4A7FF]",
  "bg-[#5DE4A7]",
  "bg-[#F5B452]",
] as const;

const memberRoleToneClassNames = [
  "text-[#6DBBFF]",
  "text-[#C4A7FF]",
  "text-[#5DE4A7]",
  "text-[#F5B452]",
] as const;

const getMemberToneIndex = (member: ChatMemberPreset, index: number): number => {
  const signature = [
    member.id,
    member.name,
    member.description ?? "",
    member.selected_skill_ids.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/(ux|design|copy|writer|brand|content)/.test(signature)) {
    return 1;
  }
  if (/(backend|server|api|data|analytics|qa|test|review)/.test(signature)) {
    return 2;
  }
  if (/(ops|release|growth|research|experiment)/.test(signature)) {
    return 3;
  }

  return index % memberDotClassNames.length;
};

const getMemberDotClassName = (
  member: ChatMemberPreset,
  index: number,
): string => memberDotClassNames[getMemberToneIndex(member, index)];

const getMemberRoleToneClassName = (
  member: ChatMemberPreset,
  index: number,
): string => memberRoleToneClassNames[getMemberToneIndex(member, index)];

const getMemberRoleKey = (member: ChatMemberPreset): string => {
  const normalized = (member.id || member.name || "agent")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();

  return normalized || "agent";
};

const memberFallbackValue = "未配置";

const formatMemberValue = (
  value?: string | null,
  fallback = memberFallbackValue,
): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

const formatMemberJsonConfig = (value: JsonValue | null): string | null => {
  if (value === null) return null;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  ) {
    return null;
  }

  const serialized = JSON.stringify(value, null, 2);
  return serialized && serialized !== "null" ? serialized : null;
};

const memberFormToPreset = (member: MemberForm): ChatMemberPreset => {
  let toolsEnabled: JsonValue | null = null;
  try {
    toolsEnabled = parseToolsEnabled(member.toolsEnabledText);
  } catch {
    toolsEnabled = null;
  }

  return {
    id: member.id,
    name: member.name,
    description: member.description,
    runner_type: member.runnerType.trim() || null,
    recommended_model: member.recommendedModel.trim() || null,
    system_prompt: member.systemPrompt,
    default_workspace_path: null,
    selected_skill_ids: parseSkillIds(member.selectedSkillIdsText),
    tools_enabled: toolsEnabled as JsonValue,
    is_builtin: false,
    enabled: true,
  };
};

const formToPreviewDetail = (form: TeamPresetForm): ChatTeamPreset => ({
  id: form.id,
  name: form.name,
  description: form.description,
  members: form.members.map(memberFormToPreset),
  lead_member_id: form.leadMemberId || null,
  workflow_steps: form.workflowSteps,
  team_protocol: form.teamProtocol,
  is_builtin: false,
  enabled: form.enabled,
});

const formDirtySnapshot = (form: TeamPresetForm): string =>
  JSON.stringify({
    name: form.name,
    description: form.description,
    leadMemberId: form.leadMemberId,
    workflowSteps: form.workflowSteps,
    teamProtocol: form.teamProtocol,
    enabled: form.enabled,
    members: form.members.map((member) => ({
      id: member.id,
      name: member.name,
      description: member.description,
      runnerType: member.runnerType,
      recommendedModel: member.recommendedModel,
      systemPrompt: member.systemPrompt,
      selectedSkillIdsText: member.selectedSkillIdsText,
      toolsEnabledText: member.toolsEnabledText,
    })),
  });

const nextMemberDraft = (members: MemberForm[]): MemberForm => {
  const usedIds = new Set(members.map((member) => member.id));
  let index = members.length + 1;
  let id = `member_${index}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `member_${index}`;
  }
  return {
    ...blankMember(index - 1),
    id,
    name: `Member ${index}`,
  };
};

export const createTeamPresetDraft = (): TeamPresetForm => blankForm();

export const addCustomMemberDraft = (
  form: TeamPresetForm,
): { form: TeamPresetForm; selectedMemberId: string } => {
  const nextMember = nextMemberDraft(form.members);
  return {
    form: {
      ...form,
      leadMemberId: form.leadMemberId || nextMember.id,
      members: [...form.members, nextMember],
    },
    selectedMemberId: nextMember.id,
  };
};

export const commitTeamProtocolDraft = (
  form: TeamPresetForm,
  teamProtocol: string,
): TeamPresetForm => ({ ...form, teamProtocol });

export const commitMemberSystemPromptDraft = (
  form: TeamPresetForm,
  memberId: string,
  systemPrompt: string,
): TeamPresetForm => ({
  ...form,
  members: form.members.map((member) =>
    member.id === memberId ? { ...member, systemPrompt } : member,
  ),
});

export const validateTeamPresetDraft = validateTeamPresetForm;
export const validateMemberToolsEnabledDraft = validateMemberToolsEnabled;
export const teamPresetDraftToPayload = formToPayload;

function MemberInfoSection({
  children,
  meta,
  title,
}: {
  children: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <section className="team-template-compact-section border-t border-[var(--team-template-border)] pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[12px] font-semibold leading-tight text-[var(--team-template-title)]">
            {title}
          </h3>
        </div>
        <span className="font-mono text-[9px] font-medium tracking-[0.06em] text-[var(--team-template-aux)]">
          {meta}
        </span>
      </div>
      {children}
    </section>
  );
}

function MemberInfoField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-[var(--team-template-border)] py-2 last:border-b-0">
      <span className="font-mono text-[10px] font-medium uppercase text-[var(--team-template-aux)]">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-[12px] text-[var(--team-template-title)]">
        {value}
      </span>
    </div>
  );
}

function TemplateMemberInfoPage({
  disabled = false,
  editable = false,
  fieldErrors = {},
  formMember,
  index,
  installedSkills = [],
  isLead,
  member,
  onMemberChange,
  runtimes = [],
}: {
  disabled?: boolean;
  editable?: boolean;
  fieldErrors?: Record<string, string>;
  formMember?: MemberForm;
  index: number;
  installedSkills?: BackendChatSkill[];
  isLead: boolean;
  member: ChatMemberPreset;
  onMemberChange?: (
    patch: Partial<MemberForm>,
    options?: DraftCommitOptions,
  ) => void;
  runtimes?: AgentRuntimeStatus[];
}) {
  const roleKey = getMemberRoleKey(member);
  const roleDescription = formatMemberValue(
    member.description,
    "暂无职责描述。",
  );
  const systemPrompt = formatMemberValue(
    member.system_prompt,
    roleDescription,
  );
  const mcpConfig = formatMemberJsonConfig(member.tools_enabled);
  const memberKey = formMember?.id ?? member.id;
  const selectedSkillIds = useMemo(
    () => parseSkillIds(formMember?.selectedSkillIdsText ?? ""),
    [formMember?.selectedSkillIdsText],
  );
  const currentRunnerType = formMember?.runnerType.trim() ?? "";
  const currentModel = formMember?.recommendedModel.trim() ?? "";
  const availableRuntimes = useMemo(
    () =>
      runtimes.filter(
        (runtime) => getRuntimeDisplayState(runtime) === "available",
      ),
    [runtimes],
  );
  const runtimeOptions = useMemo<DropdownSelectOption[]>(() => {
    const options: DropdownSelectOption[] = [
      {
        id: defaultRunnerOptionId,
        label: "默认执行器",
        description: "使用首个可用执行器",
      },
      ...availableRuntimes.map((runtime) => ({
        id: runtime.runner_type,
        label: getRunnerLabel(runtime.runner_type),
        description:
          runtime.discovered_models.length > 0
            ? `${runtime.discovered_models.length} 个可用模型`
            : "未发现模型",
        group: "可用执行器",
      })),
    ];

    if (
      currentRunnerType &&
      !options.some((option) => option.id === currentRunnerType)
    ) {
      options.push({
        id: currentRunnerType,
        label: getRunnerLabel(currentRunnerType),
        description: "当前配置值，执行器当前不可用",
        group: "当前配置",
      });
    }

    return options;
  }, [availableRuntimes, currentRunnerType]);
  const runtimeForModels = useMemo(
    () =>
      currentRunnerType
        ? runtimes.find((runtime) => runtime.runner_type === currentRunnerType)
        : firstAvailableRuntime(availableRuntimes),
    [availableRuntimes, currentRunnerType, runtimes],
  );
  const effectiveRunnerType =
    currentRunnerType || runtimeForModels?.runner_type || "";
  const [runtimeSkills, setRuntimeSkills] = useState<BackendChatSkill[]>([]);
  const [runtimeSkillsLoading, setRuntimeSkillsLoading] = useState(false);
  const [runtimeSkillsError, setRuntimeSkillsError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!editable || !effectiveRunnerType) {
      setRuntimeSkills([]);
      setRuntimeSkillsLoading(false);
      setRuntimeSkillsError(null);
      return;
    }

    let cancelled = false;
    setRuntimeSkillsLoading(true);
    setRuntimeSkillsError(null);
    void skillsApi
      .listNative(effectiveRunnerType)
      .then((items) => {
        if (!cancelled) setRuntimeSkills(items.map((item) => item.skill));
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeSkills([]);
        setRuntimeSkillsError(
          errorText(error, "无法加载当前执行器的技能。"),
        );
      })
      .finally(() => {
        if (!cancelled) setRuntimeSkillsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editable, effectiveRunnerType]);
  const modelOptions = useMemo<DropdownSelectOption[]>(() => {
    const options: DropdownSelectOption[] = [
      {
        id: defaultModelOptionId,
        label: "默认模型",
        description: runtimeForModels
          ? `跟随 ${getRunnerLabel(runtimeForModels.runner_type)} 配置`
          : "选择执行器后使用默认模型",
      },
    ];
    const modelNames = [
      runtimeConfiguredModel(runtimeForModels),
      ...(runtimeForModels?.discovered_models ?? []),
    ]
      .map((model) => model.trim())
      .filter(Boolean);

    for (const modelName of Array.from(new Set(modelNames))) {
      options.push({
        id: modelName,
        label: modelName,
        description: runtimeForModels
          ? getRunnerLabel(runtimeForModels.runner_type)
          : undefined,
        group: "可用模型",
      });
    }

    if (
      currentModel &&
      !options.some((option) => option.id === currentModel)
    ) {
      options.push({
        id: currentModel,
        label: currentModel,
        description: "当前配置值，未在执行器模型列表中找到",
        group: "当前配置",
      });
    }

    return options;
  }, [currentModel, runtimeForModels]);
  const skillOptions = useMemo<DropdownSelectOption[]>(() => {
    const options: DropdownSelectOption[] = runtimeSkills.map((skill) => ({
      id: skill.id,
      label: skill.name,
      description: skill.description || skill.id,
      group: skill.category ?? "已安装技能",
      hint: skill.enabled ? undefined : "Disabled",
    }));
    const knownSkillIds = new Set(options.map((option) => option.id));
    for (const skillId of selectedSkillIds) {
      if (!knownSkillIds.has(skillId)) {
        const installedSkill = installedSkills.find(
          (skill) => skill.id === skillId,
        );
        options.push({
          id: skillId,
          label: installedSkill?.name ?? skillId,
          description: installedSkill
            ? "当前已选，但不属于当前执行器"
            : "当前已选，未在已安装技能中找到",
          group: "当前配置",
        });
      }
    }
    return options;
  }, [installedSkills, runtimeSkills, selectedSkillIds]);
  const skillPlaceholder = effectiveRunnerType
    ? `选择 ${getRunnerLabel(effectiveRunnerType)} 技能`
    : "选择执行器后配置技能";

  if (editable && formMember) {
    return (
      <aside className="team-template-member-detail flex min-h-0 flex-col p-1 text-[13px] lg:h-full lg:p-0">
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-[var(--team-template-border)] pb-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${getMemberDotClassName(member, index)}`}
            />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold leading-tight text-[var(--team-template-title)]">
                  {formMember.name || roleKey}
                </h2>
                {isLead && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--team-template-muted)]">
                    <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                    LEAD
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-[var(--team-template-aux)]">
                {roleKey}
              </p>
            </div>
          </div>
        </header>

        <div className="team-template-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pt-3">
          <MemberInfoSection meta="MEMBER" title="成员信息">
            <div>
              <FormInput
                disabled={disabled}
                error={fieldErrors[`member:${memberKey}:name`]}
                label="成员名"
                value={formMember.name}
                variant="inline"
                onChange={(name) => onMemberChange?.({ name })}
              />
              <FormTextarea
                disabled={disabled}
                label="成员描述"
                rows={1}
                value={formMember.description}
                variant="inline"
                onChange={(description) => onMemberChange?.({ description })}
              />
            </div>
          </MemberInfoSection>

          <MemberInfoSection meta="MODEL" title="模型配置">
            <div>
              <div className="team-template-compact-field grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 border-b border-[var(--team-template-border)] py-1.5">
                <span className="pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--team-template-aux)]">
                  执行器
                </span>
                <DropdownSelect
                  value={currentRunnerType || defaultRunnerOptionId}
                  options={runtimeOptions}
                  placeholder="选择执行器"
                  searchPlaceholder="搜索执行器..."
                  emptyLabel="暂无可用执行器"
                  disabled={disabled}
                  className="w-full [&>button]:h-7 [&>button]:rounded-[3px] [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-1 [&>button]:py-0 [&>button]:text-[13px] [&>button]:shadow-none [&>button:hover]:bg-white/[0.035]"
                  maxPanelHeightClassName="max-h-[180px]"
                  onChange={(value) =>
                    onMemberChange?.({
                      runnerType:
                        value === defaultRunnerOptionId ? "" : value,
                      recommendedModel: "",
                    })
                  }
                />
              </div>
              <div className="team-template-compact-field grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2 border-b border-[var(--team-template-border)] py-1.5 last:border-b-0">
                <span className="pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--team-template-aux)]">
                  模型
                </span>
                <DropdownSelect
                  value={currentModel || defaultModelOptionId}
                  options={modelOptions}
                  placeholder="选择模型"
                  searchPlaceholder="搜索模型..."
                  emptyLabel="暂无可用模型"
                  disabled={disabled || modelOptions.length === 0}
                  className="w-full [&>button]:h-7 [&>button]:rounded-[3px] [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-1 [&>button]:py-0 [&>button]:text-[13px] [&>button]:shadow-none [&>button:hover]:bg-white/[0.035]"
                  maxPanelHeightClassName="max-h-[180px]"
                  onChange={(value) =>
                    onMemberChange?.({
                      recommendedModel:
                        value === defaultModelOptionId ? "" : value,
                    })
                  }
                />
              </div>
            </div>
          </MemberInfoSection>

          <MemberInfoSection meta="ROLE" title="职责设定">
            <MarkdownEditableField
              compact
              disabled={disabled}
              editable
              placeholder="填写成员职责设定..."
              rows={4}
              value={formMember.systemPrompt}
              onCommit={(systemPrompt) =>
                onMemberChange?.({ systemPrompt }, { autoSave: true })
              }
            />
          </MemberInfoSection>

          <MemberInfoSection meta="SKILLS" title="技能配置">
            <DropdownSelect
              selectionMode="multiple"
              values={selectedSkillIds}
              options={skillOptions}
              placeholder={skillPlaceholder}
              searchPlaceholder="搜索技能..."
              emptyLabel={
                runtimeSkillsLoading
                  ? "正在加载技能..."
                  : runtimeSkillsError || "当前执行器暂无可用技能"
              }
              disabled={disabled || runtimeSkillsLoading || skillOptions.length === 0}
              className="w-full [&>button]:min-h-7 [&>button]:rounded-[3px] [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-1 [&>button]:py-1 [&>button]:text-[13px] [&>button]:shadow-none [&>button:hover]:bg-white/[0.035]"
              maxPanelHeightClassName="max-h-[220px]"
              formatValueLabel={(selectedOptions) => {
                if (selectedOptions.length === 0) return skillPlaceholder;
                if (selectedOptions.length === 1) return selectedOptions[0].label;
                return `${selectedOptions.length} 个技能`;
              }}
              onChange={(values) =>
                onMemberChange?.({ selectedSkillIdsText: values.join(", ") })
              }
            />
          </MemberInfoSection>

          <MemberInfoSection meta="MCP" title="MCP 配置">
            <label className="relative block">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-2.5 select-none font-mono text-[10px] leading-relaxed text-[var(--team-template-index)]"
              >
                1<br />
                2<br />
                3<br />
                4<br />
                5<br />
                6
              </span>
              <textarea
                disabled={disabled}
                value={formMember.toolsEnabledText}
                rows={6}
                onBlur={() =>
                  onMemberChange?.(
                    { toolsEnabledText: formMember.toolsEnabledText },
                    { validateTools: true },
                  )
                }
                onChange={(event) =>
                  onMemberChange?.({ toolsEnabledText: event.target.value })
                }
                className={[
                  "team-template-field w-full resize-y rounded-[3px] border-x-0 border-t-0 bg-[var(--team-template-code-surface)] py-1.5 pl-10 pr-3 font-mono text-[12px] leading-relaxed text-[var(--team-template-code-text)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] focus:border-[var(--team-template-field-focus)] disabled:cursor-not-allowed disabled:opacity-60",
                  fieldErrors[`member:${memberKey}:tools_enabled`]
                    ? "border-red-400/70"
                    : "border-[var(--team-template-code-border)]",
                ].join(" ")}
              />
              {fieldErrors[`member:${memberKey}:tools_enabled`] && (
                <p className="mt-1 text-[11px] text-red-400">
                  {fieldErrors[`member:${memberKey}:tools_enabled`]}
                </p>
              )}
            </label>
          </MemberInfoSection>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="team-template-member-detail flex min-h-0 flex-col p-1 lg:h-full lg:p-0"
    >
      <header className="flex min-w-0 items-start justify-between gap-4 border-b border-[var(--team-template-border)] pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-1 h-2 w-2 shrink-0 rounded-full shadow-[0_0_10px_currentColor] ${getMemberDotClassName(member, index)}`}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[16px] font-semibold leading-tight text-[var(--team-template-title)]">
                {member.name || roleKey}
              </h2>
              {isLead && (
                <span className="rounded-[4px] border border-[var(--team-template-ghost-badge-border)] px-1.5 py-0.5 font-mono text-[9px] font-medium text-[var(--team-template-muted)]">
                  LEAD
                </span>
              )}
            </div>
            <p className="mt-1 font-mono text-[11px] text-[var(--team-template-aux)]">
              {roleKey}
            </p>
          </div>
        </div>
      </header>

      <div className="team-template-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto pt-4">
        <MemberInfoSection meta="MODEL" title="模型配置">
          <div>
            <MemberInfoField
              label="Runtime"
              value={formatMemberValue(member.runner_type, "默认运行时")}
            />
            <MemberInfoField
              label="Model"
              value={formatMemberValue(member.recommended_model, "默认模型")}
            />
          </div>
        </MemberInfoSection>

        <MemberInfoSection meta="ROLE" title="职责设定">
          <div className="team-template-role-markdown mt-3 max-h-[220px] overflow-auto text-[12px] leading-[1.55] text-[var(--team-template-member-description)] ot-scroll-area-styled">
            <AgentMarkdown content={systemPrompt} fontSize={12} />
          </div>
        </MemberInfoSection>

        <MemberInfoSection meta="SKILLS" title="技能配置">
          {member.selected_skill_ids.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {member.selected_skill_ids.map((skillId) => (
                <span
                  key={skillId}
                  className="rounded-[4px] border border-[var(--team-template-ghost-badge-border)] bg-[var(--team-template-tag-surface)] px-2 py-1 font-mono text-[10px] font-medium text-[var(--team-template-muted)]"
                >
                  {skillId}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--team-template-member-description)]">
              暂未选择技能。
            </p>
          )}
        </MemberInfoSection>

        <MemberInfoSection meta="MCP" title="MCP 配置">
          {mcpConfig ? (
            <pre className="max-h-[220px] overflow-auto font-mono text-[11px] leading-relaxed text-[var(--team-template-code-text)] ot-scroll-area-styled">
              {mcpConfig}
            </pre>
          ) : (
            <p className="text-[12px] text-[var(--team-template-member-description)]">
              暂未配置 MCP。
            </p>
          )}
        </MemberInfoSection>
      </div>
    </aside>
  );
}

function AgentAvatarGroup({ template }: { template: TeamPresetSummary }) {
  const initials = getTemplateAgentInitials(template);
  const extraCount = Math.max(template.member_count - initials.length, 0);

  return (
    <div className="flex shrink-0 items-center">
      {initials.map((label, index) => (
        <span
          key={`${label}-${index}`}
          className={`${index > 0 ? "-ml-1.5" : ""} flex h-5 w-5 items-center justify-center rounded-full bg-[var(--team-template-avatar-surface)] font-mono text-[9px] font-medium text-[var(--team-template-muted)] shadow-[inset_0_0_0_1px_var(--team-template-inner-stroke)]`}
          style={{ zIndex: initials.length - index }}
        >
          {label}
        </span>
      ))}
      {extraCount > 0 && (
        <span className="-ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--team-template-tag-surface)] px-1.5 font-mono text-[9px] font-medium text-[var(--team-template-muted)] shadow-[inset_0_0_0_1px_var(--team-template-inner-stroke)]">
          +{extraCount}
        </span>
      )}
    </div>
  );
}

function WorkflowPreview({
  disabled = false,
  editable = false,
  onStepsChange,
  steps,
}: {
  disabled?: boolean;
  editable?: boolean;
  onStepsChange?: (steps: WorkflowStepForm[]) => void;
  steps: WorkflowStepPreview[];
}) {
  const stepCountLabel = String(steps.length).padStart(2, "0");
  const [litDotCount, setLitDotCount] = useState(0);
  const [litTextCount, setLitTextCount] = useState(0);
  const editableSteps = steps as WorkflowStepForm[];

  const updateStep = (index: number, patch: Partial<WorkflowStepForm>) => {
    onStepsChange?.(
      editableSteps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  };

  useEffect(() => {
    setLitDotCount(0);
    setLitTextCount(0);
    const timers = steps.map((_, index) => {
      const stepStart = 240 + index * 850;
      return window.setTimeout(() => {
        setLitDotCount(index + 1);
        setLitTextCount(index + 1);
      }, stepStart);
    });

    return () => {
      timers.forEach(window.clearTimeout);
    };
  }, [steps]);

  return (
    <section
      className={[
        "team-template-workflow-preview text-[13px]",
        editable ? "pt-3" : "border-t border-[var(--team-template-border)] pt-4",
      ].join(" ")}
    >
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--team-template-muted)]">
          工作流程
        </h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-medium text-[var(--team-template-aux)] tabular-nums">
          <Workflow aria-hidden="true" className="h-3 w-3" strokeWidth={1.2} />
          PIPELINE / {stepCountLabel}
        </span>
      </div>

      {editable ? (
        <div className="team-template-deboxed-workflow relative space-y-1 border-l border-[var(--team-template-border)] pl-4">
          {editableSteps.length === 0 && (
            <p className="rounded-[4px] border border-dashed border-[var(--team-template-border)] px-3 py-4 text-[12px] text-[var(--team-template-muted)]">
              No workflow steps defined.
            </p>
          )}
          {editableSteps.map((step, index) => (
            <section
              key={`workflow-step-${index}`}
              className="team-template-compact-workflow-step group relative grid grid-cols-[24px_minmax(0,1fr)_24px] gap-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className="absolute -left-[19px] top-2.5 h-1.5 w-1.5 rounded-full border border-[var(--team-template-pipeline-dot-muted)] bg-[var(--team-template-canvas)]"
              />
              <span className="pt-1 font-mono text-[10px] font-semibold tabular-nums text-[var(--team-template-aux)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <input
                  disabled={disabled}
                  value={step.title}
                  placeholder="Step title"
                  onChange={(event) =>
                    updateStep(index, { title: event.target.value })
                  }
                  className="team-template-workflow-step-title -mx-1 h-6 w-full rounded-[3px] border-0 bg-transparent px-1 text-[13px] font-semibold leading-none text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] hover:bg-white/[0.035] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <WorkflowStepDescriptionTextarea
                  disabled={disabled}
                  value={step.description}
                  onChange={(description) => updateStep(index, { description })}
                />
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onStepsChange?.(
                    editableSteps.filter((_, stepIndex) => stepIndex !== index),
                  )
                }
                className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--team-template-muted)] opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-300 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 disabled:opacity-40"
                aria-label="Remove workflow step"
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
              </button>
            </section>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onStepsChange?.([...editableSteps, { title: "", description: "" }])
            }
            className={`${quietButtonClassName} mt-2 h-7 gap-1.5 px-2.5 text-[11px] font-medium disabled:opacity-50`}
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
            Add Step
          </button>
        </div>
      ) : (
      <div>
        {steps.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--team-template-border)] px-3 py-4 text-[12px] text-[var(--team-template-muted)]">
            No workflow steps defined.
          </p>
        ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => {
            const isProgressStep = index === steps.length - 1;
            const dotLit = index < litDotCount;
            const textLit = index < litTextCount;
            const trackLit = index < litTextCount;

            return (
              <li
                key={`${step.title}-${index}`}
                className="team-template-workflow-step group relative flex min-w-0 gap-2.5"
              >
                <div className="relative flex w-2.5 shrink-0 justify-center pt-[5px]">
                  <span
                    aria-label={isProgressStep ? "进行中" : "已完成"}
                    className={[
                      "team-template-workflow-dot relative z-10 shrink-0 rounded-full transition-colors duration-150",
                      dotLit ? "team-template-workflow-dot-lit" : "",
                      "h-1.5 w-1.5 border border-[var(--team-template-pipeline-dot-muted)] bg-transparent",
                    ].join(" ")}
                  />
                  {index < steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={[
                        "team-template-workflow-track absolute bottom-[-12px] top-[15px] w-px bg-[var(--team-template-pipeline-track)]",
                        trackLit ? "team-template-workflow-track-lit" : "",
                      ].join(" ")}
                    />
                  )}
                </div>
                <div
                  className={[
                    "team-template-workflow-copy min-w-0 pb-1",
                    textLit ? "team-template-workflow-copy-lit" : "",
                  ].join(" ")}
                >
                  <h3 className="truncate text-[12px] font-semibold leading-[1.2] text-[var(--team-template-title)]">
                    {step.title}
                  </h3>
                  <p className="mt-0.5 text-[12px] leading-[1.35] text-[#808080]">
                    {step.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        )}
      </div>
      )}
    </section>
  );
}

function TemplateDetailView({
  canEdit,
  canUseTemplate,
  detail,
  detailError,
  detailLoading,
  deleting = false,
  editorMode,
  fieldErrors = {},
  form,
  formError,
  installedSkills = [],
  runtimes = [],
  saving = false,
  saveStatus = null,
  selectedEditableMemberId,
  usingTemplate,
  onBack,
  onCancel,
  onDelete,
  onEdit,
  onFormChange,
  onAutoSave,
  onEditableMemberSelect,
  onValidateMemberTools,
  onRetryDetail,
  onSave,
  onUseTemplate,
}: {
  canEdit: boolean;
  canUseTemplate: boolean;
  detail: ChatTeamPreset | null;
  detailError: string | null;
  detailLoading: boolean;
  deleting?: boolean;
  editorMode?: Exclude<EditorMode, null> | null;
  fieldErrors?: Record<string, string>;
  form?: TeamPresetForm;
  formError?: string | null;
  installedSkills?: BackendChatSkill[];
  runtimes?: AgentRuntimeStatus[];
  saving?: boolean;
  saveStatus?: string | null;
  selectedEditableMemberId?: string | null;
  usingTemplate: boolean;
  onBack: () => void;
  onCancel?: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onFormChange?: (form: TeamPresetForm, options?: DraftCommitOptions) => void;
  onAutoSave?: (form: TeamPresetForm) => void;
  onEditableMemberSelect?: (memberId: string | null) => void;
  onValidateMemberTools?: (form: TeamPresetForm, memberId: string) => void;
  onRetryDetail: () => void;
  onSave?: () => void;
  onUseTemplate: () => void;
}) {
  const [readonlySelectedMemberId, setReadonlySelectedMemberId] = useState<
    string | null
  >(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const isEditing = Boolean(editorMode && form);
  const viewDetail = isEditing && form ? formToPreviewDetail(form) : detail;
  const controlsDisabled = saving || deleting;

  useEffect(() => {
    if (!isEditing) setMoreMenuOpen(false);
  }, [isEditing]);
  const selectedMemberId = isEditing
    ? (selectedEditableMemberId ?? viewDetail?.members[0]?.id ?? null)
    : readonlySelectedMemberId;
  const setSelectedMemberId = isEditing
    ? (memberId: string | null) => onEditableMemberSelect?.(memberId)
    : setReadonlySelectedMemberId;

  useEffect(() => {
    if (!viewDetail) {
      setSelectedMemberId(null);
      return;
    }

    const nextSelectedMemberId =
      selectedMemberId &&
      viewDetail.members.some((member) => member.id === selectedMemberId)
        ? selectedMemberId
        : (viewDetail.members[0]?.id ?? null);
    if (nextSelectedMemberId !== selectedMemberId) {
      setSelectedMemberId(nextSelectedMemberId);
    }
  }, [isEditing, selectedMemberId, setSelectedMemberId, viewDetail]);

  const selectedMember = useMemo(
    () =>
      viewDetail?.members.find((member) => member.id === selectedMemberId) ??
      viewDetail?.members[0] ??
      null,
    [viewDetail, selectedMemberId],
  );
  const selectedMemberIndex = useMemo(
    () =>
      selectedMember && viewDetail
        ? Math.max(
            viewDetail.members.findIndex(
              (member) => member.id === selectedMember.id,
            ),
            0,
          )
        : 0,
    [viewDetail, selectedMember],
  );

  if (!isEditing && detailLoading) {
    return (
      <div className="mx-auto w-full max-w-[1280px] p-6 md:p-8 lg:p-10 animate-pulse">
        <div className="mb-8 h-6 w-32 rounded bg-[var(--team-template-surface-hover)]"></div>
        <div className="flex gap-6">
           <div className="h-16 w-16 rounded-lg bg-[var(--team-template-surface-hover)]"></div>
           <div className="flex-1 space-y-3 pt-2">
             <div className="h-8 w-64 rounded bg-[var(--team-template-surface-hover)]"></div>
             <div className="h-4 w-full max-w-2xl rounded bg-[var(--team-template-surface)]"></div>
             <div className="h-4 w-96 rounded bg-[var(--team-template-surface)]"></div>
           </div>
        </div>
      </div>
    );
  }

  if (!isEditing && (detailError || !viewDetail)) {
    return (
      <div className="mx-auto w-full max-w-[1280px] p-6 pt-24 text-center md:p-8 lg:p-10">
        <h2 className="text-[16px] font-medium text-[var(--team-template-title)]">
          Could not load template details
        </h2>
        <p className="mt-2 text-[14px] text-[var(--team-template-muted)]">
          {detailError || "Unknown error occurred."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={onBack}
            className={`${quietButtonClassName} px-4 py-2 text-[13px] font-medium`}
          >
            Back to list
          </button>
          <button
            onClick={onRetryDetail}
            className="rounded-md border border-white/10 bg-[#ededed] px-4 py-2 text-[13px] font-medium text-[#08090a] transition-all duration-150 hover:-translate-y-px hover:bg-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!viewDetail) return null;

  const presentation = getTemplatePresentation(viewDetail.id);
  const DetailCategoryIcon = getTemplateIcon(
    viewDetail.id,
    viewDetail.name,
    presentation.categories[0],
  );
  const workflowSteps =
    isEditing && form
      ? form.workflowSteps
      : viewDetail.workflow_steps.length > 0
        ? viewDetail.workflow_steps
        : viewDetail.is_builtin
          ? presentation.workflow
          : [];
  const selectedFormMemberIndex =
    form?.members.findIndex((member) => member.id === selectedMemberId) ?? -1;
  const selectedFormMember =
    form && selectedFormMemberIndex >= 0
      ? form.members[selectedFormMemberIndex]
      : (form?.members[0] ?? null);

  const commitFormChange = (
    nextForm: TeamPresetForm,
    options?: DraftCommitOptions,
  ) => {
    onFormChange?.(nextForm, options);
    if (options?.validateTools && selectedFormMember?.id) {
      onValidateMemberTools?.(nextForm, selectedFormMember.id);
    } else if (options?.autoSave) {
      onAutoSave?.(nextForm);
    }
  };

  const updateSelectedFormMember = (
    patch: Partial<MemberForm>,
    options?: DraftCommitOptions,
  ) => {
    if (!form || !selectedFormMember) return;
    const targetIndex =
      selectedFormMemberIndex >= 0 ? selectedFormMemberIndex : 0;
    const previousId = form.members[targetIndex]?.id;
    const members = form.members.map((member, index) =>
      index === targetIndex ? { ...member, ...patch } : member,
    );
    const nextId = members[targetIndex]?.id ?? previousId;
    const nextForm = {
      ...form,
      leadMemberId:
        previousId && form.leadMemberId === previousId && nextId
          ? nextId
          : form.leadMemberId,
      members,
    };
    commitFormChange(nextForm, options);
    if (patch.id && patch.id !== selectedMemberId) {
      setSelectedMemberId(patch.id);
    }
  };

  const addCustomMember = () => {
    if (!form) return;
    const nextMember = nextMemberDraft(form.members);
    const nextForm = {
      ...form,
      leadMemberId: form.leadMemberId || nextMember.id,
      members: [...form.members, nextMember],
    };
    commitFormChange(nextForm);
    setSelectedMemberId(nextMember.id);
  };

  const removeFormMember = (memberId: string) => {
    if (!form) return;
    const members = form.members.filter((member) => member.id !== memberId);
    const nextForm = {
      ...form,
      leadMemberId: members.some((member) => member.id === form.leadMemberId)
        ? form.leadMemberId
        : (members[0]?.id ?? ""),
      members,
    };
    commitFormChange(nextForm);
    if (selectedMemberId === memberId) {
      setSelectedMemberId(members[0]?.id ?? null);
    }
  };

  return (
    <div
      className={[
        "mx-auto grid h-auto min-h-full w-full max-w-[1280px] grid-cols-1 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(420px,40vw)] 2xl:grid-cols-[minmax(0,1fr)_540px]",
        isEditing ? "team-template-compact-editor text-[13px]" : "",
      ].join(" ")}
    >
      <div className="team-template-scrollbar min-w-0 p-5 md:p-7 lg:min-h-0 lg:overflow-y-auto lg:p-8">
      <button
        type="button"
        onClick={isEditing ? (onCancel ?? onBack) : onBack}
        className="mb-5 flex items-center gap-2 text-[12px] font-medium text-[var(--team-template-muted)] transition-colors duration-150 hover:text-[var(--team-template-title)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.2} />{" "}
        {isEditing ? "退出" : "返回模板"}
      </button>

      <header
        className={[
          "relative border-b border-[var(--team-template-border)]",
          isEditing ? "pb-4" : "pb-6",
        ].join(" ")}
      >
        <div className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={[
                "flex shrink-0 items-center justify-center text-[var(--team-template-icon)]",
                isEditing ? "mt-0.5 h-8 w-8" : "h-6 w-6",
              ].join(" ")}
            >
              <DetailCategoryIcon
                className={isEditing ? "h-5 w-5" : "h-4 w-4"}
                strokeWidth={1.2}
              />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing && form ? (
                <div className="team-template-document-head min-w-0 max-w-3xl pr-28 md:pr-40">
                  <input
                    disabled={controlsDisabled}
                    value={form.name}
                    placeholder="Untitled template"
                    onChange={(event) =>
                      onFormChange?.({ ...form, name: event.target.value })
                    }
                    className={[
                      "team-template-document-title -mx-1 w-full rounded-[4px] border-0 bg-transparent px-1 py-0.5 text-[26px] font-semibold leading-tight text-[var(--team-template-title)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] hover:bg-white/[0.04] focus:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60",
                      fieldErrors["team:name"]
                        ? "bg-red-500/10 text-red-200"
                        : "",
                    ].join(" ")}
                  />
                  {fieldErrors["team:name"] && (
                    <p className="mt-1 text-[11px] text-red-400">
                      {fieldErrors["team:name"]}
                    </p>
                  )}
                  <AutoGrowingTextarea
                    disabled={controlsDisabled}
                    placeholder="Add a description..."
                    value={form.description}
                    onChange={(description) =>
                      onFormChange?.({ ...form, description })
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="truncate text-[20px] font-semibold leading-tight text-[var(--team-template-title)]">
                      {viewDetail.name}
                    </h1>
                    {viewDetail.is_builtin && <RecommendedBadge />}
                  </div>
                  <div className="mt-2">
                    <ScenarioBadges categories={presentation.categories} />
                  </div>
                  <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--team-template-muted)]">
                    {viewDetail.description || "No description provided for this template."}
                  </p>
                </>
              )}
            </div>
          </div>

          <div
            className={[
              isEditing
                ? "absolute right-0 top-0 z-20 flex shrink-0 items-start justify-end"
                : "flex shrink-0 flex-wrap items-center gap-2",
            ].join(" ")}
          >
            {isEditing && (
              <div className="flex flex-col items-end gap-2">
                {formError && (
                  <p className="max-w-[360px] text-right text-[12px] leading-snug text-red-400">
                    {formError}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {saveStatus && (
                    <span className="font-mono text-[10px] font-medium text-[var(--team-template-aux)] opacity-80">
                      {saveStatus}
                    </span>
                  )}
                  {editorMode === "create" && (
                    <button
                      type="button"
                      disabled={controlsDisabled}
                      onClick={onSave ?? (() => undefined)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-white/10 bg-[#ededed] px-3.5 text-[12px] font-medium text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 ease-out hover:bg-white disabled:opacity-60"
                    >
                      <Save aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                      {saving ? "Saving..." : "Create"}
                    </button>
                  )}
                  {editorMode === "edit" && (
                    <div className="relative">
                      <button
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => setMoreMenuOpen((open) => !open)}
                        className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--team-template-aux)] transition-colors duration-150 hover:bg-[var(--team-template-row-hover)] hover:text-[var(--team-template-title)] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="More actions"
                        aria-expanded={moreMenuOpen}
                      >
                        <MoreHorizontal aria-hidden="true" className="h-4 w-4" strokeWidth={1.6} />
                      </button>
                      {moreMenuOpen && (
                        <div className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-[8px] border border-[var(--team-template-border-strong)] bg-[var(--team-template-surface)] p-1 shadow-2xl">
                          <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={() => {
                              setMoreMenuOpen(false);
                              onDelete();
                            }}
                            className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-red-300/90 transition-colors duration-150 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
                            {deleting ? "Deleting..." : "Delete template"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {canEdit && !isEditing && (
              <>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onEdit}
                  className="inline-flex h-8 items-center justify-center gap-1.5 bg-transparent px-2 text-[12px] font-medium text-[var(--team-template-muted)] transition-colors duration-150 hover:text-[var(--team-template-title)] disabled:opacity-50"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5 text-[var(--team-template-muted)]" strokeWidth={1.2} />
                  编辑
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={onDelete}
                  className={`${dangerGhostButtonClassName} h-8 gap-1.5 px-3 text-[12px] font-medium`}
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.2} />
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </>
            )}
            {canUseTemplate && !isEditing && (
              <button
                type="button"
                onClick={onUseTemplate}
                disabled={usingTemplate || deleting}
                className="inline-flex h-8 items-center gap-2 rounded-[6px] border border-white/20 bg-[#f4f4f5] px-3 text-[12px] font-semibold text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.35),0_2px_0_rgba(0,0,0,0.16)] transition-all duration-150 ease-out hover:-translate-y-px hover:bg-white"
              >
                {usingTemplate ? "应用中..." : "使用模板"}
                <kbd className="rounded-[3px] border border-black/10 bg-black/[0.035] px-1.5 py-px font-mono text-[9px] font-semibold leading-none text-black/55">
                  ⌘ Enter
                </kbd>
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        className={[
          "grid lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,2fr)]",
          isEditing ? "gap-8" : "gap-12",
        ].join(" ")}
      >
        <WorkflowPreview
          disabled={controlsDisabled}
          editable={isEditing}
          steps={workflowSteps}
          onStepsChange={(workflowSteps) => {
            if (form) commitFormChange({ ...form, workflowSteps });
          }}
        />

        <section
          className={
            isEditing ? "pt-3" : "border-t border-[var(--team-template-border)] pt-4"
          }
        >
          <header className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--team-template-muted)]">
              成员信息
            </h2>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] font-medium text-[var(--team-template-aux)] tabular-nums">
                MEMBERS / {String(viewDetail.members.length).padStart(2, "0")}
              </span>
              {isEditing && (
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={addCustomMember}
                  className={`${quietButtonClassName} h-7 gap-1.5 px-2.5 text-[11px] font-medium disabled:opacity-50`}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
                  Add Member
                </button>
              )}
            </div>
          </header>

          <div>
              {viewDetail.members.length === 0 && (
                <p className="rounded-[4px] border border-dashed border-[var(--team-template-border)] px-3 py-4 text-[12px] text-[var(--team-template-muted)]">
                  No members added yet.
                </p>
              )}
              {viewDetail.members.map((member, index) => {
                const isLead = member.id === viewDetail.lead_member_id;
                const active = selectedMember?.id === member.id;
                const roleKey = getMemberRoleKey(member);
                const description =
                  member.description ||
                  member.system_prompt ||
                  "No role description.";

                const rowClassName = [
                  "team-template-member-row group grid min-h-[38px] w-full grid-cols-1 gap-1 border-b border-[var(--team-template-border)] px-1.5 py-1.5 text-left text-[13px] transition-colors duration-150 last:border-b-0 md:grid-cols-[minmax(140px,0.72fr)_minmax(0,1fr)_auto] md:items-center md:gap-2",
                  active
                    ? "bg-[var(--team-template-row-active)] shadow-[inset_2px_0_0_var(--team-template-border-strong)]"
                    : "hover:bg-[var(--team-template-row-hover)]",
                ].join(" ");
                const rowContent = (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${getMemberDotClassName(member, index)}`}
                      />
                      {isEditing && form ? (
                        <input
                          type="radio"
                          disabled={controlsDisabled}
                          checked={isLead}
                          onChange={(event) => {
                            event.stopPropagation();
                            commitFormChange({ ...form, leadMemberId: member.id });
                          }}
                          onClick={(event) => event.stopPropagation()}
                          className="h-3.5 w-3.5 shrink-0 border-[var(--team-template-border-strong)] bg-[var(--team-template-field-surface)] text-[var(--primary)] focus:ring-[var(--primary)] disabled:opacity-60"
                          aria-label="Set lead member"
                        />
                      ) : null}
                      <span
                        className={`min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--team-template-code-text)] transition-colors duration-150 group-hover:text-[var(--team-template-title)] ${getMemberRoleToneClassName(member, index)}`}
                        title={roleKey}
                      >
                        {roleKey}
                      </span>
                      {isLead && (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--team-template-muted)]">
                          <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                          Lead
                        </span>
                      )}
                    </span>

                    <span
                      className="min-w-0 text-[12px] leading-[1.4] text-[var(--team-template-member-description)] md:truncate"
                      title={description}
                    >
                      {description}
                    </span>

                    <span className="inline-flex items-center gap-2 md:justify-self-end">
                      {member.selected_skill_ids.length > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--team-template-ghost-badge-border)] px-1.5 py-0.5 font-mono text-[9px] font-medium text-[var(--team-template-aux)] tabular-nums"
                          title={member.selected_skill_ids.join(", ")}
                        >
                          <span className="h-1 w-1 rounded-full bg-current opacity-60" />
                          {member.selected_skill_ids.length} skills
                        </span>
                      )}
                      {isEditing ? (
                        <button
                          type="button"
                          disabled={controlsDisabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeFormMember(member.id);
                          }}
                          className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--team-template-muted)] opacity-0 transition-all duration-150 hover:bg-red-500/10 hover:text-red-300 group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100 disabled:opacity-40"
                          aria-label="Remove member"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.4} />
                        </button>
                      ) : (
                        <ChevronRight
                          aria-hidden="true"
                          className={[
                            "h-2.5 w-2.5 shrink-0 text-[var(--team-template-aux)] opacity-35 transition-all duration-150 group-hover:opacity-100 group-hover:text-[var(--team-template-muted)]",
                            active ? "translate-x-0.5 opacity-70" : "",
                          ].join(" ")}
                          strokeWidth={1.4}
                        />
                      )}
                    </span>
                  </>
                );

                return isEditing ? (
                  <div
                    key={`${member.id}-${index}`}
                    className={rowClassName}
                    onClick={() => setSelectedMemberId(member.id)}
                  >
                    {rowContent}
                  </div>
                ) : (
                  <button
                    key={`${member.id}-${index}`}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedMemberId(member.id)}
                    className={rowClassName}
                  >
                    {rowContent}
                  </button>
                );
              })}
          </div>
        </section>
      </div>

      {(isEditing || viewDetail.team_protocol) && (
        <section className="mt-12 border-t border-[var(--team-template-border)] pt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--team-template-muted)]">
              协作协议
            </h2>
            <span className="font-mono text-[9px] font-medium text-[var(--team-template-aux)]">
              TEAM PROTOCOL
            </span>
          </div>
          <div className="border-l border-[var(--team-template-border)] pl-3">
            {isEditing && form ? (
              <MarkdownEditableField
                disabled={controlsDisabled}
                editable
                placeholder="填写团队协作协议..."
                rows={7}
                value={form.teamProtocol}
                onCommit={(teamProtocol) => {
                  const nextForm = { ...form, teamProtocol };
                  commitFormChange(nextForm, { autoSave: true });
                }}
              />
            ) : (
              <AgentMarkdown content={viewDetail.team_protocol} fontSize={13} />
            )}
          </div>
        </section>
      )}
      </div>

      <aside className="min-h-0 border-t border-[var(--team-template-grid-line-strong)] p-4 lg:h-full lg:border-l lg:border-t-0 lg:p-5">
        {selectedMember && (
          <TemplateMemberInfoPage
            disabled={controlsDisabled}
            editable={isEditing}
            fieldErrors={fieldErrors}
            formMember={selectedFormMember ?? undefined}
            index={selectedMemberIndex}
            installedSkills={installedSkills}
            isLead={selectedMember.id === viewDetail.lead_member_id}
            member={selectedMember}
            onMemberChange={updateSelectedFormMember}
            runtimes={runtimes}
          />
        )}
      </aside>
    </div>
  );
}

function UnsavedEditorExitDialog({
  saving,
  onCancel,
  onDiscard,
  onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-template-title"
    >
      <div className="w-full max-w-[420px] rounded-[12px] border border-[var(--team-template-border-strong)] bg-[var(--team-template-surface)] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--team-template-border)] text-[var(--team-template-icon)]">
            <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.4} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="unsaved-template-title"
              className="text-[15px] font-semibold text-[var(--team-template-title)]"
            >
              保存修改后退出？
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--team-template-muted)]">
              当前模板有未保存的修改。可以先保存，或丢弃修改直接退出编辑状态。
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--team-template-muted)] transition hover:bg-[var(--team-template-row-hover)] hover:text-[var(--team-template-title)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="继续编辑"
            title="继续编辑"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className={`${dangerGhostButtonClassName} h-8 px-3 text-[12px] font-medium disabled:cursor-not-allowed`}
          >
            丢弃修改
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={`${quietButtonClassName} h-8 px-3 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60`}
          >
            继续编辑
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-white/20 bg-[#f4f4f5] px-3 text-[12px] font-semibold text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.35),0_2px_0_rgba(0,0,0,0.16)] transition-all duration-150 ease-out hover:-translate-y-px hover:bg-white disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70"
          >
            {saving ? "保存中..." : "保存并退出"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UseTeamTemplateDialog({
  applying,
  detail,
  onCancel,
  onConfirm,
}: {
  applying: boolean;
  detail: ChatTeamPreset;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="use-team-template-title"
    >
      <div className="w-full max-w-[400px] rounded-[12px] border border-[var(--team-template-border-strong)] bg-[var(--team-template-surface)] p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[var(--team-template-border)] text-[var(--team-template-icon)]">
            <Workflow aria-hidden="true" className="h-4 w-4" strokeWidth={1.4} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="use-team-template-title"
              className="text-[15px] font-semibold text-[var(--team-template-title)]"
            >
              确认使用模板
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--team-template-muted)]">
              使用此模板替换掉当前团队成员，并同步团队协议。
            </p>
            <p className="mt-3 truncate rounded-[7px] border border-[var(--team-template-border)] px-3 py-2 text-[12px] font-medium text-[var(--team-template-title)]">
              {detail.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--team-template-muted)] transition hover:bg-[var(--team-template-row-hover)] hover:text-[var(--team-template-title)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="取消"
            title="取消"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className={`${quietButtonClassName} h-8 px-3 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60`}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={applying}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-white/20 bg-[#f4f4f5] px-3 text-[12px] font-semibold text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(0,0,0,0.08),0_1px_0_rgba(0,0,0,0.35),0_2px_0_rgba(0,0,0,0.16)] transition-all duration-150 ease-out hover:-translate-y-px hover:bg-white disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70"
          >
            {applying ? "替换中..." : "确认替换"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onClick,
}: {
  template: TeamPresetSummary;
  onClick: () => void;
}) {
  const presentation = getTemplatePresentation(template.id);
  const CategoryIcon = getTemplateIcon(
    template.id,
    template.name,
    presentation.categories[0],
  );
  
  return (
    <div
      onClick={onClick}
      className={`team-template-card group relative flex min-h-[124px] cursor-pointer flex-col rounded-lg p-3 ${hairlineSurfaceClassName} ${interactiveSurfaceClassName}`}
    >
      {template.is_builtin && (
        <div className="absolute right-3 top-3">
          <RecommendedBadge />
        </div>
      )}

      <div className="flex min-w-0 items-start gap-2 pr-9">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--team-template-icon)] transition-colors duration-150 ease-out">
          <CategoryIcon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 whitespace-normal break-words text-[13px] font-semibold leading-snug text-[var(--team-template-title)]">
            {template.name}
          </h3>
          {template.description && (
            <p
              className="mt-1 line-clamp-2 text-[11px] leading-snug text-[#888888]"
              title={template.description}
            >
              {template.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <ScenarioBadges categories={presentation.categories} />
          <AgentAvatarGroup template={template} />
          <span className="min-w-0 font-mono text-[11px] font-medium text-[var(--team-template-aux)] tabular-nums">
            {template.member_count} 成员
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] font-medium text-[var(--team-template-aux)] tabular-nums">
          {getTemplateVersionLabel(template)}
        </span>
      </div>
    </div>
  );
}

export function TeamTemplatesPage() {
  const {
    t,
    projects,
    selectedProjectId,
    refreshMembers,
    refreshSessions,
    showToast,
    skills,
  } = useWorkspace();
  const [templates, setTemplates] = useState<TeamPresetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ChatTeamPreset | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [form, setForm] = useState<TeamPresetForm>(blankForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const [editorSelectedMemberId, setEditorSelectedMemberId] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [applyTargetDetail, setApplyTargetDetail] =
    useState<ChatTeamPreset | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [projectTemplateMembers, setProjectTemplateMembers] = useState<
    ProjectMemberWithRuntime[]
  >([]);
  const [projectTemplateMembersLoaded, setProjectTemplateMembersLoaded] =
    useState(false);
  const [runtimes, setRuntimes] = useState<AgentRuntimeStatus[]>([]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await teamPresetsApi.list();
      setTemplates(response.teams);
    } catch (error) {
      setLoadError(errorText(error, "Failed to load templates."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (teamId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const mockDetail = mockTeamTemplateDetails[teamId];
      if (mockDetail) {
        setSelectedDetail(mockDetail);
        return;
      }
      const detail = await teamPresetsApi.get(teamId);
      setSelectedDetail(detail);
    } catch (error) {
      setDetailError(errorText(error, "Failed to load template details."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    let cancelled = false;
    void agentRuntimeApi
      .list()
      .then((response) => {
        if (!cancelled) setRuntimes(response.runners);
      })
      .catch(() => {
        if (!cancelled) setRuntimes([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTemplateMembers([]);
      setProjectTemplateMembersLoaded(true);
      return;
    }

    let cancelled = false;
    setProjectTemplateMembersLoaded(false);
    void projectApi
      .listMembers(selectedProjectId)
      .then((members) => {
        if (!cancelled) {
          setProjectTemplateMembers(members);
          setProjectTemplateMembersLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectTemplateMembers([]);
          setProjectTemplateMembersLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const myTeamTemplates = useMemo(() => templates, [templates]);
  const selectedDetailForView =
    selectedDetail?.id === selectedId ? selectedDetail : null;
  const detailViewLoading = Boolean(
    selectedId &&
      !detailError &&
      (detailLoading || selectedDetailForView === null),
  );
  const canEditSelected = Boolean(
    selectedDetail &&
      selectedDetail.id === selectedId &&
      !selectedDetail.is_builtin,
  );
  const editorBaselineForm = useMemo(() => {
    if (!editorMode) return null;
    if (editorMode === "edit") {
      return selectedDetailForView ? detailToForm(selectedDetailForView) : null;
    }
    return blankForm();
  }, [editorMode, selectedDetailForView]);
  const hasUnsavedEditorChanges = Boolean(
    editorMode &&
      editorBaselineForm &&
      formDirtySnapshot(form) !== formDirtySnapshot(editorBaselineForm),
  );
  const editorSaveStatus =
    editorMode === "edit"
      ? saving || hasUnsavedEditorChanges
        ? "Saving..."
        : "Saved"
      : null;

  const openTemplateDetail = (teamId: string) => {
    setDetailError(null);
    setDetailLoading(true);
    setSelectedId(teamId);
  };

  const startCreate = () => {
    const draft = blankForm();
    setForm(draft);
    setFormError(null);
    setFieldErrors({});
    setShowExitPrompt(false);
    setEditorSelectedMemberId(draft.members[0]?.id ?? null);
    setEditorMode("create");
    setSelectedId(null);
  };

  const startEdit = () => {
    if (!selectedDetailForView || selectedDetailForView.is_builtin) return;
    const draft = detailToForm(selectedDetailForView);
    setForm(draft);
    setFormError(null);
    setFieldErrors({});
    setShowExitPrompt(false);
    setEditorSelectedMemberId(
      draft.leadMemberId || draft.members[0]?.id || null,
    );
    setEditorMode("edit");
  };

  const saveTemplate = async (): Promise<boolean> => {
    setFormError(null);
    setFieldErrors({});
    const validation = validateTeamPresetForm(form);
    if (validation.issue) {
      setFormError(validation.issue.message);
      if (validation.issue.fieldKey) {
        setFieldErrors({ [validation.issue.fieldKey]: validation.issue.message });
      }
      if (validation.issue.memberId) {
        setEditorSelectedMemberId(validation.issue.memberId);
      }
      return false;
    }

    setSaving(true);
    try {
      const saved =
        editorMode === "create"
          ? await teamPresetsApi.create(validation.payload)
          : await teamPresetsApi.update(form.id, validation.payload);
      setEditorMode(null);
      await loadTemplates();
      setSelectedDetail(saved);
      setSelectedId(saved.id);
      setShowExitPrompt(false);
      return true;
    } catch (error) {
      const errorMessage = errorText(error, "Failed to save template.");
      setFormError(errorMessage);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const closeEditor = () => {
    setShowExitPrompt(false);
    setEditorMode(null);
    setFieldErrors({});
    setFormError(null);
  };

  const requestExitEditor = () => {
    if (hasUnsavedEditorChanges) {
      setShowExitPrompt(true);
      return;
    }
    closeEditor();
  };

  const saveAndExitEditor = async () => {
    const saved = await saveTemplate();
    if (!saved) {
      setShowExitPrompt(false);
    }
  };

  const autoSaveTemplate = useCallback(
    async (draft: TeamPresetForm) => {
      if (editorMode !== "edit" || saving) return;
      const validation = validateTeamPresetForm(draft);
      if (validation.issue) {
        setFormError(validation.issue.message);
        if (validation.issue.fieldKey) {
          setFieldErrors({ [validation.issue.fieldKey]: validation.issue.message });
        }
        if (validation.issue.memberId) {
          setEditorSelectedMemberId(validation.issue.memberId);
        }
        return;
      }

      setFormError(null);
      setFieldErrors({});
      setSaving(true);
      try {
        const saved = await teamPresetsApi.update(draft.id, validation.payload);
        setSelectedDetail(saved);
        await loadTemplates();
      } catch (error) {
        setFormError(errorText(error, "Failed to save template."));
      } finally {
        setSaving(false);
      }
    },
    [editorMode, loadTemplates, saving],
  );

  useEffect(() => {
    if (
      editorMode !== "edit" ||
      !hasUnsavedEditorChanges ||
      saving ||
      deleting
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void autoSaveTemplate(form);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    autoSaveTemplate,
    deleting,
    editorMode,
    form,
    hasUnsavedEditorChanges,
    saving,
  ]);

  const validateMemberToolsOnBlur = useCallback(
    (draft: TeamPresetForm, memberId: string) => {
      const issue = validateMemberToolsEnabled(draft, memberId);
      if (issue) {
        setFormError(issue.message);
        if (issue.fieldKey) {
          setFieldErrors({ [issue.fieldKey]: issue.message });
        }
        if (issue.memberId) {
          setEditorSelectedMemberId(issue.memberId);
        }
        return;
      }

      setFieldErrors((current) => {
        const next = { ...current };
        delete next[`member:${memberId}:tools_enabled`];
        return next;
      });
      setFormError((current) =>
        current === "Invalid JSON format. Please check your syntax."
          ? null
          : current,
      );

      if (editorMode === "edit") {
        void autoSaveTemplate(draft);
      }
    },
    [autoSaveTemplate, editorMode],
  );

  const deleteSelected = async () => {
    if (!selectedDetailForView || selectedDetailForView.is_builtin || deleting) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedDetailForView.name}"? This removes the custom template and any private members only used by it.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await teamPresetsApi.delete(selectedDetailForView.id);
      setShowExitPrompt(false);
      setEditorMode(null);
      setFieldErrors({});
      setFormError(null);
      setSelectedDetail(null);
      setSelectedId(null);
      await loadTemplates();
    } catch (error) {
      setDetailError(errorText(error, "Failed to delete template."));
    } finally {
      setDeleting(false);
    }
  };

  const createProjectAgentMember = async (
    projectId: string,
    spec: TemplateMemberBuild,
  ): Promise<ProjectMemberWithRuntime> => {
    const agent = await chatAgentsApi.create({
      name: spec.name,
      runner_type: spec.runnerType,
      system_prompt: spec.systemPrompt,
      tools_enabled: spec.toolsEnabled,
      model_name: spec.modelName,
      owner_project_id: projectId,
    });

    return projectApi.addMember(projectId, {
      member_type: ProjectMemberType.agent,
      user_id: null,
      agent_id: agent.id,
      member_name: agent.name,
      role: spec.role,
      display_order: BigInt(spec.displayOrder),
      default_workspace_path: spec.workspacePath,
      allowed_skill_ids: spec.allowedSkillIds,
      execution_config: {
        runner_type: spec.runnerType as unknown as ProjectBaseCodingAgent,
        model_name: spec.modelName,
        thinking_effort: null,
        model_variant: null,
      },
      is_default: true,
    });
  };

  const removeProjectSessionAgents = async (
    projectId: string,
    projectMemberIds: Set<string>,
    agentIds: Set<string>,
  ) => {
    const sessions = await projectApi.listSessions(projectId);

    await Promise.all(
      sessions.map(async (session) => {
        const sessionAgents = await sessionAgentsApi.list(session.id);
        const removable = sessionAgents.filter(
          (sessionAgent) =>
            (sessionAgent.project_member_id &&
              projectMemberIds.has(sessionAgent.project_member_id)) ||
            agentIds.has(sessionAgent.agent_id),
        );

        await Promise.all(
          removable.map((sessionAgent) =>
            sessionAgentsApi.remove(session.id, sessionAgent.id),
          ),
        );
      }),
    );

    return sessions;
  };

  const applyTemplateToProject = async () => {
    const detail = applyTargetDetail;
    if (!detail || applyingTemplate) return;

    if (!selectedProjectId) {
      showToast("请先选择项目后再使用模板。", "warning");
      return;
    }

    const projectId = selectedProjectId;
    const workspacePath =
      projects.find((project) => project.id === projectId)
        ?.default_workspace_path ?? null;

    setApplyingTemplate(true);
    try {
      const [runtimeResponse, existingMembers, projectAgents] =
        await Promise.all([
          agentRuntimeApi.list(),
          projectApi.listMembers(projectId),
          chatAgentsApi.list({ projectId }),
        ]);
      const memberSpecs = buildTemplateMemberSpecs(
        detail,
        workspacePath,
        runtimeResponse.runners,
      );
      if (memberSpecs.length === 0) {
        throw new Error("模板没有可用成员，未替换当前团队。");
      }

      const existingAgentMembers = existingMembers.filter(isAgentProjectMember);
      const existingProjectMemberIds = new Set(
        existingAgentMembers.map((member) => member.id),
      );
      const existingAgentIds = new Set(
        existingAgentMembers
          .map((member) => member.agent_id)
          .filter((agentId): agentId is string => !!agentId),
      );
      const removableOwnedAgentIds = new Set(
        projectAgents
          .filter(
            (agent) =>
              agent.owner_project_id === projectId &&
              existingAgentIds.has(agent.id),
          )
          .map((agent) => agent.id),
      );

      const sessions = await removeProjectSessionAgents(
        projectId,
        existingProjectMemberIds,
        existingAgentIds,
      );
      await Promise.all(
        existingAgentMembers.map((member) =>
          projectApi.removeMember(projectId, member.id),
        ),
      );
      await Promise.all(
        Array.from(removableOwnedAgentIds).map((agentId) =>
          chatAgentsApi.delete(agentId).catch(() => undefined),
        ),
      );

      const createdMembers: ProjectMemberWithRuntime[] = [];
      for (const spec of memberSpecs) {
        createdMembers.push(await createProjectAgentMember(projectId, spec));
      }

      const leadAgentId =
        createdMembers.find((member) => member.role === "lead")?.agent_id ??
        createdMembers[0]?.agent_id ??
        null;
      const teamProtocol = detail.team_protocol.trim();
      const sessionPatch: Partial<UpdateChatSession> = {
        team_protocol: teamProtocol,
        team_protocol_enabled: teamProtocol.length > 0,
      };
      if (leadAgentId) {
        sessionPatch.lead_agent_id = leadAgentId;
      }

      await Promise.all(
        sessions.map((session) =>
          chatSessionsApi.update(
            session.id,
            teamTemplateSessionUpdatePayload(sessionPatch),
          ),
        ),
      );

      setProjectTemplateMembers(await projectApi.listMembers(projectId));
      setProjectTemplateMembersLoaded(true);
      await Promise.all([refreshMembers(), refreshSessions()]);
      setApplyTargetDetail(null);
      showToast(`已使用「${detail.name}」替换当前团队成员。`, "success");
    } catch (error) {
      showToast(errorText(error, "使用模板失败。"), "error");
    } finally {
      setApplyingTemplate(false);
    }
  };

  const templateCandidates = useMemo(
    () => [...templates, ...advancedTeamTemplates],
    [templates],
  );
  const currentActiveTemplate = useMemo(
    () => resolveProjectActiveTemplate(projectTemplateMembers, templateCandidates),
    [projectTemplateMembers, templateCandidates],
  );
  const currentActivePresentation = currentActiveTemplate
    ? getTemplatePresentation(currentActiveTemplate.id)
    : null;
  const CurrentActiveIcon = getTemplateIcon(
    currentActiveTemplate?.id ?? "",
    currentActiveTemplate?.name ?? "",
    currentActivePresentation?.categories[0],
  );

  return (
    <div className="team-template-page flex h-full min-h-0 flex-col font-sans text-[var(--team-template-title)]">
      <TeamTemplatesHeader onCreate={startCreate} t={t} />

      <main className="team-template-scrollbar flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-full w-full items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--team-template-border)] border-t-[var(--team-template-title)]" />
          </div>
        )}

        {!loading && loadError && (
          <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center">
            <h2 className="text-[15px] font-medium text-[var(--team-template-title)]">
              Could not load templates
            </h2>
            <p className="mt-2 text-[14px] text-[var(--team-template-muted)]">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => void loadTemplates()}
              className={`${quietButtonClassName} mt-6 h-9 px-4 text-[13px] font-medium`}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !loadError && editorMode && (
          <TemplateDetailView
            canEdit={false}
            canUseTemplate={false}
            detail={selectedDetailForView}
            detailError={null}
            detailLoading={false}
            deleting={deleting}
            editorMode={editorMode}
            fieldErrors={fieldErrors}
            form={form}
            formError={formError}
            installedSkills={skills}
            runtimes={runtimes}
            saving={saving}
            saveStatus={editorSaveStatus}
            selectedEditableMemberId={editorSelectedMemberId}
            usingTemplate={false}
            onAutoSave={(draft) => void autoSaveTemplate(draft)}
            onBack={requestExitEditor}
            onCancel={requestExitEditor}
            onDelete={() => void deleteSelected()}
            onEdit={() => undefined}
            onEditableMemberSelect={setEditorSelectedMemberId}
            onFormChange={(draft) => {
              setForm(draft);
              setFieldErrors({});
              setFormError(null);
            }}
            onRetryDetail={() => undefined}
            onSave={() => void saveTemplate()}
            onValidateMemberTools={validateMemberToolsOnBlur}
            onUseTemplate={() => undefined}
          />
        )}

        {!loading && !loadError && !editorMode && selectedId && (
          <TemplateDetailView
            canEdit={canEditSelected}
            canUseTemplate={Boolean(
              selectedDetailForView &&
                projectTemplateMembersLoaded &&
                selectedDetailForView.id !== currentActiveTemplate?.id,
            )}
            detail={selectedDetailForView}
            detailError={detailError}
            detailLoading={detailViewLoading}
            deleting={deleting}
            installedSkills={skills}
            runtimes={runtimes}
            usingTemplate={applyingTemplate}
            onBack={() => setSelectedId(null)}
            onDelete={() => void deleteSelected()}
            onEdit={startEdit}
            onRetryDetail={() => void loadDetail(selectedId)}
            onUseTemplate={() => {
              if (selectedDetailForView) {
                setApplyTargetDetail(selectedDetailForView);
              }
            }}
          />
        )}

        {!loading && !loadError && !editorMode && !selectedId && (
          <div className="mx-auto w-full max-w-[1280px] p-6 md:p-8 lg:p-10">
            {currentActiveTemplate && (
              <section className="mb-8">
                <div className={`group relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 ${activeSurfaceClassName} transition-all duration-200 ease-out hover:-translate-y-px hover:bg-[var(--team-template-surface-hover)]`} onClick={() => openTemplateDetail(currentActiveTemplate.id)}>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-px bg-[var(--team-template-accent)]"
                  />
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--team-template-icon)] transition-colors duration-150 ease-out">
                      <CurrentActiveIcon className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center">
                        <span className="font-mono text-[11px] font-medium text-[var(--team-template-aux)]">
                          当前激活模板
                        </span>
                      </div>
                      <h3 className="whitespace-normal break-words text-[13px] font-semibold leading-snug text-[var(--team-template-title)]">
                        {currentActiveTemplate.name}
                      </h3>
                      {currentActiveTemplate.description && (
                        <p
                          className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-[#888888]"
                          title={currentActiveTemplate.description}
                        >
                          {currentActiveTemplate.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="hidden min-w-[150px] flex-col md:flex">
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--team-template-aux)]">
                      <span>{getTemplateVersionLabel(currentActiveTemplate)}</span>
                      <span>Updated recently</span>
                    </div>
                  </div>
                  <div className="hidden lg:flex">
                    <AgentAvatarGroup template={currentActiveTemplate} />
                  </div>
                  <button className={`${quietButtonClassName} h-7 gap-1.5 px-2.5 text-[12px] font-medium`}>
                    配置
                    <kbd className="rounded border border-[var(--team-template-border)] px-1.5 py-px font-mono text-[10px] font-medium text-[var(--team-template-aux)]">
                      C
                    </kbd>
                  </button>
                </div>
              </section>
            )}

            <section className="mb-12">
              <h2 className="mb-5 text-xs font-medium text-[var(--team-template-muted)]">
                我的团队模板 (<span className="font-mono text-[13px] tabular-nums text-[var(--team-template-title)]">{myTeamTemplates.length}</span>)
              </h2>
              {myTeamTemplates.length === 0 ? (
                <button
                  type="button"
                  onClick={startCreate}
                  className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--team-template-border)] bg-[var(--team-template-surface)] py-12 shadow-[inset_0_1px_0_var(--team-template-top-highlight)] transition-all duration-150 ease-out hover:-translate-y-px hover:border-[var(--team-template-border-strong)] hover:bg-[var(--team-template-surface-hover)]`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-[var(--team-template-muted)] ${hairlineSurfaceClassName}`}>
                    <Plus className="h-6 w-6" strokeWidth={1.5} />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-[var(--team-template-title)]">
                    创建自定义模板
                  </h3>
                  <p className="mt-1 text-xs text-[var(--team-template-muted)]">
                    Create a customized team configuration for your specific workflows.
                  </p>
                </button>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {myTeamTemplates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onClick={() => openTemplateDetail(template.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-5 text-xs font-medium text-[var(--team-template-muted)]">
                更多推荐模板
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {advancedTeamTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onClick={() => {
                      openTemplateDetail(template.id);
                    }}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
        {applyTargetDetail && (
          <UseTeamTemplateDialog
            applying={applyingTemplate}
            detail={applyTargetDetail}
            onCancel={() => {
              if (!applyingTemplate) {
                setApplyTargetDetail(null);
              }
            }}
            onConfirm={() => void applyTemplateToProject()}
          />
        )}
        {showExitPrompt && (
          <UnsavedEditorExitDialog
            saving={saving}
            onCancel={() => setShowExitPrompt(false)}
            onDiscard={closeEditor}
            onSave={() => void saveAndExitEditor()}
          />
        )}
      </main>
    </div>
  );
}
