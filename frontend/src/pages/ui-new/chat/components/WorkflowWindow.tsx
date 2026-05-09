import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  Play,
  Pause,
  Square,
  Bell,
  X,
  Send,
  AlertCircle,
  Loader2,
  MessageSquare,
  FileText,
  ScrollText,
  Bot,
  RotateCcw,
  Ban,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowCardData } from '@/lib/api';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { WorkflowIterationFeedbackCard } from './WorkflowIterationFeedbackCard';
import { WorkflowGraphBoard } from './WorkflowGraphBoard';
import {
  workflowLatestReviewFeedback,
  workflowLatestReviewLabel,
  workflowReviewPhaseMeta,
  workflowStatusLabel,
} from './workflowStepPresentation';
import {
  parseWorkflowTranscriptMeta,
  toWorkflowFinalReviewAction,
} from './WorkflowFinalReviewCard';
import {
  canPauseWorkflowExecution,
  canResumeWorkflowExecution,
  isRetryableWorkflowStepStatus,
  isWorkflowExecutionRecompiling,
} from './workflowControlContract';

type WorkflowCardStep = WorkflowCardData['steps'][number];

export type WorkflowWindowProjection = WorkflowCardData;

type WorkflowTranscriptEntry = {
  id: string;
  round_id?: string | null;
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

type WorkflowRuntimeMessage = {
  id: string;
  executionId: string;
  workflowAgentSessionId: string | null;
  stepId: string;
  stepKey: string;
  agentId: string;
  agentName: string;
  streamType: 'assistant' | 'thinking' | 'error';
  content: string;
  createdAt: string;
};

type ExecutionRecordTab = 'DETAILS' | 'LOGS';

type WorkflowTranscriptSummaryPayload = {
  summary?: string;
  content?: string;
  outputs?: string[];
};

const WORKFLOW_TERMINAL_STEP_STATUSES = new Set([
  'completed',
  'failed',
  'interrupted',
  'skipped',
  'cancelled',
]);

const WORKFLOW_FAILURE_STEP_STATUSES = new Set([
  'failed',
  'interrupted',
  'cancelled',
]);
const REVIEW_READY_STEP_STATUSES = new Set([
  'completed',
  'skipped',
  'cancelled',
]);

function parseWorkflowTranscriptTime(createdAt: string): Date {
  const trimmed = createdAt.trim();
  const normalized =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed;

  return new Date(normalized);
}

function formatWorkflowLogTimestamp(createdAt: string): string {
  const date = parseWorkflowTranscriptTime(createdAt);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function mergeAndSortTranscriptEntries(
  primary: WorkflowTranscriptEntry[],
  secondary: WorkflowTranscriptEntry[]
): WorkflowTranscriptEntry[] {
  const mergedMap = new Map<string, WorkflowTranscriptEntry>();

  for (const entry of primary) {
    mergedMap.set(entry.id, entry);
  }
  for (const entry of secondary) {
    mergedMap.set(entry.id, entry);
  }

  return [...mergedMap.values()].sort((left, right) => {
    const leftAt = parseWorkflowTranscriptTime(left.created_at).getTime();
    const rightAt = parseWorkflowTranscriptTime(right.created_at).getTime();
    return (
      (Number.isNaN(leftAt) ? 0 : leftAt) -
      (Number.isNaN(rightAt) ? 0 : rightAt)
    );
  });
}

function parseTranscriptSummaryPayload(
  metaJson: string | null | undefined
): WorkflowTranscriptSummaryPayload | null {
  if (!metaJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metaJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    return {
      summary:
        typeof payload.summary === 'string' ? payload.summary : undefined,
      content:
        typeof payload.content === 'string' ? payload.content : undefined,
      outputs: Array.isArray(payload.outputs)
        ? payload.outputs.filter(
            (item): item is string => typeof item === 'string'
          )
        : undefined,
    };
  } catch {
    return null;
  }
}

function getTranscriptMarkdown(entry: WorkflowTranscriptEntry): string | null {
  const payload = parseTranscriptSummaryPayload(entry.meta_json);
  if (payload?.content) {
    const content = payload.content.trim();
    return content.length > 0 ? content : null;
  }

  if (
    (entry.entry_type === 'message' && entry.message_type === 'agent') ||
    entry.entry_type === 'error' ||
    entry.entry_type === 'lead_review'
  ) {
    const content = entry.content.trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

function getTranscriptMetaSource(entry: WorkflowTranscriptEntry): string | null {
  if (!entry.meta_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(entry.meta_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const source = (parsed as Record<string, unknown>).source;
    return typeof source === 'string' ? source : null;
  } catch {
    return null;
  }
}

function isWorkflowCardStepContentEntry(entry: WorkflowTranscriptEntry): boolean {
  return getTranscriptMetaSource(entry) === 'workflow_card_step_content';
}

function isWorkflowRuntimeThinkingEntry(entry: WorkflowTranscriptEntry): boolean {
  return (
    entry.entry_type === 'thinking' &&
    getTranscriptMetaSource(entry) === 'workflow_runtime_stream'
  );
}

function getWorkflowOutputEntryLabel(entry: WorkflowTranscriptEntry): string {
  if (isWorkflowCardStepContentEntry(entry)) {
    return 'final output';
  }
  return entry.entry_type;
}

function getWorkflowOutputEntryIcon(
  entry: WorkflowTranscriptEntry
): LucideIcon {
  if (isWorkflowCardStepContentEntry(entry) || entry.entry_type === 'output') {
    return FileText;
  }
  if (entry.entry_type === 'error') {
    return AlertCircle;
  }
  if (entry.message_type === 'agent') {
    return Bot;
  }
  if (entry.message_type === 'user') {
    return Send;
  }
  if (entry.message_type === 'system' || entry.message_type === 'control') {
    return ScrollText;
  }
  return MessageSquare;
}

function getWorkflowOutputEntryIconClass(entry: WorkflowTranscriptEntry): string {
  if (isWorkflowCardStepContentEntry(entry) || entry.entry_type === 'output') {
    return 'bg-blue-50 text-blue-600 border-blue-100';
  }
  if (entry.entry_type === 'error') {
    return 'bg-red-50 text-red-600 border-red-100';
  }
  if (entry.message_type === 'agent') {
    return 'bg-indigo-50 text-indigo-600 border-indigo-100';
  }
  if (entry.message_type === 'user') {
    return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  }
  if (entry.message_type === 'system' || entry.message_type === 'control') {
    return 'bg-amber-50 text-amber-600 border-amber-100';
  }
  return 'bg-slate-50 text-slate-500 border-slate-200';
}

function hasAgentTranscriptMessageForStep(
  entries: WorkflowTranscriptEntry[],
  stepId?: string | null,
  stepKey?: string | null
): boolean {
  return entries.some(
    (entry) =>
      entry.message_type === 'agent' &&
      entry.entry_type === 'message' &&
      ((stepId && entry.step_id === stepId) ||
        (stepKey && entry.step_key === stepKey))
  );
}

function buildStepContentTranscriptEntries(
  steps: WorkflowCardStep[],
  existingEntries: WorkflowTranscriptEntry[],
  resolveStepAgentSessionId: (step?: WorkflowCardStep | null) => string | null,
  selectedWorkflowAgentSessionId?: string | null
): WorkflowTranscriptEntry[] {
  let offset = 1;

  return steps
    .filter((step) => step.content?.trim())
    .filter((step) => {
      const workflowAgentSessionId = resolveStepAgentSessionId(step);
      if (!selectedWorkflowAgentSessionId) {
        return true;
      }
      return workflowAgentSessionId === selectedWorkflowAgentSessionId;
    })
    .filter(
      (step) =>
        !hasAgentTranscriptMessageForStep(
          existingEntries,
          step.id,
          step.step_key
        )
    )
    .map((step) => {
      const relatedEntries = existingEntries.filter(
        (entry) => entry.step_id === step.id || entry.step_key === step.step_key
      );
      const latestRelatedTimestamp = Math.max(
        ...relatedEntries.map((entry) => Date.parse(entry.created_at)),
        ...existingEntries.map((entry) => Date.parse(entry.created_at)),
        Date.now()
      );
      const createdAt = new Date(
        (Number.isFinite(latestRelatedTimestamp)
          ? latestRelatedTimestamp
          : Date.now()) + offset
      ).toISOString();
      offset += 1;

      return {
        id: `step-content-${step.id}`,
        step_id: step.id,
        step_key: step.step_key,
        workflow_agent_session_id: resolveStepAgentSessionId(step),
        agent_name: step.agent_name,
        message_type: 'agent' as const,
        entry_type: 'output',
        content: step.content!.trim(),
        meta_json: JSON.stringify({
          source: 'workflow_card_step_content',
        }),
        created_at: createdAt,
      };
    });
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

export type WorkflowWindowProps = {
  sessionId?: string | null;
  projection: WorkflowWindowProjection;
  transcript?: WorkflowTranscriptEntry[];
  runtimeMessages?: WorkflowRuntimeMessage[];
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
  onResolveFinalReview?: (
    executionId: string,
    transcriptId: string,
    action: 'accepted' | 'rejected'
  ) => void;
  onRespondPendingReview?: (
    reviewId: string,
    action: 'approve' | 'reject',
    feedback?: string
  ) => void;
  onSubmitIterationFeedback?: (payload: {
    executionId: string;
    action: 'accept' | 'reject';
    feedback?: {
      what_wrong: string;
      expected: string;
      priority: 'high' | 'medium' | 'low';
      additional_notes?: string;
    };
  }) => void;
  pendingActionId?: string | null;
};

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
// Inspector Card (side drawer)
// -----------------------------------------------------------------------

function InspectorCard({
  step,
  planNode,
  agentName,
  loop,
  reviewPhase,
  latestReviewLabel,
  latestReviewFeedback,
  onClose,
  onOpenChat,
  isChatVisible,
  onInterruptStep,
  onStopStep,
  onRetryStep,
  pendingActionId,
  transcriptEntries,
  isLoadingTranscript,
  activeTab,
  onActiveTabChange,
}: {
  step: WorkflowCardStep;
  planNode: WorkflowCardData['plan']['nodes'][number] | null;
  agentName: string;
  loop: NonNullable<WorkflowCardData['loops']>[number] | null;
  reviewPhase: ReturnType<typeof workflowReviewPhaseMeta>;
  latestReviewLabel: string | null;
  latestReviewFeedback: string | null;
  onClose: () => void;
  onOpenChat: () => void;
  isChatVisible: boolean;
  onInterruptStep?: (stepId: string) => void;
  onStopStep?: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  pendingActionId?: string | null;
  transcriptEntries: WorkflowTranscriptEntry[];
  isLoadingTranscript: boolean;
  activeTab: ExecutionRecordTab;
  onActiveTabChange: (tab: ExecutionRecordTab) => void;
}) {
  const { t } = useTranslation('chat');
  const [expandedLogLines, setExpandedLogLines] = useState<Set<string>>(
    () => new Set()
  );
  const [collapsedLogGroups, setCollapsedLogGroups] = useState<Set<string>>(
    () => new Set()
  );

  const statusColors: Record<string, string> = {
    failed: 'bg-rose-50 text-rose-600 border-rose-200',
    completed: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    waiting_review: 'bg-amber-50 text-amber-600 border-amber-200',
    pre_completed: 'bg-amber-50 text-amber-600 border-amber-200',
    running: 'bg-blue-50 text-blue-600 border-blue-200',
    revising: 'bg-blue-50 text-blue-600 border-blue-200',
    waiting_input: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    ready: 'bg-slate-50 text-slate-600 border-slate-200',
    pending: 'bg-slate-50 text-slate-600 border-slate-200',
  };

  const instruction =
    planNode?.data.instructions?.trim() ||
    'No task instructions were provided for this step.';
  const summaryText =
    step.summary_text?.trim() ||
    'No summary has been generated for this step yet.';
  const loopName = loop?.loop_key?.trim() ?? '';
  const loopRejectionReason = loop?.rejection_reason?.trim() ?? '';
  const isFailed = WORKFLOW_FAILURE_STEP_STATUSES.has(step.status);
  const isCompleted = step.status === 'completed';
  const hasError = isFailed || loopRejectionReason.length > 0;
const hasFooterActions =
    step.status === 'running' ||
    step.status === 'waiting_review' ||
    step.status === 'pre_completed' ||
    isFailed;

  const streamEntries = useMemo(
    () =>
      transcriptEntries.filter((entry) => isWorkflowRuntimeThinkingEntry(entry)),
    [transcriptEntries]
  );
  const agentLogGroups = useMemo(
    () =>
      Array.from(
        streamEntries.reduce((groups, entry) => {
          const groupAgentName = entry.agent_name?.trim() || agentName;
          const groupKey = `${step.id}::${groupAgentName}`;
          const existing = groups.get(groupKey);
          const content = (getTranscriptMarkdown(entry) ?? entry.content).trim();
          if (!content) return groups;
          const lines = content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => ({
              key: `${entry.id}-${index}`,
              timestamp: formatWorkflowLogTimestamp(entry.created_at),
              content: line,
              isError: /error|failed|fatal|exception/i.test(line),
            }));
          if (lines.length === 0) return groups;
          if (existing) {
            existing.lines.push(...lines);
          } else {
            groups.set(groupKey, {
              key: groupKey,
              agentName: groupAgentName,
              lines,
            });
          }
          return groups;
        }, new Map<string, { key: string; agentName: string; lines: Array<{ key: string; timestamp: string; content: string; isError: boolean }> }>())
          .values()
      ),
    [agentName, step.id, streamEntries]
  );
  const outputEntries = useMemo(
    () =>
      transcriptEntries.filter(
        (entry) => !isWorkflowRuntimeThinkingEntry(entry)
      ),
    [transcriptEntries]
  );
  const toggleLogLine = (lineKey: string) => {
    setExpandedLogLines((current) => {
      const next = new Set(current);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
  };
  const toggleLogGroupVisibility = (groupKey: string, lineKeys: string[]) => {
    const wasCollapsed = collapsedLogGroups.has(groupKey);
    setCollapsedLogGroups((current) => {
      const next = new Set(current);
      if (wasCollapsed) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
    setExpandedLogLines((lines) => {
      const expanded = new Set(lines);
      for (const key of lineKeys) {
        if (wasCollapsed) expanded.add(key);
        else expanded.delete(key);
      }
      return expanded;
    });
  };

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="w-[28vw] min-w-[420px] max-w-[720px] h-[calc(100vh-80px)] max-h-none mr-1 bg-white shadow-2xl rounded-none border border-slate-200 flex flex-col relative overflow-hidden"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors z-20"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex items-center border-b border-slate-100 bg-white select-none shrink-0 pt-2 px-6 gap-6 relative z-10">
        <button
          type="button"
          onClick={() => onActiveTabChange('DETAILS')}
          className={cn(
            'inline-flex items-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 -mb-[1px]',
            activeTab === 'DETAILS'
              ? 'text-indigo-600 border-indigo-600'
              : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300'
          )}
        >
          <FileText className="h-4 w-4" />
          Details
        </button>
        <button
          type="button"
          onClick={() => onActiveTabChange('LOGS')}
          className={cn(
            'inline-flex items-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 -mb-[1px]',
            activeTab === 'LOGS'
              ? 'text-indigo-600 border-indigo-600'
              : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300'
          )}
        >
          <ScrollText className="h-4 w-4" />
          Logs
        </button>
        <div className="flex-grow flex justify-end pb-1 h-full py-2 pr-6">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider',
              hasError
                ? 'bg-rose-50 text-rose-600'
                : statusColors[step.status]?.replace(/border-[a-z]+-\d+/g, '').trim() || 'bg-slate-50 text-slate-500'
            )}
          >
            {workflowStatusLabel(step.status)}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'DETAILS' ? (
          <div className="absolute inset-0 p-8 overflow-y-auto bg-white">
            <h2 className="text-xl font-bold mb-4 text-slate-900 tracking-tight">
              {step.title}
            </h2>

            <div className="mb-6 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-medium">
              <span className="flex items-center gap-1"><Bot className="w-3.5 h-3.5" /> {agentName}</span>
              <span className="w-1 h-1 rounded-full bg-slate-300"></span>
              <span>{step.step_type}</span>
              {loopName && (
                <>
                  <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                  <span>Loop: {loopName}</span>
                </>
              )}
              {reviewPhase && (
                <>
                  <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                  <span>Review: {reviewPhase.label}</span>
                </>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-base font-bold text-slate-800 mb-3 pl-3 border-l-4 border-indigo-500 capitalize">
                Instruction
              </h3>
              <div className="bg-slate-50/80 border border-slate-100 rounded-xl p-4 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                {instruction}
              </div>
            </div>

            {(isFailed || isCompleted) && (
              <div className="mb-6">
                <h3 className="text-base font-bold text-slate-800 mb-3 pl-3 border-l-4 border-indigo-500 capitalize">
                  Summary
                </h3>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <ChatMarkdown
                      content={summaryText}
                      maxWidth="100%"
                      textClassName="text-[13px] text-slate-700 leading-relaxed [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:text-slate-800 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded-md"
                      className="w-full select-text"
                    />
                </div>
              </div>
            )}

            {latestReviewLabel && (
              <div className="mb-6">
                <h3 className="text-base font-bold text-slate-800 mb-3 pl-3 border-l-4 border-indigo-500 capitalize">
                  Feedback
                </h3>
                <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
                  <ChatMarkdown
                    content={latestReviewFeedback || latestReviewLabel}
                    maxWidth="100%"
                    textClassName="text-[13px] text-slate-700 leading-relaxed [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:text-slate-800 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded-md"
                    className="w-full select-text"
                  />
                </div>
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-base font-bold text-slate-800 mb-3 pl-3 border-l-4 border-indigo-500 capitalize">
                Execution Record Output
              </h3>
              <div className="text-[13px] text-slate-600 leading-relaxed">
              {isLoadingTranscript ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading transcript...
                </div>
              ) : outputEntries.length > 0 ? (
                <div className="space-y-4">
                  {outputEntries.map((entry) => {
                    const markdownContent = getTranscriptMarkdown(entry);
                    const OutputIcon = getWorkflowOutputEntryIcon(entry);
                    const outputAgentName =
                      entry.entry_type === 'message' || entry.entry_type === 'lead_review'
                        ? entry.agent_name?.trim() || (entry.entry_type === 'lead_review' ? 'Lead' : undefined)
                        : null;
                    const outputLabel =
                      outputAgentName || getWorkflowOutputEntryLabel(entry);
                    return (
                      <div key={entry.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-slate-600">
                          <span
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-lg border',
                              getWorkflowOutputEntryIconClass(entry)
                            )}
                          >
                            <OutputIcon className="h-4 w-4" />
                          </span>
                          {outputLabel}
                        </div>
                        <ChatMarkdown
                          content={markdownContent || entry.content}
                          maxWidth="100%"
                          textClassName="text-[13px] text-slate-700 leading-relaxed [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:text-slate-800 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded-md"
                          className="w-full select-text"
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  No output entries for this step yet.
                </div>
              )}
              </div>
            </div>

            {hasError && (
              <div className="mb-6">
                <h3 className="text-base font-bold text-rose-600 mb-3 pl-3 border-l-4 border-rose-500 capitalize flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Error
                </h3>
                <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-4 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-rose-700">
                  {loopRejectionReason || summaryText}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 bg-slate-900 text-slate-300 flex flex-col">
            {isLoadingTranscript ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading logs...
              </div>
            ) : agentLogGroups.length > 0 ? (
              agentLogGroups.map((group, groupIndex) => {
                const groupLineKeys = group.lines.map((line) => line.key);
                const allExpanded = groupLineKeys.every((key) =>
                  expandedLogLines.has(key)
                );
                const isGroupCollapsed = collapsedLogGroups.has(group.key);
                return (
                  <div
                    key={group.key}
                    className={cn(
                      'overflow-hidden flex flex-col',
                      isGroupCollapsed
                        ? 'shrink-0'
                        : 'flex-1 min-h-[50%]',
                      groupIndex < agentLogGroups.length - 1 &&
                        'border-b border-slate-700'
                    )}
                  >
                    <div className="bg-slate-900 border-b border-slate-800 p-2 px-5 text-xs text-slate-500 font-mono flex justify-between items-center z-10 shrink-0">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Bot className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">
                          {group.agentName} - Thinking Process
                        </span>
                      </span>
                      <button
                        type="button"
                        className="px-2 py-0.5 text-[10px] rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                        onClick={() =>
                          toggleLogGroupVisibility(group.key, groupLineKeys)
                        }
                      >
                        {isGroupCollapsed || !allExpanded
                          ? 'Expand'
                          : 'Collapse'}
                      </button>
                    </div>
                    {!isGroupCollapsed && (
                      <div className="flex-1 overflow-y-auto flex flex-col font-mono p-4 pb-8 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
                        {group.lines.map((line) => {
                          const expanded = expandedLogLines.has(line.key);
                          return (
                            <div
                              key={line.key}
                              className="flex items-start px-2 py-0.5 text-[12px] text-slate-300 hover:bg-slate-800"
                            >
                              <span className="mr-4 shrink-0 select-none text-slate-500">
                                [{line.timestamp}]
                              </span>
                              <button
                                type="button"
                                title={line.content}
                                onClick={() => toggleLogLine(line.key)}
                                className={cn(
                                  'flex-1 text-left overflow-hidden text-ellipsis',
                                  expanded
                                    ? 'whitespace-pre-wrap break-all'
                                    : 'whitespace-nowrap',
                                  line.isError && 'text-red-400'
                                )}
                              >
                                {line.content}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
              ) : (
              <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                No logs for this step yet.
              </div>
            )}
          </div>
        )}
      </div>

      {hasFooterActions && (
        <footer className="p-4 shrink-0 bg-slate-50/80 border-t border-slate-100 flex gap-3 relative z-10">
          <button
            type="button"
            onClick={onOpenChat}
            className={cn(
              'flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 shadow-sm',
              isChatVisible
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-indigo-600'
            )}
          >
            <MessageSquare className="w-4 h-4" />
            {isChatVisible ? 'Close Chat' : 'Open Chat'}
          </button>

          {step.status === 'running' && (onInterruptStep || onStopStep) && (
            <button
              type="button"
              onClick={() => {
                if (onInterruptStep) {
                  onInterruptStep(step.id);
                  return;
                }
                onStopStep?.(step.id);
              }}
              className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 shadow-sm"
            >
              <Ban className="w-4 h-4" />
              Terminate
            </button>
          )}
          {isRetryableWorkflowStepStatus(step.status) && onRetryStep && (
            <button
              type="button"
              onClick={() => onRetryStep(step.id)}
              disabled={pendingActionId === step.id}
              className="flex-1 py-2.5 px-4 rounded-xl font-semibold text-sm cursor-pointer transition-all flex items-center justify-center gap-2 bg-slate-800 text-white hover:bg-slate-900 shadow-sm shadow-slate-300 disabled:opacity-50 border border-slate-900"
            >
              <RotateCcw
                className={cn(
                  'w-4 h-4',
                  pendingActionId === step.id && 'animate-spin'
                )}
              />
              {t('workflow_retry', { defaultValue: 'Retry' })}
            </button>
          )}
        </footer>
      )}
    </motion.div>
  );
}

// -----------------------------------------------------------------------
// Chat Panel (side panel alongside inspector)
// -----------------------------------------------------------------------

function ChatPanel({
  step,
  agentName,
  entries,
  pendingActionId,
  onApproval,
  onClose,
  onSendInput,
  canSendInput,
}: {
  step: WorkflowCardStep;
  agentName: string;
  entries: WorkflowTranscriptEntry[];
  pendingActionId?: string | null;
  onApproval?: (
    stepId: string,
    action: string,
    transcriptId: string,
    inputText?: string
  ) => void;
  onClose: () => void;
  onSendInput?: (stepId: string, inputText: string) => void;
  canSendInput: boolean;
}) {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const outputEntries = useMemo(
    () => entries.filter((e) => e.entry_type === 'message'),
    [entries]
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputEntries.length]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !onSendInput) return;
    onSendInput(step.id, trimmed);
    setInputText('');
  };

  return (
    <div className="w-[24vw] min-w-[320px] max-w-[480px] bg-[#F8FAFC] h-[calc(100vh-80px)] max-h-none border-l border-slate-200 flex flex-col shadow-2xl">
      <div className="p-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shadow-sm">
          {agentName.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-xs truncate">
            Agent Conversation
          </h2>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-slate-500 font-medium">
              {agentName}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 p-4 space-y-4 overflow-y-auto flex flex-col py-6"
      >
        {outputEntries.map((entry) => {
          const isUser = entry.message_type === 'user' && entry.entry_type !== 'lead_review';
          const markdownContent = getTranscriptMarkdown(entry);
          const entryAgentName =
            !isUser && entry.agent_name?.trim()
              ? entry.agent_name.trim()
              : (entry.entry_type === 'lead_review' ? 'Lead' : null);

          if (
            entry.entry_type === 'approval_request' ||
            entry.entry_type === 'permission_request' ||
            entry.entry_type === 'continue_confirmation'
          ) {
            const meta = parseWorkflowTranscriptMeta(entry.meta_json);
            const resolved = meta?.resolved === true;
            return (
              <div
                key={entry.id}
                className="bg-white border-2 border-amber-400 p-4 rounded-xl shadow-lg"
              >
                <div className="text-xs font-bold text-amber-800 flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4" />{' '}
                  {entry.entry_type === 'approval_request'
                    ? 'Approval Required'
                    : entry.entry_type === 'permission_request'
                      ? 'Permission Request'
                      : 'Continue?'}
                </div>
                <p className="text-[11px] text-slate-600 mb-3 leading-relaxed font-medium">
                  {entry.content}
                </p>
                {!resolved && entry.step_id && onApproval && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onApproval(
                          entry.step_id!,
                          entry.entry_type === 'approval_request'
                            ? 'approved'
                            : entry.entry_type === 'permission_request'
                              ? 'granted'
                              : 'continued',
                          entry.id
                        )
                      }
                      disabled={pendingActionId === entry.id}
                      className="flex-1 py-1.5 bg-emerald-600 text-white rounded text-[10px] font-bold hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
                    >
                      {entry.entry_type === 'continue_confirmation'
                        ? 'CONTINUE'
                        : 'APPROVE'}
                    </button>
                    {entry.entry_type !== 'continue_confirmation' && (
                      <button
                        type="button"
                        onClick={() =>
                          onApproval(
                            entry.step_id!,
                            entry.entry_type === 'approval_request'
                              ? 'rejected'
                              : 'denied',
                            entry.id
                          )
                        }
                        disabled={pendingActionId === entry.id}
                        className="flex-1 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-[10px] font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
                      >
                        REJECT
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={entry.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              {!isUser && entryAgentName && (
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-4 h-4 rounded-full bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-600 shrink-0">
                    {entryAgentName.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {entryAgentName}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  'text-xs leading-relaxed',
                  isUser
                    ? 'max-w-[85%] p-3 bg-indigo-500 text-white rounded-2xl rounded-tr-none shadow-sm'
                    : 'w-full py-2 bg-transparent text-slate-800'
                )}
              >
                {isUser ? (
                  entry.content
                ) : markdownContent ? (
                  <ChatMarkdown
                    content={markdownContent}
                    maxWidth="100%"
                    textClassName="text-[13px] [&_:not(pre)>code]:bg-slate-100 [&_:not(pre)>code]:text-slate-800 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded-md"
                    className="w-full select-text"
                  />
                ) : (
                  <span className="text-[13px]">{entry.content}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 bg-white border-t border-slate-200 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Reply to agent..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={!canSendInput}
            className="w-full pl-4 pr-10 py-3 bg-slate-100 border-none rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-shadow disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || !canSendInput}
            className={cn(
              'absolute right-3 top-2.5 w-6 h-6 flex items-center justify-center transition-colors',
              inputText.trim() && canSendInput
                ? 'text-indigo-600 hover:text-indigo-700'
                : 'text-slate-400'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Workflow Window (Full-Page Layout)
// -----------------------------------------------------------------------

export function WorkflowWindow({
  sessionId,
  projection,
  transcript = [],
  runtimeMessages = [],
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
  onResolveFinalReview,
  onRespondPendingReview,
  onSubmitIterationFeedback,
  pendingActionId,
}: WorkflowWindowProps) {
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [executionRecordTab, setExecutionRecordTab] =
    useState<ExecutionRecordTab>('DETAILS');
  const [runtimeInputTranscripts, setRuntimeInputTranscripts] = useState<
    WorkflowTranscriptEntry[]
  >([]);
  const initializedWorkflowKeyRef = useRef<string | null>(null);
  const previousExecutionIdRef = useRef<string | null>(null);

  const isPreview =
    projection.state === 'preview_ready' ||
    projection.state === 'preview_invalid';
  const canPauseExecution = canPauseWorkflowExecution(projection);
  const canResumeExecution = canResumeWorkflowExecution(projection);
  const isExecutionRecompiling = isWorkflowExecutionRecompiling(projection);
  const normalizedResultSummary = projection.result_summary?.trim() ?? '';
  const normalizedErrorMessage = projection.error_message?.trim() ?? '';
  const hasFailedWorkflowStep = projection.steps.some((step) =>
    WORKFLOW_FAILURE_STEP_STATUSES.has(step.status)
  );
  const hasTerminalWorkflowSteps =
    projection.steps.length > 0 &&
    projection.steps.every((step) =>
      WORKFLOW_TERMINAL_STEP_STATUSES.has(step.status)
    );
  const hasWorkflowCompleted =
    projection.state === 'completed' ||
    projection.execution_status === 'completed' ||
    (normalizedResultSummary.length > 0 &&
      hasTerminalWorkflowSteps &&
      !hasFailedWorkflowStep);
  const hasWorkflowFailed =
    projection.state === 'failed' ||
    projection.execution_status === 'failed' ||
    (normalizedErrorMessage.length > 0 && hasFailedWorkflowStep);
  const agents = useMemo(() => projection.agents ?? [], [projection.agents]);
  const leadAgentId =
    agents[0]?.workflow_agent_session_id ?? agents[0]?.session_agent_id ?? null;
  const leadAgentName = agents[0]?.name ?? 'Lead';
  const agentSessionIdByLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const agent of agents) {
      const agentSessionId =
        agent.workflow_agent_session_id ?? agent.session_agent_id;
      const keys = [
        agent.name,
        agent.agent_id,
        agent.session_agent_id,
        agent.workflow_agent_session_id,
      ];
      for (const key of keys) {
        const normalizedKey = key?.trim();
        if (!normalizedKey || lookup.has(normalizedKey)) continue;
        lookup.set(normalizedKey, agentSessionId);
      }
    }
    return lookup;
  }, [agents]);
  const agentNameByLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const agent of agents) {
      const keys = [
        agent.name,
        agent.agent_id,
        agent.session_agent_id,
        agent.workflow_agent_session_id,
      ];
      for (const key of keys) {
        const normalizedKey = key?.trim();
        if (!normalizedKey || lookup.has(normalizedKey)) continue;
        lookup.set(normalizedKey, agent.name);
      }
    }
    return lookup;
  }, [agents]);
  const stepByKey = useMemo(
    () => new Map(projection.steps.map((step) => [step.step_key, step])),
    [projection.steps]
  );
  const planNodeById = useMemo(
    () => new Map(projection.plan.nodes.map((node) => [node.id, node])),
    [projection.plan.nodes]
  );
  const workflowLoops = useMemo(() => projection.loops ?? [], [
    projection.loops,
  ]);
  const loopByKey = useMemo(
    () => new Map(workflowLoops.map((loop) => [loop.loop_key, loop])),
    [workflowLoops]
  );
  const workflowInstanceKey = useMemo(
    () => `${projection.execution_id ?? ''}::${projection.plan_id ?? ''}`,
    [projection.execution_id, projection.plan_id]
  );
  const resolveStepAgentName = useCallback(
    (step?: WorkflowCardStep | null) => {
      const rawAgent = step?.agent_name?.trim();
      if (!rawAgent) return leadAgentName;
      return agentNameByLookup.get(rawAgent) ?? rawAgent;
    },
    [agentNameByLookup, leadAgentName]
  );
  const resolveStepAgentId = useCallback(
    (step?: WorkflowCardStep | null) => {
      if (!step) return leadAgentId;
      const rawAgent = step.agent_name?.trim();
      if (!rawAgent) return leadAgentId;
      return agentSessionIdByLookup.get(rawAgent) ?? leadAgentId;
    },
    [agentSessionIdByLookup, leadAgentId]
  );

  const progressPercent = useMemo(() => {
    if (projection.total_step_count === 0) return 0;
    return Math.round(
      (projection.completed_step_count / projection.total_step_count) * 100
    );
  }, [projection.completed_step_count, projection.total_step_count]);

  const isRunning =
    projection.execution_status === 'running' || canPauseExecution;

  // Reset state on workflow instance change
  useEffect(() => {
    if (!isOpen) return;
    if (initializedWorkflowKeyRef.current !== workflowInstanceKey) {
      initializedWorkflowKeyRef.current = workflowInstanceKey;
      setActiveNodeId(null);
      setIsChatVisible(false);
      setExecutionRecordTab('DETAILS');
    }
  }, [isOpen, workflowInstanceKey]);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isChatVisible) {
          setIsChatVisible(false);
          return;
        }
        if (activeNodeId) {
          setActiveNodeId(null);
          return;
        }
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeNodeId, isChatVisible, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setActiveNodeId(null);
      setIsChatVisible(false);
      setExecutionRecordTab('DETAILS');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !projection.execution_id) {
      setRuntimeInputTranscripts([]);
      return;
    }
    if (previousExecutionIdRef.current !== projection.execution_id) {
      previousExecutionIdRef.current = projection.execution_id;
      setRuntimeInputTranscripts([]);
    }
  }, [isOpen, projection.execution_id]);

  // Derived data for active step
  const activeStep = useMemo(
    () =>
      activeNodeId
        ? projection.steps.find((s) => s.step_key === activeNodeId) ?? null
        : null,
    [activeNodeId, projection.steps]
  );
  const activePlanNode = activeNodeId ? planNodeById.get(activeNodeId) ?? null : null;
  const activeStepLoop = activeStep?.loop_key
    ? (loopByKey.get(activeStep.loop_key) ?? null)
    : null;
  const activeStepReviewPhase = workflowReviewPhaseMeta(
    activeStep?.review_phase
  );
  const activeStepLatestReview = activeStep?.latest_review ?? null;
  const activeStepLatestReviewLabel = workflowLatestReviewLabel(
    activeStepLatestReview
  );
  const activeStepLatestReviewFeedback = workflowLatestReviewFeedback(
    activeStepLatestReview
  );
  const activeAgentSessionId = activeStep?.agent_name
    ? (agentSessionIdByLookup.get(activeStep.agent_name.trim()) ?? leadAgentId)
    : leadAgentId;

  const transcriptWithLocalInputs = useMemo(
    () => mergeAndSortTranscriptEntries(transcript, runtimeInputTranscripts),
    [runtimeInputTranscripts, transcript]
  );

  // Transcript for inspector card
  const {
    data: activeStepTranscriptData,
    isLoading: isLoadingActiveStepTranscript,
  } = useQuery({
    queryKey: [
      'workflowStepTranscripts',
      sessionId,
      activeStep?.id,
      activeAgentSessionId,
    ],
    queryFn: () => {
      if (!sessionId || !activeStep?.id) return [];
      return chatApi.getWorkflowStepTranscripts(sessionId, activeStep.id, {
        stepKey: activeStep.step_key,
        workflowAgentSessionId: activeAgentSessionId,
      });
    },
    enabled: !!sessionId && !!activeStep?.id && !isPreview && isOpen,
    refetchInterval:
      isOpen && !isPreview && !!sessionId && !!activeStep?.id ? 5000 : false,
  });

  const activeStepFallbackTranscript = useMemo(() => {
    if (!activeStep) return [];
    let entries = transcriptWithLocalInputs.filter(
      (entry) =>
        entry.step_id === activeStep.id ||
        entry.step_key === activeStep.step_key
    );
    if (activeAgentSessionId) {
      entries = entries.filter(
        (entry) => entry.workflow_agent_session_id === activeAgentSessionId
      );
    }
    return entries;
  }, [activeAgentSessionId, activeStep, transcriptWithLocalInputs]);

  const activeStepScopedTranscript = useMemo(() => {
    const entries = activeStepTranscriptData ?? [];
    const remoteEntries = entries.map((entry) => ({
      id: entry.id,
      round_id: entry.round_id,
      step_id: entry.step_id,
      step_key: entry.step_key,
      workflow_agent_session_id: entry.workflow_agent_session_id,
      agent_name: entry.agent_name,
      message_type: entry.sender_type as
        | 'system'
        | 'agent'
        | 'user'
        | 'control',
      content: entry.content,
      entry_type: entry.entry_type,
      meta_json: entry.meta_json,
      created_at: entry.created_at,
    }));
    const localEntries = transcriptWithLocalInputs.filter(
      (entry) =>
        entry.step_id === activeStep?.id ||
        entry.step_key === activeStep?.step_key
    );
    const mergedEntries = mergeAndSortTranscriptEntries(
      remoteEntries,
      localEntries
    );
    const stepContentEntries = activeStep
      ? buildStepContentTranscriptEntries(
          [activeStep],
          mergedEntries,
          resolveStepAgentId,
          activeAgentSessionId
        )
      : [];
    return mergeAndSortTranscriptEntries(mergedEntries, stepContentEntries);
  }, [
    activeAgentSessionId,
    activeStep,
    activeStepTranscriptData,
    resolveStepAgentId,
    transcriptWithLocalInputs,
  ]);

  const activeRuntimeTranscript = useMemo(() => {
    if (!activeStep || runtimeMessages.length === 0) return [];
    return runtimeMessages
      .filter(
        (message) =>
          (message.stepId === activeStep.id ||
            message.stepKey === activeStep.step_key) &&
          (!activeAgentSessionId ||
            !message.workflowAgentSessionId ||
            message.workflowAgentSessionId === activeAgentSessionId)
      )
      .map(
        (message): WorkflowTranscriptEntry => ({
          id: message.id,
          step_id: message.stepId,
          step_key: message.stepKey,
          workflow_agent_session_id: message.workflowAgentSessionId,
          agent_name: message.agentName,
          message_type: 'agent',
          entry_type:
            message.streamType === 'assistant'
              ? 'message'
              : message.streamType,
          content: message.content,
          meta_json: JSON.stringify({
            source: 'workflow_runtime_stream',
          }),
          created_at: message.createdAt,
        })
      );
  }, [activeAgentSessionId, activeStep, runtimeMessages]);

  const visibleActiveTranscript =
    activeStepScopedTranscript.length > 0 || activeRuntimeTranscript.length > 0
      ? mergeAndSortTranscriptEntries(
          activeStepScopedTranscript,
          activeRuntimeTranscript
        )
      : activeStepFallbackTranscript;

  // Final review & iteration
  const workflowFinalReviewAction = useMemo(
    () => toWorkflowFinalReviewAction(projection.execution_id, transcript),
    [projection.execution_id, transcript]
  );
  const allStepViewsCompleted =
    projection.steps.length > 0 &&
    projection.steps.every((step) =>
      REVIEW_READY_STEP_STATUSES.has(step.status)
    );
  const canReviewCurrentRound =
    !!workflowFinalReviewAction ||
    (allStepViewsCompleted &&
      (projection.state === 'waiting' ||
        projection.execution_status === 'waiting'));

  // Notification items from pending reviews
  const notifications = useMemo(() => {
    const items: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      nodeId?: string;
    }> = [];

    if (projection.pending_review) {
      items.push({
        id: projection.pending_review.review_id,
        type: projection.pending_review.review_type,
        title: projection.pending_review.target_title,
        message:
          projection.pending_review.prompt_template.message ||
          'Review required',
      });
    }

    if (workflowFinalReviewAction) {
      items.push({
        id: workflowFinalReviewAction.transcriptId,
        type: 'final_review',
        title: 'Final Review',
        message: workflowFinalReviewAction.message,
      });
    }

    return items;
  }, [projection.pending_review, workflowFinalReviewAction]);

  const handleNodeClick = useCallback(
    (id: string) => {
      if (!stepByKey.has(id)) return;
      setActiveNodeId(id);
    },
    [stepByKey]
  );

  const handleSendStepInput = useCallback(
    (stepId: string, inputText: string) => {
      if (!onSubmitStepInput) return;
      const step = projection.steps.find((s) => s.id === stepId);
      if (!step) return;
      onSubmitStepInput(stepId, inputText);
      setRuntimeInputTranscripts((prev) => [
        ...prev,
        {
          id: `runtime-user-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
          step_id: stepId,
          step_key: step.step_key,
          workflow_agent_session_id: resolveStepAgentId(step),
          agent_name: 'You',
          message_type: 'user',
          entry_type: 'message',
          content: inputText,
          meta_json: JSON.stringify({ source: 'workflow_window_input' }),
          created_at: new Date().toISOString(),
        },
      ]);
    },
    [onSubmitStepInput, projection.steps, resolveStepAgentId]
  );

  if (!isOpen) return null;

  const windowContent = (
    <div className="fixed inset-0 z-[1000] flex h-dvh min-h-dvh w-dvw flex-col overflow-hidden bg-slate-100 font-sans text-slate-900">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight truncate">
              {projection.title}
            </h1>
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              {isRunning && (
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
              )}
              {isExecutionRecompiling
                ? 'Recompiling plan...'
                : hasWorkflowCompleted
                  ? `Completed - ${normalizedResultSummary || 'All steps finished'}`
                  : hasWorkflowFailed
                    ? `Failed - ${normalizedErrorMessage || 'Execution error'}`
                    : `Progress ${progressPercent}% · ${projection.completed_step_count}/${projection.total_step_count} steps`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Control buttons */}
          <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
            {isPreview && projection.plan_id && onExecute && (
              <button
                type="button"
                onClick={() => onExecute(projection.plan_id!)}
                className="p-1.5 bg-white shadow-sm rounded-md transition-all text-indigo-600 hover:bg-indigo-50"
                title="Execute Plan"
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
            )}
            {canResumeExecution && projection.execution_id && onResume && (
              <button
                type="button"
                onClick={() => onResume(projection.execution_id!)}
                className="p-1.5 bg-white shadow-sm rounded-md transition-all text-indigo-600 hover:bg-indigo-50"
                title="Resume"
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
            )}
            {canPauseExecution && projection.execution_id && onPauseAll && (
              <button
                type="button"
                onClick={() => onPauseAll(projection.execution_id!)}
                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-slate-500"
                title="Pause All"
              >
                <Pause className="w-4 h-4" />
              </button>
            )}
            {projection.execution_id &&
              (onInterruptStep || onStopStep) &&
              isRunning && (
                <button
                  type="button"
                  onClick={() => {
                    const runningStep = projection.steps.find(
                      (s) => s.status === 'running'
                    );
                    if (runningStep) {
                      if (onInterruptStep) onInterruptStep(runningStep.id);
                      else onStopStep?.(runningStep.id);
                    }
                  }}
                  className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-slate-500"
                  title="Stop"
                >
                  <Square className="w-4 h-4" />
                </button>
              )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative flex-1 overflow-hidden flex">
        {/* Workflow Canvas */}
        <WorkflowGraphBoard
          nodes={projection.plan.nodes}
          edges={projection.plan.edges}
          steps={projection.steps}
          loops={workflowLoops}
          planLoops={projection.plan.loops}
          agents={agents}
          selectedStepId={activeNodeId}
          onSelectStep={handleNodeClick}
          onRetryStep={onRetryStep}
          pendingActionId={pendingActionId}
          className="flex-1 w-full h-full"
        />

        {/* Notifications Overlay */}
        <div className="absolute top-6 right-6 flex flex-col gap-4 z-50 pointer-events-none">
          <AnimatePresence>
            {notifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, x: 100, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.95 }}
                className="w-72 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden ring-4 ring-indigo-500/10 pointer-events-auto"
              >
                <div className="bg-indigo-600 p-2.5 flex items-center justify-between text-white">
                  <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5" /> Pending Review
                  </span>
                  <span className="text-[10px] bg-indigo-400/50 px-1.5 py-0.5 rounded">
                    {notif.type === 'final_review' ? 'Final' : 'Step'}
                  </span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {notif.title}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                        {notif.message}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {notif.type === 'final_review' &&
                    workflowFinalReviewAction &&
                    onResolveFinalReview ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onResolveFinalReview(
                              workflowFinalReviewAction.executionId,
                              workflowFinalReviewAction.transcriptId,
                              'accepted'
                            )
                          }
                          disabled={
                            pendingActionId ===
                            workflowFinalReviewAction.transcriptId
                          }
                          className="flex-1 py-1.5 bg-indigo-600 text-white rounded-md text-[10px] font-bold shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                          ACCEPT
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onResolveFinalReview(
                              workflowFinalReviewAction.executionId,
                              workflowFinalReviewAction.transcriptId,
                              'rejected'
                            )
                          }
                          disabled={
                            pendingActionId ===
                            workflowFinalReviewAction.transcriptId
                          }
                          className="flex-1 py-1.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
                        >
                          REJECT
                        </button>
                      </>
                    ) : projection.pending_review && onRespondPendingReview ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onRespondPendingReview(
                              projection.pending_review!.review_id,
                              'approve'
                            )
                          }
                          disabled={
                            pendingActionId ===
                            projection.pending_review.review_id
                          }
                          className="flex-1 py-1.5 bg-indigo-600 text-white rounded-md text-[10px] font-bold shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                          APPROVE
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (notif.nodeId) {
                              setActiveNodeId(notif.nodeId);
                              setIsChatVisible(true);
                            }
                          }}
                          className="flex-1 py-1.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-bold hover:bg-slate-200 transition-colors"
                        >
                          VIEW DETAILS
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Iteration feedback card overlay (bottom-left) */}
        {!isPreview &&
          (projection.iteration_history.length > 0 ||
            workflowFinalReviewAction) && (
            <div className="absolute bottom-6 left-6 z-40 w-80">
              <WorkflowIterationFeedbackCard
                currentRound={projection.current_round}
                completedSteps={projection.completed_step_count}
                totalSteps={projection.total_step_count}
                runningStepTitle={projection.steps.find((s) => s.status === 'running' || s.status === 'failed')?.title ?? null}
                iterationHistory={projection.iteration_history}
                canReviewCurrentRound={canReviewCurrentRound}
                pendingActionId={pendingActionId}
                onSubmit={(payload) => {
                  if (
                    !projection.execution_id ||
                    !onSubmitIterationFeedback
                  )
                    return;
                  onSubmitIterationFeedback({
                    executionId: projection.execution_id,
                    action: payload.action,
                    feedback: payload.feedback,
                  });
                }}
              />
            </div>
          )}

        {/* Side Panels */}
        <div className="absolute top-0 right-0 bottom-0 pointer-events-none flex items-stretch justify-end z-40 overflow-hidden">
          {activeNodeId && (
            <div
              className="fixed inset-0 z-10 pointer-events-auto"
              onClick={() => {
                setActiveNodeId(null);
                setIsChatVisible(false);
              }}
            />
          )}
          {/* Inspector Panel */}
          <AnimatePresence>
            {activeNodeId && activeStep && (
              <motion.aside
                key="inspector"
                initial={{ x: 300, opacity: 1 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 300, opacity: 1 }}
                transition={{
                  type: 'tween',
                  duration: 0.3,
                  ease: 'easeInOut',
                }}
                className="pointer-events-auto h-full flex items-center shrink-0 z-30 py-2"
              >
                <InspectorCard
                  step={activeStep}
                  planNode={activePlanNode}
                  agentName={resolveStepAgentName(activeStep)}
                  loop={activeStepLoop}
                  reviewPhase={activeStepReviewPhase}
                  latestReviewLabel={activeStepLatestReviewLabel}
                  latestReviewFeedback={activeStepLatestReviewFeedback}
                  onClose={() => {
                    setActiveNodeId(null);
                    setIsChatVisible(false);
                  }}
                  onOpenChat={() => setIsChatVisible(!isChatVisible)}
                  isChatVisible={isChatVisible}
                  onInterruptStep={onInterruptStep}
                  onStopStep={onStopStep}
                  onRetryStep={onRetryStep}
                  pendingActionId={pendingActionId}
                  transcriptEntries={visibleActiveTranscript}
                  isLoadingTranscript={
                    isLoadingActiveStepTranscript &&
                    visibleActiveTranscript.length === 0
                  }
                  activeTab={executionRecordTab}
                  onActiveTabChange={setExecutionRecordTab}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          {/* Chat Panel */}
          <AnimatePresence>
            {activeNodeId && activeStep && isChatVisible && (
              <motion.aside
                key="chat"
                initial={{ x: 340, opacity: 1 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 340, opacity: 1 }}
                transition={{
                  type: 'tween',
                  duration: 0.3,
                  ease: 'easeInOut',
                }}
                className="pointer-events-auto h-full flex items-center shrink-0 z-20 mr-5 py-2"
              >
                <ChatPanel
                  step={activeStep}
                  agentName={resolveStepAgentName(activeStep)}
                  entries={visibleActiveTranscript}
                  pendingActionId={pendingActionId}
                  onApproval={onApproval}
                  onClose={() => setIsChatVisible(false)}
                  onSendInput={handleSendStepInput}
                  canSendInput={
                    !!onSubmitStepInput &&
                    activeStep.status === 'waiting_input'
                  }
                />
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined'
    ? windowContent
    : createPortal(
        <div className="new-design">{windowContent}</div>,
        document.body
      );
}
