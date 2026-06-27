import {
  ArrowLeft,
  Bot,
  Box,
  Bug,
  ChevronRight,
  Code2,
  Flame,
  Megaphone,
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
  useState,
  type ReactNode,
} from "react";
import { AgentMarkdown } from "@/components/AgentMarkdown";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  agentRuntimeApi,
  chatAgentsApi,
  chatSessionsApi,
  projectApi,
  sessionAgentsApi,
  teamPresetsApi,
} from "@/lib/api";
import { getRuntimeDisplayState } from "@/pages/agent-runtime/agentRuntimeViewModel";
import type {
  AgentRuntimeStatus,
  JsonValue as FrontendJsonValue,
  UpdateChatSession,
} from "@/types";
import { ProjectMemberType } from "../../../shared/types";
import type {
  BaseCodingAgent as ProjectBaseCodingAgent,
  ChatMemberPreset,
  CreateTeamPresetRequest,
  JsonValue,
  ProjectMemberWithRuntime,
  TeamPresetDetail,
  TeamPresetSummary,
  UpdateTeamPresetRequest,
} from "../../../shared/types";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

type MemberForm = {
  id: string;
  name: string;
  description: string;
  runnerType: string;
  recommendedModel: string;
  systemPrompt: string;
  selectedSkillIdsText: string;
};

type TeamPresetForm = {
  id: string;
  name: string;
  description: string;
  leadMemberId: string;
  teamProtocol: string;
  enabled: boolean;
  members: MemberForm[];
};

type EditorMode = "create" | "edit" | null;

const blankMember = (index: number): MemberForm => ({
  id: index === 0 ? "lead" : `member_${index + 1}`,
  name: index === 0 ? "Lead" : `Member ${index + 1}`,
  description: "",
  runnerType: "",
  recommendedModel: "",
  systemPrompt: "",
  selectedSkillIdsText: "",
});

const blankForm = (): TeamPresetForm => ({
  id: "custom_team",
  name: "",
  description: "",
  leadMemberId: "lead",
  teamProtocol: "",
  enabled: true,
  members: [blankMember(0)],
});

const detailToForm = (detail: TeamPresetDetail): TeamPresetForm => ({
  id: detail.team.id,
  name: detail.team.name,
  description: detail.team.description || "",
  leadMemberId: detail.team.lead_member_id ?? "",
  teamProtocol: detail.team.team_protocol || "",
  enabled: detail.team.enabled,
  members: detail.members.map((member) => ({
    id: member.id,
    name: member.name,
    description: member.description || "",
    runnerType: member.runner_type ?? "",
    recommendedModel: member.recommended_model ?? "",
    systemPrompt: member.system_prompt || "",
    selectedSkillIdsText: member.selected_skill_ids.join(", "),
  })),
});

const parseSkillIds = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const formToPayload = (
  form: TeamPresetForm,
): CreateTeamPresetRequest | UpdateTeamPresetRequest => ({
  team: {
    id: form.id.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    member_ids: form.members.map((member) => member.id.trim()).filter(Boolean),
    lead_member_id: form.leadMemberId.trim() || null,
    team_protocol: form.teamProtocol.trim() || null,
    enabled: form.enabled,
  },
  members: form.members.map((member) => ({
    id: member.id.trim(),
    name: member.name.trim(),
    description: member.description.trim() || null,
    runner_type: member.runnerType.trim() || null,
    recommended_model: member.recommendedModel.trim() || null,
    system_prompt: member.systemPrompt.trim() || null,
    default_workspace_path: null,
    selected_skill_ids: parseSkillIds(member.selectedSkillIdsText),
    tools_enabled: null as JsonValue | null,
    enabled: true,
  })),
});

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

