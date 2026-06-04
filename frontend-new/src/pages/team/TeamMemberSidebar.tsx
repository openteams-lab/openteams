import {
  Bot,
  Crown,
  Plus,
  Search,
  UserPlus,
  X,
  Check,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import type { BackendChatAgent } from "@/types";
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

function MemberRoleAvatar({ lead }: { lead: boolean }) {
  const Icon = lead ? Crown : Bot;
  const label = lead ? "Main agent" : "Work agent";
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

function MemberRunStateBadge({ state }: { state: MemberRunState }) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 font-mono text-[10px] font-semibold tracking-tight uppercase",
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
      {state}
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
  switchingLeadMemberId: string | null;
  onSelectMember: (memberId: string) => void;
  onSetLeadMember: (member: ProjectMemberWithExecution) => void;
  onAddMember?: (agentId: string) => void;
};

export function TeamMemberSidebar({
  agents,
  loading,
  members,
  saving,
  selectedMemberId,
  sessionAgentLookup,
  switchingLeadMemberId,
  onSelectMember,
  onSetLeadMember,
  onAddMember,
}: TeamMemberSidebarProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const availableAgents = useMemo(() => {
    const memberAgentIds = new Set(members.map((m) => m.agent_id).filter(Boolean));
    return agents.filter((a) => !memberAgentIds.has(a.id));
  }, [agents, members]);

  const filteredAgents = useMemo(() => {
    return availableAgents.filter((a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [availableAgents, searchQuery]);

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
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-4 py-3">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.05em] text-[var(--ink-tertiary)]">
          Project Members · {members.length}
        </h3>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={saving || availableAgents.length === 0}
            className={cx(
              "group flex h-7 w-7 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] transition-all hover:border-[var(--primary)]/40 hover:bg-[var(--surface-3)]",
              showAddMenu && "border-[var(--primary)] ring-2 ring-[var(--primary-tint)]"
            )}
            title="Add Project Member"
          >
            <Plus className={cx("h-4 w-4 text-[var(--ink-subtle)] transition-colors group-hover:text-[var(--primary)]", showAddMenu && "text-[var(--primary)]")} />
          </button>

          {showAddMenu && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-[240px] origin-top-right overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--surface-1)] shadow-2xl animate-fade-in-down">
              <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
                <Search className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Find agent..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-tertiary)] focus:outline-none"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto p-1.5 ot-scroll-area-styled">
                {filteredAgents.length === 0 ? (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[12px] text-[var(--ink-tertiary)]">No available agents</p>
                  </div>
                ) : (
                  filteredAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        onAddMember?.(agent.id);
                        setShowAddMenu(false);
                        setSearchQuery("");
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-3)] text-[var(--ink-subtle)]">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--ink)]">{agent.name}</p>
                        <p className="truncate text-[11px] text-[var(--ink-tertiary)]">{compactRunnerLabel(normalizeRunnerType(agent.runner_type))}</p>
                      </div>
                      <Plus className="h-3.5 w-3.5 text-[var(--ink-tertiary)]" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1 p-2 overflow-y-auto ot-scroll-area-styled">
        {members.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
              <UserPlus className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-[var(--ink)]">
              No project members
            </h3>
            <p className="mt-2 max-w-[200px] text-[13px] leading-relaxed text-[var(--ink-subtle)]">
              Add agents from your configuration as project members.
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
            const switchingLead = switchingLeadMemberId === member.id;

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
                  "group relative grid min-h-[64px] w-full cursor-pointer grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-all",
                  active
                    ? "bg-[var(--surface-2)] shadow-sm"
                    : "hover:bg-[var(--surface-2)]/50",
                )}
              >
                {active && (
                  <div className="absolute left-0 top-3 h-8 w-1 rounded-r-full bg-[var(--primary)]" />
                )}
                
                <MemberRoleAvatar lead={lead} />
                
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cx(
                      "truncate text-[14px] leading-tight transition-colors",
                      active ? "font-semibold text-[var(--ink)]" : "font-medium text-[var(--ink-muted)] group-hover:text-[var(--ink)]"
                    )}>
                      {memberName(member, agent)}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-[11px] tracking-tight text-[var(--ink-tertiary)]">
                      {compactRunnerLabel(runner)}
                    </span>
                    <MemberRunStateBadge state={runState} />
                  </div>
                </div>

                <div className="flex justify-end">
                  {!lead && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSetLeadMember(member);
                      }}
                      disabled={saving}
                      title="Set as Lead"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-tertiary)] opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:border-[var(--primary)]/40 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-0"
                    >
                      <Crown
                        className={cx(
                          "h-3.5 w-3.5",
                          switchingLead && "animate-pulse",
                        )}
                      />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
