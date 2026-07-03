import {
  ArrowClockwiseIcon,
  PlayIcon,
  PauseIcon,
} from '@phosphor-icons/react';
import { BookOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { motion } from 'framer-motion';
import type { WorkflowCardData } from '@/lib/api';
import { AgentMarkdown } from '@/components/AgentMarkdown';
import { ChatMarkdown } from '@/components/conversation/ChatMarkdown';
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

type ChatMessage = {
  id: string;
  meta: unknown;
};

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

const REVIEW_READY_STEP_STATUSES = new Set(['completed', 'skipped']);

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
              stroke="var(--hairline-strong)"
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
              stroke="var(--primary)"
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
              className="h-9 w-9 rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] flex items-center justify-center"
              animate={{
                borderColor: [
                  'var(--hairline)',
                  'var(--primary)',
                  'var(--hairline)',
                ],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: i * 0.8,
              }}
            >
              <motion.div
                className="h-2 w-2 rounded-full bg-[var(--primary)]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.8,
                }}
              />
            </motion.div>
            <span className="mt-1 text-[10px] font-medium text-[var(--primary)] select-none whitespace-nowrap">
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
            fill="var(--primary)"
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

      <div className="text-[13px] font-medium text-[var(--primary)]">
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
    pending_reviews: [],
    pending_input: null,
    validation_errors: null,
    is_terminal: status === 'failed',
    has_transcripts: null,
    started_at: null,
    completed_at: null,
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
  const { t } = useAppTranslation();
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
  const isWaitingForFinalReview =
    !isPreview &&
    (projection.state === 'waiting' ||
      projection.execution_status === 'waiting');
  const allStepViewsCompleted =
    projection.steps.length > 0 &&
    projection.steps.every((step) =>
      REVIEW_READY_STEP_STATUSES.has(step.status)
    );
  const canReviewCurrentRound =
    isWaitingForFinalReview && (!!finalReviewAction || allStepViewsCompleted);
  const showRetryPlanGenerationButton =
    isPlanGenerationFailed &&
    generationMeta?.retryable !== false &&
    !!onRetryPlanGeneration;

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

  const progressTotal =
    selectedRoundStepProgress.totalSteps || projection.total_step_count;
  const progressCompleted =
    selectedRoundStepProgress.totalSteps > 0
      ? selectedRoundStepProgress.completedSteps
      : projection.completed_step_count;
  const progressPercent =
    progressTotal > 0
      ? Math.min(100, Math.round((progressCompleted / progressTotal) * 100))
      : 0;
  const progressSummary =
    progressTotal > 0
      ? `Round ${visibleRoundIndex} • ${progressPercent}% Complete`
      : null;
  const isFailedState =
    isPlanGenerationFailed ||
    isInvalid ||
    (!isPreview && executionStatus === 'failed') ||
    projection.state === 'failed';
  const isCompletedState =
    !isPreview &&
    (executionStatus === 'completed' || projection.state === 'completed');
  const isPausedState = !isPreview && executionStatus === 'paused';
  const shouldHideExecutionStatusLabel = stateLabel
    .trim()
    .toLowerCase() === 'workflow execution';
  const statusDotClassName = isFailedState
    ? 'bg-[var(--workflow-danger,#ef4444)]'
    : isCompletedState
      ? 'bg-[var(--success)]'
      : isPausedState
        ? 'bg-[#D97706]'
        : 'bg-[var(--primary)]';
  const progressAccentClassName = isFailedState
    ? 'bg-[var(--workflow-danger,#ef4444)]'
    : isCompletedState
      ? 'bg-[var(--success)]'
      : isPausedState
        ? 'bg-[#D97706]'
        : 'bg-[var(--primary)]';
  const quietButtonClassName =
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--hairline)] bg-transparent px-3 text-[12px] font-medium text-[var(--ink-muted)] transition-colors hover:border-[var(--hairline-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]';
  const openButtonClassName =
    'inline-flex h-8 items-center gap-1.5 rounded-md bg-transparent px-3 text-[12px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]';
  const primaryButtonClassName =
    'inline-flex h-8 items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--primary)_24%,var(--hairline))] bg-[color-mix(in_srgb,var(--primary)_16%,var(--surface-1))] px-3 text-[12px] font-semibold text-[var(--primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_22%,var(--surface-1))] hover:text-[var(--primary-hover)]';
  const shouldShowProgressInfo =
    !projection.pending_review &&
    !projection.pending_input &&
    projection.execution_id &&
    (projection.iteration_history.length > 0 ||
      canReviewCurrentRound ||
      isCompletedState);
  const shouldExpandFeedbackCard =
    canReviewCurrentRound && isViewingCurrentRound;

  return (
    <div className="workflow-card-surface w-full max-w-[640px] rounded-lg px-5 py-5 flex flex-col">
      <div className="min-w-0 select-text">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--ink-subtle)]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${statusDotClassName}`}
            aria-hidden="true"
          />
          {!shouldHideExecutionStatusLabel ? (
            <>
              <span>{stateLabel}</span>
              {progressSummary && (
                <>
                  <span className="text-[var(--ink-tertiary)]">•</span>
                  <span>{progressSummary}</span>
                </>
              )}
            </>
          ) : (
            progressSummary && (
              <span>{progressSummary}</span>
            )
          )}
        </div>
        <div className="mt-2.5 text-[19px] font-semibold leading-snug text-[var(--ink)]">
          {projection.title}
        </div>
        {isPlanGenerationCard ? (
          <div className="mt-2">
            <AgentMarkdown content={displayGoal} fontSize={13} />
          </div>
        ) : (
          <div className="mt-2 text-[13px] leading-6 text-[var(--ink-muted)]">
            {displayGoal}
          </div>
        )}
        {progressSummary && (
          <div className="mt-4 h-[2px] overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              className={`h-full rounded-full ${progressAccentClassName}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Agent list (preview/generation mode) */}
      {(isPreview || isPlanGenerationCard) &&
        projection.agents &&
        projection.agents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {projection.agents.map((agent) => (
              <span
                key={agent.session_agent_id}
                className="rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--ink-muted)]"
              >
                {agent.name}
              </span>
            ))}
          </div>
        )}

      {hasWorkflowGraph ? (
        <div className="workflow-card-graph-window mt-5 overflow-hidden rounded-lg">
          <WorkflowGraphBoard
            nodes={graphPlan.nodes}
            edges={graphPlan.edges}
            steps={graphSteps}
            loops={graphLoops}
            planLoops={graphPlan.loops}
            agents={projection.agents}
            onRetryStep={isViewingCurrentRound ? onRetryStep : undefined}
            pendingActionId={pendingActionId}
            className="workflow-card-graph-board"
            compact
          />
        </div>
      ) : isPlanGenerationPending ? (
        <div className="mt-5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_18%,var(--hairline))] bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-1))] px-6 py-8 text-center">
          <GeneratingPlanAnimation
            label={t('workflow.card.generatingPlan', {
              defaultValue: 'Generating workflow plan',
            })}
          />
        </div>
      ) : (
        <div
          className={`mt-5 flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--hairline)] bg-[var(--surface-2)] p-6 text-center ${
            isPlanGenerationCard ? 'py-10' : 'h-[320px]'
          }`}
        >
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em] text-[var(--ink-subtle)]">
            {isPlanGenerationCard
              ? t('workflow.card.emptyGraph.planDraft', {
                  defaultValue: 'Plan Draft',
                })
              : t('workflow.card.emptyGraph.workflow', {
                  defaultValue: 'Workflow',
                })}
          </div>
          {isPlanGenerationCard ? (
            <div className="mt-2 text-center">
              <AgentMarkdown content={emptyGraphDescription} fontSize={14} />
            </div>
          ) : (
            <div className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              {emptyGraphDescription}
            </div>
          )}
        </div>
      )}

      {shouldShowProgressInfo ? (
        <div className="mt-4 flex w-full flex-wrap items-start gap-3">
          <div
            className={`max-w-full shrink-0 ${
              shouldExpandFeedbackCard ? 'w-[320px]' : 'w-[200px]'
            }`}
          >
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
              allowExpand={shouldExpandFeedbackCard}
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
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {onOpenWindow && !isPlanGenerationCard && (
            <button
              type="button"
              onClick={onOpenWindow}
              className={openButtonClassName}
            >
                <BookOpen className="size-3.5" />
                {t('workflow.card.buttons.open', { defaultValue: 'Open' })}
              </button>
            )}
            {canPauseExecution &&
              projection.execution_id &&
              onPauseAll && (
                <button
                  type="button"
                  onClick={() => onPauseAll(projection.execution_id!)}
                  className={quietButtonClassName}
                >
                  <PauseIcon className="size-3.5" weight="bold" />
                  {t('workflow.card.buttons.pauseAll', {
                    defaultValue: 'Pause All',
                  })}
                </button>
              )}
            {canResumeExecution && projection.execution_id && onResume && (
              <button
                type="button"
                onClick={() => onResume(projection.execution_id!, projection)}
                className={primaryButtonClassName}
              >
                <PlayIcon className="size-3.5" weight="bold" />
                {t('workflow.card.buttons.resume', { defaultValue: 'Resume' })}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Validation errors (preview_invalid) */}
      {isInvalid && projection.validation_errors && (
        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,var(--surface-1))] p-4 text-sm leading-6 text-[var(--workflow-danger,#ef4444)]">
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em]">
            {t('workflow.card.errors.validationErrors', {
              defaultValue: 'Validation Errors',
            })}
          </div>
          <div className="mt-1">{projection.validation_errors}</div>
        </div>
      )}

      <div
        className={`mt-4 flex items-center justify-end gap-2 ${shouldShowProgressInfo ? 'hidden' : ''}`}
      >
        {onOpenWindow && !isPlanGenerationCard && (
          <button
            type="button"
            onClick={onOpenWindow}
            className={openButtonClassName}
          >
            <BookOpen className="size-3.5" />
            {t('workflow.card.buttons.open', { defaultValue: 'Open' })}
          </button>
        )}
        {projection.state === 'preview_ready' &&
          projection.plan_id &&
          onExecute && (
            <button
              type="button"
              onClick={() => onExecute(projection)}
              className={primaryButtonClassName}
            >
              <PlayIcon className="size-3.5" weight="bold" />
              {t('workflow.card.buttons.executePlan', {
                defaultValue: 'Execute Plan',
              })}
            </button>
        )}
        {canPauseExecution &&
          projection.execution_id &&
          onPauseAll && (
          <button
            type="button"
            onClick={() => onPauseAll(projection.execution_id!)}
            className={quietButtonClassName}
          >
            <PauseIcon className="size-3.5" weight="bold" />
            {t('workflow.card.buttons.pauseAll', { defaultValue: 'Pause All' })}
          </button>
          )}
        {canResumeExecution && projection.execution_id && onResume && (
          <button
            type="button"
            onClick={() => onResume(projection.execution_id!, projection)}
            className={primaryButtonClassName}
          >
            <PlayIcon className="size-3.5" weight="bold" />
            {t('workflow.card.buttons.resume', { defaultValue: 'Resume' })}
          </button>
        )}
        {showRetryPlanGenerationButton && (
          <button
            type="button"
            onClick={() => onRetryPlanGeneration?.(message.id)}
            disabled={retryPlanGenerationPending}
            className={`${primaryButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <ArrowClockwiseIcon
              className={
                retryPlanGenerationPending
                  ? 'size-3.5 animate-spin'
                  : 'size-3.5'
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
        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,var(--surface-1))] p-4 text-sm leading-6 text-[var(--workflow-danger,#ef4444)]">
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em]">
            {t('workflow.card.errors.generationError', {
              defaultValue: 'Generation Error',
            })}
          </div>
          <ChatMarkdown
            content={generationErrorMessage}
            maxWidth="100%"
            hideCopyButton
            className="mt-1"
            textClassName="text-sm leading-6 text-[var(--workflow-danger,#ef4444)]"
          />
        </div>
      )}

      {isPlanGenerationCard && retryPlanGenerationError && (
        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,var(--surface-1))] p-4 text-sm leading-6 text-[var(--workflow-danger,#ef4444)]">
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em]">
            {t('workflow.card.errors.retryRequestFailed', {
              defaultValue: 'Retry Request Failed',
            })}
          </div>
          <div className="mt-1">{retryPlanGenerationError}</div>
        </div>
      )}

      {(projection.state === 'completed' ||
        projection.execution_status === 'completed') && (
        <div className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em] text-[var(--ink-subtle)]">
            {t('workflow.card.finalDelivery', {
              defaultValue: 'Final Delivery',
            })}
          </div>
          {projection.result_summary && (
            <div className="mt-2">
              {projection.result_summary}
            </div>
          )}
        </div>
      )}

      {!isPlanGenerationCard &&
        (projection.state === 'failed' ||
          projection.execution_status === 'failed') &&
        projection.error_message && (
          <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,var(--surface-1))] p-4 text-sm leading-6 text-[var(--workflow-danger,#ef4444)]">
            {projection.error_message}
          </div>
        )}
    </div>
  );
}