type TemplateMemberBuild = {
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

const teamTemplateSessionUpdatePayload = (
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

const buildTemplateMemberSpecs = (
  detail: TeamPresetDetail,
  workspacePath: string | null,
  runtimes: AgentRuntimeStatus[],
): TemplateMemberBuild[] => {
  const memberById = new Map(detail.members.map((member) => [member.id, member]));
  const selectedMembers = detail.team.member_ids
    .map((memberId) => memberById.get(memberId))
    .filter(
      (member): member is ChatMemberPreset =>
        !!member && member.enabled !== false,
    );
  const leadMemberId =
    detail.team.lead_member_id &&
    selectedMembers.some((member) => member.id === detail.team.lead_member_id)
      ? detail.team.lead_member_id
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
  "inline-flex items-center gap-1.5 font-mono text-[11px] font-normal text-[var(--team-template-muted)]";

const hairlineSurfaceClassName =
  "relative overflow-hidden border border-[var(--team-template-border)] bg-[linear-gradient(180deg,var(--team-template-surface-top),var(--team-template-surface))] shadow-[0_1px_3px_rgba(0,0,0,0.5),inset_0_1px_0_var(--team-template-top-highlight)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[var(--team-template-top-glow)]";

const interactiveSurfaceClassName =
  "transition-all duration-200 ease-out hover:-translate-y-px hover:border-[var(--team-template-border-strong)] hover:bg-[var(--team-template-surface-hover)] hover:shadow-[inset_0_1px_0_var(--team-template-top-highlight-strong)]";

const quietButtonClassName =
  `inline-flex items-center justify-center rounded-md ${hairlineSurfaceClassName} text-[var(--team-template-title)] ${interactiveSurfaceClassName}`;

const activeSurfaceClassName =
  "border border-[var(--team-template-border)] bg-[var(--team-template-active-surface)] shadow-[inset_0_1px_0_var(--team-template-top-highlight-strong)]";

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

const advancedTeamTemplates: TeamPresetSummary[] = [
  {
    id: "advanced-release-command",
    name: "Release command center",
    description:
      "Coordinate release notes, QA checks, rollout signals, and post-launch follow-up.",
    member_ids: ["release_lead", "qa_reviewer", "growth_writer"],
    lead_member_id: "release_lead",
    team_protocol: "Mock professional release workflow placeholder.",
    is_builtin: true,
    enabled: true,
    member_count: 3,
    members: [],
  },
  {
    id: "advanced-growth-ops",
    name: "Growth operations",
    description:
      "Plan experiments, analyze funnel deltas, and prepare weekly growth decisions.",
    member_ids: ["growth_lead", "analytics", "copywriter"],
    lead_member_id: "growth_lead",
    team_protocol: "Mock professional growth workflow placeholder.",
    is_builtin: true,
    enabled: true,
    member_count: 3,
    members: [],
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

const mockTeamTemplateDetails: Record<string, TeamPresetDetail> = {
  "advanced-release-command": {
    team: {
      id: "advanced-release-command",
      name: "Release command center",
      description:
        "Coordinate release notes, QA checks, rollout signals, and post-launch follow-up.",
      member_ids: ["release_lead", "qa_reviewer", "growth_writer"],
      lead_member_id: "release_lead",
      team_protocol: "Release lead coordinates scope, QA signs off blockers, and growth writer prepares launch communication.",
      is_builtin: true,
      enabled: true,
    },
    members: [
      createMockMemberPreset("release_lead", "Release lead", "Owns release scope, risk triage, and final go/no-go framing.", ["planning", "source-control"]),
      createMockMemberPreset("qa_reviewer", "QA reviewer", "Checks regression risk, verifies acceptance criteria, and records blockers.", ["review", "testing"]),
      createMockMemberPreset("growth_writer", "Growth writer", "Turns release details into clear user-facing updates and follow-up notes.", ["writing", "launch"]),
    ],
  },
  "advanced-growth-ops": {
    team: {
      id: "advanced-growth-ops",
      name: "Growth operations",
      description:
        "Plan experiments, analyze funnel deltas, and prepare weekly growth decisions.",
      member_ids: ["growth_lead", "analytics", "copywriter"],
      lead_member_id: "growth_lead",
      team_protocol: "Growth lead frames the hypothesis, analytics validates results, and copywriter prepares experiment messaging.",
      is_builtin: true,
      enabled: true,
    },
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
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-[var(--team-template-muted)]">
        {label}
      </span>
      <input
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="team-template-field mt-1.5 h-8 w-full rounded-md border border-[var(--team-template-border)] bg-[var(--team-template-surface)] px-3 text-[13px] text-[var(--team-template-title)] shadow-[inset_0_1px_0_var(--team-template-top-highlight)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] focus:border-[var(--team-template-border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function FormTextarea({
  label,
  onChange,
  rows = 3,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-[var(--team-template-muted)]">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="team-template-field mt-1.5 w-full resize-y rounded-md border border-[var(--team-template-border)] bg-[var(--team-template-surface)] px-3 py-2 text-[13px] leading-relaxed text-[var(--team-template-title)] shadow-[inset_0_1px_0_var(--team-template-top-highlight)] outline-none transition-colors duration-150 placeholder:text-[var(--team-template-muted)] focus:border-[var(--team-template-border-strong)]"
      />
    </label>
  );
}

function TemplateEditor({
  form,
  formError,
  mode,
  saving,
  onCancel,
  onChange,
  onSave,
}: {
  form: TeamPresetForm;
  formError: string | null;
  mode: Exclude<EditorMode, null>;
  saving: boolean;
  onCancel: () => void;
  onChange: (form: TeamPresetForm) => void;
  onSave: () => void;
}) {
  const updateMember = (index: number, patch: Partial<MemberForm>) => {
    const members = form.members.map((member, memberIndex) =>
      memberIndex === index ? { ...member, ...patch } : member,
    );
    onChange({
      ...form,
      leadMemberId:
        form.leadMemberId &&
        members.some((member) => member.id === form.leadMemberId)
          ? form.leadMemberId
          : members[0]?.id ?? "",
      members,
    });
  };

  const removeMember = (index: number) => {
    const members = form.members.filter(
      (_, memberIndex) => memberIndex !== index,
    );
    onChange({
      ...form,
      members,
      leadMemberId:
        members.find((member) => member.id === form.leadMemberId)?.id ??
        members[0]?.id ??
        "",
    });
  };

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <section className={`rounded-lg ${hairlineSurfaceClassName}`}>
        <header className="flex h-14 items-center justify-between border-b border-[var(--team-template-border)] px-6">
          <h2 className="text-[14px] font-medium text-[var(--team-template-title)]">
            {mode === "create" ? "New custom template" : "Edit template"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--team-template-muted)] transition-colors duration-150 hover:bg-[var(--team-template-surface-hover)] hover:text-[var(--team-template-title)] disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        <div className="space-y-6 p-6">
          {formError && (
            <div className="rounded-md bg-red-500/10 px-4 py-3 text-[13px] text-red-500 border border-red-500/20">
              {formError}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <FormInput
              disabled={mode === "edit"}
              label="Template ID"
              value={form.id}
              onChange={(id) => onChange({ ...form, id })}
            />
            <FormInput
              label="Name"
              value={form.name}
              onChange={(name) => onChange({ ...form, name })}
            />
          </div>
          <FormTextarea
            label="Description"
            value={form.description}
            onChange={(description) => onChange({ ...form, description })}
          />
          <FormTextarea
            label="Team protocol"
            value={form.teamProtocol}
            onChange={(teamProtocol) => onChange({ ...form, teamProtocol })}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--team-template-title)]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) =>
                onChange({ ...form, enabled: event.target.checked })
              }
              className="h-4 w-4 rounded border-[var(--team-template-border-strong)] bg-[var(--team-template-surface)] text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            Enabled in picker
          </label>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-t border-[var(--team-template-border)] pt-8">
              <h3 className="text-[14px] font-medium text-[var(--team-template-title)]">
                Members
              </h3>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...form,
                    members: [...form.members, blankMember(form.members.length)],
                  })
                }
                className={`${quietButtonClassName} h-8 gap-1.5 px-3 text-[13px] font-medium`}
              >
                <Plus aria-hidden="true" className="-ml-0.5 h-4 w-4 text-[var(--team-template-muted)]" strokeWidth={1.5} />
                Add member
              </button>
            </div>

            {form.members.map((member, index) => (
              <section
                key={`${member.id}-${index}`}
                className={`rounded-lg p-6 ${hairlineSurfaceClassName}`}
              >
                <div className="mb-5 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--team-template-title)]">
                    <input
                      type="radio"
                      checked={form.leadMemberId === member.id}
                      onChange={() =>
                        onChange({ ...form, leadMemberId: member.id })
                      }
                      className="h-4 w-4 border-[var(--team-template-border-strong)] bg-[var(--team-template-surface)] text-[var(--primary)] focus:ring-[var(--primary)]"
                    />
                    Lead member
                  </label>
                  <button
                    type="button"
                    onClick={() => removeMember(index)}
                    disabled={form.members.length === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--team-template-muted)] transition-colors duration-150 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                    aria-label="Remove member"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  <FormInput
                    label="Member ID"
                    value={member.id}
                    onChange={(id) => updateMember(index, { id })}
                  />
                  <FormInput
                    label="Name"
                    value={member.name}
                    onChange={(name) => updateMember(index, { name })}
                  />
                  <FormInput
                    label="Executor"
                    value={member.runnerType}
                    onChange={(runnerType) => updateMember(index, { runnerType })}
                  />
                  <FormInput
                    label="Recommended model"
                    value={member.recommendedModel}
                    onChange={(recommendedModel) =>
                      updateMember(index, { recommendedModel })
                    }
                  />
                </div>
                <div className="mt-5 space-y-5">
                  <FormInput
                    label="Skill IDs (comma separated)"
                    value={member.selectedSkillIdsText}
                    onChange={(selectedSkillIdsText) =>
                      updateMember(index, { selectedSkillIdsText })
                    }
                  />
                  <FormTextarea
                    label="Description"
                    value={member.description}
                    onChange={(description) => updateMember(index, { description })}
                  />
                  <FormTextarea
                    label="System prompt"
                    rows={5}
                    value={member.systemPrompt}
                    onChange={(systemPrompt) =>
                      updateMember(index, { systemPrompt })
                    }
                  />
                </div>
              </section>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--team-template-border)] pt-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className={`${quietButtonClassName} h-9 px-4 text-[13px] font-medium disabled:opacity-50`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-[#ededed] px-5 text-[13px] font-medium text-[#08090a] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-150 ease-out hover:-translate-y-px hover:bg-white disabled:opacity-60"
            >
              <Save aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              {saving ? "Saving..." : "Save template"}
            </button>
          </div>
        </div>
      </section>
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
  const memberNames = template.members
    .map((member) => member.name)
    .filter(Boolean);
  const source = memberNames.length > 0 ? memberNames : template.member_ids;

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
  "border-[rgba(77,170,251,0.12)] bg-[rgba(77,170,251,0.06)]",
  "border-[rgba(196,167,255,0.12)] bg-[rgba(196,167,255,0.06)]",
  "border-[rgba(93,228,167,0.12)] bg-[rgba(93,228,167,0.06)]",
  "border-[rgba(245,180,82,0.12)] bg-[rgba(245,180,82,0.06)]",
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
    <section className="border-t border-[var(--team-template-border)] pt-6 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[12px] font-semibold text-[var(--team-template-title)]">
            {title}
          </h3>
        </div>
        <span className="font-mono text-[9px] font-medium text-[var(--team-template-aux)]">
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
  index,
  isLead,
  member,
}: {
  index: number;
  isLead: boolean;
  member: ChatMemberPreset;
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

function WorkflowPreview({ steps }: { steps: WorkflowStepPreview[] }) {
  const stepCountLabel = String(steps.length).padStart(2, "0");
  const [litDotCount, setLitDotCount] = useState(0);
  const [litTextCount, setLitTextCount] = useState(0);

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
    <section className="team-template-workflow-preview border-t border-[var(--team-template-border)] pt-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--team-template-muted)]">
          工作流程
        </h2>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-medium text-[var(--team-template-aux)] tabular-nums">
          <Workflow aria-hidden="true" className="h-3 w-3" strokeWidth={1.2} />
          PIPELINE / {stepCountLabel}
        </span>
      </div>

      <div>
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
      </div>
    </section>
  );
}

function TemplateDetailView({
  canEdit,
  canUseTemplate,
  detail,
  detailError,
  detailLoading,
  usingTemplate,
  onBack,
  onDelete,
  onEdit,
  onRetryDetail,
  onUseTemplate,
}: {
  canEdit: boolean;
  canUseTemplate: boolean;
  detail: TeamPresetDetail | null;
  detailError: string | null;
  detailLoading: boolean;
  usingTemplate: boolean;
  onBack: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRetryDetail: () => void;
  onUseTemplate: () => void;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  useEffect(() => {
    if (!detail) {
      setSelectedMemberId(null);
      return;
    }

    setSelectedMemberId((current) =>
      current && detail.members.some((member) => member.id === current)
        ? current
        : (detail.members[0]?.id ?? null),
    );
  }, [detail]);

  const selectedMember = useMemo(
    () =>
      detail?.members.find((member) => member.id === selectedMemberId) ??
      detail?.members[0] ??
      null,
    [detail, selectedMemberId],
  );
  const selectedMemberIndex = useMemo(
    () =>
      selectedMember && detail
        ? Math.max(
            detail.members.findIndex(
              (member) => member.id === selectedMember.id,
            ),
            0,
          )
        : 0,
    [detail, selectedMember],
  );

  if (detailLoading) {
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

  if (detailError || !detail) {
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

  const presentation = getTemplatePresentation(detail.team.id);
  const DetailCategoryIcon = getTemplateIcon(
    detail.team.id,
    detail.team.name,
    presentation.categories[0],
  );

  return (
    <div className="mx-auto grid h-auto min-h-full w-full max-w-[1280px] grid-cols-1 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(420px,40vw)] 2xl:grid-cols-[minmax(0,1fr)_540px]">
      <div className="team-template-scrollbar min-w-0 p-5 md:p-7 lg:min-h-0 lg:overflow-y-auto lg:p-8">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-[12px] font-medium text-[var(--team-template-muted)] transition-colors duration-150 hover:text-[var(--team-template-title)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.2} /> 返回模板
      </button>

      <header className="border-b border-[var(--team-template-border)] pb-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--team-template-icon)]">
              <DetailCategoryIcon className="h-4 w-4" strokeWidth={1.2} />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[20px] font-semibold leading-tight text-[var(--team-template-title)]">
                  {detail.team.name}
                </h1>
                {detail.team.is_builtin && <RecommendedBadge />}
              </div>
              <div className="mt-2">
                <ScenarioBadges categories={presentation.categories} />
              </div>
              <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--team-template-muted)]">
                {detail.team.description || "No description provided for this template."}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className={`${quietButtonClassName} h-8 gap-1.5 px-3 text-[12px] font-medium`}
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5 text-[var(--team-template-muted)]" strokeWidth={1.2} />
                  编辑
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium text-red-300 ${hairlineSurfaceClassName} transition-all duration-150 ease-out hover:-translate-y-px hover:border-red-400/30 hover:bg-red-500/10`}
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.2} />
                  删除
                </button>
              </>
            )}
            {canUseTemplate && (
              <button
                type="button"
                onClick={onUseTemplate}
                disabled={usingTemplate}
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

      <div className="grid gap-12 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,2fr)]">
        <WorkflowPreview steps={presentation.workflow} />

        <section className="border-t border-[var(--team-template-border)] pt-5">
          <header className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--team-template-muted)]">
              成员信息
            </h2>
            <span className="font-mono text-[9px] font-medium text-[var(--team-template-aux)] tabular-nums">
              MEMBERS / {String(detail.members.length).padStart(2, "0")}
            </span>
          </header>

          <div>
              {detail.members.map((member, index) => {
                const isLead = member.id === detail.team.lead_member_id;
                const active = selectedMember?.id === member.id;
                const roleKey = getMemberRoleKey(member);
                const description =
                  member.description ||
                  member.system_prompt ||
                  "No role description.";

                return (
                  <button
                    key={member.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedMemberId(member.id)}
                    className={[
                      "team-template-member-row group grid min-h-[48px] w-full grid-cols-1 gap-1.5 border-b border-[var(--team-template-border)] px-2 py-2 text-left transition-colors duration-150 last:border-b-0 md:grid-cols-[minmax(150px,0.78fr)_minmax(0,1fr)_auto] md:items-center md:gap-3",
                      active
                        ? "bg-[var(--team-template-row-hover)]"
                        : "hover:bg-[var(--team-template-row-hover)]",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${getMemberDotClassName(member, index)}`}
                      />
                      <span
                        className={`min-w-0 truncate rounded-[4px] border px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-[var(--team-template-code-text)] transition-colors duration-150 group-hover:text-[var(--team-template-title)] ${getMemberRoleToneClassName(member, index)}`}
                        title={roleKey}
                      >
                        {roleKey}
                      </span>
                      {isLead && (
                        <span className="font-mono text-[10px] font-medium text-[var(--team-template-muted)]">
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
                      <ChevronRight
                        aria-hidden="true"
                        className={[
                          "h-2.5 w-2.5 shrink-0 text-[var(--team-template-aux)] opacity-35 transition-all duration-150 group-hover:opacity-100 group-hover:text-[var(--team-template-muted)]",
                          active
                            ? "translate-x-0.5 opacity-70"
                            : "",
                        ].join(" ")}
                        strokeWidth={1.4}
                      />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      </div>

      {detail.team.team_protocol && (
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
            <AgentMarkdown content={detail.team.team_protocol} fontSize={13} />
          </div>
        </section>
      )}
      </div>

      <aside className="min-h-0 border-t border-[var(--team-template-border)] p-4 lg:h-full lg:border-l lg:border-t-0 lg:p-5">
        {selectedMember && (
          <TemplateMemberInfoPage
            index={selectedMemberIndex}
            isLead={selectedMember.id === detail.team.lead_member_id}
            member={selectedMember}
          />
        )}
      </aside>
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
  detail: TeamPresetDetail;
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
              {detail.team.name}
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
  } = useWorkspace();
  const [templates, setTemplates] = useState<TeamPresetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<TeamPresetDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [form, setForm] = useState<TeamPresetForm>(blankForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [applyTargetDetail, setApplyTargetDetail] =
    useState<TeamPresetDetail | null>(null);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [projectTemplateMembers, setProjectTemplateMembers] = useState<
    ProjectMemberWithRuntime[]
  >([]);
  const [projectTemplateMembersLoaded, setProjectTemplateMembersLoaded] =
    useState(false);

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
    selectedDetail?.team.id === selectedId ? selectedDetail : null;
  const detailViewLoading = Boolean(
    selectedId &&
      !detailError &&
      (detailLoading || selectedDetailForView === null),
  );
  const canEditSelected = Boolean(
    selectedDetail &&
      selectedDetail.team.id === selectedId &&
      !selectedDetail.team.is_builtin,
  );

  const openTemplateDetail = (teamId: string) => {
    setDetailError(null);
    setDetailLoading(true);
    setSelectedId(teamId);
  };

  const startCreate = () => {
    setForm(blankForm());
    setFormError(null);
    setEditorMode("create");
    setSelectedId(null);
  };

  const startEdit = () => {
    if (!selectedDetailForView || selectedDetailForView.team.is_builtin) return;
    setForm(detailToForm(selectedDetailForView));
    setFormError(null);
    setEditorMode("edit");
  };

  const saveTemplate = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = formToPayload(form);
      const saved =
        editorMode === "create"
          ? await teamPresetsApi.create(payload)
          : await teamPresetsApi.update(form.id, payload);
      setEditorMode(null);
      await loadTemplates();
      setSelectedDetail(saved);
      setSelectedId(saved.team.id);
    } catch (error) {
      const errorMessage = errorText(error, "Failed to save template.");
      setFormError(errorMessage);
      return;
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedDetailForView || selectedDetailForView.team.is_builtin || deleting) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedDetailForView.team.name}"? This removes the custom template and any private members only used by it.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await teamPresetsApi.delete(selectedDetailForView.team.id);
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
      const teamProtocol = detail.team.team_protocol.trim();
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
      showToast(`已使用「${detail.team.name}」替换当前团队成员。`, "success");
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
          <TemplateEditor
            form={form}
            formError={formError}
            mode={editorMode}
            saving={saving}
            onCancel={() => setEditorMode(null)}
            onChange={setForm}
            onSave={() => void saveTemplate()}
          />
        )}

        {!loading && !loadError && !editorMode && selectedId && (
          <TemplateDetailView
            canEdit={canEditSelected}
            canUseTemplate={Boolean(
              selectedDetailForView &&
                projectTemplateMembersLoaded &&
                selectedDetailForView.team.id !== currentActiveTemplate?.id,
            )}
            detail={selectedDetailForView}
            detailError={detailError}
            detailLoading={detailViewLoading}
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
      </main>
    </div>
  );
}
