import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  FunnelIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { WorkflowGraphBoard } from './WorkflowGraphBoard';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

function parseTranscriptMeta(
  metaJson: string | null | undefined
): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type WorkflowCardStep = {
  id: string;
  step_key: string;
  title: string;
  step_type: string;
  status: string;
  agent_name?: string | null;
  summary_text?: string | null;
};

type WorkflowCardAgent = {
  session_agent_id: string;
  workflow_agent_session_id?: string | null;
  agent_id: string;
  name: string;
};

type WorkflowCardNode = {
  id: string;
  position: { x: number; y: number };
  data: {
    stepType: string;
    title: string;
    instructions: string;
    agentId?: string | null;
    status?: string | null;
  };
};

type WorkflowCardEdge = {
  id: string;
  source: string;
  target: string;
};

export type WorkflowWindowProjection = {
  execution_id?: string | null;
  plan_id?: string;
  title: string;
  goal: string;
  state: string;
  execution_status: string;
  error_message?: string | null;
  completed_step_count: number;
  total_step_count: number;
  result_summary?: string | null;
  outputs: string[];
  steps: WorkflowCardStep[];
  agents?: WorkflowCardAgent[];
  plan: {
    nodes: WorkflowCardNode[];
    edges: WorkflowCardEdge[];
    viewport?: { x?: number; y?: number; zoom?: number };
  };
  validation_errors?: string | null;
};

type WorkflowTranscriptEntry = {
  id: string;
  step_id?: string | null;
  step_key?: string | null;
  workflow_agent_session_id?: string | null;
  agent_name?: string | null;
  message_type: 'system' | 'agent' | 'user' | 'control';
  entry_type: string;
  content: string;
  meta_json?: string | null;
  created_at: string;
};

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

export type WorkflowWindowProps = {
  sessionId?: string | null;
  projection: WorkflowWindowProjection;
  transcript?: WorkflowTranscriptEntry[];
  isOpen: boolean;
  onClose: () => void;
  onExecute?: (planId: string) => void;
  onPauseAll?: (executionId: string) => void;
  onResume?: (executionId: string) => void;
  onInterruptStep?: (stepId: string) => void;
  onStopStep?: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  onSubmitStepInput?: (stepId: string, inputText: string) => void;
  onApproval?: (
    stepId: string,
    action: string,
    transcriptId: string,
    inputText?: string
  ) => void;
  pendingActionId?: string | null;
};

// -----------------------------------------------------------------------
// Agent Selector
// -----------------------------------------------------------------------

