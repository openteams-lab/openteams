import {
  Bot,
  Crown,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import type { BackendChatAgent, BaseCodingAgent } from "@/types";
import {
  compactRunnerLabel,
  cx,
  memberName,
  normalizeMemberRunState,
  normalizeRunnerType,
  type MemberRunState,
  type ProjectMemberWithExecution,
  type SessionAgentLookup,
} from "./teamUtils";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

function MemberRoleAvatar({
  lead,
  t,
}: {
  lead: boolean;
  t: TranslateFn;
}) {
  const Icon = lead ? Crown : Bot;
  const label = lead
    ? t("teamPage.sidebar.mainAgent")
    : t("teamPage.sidebar.workAgent");
  return (
    <span
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all",
        lead
          ? "border-[var(--primary)]/35 bg-[var(--primary-tint)] text-[var(--primary)]"
          : "border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)]",
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function MemberRunStateBadge({
  state,
  t,
}: {
  state: MemberRunState;
  t: TranslateFn;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 font-mono text-[10px] font-semibold tracking-tight uppercase",
        state === "idle" &&
          "border-[var(--hairline)] bg-[var(--surface-3)] text-[var(--ink-tertiary)]",
        state === "running" &&
          "border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]",
        state === "dead" && "border-red-500/20 bg-red-500/10 text-red-400",
      )}
    >
      <span
        className={cx(
          "h-1 w-1 rounded-full",
          state === "idle" && "bg-[var(--ink-tertiary)]",
          state === "running" && "bg-[var(--success)] animate-pulse",
          state === "dead" && "bg-red-500",
        )}
      />
      {t(`teamPage.state.${state}`)}
    </span>
  );
}

type TeamMemberSidebarProps = {
  agents: BackendChatAgent[];
  loading: boolean;
  members: ProjectMemberWithExecution[];
  saving: boolean;
  selectedMemberId: string;
  sessionAgentLookup: SessionAgentLookup;
  t: TranslateFn;
  onRemoveMember: (member: ProjectMemberWithExecution) => void;
  onSelectMember: (memberId: string) => void;
};

type TeamAddMemberButtonProps = {
  legacyAgents?: BackendChatAgent[];
  openRequestKey?: number;
  runtimeOptions?: TeamAddableRuntime[];
  saving: boolean;
  t: TranslateFn;
  onAddLegacyMember: (agentId: string) => void;
  onCreateMember: (runnerType: BaseCodingAgent) => void;
};

type TeamAddableRuntime = {
  label: string;
  modelName: string | null;
  runnerType: BaseCodingAgent;
};

export function TeamAddMemberButton({
  legacyAgents = [],
  openRequestKey,
  runtimeOptions = [],
  saving,
  t,
  onAddLegacyMember,
  onCreateMember,
}: TeamAddMemberButtonProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previousOpenRequestKeyRef = useRef(openRequestKey);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (openRequestKey === undefined) return;
    if (previousOpenRequestKeyRef.current === openRequestKey) return;

    previousOpenRequestKeyRef.current = openRequestKey;
    setSearchQuery("");
    setShowAddMenu(true);
  }, [openRequestKey]);

  useLayoutEffect(() => {
    if (!showAddMenu) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [showAddMenu, openRequestKey]);

  const filteredRuntimeOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return runtimeOptions;
    return runtimeOptions.filter((option) =>
      `${option.label} ${option.runnerType} ${option.modelName ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [runtimeOptions, searchQuery]);

  const filteredLegacyAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return legacyAgents;
    return legacyAgents.filter((agent) =>
      `${agent.name} ${agent.runner_type} ${agent.model_name ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [legacyAgents, searchQuery]);

  const hasAddOptions =
    filteredLegacyAgents.length > 0 || filteredRuntimeOptions.length > 0;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        data-command-id="team.member.add"
        onClick={() => setShowAddMenu((current) => !current)}
        disabled={saving}
        className={cx(
          "flex h-9 w-9 items-center justify-center rounded-[9px] bg-transparent text-[var(--ink)] transition-colors hover:text-[var(--primary-hover)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/35 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
          showAddMenu && "text-[var(--primary-hover)]",
        )}
        aria-label={t("teamPage.sidebar.addMember")}
        title={t("teamPage.sidebar.addMember")}
        data-tooltip-nowrap
      >
        <UserPlus
          aria-hidden="true"
          className="h-[17px] w-[17px]"
          strokeWidth={2.45}
        />
      </button>

      {showAddMenu && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[240px] origin-top-right overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-1)] shadow-2xl animate-fade-in-down">
          <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t("teamPage.sidebar.findAgent")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-tertiary)] focus:outline-none"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1.5 ot-scroll-area-styled">
            {!hasAddOptions ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[12px] text-[var(--ink-tertiary)]">
                  {t("teamPage.sidebar.noAvailableAgents")}
                </p>
              </div>
            ) : (
              <>
                {filteredLegacyAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onAddLegacyMember(agent.id);
                      setShowAddMenu(false);
                      setSearchQuery("");
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-3)] text-[var(--ink-subtle)]">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--ink)]">
                        {agent.name}
                      </p>
                      <p className="truncate text-[11px] text-[var(--ink-tertiary)]">
                        {compactRunnerLabel(
                          normalizeRunnerType(agent.runner_type),
                          t("teamPage.fallback.runtime"),
                        )}
                      </p>
                    </div>
                    <Plus className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                  </button>
                ))}

                {filteredRuntimeOptions.map((option) => (
                  <button
                    key={option.runnerType}
                    type="button"
                    onClick={() => {
                      onCreateMember(option.runnerType);
                      setShowAddMenu(false);
                      setSearchQuery("");
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary-tint)] text-[var(--primary-hover)]">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--ink)]">
                        {option.label}
                      </p>
                      <p className="truncate text-[11px] text-[var(--ink-tertiary)]">
                        {option.modelName ||
                          t("teamPage.options.runtimeDefault")}
                      </p>
                    </div>
                    <Plus className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TeamMemberSidebar({
  agents,
  loading,
  members,
  saving,
  selectedMemberId,
  sessionAgentLookup,
  t,
  onRemoveMember,
  onSelectMember,
}: TeamMemberSidebarProps) {
  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-[64px] animate-pulse rounded-[10px] bg-[var(--surface-2)]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1 p-2 overflow-y-auto ot-scroll-area-styled">
        {members.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
              <UserPlus className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-[var(--ink)]">
              {t("teamPage.sidebar.emptyTitle")}
            </h3>
            <p className="mt-2 max-w-[200px] text-[13px] leading-relaxed text-[var(--ink-subtle)]">
              {t("teamPage.sidebar.emptyDesc")}
            </p>
          </div>
        ) : (
          members.map((member) => {
            const agent = agents.find((item) => item.id === member.agent_id);
            const runner =
              member.execution_config?.runner_type ??
              normalizeRunnerType(agent?.runner_type);
            const active = selectedMemberId === member.id;
            const lead = member.role === "lead";
            const sessionAgent =
              sessionAgentLookup.byMemberId.get(member.id) ??
              (member.agent_id
                ? sessionAgentLookup.byAgentId.get(member.agent_id)
                : undefined);
            const runState = normalizeMemberRunState(sessionAgent?.state);

            return (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectMember(member.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectMember(member.id);
                  }
                }}
                className={cx(
                  "group relative grid min-h-[64px] w-full cursor-pointer grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 rounded-[7px] px-3 py-2.5 text-left transition-all",
                  active
                    ? "bg-[#f3eee3]/[0.045] text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur-[1px]"
                    : "hover:bg-white/[0.025]",
                )}
              >
                <MemberRoleAvatar lead={lead} t={t} />
                
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cx(
                      "truncate text-[14px] leading-tight transition-colors",
                      active ? "font-medium text-[var(--ink)]" : "font-medium text-[var(--ink-muted)] group-hover:text-[var(--ink)]"
                    )}>
                      {memberName(member, agent)}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[11px] tracking-tight text-[var(--ink-tertiary)]">
                      {compactRunnerLabel(
                        runner,
                        t("teamPage.fallback.runtime"),
                      )}
                    </span>
                    <MemberRunStateBadge state={runState} t={t} />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveMember(member);
                    }}
                    disabled={saving}
                    title={t("teamPage.sidebar.removeMember")}
                    aria-label={t("teamPage.sidebar.removeMember")}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-tertiary)] opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:border-red-500/35 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
