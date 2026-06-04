import { useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleAlert,
  Crown,
  FolderGit2,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  UserRoundCog,
  X,
} from "lucide-react";
import { AgentMarkdown } from "@/components/AgentMarkdown";
import {
  DropdownSelect,
  type DropdownSelectOption,
} from "@/components/DropdownSelect";
import { AgentBrandAvatar } from "../agent-runtime/agentRuntimeBrand";
import type {
  AgentRuntimeReasoningCapability,
  BackendChatSkill,
  BaseCodingAgent,
  JsonValue,
  McpConfig,
} from "@/types";
import {
  defaultOptionId,
  cx,
  type ProjectMemberWithExecution,
} from "./teamUtils";

type MemberConfigTab = "config" | "mcp";

type TeamConfigTabsProps = {
  allowedSkillIds: string[];
  capability: AgentRuntimeReasoningCapability | null;
  configuredMcpServerKeys: string[];
  isLeader: boolean;
  memberDirty: boolean;
  memberSuccess: boolean;
  mcpApplying: boolean;
  mcpConfig: McpConfig | null;
  mcpConfigPath: string;
  mcpDirty: boolean;
  mcpError: string | null;
  mcpLoading: boolean;
  mcpServersJson: string;
  mcpSuccess: boolean;
  modelOptions: DropdownSelectOption[];
  reasoningOptions: DropdownSelectOption[];
  roleDefinition: string;
  runnerType: BaseCodingAgent;
  runtimeOptions: DropdownSelectOption[];
  saving: boolean;
  selectedMember: ProjectMemberWithExecution | null;
  selectedModelValue: string;
  selectedReasoningValue: string;
  skillLookup: BackendChatSkill[];
  skills: BackendChatSkill[];
  skillsError: string | null;
  skillsLoading: boolean;
  workspacePath: string;
  onApplyMcpServers: () => void;
  onDiscardMemberChanges: () => void;
  onDiscardMcpChanges: () => void;
  onMcpServersChange: (value: string) => void;
  onSaveMember: () => void;
  onToggleMcpServer: (serverKey: string) => void;
  setAllowedSkillIds: (ids: string[]) => void;
  setIsLeader: (value: boolean | ((current: boolean) => boolean)) => void;
  setModelName: (value: string) => void;
  setModelVariant: (value: string) => void;
  setRoleDefinition: (value: string) => void;
  setRunnerType: (runnerType: BaseCodingAgent) => void;
  setThinkingEffort: (value: string) => void;
  setWorkspacePath: (value: string) => void;
};

