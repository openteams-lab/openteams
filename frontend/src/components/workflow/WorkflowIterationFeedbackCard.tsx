import { useEffect, useState } from 'react';
import { Check, ChevronUp, X } from 'lucide-react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { motion } from 'framer-motion';
import type { WorkflowIterationSummaryData } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  workflowExecutionStatusDotClass,
  workflowExecutionStatusLabel,
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
  const { t } = useAppTranslation();
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
      return;
    }

    setIsCollapsed(true);
    setExpandedReject(false);
    setValidationError(null);
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
  const statusGlowClass =
    effectiveExecutionStatus === 'failed'
      ? 'shadow-[0_0_10px_color-mix(in_srgb,var(--workflow-danger,#ef4444)_55%,transparent)]'
      : effectiveExecutionStatus === 'completed'
        ? 'shadow-[0_0_10px_color-mix(in_srgb,var(--success)_42%,transparent)]'
        : 'shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_48%,transparent)]';
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
          'workflow-iteration-feedback-card flex h-8 w-fit min-w-[200px] max-w-[calc(100vw-3rem)] items-center gap-2 overflow-hidden rounded-lg border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-bg)] px-3 [box-shadow:var(--workflow-iteration-shadow)] whitespace-nowrap transition-all hover:border-[var(--workflow-iteration-border-hover)] group',
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
          <div
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              statusDotClass,
              statusGlowClass
            )}
          />
          <span className="font-mono text-xs font-semibold tabular-nums text-[var(--workflow-iteration-text)]">
            R{currentRound}
          </span>
        </div>
        <div className="h-3 w-px shrink-0 bg-[var(--workflow-iteration-divider)]" />
        <span className="min-w-0 truncate font-mono text-xs font-medium tabular-nums text-[var(--workflow-iteration-muted)]">
          {completedSteps} / {totalSteps}{' '}
          {t('workflow.iterationFeedback.steps', { defaultValue: 'Steps' })}
        </span>
        <div className="h-3 w-px shrink-0 bg-[var(--workflow-iteration-divider)]" />
        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[var(--workflow-iteration-text)]">
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
      className="workflow-iteration-feedback-card overflow-hidden rounded-[10px] border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-bg)] [box-shadow:var(--workflow-iteration-expanded-shadow)] backdrop-blur-sm transition-colors hover:border-[var(--workflow-iteration-border-hover)]"
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
        className="w-full p-4 text-left transition-colors focus:outline-none group hover:bg-[var(--workflow-iteration-hover-bg)]"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="shrink-0 rounded-md border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-subtle-bg)] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tabular-nums text-[var(--workflow-iteration-muted)]">
            {t('workflow.iterationFeedback.round', {
              round: currentRound,
              defaultValue: `Round ${currentRound}`,
            })}
          </div>
          <div className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--workflow-iteration-divider)]">
            <div
              className="h-full rounded-full bg-[var(--primary)] shadow-[0_0_12px_color-mix(in_srgb,var(--primary)_45%,transparent)] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] font-semibold tabular-nums text-[var(--workflow-iteration-text)]">
            {progressPercent}%
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
                {t('workflow.iterationFeedback.steps', {
                  defaultValue: 'Steps',
                })}
              </span>
              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--workflow-iteration-text)]">
                {completedSteps} / {totalSteps}
              </span>
            </div>
            <div className="h-6 w-px bg-[var(--workflow-iteration-divider)]" />
            <div className="flex flex-col">
              <span className="font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
                {t('workflow.iterationFeedback.status', {
                  defaultValue: 'Status',
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    statusDotClass,
                    statusGlowClass
                  )}
                />
                <span
                  className={cn(
                    'text-xs font-semibold text-[var(--workflow-iteration-text)]',
                    effectiveExecutionStatus === 'failed' &&
                      'text-[var(--workflow-danger,#ef4444)]'
                  )}
                >
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>
          <ChevronUp className="h-4 w-4 text-[var(--workflow-iteration-muted)] transition-colors group-hover:text-[var(--workflow-iteration-text)]" />
        </div>

        {canSwitchRounds && (
          <div
            className="mt-3 flex items-center gap-1 overflow-x-auto rounded-md border border-[var(--workflow-iteration-border-muted)] bg-[var(--workflow-iteration-subtle-bg)] p-1"
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
                    'min-w-10 rounded px-2.5 py-1.5 font-mono text-[10px] font-semibold tabular-nums transition-colors',
                    isSelected
                      ? 'border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-selected-bg)] text-[var(--workflow-iteration-text)]'
                      : 'text-[var(--workflow-iteration-muted)] hover:bg-[var(--workflow-iteration-hover-bg)] hover:text-[var(--workflow-iteration-text)]'
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
          <div className="mt-3 rounded-md border border-[var(--workflow-iteration-border-muted)] bg-[var(--workflow-iteration-subtle-bg)] px-3 py-2">
            <span className="mb-0.5 block font-mono text-[10px] uppercase text-[var(--workflow-iteration-muted)]">
              {t('workflow.iterationFeedback.currentStep', {
                defaultValue: 'Current Step',
              })}
            </span>
            <p className="truncate text-xs font-medium text-[var(--workflow-iteration-text)]">
              {runningStepTitle}
            </p>
          </div>
        )}
      </button>

      {/* Review Section */}
      {canReviewCurrentRound && (
        <div
          className={cn(
            'border-t border-[var(--workflow-iteration-border-muted)] bg-transparent px-4 py-2.5 transition-all duration-300'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-3',
              expandedReject ? 'mb-3 justify-between' : 'justify-end'
            )}
          >
            {expandedReject && (
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--workflow-danger,#ef4444)] shadow-[0_0_10px_color-mix(in_srgb,var(--workflow-danger,#ef4444)_55%,transparent)]" />
                <span className="truncate font-mono text-[10px] font-medium uppercase text-[var(--workflow-danger,#ef4444)]">
                  {t('workflow.iterationFeedback.rejectWithFeedback', {
                    defaultValue: 'Feedback',
                  })}
                </span>
              </div>
            )}

            {!expandedReject && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={disabled || !canSubmit}
                  className="inline-flex h-7 w-20 items-center justify-center gap-1.5 rounded-md border border-[var(--workflow-iteration-border)] bg-transparent text-[13px] font-medium text-[var(--workflow-iteration-muted)] [box-shadow:var(--workflow-iteration-button-shadow)] transition-colors hover:border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_20%,transparent)] hover:bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,transparent)] hover:text-[#d95c61] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                >
                  <X
                    className="h-3.5 w-3.5"
                    strokeWidth={2.3}
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                  />
                  {t('workflow.iterationFeedback.reject', {
                    defaultValue: 'REJECT',
                  })}
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={disabled || !canSubmit}
                  className="inline-flex h-7 w-20 items-center justify-center gap-1.5 rounded-md border border-[var(--workflow-iteration-accept-border)] bg-[var(--workflow-iteration-accept-bg)] text-[13px] font-medium text-[var(--workflow-iteration-accept-text)] [box-shadow:var(--workflow-iteration-accept-shadow)] transition-colors hover:bg-[var(--workflow-iteration-accept-hover-bg)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
                >
                  <Check
                    className="h-3.5 w-3.5"
                    strokeWidth={2.3}
                    strokeLinecap="square"
                    strokeLinejoin="miter"
                  />
                  {t('workflow.iterationFeedback.accept', {
                    defaultValue: 'ACCEPT',
                  })}
                </button>
              </div>
            )}
          </div>

          {expandedReject && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="mb-1 block font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
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
                  className="w-full rounded-md border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-field-bg)] p-3 text-xs text-[var(--workflow-iteration-text)] outline-none transition-all placeholder:text-[var(--workflow-iteration-placeholder)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
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
                  className="w-full rounded-md border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-field-bg)] p-3 text-xs text-[var(--workflow-iteration-text)] outline-none transition-all placeholder:text-[var(--workflow-iteration-placeholder)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
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
                    className="w-full rounded-md border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-field-bg)] px-3 py-2 text-xs text-[var(--workflow-iteration-text)] outline-none focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
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
                <label className="mb-1 block font-mono text-[10px] font-medium uppercase text-[var(--workflow-iteration-muted)]">
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
                  className="w-full rounded-md border border-[var(--workflow-iteration-border)] bg-[var(--workflow-iteration-field-bg)] p-3 text-xs text-[var(--workflow-iteration-text)] outline-none transition-all placeholder:text-[var(--workflow-iteration-placeholder)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:opacity-60"
                />
              </div>
              {validationError && (
                <div className="text-[10px] font-medium text-[var(--workflow-danger,#ef4444)]">
                  {validationError}
                </div>
              )}
            </div>
          )}

          {expandedReject && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleReject}
                disabled={disabled || !canSubmit}
                className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_24%,transparent)] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_10%,transparent)] px-3 text-[13px] font-medium text-[var(--workflow-danger,#ef4444)] transition-colors hover:bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_15%,transparent)] hover:text-[#ff5d5d] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                <X
                  className="h-3.5 w-3.5"
                  strokeWidth={2.3}
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                />
                {t('workflow.iterationFeedback.submitRejection', {
                  defaultValue: 'SUBMIT REJECTION',
                })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpandedReject(false);
                  setValidationError(null);
                }}
                className="inline-flex h-7 items-center justify-center rounded-md border border-[var(--workflow-iteration-border)] bg-transparent px-3 text-[13px] font-medium text-[var(--workflow-iteration-muted)] transition-colors hover:bg-[var(--workflow-iteration-hover-bg)] hover:text-[var(--workflow-iteration-text)]"
              >
                {t('workflow.iterationFeedback.cancel', {
                  defaultValue: 'CANCEL',
                })}
              </button>
            </div>
          )}
        </div>
      )}
      </motion.div>
    </motion.div>
  );
}
