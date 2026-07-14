import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@/lib/queryCompat';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Box,
  Play,
  Pause,
  Square,
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
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { WorkflowCardData } from '@/lib/api';
import type { WorkflowStepTokenEntry } from '@/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  formatCompactNumber,
  formatNumber,
  formatPrice,
} from '@/lib/buildStatsUtils';
import { ChatMarkdown } from '@/components/conversation/ChatMarkdown';
import { useWorkspace } from '@/context/WorkspaceContext';
import { getWorkflowTranscriptRefetchInterval } from '@/lib/workflowRequestPolicy';
import { WorkflowIterationFeedbackCard } from './WorkflowIterationFeedbackCard';
import { WorkflowGraphBoard } from './WorkflowGraphBoard';
import { WorkflowPendingInputCard } from './WorkflowPendingInputCard';
import { WorkflowPendingReviewCard } from './WorkflowPendingReviewCard';
import { WorkflowAgentLogPanel } from './WorkflowAgentLogPanel';
import {
  workflowExecutionStatusLabel,
  workflowStatusBadgeClass,
  workflowLatestReviewFeedback,
  workflowLatestReviewLabel,
  workflowReviewPhaseMeta,
  workflowStatusLabel,
} from './workflowStepPresentation';
import {
  parseWorkflowTranscriptMeta,
  type WorkflowFinalReviewActionData,
} from './WorkflowFinalReviewCard';
import {
  canRetryWorkflowStepReview,
  canPauseWorkflowExecution,
  canResumeWorkflowExecution,
  isRetryableWorkflowStepStatus,
  isWorkflowExecutionRecompiling,
} from './workflowControlContract';
import {
  WorkflowReviewSettingsDialog,
  type WorkflowReviewSettingOverride,
} from './WorkflowReviewSettingsDialog';
import { localizeWorkflowGeneratedText } from './workflowGeneratedText';

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

