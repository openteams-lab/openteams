import type { ChatMessage } from 'shared/types';
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayIcon,
  WarningCircleIcon,
  PauseIcon,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import type { WorkflowCardData } from '@/lib/api';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { WorkflowIterationFeedbackCard } from './WorkflowIterationFeedbackCard';
import { WorkflowPendingInputCard } from './WorkflowPendingInputCard';
import { WorkflowPendingReviewCard } from './WorkflowPendingReviewCard';
import { WorkflowGraphBoard } from './WorkflowGraphBoard';
import { type WorkflowFinalReviewActionData } from './WorkflowFinalReviewCard';
import {
  canPauseWorkflowExecution,
  canResumeWorkflowExecution,
  isWorkflowExecutionRecompiling,
} from './workflowControlContract';
import { workflowExecutionStatusLabel } from './workflowStepPresentation';

export type WorkflowCardProjection = WorkflowCardData;
type WorkflowCardStep = WorkflowCardData['steps'][number];
type WorkflowCardType =
  | 'workflow_execution'
  | 'workflow_plan'
  | 'workflow_plan_generation';

type WorkflowPlanGenerationMeta = {
  status?: string;
  plan_goal?: string;
  retryable?: boolean;
  retry_endpoint?: string;
  error_message?: string | null;
};

const REVIEW_READY_STEP_STATUSES = new Set([
  'completed',
  'skipped',
  'cancelled',
]);

function getStepProgress(steps: WorkflowCardStep[]) {
  return {
    completedSteps: steps.filter((step) => step.status === 'completed').length,
    totalSteps: steps.length,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function GeneratingPlanAnimation({ label }: { label?: string }) {
  const nodes = [
    { label: 'Goal', x: 28, y: 56 },
    { label: 'Steps', x: 138, y: 30 },
    { label: 'Agents', x: 248, y: 56 },
    { label: 'Review', x: 338, y: 36 },
  ];

  const paths = [
    'M56 56 C88 28 108 28 138 36',
    'M162 36 C192 44 218 52 248 56',
    'M272 56 C296 48 316 40 338 40',
  ];

  return (
    <div className="flex flex-col items-center py-2">
      <div className="relative h-28 w-full max-w-[380px]">
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 380 100"
          aria-hidden="true"
        >
          {/* Static path lines */}
          {paths.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="#DBEAFE"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))}
          {/* Animated path draw overlay */}
          {paths.map((d, i) => (
            <motion.path
              key={`anim-${d}`}
              d={d}
              fill="none"
              stroke="#93C5FD"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: [0, 1, 1, 0], opacity: [0, 0.8, 0.8, 0] }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.8,
                times: [0, 0.4, 0.7, 1],
              }}
            />
          ))}
        </svg>

        {/* Nodes */}
        {nodes.map((node, i) => (
          <div
            key={node.label}
            className="absolute flex flex-col items-center"
            style={{ left: node.x - 18, top: node.y - 18 }}
          >
            <motion.div
              className="h-9 w-9 rounded-xl border border-blue-200 bg-white flex items-center justify-center"
              animate={{ borderColor: ['#BFDBFE', '#60A5FA', '#BFDBFE'] }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.8,
              }}
            >
              <motion.div
                className="h-2 w-2 rounded-full bg-blue-400"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.8,
                }}
              />
            </motion.div>
            <span className="mt-1 text-[10px] font-medium text-blue-400 select-none whitespace-nowrap">
              {node.label}
            </span>
          </div>
        ))}

        {/* Traveling dot */}
        <svg
          className="absolute inset-0 h-full w-full overflow-visible pointer-events-none"
          viewBox="0 0 380 100"
          aria-hidden="true"
        >
          <motion.circle
            r="3"
            fill="#60A5FA"
            animate={{
              cx: [56, 138, 248, 338],
              cy: [56, 36, 56, 40],
              opacity: [0, 0.8, 0.8, 0],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: 'easeInOut',
              times: [0, 0.3, 0.65, 1],
            }}
          />
        </svg>
      </div>

      <div className="text-[13px] font-medium text-blue-400">
        {label ?? 'Generating workflow plan'}
        <motion.span
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          ...
        </motion.span>
      </div>
    </div>
  );
}

