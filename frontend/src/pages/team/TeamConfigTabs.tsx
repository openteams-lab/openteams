import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CircleAlert,
  FileText,
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

type MemberConfigTab = "config" | "skills" | "mcp" | "teamProtocol";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

type TeamConfigTabsProps = {
  allowedSkillIds: string[];
  capability: AgentRuntimeReasoningCapability | null;
  configuredMcpServerKeys: string[];
  isLeader: boolean;
  memberName: string;
  memberNamePlaceholder: string;
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
  teamProtocolContent: string;
  teamProtocolDirty: boolean;
  teamProtocolError: string | null;
  teamProtocolLoading: boolean;
  teamProtocolSaving: boolean;
  teamProtocolSessionAvailable: boolean;
  teamProtocolSuccess: boolean;
  t: TranslateFn;
  workspacePath: string;
  onApplyMcpServers: () => void;
  onDiscardMemberChanges: () => void;
  onDiscardMcpChanges: () => void;
  onDiscardTeamProtocolChanges: () => void;
  onMcpServersChange: (value: string) => void;
  onSaveMember: () => void;
  onSaveTeamProtocol: () => void;
  onTeamProtocolChange: (value: string) => void;
  onToggleMcpServer: (serverKey: string) => void;
  setAllowedSkillIds: (ids: string[]) => void;
  setIsLeader: (value: boolean | ((current: boolean) => boolean)) => void;
  setMemberName: (value: string) => void;
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
        <h3 className="text-[17px] font-semibold leading-[1.2] text-[var(--ink)]">
          {title}
        </h3>
        {description && (
          <p className="mt-1 max-w-[680px] text-[13px] leading-[1.5] text-[var(--ink-subtle)]">
            {description}
          </p>
        )}
      </div>
      <div
        className={cx(
          "flex-1 space-y-6 rounded-[12px] bg-[var(--surface-3)] p-5",
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
        <p className="text-[13px] font-semibold leading-[1.35] text-[var(--ink)]">
          {title}
        </p>
        {description && (
          <p className="mt-1 text-[12px] leading-[1.5] text-[var(--ink-subtle)]">
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
        <p className="text-[13px] font-semibold leading-[1.35] text-[var(--ink)]">
          {title}
        </p>
        {description && (
          <p className="mt-1 text-[12px] leading-[1.5] text-[var(--ink-subtle)]">
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

function EmptyMemberState({ t }: { t: TranslateFn }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
        <UserRoundCog className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-[16px] font-medium text-[var(--ink)]">
        {t("teamPage.empty.noMemberTitle")}
      </h3>
      <p className="mt-2 max-w-[320px] text-[14px] leading-relaxed text-[var(--ink-subtle)]">
        {t("teamPage.empty.noMemberDesc")}
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
  t,
}: {
  allowedSkillIds: string[];
  skillLookup: BackendChatSkill[];
  skills: BackendChatSkill[];
  skillsError: string | null;
  skillsLoading: boolean;
  setAllowedSkillIds: (ids: string[]) => void;
  t: TranslateFn;
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
      <SkillSettingBlock title={t("teamPage.skills.addTitle")}>
        {selectedSkills.length === 0 ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            {t("teamPage.skills.noneAdded")}
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

      <SkillSettingBlock title={t("teamPage.skills.installedTitle")}>
        {skillsLoading ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            {t("teamPage.skills.loading")}
          </p>
        ) : skillsError ? (
          <p className="rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
            {skillsError}
          </p>
        ) : skills.length === 0 ? (
          <p className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-3 text-[14px] text-[var(--ink-subtle)]">
            {t("teamPage.skills.noneInstalled")}
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
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                        "flex min-h-[64px] min-w-0 cursor-pointer overflow-hidden rounded-[8px] border bg-[var(--surface-3)] p-2.5 text-left transition-colors",
                        selected
                          ? "border-[var(--primary)]/35 bg-[var(--primary-tint)]"
                          : "border-[var(--hairline)] hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-4)]",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-[var(--mono-border)] bg-[var(--mono-bg)] text-[var(--ink-muted)]">
                          <FolderGit2 className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--ink)]">
                            {skill.name}
                          </p>
                          <p className="mt-1 truncate text-[12px] leading-[1.35] text-[var(--ink-subtle)]">
                            {skill.description || t("teamPage.fallback.noDesc")}
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
                              "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border transition-colors",
                              selected
                                ? "border-[var(--primary)]/35 bg-[var(--primary-tint)] text-[var(--primary)]"
                                : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:text-[var(--ink)]",
                            )}
                            aria-label={
                              selected
                                ? t("teamPage.action.added")
                                : t("teamPage.action.add")
                            }
                          >
                            {selected ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <PackagePlus className="h-3.5 w-3.5" />
                            )}
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
                            aria-label={t("teamPage.aria.viewSkill", {
                              name: skill.name,
                            })}
                          >
                            <CircleAlert className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {detailSkill && (
              <SkillMarkdownPanel
                skill={detailSkill}
                onClose={() => setDetailSkillId(null)}
                t={t}
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
  t,
  onClose,
}: {
  skill: BackendChatSkill;
  t: TranslateFn;
  onClose: () => void;
}) {
  const tags = skill.tags ?? [];
  const triggerKeywords = skill.trigger_keywords ?? [];

  return (
    <div className="min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--ink)]">
            {skill.name}
          </p>
          <p className="mt-1 text-[12px] leading-[1.45] text-[var(--ink-subtle)]">
            {skill.description || t("teamPage.fallback.noDesc")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink)]"
          aria-label={t("teamPage.aria.closeSkill", { name: skill.name })}
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
      <div className="mt-4 max-h-[420px] overflow-auto rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-4 text-[12px] leading-relaxed text-[var(--ink-muted)] ot-scroll-area-styled">
        <AgentMarkdown
          content={skill.content || t("teamPage.fallback.noSkillContent")}
          fontSize={12}
        />
      </div>
    </div>
  );
}

function MemberSaveActions({
  dirty,
  onDiscardChanges,
  onSaveChanges,
  saving,
  success,
  t,
}: {
  dirty: boolean;
  onDiscardChanges: () => void;
  onSaveChanges: () => void;
  saving: boolean;
  success: boolean;
  t: TranslateFn;
}) {
  if (!dirty && !success && !saving) return null;

  return (
    <div className="flex justify-end gap-2">
      {dirty && !success && (
        <button
          type="button"
          onClick={onDiscardChanges}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("teamPage.action.discard")}
        </button>
      )}
      <button
        type="button"
        onClick={() => void onSaveChanges()}
        disabled={saving || success}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] bg-[var(--primary)] px-2.5 text-[12px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {success ? (
          <Check className="h-3.5 w-3.5" />
        ) : saving ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {success
          ? t("teamPage.action.saved")
          : saving
            ? t("teamPage.action.saving")
            : t("teamPage.action.saveChanges")}
      </button>
    </div>
  );
}

function McpSaveActions({
  mcpApplying,
  mcpDirty,
  mcpError,
  mcpLoading,
  mcpSuccess,
  onApplyMcpServers,
  onDiscardMcpChanges,
  t,
}: Pick<
  TeamConfigTabsProps,
  | "mcpApplying"
  | "mcpDirty"
  | "mcpError"
  | "mcpLoading"
  | "mcpSuccess"
  | "onApplyMcpServers"
  | "onDiscardMcpChanges"
  | "t"
>) {
  const unsupported = mcpError?.includes("support MCP") ?? false;

  if (unsupported || (!mcpDirty && !mcpSuccess && !mcpApplying)) return null;

  return (
    <div className="flex justify-end gap-2">
      {mcpDirty && !mcpSuccess && (
        <button
          type="button"
          onClick={onDiscardMcpChanges}
          disabled={mcpApplying}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("teamPage.action.discard")}
        </button>
      )}
      <button
        type="button"
        onClick={() => void onApplyMcpServers()}
        disabled={mcpApplying || mcpLoading || !!mcpError || mcpSuccess}
        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--primary)] px-2.5 text-[12px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mcpSuccess ? (
          <Check className="h-3.5 w-3.5" />
        ) : mcpApplying ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {mcpSuccess
          ? t("teamPage.action.saved")
          : mcpApplying
            ? t("teamPage.action.saving")
            : t("teamPage.action.saveMcpConfig")}
      </button>
    </div>
  );
}

function TeamProtocolSaveActions({
  onDiscardTeamProtocolChanges,
  onSaveTeamProtocol,
  t,
  teamProtocolDirty,
  teamProtocolError,
  teamProtocolLoading,
  teamProtocolSaving,
  teamProtocolSessionAvailable,
  teamProtocolSuccess,
}: Pick<
  TeamConfigTabsProps,
  | "onDiscardTeamProtocolChanges"
  | "onSaveTeamProtocol"
  | "t"
  | "teamProtocolDirty"
  | "teamProtocolError"
  | "teamProtocolLoading"
  | "teamProtocolSaving"
  | "teamProtocolSessionAvailable"
  | "teamProtocolSuccess"
>) {
  if (
    !teamProtocolSessionAvailable ||
    (!teamProtocolDirty && !teamProtocolSuccess && !teamProtocolSaving)
  ) {
    return null;
  }

  return (
    <div className="flex justify-end gap-2">
      {teamProtocolDirty && !teamProtocolSuccess && (
        <button
          type="button"
          onClick={onDiscardTeamProtocolChanges}
          disabled={teamProtocolSaving}
          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 text-[12px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("teamPage.action.discard")}
        </button>
      )}
      <button
        type="button"
        onClick={() => void onSaveTeamProtocol()}
        disabled={
          teamProtocolSaving ||
          teamProtocolLoading ||
          !!teamProtocolError ||
          teamProtocolSuccess
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--primary)] px-2.5 text-[12px] font-semibold text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {teamProtocolSuccess ? (
          <Check className="h-3.5 w-3.5" />
        ) : teamProtocolSaving ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        {teamProtocolSuccess
          ? t("teamPage.action.saved")
          : teamProtocolSaving
            ? t("teamPage.action.saving")
            : t("teamPage.action.saveTeamProtocol")}
      </button>
    </div>
  );
}

function ConfigTab({
  capability,
  isLeader,
  modelOptions,
  reasoningOptions,
  roleDefinition,
  runnerType,
  runtimeOptions,
  selectedModelValue,
  selectedReasoningValue,
  workspacePath,
  setIsLeader,
  setMemberName,
  setModelName,
  setModelVariant,
  setRoleDefinition,
  setRunnerType,
  setThinkingEffort,
  setWorkspacePath,
  t,
  memberName,
  memberNamePlaceholder,
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
  | "teamProtocolContent"
  | "teamProtocolDirty"
  | "teamProtocolError"
  | "teamProtocolLoading"
  | "teamProtocolSaving"
  | "teamProtocolSessionAvailable"
  | "teamProtocolSuccess"
  | "onDiscardTeamProtocolChanges"
  | "onSaveTeamProtocol"
  | "onTeamProtocolChange"
  | "memberDirty"
  | "memberSuccess"
  | "onDiscardMemberChanges"
  | "onSaveMember"
  | "saving"
  | "selectedMember"
  | "allowedSkillIds"
  | "setAllowedSkillIds"
  | "skillLookup"
  | "skills"
  | "skillsError"
  | "skillsLoading"
>) {
  return (
    <div className="space-y-0">
      <div
        className="grid items-stretch gap-6 pb-4"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 520px), 1fr))",
        }}
      >
        <ConfigSection
          title={t("teamPage.config.title")}
          description={t("teamPage.config.desc")}
          className="!pb-0"
          bodyClassName="space-y-4 p-4"
        >
          <SettingRow
            title={t("teamPage.form.memberName")}
            description={t("teamPage.form.memberNameDesc")}
          >
            <input
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              placeholder={memberNamePlaceholder}
              className={inputClassName}
            />
          </SettingRow>

          <SettingRow
            title={t("teamPage.form.runtime")}
            description={t("teamPage.form.runtimeDesc")}
          >
            <DropdownSelect
              value={runnerType}
              options={runtimeOptions}
              searchPlaceholder={t("teamPage.search.runtimes")}
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
            title={t("teamPage.form.model")}
            description={t("teamPage.form.modelDesc")}
          >
            <DropdownSelect
              value={selectedModelValue}
              options={modelOptions}
              searchPlaceholder={t("teamPage.search.models")}
              className="[&>button]:h-10 [&>button]:bg-[var(--surface-3)] [&>button]:font-mono [&>button]:text-[13px]"
              onChange={(value) =>
                setModelName(value === defaultOptionId ? "" : value)
              }
            />
          </SettingRow>

          <SettingRow
            title={t("teamPage.form.reasoning")}
            description={t("teamPage.form.reasoningDesc")}
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
            title={t("teamPage.form.workspacePath")}
            description={t("teamPage.form.workspacePathDesc")}
          >
            <input
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder={t("teamPage.placeholder.workspacePath")}
              className={inputClassName}
            />
          </SettingRow>

          <SettingRow
            title={t("teamPage.form.mainAgent")}
            description={t("teamPage.form.mainAgentDesc")}
          >
            <button
              type="button"
              onClick={() => setIsLeader((value) => !value)}
              aria-label={t("teamPage.aria.toggleMainAgent")}
              aria-pressed={isLeader}
              className={cx(
                "relative h-6 w-11 rounded-full border transition-colors",
                isLeader
                  ? "border-[var(--primary)] bg-[var(--primary)]"
                  : "border-[var(--hairline-strong)] bg-[var(--surface-3)]",
              )}
            >
              <span
                className={cx(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                  isLeader ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </SettingRow>
        </ConfigSection>

        <ConfigSection
          title={t("teamPage.systemPrompt.title")}
          description={t("teamPage.systemPrompt.desc")}
          className="!pb-0"
          bodyClassName="!p-0"
        >
          <textarea
            value={roleDefinition}
            onChange={(event) => setRoleDefinition(event.target.value)}
            spellCheck={false}
            placeholder={t("teamPage.systemPrompt.placeholder")}
            className="block h-full min-h-[360px] w-full resize-none overflow-y-auto rounded-[12px] border-0 bg-[var(--surface-3)] px-5 py-5 font-mono text-[14px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] placeholder:opacity-100 focus:ring-2 focus:ring-[var(--primary-focus)]/50"
          />
        </ConfigSection>
      </div>
    </div>
  );
}

