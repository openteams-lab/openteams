import { useMemo, useState } from 'react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import type { WorkflowPendingReviewData } from '@/lib/api';
import { localizeWorkflowGeneratedText } from './workflowGeneratedText';

type WorkflowPendingReviewCardProps = {
  pendingReview: WorkflowPendingReviewData;
  pendingActionId?: string | null;
  onSubmit?: (action: 'approve' | 'reject', feedback?: string) => void;
};

function getReviewTypeLabel(
  reviewType: string,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  switch (reviewType) {
    case 'step_user_review':
      return t('workflow.pendingReview.reviewTypes.stepReview', {
        defaultValue: 'Step Review',
      });
    case 'loop_user_review':
      return t('workflow.pendingReview.reviewTypes.loopReview', {
        defaultValue: 'Loop Review',
      });
    case 'iteration_acceptance':
      return t('workflow.pendingReview.reviewTypes.finalReview', {
        defaultValue: 'Final Review',
      });
    default:
      return reviewType;
  }
}

export function WorkflowPendingReviewCard({
  pendingReview,
  pendingActionId,
  onSubmit,
}: WorkflowPendingReviewCardProps) {
  const { t } = useAppTranslation();
  const [expandedReject, setExpandedReject] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const feedbackField = useMemo(
    () =>
      pendingReview.prompt_template.fields.find(
        (field) => field.key === 'feedback' || field.field_type === 'textarea'
      ) ?? null,
    [pendingReview.prompt_template.fields]
  );
  const disabled = pendingActionId === pendingReview.review_id;
  const reviewMessage = pendingReview.prompt_template.message
    ? localizeWorkflowGeneratedText(pendingReview.prompt_template.message, t)
    : t('workflow.pendingReview.defaultMessage', {
        defaultValue: 'Please review the current result.',
      });
  const feedbackLabel =
    feedbackField?.key === 'feedback'
      ? t('workflow.pendingReview.feedbackLabel', {
          defaultValue: 'Feedback',
        })
      : feedbackField?.label
        ? localizeWorkflowGeneratedText(feedbackField.label, t)
        : t('workflow.pendingReview.feedbackLabel', {
            defaultValue: 'Feedback',
          });
  const feedbackPlaceholder =
    feedbackField?.key === 'feedback'
      ? t('workflow.pendingReview.feedbackPlaceholder', {
          defaultValue: 'Please provide specific revision comments',
        })
      : feedbackField?.placeholder
        ? localizeWorkflowGeneratedText(feedbackField.placeholder, t)
        : t('workflow.pendingReview.feedbackPlaceholder', {
            defaultValue: 'Please provide specific revision comments',
          });

  const handleApprove = () => {
    setExpandedReject(false);
    setValidationError(null);
    onSubmit?.('approve');
  };

  const handleReject = () => {
    if (!expandedReject) {
      setExpandedReject(true);
      return;
    }

    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback) {
      setValidationError(
        t('workflow.pendingReview.validationError', {
          defaultValue: 'Reject requires feedback.',
        })
      );
      return;
    }

    setValidationError(null);
    onSubmit?.('reject', trimmedFeedback);
  };

  return (
    <div className="workflow-pending-review-card relative overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-4 shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      {/* Left accent line with subtle glow */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-[#6e8de8]"
        style={{
          boxShadow: '0 0 6px 0 rgba(110, 141, 232, 0.4)',
        }}
      />

      {/* Header */}
      <div className="mb-3 flex items-center gap-1.5">
        <span className="inline-block w-[5px] h-[5px] rounded-full bg-[var(--workflow-review-accent)] opacity-90" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--workflow-review-accent)]">
          {t('workflow.pendingReview.title', { defaultValue: 'Pending Review' })}
        </span>
      </div>

      {/* Meta tags */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--workflow-review-meta)]">
          {getReviewTypeLabel(pendingReview.review_type, t)}
        </span>
        <span className="text-[var(--workflow-review-separator)] opacity-80">·</span>
        <span className="font-mono text-[10px] font-medium text-[var(--workflow-review-target)] truncate max-w-[200px]">
          {pendingReview.target_title}
        </span>
      </div>

      {/* Review message */}
      <p className="mb-3 text-[11px] font-medium leading-[1.6] text-[var(--workflow-review-body)]">
        {reviewMessage}
      </p>

      {/* Context section */}
      {pendingReview.context_summary && (
        <div className="mb-3 relative pl-3">
          {/* Left guide line */}
          <div className="absolute left-0 top-0.5 bottom-0.5 w-[1.5px] rounded-full bg-[var(--hairline-strong)] opacity-60" />
          <div className="mb-1 font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--workflow-review-label)]">
            {t('workflow.pendingReview.context', { defaultValue: 'Context' })}
          </div>
          <div className="whitespace-pre-wrap text-[11px] leading-[1.6] text-[var(--workflow-review-body)]">
            {localizeWorkflowGeneratedText(pendingReview.context_summary, t)}
          </div>
        </div>
      )}

      {/* Reject feedback area */}
      {expandedReject && (
        <div className="mb-3">
          <div className="mb-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--workflow-danger,#ef4444)] opacity-80">
            {feedbackLabel}
          </div>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={3}
            disabled={disabled}
            placeholder={feedbackPlaceholder}
            className="w-full rounded border border-[var(--hairline-strong)] bg-[var(--surface-2)] px-3 py-2 text-[11px] leading-[1.6] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-tertiary)] placeholder:opacity-60 focus:border-[var(--primary)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {validationError && (
            <div className="mt-1 text-[10px] text-[var(--workflow-danger,#ef4444)] opacity-90">
              {validationError}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={disabled || !onSubmit}
          className="flex-1 rounded py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] transition-all disabled:cursor-not-allowed disabled:opacity-40 border border-[#6e8de8]/30 text-[var(--workflow-review-accent)] bg-[#6e8de8]/8 hover:bg-[#6e8de8]/14 hover:border-[#6e8de8]/50"
        >
          {t('workflow.pendingReview.approve', { defaultValue: 'APPROVE' })}
        </button>
        <button
          type="button"
          onClick={handleReject}
          disabled={disabled || !onSubmit}
          className={`flex-1 rounded py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
            expandedReject
              ? 'border border-[rgba(229,72,77,0.3)] bg-transparent text-[#E5484D] hover:bg-[rgba(229,72,77,0.08)]'
              : 'border border-transparent bg-transparent text-[#E5484D] hover:bg-[rgba(229,72,77,0.06)]'
          }`}
        >
          {expandedReject
            ? t('workflow.pendingReview.submitReject', {
                defaultValue: 'SUBMIT REJECT',
              })
            : t('workflow.pendingReview.reject', { defaultValue: 'REJECT' })}
        </button>
      </div>
    </div>
  );
}