export const extractWorkflowCardType = (
  meta: unknown
): WorkflowCardType | null => {
  if (!isRecord(meta)) return null;

  if (
    meta.card_type === 'workflow_execution' ||
    meta.card_type === 'workflow_plan' ||
    meta.card_type === 'workflow_plan_generation'
  ) {
    return meta.card_type;
  }

  return null;
};

export const isWorkflowCardMessageMeta = (meta: unknown): boolean =>
  extractWorkflowCardType(meta) !== null;

const extractWorkflowPlanGenerationMeta = (
  meta: unknown
): WorkflowPlanGenerationMeta | null => {
  if (extractWorkflowCardType(meta) !== 'workflow_plan_generation') {
    return null;
  }

  const record = meta as Record<string, unknown>;
  const generationMeta = record.workflow_plan_generation;
  if (!isRecord(generationMeta)) {
    return null;
  }

  return generationMeta as WorkflowPlanGenerationMeta;
};

const buildWorkflowPlanGenerationProjection = (
  meta: unknown
): WorkflowCardProjection | null => {
  const generationMeta = extractWorkflowPlanGenerationMeta(meta);
  if (!generationMeta) return null;

  const status = generationMeta.status === 'failed' ? 'failed' : 'pending';
  const planGoal = generationMeta.plan_goal?.trim() ?? '';
  const errorMessage =
    generationMeta.error_message === undefined
      ? null
      : generationMeta.error_message;

  return {
    execution_id: null,
    plan_id: '',
    revision_id: '',
    title: 'Workflow Plan',
    goal: planGoal,
    state: status === 'failed' ? 'failed' : 'pending',
    execution_status: 'plan_generation',
    error_message: errorMessage,
    completed_step_count: 0,
    total_step_count: 0,
    result_summary: null,
    outputs: [],
    current_round: 0,
    loops: [],
    iteration_history: [],
    round_graphs: [],
    steps: [],
    agents: [],
    plan: {
      nodes: [],
      edges: [],
      viewport: undefined,
      loops: null,
    },
    pending_review: null,
    pending_input: null,
    validation_errors: null,
    is_terminal: status === 'failed',
    has_transcripts: null,
  };
};

export function extractWorkflowCardProjection(
  meta: unknown
): WorkflowCardProjection | null {
  const cardType = extractWorkflowCardType(meta);
  if (!cardType) {
    return null;
  }

  const workflowCard = (meta as Record<string, unknown>).workflow_card;
  if (isRecord(workflowCard)) {
    return workflowCard as unknown as WorkflowCardProjection;
  }

  if (cardType === 'workflow_plan_generation') {
    return buildWorkflowPlanGenerationProjection(meta);
  }

  return null;
}