function SkillsTab({
  allowedSkillIds,
  setAllowedSkillIds,
  skillLookup,
  skills,
  skillsError,
  skillsLoading,
  t,
}: Pick<
  TeamConfigTabsProps,
  | "allowedSkillIds"
  | "setAllowedSkillIds"
  | "skillLookup"
  | "skills"
  | "skillsError"
  | "skillsLoading"
  | "t"
>) {
  return (
    <div className="space-y-0">
      <ConfigSection
        title={t("teamPage.skills.title")}
        description={t("teamPage.skills.desc")}
      >
        <SkillsSection
          allowedSkillIds={allowedSkillIds}
          skillLookup={skillLookup}
          skills={skills}
          skillsError={skillsError}
          skillsLoading={skillsLoading}
          setAllowedSkillIds={setAllowedSkillIds}
          t={t}
        />
      </ConfigSection>
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
  mcpConfig,
  mcpConfigPath,
  mcpError,
  mcpLoading,
  mcpServersJson,
  onMcpServersChange,
  onToggleMcpServer,
  t,
}: Pick<
  TeamConfigTabsProps,
  | "configuredMcpServerKeys"
  | "mcpConfig"
  | "mcpConfigPath"
  | "mcpError"
  | "mcpLoading"
  | "mcpServersJson"
  | "onMcpServersChange"
  | "onToggleMcpServer"
  | "t"
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
          {t("teamPage.mcp.error", { error: mcpError })}
        </div>
      )}

      <ConfigSection
        title={t("teamPage.mcp.title")}
        description={t("teamPage.mcp.desc")}
      >
        {unsupported ? (
          <div className="m-4 rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-4 text-[14px] leading-[1.5] text-amber-300">
            <p className="font-medium">{t("teamPage.mcp.unsupported")}</p>
            <p className="mt-1 text-[13px]">{mcpError}</p>
          </div>
        ) : (
          <>
            <SettingRow
              title={t("teamPage.mcp.serverConfig")}
              description={
                mcpLoading
                  ? t("teamPage.mcp.loadingCurrent")
                  : t("teamPage.mcp.savedToFile")
              }
            >
              <textarea
                value={
                  mcpLoading
                    ? t("teamPage.mcp.loadingTextarea")
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
                  title={t("teamPage.mcp.builtinTitle")}
                  description={t("teamPage.mcp.builtinDesc")}
                >
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(servers).map(([key]) => {
                      const metaObj = meta[key] ?? {};
                      const name = metaObj.name || key;
                      const description =
                        metaObj.description || t("teamPage.fallback.noDesc");
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
    </div>
  );
}

function TeamProtocolTab({
  onTeamProtocolChange,
  t,
  teamProtocolContent,
  teamProtocolError,
  teamProtocolLoading,
  teamProtocolSessionAvailable,
}: Pick<
  TeamConfigTabsProps,
  | "onTeamProtocolChange"
  | "t"
  | "teamProtocolContent"
  | "teamProtocolError"
  | "teamProtocolLoading"
  | "teamProtocolSessionAvailable"
>) {
  return (
    <div className="space-y-6">
      {teamProtocolError && (
        <div className="rounded-[8px] border border-red-500/20 bg-red-500/10 p-3 text-[14px] text-red-400">
          {t("teamPage.teamProtocol.error", { error: teamProtocolError })}
        </div>
      )}

      {!teamProtocolSessionAvailable && (
        <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/10 p-4 text-[14px] leading-[1.5] text-amber-300">
          {t("teamPage.teamProtocol.noSession")}
        </div>
      )}

      <ConfigSection
        title={t("teamPage.teamProtocol.title")}
        description={t("teamPage.teamProtocol.desc")}
        bodyClassName="!p-0"
      >
        <textarea
          value={
            teamProtocolLoading
              ? t("teamPage.teamProtocol.loading")
              : teamProtocolContent
          }
          onChange={(event) => onTeamProtocolChange(event.target.value)}
          disabled={teamProtocolLoading || !teamProtocolSessionAvailable}
          spellCheck={false}
          placeholder={t("teamPage.teamProtocol.placeholder")}
          className="block h-full min-h-[480px] w-full resize-none overflow-y-auto rounded-[12px] border-0 bg-[var(--surface-3)] px-5 py-5 font-mono text-[14px] leading-relaxed text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-muted)] placeholder:opacity-100 focus:ring-2 focus:ring-[var(--primary-focus)]/50 disabled:opacity-70"
        />
      </ConfigSection>
    </div>
  );
}

export function TeamConfigTabs(props: TeamConfigTabsProps) {
  const [activeTab, setActiveTab] = useState<MemberConfigTab>("config");
  const { selectedMember, t } = props;
  const dirtyNotice =
    props.teamProtocolDirty
      ? t("teamPage.notice.unsavedTeamProtocol")
      : props.memberDirty && props.mcpDirty
        ? t("teamPage.notice.unsavedBoth")
        : props.memberDirty
          ? t("teamPage.notice.unsavedMember")
          : props.mcpDirty
            ? t("teamPage.notice.unsavedMcp")
            : null;
  const savedNotice =
    props.teamProtocolSuccess
      ? t("teamPage.notice.savedTeamProtocol")
      : props.memberSuccess && props.mcpSuccess
        ? t("teamPage.notice.savedBoth")
        : props.memberSuccess
          ? t("teamPage.notice.savedMember")
          : props.mcpSuccess
            ? t("teamPage.notice.savedMcp")
            : null;
  const statusNotice = dirtyNotice ?? savedNotice;
  const statusKind = dirtyNotice ? "dirty" : savedNotice ? "saved" : null;
  const tabItems = useMemo(
    () => [
      {
        id: "config" as const,
        label: t("teamPage.tabs.config"),
        icon: Settings,
      },
      {
        id: "skills" as const,
        label: t("teamPage.tabs.skills"),
        icon: FolderGit2,
      },
      { id: "mcp" as const, label: t("teamPage.tabs.mcp"), icon: Server },
      {
        id: "teamProtocol" as const,
        label: t("teamPage.tabs.teamProtocol"),
        icon: FileText,
      },
    ],
    [t],
  );
  const isMcpUnsupported = props.mcpError?.includes("support MCP") ?? false;
  const shouldShowMemberActions =
    props.memberDirty || props.memberSuccess || props.saving;
  const shouldShowMcpActions =
    !isMcpUnsupported &&
    (props.mcpDirty || props.mcpSuccess || props.mcpApplying);
  const shouldShowTeamProtocolActions =
    props.teamProtocolSessionAvailable &&
    (props.teamProtocolDirty ||
      props.teamProtocolSuccess ||
      props.teamProtocolSaving);
  const shouldShowActionFooter =
    activeTab === "mcp"
      ? shouldShowMcpActions
      : activeTab === "teamProtocol"
        ? shouldShowTeamProtocolActions
        : shouldShowMemberActions;

  if (!selectedMember) return <EmptyMemberState t={t} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-2)]">
      <div className="sticky top-0 z-20 flex shrink-0 items-end justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--surface-2)] px-5">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 ot-scroll-area-styled">
        {activeTab === "config" ? (
          <ConfigTab {...props} />
        ) : activeTab === "skills" ? (
          <SkillsTab
            allowedSkillIds={props.allowedSkillIds}
            skillLookup={props.skillLookup}
            skills={props.skills}
            skillsError={props.skillsError}
            skillsLoading={props.skillsLoading}
            setAllowedSkillIds={props.setAllowedSkillIds}
            t={t}
          />
        ) : activeTab === "mcp" ? (
          <McpConfigTab
            configuredMcpServerKeys={props.configuredMcpServerKeys}
            mcpConfig={props.mcpConfig}
            mcpConfigPath={props.mcpConfigPath}
            mcpError={props.mcpError}
            mcpLoading={props.mcpLoading}
            mcpServersJson={props.mcpServersJson}
            onMcpServersChange={props.onMcpServersChange}
            onToggleMcpServer={props.onToggleMcpServer}
            t={t}
          />
        ) : (
          <TeamProtocolTab
            teamProtocolContent={props.teamProtocolContent}
            teamProtocolError={props.teamProtocolError}
            teamProtocolLoading={props.teamProtocolLoading}
            teamProtocolSessionAvailable={
              props.teamProtocolSessionAvailable
            }
            onTeamProtocolChange={props.onTeamProtocolChange}
            t={t}
          />
        )}
      </div>
      {shouldShowActionFooter && (
        <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-2">
          {activeTab === "mcp" ? (
            <McpSaveActions
              mcpApplying={props.mcpApplying}
              mcpDirty={props.mcpDirty}
              mcpError={props.mcpError}
              mcpLoading={props.mcpLoading}
              mcpSuccess={props.mcpSuccess}
              onApplyMcpServers={props.onApplyMcpServers}
              onDiscardMcpChanges={props.onDiscardMcpChanges}
              t={t}
            />
          ) : activeTab === "teamProtocol" ? (
            <TeamProtocolSaveActions
              teamProtocolDirty={props.teamProtocolDirty}
              teamProtocolError={props.teamProtocolError}
              teamProtocolLoading={props.teamProtocolLoading}
              teamProtocolSaving={props.teamProtocolSaving}
              teamProtocolSessionAvailable={props.teamProtocolSessionAvailable}
              teamProtocolSuccess={props.teamProtocolSuccess}
              onDiscardTeamProtocolChanges={
                props.onDiscardTeamProtocolChanges
              }
              onSaveTeamProtocol={props.onSaveTeamProtocol}
              t={t}
            />
          ) : (
            <MemberSaveActions
              dirty={props.memberDirty}
              saving={props.saving}
              success={props.memberSuccess}
              onDiscardChanges={props.onDiscardMemberChanges}
              onSaveChanges={props.onSaveMember}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}