function WorkflowStepTokenUsageStrip({
  usage,
  loading,
}: {
  usage: WorkflowStepTokenEntry | null;
  loading: boolean;
}) {
  const { t } = useAppTranslation();

  if (loading) {
    return (
      <div className="mb-8 flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-11 w-24 animate-pulse rounded-md bg-[var(--surface-3)]"
          />
        ))}
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="mb-8 text-[12px] text-[#8A8F98]">
        {t('workflow.inspector.tokenUsageUnavailable', {
          defaultValue: 'Token usage is not available for this step yet.',
        })}
      </div>
    );
  }

  const metrics = [
    {
      label: t('workflow.inspector.tokenTotal', { defaultValue: 'Tokens' }),
      value: formatNumber(usage.total_tokens),
    },
    {
      label: t('workflow.inspector.tokenInput', { defaultValue: 'Input' }),
      value: formatCompactNumber(usage.input_tokens),
    },
    {
      label: t('workflow.inspector.tokenOutput', { defaultValue: 'Output' }),
      value: formatCompactNumber(usage.output_tokens),
    },
    {
      label: t('workflow.inspector.tokenCache', { defaultValue: 'Cache' }),
      value: formatCompactNumber(usage.cache_read_tokens),
    },
    {
      label: t('workflow.inspector.tokenReasoning', {
        defaultValue: 'Reasoning',
      }),
      value: formatCompactNumber(usage.reasoning_output_tokens),
    },
    {
      label: t('workflow.inspector.tokenCost', { defaultValue: 'Cost' }),
      value: formatPrice(usage.estimated_cost),
    },
  ];

  return (
    <div className="mb-8">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[#8A8F98]">
        {usage.model_name || usage.model_id ? (
          <span>{usage.model_name || usage.model_id}</span>
        ) : null}
        {usage.run_count > 1 ? (
          <span>
            {t('workflow.inspector.tokenRuns', {
              count: usage.run_count,
              defaultValue: '{count} runs',
            })}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-2.5 py-2"
          >
            <div className="text-[10px] font-medium uppercase text-[#8A8F98]">
              {metric.label}
            </div>
            <div className="mt-0.5 font-mono text-[12px] font-semibold text-[#F3F6FB]">
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type WorkflowTranscriptSummaryPayload = {
  summary?: string;
  content?: string;
  outputs?: string[];
};

const WORKFLOW_FAILURE_STEP_STATUSES = new Set(['failed', 'interrupted']);
const REVIEW_READY_STEP_STATUSES = new Set(['completed', 'skipped']);
const WORKFLOW_REVIEW_ENTRY_TYPES = new Set([
  'lead_review',
  'step_review',
  'loop_review',
]);
const REVIEW_SETTINGS_EXECUTION_FINISHED_ERROR =
  'Review settings cannot be changed after execution has finished.';
const REVIEW_SETTINGS_ACTIVE_EXECUTION_ERROR =
  'Review settings can only be changed while execution is not running or waiting for review.';
const workflowDetailMarkdownTextClassName = [
  'text-[13px] text-[#A0A5B1] leading-[1.7]',
  '[&_h1]:text-[var(--ink)] [&_h1]:font-semibold [&_h1]:text-[17px] [&_h1]:mb-3 [&_h1]:mt-6',
  '[&_h2]:text-[var(--ink)] [&_h2]:font-semibold [&_h2]:text-[15px] [&_h2]:mb-3 [&_h2]:mt-5',
  '[&_h3]:text-[var(--ink)] [&_h3]:font-medium [&_h3]:text-[14px] [&_h3]:mb-2 [&_h3]:mt-4',
  '[&_p]:mb-3',
  '[&_ul]:mb-3 [&_ul]:pl-4',
  '[&_ol]:mb-3 [&_ol]:pl-4',
  '[&_li]:mb-2 [&_li]:text-[#A0A5B1]',
  '[&_li::marker]:text-[rgba(255,255,255,0.3)]',
  '[&_strong]:text-[#F2F2F3] [&_strong]:font-medium',
  '[&_em]:text-[#8A8F98]',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-[rgba(255,255,255,0.1)] [&_blockquote]:pl-4 [&_blockquote]:text-[#8A8F98] [&_blockquote]:italic',
  '[&_:not(pre)>code]:bg-[rgba(94,106,210,0.08)]',
  '[&_:not(pre)>code]:text-[#A0A5B1]',
  '[&_:not(pre)>code]:px-[6px]',
  '[&_:not(pre)>code]:py-[2px]',
  '[&_:not(pre)>code]:rounded-[4px]',
  '[&_:not(pre)>code]:border',
  '[&_:not(pre)>code]:border-[rgba(255,255,255,0.06)]',
  '[&_:not(pre)>code]:text-[13px]',
  '[&_:not(pre)>code]:font-mono',
  '[&_pre]:bg-[#18181B]',
  '[&_pre]:border',
  '[&_pre]:border-[rgba(255,255,255,0.08)]',
  '[&_pre]:rounded-[6px]',
  '[&_pre]:p-4',
  '[&_pre]:my-4',
  '[&_pre]:text-[12px]',
  '[&_pre]:leading-[1.6]',
  '[&_pre]:overflow-x-auto',
  '[&_pre_code]:bg-transparent',
  '[&_pre_code]:border-0',
  '[&_pre_code]:p-0',
  '[&_pre_code]:text-[#6E7681]',
].join(' ');

function getStepProgress(steps: WorkflowCardStep[]) {
  return {
    completedSteps: steps.filter((step) => step.status === 'completed').length,
    totalSteps: steps.length,
  };
}

function canWorkflowStepAcceptChatInput(
  step?: WorkflowCardStep | null
): boolean {
  return step?.status === 'waiting_review' || step?.status === 'waiting_input';
}

function getPendingReviews(projection: WorkflowCardData) {
  if (projection.pending_reviews && projection.pending_reviews.length > 0) {
    return projection.pending_reviews;
  }

  return projection.pending_review ? [projection.pending_review] : [];
}

function getReviewSettingsErrorMessage(
  error: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const message =
    error instanceof Error
      ? error.message
      : t('workflow.reviewSettings.updateError', {
          defaultValue: 'Unable to update review settings.',
        });
  return message.includes(REVIEW_SETTINGS_EXECUTION_FINISHED_ERROR) ||
    message.includes(REVIEW_SETTINGS_ACTIVE_EXECUTION_ERROR)
    ? t('workflow.reviewSettings.finishedMessage', {
        defaultValue:
          'Review settings cannot be modified in the current workflow state.',
      })
    : message;
}

function parseWorkflowTranscriptTime(createdAt: string): Date {
  const trimmed = createdAt.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    trimmed
  )
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;

  return new Date(normalized);
}

function getWorkflowReviewMergeKey(
  entry: WorkflowTranscriptEntry
): string | null {
  if (!WORKFLOW_REVIEW_ENTRY_TYPES.has(entry.entry_type)) {
    return null;
  }

  const stepIdentity = entry.step_id?.trim() || entry.step_key?.trim();
  if (!stepIdentity) {
    return null;
  }

  const meta = parseWorkflowTranscriptMeta(entry.meta_json);
  const rawReviewerType =
    typeof meta?.reviewer_type === 'string'
      ? meta.reviewer_type.trim().toLowerCase()
      : '';
  const reviewerType =
    rawReviewerType ||
    (entry.entry_type === 'lead_review'
      ? 'lead'
      : entry.entry_type === 'step_review'
        ? 'user'
        : entry.entry_type);
  const rawReviewRound = meta?.review_round;
  const reviewRound =
    typeof rawReviewRound === 'number'
      ? String(rawReviewRound)
      : typeof rawReviewRound === 'string'
        ? rawReviewRound.trim()
        : '';
  if (!reviewerType || !reviewRound) {
    return null;
  }

  return `${stepIdentity}::${reviewerType}::${reviewRound}`;
}

function getWorkflowTranscriptMergePriority(
  entry: WorkflowTranscriptEntry
): number {
  if (!WORKFLOW_REVIEW_ENTRY_TYPES.has(entry.entry_type)) {
    return 0;
  }

  const source = getTranscriptMetaSource(entry);
  if (source === 'workflow_card_step_review') {
    return 1;
  }
  if (source === 'workflow_step_review') {
    return 2;
  }
  if (entry.workflow_agent_session_id) {
    return 4;
  }
  return 3;
}

function chooseWorkflowTranscriptEntry(
  current: WorkflowTranscriptEntry,
  incoming: WorkflowTranscriptEntry
): WorkflowTranscriptEntry {
  const currentPriority = getWorkflowTranscriptMergePriority(current);
  const incomingPriority = getWorkflowTranscriptMergePriority(incoming);
  return incomingPriority >= currentPriority ? incoming : current;
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
  ...entryGroups: WorkflowTranscriptEntry[][]
): WorkflowTranscriptEntry[] {
  const mergedMap = new Map<string, WorkflowTranscriptEntry>();
  const reviewEntryIdByKey = new Map<string, string>();

  const setEntry = (entry: WorkflowTranscriptEntry) => {
    mergedMap.set(entry.id, entry);
    const reviewKey = getWorkflowReviewMergeKey(entry);
    if (reviewKey) {
      reviewEntryIdByKey.set(reviewKey, entry.id);
    }
  };

  for (const entries of entryGroups) {
    for (const entry of entries) {
      const existingById = mergedMap.get(entry.id);
      if (existingById) {
        setEntry(chooseWorkflowTranscriptEntry(existingById, entry));
        continue;
      }

      const reviewKey = getWorkflowReviewMergeKey(entry);
      const existingReviewId = reviewKey
        ? reviewEntryIdByKey.get(reviewKey)
        : undefined;
      const existingReview = existingReviewId
        ? mergedMap.get(existingReviewId)
        : undefined;
      if (existingReview) {
        const selected = chooseWorkflowTranscriptEntry(existingReview, entry);
        if (selected !== existingReview) {
          mergedMap.delete(existingReview.id);
          setEntry(selected);
        }
        continue;
      }

      setEntry(entry);
    }
  }

  return [...mergedMap.values()].sort((left, right) => {
    const leftAt = parseWorkflowTranscriptTime(left.created_at).getTime();
    const rightAt = parseWorkflowTranscriptTime(right.created_at).getTime();
    const timeOrder =
      (Number.isNaN(leftAt) ? 0 : leftAt) -
      (Number.isNaN(rightAt) ? 0 : rightAt);
    if (timeOrder !== 0) return timeOrder;
    return (
      getWorkflowTranscriptDisplayRank(left) -
      getWorkflowTranscriptDisplayRank(right)
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

function getTranscriptMarkdown(
  entry: WorkflowTranscriptEntry,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | null {
  const payload = parseTranscriptSummaryPayload(entry.meta_json);
  if (payload?.content) {
    const content = payload.content.trim();
    return content.length > 0 ? content : null;
  }

  if (WORKFLOW_REVIEW_ENTRY_TYPES.has(entry.entry_type)) {
    const content = entry.content.trim();
    const verdict = getTranscriptReviewVerdict(entry);
    if (verdict) {
      const localizedVerdict = t(`workflow.reviewVerdict.${verdict}`, {
        defaultValue: verdict,
      });
      const verdictLine = t('workflow.generatedText.reviewVerdict', {
        verdict: localizedVerdict,
        defaultValue: `Verdict: ${localizedVerdict}`,
      });
      return content.length > 0
        ? `${verdictLine}\n\n${content}`
        : verdictLine;
    }
    return content.length > 0 ? content : null;
  }

  if (
    (entry.entry_type === 'message' && entry.message_type === 'agent') ||
    entry.entry_type === 'error'
  ) {
    const content = entry.content.trim();
    return content.length > 0 ? content : null;
  }

  return null;
}

function getLocalizedTranscriptMarkdown(
  entry: WorkflowTranscriptEntry,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | null {
  const markdown = getTranscriptMarkdown(entry, t);
  return markdown ? localizeWorkflowGeneratedText(markdown, t) : null;
}

function getTranscriptMetaSource(
  entry: WorkflowTranscriptEntry
): string | null {
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

function getTranscriptMetaString(
  entry: WorkflowTranscriptEntry,
  key: string
): string | null {
  const meta = parseWorkflowTranscriptMeta(entry.meta_json);
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getTranscriptReviewVerdict(
  entry: WorkflowTranscriptEntry
): string | null {
  return getTranscriptMetaString(entry, 'verdict');
}

function isWorkflowRuntimeThinkingEntry(
  entry: WorkflowTranscriptEntry
): boolean {
  return (
    entry.entry_type === 'thinking' &&
    getTranscriptMetaSource(entry) === 'workflow_runtime_stream'
  );
}

function isWorkflowRuntimeErrorEntry(entry: WorkflowTranscriptEntry): boolean {
  return (
    entry.entry_type === 'error' &&
    getTranscriptMetaSource(entry) === 'workflow_runtime_stream'
  );
}

function isWorkflowStepLifecycleStartEntry(
  entry: WorkflowTranscriptEntry
): boolean {
  return (
    entry.message_type === 'system' &&
    entry.entry_type === 'message' &&
    /^Step ".+" started \(assigned to .+\)$/.test(entry.content.trim())
  );
}

function isWorkflowReviewEntry(entry: WorkflowTranscriptEntry): boolean {
  return WORKFLOW_REVIEW_ENTRY_TYPES.has(entry.entry_type);
}

function getWorkflowTranscriptDisplayRank(
  entry: WorkflowTranscriptEntry
): number {
  if (isWorkflowReviewEntry(entry)) return 30;
  if (entry.entry_type === 'output' || entry.entry_type === 'message')
    return 20;
  return 10;
}

function isWorkflowChatPanelEntry(entry: WorkflowTranscriptEntry): boolean {
  return entry.entry_type === 'message' || isWorkflowReviewEntry(entry);
}

function getWorkflowReviewAgentName(
  entry: WorkflowTranscriptEntry,
  fallbackAgentName: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (getTranscriptMetaString(entry, 'reviewer_type') === 'user') {
    return t('workflow.reviewSettings.userLabel', {
      defaultValue: 'User',
    });
  }
  const rawAgentName = entry.agent_name?.trim();
  if (rawAgentName) return rawAgentName;
  if (entry.entry_type === 'lead_review') return 'Lead';
  return fallbackAgentName;
}

function getWorkflowOutputEntryLabel(entry: WorkflowTranscriptEntry): string {
  return entry.entry_type;
}

function getWorkflowOutputEntryIcon(
  entry: WorkflowTranscriptEntry
): LucideIcon {
  if (entry.entry_type === 'error') {
    return AlertCircle;
  }
  if (entry.message_type === 'agent') {
    return Bot;
  }
  if (entry.message_type === 'user') {
    return Send;
  }
  if (entry.entry_type === 'output') {
    return FileText;
  }
  if (entry.message_type === 'system' || entry.message_type === 'control') {
    return ScrollText;
  }
  return MessageSquare;
}

function getWorkflowOutputEntryIconClass(
  entry: WorkflowTranscriptEntry
): string {
  if (entry.entry_type === 'error') {
    return 'text-[#E5484D]';
  }
  return 'text-[rgba(255,255,255,0.4)]';
}

function isWorkflowCardStepReviewEntry(
  entry: WorkflowTranscriptEntry
): boolean {
  return getTranscriptMetaSource(entry) === 'workflow_card_step_review';
}

function hasReviewResultTranscriptForStep(
  entries: WorkflowTranscriptEntry[],
  step: WorkflowCardStep
): boolean {
  return entries.some((entry) => {
    const belongsToStep =
      entry.step_id === step.id || entry.step_key === step.step_key;
    if (!belongsToStep) return false;
    if (isWorkflowCardStepReviewEntry(entry)) return true;
    return isWorkflowReviewEntry(entry) && !!getTranscriptReviewVerdict(entry);
  });
}

function buildStepReviewTranscriptEntries(
  step: WorkflowCardStep,
  existingEntries: WorkflowTranscriptEntry[]
): WorkflowTranscriptEntry[] {
  const review = step.latest_review;
  if (!review || hasReviewResultTranscriptForStep(existingEntries, step)) {
    return [];
  }

  const reviewerType = review.reviewer_type.trim().toLowerCase();
  const verdict = review.verdict.trim() || 'reviewed';
  const feedback = review.feedback.trim();
  const entryType = reviewerType === 'lead' ? 'lead_review' : 'step_review';
  const messageType = reviewerType === 'user' ? 'user' : 'agent';
  const agentName =
    reviewerType === 'lead'
      ? 'Lead'
      : reviewerType === 'user'
        ? 'User'
        : 'Reviewer';

  return [
    {
      id: `step-review-${step.id}-${reviewerType}-${review.review_round}`,
      step_id: step.id,
      step_key: step.step_key,
      workflow_agent_session_id: null,
      agent_name: agentName,
      message_type: messageType,
      entry_type: entryType,
      content: feedback,
      meta_json: JSON.stringify({
        source: 'workflow_card_step_review',
        reviewer_type: reviewerType,
        verdict,
        review_round: review.review_round,
      }),
      created_at: review.created_at,
    },
  ];
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

export type WorkflowWindowProps = {
  sessionId?: string | null;
  sessionTitle?: string | null;
  projection: WorkflowWindowProjection;
  finalReviewAction?: WorkflowFinalReviewActionData | null;
  runtimeMessages?: WorkflowRuntimeMessage[];
  isOpen: boolean;
  onClose: () => void;
  onExecute?: (projection: WorkflowWindowProjection) => void;
  onPauseAll?: (executionId: string) => void;
  onResume?: (
    executionId: string,
    projection: WorkflowWindowProjection
  ) => void;
  onInterruptStep?: (stepId: string) => void;
  onStopStep?: (stepId: string) => void;
  onRetryStep?: (stepId: string, retryTarget?: 'task' | 'review') => void;
  onUpdateReviewSettings?: (
    executionId: string,
    overrides: WorkflowReviewSettingOverride[]
  ) => Promise<unknown> | void;
  onSubmitStepInput?: (stepId: string, inputText: string) => void;
  onApproval?: (
    stepId: string,
    action: string,
    transcriptId: string,
    inputText?: string
  ) => void;
  onRespondPendingReview?: (
    reviewId: string,
    action: 'approve' | 'reject',
    feedback?: string,
    expectedStepId?: string
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
  const { t } = useAppTranslation();
  return (
    <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#92400E]">
        {t('workflow.approvalCard.title', {
          defaultValue: 'Approval Required',
        })}
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
          {t('workflow.approvalCard.approve', { defaultValue: 'Approve' })}
        </button>
        <button
          type="button"
          onClick={() => onReject(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#DC2626] px-3 py-1 text-xs font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-50 transition-colors"
        >
          {t('workflow.approvalCard.reject', { defaultValue: 'Reject' })}
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
  const { t } = useAppTranslation();
  return (
    <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#1E40AF]">
        {t('workflow.permissionCard.title', {
          defaultValue: 'Permission Request',
        })}
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
          {t('workflow.permissionCard.grant', { defaultValue: 'Grant' })}
        </button>
        <button
          type="button"
          onClick={() => onDeny(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full border border-[#CBD5E1] bg-white px-3 py-1 text-xs font-semibold text-[#475569] hover:bg-[#F1F5F9] disabled:opacity-50 transition-colors"
        >
          {t('workflow.permissionCard.deny', { defaultValue: 'Deny' })}
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
  const { t } = useAppTranslation();
  return (
    <div className="rounded-2xl border border-[#D1FAE5] bg-[#ECFDF5] p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-[#15803D]">
        {t('workflow.continueCard.title', { defaultValue: 'Continue?' })}
      </div>
      <div className="mt-1 text-sm text-[#166534]">{message}</div>
      <div className="mt-2">
        <button
          type="button"
          onClick={() => onContinue(stepId, transcriptId)}
          disabled={disabled}
          className="rounded-full bg-[#16A34A] px-3 py-1 text-xs font-semibold text-white hover:bg-[#15803D] disabled:opacity-50 transition-colors"
        >
          {t('workflow.continueCard.confirm', { defaultValue: 'Continue' })}
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
  tokenUsage,
  isLoadingTokenUsage,
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
  onRetryStep?: (stepId: string, retryTarget?: 'task' | 'review') => void;
  pendingActionId?: string | null;
  transcriptEntries: WorkflowTranscriptEntry[];
  isLoadingTranscript: boolean;
  tokenUsage: WorkflowStepTokenEntry | null;
  isLoadingTokenUsage: boolean;
  activeTab: ExecutionRecordTab;
  onActiveTabChange: (tab: ExecutionRecordTab) => void;
}) {
  const { t } = useAppTranslation();
  const instruction =
    planNode?.data.instructions?.trim() ||
    t('workflow.inspector.noInstructions', {
      defaultValue: 'No task instructions were provided for this step.',
    });
  const summaryText =
    step.summary_text?.trim() ||
    t('workflow.inspector.noSummary', {
      defaultValue: 'No summary has been generated for this step yet.',
    });
  const localizedLatestReviewFeedback = latestReviewFeedback
    ? localizeWorkflowGeneratedText(latestReviewFeedback, t)
    : latestReviewFeedback;
  const localizedLatestReviewLabel = latestReviewLabel
    ? localizeWorkflowGeneratedText(latestReviewLabel, t)
    : latestReviewLabel;
  const loopName = loop?.loop_key?.trim() ?? '';
  const isFailed = WORKFLOW_FAILURE_STEP_STATUSES.has(step.status);
  const isCompleted = step.status === 'completed';
  const hasError = isFailed;
  const leadReviewRequired = step.lead_review_required;
  const canRetryReviewStep = canRetryWorkflowStepReview(step);
  const hasFooterActions =
    step.status === 'running' ||
    step.status === 'waiting_review' ||
    step.status === 'waiting_input' ||
    step.status === 'pre_completed' ||
    isFailed;

  const streamEntries = useMemo(
    () =>
      transcriptEntries.filter((entry) =>
        isWorkflowRuntimeThinkingEntry(entry) ||
        isWorkflowRuntimeErrorEntry(entry)
      ),
    [transcriptEntries]
  );
  const agentLogGroups = useMemo(
    () =>
      Array.from(
        streamEntries
          .reduce((groups, entry) => {
            const groupAgentName = entry.agent_name?.trim() || agentName;
            const groupKey = `${step.id}::${groupAgentName}`;
            const existing = groups.get(groupKey);
            const content = (
              getLocalizedTranscriptMarkdown(entry, t) ??
              localizeWorkflowGeneratedText(entry.content, t)
            ).trim();
            if (!content) return groups;
            const line = {
              key: entry.id,
              timestamp: formatWorkflowLogTimestamp(entry.created_at),
              content,
              entryType: entry.entry_type,
            };
            if (existing) {
              existing.lines.push(line);
            } else {
              groups.set(groupKey, {
                key: groupKey,
                agentName: groupAgentName,
                lines: [line],
              });
            }
            return groups;
          }, new Map<string, { key: string; agentName: string; lines: Array<{ key: string; timestamp: string; content: string; entryType?: string }> }>())
          .values()
      ),
    [agentName, step.id, streamEntries, t]
  );
  const outputEntries = useMemo(
    () =>
      transcriptEntries.filter(
        (entry) =>
          !isWorkflowRuntimeThinkingEntry(entry) &&
          !isWorkflowRuntimeErrorEntry(entry) &&
          !isWorkflowStepLifecycleStartEntry(entry)
      ),
    [transcriptEntries]
  );
  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="w-full h-full bg-[var(--surface-2)] shadow-none rounded-none border-none flex flex-col relative overflow-hidden"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 text-[rgba(255,255,255,0.4)] hover:text-[#A0A5B1] rounded-md transition-colors z-20"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center select-none shrink-0 pt-3 px-6 gap-1 relative z-10">
        <button
          type="button"
          onClick={() => onActiveTabChange('DETAILS')}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors',
            activeTab === 'DETAILS'
              ? 'text-[var(--ink)] bg-[var(--surface-3)]'
              : 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          {t('workflow.inspector.tabDetails', { defaultValue: 'Details' })}
        </button>
        <button
          type="button"
          onClick={() => onActiveTabChange('LOGS')}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors',
            activeTab === 'LOGS'
              ? 'text-[var(--ink)] bg-[var(--surface-3)]'
              : 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
          )}
        >
          <ScrollText className="h-3.5 w-3.5" />
          {t('workflow.inspector.tabLogs', { defaultValue: 'Logs' })}
        </button>
        <div className="flex-grow flex justify-end pb-1 h-full py-2 pr-6">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider border',
              (step.status === 'failed' || step.status === 'interrupted')
                ? 'bg-[rgba(229,72,77,0.1)] text-[#F2555A] border-[rgba(229,72,77,0.2)]'
                : (step.status === 'running' || step.status === 'revising')
                  ? 'bg-[rgba(94,106,210,0.1)] text-[#8B95E9] border-[rgba(94,106,210,0.2)]'
                  : (step.status === 'completed' || step.status === 'pre_completed')
                    ? 'bg-[rgba(46,160,67,0.1)] text-[#4ADE80] border-[rgba(46,160,67,0.2)]'
                    : (step.status === 'waiting_review' || step.status === 'waiting_input')
                      ? 'bg-[rgba(139,92,246,0.1)] text-[#A78BFA] border-[rgba(139,92,246,0.2)]'
                      : 'bg-[rgba(255,255,255,0.04)] text-[#8A8F98] border-[rgba(255,255,255,0.08)]'
            )}
          >
            {(step.status === 'failed' || step.status === 'interrupted') && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#E5484D] animate-pulse" />
            )}
            {(step.status === 'running' || step.status === 'revising') && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#5E6AD2] animate-pulse" />
            )}
            {(step.status === 'completed' || step.status === 'pre_completed') && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" />
            )}
            {(step.status === 'waiting_review' || step.status === 'waiting_input') && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6] animate-pulse" />
            )}
            {workflowStatusLabel(step.status, t)}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'DETAILS' ? (
          <div className="absolute inset-0 p-8 overflow-y-auto bg-[var(--surface-2)]">
            <h2 className="text-[17px] font-semibold mb-3 text-[#F3F6FB] tracking-[-0.01em]">
              {step.title}
            </h2>

            <div className="mb-8 flex flex-wrap items-center gap-2 text-[10px] leading-[1.4] text-[#8A8F98] font-normal">
              <span className="inline-flex items-center gap-1">
                <Bot className="w-3 h-3" /> {agentName}
              </span>
              <span className="w-[3px] h-[3px] rounded-full bg-[#3A3B3E]"></span>
              <span>{step.step_type}</span>
              {loopName && (
                <>
                  <span className="w-[3px] h-[3px] rounded-full bg-[#3A3B3E]"></span>
                  <span>
                    {t('workflow.inspector.loopPrefix', {
                      name: loopName,
                      defaultValue: `Loop: ${loopName}`,
                    })}
                  </span>
                </>
              )}
              {reviewPhase && (
                <>
                  <span className="w-[3px] h-[3px] rounded-full bg-[#3A3B3E]"></span>
                  <span>
                    {t('workflow.inspector.reviewPrefix', {
                      label: reviewPhase.label,
                      defaultValue: `Review: ${reviewPhase.label}`,
                    })}
                  </span>
                </>
              )}
            </div>

            <WorkflowStepTokenUsageStrip
              usage={tokenUsage}
              loading={isLoadingTokenUsage}
            />

            <div className="mt-0">
              <h3 className="text-[14px] font-semibold text-[var(--ink)] tracking-normal mb-3">
                {t('workflow.inspector.instructionHeading', {
                  defaultValue: 'Instruction',
                })}
              </h3>
              <div className="pl-0 pt-1">
                <ChatMarkdown
                  content={instruction}
                  maxWidth="100%"
                  textClassName={workflowDetailMarkdownTextClassName}
                  className="w-full select-text"
                />
              </div>
            </div>

            {(isFailed || isCompleted) && (
              <div className="mt-10 pt-10 border-t border-[rgba(255,255,255,0.06)]">
                <h3 className="text-[14px] font-semibold text-[var(--ink)] tracking-normal mb-3">
                  {t('workflow.inspector.summaryHeading', {
                    defaultValue: 'Summary',
                  })}
                </h3>
                <div className="pl-0 pt-1">
                  <ChatMarkdown
                    content={summaryText}
                    maxWidth="100%"
                    textClassName={workflowDetailMarkdownTextClassName}
                    className="w-full select-text"
                  />
                </div>
              </div>
            )}

            {latestReviewLabel && (
              <div className="mt-10 pt-10 border-t border-[rgba(255,255,255,0.06)]">
                <h3 className="text-[14px] font-semibold text-[var(--ink)] tracking-normal mb-3">
                  {t('workflow.inspector.feedbackHeading', {
                    defaultValue: 'Feedback',
                  })}
                </h3>
                <div className="bg-[var(--surface-2)] border border-[var(--hairline)] rounded-xl p-4">
                  <ChatMarkdown
                    content={
                      localizedLatestReviewFeedback ||
                      localizedLatestReviewLabel ||
                      ''
                    }
                    maxWidth="100%"
                    textClassName={workflowDetailMarkdownTextClassName}
                    className="w-full select-text"
                  />
                </div>
              </div>
            )}

            <div className="mt-10 pt-10 border-t border-[rgba(255,255,255,0.06)]">
              <h3 className="text-[14px] font-semibold text-[var(--ink)] tracking-normal mb-3">
                {t('workflow.inspector.executionRecordHeading', {
                  defaultValue: 'Execution Record Output',
                })}
              </h3>
              <div className="text-[13px] text-slate-600 leading-relaxed">
                {isLoadingTranscript ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('workflow.inspector.loadingTranscript', {
                      defaultValue: 'Loading transcript...',
                    })}
                  </div>
                ) : outputEntries.length > 0 ? (
                  <div className="space-y-6">
                    {outputEntries.map((entry) => {
                      const markdownContent = getLocalizedTranscriptMarkdown(
                        entry,
                        t
                      );
                      const OutputIcon = getWorkflowOutputEntryIcon(entry);
                      const outputAgentName =
                        entry.entry_type === 'message' ||
                        entry.entry_type === 'output'
                          ? entry.agent_name?.trim() || undefined
                          : isWorkflowReviewEntry(entry)
                            ? getWorkflowReviewAgentName(entry, 'Reviewer', t)
                            : null;
                      const outputLabel =
                        outputAgentName || getWorkflowOutputEntryLabel(entry);
                      return (
                        <div
                          key={entry.id}
                          className="flex gap-3"
                        >
                          <span
                            className={cn(
                              'mt-0.5 shrink-0',
                              getWorkflowOutputEntryIconClass(entry)
                            )}
                          >
                            <OutputIcon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 text-[11px] font-medium text-[#8A8F98]">
                              {outputLabel}
                            </div>
                            <ChatMarkdown
                              content={
                                markdownContent ||
                                localizeWorkflowGeneratedText(entry.content, t)
                              }
                              maxWidth="100%"
                              textClassName={
                                entry.entry_type === 'error'
                                  ? 'font-mono text-[12px] leading-[1.5] text-[#6E7681] [&_pre]:bg-transparent [&_pre]:border-0 [&_pre]:p-0 [&_pre]:m-0 [&_pre_code]:text-[#6E7681]'
                                  : workflowDetailMarkdownTextClassName
                              }
                              className={cn(
                                'w-full select-text',
                                entry.entry_type === 'error' && 'max-h-40 overflow-y-auto'
                              )}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    {t('workflow.inspector.noOutputEntries', {
                      defaultValue: 'No output entries for this step yet.',
                    })}
                  </div>
                )}
              </div>
            </div>

            {hasError && (
              <div className="mt-10 pt-10 border-t border-[rgba(255,255,255,0.06)]">
                <h3 className="text-[14px] font-semibold text-[#E5484D] tracking-normal mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {t('workflow.inspector.errorHeading', {
                    defaultValue: 'Error',
                  })}
                </h3>
                <div className="max-h-48 overflow-y-auto font-mono text-[12px] leading-[1.5] text-[#6E7681] whitespace-pre-wrap break-all">
                  <ChatMarkdown
                    content={summaryText}
                    maxWidth="100%"
                    textClassName="font-mono text-[12px] leading-[1.5] text-[#6E7681] [&_pre]:bg-transparent [&_pre]:border-0 [&_pre]:p-0 [&_pre]:m-0 [&_pre_code]:text-[#6E7681]"
                    className="w-full select-text"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0">
            <WorkflowAgentLogPanel
              agentLogGroups={agentLogGroups}
              isLoading={isLoadingTranscript}
              stepStatus={step.status}
              emptyMessage={t('workflow.inspector.noLogs', {
                defaultValue: 'No logs for this step yet.',
              })}
              loadingMessage={t('workflow.inspector.loadingLogs', {
                defaultValue: 'Loading logs...',
              })}
            />
          </div>
        )}
      </div>

      {hasFooterActions && (
        <footer className="px-5 py-2.5 shrink-0 border-t border-[var(--hairline)] flex items-center gap-3 relative z-10">
          {/* Open Chat */}
          <button
            type="button"
            onClick={onOpenChat}
            className={cn(
              'flex-none flex items-center gap-1.5 text-[12px] font-medium transition-colors',
              isChatVisible
                ? 'text-[var(--primary)]'
                : 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
            )}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {isChatVisible
              ? t('workflow.inspector.closeChat', {
                  defaultValue: 'Close Chat',
                })
              : t('workflow.inspector.openChat', { defaultValue: 'Open Chat' })}
          </button>

          {/* Right-side action buttons */}
          <div className="flex-1 flex gap-3 justify-end">
            {(step.status === 'running' ||
              step.status === 'waiting_review' ||
              step.status === 'waiting_input') &&
              (onInterruptStep || onStopStep) && (
                <button
                  type="button"
                  onClick={() => {
                    if (onInterruptStep) {
                      onInterruptStep(step.id);
                      return;
                    }
                    onStopStep?.(step.id);
                  }}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-[#E5484D] hover:text-[#F2555A] transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  {t('workflow.inspector.terminate', {
                    defaultValue: 'Terminate',
                  })}
                </button>
              )}
            {isRetryableWorkflowStepStatus(step.status) &&
              onRetryStep &&
              (leadReviewRequired ? (
                <>
                  <button
                    type="button"
                    onClick={() => onRetryStep(step.id)}
                    disabled={pendingActionId === step.id}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
                  >
                    <RotateCcw
                      className={cn(
                        'w-3.5 h-3.5',
                        pendingActionId === step.id && 'animate-spin'
                      )}
                    />
                    {t('workflow.inspector.retryTask', {
                      defaultValue: 'Retry task',
                    })}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!canRetryReviewStep) return;
                      onRetryStep(step.id, 'review');
                    }}
                    disabled={
                      pendingActionId === step.id || !canRetryReviewStep
                    }
                    className={cn(
                      'flex items-center gap-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      canRetryReviewStep
                        ? 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
                        : 'text-[var(--ink-tertiary)]'
                    )}
                  >
                    <RotateCcw
                      className={cn(
                        'w-3.5 h-3.5',
                        pendingActionId === step.id && 'animate-spin'
                      )}
                    />
                    {t('workflow.inspector.retryReview', {
                      defaultValue: 'Retry review',
                    })}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onRetryStep(step.id)}
                  disabled={pendingActionId === step.id}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
                >
                  <RotateCcw
                    className={cn(
                      'w-3.5 h-3.5',
                      pendingActionId === step.id && 'animate-spin'
                    )}
                  />
                  {t('workflow.inspector.retry', { defaultValue: 'Retry' })}
                </button>
              ))}
          </div>
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
  pendingReview,
  pendingInput,
  pendingActionId,
  onApproval,
  onRespondPendingReview,
  onClose,
  onSendInput,
  canSendInput,
}: {
  step: WorkflowCardStep;
  agentName: string;
  entries: WorkflowTranscriptEntry[];
  pendingReview?: WorkflowCardData['pending_review'];
  pendingInput?: WorkflowCardData['pending_input'];
  pendingActionId?: string | null;
  onApproval?: (
    stepId: string,
    action: string,
    transcriptId: string,
    inputText?: string
  ) => void;
  onRespondPendingReview?: (
    reviewId: string,
    action: 'approve' | 'reject',
    feedback?: string,
    expectedStepId?: string
  ) => void;
  onClose: () => void;
  onSendInput?: (stepId: string, inputText: string) => void;
  canSendInput: boolean;
}) {
  const { t } = useAppTranslation();
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const outputEntries = useMemo(
    () => entries.filter(isWorkflowChatPanelEntry),
    [entries]
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputEntries.length]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !onSendInput || !canSendInput) return;
    onSendInput(step.id, trimmed);
    setInputText('');
  };

  return (
    <div className="w-[340px] bg-[var(--surface-2)] h-full border-none flex flex-col">
      <div className="p-4 border-b border-[var(--hairline)] bg-[var(--surface-1)] flex items-center gap-3 shrink-0">
        <div className="w-7 h-7 rounded-md border border-[rgba(255,255,255,0.12)] flex items-center justify-center text-[var(--ink-subtle)] shrink-0">
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-xs truncate">
            {t('workflow.chatPanel.title', {
              defaultValue: 'Agent Conversation',
            })}
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
          const isReviewEntry = isWorkflowReviewEntry(entry);
          const isUser = entry.message_type === 'user' && !isReviewEntry;
          const markdownContent = getLocalizedTranscriptMarkdown(entry, t);
          const entryAgentName =
            !isUser && isReviewEntry
              ? getWorkflowReviewAgentName(entry, agentName, t)
              : !isUser && entry.agent_name?.trim()
                ? entry.agent_name.trim()
                : null;

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
                    ? t('workflow.chatPanel.approvalRequired', {
                        defaultValue: 'Approval Required',
                      })
                    : entry.entry_type === 'permission_request'
                      ? t('workflow.chatPanel.permissionRequest', {
                          defaultValue: 'Permission Request',
                        })
                      : t('workflow.chatPanel.continuePrompt', {
                          defaultValue: 'Continue?',
                        })}
                </div>
                <p className="text-[11px] text-slate-600 mb-3 leading-relaxed font-medium">
                  {localizeWorkflowGeneratedText(entry.content, t)}
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
                        ? t('workflow.chatPanel.continueAction', {
                            defaultValue: 'CONTINUE',
                          })
                        : t('workflow.chatPanel.approveAction', {
                            defaultValue: 'APPROVE',
                          })}
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
                        {t('workflow.chatPanel.rejectAction', {
                          defaultValue: 'REJECT',
                        })}
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
                  <div className="w-4 h-4 rounded-[3px] border border-[rgba(255,255,255,0.1)] flex items-center justify-center text-[7px] font-medium text-[var(--ink-subtle)] shrink-0">
                    {entryAgentName.substring(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {entryAgentName}
                  </span>
                  {isReviewEntry && (
                    <span className="rounded-[3px] border border-[rgba(255,255,255,0.1)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--ink-subtle)]">
                      {t('workflow.chatPanel.reviewOutput', {
                        defaultValue: 'Review',
                      })}
                    </span>
                  )}
                </div>
              )}
              <div
                className={cn(
                  'text-xs leading-relaxed',
                  isUser
                    ? 'max-w-[85%] p-3 bg-[#5094fb] text-white rounded-2xl rounded-tr-none shadow-sm'
                    : 'w-full py-2 bg-transparent text-slate-800'
                )}
              >
                {isUser ? (
                  localizeWorkflowGeneratedText(entry.content, t)
                ) : markdownContent ? (
                  <ChatMarkdown
                    content={markdownContent}
                    maxWidth="100%"
                    textClassName={workflowDetailMarkdownTextClassName}
                    className="w-full select-text"
                  />
                ) : (
                  <span className="text-[13px]">
                    {localizeWorkflowGeneratedText(entry.content, t)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 p-4 bg-white border-t border-slate-200 shrink-0">
        {pendingReview && (
          <div className="max-h-[45vh] overflow-y-auto rounded-xl">
            <WorkflowPendingReviewCard
              pendingReview={pendingReview}
              pendingActionId={pendingActionId}
              onSubmit={
                onRespondPendingReview
                  ? (action, feedback) =>
                      onRespondPendingReview(
                        pendingReview.review_id,
                        action,
                        feedback,
                        step.id
                      )
                  : undefined
              }
            />
          </div>
        )}
        {pendingInput && (
          <WorkflowPendingInputCard
            pendingInput={pendingInput}
            pendingActionId={pendingActionId}
            onSubmit={onSendInput}
          />
        )}
        {!pendingInput && (
          <div className="relative">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                canSendInput
                  ? t('workflow.chatPanel.replyPlaceholder', {
                      defaultValue: 'Reply to agent...',
                    })
                  : t('workflow.chatPanel.readOnlyPlaceholder', {
                      defaultValue:
                        'Read-only until this step is waiting for input or review.',
                    })
              }
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
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Workflow Window (Full-Page Layout)
// -----------------------------------------------------------------------

export function WorkflowWindow({
  sessionId,
  sessionTitle,
  projection,
  finalReviewAction = null,
  runtimeMessages = [],
  isOpen,
  onClose,
  onExecute,
  onPauseAll,
  onResume,
  onInterruptStep,
  onStopStep,
  onRetryStep,
  onUpdateReviewSettings,
  onSubmitStepInput,
  onApproval,
  onRespondPendingReview,
  onSubmitIterationFeedback,
  pendingActionId,
}: WorkflowWindowProps) {
  const { t } = useAppTranslation();
  const { showToast } = useWorkspace();
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [openedReviewNotificationId, setOpenedReviewNotificationId] = useState<
    string | null
  >(null);
  const [executionRecordTab, setExecutionRecordTab] =
    useState<ExecutionRecordTab>('DETAILS');
  const [runtimeInputTranscripts, setRuntimeInputTranscripts] = useState<
    WorkflowTranscriptEntry[]
  >([]);
  const [isReviewSettingsOpen, setIsReviewSettingsOpen] = useState(false);
  const [reviewSettingsError, setReviewSettingsError] = useState<string | null>(
    null
  );
  const [isSavingReviewSettings, setIsSavingReviewSettings] = useState(false);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState<number | null>(
    null
  );
  const initializedWorkflowKeyRef = useRef<string | null>(null);
  const previousExecutionIdRef = useRef<string | null>(null);

  const roundGraphs = useMemo(
    () =>
      [...(projection.round_graphs ?? [])].sort(
        (left, right) => left.round_index - right.round_index
      ),
    [projection.round_graphs]
  );
  const defaultRoundIndex = useMemo(
    () =>
      roundGraphs.find(
        (graph) => graph.round_index === projection.current_round
      )?.round_index ??
      roundGraphs.at(-1)?.round_index ??
      projection.current_round,
    [projection.current_round, roundGraphs]
  );

  useEffect(() => {
    setSelectedRoundIndex(defaultRoundIndex);
  }, [
    defaultRoundIndex,
    projection.execution_id,
    projection.plan_id,
    projection.current_round,
  ]);

  const selectedRoundGraph = useMemo(() => {
    const targetRound = selectedRoundIndex ?? defaultRoundIndex;
    return (
      roundGraphs.find((graph) => graph.round_index === targetRound) ??
      roundGraphs.find(
        (graph) => graph.round_index === projection.current_round
      ) ??
      null
    );
  }, [
    defaultRoundIndex,
    projection.current_round,
    roundGraphs,
    selectedRoundIndex,
  ]);
  const currentRoundGraph = useMemo(
    () =>
      roundGraphs.find(
        (graph) => graph.round_index === projection.current_round
      ) ?? null,
    [projection.current_round, roundGraphs]
  );
  const graphPlan = selectedRoundGraph?.plan ?? projection.plan;
  const graphSteps = selectedRoundGraph?.steps ?? projection.steps;
  const graphLoops = useMemo(
    () => selectedRoundGraph?.loops ?? projection.loops ?? [],
    [projection.loops, selectedRoundGraph?.loops]
  );
  const visibleRoundIndex =
    selectedRoundGraph?.round_index ?? projection.current_round;
  const isViewingCurrentRound =
    !selectedRoundGraph ||
    selectedRoundGraph.round_index === projection.current_round;
  const currentRoundSteps = currentRoundGraph?.steps ?? projection.steps;
  const selectedRoundStepProgress = getStepProgress(graphSteps);

  useEffect(() => {
    if (isViewingCurrentRound) return;
    setActiveNodeId(null);
    setIsChatVisible(false);
  }, [isViewingCurrentRound]);

  const isPreview =
    projection.state === 'preview_ready' ||
    projection.state === 'preview_invalid';
  const canPauseExecution = canPauseWorkflowExecution(projection);
  const canResumeExecution = canResumeWorkflowExecution(projection);
  const isExecutionRecompiling = isWorkflowExecutionRecompiling(projection);
  const executionStatusLabel = workflowExecutionStatusLabel(
    projection.execution_status,
    t
  );
  const normalizedResultSummary = projection.result_summary?.trim() ?? '';
  const normalizedErrorMessage = projection.error_message?.trim() ?? '';
  const hasWorkflowCompleted =
    projection.state === 'completed' ||
    projection.execution_status === 'completed';
  const hasWorkflowFailed =
    projection.state === 'failed' || projection.execution_status === 'failed';
  const pendingReviews = useMemo(
    () => getPendingReviews(projection),
    [projection]
  );
  const hasPendingReview =
    pendingReviews.length > 0 ||
    projection.steps.some((step) => step.status === 'waiting_review');
  const isReviewSettingsLocked =
    hasWorkflowCompleted ||
    hasWorkflowFailed ||
    isExecutionRecompiling ||
    projection.state === 'running' ||
    projection.execution_status === 'running' ||
    projection.state === 'waiting' ||
    projection.execution_status === 'waiting' ||
    hasPendingReview;
  const reviewSettingsDisabled =
    isReviewSettingsLocked || isSavingReviewSettings || !onUpdateReviewSettings;
  const reviewSettingsDisplayError =
    reviewSettingsError ??
    (isReviewSettingsLocked
      ? t('workflow.reviewSettings.finishedMessage', {
          defaultValue:
            'Review settings cannot be modified in the current workflow state.',
        })
      : null);
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
    () => new Map(graphSteps.map((step) => [step.step_key, step])),
    [graphSteps]
  );
  const stepById = useMemo(
    () => new Map(currentRoundSteps.map((step) => [step.id, step])),
    [currentRoundSteps]
  );
  const planNodeById = useMemo(
    () => new Map(graphPlan.nodes.map((node) => [node.id, node])),
    [graphPlan.nodes]
  );
  const workflowLoops = useMemo(() => graphLoops, [graphLoops]);
  const loopByKey = useMemo(
    () => new Map(workflowLoops.map((loop) => [loop.loop_key, loop])),
    [workflowLoops]
  );
  const workflowInstanceKey = useMemo(
    () => `${projection.execution_id ?? ''}::${projection.plan_id ?? ''}`,
    [projection.execution_id, projection.plan_id]
  );

  useEffect(() => {
    if (isReviewSettingsOpen) {
      setReviewSettingsError(null);
    }
  }, [isReviewSettingsOpen, projection.execution_id]);

  const handleSaveReviewSettings = useCallback(
    async (overrides: WorkflowReviewSettingOverride[]) => {
      if (!projection.execution_id || !onUpdateReviewSettings) return;
      if (isReviewSettingsLocked) {
        setReviewSettingsError(
          t('workflow.reviewSettings.finishedMessage', {
            defaultValue:
              'Review settings cannot be modified in the current workflow state.',
          })
        );
        return;
      }
      setReviewSettingsError(null);
      setIsSavingReviewSettings(true);
      try {
        await onUpdateReviewSettings(projection.execution_id, overrides);
        setIsReviewSettingsOpen(false);
        showToast(
          t('workflow.reviewSettings.savedToast', {
            defaultValue: 'Review settings saved.',
          })
        );
      } catch (error) {
        setReviewSettingsError(getReviewSettingsErrorMessage(error, t));
      } finally {
        setIsSavingReviewSettings(false);
      }
    },
    [
      isReviewSettingsLocked,
      onUpdateReviewSettings,
      projection.execution_id,
      showToast,
      t,
    ]
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
  const runningStatusSummary = [
    executionStatusLabel,
    `${progressPercent}%`,
    `${projection.completed_step_count}/${projection.total_step_count} steps`,
  ].join(' - ');

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
    () => (activeNodeId ? (stepByKey.get(activeNodeId) ?? null) : null),
    [activeNodeId, stepByKey]
  );
  const activePlanNode = activeNodeId
    ? (planNodeById.get(activeNodeId) ?? null)
    : null;
  const activeStepLoop = activeStep?.loop_key
    ? (loopByKey.get(activeStep.loop_key) ?? null)
    : null;
  const activeStepReviewPhase = workflowReviewPhaseMeta(
    activeStep?.review_phase,
    t
  );
  const activeStepLatestReview = activeStep?.latest_review ?? null;
  const activeStepLatestReviewLabel = workflowLatestReviewLabel(
    activeStepLatestReview,
    t
  );
  const activeStepLatestReviewFeedback = workflowLatestReviewFeedback(
    activeStepLatestReview
  );
  const transcriptWithLocalInputs = useMemo(
    () => mergeAndSortTranscriptEntries(runtimeInputTranscripts),
    [runtimeInputTranscripts]
  );

  // Transcript for inspector card
  const {
    data: activeStepTranscriptData,
    isLoading: isLoadingActiveStepTranscript,
  } = useQuery({
    queryKey: [
      'workflowStepTranscripts',
      sessionId,
      projection.execution_id,
      activeStep?.id,
      activeStep?.step_key,
    ],
    queryFn: () => {
      if (!sessionId || !projection.execution_id || !activeStep?.id) return [];
      return chatApi.getWorkflowStepTranscripts(sessionId, activeStep.id, {
        stepKey: activeStep.step_key,
      });
    },
    enabled:
      !!sessionId &&
      !!projection.execution_id &&
      !!activeStep?.id &&
      !isPreview &&
      isOpen,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: getWorkflowTranscriptRefetchInterval({
      isOpen:
        isOpen &&
        !isPreview &&
        !!sessionId &&
        !!projection.execution_id &&
        !!activeStep?.id,
      projection,
    }),
  });

  const {
    data: activeStepTokenUsageData,
    isLoading: isLoadingActiveStepTokenUsage,
  } = useQuery({
    queryKey: ['workflowStepTokenUsage', sessionId, activeStep?.id],
    queryFn: () => {
      if (!sessionId || !activeStep?.id) return { usage: null };
      return chatApi.getWorkflowStepTokenUsage(sessionId, activeStep.id);
    },
    enabled: !!sessionId && !!activeStep?.id && !isPreview && isOpen,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });

  const activeStepFallbackTranscript = useMemo(() => {
    if (!activeStep) return [];
    return transcriptWithLocalInputs.filter(
      (entry) =>
        entry.step_id === activeStep.id ||
        entry.step_key === activeStep.step_key
    );
  }, [activeStep, transcriptWithLocalInputs]);

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
    const stepReviewEntries = activeStep
      ? buildStepReviewTranscriptEntries(activeStep, mergedEntries)
      : [];
    return mergeAndSortTranscriptEntries(mergedEntries, stepReviewEntries);
  }, [activeStep, activeStepTranscriptData, transcriptWithLocalInputs]);

  const activeRuntimeTranscript = useMemo(() => {
    if (!activeStep || runtimeMessages.length === 0) return [];
    return runtimeMessages
      .filter(
        (message) =>
          message.stepId === activeStep.id ||
          message.stepKey === activeStep.step_key
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
            message.streamType === 'assistant' ? 'message' : message.streamType,
          content: message.content,
          meta_json: JSON.stringify({
            source: 'workflow_runtime_stream',
          }),
          created_at: message.createdAt,
        })
      );
  }, [activeStep, runtimeMessages]);

  const rawVisibleActiveTranscript =
    activeStepScopedTranscript.length > 0 || activeRuntimeTranscript.length > 0
      ? mergeAndSortTranscriptEntries(
          activeStepScopedTranscript,
          activeRuntimeTranscript
        )
      : activeStepFallbackTranscript;
  const visibleActiveTranscript = rawVisibleActiveTranscript;

  // Final review & iteration
  const allStepViewsCompleted =
    projection.steps.length > 0 &&
    projection.steps.every((step) =>
      REVIEW_READY_STEP_STATUSES.has(step.status)
    );
  const isWaitingForFinalReview =
    !isPreview &&
    (projection.state === 'waiting' ||
      projection.execution_status === 'waiting');
  const canReviewCurrentRound =
    isWaitingForFinalReview && (!!finalReviewAction || allStepViewsCompleted);

  const getPendingReviewStep = useCallback(
    (pendingReview: NonNullable<WorkflowCardData['pending_review']>) => {
      const directStep = stepById.get(pendingReview.target_id);
      if (directStep) return directStep;

      const loop = workflowLoops.find(
        (item) => item.id === pendingReview.target_id
      );
      if (!loop) return null;

      return stepById.get(loop.review_step_id) ?? null;
    },
    [stepById, workflowLoops]
  );
  const getPendingReviewNodeId = useCallback(
    (pendingReview: NonNullable<WorkflowCardData['pending_review']>) =>
      getPendingReviewStep(pendingReview)?.step_key,
    [getPendingReviewStep]
  );

  // Notification items from pending reviews
  const notifications = useMemo(() => {
    const items: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      nodeId?: string;
      stepId?: string;
    }> = [];

    for (const pendingReview of pendingReviews) {
      const reviewStep = getPendingReviewStep(pendingReview);
      const nodeId = reviewStep?.step_key;
      if (
        openedReviewNotificationId === pendingReview.review_id &&
        isChatVisible &&
        activeNodeId === nodeId
      ) {
        continue;
      }

      items.push({
        id: pendingReview.review_id,
        type: pendingReview.review_type,
        title: pendingReview.target_title,
        message:
          (pendingReview.prompt_template.message
            ? localizeWorkflowGeneratedText(
                pendingReview.prompt_template.message,
                t
              )
            : null) ||
          t('workflow.notifications.reviewRequired', {
            defaultValue: 'Review required',
          }),
        nodeId,
        stepId: reviewStep?.id,
      });
    }

    if (
      projection.pending_input &&
      !(
        openedReviewNotificationId === projection.pending_input.input_id &&
        isChatVisible &&
        activeNodeId === projection.pending_input.step_key
      )
    ) {
      items.push({
        id: projection.pending_input.input_id,
        type: 'input_request',
        title: projection.pending_input.target_title,
        message:
          projection.pending_input.prompt ||
          t('workflow.notifications.inputRequired', {
            defaultValue: 'Input required',
          }),
        nodeId: projection.pending_input.step_key,
      });
    }

    if (
      finalReviewAction &&
      openedReviewNotificationId !== finalReviewAction.transcriptId
    ) {
      items.push({
        id: finalReviewAction.transcriptId,
        type: 'final_review',
        title: t('workflow.notifications.finalReviewTitle', {
          defaultValue: 'Final Review',
        }),
        message: finalReviewAction.message,
      });
    }

    return items;
  }, [
    activeNodeId,
    getPendingReviewStep,
    isChatVisible,
    openedReviewNotificationId,
    pendingReviews,
    finalReviewAction,
    projection.pending_input,
    t,
  ]);

  const openStepDetails = useCallback(
    (id: string, options?: { forceChat?: boolean }) => {
      if (!stepByKey.has(id)) return;
      const step = stepByKey.get(id);
      setActiveNodeId(id);
      setIsChatVisible(
        (current) =>
          current ||
          !!options?.forceChat ||
          canWorkflowStepAcceptChatInput(step)
      );
    },
    [stepByKey]
  );

  const handleNodeClick = useCallback(
    (id: string) => {
      openStepDetails(id);
    },
    [openStepDetails]
  );

  const openPendingReviewInChat = useCallback(
    (notificationId: string, nodeId?: string) => {
      setOpenedReviewNotificationId(notificationId);

      if (nodeId) {
        openStepDetails(nodeId, { forceChat: true });
      }
    },
    [openStepDetails]
  );

  const activeStepPendingReview = activeNodeId
    ? (pendingReviews.find(
        (pendingReview) =>
          getPendingReviewNodeId(pendingReview) === activeNodeId
      ) ?? null)
    : null;
  const activeStepPendingInput =
    activeStep && projection.pending_input?.step_id === activeStep.id
      ? projection.pending_input
      : null;

  const handleSendStepInput = useCallback(
    (stepId: string, inputText: string) => {
      if (!onSubmitStepInput) return;
      const step = stepById.get(stepId);
      if (!step) return;
      if (!canWorkflowStepAcceptChatInput(step)) return;
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
    [onSubmitStepInput, resolveStepAgentId, stepById]
  );

  if (!isOpen) return null;

  const windowContent = (
    <div className="workflow-window-root flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)] font-sans text-slate-900 rounded-lg">
      {/* Header */}
      <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px] z-20">
        <div className="flex min-w-0 items-center gap-[7px]">
          <Box
            aria-hidden="true"
            className="h-[16px] w-[16px] shrink-0 text-[var(--primary)]"
            strokeWidth={2}
          />
          <ChevronRight
            aria-hidden="true"
            className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
            strokeWidth={2.4}
          />
          <button
            type="button"
            className="max-w-[10ch] truncate text-[16px] font-semibold leading-none text-[var(--ink)] transition hover:text-[var(--ink)]"
            onClick={onClose}
            title={sessionTitle || projection.title}
          >
            {(sessionTitle || projection.title || '').slice(0, 10)}
          </button>
          <ChevronRight
            aria-hidden="true"
            className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
            strokeWidth={2.4}
          />
          <h1 className="truncate text-[16px] font-semibold leading-none text-[var(--ink)]">
            {t('workflow.breadcrumb.executionPlan', {
              defaultValue: 'Execution Plan',
            })}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Control buttons */}
          <div className="flex items-center gap-1">
            {isPreview && projection.plan_id && onExecute && (
              <button
                type="button"
                onClick={() => onExecute(projection)}
                className="p-1.5 rounded-md transition-all text-[#5E6AD2] hover:text-[#4850B8] hover:bg-[rgba(94,106,210,0.1)]"
                title={t('workflow.controls.executePlan', {
                  defaultValue: 'Execute Plan',
                })}
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
            )}
            {canResumeExecution && projection.execution_id && onResume && (
              <button
                type="button"
                onClick={() => onResume(projection.execution_id!, projection)}
                className="p-1.5 rounded-md transition-all text-[#5E6AD2] hover:text-[#4850B8] hover:bg-[rgba(94,106,210,0.1)]"
                title={t('workflow.controls.resume', {
                  defaultValue: 'Resume',
                })}
              >
                <Play className="w-4 h-4 fill-current" />
              </button>
            )}
            {canPauseExecution && projection.execution_id && onPauseAll && (
              <button
                type="button"
                onClick={() => onPauseAll(projection.execution_id!)}
                className="p-1.5 rounded-md transition-all text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--surface-3)]"
                title={t('workflow.controls.pauseAll', {
                  defaultValue: 'Pause All',
                })}
              >
                <Pause className="w-4 h-4" />
              </button>
            )}
            {projection.execution_id && onPauseAll && isRunning && (
              <button
                type="button"
                onClick={() => onPauseAll(projection.execution_id!)}
                className="p-1.5 rounded-md transition-all text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--surface-3)]"
                title={t('workflow.controls.stop', { defaultValue: 'Stop' })}
              >
                <Square className="w-4 h-4" />
              </button>
            )}
          </div>
          {projection.execution_id && onUpdateReviewSettings && (
            <button
              type="button"
              onClick={() => setIsReviewSettingsOpen((open) => !open)}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              title={t('workflow.reviewSettings.title', {
                defaultValue: 'Review settings',
              })}
              aria-label={t('workflow.reviewSettings.close', {
                defaultValue: 'Review settings',
              })}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative flex-1 overflow-hidden flex">
        <WorkflowReviewSettingsDialog
          projection={projection}
          isOpen={isReviewSettingsOpen}
          onClose={() => setIsReviewSettingsOpen(false)}
          onSubmit={handleSaveReviewSettings}
          submitLabel={t('workflow.reviewSettings.saveChanges', {
            defaultValue: 'Save Changes',
          })}
          submittingLabel={t('workflow.reviewSettings.saving', {
            defaultValue: 'Saving...',
          })}
          isSubmitting={isSavingReviewSettings}
          disabled={
            !projection.execution_id ||
            !onUpdateReviewSettings ||
            reviewSettingsDisabled
          }
          error={reviewSettingsDisplayError}
          variant="panel"
        />

        {/* Workflow Canvas */}
        <WorkflowGraphBoard
          nodes={graphPlan.nodes}
          edges={graphPlan.edges}
          steps={graphSteps}
          loops={graphLoops}
          planLoops={graphPlan.loops}
          agents={agents}
          selectedStepId={isViewingCurrentRound ? activeNodeId : undefined}
          onSelectStep={isViewingCurrentRound ? handleNodeClick : undefined}
          onRetryStep={isViewingCurrentRound ? onRetryStep : undefined}
          pendingActionId={pendingActionId}
          className="flex-1 min-w-0 h-full"
        />

        {/* Notifications Overlay */}
        <div className="absolute top-6 right-6 flex flex-col gap-3 z-50 pointer-events-none">
          <AnimatePresence>
            {notifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, x: 80, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 80, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="workflow-review-notification w-72 rounded-lg border border-[var(--workflow-notification-border)] bg-[var(--workflow-notification-bg)] [box-shadow:var(--workflow-notification-shadow)] pointer-events-auto relative overflow-hidden"
              >
                {/* Left status accent line */}
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--workflow-notification-accent)]" />

                <div className="p-3.5 pl-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--workflow-notification-accent)]" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--workflow-notification-label)]">
                        {notif.type === 'input_request'
                          ? t('workflow.notifications.pendingInput', {
                              defaultValue: 'Input Required',
                            })
                          : t('workflow.notifications.pendingReview', {
                              defaultValue: 'Pending Review',
                            })}
                      </span>
                    </span>
                    <span className="text-[10px] text-[var(--workflow-notification-badge-text)] border border-dashed border-[var(--workflow-notification-badge-border)] px-1.5 py-0.5 rounded">
                      {notif.type === 'final_review'
                        ? t('workflow.notifications.typeFinal', {
                            defaultValue: 'Final',
                          })
                        : notif.type === 'input_request'
                          ? t('workflow.notifications.typeInput', {
                              defaultValue: 'Input',
                            })
                          : t('workflow.notifications.typeStep', {
                              defaultValue: 'Step',
                            })}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="mb-3">
                    <p className="text-[13px] font-medium text-[var(--workflow-notification-title)] truncate leading-tight">
                      {notif.title}
                    </p>
                    <p className="text-[11px] text-[var(--workflow-notification-message)] mt-1 leading-snug line-clamp-2">
                      {notif.message}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {notif.type === 'final_review' && finalReviewAction ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenedReviewNotificationId(
                            finalReviewAction.transcriptId
                          )
                        }
                        disabled={
                          pendingActionId === finalReviewAction.executionId
                        }
                        className="flex-1 py-1.5 border border-[var(--workflow-notification-action-border)] text-[var(--workflow-notification-action-text)] rounded bg-transparent text-[10px] font-semibold uppercase tracking-[0.04em] hover:bg-[var(--workflow-notification-action-hover-bg)] hover:border-[var(--workflow-notification-action-hover-border)] transition-colors disabled:opacity-40"
                      >
                        {t('workflow.notifications.review', {
                          defaultValue: 'REVIEW',
                        })}
                      </button>
                    ) : notif.type === 'input_request' ? (
                      <button
                        type="button"
                        onClick={() =>
                          openPendingReviewInChat(notif.id, notif.nodeId)
                        }
                        className="flex-1 py-1.5 border border-[var(--workflow-notification-action-border)] text-[var(--workflow-notification-action-text)] rounded bg-transparent text-[10px] font-semibold uppercase tracking-[0.04em] hover:bg-[var(--workflow-notification-action-hover-bg)] hover:border-[var(--workflow-notification-action-hover-border)] transition-colors"
                      >
                        {t('workflow.notifications.respond', {
                          defaultValue: 'RESPOND',
                        })}
                      </button>
                    ) : onRespondPendingReview ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            onRespondPendingReview(
                              notif.id,
                              'approve',
                              undefined,
                              notif.stepId
                            )
                          }
                          disabled={pendingActionId === notif.id}
                          className="flex-1 py-1.5 border border-[var(--workflow-notification-action-border)] text-[var(--workflow-notification-action-text)] rounded bg-transparent text-[10px] font-semibold uppercase tracking-[0.04em] hover:bg-[var(--workflow-notification-action-hover-bg)] hover:border-[var(--workflow-notification-action-hover-border)] transition-colors disabled:opacity-40"
                        >
                          {t('workflow.notifications.approve', {
                            defaultValue: 'APPROVE',
                          })}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            openPendingReviewInChat(notif.id, notif.nodeId)
                          }
                          className="flex-1 py-1.5 text-[var(--workflow-notification-secondary-text)] rounded bg-[var(--workflow-notification-secondary-bg)] text-[10px] font-semibold uppercase tracking-[0.04em] hover:bg-[var(--workflow-notification-secondary-hover-bg)] hover:text-[var(--workflow-notification-secondary-hover-text)] transition-colors"
                        >
                          {t('workflow.notifications.viewDetails', {
                            defaultValue: 'VIEW DETAILS',
                          })}
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
            hasWorkflowCompleted ||
            canReviewCurrentRound) && (
            <div className="absolute bottom-6 left-6 z-40">
              <WorkflowIterationFeedbackCard
                currentRound={visibleRoundIndex}
                completedSteps={selectedRoundStepProgress.completedSteps}
                totalSteps={selectedRoundStepProgress.totalSteps}
                executionStatus={projection.execution_status}
                isRegeneratingPlan={isExecutionRecompiling}
                runningStepTitle={
                  graphSteps.find(
                    (s) => s.status === 'running' || s.status === 'failed'
                  )?.title ?? null
                }
                iterationHistory={projection.iteration_history}
                roundOptions={roundGraphs.map((graph) => ({
                  roundIndex: graph.round_index,
                  status: graph.status,
                }))}
                selectedRoundIndex={selectedRoundIndex ?? defaultRoundIndex}
                onSelectRound={setSelectedRoundIndex}
                canReviewCurrentRound={
                  canReviewCurrentRound && isViewingCurrentRound
                }
                pendingActionId={pendingActionId}
                onSubmit={(payload) => {
                  if (!projection.execution_id || !onSubmitIterationFeedback)
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

        {/* Side Panels �?embedded in flex layout */}
        {activeNodeId && activeStep && (
          <div className="flex h-full shrink-0 border-l border-[var(--hairline)]">
            {/* Chat Panel */}
            <AnimatePresence>
              {isChatVisible && (
                <motion.aside
                  key="chat"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 340, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{
                    type: 'tween',
                    duration: 0.25,
                    ease: 'easeInOut',
                  }}
                  className="h-full shrink-0 overflow-hidden border-r border-[var(--hairline)]"
                >
                  <ChatPanel
                    step={activeStep}
                    agentName={resolveStepAgentName(activeStep)}
                    entries={visibleActiveTranscript}
                    pendingReview={activeStepPendingReview}
                    pendingInput={activeStepPendingInput}
                    pendingActionId={pendingActionId}
                    onApproval={onApproval}
                    onRespondPendingReview={onRespondPendingReview}
                    onClose={() => setIsChatVisible(false)}
                    onSendInput={handleSendStepInput}
                    canSendInput={
                      !!onSubmitStepInput &&
                      canWorkflowStepAcceptChatInput(activeStep)
                    }
                  />
                </motion.aside>
              )}
            </AnimatePresence>

            {/* Inspector Panel */}
            <motion.aside
              key="inspector-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 700, opacity: 1 }}
              transition={{
                type: 'tween',
                duration: 0.25,
                ease: 'easeInOut',
              }}
              className="h-full shrink-0 overflow-hidden"
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
                tokenUsage={activeStepTokenUsageData?.usage ?? null}
                isLoadingTokenUsage={isLoadingActiveStepTokenUsage}
                activeTab={executionRecordTab}
                onActiveTabChange={setExecutionRecordTab}
              />
            </motion.aside>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined'
    ? windowContent
    : createPortal(
        <div className="new-design absolute inset-0 z-20">{windowContent}</div>,
        document.getElementById('app-main-content') ?? document.body
      );
}