type ChatWorkflowCardProps = {
  message: ChatMessage;
  projection?: WorkflowCardProjection | null;
  onExecute?: (projection: WorkflowCardProjection) => void;
  onPauseAll?: (executionId: string) => void;
  onResume?: (executionId: string, projection: WorkflowCardProjection) => void;
  onRetryStep?: (stepId: string, retryTarget?: 'task' | 'review') => void;
  onOpenWindow?: () => void;
  onRetryPlanGeneration?: (messageId: string) => void;
  retryPlanGenerationPending?: boolean;
  retryPlanGenerationError?: string | null;
  finalReviewAction?: WorkflowFinalReviewActionData | null;
  onRespondPendingReview?: (
    reviewId: string,
    action: 'approve' | 'reject',
    feedback?: string
  ) => void;
  onSubmitStepInput?: (stepId: string, inputText: string) => void;
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

export function ChatWorkflowCard({
  message,
  projection: projectionProp,
  onExecute,
  onPauseAll,
  onResume,
  onRetryStep,
  onOpenWindow,
  onRetryPlanGeneration,
  retryPlanGenerationPending = false,
  retryPlanGenerationError,
  finalReviewAction,
  onRespondPendingReview,
  onSubmitStepInput,
  onSubmitIterationFeedback,
  pendingActionId,
}: ChatWorkflowCardProps) {
  const { t } = useTranslation('chat');
  const projection =
    projectionProp ?? extractWorkflowCardProjection(message.meta);
  const roundGraphs = useMemo(
    () =>
      [...(projection?.round_graphs ?? [])].sort(
        (left, right) => left.round_index - right.round_index
      ),
    [projection?.round_graphs]
  );
  const defaultRoundIndex = useMemo(() => {
    if (!projection) return null;
    return (
      roundGraphs.find(
        (graph) => graph.round_index === projection.current_round
      )?.round_index ??
      roundGraphs.at(-1)?.round_index ??
      projection.current_round
    );
  }, [projection, roundGraphs]);
  const [selectedRoundIndex, setSelectedRoundIndex] = useState<number | null>(
    null
  );

  useEffect(() => {
    setSelectedRoundIndex(defaultRoundIndex);
  }, [
    defaultRoundIndex,
    projection?.execution_id,
    projection?.plan_id,
    projection?.current_round,
  ]);

  const selectedRoundGraph = useMemo(() => {
    if (!projection) return null;
    const targetRound = selectedRoundIndex ?? defaultRoundIndex;
    return (
      roundGraphs.find((graph) => graph.round_index === targetRound) ??
      roundGraphs.find(
        (graph) => graph.round_index === projection.current_round
      ) ??
      null
    );
  }, [defaultRoundIndex, projection, roundGraphs, selectedRoundIndex]);
  if (!projection) {
    return null;
  }

  const graphPlan = selectedRoundGraph?.plan ?? projection.plan;
  const graphSteps = selectedRoundGraph?.steps ?? projection.steps;
  const graphLoops = selectedRoundGraph?.loops ?? projection.loops ?? [];
  const visibleRoundIndex =
    selectedRoundGraph?.round_index ?? projection.current_round;
  const isViewingCurrentRound =
    !selectedRoundGraph ||
    selectedRoundGraph.round_index === projection.current_round;
  const selectedRoundStepProgress = getStepProgress(graphSteps);

  const cardType = extractWorkflowCardType(message.meta);
  const isPlanGenerationCard = cardType === 'workflow_plan_generation';
  const generationMeta = extractWorkflowPlanGenerationMeta(message.meta);
  const isPlanGenerationFailed =
    isPlanGenerationCard && generationMeta?.status === 'failed';
  const isPlanGenerationPending =
    isPlanGenerationCard && !isPlanGenerationFailed;
  const generationErrorMessage =
    generationMeta?.error_message?.trim() ||
    projection.error_message?.trim() ||
    null;
  const displayGoal = generationMeta?.plan_goal?.trim() || projection.goal;
  const hasWorkflowGraph = graphPlan.nodes.length > 0;
  const emptyGraphDescription = isPlanGenerationFailed
    ? t('workflow.card.emptyGraph.planGenerationFailed', {
        defaultValue:
          'Plan generation stopped before the preview was created. Retry to generate a fresh plan from the same goal.',
      })
    : isPlanGenerationPending
      ? t('workflow.card.emptyGraph.planGenerationPending', {
          defaultValue:
            'The system is drafting a workflow plan. This placeholder card will update when the preview is ready.',
        })
      : t('workflow.card.emptyGraph.noGraph', {
          defaultValue: 'No workflow graph is available yet.',
        });
  const isPreview =
    projection.state === 'preview_ready' ||
    projection.state === 'preview_invalid';
  const isInvalid = projection.state === 'preview_invalid';
  const isExecutionRecompiling = isWorkflowExecutionRecompiling(projection);
  const canPauseExecution = canPauseWorkflowExecution(projection);
  const canResumeExecution = canResumeWorkflowExecution(projection);
  const executionStatus = projection.execution_status;
  const executionStatusLabel = workflowExecutionStatusLabel(executionStatus, t);
  const allStepViewsCompleted =
    projection.steps.length > 0 &&
    projection.steps.every((step) =>
      REVIEW_READY_STEP_STATUSES.has(step.status)
    );
  const canReviewCurrentRound =
    !!finalReviewAction ||
    (allStepViewsCompleted &&
      (projection.state === 'waiting' ||
        projection.execution_status === 'waiting'));
  const showRetryPlanGenerationButton =
    isPlanGenerationFailed &&
    generationMeta?.retryable !== false &&
    !!onRetryPlanGeneration;

  const stateIcon = isPlanGenerationFailed ? (
    <WarningCircleIcon className="size-icon-sm text-[#DC2626]" weight="fill" />
  ) : isPlanGenerationPending ? (
    <ClockIcon className="size-icon-sm text-[#2563EB]" weight="fill" />
  ) : isExecutionRecompiling ? (
    <ClockIcon className="size-icon-sm text-[#5094fb]" weight="fill" />
  ) : !isPreview && executionStatus === 'completed' ? (
    <CheckCircleIcon className="size-icon-sm text-[#15803D]" weight="fill" />
  ) : (!isPreview && executionStatus === 'failed') || isInvalid ? (
    <WarningCircleIcon className="size-icon-sm text-[#DC2626]" weight="fill" />
  ) : projection.state === 'preview_ready' ? (
    <PlayIcon className="size-icon-sm text-[#D97706]" weight="fill" />
  ) : !isPreview && executionStatus === 'paused' ? (
    <PauseIcon className="size-icon-sm text-[#D97706]" weight="fill" />
  ) : !isPreview && executionStatus === 'waiting' ? (
    <WarningCircleIcon className="size-icon-sm text-[#7C3AED]" weight="fill" />
  ) : (
    <ClockIcon className="size-icon-sm text-[#2563EB]" weight="fill" />
  );

  const stateLabel = isPlanGenerationFailed
    ? t('workflow.card.stateLabels.planGenerationFailed', {
        defaultValue: 'Plan Generation Failed',
      })
    : isPlanGenerationPending
      ? t('workflow.card.stateLabels.generatingPlan', {
          defaultValue: 'Generating Plan',
        })
      : isExecutionRecompiling
        ? t('workflow.iterationFeedback.regeneratingPlan', {
            defaultValue: 'Regenerating plan',
          })
        : projection.state === 'preview_ready'
          ? t('workflow.card.stateLabels.planReady', {
              defaultValue: 'Plan Ready',
            })
          : projection.state === 'preview_invalid'
            ? t('workflow.card.stateLabels.planInvalid', {
                defaultValue: 'Plan Invalid',
              })
            : executionStatusLabel;

  return (
    <div className="workflow-card-surface w-full max-w-[640px] rounded-[24px] border border-[#D8E2F0] bg-white p-4 shadow-sm flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 select-text">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#64748B]">
            {stateIcon}
            <span>{stateLabel}</span>
          </div>
          <div className="mt-2 text-[20px] font-semibold leading-tight text-[#0F172A]">
            {projection.title}
          </div>
          {isPlanGenerationCard ? (
            <ChatMarkdown
              content={displayGoal}
              maxWidth="100%"
              hideCopyButton
              className="mt-2"
              textClassName="text-sm leading-6 text-[#475569]"
            />
          ) : (
            <div className="mt-2 text-sm leading-6 text-[#475569]">
              {displayGoal}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start">
          {isPlanGenerationCard ? (
            <div
              className={
                isPlanGenerationFailed
                  ? 'rounded-full bg-[#FEF2F2] px-3 py-1 text-xs font-semibold text-[#B91C1C] whitespace-nowrap'
                  : 'rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-semibold text-[#1D4ED8] whitespace-nowrap'
              }
            >
              {isPlanGenerationFailed
                ? t('workflow.card.badges.failed', { defaultValue: 'Failed' })
                : t('workflow.card.badges.generating', {
                    defaultValue: 'Generating',
                  })}
            </div>
          ) : (
            <div className="rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-semibold text-[#1D4ED8] whitespace-nowrap">
              {projection.completed_step_count}/{projection.total_step_count}
            </div>
          )}
        </div>
      </div>

      {/* Agent list (preview/generation mode) */}
      {(isPreview || isPlanGenerationCard) &&
        projection.agents &&
        projection.agents.length > 0 && (
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

      {hasWorkflowGraph ? (
        <div className="mt-4">
          <WorkflowGraphBoard
            nodes={graphPlan.nodes}
            edges={graphPlan.edges}
            steps={graphSteps}
            loops={graphLoops}
            planLoops={graphPlan.loops}
            agents={projection.agents}
            onRetryStep={isViewingCurrentRound ? onRetryStep : undefined}
            pendingActionId={pendingActionId}
            compact
          />
        </div>
      ) : isPlanGenerationPending ? (
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/30 px-6 py-8 text-center">
          <GeneratingPlanAnimation
            label={t('workflow.card.generatingPlan', {
              defaultValue: 'Generating workflow plan',
            })}
          />
        </div>
      ) : (
        <div
          className={`mt-4 flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-6 text-center ${
            isPlanGenerationCard ? 'py-10' : 'h-[320px]'
          }`}
        >
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#64748B]">
            {isPlanGenerationCard
              ? t('workflow.card.emptyGraph.planDraft', {
                  defaultValue: 'Plan Draft',
                })
              : t('workflow.card.emptyGraph.workflow', {
                  defaultValue: 'Workflow',
                })}
          </div>
          {isPlanGenerationCard ? (
            <ChatMarkdown
              content={emptyGraphDescription}
              maxWidth="100%"
              hideCopyButton
              className="mt-2 text-center"
              textClassName="text-sm leading-6 text-[#475569]"
            />
          ) : (
            <div className="mt-2 text-sm leading-6 text-[#475569]">
              {emptyGraphDescription}
            </div>
          )}
        </div>
      )}

      {!projection.pending_review &&
        !projection.pending_input &&
        projection.execution_id &&
        (projection.iteration_history.length > 0 || canReviewCurrentRound) && (
          <div className="mt-4">
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
                if (!onSubmitIterationFeedback || !projection.execution_id) {
                  return;
                }
                onSubmitIterationFeedback({
                  executionId: projection.execution_id,
                  action: payload.action,
                  feedback: payload.feedback,
                });
              }}
            />
          </div>
        )}

      {/* Validation errors (preview_invalid) */}
      {isInvalid && projection.validation_errors && (
        <div className="mt-4 rounded-[16px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
          <div className="text-xs font-bold uppercase tracking-[0.16em]">
            {t('workflow.card.errors.validationErrors', {
              defaultValue: 'Validation Errors',
            })}
          </div>
          <div className="mt-1">{projection.validation_errors}</div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {onOpenWindow && !isPlanGenerationCard && (
          <button
            type="button"
            onClick={onOpenWindow}
            className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-medium text-[#475569] transition-colors hover:bg-[#F1F5F9]"
          >
            {t('workflow.card.buttons.open', { defaultValue: 'Open' })}
          </button>
        )}
        {projection.state === 'preview_ready' &&
          projection.plan_id &&
          onExecute && (
            <button
              type="button"
              onClick={() => onExecute(projection)}
              className="flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8]"
            >
              <PlayIcon className="size-4" weight="bold" />
              {t('workflow.card.buttons.executePlan', {
                defaultValue: 'Execute Plan',
              })}
            </button>
          )}
        {canPauseExecution && projection.execution_id && onPauseAll && (
          <button
            type="button"
            onClick={() => onPauseAll(projection.execution_id!)}
            className="flex items-center gap-2 rounded-full bg-[#D97706] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#B45309]"
          >
            <PauseIcon className="size-4" weight="bold" />
            {t('workflow.card.buttons.pauseAll', { defaultValue: 'Pause All' })}
          </button>
        )}
        {canResumeExecution && projection.execution_id && onResume && (
          <button
            type="button"
            onClick={() => onResume(projection.execution_id!, projection)}
            className="flex items-center gap-2 rounded-full bg-[var(--chat-session-send-blue,#5094fb)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--chat-session-send-blue-hover,#4084eb)]"
          >
            <PlayIcon className="size-4" weight="bold" />
            {t('workflow.card.buttons.resume', { defaultValue: 'Resume' })}
          </button>
        )}
        {showRetryPlanGenerationButton && (
          <button
            type="button"
            onClick={() => onRetryPlanGeneration?.(message.id)}
            disabled={retryPlanGenerationPending}
            className="flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#94A3B8]"
          >
            <ArrowClockwiseIcon
              className={
                retryPlanGenerationPending ? 'size-4 animate-spin' : 'size-4'
              }
              weight="bold"
            />
            {retryPlanGenerationPending
              ? t('workflow.card.buttons.retrying', {
                  defaultValue: 'Retrying...',
                })
              : t('workflow.card.buttons.retryPlanGeneration', {
                  defaultValue: 'Retry Plan Generation',
                })}
          </button>
        )}
      </div>

      {projection.pending_review && (
        <div className="mt-4">
          <WorkflowPendingReviewCard
            pendingReview={projection.pending_review}
            pendingActionId={pendingActionId}
            onSubmit={(action, feedback) =>
              onRespondPendingReview?.(
                projection.pending_review!.review_id,
                action,
                feedback
              )
            }
          />
        </div>
      )}

      {projection.pending_input && (
        <div className="mt-4">
          <WorkflowPendingInputCard
            pendingInput={projection.pending_input}
            pendingActionId={pendingActionId}
            onSubmit={onSubmitStepInput}
          />
        </div>
      )}

      {isPlanGenerationFailed && generationErrorMessage && (
        <div className="mt-4 rounded-[16px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
          <div className="text-xs font-bold uppercase tracking-[0.16em]">
            {t('workflow.card.errors.generationError', {
              defaultValue: 'Generation Error',
            })}
          </div>
          <ChatMarkdown
            content={generationErrorMessage}
            maxWidth="100%"
            hideCopyButton
            className="mt-1"
            textClassName="text-sm leading-6 text-[#991B1B]"
          />
        </div>
      )}

      {isPlanGenerationCard && retryPlanGenerationError && (
        <div className="mt-4 rounded-[16px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
          <div className="text-xs font-bold uppercase tracking-[0.16em]">
            {t('workflow.card.errors.retryRequestFailed', {
              defaultValue: 'Retry Request Failed',
            })}
          </div>
          <div className="mt-1">{retryPlanGenerationError}</div>
        </div>
      )}

      {(projection.state === 'completed' ||
        projection.execution_status === 'completed') && (
        <div className="mt-4 rounded-[16px] border border-[#D1FAE5] bg-[#ECFDF5] p-4">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#15803D]">
            {t('workflow.card.finalDelivery', {
              defaultValue: 'Final Delivery',
            })}
          </div>
          {projection.result_summary && (
            <div className="mt-2 text-sm leading-6 text-[#166534]">
              {projection.result_summary}
            </div>
          )}
        </div>
      )}

      {!isPlanGenerationCard &&
        (projection.state === 'failed' ||
          projection.execution_status === 'failed') &&
        projection.error_message && (
          <div className="mt-4 rounded-[16px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-sm leading-6 text-[#991B1B]">
            {projection.error_message}
          </div>
        )}
    </div>
  );
}