function ConfigSection({
  bodyClassName,
  children,
  className,
  description,
  title,
}: {
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  description?: string;
  title: string;
}) {
  return (
    <section className={cx("flex flex-col pb-8", className)}>
      <div className="mb-3 px-1">
        <h3 className="text-[16px] font-semibold leading-[1.25] tracking-[-0.1px] text-[var(--ink)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1 max-w-[680px] text-[14px] leading-[1.5] text-[var(--ink-subtle)]">
            {description}
          </p>
        )}
      </div>
      <div
        className={cx(
          "flex-1 space-y-6 rounded-[12px] bg-[var(--surface-2)] p-5",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)] md:items-start md:gap-8">
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-[1.35] text-[var(--ink)]">
          {title}
        </p>
        {description && (
          <p className="mt-1 text-[13px] leading-[1.45] text-[var(--ink-subtle)]">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SkillSettingBlock({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[14px] font-medium leading-[1.35] text-[var(--ink)]">
          {title}
        </p>
        {description && (
          <p className="mt-1 text-[13px] leading-[1.45] text-[var(--ink-subtle)]">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const inputClassName =
  "h-10 w-full rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] px-3 font-mono text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-tertiary)] focus:ring-2 focus:ring-[var(--primary-focus)]/50";

function EmptyMemberState() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
        <UserRoundCog className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-[16px] font-medium text-[var(--ink)]">
        No project member selected
      </h3>
      <p className="mt-2 max-w-[320px] text-[14px] leading-relaxed text-[var(--ink-subtle)]">
        Select a project member from the left sidebar to manage runtime,
        responsibilities, skills, and MCP configuration.
      </p>
    </div>
  );
}

function SkillsSection({
  allowedSkillIds,
  skillLookup,
  skills,
  skillsError,
  skillsLoading,
  setAllowedSkillIds,
}: {
  allowedSkillIds: string[];
  skillLookup: BackendChatSkill[];
  skills: BackendChatSkill[];
  skillsError: string | null;
  skillsLoading: boolean;
  setAllowedSkillIds: (ids: string[]) => void;
}) {
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const detailSkill =
    skills.find((skill) => skill.id === detailSkillId) ?? null;
  const selectedSkillIds = new Set(allowedSkillIds);
  const selectedSkills = allowedSkillIds.map((skillId) => ({
    id: skillId,
    skill:
      skills.find((item) => item.id === skillId) ??
      skillLookup.find((item) => item.id === skillId) ??
      null,
  }));

  const toggleSkill = (skill: BackendChatSkill) => {
    if (selectedSkillIds.has(skill.id)) {
      setAllowedSkillIds(allowedSkillIds.filter((id) => id !== skill.id));
      return;
    }

    setAllowedSkillIds([...allowedSkillIds, skill.id]);
  };

  const removeSkill = (skillId: string) => {
    setAllowedSkillIds(allowedSkillIds.filter((id) => id !== skillId));
  };

  return (
    <>
      <SkillSettingBlock
        title="Add Skills"
        description="Skills currently attached to this project member."
      >
        {selectedSkills.length === 0 ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            No skills added.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedSkills.map(({ id, skill }) => (
              <button
                key={id}
                type="button"
                onClick={() => removeSkill(id)}
                className="inline-flex h-8 max-w-full items-center gap-2 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] px-2.5 text-[13px] font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--hairline-strong)] hover:text-[var(--ink)]"
              >
                <span className="truncate">{skill?.name ?? id}</span>
                <X className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
              </button>
            ))}
          </div>
        )}
      </SkillSettingBlock>

      <SkillSettingBlock
        title="Installed Skills"
        description="Skills installed for the selected Agent Runtime."
      >
        {skillsLoading ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            Loading installed skills for this runtime...
          </p>
        ) : skillsError ? (
          <p className="rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
            {skillsError}
          </p>
        ) : skills.length === 0 ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            No installed skills available for this runtime.
          </p>
        ) : (
          <div
            className={cx(
              "grid gap-4",
              detailSkill &&
                "xl:grid-cols-[minmax(420px,1fr)_minmax(320px,0.85fr)]",
            )}
          >
            <div className="min-w-0">
              <div className="grid gap-2 md:grid-cols-2">
                {skills.map((skill) => {
                  const selected = selectedSkillIds.has(skill.id);
                  return (
                    <div
                      key={skill.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailSkillId(skill.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setDetailSkillId(skill.id);
                        }
                      }}
                      className={cx(
                        "flex min-h-[112px] min-w-0 cursor-pointer flex-col overflow-hidden rounded-[8px] border bg-[var(--surface-3)] p-3 text-left transition-colors",
                        selected
                          ? "border-[var(--primary)]/35 bg-[var(--primary-tint)]"
                          : "border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-4)]",
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--mono-border)] bg-[var(--mono-bg)] text-[var(--ink-muted)]">
                          <FolderGit2 className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium text-[var(--ink)]">
                            {skill.name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSkill(skill);
                            }}
                            className={cx(
                              "inline-flex h-7 items-center gap-1 rounded-[8px] border px-2 text-[12px] font-medium transition-colors",
                              selected
                                ? "border-[var(--primary)]/35 bg-[var(--primary-tint)] text-[var(--primary)]"
                                : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:text-[var(--ink)]",
                            )}
                          >
                            {selected ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <PackagePlus className="h-3.5 w-3.5" />
                            )}
                            {selected ? "Added" : "Add"}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDetailSkillId(
                                detailSkillId === skill.id ? null : skill.id,
                              );
                            }}
                            className={cx(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)] transition-colors hover:text-[var(--primary)]",
                              detailSkillId === skill.id &&
                                "text-[var(--primary)]",
                            )}
                            aria-label={`View ${skill.name} skill content`}
                          >
                            <CircleAlert className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 min-w-0">
                        <p className="line-clamp-2 overflow-hidden text-[13px] leading-[1.45] text-[var(--ink-subtle)]">
                          {skill.description || "No description."}
                        </p>
                      </div>

                      {skill.category && (
                        <span className="mt-2 block truncate font-mono text-[11px] text-[var(--ink-tertiary)]">
                          {skill.category}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {detailSkill && (
              <SkillMarkdownPanel
                skill={detailSkill}
                onClose={() => setDetailSkillId(null)}
              />
            )}
          </div>
        )}
      </SkillSettingBlock>
    </>
  );
}

