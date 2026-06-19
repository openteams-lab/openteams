import React, { useMemo, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ResourceStateNotice } from '@/components/ResourceState';
import {
  DropdownSelect,
  type DropdownSelectOption,
} from '@/components/DropdownSelect';

export const DropdownsWorkspace: React.FC = () => {
  const {
    t,
    setSelectedStrategyId,
    selectedStrategyId,
    strategies,
    members,
    showToast,
    membersAsync,
    refreshMembers,
  } = useWorkspace();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['mem-1']);

  const strategyOptions = useMemo<DropdownSelectOption[]>(
    () =>
      strategies.map((strategy) => ({
        id: strategy.id,
        label: strategy.name,
        description: strategy.description,
        hint: strategy.recommended ? undefined : strategy.hint,
        group: strategy.recommended ? 'Auto' : 'Manual',
      })),
    [strategies],
  );

  const activeMembersInSession = members.slice(0, 2);
  const availableMembersInSession = members.slice(2);
  const memberOptions = useMemo<DropdownSelectOption[]>(
    () => [
      ...activeMembersInSession.map((member) => ({
        id: member.id,
        label: member.name,
        description: member.roleDetail,
        group: t('alreadyInSession'),
        leading: <MemberAvatar label={member.avatar} />,
      })),
      ...availableMembersInSession.map((member) => ({
        id: member.id,
        label: member.name,
        description: member.roleDetail,
        group: t('availableLabel'),
        leading: <MemberAvatar label={member.avatar} />,
      })),
    ],
    [activeMembersInSession, availableMembersInSession, t],
  );

  const activeStrategy = strategies.find(
    (strategy) => strategy.id === selectedStrategyId,
  );
  const strategyValue =
    selectedStrategyId || activeStrategy?.id || strategyOptions[0]?.id || '';

  const handleSelectStrategy = (
    id: string,
    option: DropdownSelectOption,
  ) => {
    setSelectedStrategyId(id);
    showToast(`Routing strategy changed to: ${option.label}`);
  };

  const handleSelectAgents = (
    values: string[],
    option: DropdownSelectOption,
  ) => {
    setSelectedAgentIds(values);
    const selectedLabel = values.includes(option.id) ? 'added' : 'removed';
    showToast(`Agent ${selectedLabel}: ${option.label}`);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-none leading-none">
      <div>
        <div className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-tertiary)]">
          Routing Strategy Options
        </div>
        <div className="relative flex min-h-[380px] flex-col gap-4 rounded-xl border border-[var(--hairline)] bg-[var(--surface-2)] p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-tertiary)]">
            {t('strategyTriggerLabel')}
          </div>
          <DropdownSelect
            value={strategyValue}
            options={strategyOptions}
            placeholder="No strategy"
            searchPlaceholder={t('selectStrategySearchPlaceholder')}
            triggerIcon={<RouteIcon />}
            defaultOpen
            onChange={handleSelectStrategy}
            footer={
              <>
                <span>arrows navigate</span>
                <span>esc close</span>
              </>
            }
          />
        </div>
      </div>

      <div>
        <div className="mb-2.5 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-tertiary)]">
          Active Core Agent Assignment
        </div>
        <div className="relative flex min-h-[380px] flex-col gap-4 rounded-xl border border-[var(--hairline)] bg-[var(--surface-2)] p-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-tertiary)]">
            {t('agentTriggerLabel')}
          </div>
          <ResourceStateNotice
            resource={membersAsync}
            labels={{
              loading: 'Loading agents...',
              empty: 'No agents are available.',
              error: 'Agents could not be refreshed.',
              fallback: 'Showing local agent fallback.',
            }}
            onRetry={() => void refreshMembers()}
            compact
          />
          <DropdownSelect
            selectionMode="multiple"
            values={selectedAgentIds}
            options={memberOptions}
            placeholder="Select agents"
            searchPlaceholder={t('agentSearchPlaceholder')}
            disabled={membersAsync.loading}
            defaultOpen
            onChange={handleSelectAgents}
            formatValueLabel={(selectedOptions) =>
              selectedOptions.length === 0
                ? 'Select agents'
                : selectedOptions.length === 1
                  ? selectedOptions[0].label
                  : `${selectedOptions.length} agents`
            }
            footer={
              <>
                <span>@ mention shortcut</span>
                <span>click toggles</span>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
};

const MemberAvatar = ({ label }: { label: string }) => (
  <span className="flex h-4.5 w-4.5 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] font-mono text-[8px]">
    {label}
  </span>
);

const RouteIcon = () => (
  <svg
    className="h-4 w-4 shrink-0 text-[var(--primary)]"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 4L9 7"
    />
  </svg>
);
