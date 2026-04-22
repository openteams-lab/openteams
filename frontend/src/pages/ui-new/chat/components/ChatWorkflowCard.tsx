import type { ChatMessage } from 'shared/types';
import { CheckCircleIcon, ClockIcon, PlayIcon, WarningCircleIcon, PauseIcon } from '@phosphor-icons/react';
import type { WorkflowCardData } from '@/lib/api';
import { WorkflowGraphBoard } from './WorkflowGraphBoard';

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

export type WorkflowCardProjection = WorkflowCardData;

type WorkflowCardProjectionInternal = {
  execution_id?: string | null;
  plan_id?: string;
  revision_id?: string;
  title: string;
  goal: string;
  state:
    | 'preview_ready'
    | 'preview_invalid'
    | 'pending'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'paused';
  execution_status: string;
  error_message?: string | null;
  completed_step_count: number;
  total_step_count: number;
  result_summary?: string | null;
  outputs: string[];
  steps: Array<{
    id: string;
    step_key: string;
    title: string;
    step_type: string;
    status: string;
    agent_name?: string | null;
    summary_text?: string | null;
  }>;
  agents?: Array<{
    session_agent_id: string;
    workflow_agent_session_id?: string | null;
    agent_id: string;
    name: string;
  }>;
  plan: {
    nodes: WorkflowCardNode[];
    edges: WorkflowCardEdge[];
    viewport?: { x?: number; y?: number; zoom?: number };
  };
  validation_errors?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function extractWorkflowCardProjection(
  meta: unknown
): WorkflowCardProjectionInternal | null {
  if (!isRecord(meta)) return null;

  // Support both workflow_execution (legacy) and workflow_plan (new preview) card types
  if (meta.card_type !== 'workflow_execution' && meta.card_type !== 'workflow_plan') {
    return null;
  }

  const workflowCard = meta.workflow_card;
  if (!isRecord(workflowCard)) {
    return null;
  }

  return workflowCard as unknown as WorkflowCardProjectionInternal;
}

type ChatWorkflowCardProps = {
  message: ChatMessage;
  projection?: WorkflowCardProjection | null;
  onExecute?: (planId: string) => void;
  onPauseAll?: (executionId: string) => void;
  onResume?: (executionId: string) => void;
  onOpenWindow?: () => void;
};

export function ChatWorkflowCard({
  message,
  projection: projectionProp,
  onExecute,
  onPauseAll,
  onResume,
  onOpenWindow,
}: ChatWorkflowCardProps) {
  const projection = projectionProp ?? extractWorkflowCardProjection(message.meta);
  if (!projection) {
    return null;
  }

  const isPreview = projection.state === 'preview_ready' || projection.state === 'preview_invalid';
  const isInvalid = projection.state === 'preview_invalid';

  const stateIcon =
    projection.state === 'completed' ? (
      <CheckCircleIcon className="size-icon-sm text-[#15803D]" weight="fill" />
    ) : projection.state === 'failed' || isInvalid ? (
      <WarningCircleIcon className="size-icon-sm text-[#DC2626]" weight="fill" />
    ) : projection.state === 'preview_ready' ? (
      <PlayIcon className="size-icon-sm text-[#D97706]" weight="fill" />
    ) : projection.state === 'paused' ? (
      <PauseIcon className="size-icon-sm text-[#D97706]" weight="fill" />
    ) : projection.state === 'waiting' ? (
      <WarningCircleIcon className="size-icon-sm text-[#7C3AED]" weight="fill" />
    ) : (
      <ClockIcon className="size-icon-sm text-[#2563EB]" weight="fill" />
    );

  const stateLabel =
    projection.state === 'completed'
      ? 'Work Item'
      : projection.state === 'failed'
        ? 'Execution Failed'
        : projection.state === 'preview_ready'
          ? 'Plan Ready'
          : projection.state === 'preview_invalid'
            ? 'Plan Invalid'
            : projection.state === 'waiting'
              ? 'Action Required'
            : projection.state === 'paused'
              ? 'Paused'
              : projection.state === 'pending'
                ? 'Preparing'
              : 'Workflow Running';

  return (
    <div className="w-full max-w-[760px] rounded-[28px] border border-[#D8E2F0] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#64748B]">
            {stateIcon}
            <span>{stateLabel}</span>
          </div>
          <div className="mt-2 text-[20px] font-semibold leading-tight text-[#0F172A]">
            {projection.title}
          </div>
          <div className="mt-2 text-sm leading-6 text-[#475569]">
            {projection.goal}
          </div>
        </div>
        <div className="flex items-center gap-2 self-start">
          <div className="rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-semibold text-[#1D4ED8]">
            {projection.completed_step_count}/{projection.total_step_count}
          </div>
        </div>
      </div>

      {/* Agent list (preview mode) */}
      {isPreview && projection.agents && projection.agents.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {projection.agents.map((agent) => (
            <span
              key={agent.session_agent_id}
              className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-medium text-[#475569]"
            >
              {agent.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4">
        <WorkflowGraphBoard
          nodes={projection.plan.nodes}
          edges={projection.plan.edges}
          steps={projection.steps}
          compact
        />
      </div>

      {/* Validation errors (preview_invalid) */}
      {isInvalid && projection.validation_errors && (
        <div className="mt-4 rounded-[24px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
          <div className="text-xs font-bold uppercase tracking-[0.16em]">Validation Errors</div>
          <div className="mt-1">{projection.validation_errors}</div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {onOpenWindow && (
          <button
            type="button"
            onClick={onOpenWindow}
            className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F1F5F9]"
          >
            Open
          </button>
        )}
        {projection.state === 'preview_ready' && projection.plan_id && onExecute && (
          <button
            type="button"
            onClick={() => onExecute(projection.plan_id!)}
            className="flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
          >
            <PlayIcon className="size-4" weight="bold" />
            Execute Plan
          </button>
        )}
        {projection.state === 'running' && projection.execution_id && onPauseAll && (
          <button
            type="button"
            onClick={() => onPauseAll(projection.execution_id!)}
            className="flex items-center gap-2 rounded-full bg-[#D97706] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B45309]"
          >
            <PauseIcon className="size-4" weight="bold" />
            Pause All
          </button>
        )}
        {(projection.state === 'paused' || projection.state === 'failed') &&
          projection.execution_id &&
          onResume && (
            <button
              type="button"
              onClick={() => onResume(projection.execution_id!)}
              className="flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
            >
              <PlayIcon className="size-4" weight="bold" />
              Resume
            </button>
          )}
      </div>

      {projection.state === 'completed' && (
        <div className="mt-4 rounded-[24px] border border-[#D1FAE5] bg-[#ECFDF5] p-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803D]">
            Final Delivery
          </div>
          {projection.result_summary && (
            <div className="mt-2 text-sm leading-6 text-[#166534]">
              {projection.result_summary}
            </div>
          )}
          {projection.outputs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {projection.outputs.map((output) => (
                <span
                  key={output}
                  className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-[#166534]"
                >
                  {output}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {projection.state === 'failed' && projection.error_message && (
        <div className="mt-4 rounded-[24px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
          {projection.error_message}
        </div>
      )}
    </div>
  );
}