function SkillMarkdownPanel({
  skill,
  onClose,
}: {
  skill: BackendChatSkill;
  onClose: () => void;
}) {
  const tags = skill.tags ?? [];
  const triggerKeywords = skill.trigger_keywords ?? [];

  return (
    <div className="min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-[var(--ink)]">
            {skill.name}
          </p>
          <p className="mt-1 text-[13px] leading-[1.45] text-[var(--ink-subtle)]">
            {skill.description || "No description."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink)]"
          aria-label={`Close ${skill.name} skill content`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {(tags.length > 0 || triggerKeywords.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...tags, ...triggerKeywords].slice(0, 8).map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className="rounded-[4px] border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-tertiary)]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 max-h-[680px] overflow-auto rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4 text-[13px] leading-relaxed text-[var(--ink-muted)] ot-scroll-area-styled">
        <AgentMarkdown
          content={skill.content || "No skill content."}
          fontSize={13}
        />
      </div>
    </div>
  );
}

function ConfigTab({
  allowedSkillIds,
  capability,
  isLeader,
  memberDirty,
  memberSuccess,
  modelOptions,
  reasoningOptions,
  roleDefinition,
  runnerType,
  runtimeOptions,
  saving,
  selectedModelValue,
  selectedReasoningValue,
  skillLookup,
  skills,
  skillsError,
  skillsLoading,
  workspacePath,
  onDiscardMemberChanges,
  onSaveMember,
  setAllowedSkillIds,
  setIsLeader,
  setModelName,
  setModelVariant,
  setRoleDefinition,
  setRunnerType,
  setThinkingEffort,
  setWorkspacePath,
}: Omit<
  TeamConfigTabsProps,
  | "configuredMcpServerKeys"
  | "mcpApplying"
  | "mcpConfig"
  | "mcpConfigPath"
  | "mcpDirty"
  | "mcpError"
  | "mcpLoading"
  | "mcpServersJson"
  | "mcpSuccess"
  | "onApplyMcpServers"
  | "onDiscardMcpChanges"
  | "onMcpServersChange"
  | "onToggleMcpServer"
  | "selectedMember"
>) {
  return (
    <div className="space-y-0">
      <div
        className="grid gap-6 pb-8"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 520px), 1fr))",
        }}
      >
        <ConfigSection
          title="PROJECT MEMBER CONFIG"
          description="Choose runtime, model, workspace, and lead status."
          className="pb-0"
        >
          <SettingRow
            title="Agent Runtime"
            description="Installed executor used when this project member runs."
          >
            <DropdownSelect
              value={runnerType}
              options={runtimeOptions}
              searchPlaceholder="Search runtimes..."
              className="[&>button]:h-10 [&>button]:bg-[var(--surface-3)] [&>button]:font-mono [&>button]:text-[13px]"
              triggerIcon={
                <AgentBrandAvatar
                  runner={runnerType}
                  framed={false}
                  className="h-4 w-4 text-[var(--ink-tertiary)]"
                  iconClassName="h-3.5 w-3.5"
                />
              }
              onChange={(value) => setRunnerType(value as BaseCodingAgent)}
            />
          </SettingRow>

          <SettingRow
            title="Model"
            description="Use the runtime default or pick a discovered model."
          >
            <DropdownSelect
              value={selectedModelValue}
              options={modelOptions}
              searchPlaceholder="Search models..."
              className="[&>button]:h-10 [&>button]:bg-[var(--surface-3)] [&>button]:font-mono [&>button]:text-[13px]"
              onChange={(value) =>
                setModelName(value === defaultOptionId ? "" : value)
              }
            />
          </SettingRow>

          <SettingRow
            title="Reasoning level"
            description="Optional executor-specific thinking effort or variant."
          >
            <DropdownSelect
              value={selectedReasoningValue}
              options={reasoningOptions}
              showSearch={false}
              className="[&>button]:h-10 [&>button]:bg-[var(--surface-3)] [&>button]:font-mono [&>button]:text-[13px]"
              onChange={(value) => {
                const nextValue = value === defaultOptionId ? "" : value;
                if (capability?.kind === "variant") {
                  setModelVariant(nextValue);
                } else {
                  setThinkingEffort(nextValue);
                }
              }}
            />
          </SettingRow>

          <SettingRow
            title="Local Workspace Path"
            description="当前项目成员的主要工作路径"
          >
            <input
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder="e.g. /home/user/workspace"
              className={inputClassName}
            />
          </SettingRow>

          <SettingRow
            title="是否为主Agent"
            description="计划模式下负责完成计划制定和任务分配"
          >
            <button
              type="button"
              onClick={() => setIsLeader((value) => !value)}
              className="flex w-full items-center justify-between rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] px-4 py-3 text-left transition-colors hover:border-[var(--hairline-strong)]"
            >
              <div className="flex items-center gap-3">
                <Crown
                  className={cx(
                    "h-4 w-4",
                    isLeader
                      ? "text-[var(--primary)]"
                      : "text-[var(--ink-tertiary)]",
                  )}
                />
                <div>
                  <p className="text-[14px] font-medium leading-[1.3] text-[var(--ink)]">
                    Workflow Lead
                  </p>
                  <p className="text-[13px] leading-[1.45] text-[var(--ink-subtle)]">
                    {isLeader ? "Enabled for this project member" : "Disabled"}
                  </p>
                </div>
              </div>
              <span
                className={cx(
                  "relative h-6 w-11 rounded-full border transition-colors",
                  isLeader
                    ? "border-[var(--primary)] bg-[var(--primary)]"
                    : "border-[var(--hairline-strong)] bg-[var(--surface-3)]",
                )}
              >
                <span
                  className={cx(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                    isLeader ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          </SettingRow>
        </ConfigSection>

        <ConfigSection
          title="SYSTEM PROMPT"
          description="Define the project member's responsibilities, role, and working style."
          className="pb-0"
          bodyClassName="p-0"
        >
          <textarea
            value={roleDefinition}
            onChange={(event) => setRoleDefinition(event.target.value)}
            spellCheck={false}
            placeholder={`在这里定义项目成员的工作职责、角色和工作风格

示例：
你是游戏开发工程师 Agent，负责将策划需求转化为可落地的工程实现。

## 职责：
理解玩法目标，拆解模块、数据结构、核心流程与实现步骤，输出清晰方案或代码。

## 风格：
务实、稳定、可维护，优先复用已有架构，避免过度设计和擅自扩展需求。

## 约束：
信息不足时明确假设并继续推进；主动识别性能、多人同步、资源依赖和测试风险；
输出需包含任务理解、实现方案、风险点和验证清单。`}
            className="block h-full min-h-[420px] w-full resize-none rounded-[12px] border-0 bg-[var(--surface-2)] px-5 py-5 font-mono text-[14px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] placeholder:opacity-100 focus:ring-2 focus:ring-[var(--primary-focus)]/50"
          />
        </ConfigSection>
      </div>

      <ConfigSection
        title="SKILLS"
        description="Review installed skills and add the ones this project member can use."
      >
        <SkillsSection
          allowedSkillIds={allowedSkillIds}
          skillLookup={skillLookup}
          skills={skills}
          skillsError={skillsError}
          skillsLoading={skillsLoading}
          setAllowedSkillIds={setAllowedSkillIds}
        />
      </ConfigSection>

      {(memberDirty || memberSuccess || saving) && (
        <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-[var(--hairline)] bg-[var(--surface-1)] py-4">
          {memberDirty && !memberSuccess && (
            <button
              type="button"
              onClick={onDiscardMemberChanges}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] px-3.5 text-[14px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={() => void onSaveMember()}
            disabled={saving || memberSuccess}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--primary)] px-3.5 text-[14px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {memberSuccess ? (
              <Check className="h-4 w-4" />
            ) : saving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {memberSuccess ? "Saved" : saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}

type McpMeta = {
  description?: string;
  icon?: string;
  name?: string;
  url?: string;
};

const getMcpIconSrc = (icon?: string) =>
  icon ? `/${icon.replace(/^\/+/u, "")}` : null;

function McpConfigTab({
  configuredMcpServerKeys,
  mcpApplying,
  mcpConfig,
  mcpConfigPath,
  mcpDirty,
  mcpError,
  mcpLoading,
  mcpServersJson,
  mcpSuccess,
  onApplyMcpServers,
  onDiscardMcpChanges,
  onMcpServersChange,
  onToggleMcpServer,
}: Pick<
  TeamConfigTabsProps,
  | "configuredMcpServerKeys"
  | "mcpApplying"
  | "mcpConfig"
  | "mcpConfigPath"
  | "mcpDirty"
  | "mcpError"
  | "mcpLoading"
  | "mcpServersJson"
  | "mcpSuccess"
  | "onApplyMcpServers"
  | "onDiscardMcpChanges"
  | "onMcpServersChange"
  | "onToggleMcpServer"
>) {
  const preconfiguredObj = (mcpConfig?.preconfigured ?? {}) as Record<
    string,
    JsonValue | undefined
  >;
  const meta =
    typeof preconfiguredObj.meta === "object" &&
    preconfiguredObj.meta !== null &&
    !Array.isArray(preconfiguredObj.meta)
      ? (preconfiguredObj.meta as Record<string, McpMeta>)
      : {};
  const servers = Object.fromEntries(
    Object.entries(preconfiguredObj).filter(([key]) => key !== "meta"),
  );
  const unsupported = mcpError?.includes("support MCP") ?? false;

  return (
    <div className="space-y-6">
      {mcpError && !unsupported && (
        <div className="rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
          MCP configuration error: {mcpError}
        </div>
      )}

      <ConfigSection
        title="MCP SERVER CONFIG"
        description="Edit the full MCP JSON for the selected project member runtime."
      >
        {unsupported ? (
          <div className="m-4 rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-4 text-[14px] leading-[1.5] text-amber-300">
            <p className="font-medium">MCP is not supported by this runtime.</p>
            <p className="mt-1 text-[13px]">{mcpError}</p>
          </div>
        ) : (
          <>
            <SettingRow
              title="Server Configuration"
              description={
                mcpLoading
                  ? "Loading current MCP configuration..."
                  : "JSON is saved to the executor's MCP config file."
              }
            >
              <textarea
                value={
                  mcpLoading
                    ? "Loading MCP server configuration..."
                    : mcpServersJson
                }
                onChange={(event) => onMcpServersChange(event.target.value)}
                disabled={mcpLoading}
                rows={16}
                spellCheck={false}
                placeholder='{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["your-mcp-server"]
    }
  }
}'
                className="block w-full resize-y rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-tertiary)] focus:ring-2 focus:ring-[var(--primary-focus)]/50 disabled:opacity-70"
              />
              {mcpConfigPath && !mcpLoading && (
                <p className="mt-2 truncate font-mono text-[12px] text-[var(--ink-tertiary)]">
                  {mcpConfigPath}
                </p>
              )}
            </SettingRow>

            {mcpConfig?.preconfigured &&
              typeof mcpConfig.preconfigured === "object" &&
              Object.keys(servers).length > 0 && (
                <SettingRow
                  title="Built-in MCP Servers"
                  description="Click a card to insert the preset into the JSON above."
                >
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(servers).map(([key]) => {
                      const metaObj = meta[key] ?? {};
                      const name = metaObj.name || key;
                      const description =
                        metaObj.description || "No description.";
                      const icon = getMcpIconSrc(metaObj.icon);
                      const selected = configuredMcpServerKeys.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onToggleMcpServer(key)}
                          className={cx(
                            "group flex min-w-0 items-start gap-3 rounded-[8px] border p-3 text-left transition-colors",
                            selected
                              ? "border-[var(--primary)]/45 bg-[var(--primary-tint)]"
                              : "border-[var(--hairline)] bg-[var(--surface-3)] hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-4)]",
                          )}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[var(--surface-1)]">
                            {icon ? (
                              <img
                                src={icon}
                                alt=""
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Server className="h-4 w-4 text-[var(--ink-tertiary)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-[var(--ink)]">
                              {name}
                            </span>
                            <span className="mt-1 line-clamp-2 block text-[12px] leading-[1.4] text-[var(--ink-subtle)]">
                              {description}
                            </span>
                          </span>
                          {selected ? (
                            <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                          ) : (
                            <PackagePlus className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)] transition-colors group-hover:text-[var(--primary)]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>
              )}
          </>
        )}
      </ConfigSection>

      {!unsupported && (mcpDirty || mcpSuccess || mcpApplying) && (
        <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-[var(--hairline)] bg-[var(--surface-1)] py-4">
          {mcpDirty && !mcpSuccess && (
            <button
              type="button"
              onClick={onDiscardMcpChanges}
              disabled={mcpApplying}
              className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] px-3.5 text-[14px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={() => void onApplyMcpServers()}
            disabled={mcpApplying || mcpLoading || !!mcpError || mcpSuccess}
            className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--primary)] px-3.5 text-[14px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mcpSuccess ? (
              <Check className="h-4 w-4" />
            ) : mcpApplying ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {mcpSuccess
              ? "Saved"
              : mcpApplying
                ? "Saving..."
                : "Save MCP config"}
          </button>
        </div>
      )}
    </div>
  );
}

export function TeamConfigTabs(props: TeamConfigTabsProps) {
  const [activeTab, setActiveTab] = useState<MemberConfigTab>("config");
  const { selectedMember } = props;
  const dirtyNotice =
    props.memberDirty && props.mcpDirty
      ? "Unsaved project member and MCP changes"
      : props.memberDirty
        ? "Unsaved project member changes"
        : props.mcpDirty
          ? "Unsaved MCP changes"
          : null;
  const savedNotice =
    props.memberSuccess && props.mcpSuccess
      ? "Project member and MCP configuration saved"
      : props.memberSuccess
        ? "Project member configuration saved"
        : props.mcpSuccess
          ? "MCP configuration saved"
          : null;
  const statusNotice = dirtyNotice ?? savedNotice;
  const statusKind = dirtyNotice ? "dirty" : savedNotice ? "saved" : null;
  const tabItems = useMemo(
    () => [
      { id: "config" as const, label: "Config", icon: Settings },
      { id: "mcp" as const, label: "MCP Config", icon: Server },
    ],
    [],
  );

  if (!selectedMember) return <EmptyMemberState />;

  return (
    <div className="flex min-h-full flex-col bg-[var(--surface-1)]">
      <div className="sticky top-0 z-20 flex shrink-0 items-end justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--surface-1)] px-5">
        <div className="flex min-w-0 items-center gap-1">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={cx(
                  "relative inline-flex h-11 items-center gap-1.5 px-3 text-[13px] font-medium transition-colors focus-visible:outline-none",
                  active
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-subtle)] hover:text-[var(--ink)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
                <span
                  className={cx(
                    "absolute inset-x-2 -bottom-px h-[2px] rounded-full transition-colors",
                    active ? "bg-[var(--primary)]" : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>
        <div className="hidden min-w-0 items-center gap-2 pb-3 text-[13px] text-[var(--ink-subtle)] sm:flex">
          {statusNotice && (
            <span
              className={cx(
                "inline-flex min-w-0 items-center gap-1.5 text-[12px] font-medium",
                statusKind === "saved"
                  ? "text-[var(--success)]"
                  : "text-[var(--primary)]",
              )}
            >
              {statusKind === "saved" ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{statusNotice}</span>
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-5 py-5">
        {activeTab === "config" ? (
          <ConfigTab {...props} />
        ) : (
          <McpConfigTab
            mcpApplying={props.mcpApplying}
            configuredMcpServerKeys={props.configuredMcpServerKeys}
            mcpConfig={props.mcpConfig}
            mcpConfigPath={props.mcpConfigPath}
            mcpDirty={props.mcpDirty}
            mcpError={props.mcpError}
            mcpLoading={props.mcpLoading}
            mcpServersJson={props.mcpServersJson}
            mcpSuccess={props.mcpSuccess}
            onApplyMcpServers={props.onApplyMcpServers}
            onDiscardMcpChanges={props.onDiscardMcpChanges}
            onMcpServersChange={props.onMcpServersChange}
            onToggleMcpServer={props.onToggleMcpServer}
          />
        )}
      </div>
    </div>
  );
}
