import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import type { WorkflowIterationSummaryData } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  workflowExecutionStatusDotClass,
  workflowExecutionStatusLabel,
  workflowExecutionStatusTextClass,
} from './workflowStepPresentation';

type WorkflowIterationFeedbackPayload = {
  action: 'accept' | 'reject';
  feedback?: {
    what_wrong: string;
    expected: string;
    priority: 'high' | 'medium' | 'low';
    additional_notes?: string;
  };
};

type WorkflowIterationFeedbackCardProps = {
  currentRound: number;
  completedSteps: number;
  totalSteps: number;
  executionStatus?: string | null;
  runningStepTitle?: string | null;
  isRegeneratingPlan?: boolean;
  allowExpand?: boolean;
  iterationHistory: WorkflowIterationSummaryData[];
  roundOptions?: Array<{ roundIndex: number; status: string }>;
  selectedRoundIndex?: number | null;
  onSelectRound?: (roundIndex: number) => void;
  canReviewCurrentRound?: boolean;
  pendingActionId?: string | null;
  onSubmit?: (payload: WorkflowIterationFeedbackPayload) => void;
};

export function WorkflowIterationFeedbackCard({
  currentRound,
  completedSteps,
  totalSteps,
  executionStatus,
  runningStepTitle,
  isRegeneratingPlan = false,
  allowExpand = true,
  roundOptions = [],
  selectedRoundIndex,
  onSelectRound,
  canReviewCurrentRound: canReviewCurrentRoundProp = false,
  pendingActionId,
  onSubmit,
}: WorkflowIterationFeedbackCardProps) {
  const { t } = useTranslation('chat');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedReject, setExpandedReject] = useState(false);
  const [whatWrong, setWhatWrong] = useState('');
  const [expected, setExpected] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('high');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const canReviewCurrentRound = canReviewCurrentRoundProp && currentRound > 0;
  const canSubmit = !!onSubmit;
  const disabled = !!pendingActionId;

  useEffect(() => {
    if (canReviewCurrentRound) {
      setIsCollapsed(false);
    }
  }, [canReviewCurrentRound, currentRound]);

  const handleAccept = () => {
    setExpandedReject(false);
    setValidationError(null);
    onSubmit?.({ action: 'accept' });
  };

  const handleReject = () => {
    if (!expandedReject) {
      setExpandedReject(true);
      return;
    }
    const nextWhatWrong = whatWrong.trim();
    const nextExpected = expected.trim();
    if (!nextWhatWrong || !nextExpected) {
      setValidationError(
        t('workflow.iterationFeedback.validationError', {
          defaultValue: 'Reject requires what_wrong and expected.',
        })
      );
      return;
    }
    setValidationError(null);
    onSubmit?.({
      action: 'reject',
      feedback: {
        what_wrong: nextWhatWrong,
        expected: nextExpected,
        priority,
        additional_notes: additionalNotes.trim() || undefined,
      },
    });
  };

  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const effectiveExecutionStatus =
    executionStatus ?? (isRegeneratingPlan ? 'recompiling' : 'pending');
  const statusLabel = workflowExecutionStatusLabel(effectiveExecutionStatus, t);
  const statusDotClass = workflowExecutionStatusDotClass(
    effectiveExecutionStatus
  );
  const statusTextClass = workflowExecutionStatusTextClass(
    effectiveExecutionStatus
  );
  const visibleRoundOptions = roundOptions
    .filter(
      (round, index, source) =>
        source.findIndex((item) => item.roundIndex === round.roundIndex) ===
        index
    )
    .sort((left, right) => left.roundIndex - right.roundIndex);
  const selectedRound = selectedRoundIndex ?? currentRound;
  const canSwitchRounds = visibleRoundOptions.length > 1 && !!onSelectRound;
  const showCollapsedOnly = isCollapsed || !allowExpand;

  if (showCollapsedOnly) {
    return (
      <div
        onClick={allowExpand ? () => setIsCollapsed(false) : undefined}
        className={cn(
          'workflow-iteration-feedback-card flex h-8 w-fit min-w-[200px] max-w-[calc(100vw-3rem)] items-center gap-3 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-4 whitespace-nowrap transition-all hover:border-[var(--hairline-strong)] group',
          allowExpand && "cursor-pointer"
        )}
        title={
          t('workflow.iterationFeedback.round', {
            round: currentRound,
            defaultValue: `Round ${currentRound}`,
          }) +
          ` · ${completedSteps}/${totalSteps} ${t('workflow.iterationFeedback.steps', { defaultValue: 'Steps' }).toLowerCase()} · ${statusLabel}${runningStepTitle && !isRegeneratingPlan ? `: ${runningStepTitle}` : ''}`
        }
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <div className={cn('w-2 h-2 rounded-full', statusDotClass)} />
          <span className="text-xs font-bold text-[var(--ink)]">
            R{currentRound}
          </span>
        </div>
        <div className="h-3 w-[1px] shrink-0 bg-[var(--hairline)]" />
        <span className="min-w-0 truncate text-xs font-medium text-[var(--ink-muted)]">
          {completedSteps}/{totalSteps}{' '}
          {t('workflow.iterationFeedback.steps', { defaultValue: 'Steps' })}
        </span>
        <div className="h-3 w-[1px] shrink-0 bg-[var(--hairline)]" />
        <span className="shrink-0 text-xs font-bold text-[var(--primary)]">
          {progressPercent}%
        </span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ width: 200, height: 'auto', opacity: 0.9 }}
      animate={{ width: 320, height: 'auto', opacity: 1 }}
      transition={{
        width: { duration: 0.15, ease: 'easeOut' },
        opacity: { duration: 0.1 },
      }}
      className="workflow-iteration-feedback-card overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] hover:border-[var(--hairline-strong)]"
    >
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        transition={{
          height: { duration: 0.18, ease: 'easeOut', delay: 0.12 },
          opacity: { duration: 0.12, delay: 0.15 },
        }}
      >
      {/* Header/Expandable Area */}
      <button
        type="button"
        onClick={() => setIsCollapsed(true)}
        className="w-full text-left p-3.5 focus:outline-none group hover:bg-[var(--surface-2)] transition-colors"
      >
        <div className="flex items-center gap-3 mb-2.5">
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))] bg-[var(--primary-tint)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-tight text-[var(--primary)] shrink-0">
            {t('workflow.iterationFeedback.round', {
              round: currentRound,
              defaultValue: `Round ${currentRound}`,
            })}
          </div>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden relative bg-[var(--surface-3)]">
            <div
              className="h-full rounded-full bg-[var(--primary)] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="font-mono text-[10px] font-bold text-[var(--primary)] shrink-0">
            {progressPercent}%
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] uppercase font-medium text-[var(--ink-tertiary)]">
                {t('workflow.iterationFeedback.steps', {
                  defaultValue: 'Steps',
                })}
              </span>
              <span className="text-xs font-bold text-[var(--ink)]">
                {completedSteps} / {totalSteps}
              </span>
            </div>
            <div className="h-6 w-[1px] bg-[var(--hairline)]" />
            <div className="flex flex-col">
              <span className="font-mono text-[10px] uppercase font-medium text-[var(--ink-tertiary)]">
                {t('workflow.iterationFeedback.status', {
                  defaultValue: 'Status',
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <div className={cn('w-2 h-2 rounded-full', statusDotClass)} />
                <span className={cn('text-xs font-bold', statusTextClass)}>
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
          <ChevronUp className="w-4 h-4 text-[var(--ink-tertiary)] group-hover:text-[var(--primary)] transition-colors" />
        </div>

        {canSwitchRounds && (
          <div
            className="mt-3 flex items-center gap-1 overflow-x-auto rounded-lg bg-[var(--surface-2)] p-1"
            onClick={(event) => event.stopPropagation()}
          >
            {visibleRoundOptions.map((round) => {
              const isSelected = round.roundIndex === selectedRound;
              return (
                <button
                  key={round.roundIndex}
                  type="button"
                  onClick={() => {
                    onSelectRound?.(round.roundIndex);
                  }}
                  className={cn(
                    'min-w-10 rounded-md px-2.5 py-1.5 font-mono text-[10px] font-bold transition-colors',
                    isSelected
                      ? 'bg-[var(--surface-1)] text-[var(--primary)] border border-[var(--hairline)]'
                      : 'text-[var(--ink-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]'
                  )}
                  title={t('workflow.iterationFeedback.roundStatus', {
                    round: round.roundIndex,
                    status: round.status,
                    defaultValue: `Round ${round.roundIndex}: ${round.status}`,
                  })}
                >
                  R{round.roundIndex}
                </button>
              );
            })}
          </div>
        )}

        {runningStepTitle && (
          <div className="mt-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-3 py-2">
            <span className="block mb-0.5 font-mono text-[10px] uppercase text-[var(--ink-tertiary)]">
              {t('workflow.iterationFeedback.currentStep', {
                defaultValue: 'Current Step',
              })}
            </span>
            <p className="truncate text-xs font-medium text-[var(--ink-muted)]">
              {runningStepTitle}
            </p>
          </div>
        )}
      </button>

      {/* Review Section */}
      {canReviewCurrentRound && (
        <div
          className={cn(
            'border-t transition-all duration-300 p-4',
            expandedReject
              ? 'border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_6%,var(--surface-1))]'
              : 'border-[var(--hairline)] bg-[var(--primary-tint)]'
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  expandedReject ? 'bg-[var(--workflow-danger,#ef4444)]' : 'bg-[var(--primary)]'
                )}
              />
              <span
                className={cn(
                  'font-mono text-[10px] font-medium uppercase tracking-wider',
                  expandedReject ? 'text-[var(--workflow-danger,#ef4444)]' : 'text-[var(--primary)]'
                )}
              >
                {expandedReject
                  ? t('workflow.iterationFeedback.rejectWithFeedback', {
                      defaultValue: 'Reject with Feedback',
                    })
                  : t('workflow.iterationFeedback.reviewRequired', {
                      defaultValue: 'Review Required',
                    })}
              </span>
            </div>
          </div>

          {expandedReject && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="block mb-1 font-mono text-[10px] font-medium uppercase text-[var(--ink-tertiary)]">
                  {t('workflow.iterationFeedback.whatWrongLabel', {
                    defaultValue: 'What went wrong?',
                  })}
                </label>
                <textarea
                  value={whatWrong}
                  onChange={(e) => setWhatWrong(e.target.value)}
                  rows={2}
                  disabled={disabled || !canSubmit}
                  placeholder={t(
                    'workflow.iterationFeedback.whatWrongPlaceholder',
                    { defaultValue: 'Describe the issue...' }
                  )}
                  className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block mb-1 font-mono text-[10px] font-medium uppercase text-[var(--ink-tertiary)]">
                  {t('workflow.iterationFeedback.expectedLabel', {
                    defaultValue: 'Expected outcome',
                  })}
                </label>
                <textarea
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  rows={2}
                  disabled={disabled || !canSubmit}
                  placeholder={t(
                    'workflow.iterationFeedback.expectedPlaceholder',
                    { defaultValue: 'What should have happened?' }
                  )}
                  className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block mb-1 font-mono text-[10px] font-medium uppercase text-[var(--ink-tertiary)]">
                    {t('workflow.iterationFeedback.priorityLabel', {
                      defaultValue: 'Priority',
                    })}
                  </label>
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as 'high' | 'medium' | 'low')
                    }
                    disabled={disabled || !canSubmit}
                    className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                  >
                    <option value="high">
                      {t('workflow.iterationFeedback.priorityHigh', {
                        defaultValue: 'High',
                      })}
                    </option>
                    <option value="medium">
                      {t('workflow.iterationFeedback.priorityMedium', {
                        defaultValue: 'Medium',
                      })}
                    </option>
                    <option value="low">
                      {t('workflow.iterationFeedback.priorityLow', {
                        defaultValue: 'Low',
                      })}
                    </option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block mb-1 font-mono text-[10px] font-medium uppercase text-[var(--ink-tertiary)]">
                  {t('workflow.iterationFeedback.additionalNotesLabel', {
                    defaultValue: 'Additional Notes',
                  })}
                </label>
                <textarea
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  rows={2}
                  disabled={disabled || !canSubmit}
                  placeholder={t(
                    'workflow.iterationFeedback.additionalNotesPlaceholder',
                    { defaultValue: 'Optional notes...' }
                  )}
                  className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)] p-3 text-xs text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              {validationError && (
                <div className="text-[10px] font-medium text-[var(--workflow-danger,#ef4444)]">
                  {validationError}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {!expandedReject && (
              <button
                type="button"
                onClick={handleAccept}
                disabled={disabled || !canSubmit}
                className="flex-1 rounded-lg border border-[var(--primary)] bg-[var(--primary)] py-2.5 text-xs font-bold text-[var(--on-primary)] transition-all hover:bg-[var(--primary-hover)] hover:border-[var(--primary-hover)] active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {t('workflow.iterationFeedback.accept', {
                  defaultValue: 'ACCEPT',
                })}
              </button>
            )}
            <button
              type="button"
              onClick={handleReject}
              disabled={disabled || !canSubmit}
              className={cn(
                'flex-1 rounded-lg py-2.5 text-xs font-bold transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100',
                expandedReject
                  ? 'border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)] hover:bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_16%,var(--surface-1))]'
                  : 'border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]'
              )}
            >
              {expandedReject
                ? t('workflow.iterationFeedback.submitRejection', {
                    defaultValue: 'SUBMIT REJECTION',
                  })
                : t('workflow.iterationFeedback.reject', {
                    defaultValue: 'REJECT',
                  })}
            </button>
            {expandedReject && (
              <button
                type="button"
                onClick={() => {
                  setExpandedReject(false);
                  setValidationError(null);
                }}
                className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-4 py-2.5 text-xs font-bold text-[var(--ink-tertiary)] transition-all hover:bg-[var(--surface-3)] hover:text-[var(--ink-muted)]"
              >
                {t('workflow.iterationFeedback.cancel', {
                  defaultValue: 'CANCEL',
                })}
              </button>
            )}
          </div>
        </div>
      )}
      </motion.div>
    </motion.div>
  );
}