function AgentSelector({
  agents,
  selectedAgentId,
  onSelect,
}: {
  agents: WorkflowCardAgent[];
  selectedAgentId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = agents.find(
    (a) => (a.workflow_agent_session_id ?? a.session_agent_id) === selectedAgentId
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] transition-colors"
      >
        <FunnelIcon className="size-3.5" weight="bold" />
        {selected ? selected.name : 'All Agents'}
        <CaretDownIcon className="size-3" weight="bold" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 min-w-[160px] rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false); }}
            className={cn(
              'block w-full px-3 py-1.5 text-left text-xs hover:bg-[#F1F5F9]',
              !selectedAgentId && 'font-bold text-[#1D4ED8]'
            )}
          >
            All Agents
          </button>
          {agents.map((agent) => (
            <button
              type="button"
              key={agent.session_agent_id}
              onClick={() => {
                onSelect(agent.workflow_agent_session_id ?? agent.session_agent_id);
                setOpen(false);
              }}
              className={cn(
                'block w-full px-3 py-1.5 text-left text-xs hover:bg-[#F1F5F9]',
                selectedAgentId ===
                  (agent.workflow_agent_session_id ?? agent.session_agent_id) &&
                  'font-bold text-[#1D4ED8]'
              )}
            >
              {agent.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Approval Card
// -----------------------------------------------------------------------

export function ApprovalCard({
  title,
  description,
  stepId,
  transcriptId,
  onApprove,
  onReject,
  disabled,
}: {
  title: string;
  description?: string;
  stepId: string;
  transcriptId: string;
  onApprove: (stepId: string, transcriptId: string) => void;
  onReject: (stepId: string, transcriptId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#92400E]">
        Approval Required
      </div>
      <div className="mt-1 text-sm font-semibold text-[#0F172A]">{title}</div>
      {description && (
        <div className="mt-1 text-xs text-[#475569]">{description}</div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onApprove(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#16A34A] px-3 py-1 text-xs font-semibold text-white hover:bg-[#15803D] disabled:opacity-50 transition-colors"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onReject(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#DC2626] px-3 py-1 text-xs font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-50 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Permission Request Card
// -----------------------------------------------------------------------

export function PermissionRequestCard({
  title,
  description,
  stepId,
  transcriptId,
  onGrant,
  onDeny,
  disabled,
}: {
  title: string;
  description?: string;
  stepId: string;
  transcriptId: string;
  onGrant: (stepId: string, transcriptId: string) => void;
  onDeny: (stepId: string, transcriptId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#1E40AF]">
        Permission Request
      </div>
      <div className="mt-1 text-sm font-semibold text-[#0F172A]">{title}</div>
      {description && (
        <div className="mt-1 text-xs text-[#475569]">{description}</div>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onGrant(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#2563EB] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
        >
          Grant
        </button>
        <button
          type="button"
          onClick={() => onDeny(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full border border-[#CBD5E1] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F1F5F9] disabled:opacity-50 transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Continue Confirmation Card
// -----------------------------------------------------------------------

export function ContinueConfirmationCard({
  message,
  stepId,
  transcriptId,
  onContinue,
  disabled,
}: {
  message: string;
  stepId: string;
  transcriptId: string;
  onContinue: (stepId: string, transcriptId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#D1FAE5] bg-[#ECFDF5] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#15803D]">
        Continue?
      </div>
      <div className="mt-1 text-sm text-[#166534]">{message}</div>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => onContinue(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#16A34A] px-3 py-1 text-xs font-semibold text-white hover:bg-[#15803D] disabled:opacity-50 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export function InputRequestCard({
  prompt,
  description,
  placeholder,
  stepId,
  transcriptId,
  onSubmit,
  disabled,
}: {
  prompt: string;
  description?: string;
  placeholder?: string;
  stepId: string;
  transcriptId: string;
  onSubmit: (stepId: string, transcriptId: string, inputText: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [stepId]);

  const trimmedValue = value.trim();

  return (
    <div className="rounded-2xl border border-[#C7D2FE] bg-[#EEF2FF] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#4338CA]">
        Input Required
      </div>
      <div className="mt-1 text-sm font-semibold text-[#0F172A]">{prompt}</div>
      {description && (
        <div className="mt-1 text-xs text-[#475569]">{description}</div>
      )}
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder ?? 'Type your response here'}
        disabled={disabled}
        rows={4}
        className="mt-3 w-full resize-y rounded-xl border border-[#C7D2FE] bg-white px-3 py-2 text-xs text-[#0F172A] outline-none transition-colors placeholder:text-[#94A3B8] focus:border-[#818CF8] disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit(stepId, transcriptId, trimmedValue)}
          disabled={disabled || trimmedValue.length === 0}
          className="rounded-full bg-[#4F46E5] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#4338CA] disabled:opacity-50"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Workflow Window
// -----------------------------------------------------------------------

export function WorkflowWindow({
  sessionId,
  projection,
  transcript = [],
  isOpen,
  onClose,
  onExecute,
  onPauseAll,
  onResume,
  onInterruptStep,
  onStopStep,
  onRetryStep,
  onSubmitStepInput,
  onApproval,
  pendingActionId,
}: WorkflowWindowProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');

  const isPreview =
    projection.state === 'preview_ready' || projection.state === 'preview_invalid';
  const isRunning = projection.execution_status === 'running';
  const canResume =
    projection.execution_status === 'paused' || projection.execution_status === 'failed' || projection.state === 'pending';

  const agents = projection.agents ?? [];
  const leadAgentId =
    agents[0]?.workflow_agent_session_id ?? agents[0]?.session_agent_id ?? null;
  const agentSessionIdByName = useMemo(
    () =>
      new Map(
        agents.map((agent) => [
          agent.name,
          agent.workflow_agent_session_id ?? agent.session_agent_id,
        ])
      ),
    [agents]
  );
  const stepByKey = useMemo(
    () => new Map(projection.steps.map((step) => [step.step_key, step])),
    [projection.steps]
  );
  const orderedActionableSteps = useMemo(
    () =>
      [...projection.steps].sort((left, right) => {
        const priority = (status: string) => {
          switch (status) {
            case 'running':
              return 0;
            case 'waiting_input':
            case 'waiting_review':
              return 1;
            case 'failed':
              return 2;
            case 'ready':
              return 3;
            default:
              return 10;
          }
        };

        return priority(left.status) - priority(right.status);
      }),
    [projection.steps]
  );

  useEffect(() => {
    setSelectedStepId(orderedActionableSteps[0]?.step_key ?? null);
    setSelectedAgentId(
      orderedActionableSteps[0]?.agent_name
        ? agentSessionIdByName.get(orderedActionableSteps[0].agent_name) ?? leadAgentId
        : leadAgentId
    );
    setComposerValue('');
  }, [
    projection.execution_id,
    projection.plan_id,
    orderedActionableSteps,
    agentSessionIdByName,
    leadAgentId,
  ]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Filter transcript by selected agent/step
  const selectedStep = projection.steps.find((s) => s.step_key === selectedStepId);
  const effectiveAgentId =
    selectedAgentId ??
    (selectedStep?.agent_name
      ? agentSessionIdByName.get(selectedStep.agent_name) ?? null
      : null);

  useEffect(() => {
    if (!selectedStep?.agent_name) {
      return;
    }

    const nextAgentId = agentSessionIdByName.get(selectedStep.agent_name) ?? leadAgentId;
    if (nextAgentId && selectedAgentId !== nextAgentId) {
      setSelectedAgentId(nextAgentId);
    }
  }, [selectedStep?.agent_name, agentSessionIdByName, leadAgentId, selectedAgentId]);

  const { data: selectedStepTranscriptData, isFetching: isFetchingSelectedStepTranscript } =
    useQuery({
      queryKey: [
        'workflowStepTranscripts',
        sessionId,
        selectedStep?.id,
        effectiveAgentId,
      ],
      queryFn: () => {
        if (!sessionId || !selectedStep?.id) {
          return [];
        }

        return chatApi.getWorkflowStepTranscripts(sessionId, selectedStep.id, {
          stepKey: selectedStep.step_key,
          workflowAgentSessionId: effectiveAgentId,
        });
      },
      enabled: !!sessionId && !!selectedStep?.id && !isPreview && isOpen,
      refetchInterval:
        isOpen && !isPreview && !!sessionId && !!selectedStep?.id ? 5000 : false,
    });

  const fallbackTranscript = useMemo(() => {
    let entries = transcript;
    if (effectiveAgentId) {
      entries = entries.filter(
        (e) => e.workflow_agent_session_id === effectiveAgentId
      );
    }
    return entries;
  }, [transcript, effectiveAgentId]);

  const stepScopedTranscript = useMemo(() => {
    const entries = selectedStepTranscriptData ?? [];
    return entries.map((entry) => ({
      id: entry.id,
      step_id: entry.step_id,
      step_key: entry.step_key,
      workflow_agent_session_id: entry.workflow_agent_session_id,
      agent_name: entry.agent_name,
      message_type: entry.sender_type as 'system' | 'agent' | 'user' | 'control',
      content: entry.content,
      entry_type: entry.entry_type,
      meta_json: entry.meta_json,
      created_at: entry.created_at,
    }));
  }, [selectedStepTranscriptData]);

  const visibleTranscript = selectedStep ? stepScopedTranscript : fallbackTranscript;

  const handleSelectStep = useCallback(
    (id: string) => {
      setSelectedStepId((prev) => {
        const nextStepId = prev === id ? null : id;
        const nextStep = nextStepId ? stepByKey.get(nextStepId) : null;
        const nextAgentId = nextStep?.agent_name
          ? agentSessionIdByName.get(nextStep.agent_name) ?? leadAgentId
          : leadAgentId;
        setSelectedAgentId(nextAgentId);
        return nextStepId;
      });
    },
    [agentSessionIdByName, leadAgentId, stepByKey]
  );

  const selectedAgent = agents.find(
    (agent) =>
      (agent.workflow_agent_session_id ?? agent.session_agent_id) === effectiveAgentId
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/42 p-3 backdrop-blur-sm md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Workflow window: ${projection.title}`}
    >
      <div
        className="flex h-[min(92vh,880px)] w-full max-w-[1360px] flex-col overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(248,250,252,0.98)_100%)] shadow-[0_30px_100px_rgba(15,23,42,0.28)] backdrop-blur-xl dark:border-[#243041] dark:bg-[linear-gradient(180deg,rgba(11,16,23,0.96)_0%,rgba(15,23,42,0.94)_100%)] dark:shadow-[0_28px_100px_rgba(0,0,0,0.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-5 py-4 md:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#64748B]">
              Workflow Window
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="truncate text-lg font-semibold text-[#0F172A] dark:text-white">
                {projection.title}
              </div>
              <div className="rounded-full bg-[#EEF4FF] px-3 py-1 text-[11px] font-semibold text-[#1D4ED8]">
                {projection.completed_step_count}/{projection.total_step_count}
              </div>
            </div>
            <div className="mt-2 max-w-3xl text-sm leading-6 text-[#475569] dark:text-[#94A3B8]">
              {projection.goal}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/75 text-[#64748B] shadow-sm transition-colors hover:bg-white hover:text-[#0F172A] dark:border-[#2A3445] dark:bg-[rgba(25,34,51,0.82)] dark:text-[#94A3B8] dark:hover:text-white"
            aria-label="Close workflow window"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Two-pane body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Left pane: Graph */}
          <div className="w-full shrink-0 overflow-auto border-b border-[#E2E8F0] bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.45),rgba(248,250,252,0.8)_34%,rgba(248,250,252,1)_72%)] p-4 lg:basis-3/4 lg:border-b-0 lg:border-r lg:p-5 dark:border-[#243041] dark:bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),rgba(15,23,42,0.92)_38%,rgba(11,16,23,0.98)_78%)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#64748B] mb-3">
              Plan Graph
            </div>
            <WorkflowGraphBoard
                nodes={projection.plan.nodes}
                edges={projection.plan.edges}
                steps={projection.steps}
                selectedStepId={selectedStepId}
                onSelectStep={handleSelectStep}
                onRetryStep={onRetryStep}
              />

            <div className="mt-4 rounded-[22px] border border-white/70 bg-white/80 px-4 py-3 text-xs text-[#475569] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:border-[#243041] dark:bg-[rgba(15,23,42,0.78)] dark:text-[#CBD5E1]">
              {selectedStep ? (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#94A3B8]">
                      Focused Node
                    </div>
                    <div className="mt-1 text-sm font-semibold text-[#0F172A] dark:text-white">
                      {selectedStep.title}
                    </div>
                    <div className="mt-1 text-xs text-[#64748B] dark:text-[#94A3B8]">
                      {selectedStep.step_type}
                      {selectedStep.agent_name ? ` · ${selectedStep.agent_name}` : ''}
                    </div>
                    {selectedStep.summary_text && (
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#475569] dark:text-[#CBD5E1]">
                        {selectedStep.summary_text}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {isRunning && selectedStep.status === 'running' && onInterruptStep && (
                      <button
                        type="button"
                        onClick={() => onInterruptStep(selectedStep.id)}
                        className="flex items-center gap-1 rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[10px] font-semibold text-[#DC2626] transition-colors hover:bg-[#FECACA]"
                      >
                        <StopIcon className="size-3" weight="bold" />
                        Interrupt
                      </button>
                    )}
                    {selectedStep.status !== 'completed' &&
                      selectedStep.status !== 'cancelled' &&
                      onStopStep && (
                        <button
                          type="button"
                          onClick={() => onStopStep(selectedStep.id)}
                          className="flex items-center gap-1 rounded-full border border-[#FCA5A5] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#991B1B] transition-colors hover:bg-[#FEF2F2]"
                        >
                          <StopIcon className="size-3" weight="bold" />
                          Stop Step
                        </button>
                      )}
                  </div>
                </div>
              ) : (
                'Select a node to inspect its isolated execution feed.'
              )}
            </div>
          </div>

          {/* Right pane: Panel */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/70 lg:basis-1/4 dark:bg-transparent">
            {/* Preview mode */}
            {isPreview && (
              <div className="flex-1 overflow-auto p-5 md:p-6">
                <div className="max-w-3xl rounded-[24px] border border-white/70 bg-white/82 p-5 shadow-[0_18px_42px_rgba(148,163,184,0.16)] dark:border-[#2A3445] dark:bg-[rgba(15,23,42,0.78)] dark:shadow-none">
                  <div className="text-sm font-semibold text-[#0F172A] dark:text-white">
                    Plan Summary
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[#475569] dark:text-[#94A3B8]">
                    {projection.goal}
                  </div>

                  {projection.validation_errors && (
                    <div className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 dark:border-[#7F1D1D] dark:bg-[rgba(127,29,29,0.18)]">
                      <div className="text-xs font-bold uppercase tracking-wider text-[#991B1B] dark:text-[#FCA5A5]">
                        Validation Errors
                      </div>
                      <div className="mt-1 text-sm text-[#991B1B] dark:text-[#FECACA]">
                        {projection.validation_errors}
                      </div>
                    </div>
                  )}

                  {projection.state === 'preview_ready' && projection.plan_id && onExecute && (
                    <div className="mt-6">
                      <button
                        type="button"
                        onClick={() => onExecute(projection.plan_id!)}
                        className="flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
                      >
                        <PlayIcon className="size-4" weight="bold" />
                        Execute Plan
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Execution mode */}
            {!isPreview && (
              <>
                {/* Agent selector + controls bar */}
                <div className="flex items-center gap-2 border-b border-[#E2E8F0] px-5 py-3 dark:border-[#243041] md:px-6">
                  {agents.length > 0 && (
                    <AgentSelector
                      agents={agents}
                      selectedAgentId={selectedAgentId}
                      onSelect={setSelectedAgentId}
                    />
                  )}
                  <div className="min-w-0 flex-1 px-2">
                    <div className="truncate text-xs font-semibold text-[#0F172A] dark:text-white">
                      {selectedAgent?.name ?? 'Lead'} feed
                    </div>
                    <div className="truncate text-[10px] uppercase tracking-[0.16em] text-[#94A3B8]">
                      {selectedStep
                        ? `${selectedStep.title} · step scoped`
                        : 'Agent scoped execution feed'}
                    </div>
                  </div>
                  {isRunning && projection.execution_id && onPauseAll && (
                    <button
                      type="button"
                      onClick={() => onPauseAll(projection.execution_id!)}
                      className="flex items-center gap-1 rounded-full bg-[#D97706] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#B45309]"
                    >
                      <PauseIcon className="size-3.5" weight="bold" />
                      Pause All
                    </button>
                  )}
                  {canResume && projection.execution_id && onResume && (
                    <button
                      type="button"
                      onClick={() => onResume(projection.execution_id!)}
                      className="flex items-center gap-1 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1D4ED8]"
                    >
                      <PlayIcon className="size-3.5" weight="bold" />
                      Resume
                    </button>
                  )}
                </div>

                {/* Selected step info */}
                {selectedStep && (
                  <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 dark:border-[#243041] dark:bg-[rgba(15,23,42,0.7)] md:px-6">
                    <div className="text-xs font-bold text-[#334155] dark:text-white">
                      {selectedStep.title}
                    </div>
                    <div className="text-[10px] text-[#64748B] dark:text-[#94A3B8]">
                      {selectedStep.step_type} · {selectedStep.status}
                      {selectedStep.agent_name ? ` · ${selectedStep.agent_name}` : ''}
                    </div>
                    {selectedStep.summary_text && (
                      <div className="mt-1 text-xs text-[#475569] dark:text-[#CBD5E1]">
                        {selectedStep.summary_text}
                      </div>
                    )}
                  </div>
                )}

                {/* Transcript area */}
                <div className="flex-1 overflow-auto px-5 py-4 md:px-6">
                  {visibleTranscript.length === 0 ? (
                    <div className="flex h-full min-h-[240px] items-center justify-center rounded-[24px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-sm text-[#94A3B8] dark:border-[#334155] dark:bg-[rgba(15,23,42,0.45)]">
                      {isFetchingSelectedStepTranscript
                        ? 'Loading step transcript...'
                        : selectedStepId || selectedAgentId
                          ? 'No messages matching current isolation'
                          : 'Waiting for execution messages...'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleTranscript.map((entry) => {
                        if (entry.entry_type === 'approval_request') {
                          const meta = parseTranscriptMeta(entry.meta_json);
                          const resolved = meta?.resolved === true;
                          return (
                            <ApprovalCard
                              key={entry.id}
                              title={entry.content}
                              description={typeof meta?.description === 'string' ? meta.description : undefined}
                              stepId={entry.step_id ?? ''}
                              transcriptId={entry.id}
                              onApprove={(stepId, transcriptId) =>
                                onApproval?.(stepId, 'approved', transcriptId)
                              }
                              onReject={(stepId, transcriptId) =>
                                onApproval?.(stepId, 'rejected', transcriptId)
                              }
                              disabled={
                                !entry.step_id ||
                                resolved ||
                                !onApproval ||
                                pendingActionId === entry.id
                              }
                            />
                          );
                        }
                        if (entry.entry_type === 'permission_request') {
                          const meta = parseTranscriptMeta(entry.meta_json);
                          const resolved = meta?.resolved === true;
                          return (
                            <PermissionRequestCard
                              key={entry.id}
                              title={entry.content}
                              description={typeof meta?.description === 'string' ? meta.description : undefined}
                              stepId={entry.step_id ?? ''}
                              transcriptId={entry.id}
                              onGrant={(stepId, transcriptId) =>
                                onApproval?.(stepId, 'granted', transcriptId)
                              }
                              onDeny={(stepId, transcriptId) =>
                                onApproval?.(stepId, 'denied', transcriptId)
                              }
                              disabled={
                                !entry.step_id ||
                                resolved ||
                                !onApproval ||
                                pendingActionId === entry.id
                              }
                            />
                          );
                        }
                        if (entry.entry_type === 'continue_confirmation') {
                          const resolved =
                            parseTranscriptMeta(entry.meta_json)?.resolved === true;
                          return (
                            <ContinueConfirmationCard
                              key={entry.id}
                              message={entry.content}
                              stepId={entry.step_id ?? ''}
                              transcriptId={entry.id}
                              onContinue={(stepId, transcriptId) =>
                                onApproval?.(stepId, 'continued', transcriptId)
                              }
                              disabled={
                                !entry.step_id ||
                                resolved ||
                                !onApproval ||
                                pendingActionId === entry.id
                              }
                            />
                          );
                        }
                        if (entry.entry_type === 'input_request') {
                          const meta = parseTranscriptMeta(entry.meta_json);
                          const resolved = meta?.resolved === true;
                          return (
                            <InputRequestCard
                              key={entry.id}
                              prompt={entry.content}
                              description={
                                typeof meta?.description === 'string'
                                  ? meta.description
                                  : undefined
                              }
                              placeholder={
                                typeof meta?.placeholder === 'string'
                                  ? meta.placeholder
                                  : undefined
                              }
                              stepId={entry.step_id ?? ''}
                              transcriptId={entry.id}
                              onSubmit={(stepId, transcriptId, inputText) =>
                                onApproval?.(stepId, 'submitted', transcriptId, inputText)
                              }
                              disabled={
                                !entry.step_id ||
                                resolved ||
                                !onApproval ||
                                pendingActionId === entry.id
                              }
                            />
                          );
                        }
                        return (
                          <div
                            key={entry.id}
                            className={cn(
                              'rounded-[18px] border px-3 py-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]',
                              entry.message_type === 'system' &&
                                'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]',
                              entry.message_type === 'agent' &&
                                'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]',
                              entry.message_type === 'control' &&
                                'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]',
                              entry.message_type === 'user' &&
                                'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-current/75">
                                {entry.agent_name ?? entry.message_type}
                              </div>
                              <div className="text-[10px] uppercase tracking-[0.16em] text-current/60">
                                {entry.entry_type}
                              </div>
                            </div>
                            <div className="whitespace-pre-wrap leading-5">
                              {entry.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#E2E8F0] bg-white/90 px-5 py-3 dark:border-[#243041] dark:bg-[rgba(15,23,42,0.78)] md:px-6">
                  <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-[#94A3B8]">
                    {selectedStep
                      ? `Route input to ${selectedStep.title}`
                      : 'Select a step to route input'}
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      value={composerValue}
                      onChange={(event) => setComposerValue(event.target.value)}
                      placeholder={
                        selectedStep
                          ? 'Send step-scoped input or context'
                          : 'Pick a node before sending input'
                      }
                      rows={2}
                      disabled={!selectedStep || !onSubmitStepInput}
                      className="min-h-[54px] flex-1 resize-y rounded-2xl border border-[#CBD5E1] bg-white px-3 py-2 text-xs text-[#0F172A] outline-none transition-colors placeholder:text-[#94A3B8] focus:border-[#60A5FA] disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#94A3B8]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedStep || !onSubmitStepInput) {
                          return;
                        }
                        const nextValue = composerValue.trim();
                        if (!nextValue) {
                          return;
                        }
                        onSubmitStepInput(selectedStep.id, nextValue);
                        setComposerValue('');
                      }}
                      disabled={!selectedStep || !onSubmitStepInput || composerValue.trim().length === 0}
                      className="self-end rounded-full bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1E293B] disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>

                {/* Status bar */}
                <div className="border-t border-[#E2E8F0] bg-[#F8FAFC] px-5 py-3 text-xs text-[#64748B] dark:border-[#243041] dark:bg-[rgba(15,23,42,0.7)] dark:text-[#94A3B8] md:px-6">
                  {projection.completed_step_count}/{projection.total_step_count} steps completed
                  {projection.error_message && (
                    <span className="ml-2 text-[#DC2626]">{projection.error_message}</span>
                  )}
                  {projection.result_summary && (
                    <span className="ml-2 text-[#16A34A]">{projection.result_summary}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
