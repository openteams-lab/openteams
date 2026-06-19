type WorkflowCardReviewLike = {
  reviewer_type?: string | null;
  verdict?: string | null;
  feedback?: string | null;
  review_round?: number | null;
};

type WorkflowLoopStatusMeta = {
  label: string;
  badgeClass: string;
  borderColor: string;
  surfaceClass: string;
  textClass: string;
};

type WorkflowStatusTone = {
  badgeClass: string;
  borderColor: string;
  accentColor: string;
  glowClass: string;
};

type TFunction = (key: string, opts?: Record<string, unknown>) => string;

const toTitleCase = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export function workflowStatusLabel(status?: string | null, t?: TFunction) {
  switch (status) {
    case 'interrupted':
      return (
        t?.('workflow.statusLabels.interrupted', {
          defaultValue: 'Interrupted',
        }) ?? 'Interrupted'
      );
    case 'interrupt_requested':
      return (
        t?.('workflow.statusLabels.stopRequested', {
          defaultValue: 'Stop Requested',
        }) ?? 'Stop Requested'
      );
    case 'waiting_input':
      return (
        t?.('workflow.statusLabels.waitingInput', {
          defaultValue: 'Waiting Input',
        }) ?? 'Waiting Input'
      );
    case 'waiting_review':
      return (
        t?.('workflow.statusLabels.reviewing', { defaultValue: 'Reviewing' }) ??
        'Reviewing'
      );
    case 'pre_completed':
      return (
        t?.('workflow.statusLabels.preCompleted', {
          defaultValue: 'Pre-Completed',
        }) ?? 'Pre-Completed'
      );
    case 'running':
      return (
        t?.('workflow.statusLabels.running', { defaultValue: 'Running' }) ??
        'Running'
      );
    case 'completed':
      return (
        t?.('workflow.statusLabels.completed', { defaultValue: 'Completed' }) ??
        'Completed'
      );
    case 'failed':
      return (
        t?.('workflow.statusLabels.failed', { defaultValue: 'Failed' }) ??
        'Failed'
      );
    case 'pending':
      return (
        t?.('workflow.statusLabels.pending', { defaultValue: 'Pending' }) ??
        'Pending'
      );
    case 'ready':
      return (
        t?.('workflow.statusLabels.ready', { defaultValue: 'Ready' }) ?? 'Ready'
      );
    default:
      return status
        ? toTitleCase(status)
        : (t?.('workflow.statusLabels.pending', { defaultValue: 'Pending' }) ??
            'Pending');
  }
}

export function workflowExecutionStatusLabel(
  status?: string | null,
  t?: TFunction
) {
  switch (status) {
    case 'running':
      return (
        t?.('workflow.executionStatus.running', { defaultValue: 'Running' }) ??
        'Running'
      );
    case 'failed':
      return (
        t?.('workflow.executionStatus.failed', { defaultValue: 'Failed' }) ??
        'Failed'
      );
    case 'paused':
      return (
        t?.('workflow.executionStatus.paused', { defaultValue: 'Paused' }) ??
        'Paused'
      );
    case 'waiting':
      return (
        t?.('workflow.executionStatus.waiting', {
          defaultValue: 'Waiting Review',
        }) ?? 'Waiting Review'
      );
    case 'recompiling':
      return (
        t?.('workflow.executionStatus.recompiling', {
          defaultValue: 'Regenerating plan',
        }) ?? 'Regenerating plan'
      );
    case 'completed':
      return (
        t?.('workflow.executionStatus.completed', {
          defaultValue: 'Completed',
        }) ?? 'Completed'
      );
    case 'pending':
      return (
        t?.('workflow.executionStatus.pending', {
          defaultValue: 'Preparing',
        }) ?? 'Preparing'
      );
    default:
      return status
        ? toTitleCase(status)
        : (t?.('workflow.executionStatus.pending', {
            defaultValue: 'Preparing',
          }) ?? 'Preparing');
  }
}

export function workflowExecutionStatusDotClass(status?: string | null) {
  switch (status) {
    case 'running':
      return 'bg-[var(--primary)] animate-pulse';
    case 'failed':
      return 'bg-[var(--workflow-danger,#ef4444)]';
    case 'paused':
      return 'bg-[var(--ink-tertiary)]';
    case 'waiting':
      return 'bg-[var(--primary)] animate-pulse';
    case 'recompiling':
      return 'bg-[var(--primary)] animate-pulse';
    case 'completed':
      return 'bg-[var(--success)]';
    default:
      return 'bg-[var(--hairline-strong)]';
  }
}

export function workflowExecutionStatusTextClass(status?: string | null) {
  switch (status) {
    case 'running':
    case 'completed':
      return status === 'completed'
        ? 'text-[var(--success)]'
        : 'text-[var(--primary)]';
    case 'failed':
      return 'text-[var(--workflow-danger,#ef4444)]';
    case 'paused':
      return 'text-[var(--ink-subtle)]';
    case 'waiting':
      return 'text-[var(--primary)]';
    case 'recompiling':
      return 'text-[var(--primary)]';
    default:
      return 'text-[var(--ink-tertiary)]';
  }
}

export function workflowStatusTone(
  status?: string | null,
  selected = false
): WorkflowStatusTone {
  const base = (() => {
    switch (status) {
      case 'completed':
        return {
          badgeClass:
            'bg-[color-mix(in_srgb,var(--success)_12%,var(--surface-1))] text-[var(--success)] border border-[color-mix(in_srgb,var(--success)_28%,var(--hairline))]',
          borderColor: 'var(--success)',
          accentColor:
            'color-mix(in srgb, var(--success) 18%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'pre_completed':
        return {
          badgeClass:
            'bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))] text-[var(--success)] border border-[color-mix(in_srgb,var(--success)_22%,var(--hairline))]',
          borderColor: 'var(--success)',
          accentColor:
            'color-mix(in srgb, var(--success) 14%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'running':
        return {
          badgeClass:
            'bg-[var(--primary-tint)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))]',
          borderColor: 'var(--primary)',
          accentColor:
            'color-mix(in srgb, var(--primary) 18%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'revising':
        return {
          badgeClass:
            'bg-[var(--primary-tint)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_22%,var(--hairline))]',
          borderColor: 'var(--primary)',
          accentColor:
            'color-mix(in srgb, var(--primary) 14%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'failed':
      case 'interrupted':
        return {
          badgeClass:
            'bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_12%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)] border border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_28%,var(--hairline))]',
          borderColor: 'var(--workflow-danger, #ef4444)',
          accentColor:
            'color-mix(in srgb, var(--workflow-danger, #ef4444) 16%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'interrupt_requested':
        return {
          badgeClass:
            'bg-[var(--primary-tint)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_22%,var(--hairline))]',
          borderColor: 'var(--primary)',
          accentColor:
            'color-mix(in srgb, var(--primary) 12%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'ready':
        return {
          badgeClass:
            'bg-[var(--surface-2)] text-[var(--ink-subtle)] border border-[var(--hairline)]',
          borderColor: 'var(--hairline-strong)',
          accentColor:
            'color-mix(in srgb, var(--hairline-strong) 28%, transparent)',
          glowClass: 'shadow-none',
        };
      case 'waiting_input':
      case 'waiting_review':
        return {
          badgeClass:
            'bg-[var(--primary-tint)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))]',
          borderColor: 'var(--primary)',
          accentColor:
            'color-mix(in srgb, var(--primary) 14%, transparent)',
          glowClass: 'shadow-none',
        };
      default:
        return {
          badgeClass:
            'bg-[var(--surface-2)] text-[var(--ink-subtle)] border border-[var(--hairline)]',
          borderColor: 'var(--hairline)',
          accentColor:
            'color-mix(in srgb, var(--hairline-strong) 20%, transparent)',
          glowClass: 'shadow-none',
        };
    }
  })();

  return {
    ...base,
    borderColor: selected ? 'var(--primary)' : base.borderColor,
  };
}

export function workflowStatusBadgeClass(status?: string | null) {
  switch (status) {
    case 'completed':
      return 'border-[color-mix(in_srgb,var(--success)_38%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface-1))] text-[var(--success)]';
    case 'pre_completed':
      return 'border-[color-mix(in_srgb,var(--success)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))] text-[var(--success)]';
    case 'running':
      return 'border-[color-mix(in_srgb,var(--primary)_38%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]';
    case 'revising':
      return 'border-[color-mix(in_srgb,var(--primary)_30%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]';
    case 'failed':
    case 'interrupted':
      return 'border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_38%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_12%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)]';
    case 'interrupt_requested':
    case 'ready':
      return 'border-[var(--hairline-strong)] bg-[var(--surface-2)] text-[var(--ink-subtle)]';
    case 'waiting_input':
    case 'waiting_review':
      return 'border-[color-mix(in_srgb,var(--primary)_34%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]';
    default:
      return 'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)]';
  }
}

export function workflowReviewPhaseMeta(
  reviewPhase?: string | null,
  t?: TFunction
) {
  switch (reviewPhase) {
    case 'worker_executing':
      return {
        label:
          t?.('workflow.reviewPhase.executing', {
            defaultValue: 'Executing',
          }) ?? 'Executing',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_34%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        textClass: 'text-[var(--primary)]',
      };
    case 'lead_reviewing':
      return {
        label:
          t?.('workflow.reviewPhase.leadReview', {
            defaultValue: 'Lead Review',
          }) ?? 'Lead Review',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        textClass: 'text-[var(--primary)]',
      };
    case 'waiting_user':
      return {
        label:
          t?.('workflow.reviewPhase.waitingUser', {
            defaultValue: 'Waiting User',
          }) ?? 'Waiting User',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        textClass: 'text-[var(--primary)]',
      };
    default:
      return reviewPhase
        ? {
            label: toTitleCase(reviewPhase),
            badgeClass:
              'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)]',
            textClass: 'text-[var(--ink-subtle)]',
          }
        : null;
  }
}

export function workflowReviewVerdictMeta(
  verdict?: string | null,
  t?: TFunction
) {
  switch (verdict) {
    case 'approved':
    case 'accepted':
      return {
        label:
          verdict === 'accepted'
            ? (t?.('workflow.reviewVerdict.accepted', {
                defaultValue: 'Accepted',
              }) ?? 'Accepted')
            : (t?.('workflow.reviewVerdict.approved', {
                defaultValue: 'Approved',
              }) ?? 'Approved'),
        badgeClass:
          'border-[color-mix(in_srgb,var(--success)_34%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface-1))] text-[var(--success)]',
        textClass: 'text-[var(--success)]',
      };
    case 'rejected':
      return {
        label:
          t?.('workflow.reviewVerdict.rejected', {
            defaultValue: 'Rejected',
          }) ?? 'Rejected',
        badgeClass:
          'border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_34%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_12%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)]',
        textClass: 'text-[var(--workflow-danger,#ef4444)]',
      };
    default:
      return {
        label: verdict
          ? toTitleCase(verdict)
          : (t?.('workflow.reviewVerdict.reviewed', {
              defaultValue: 'Reviewed',
            }) ?? 'Reviewed'),
        badgeClass:
          'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)]',
        textClass: 'text-[var(--ink-subtle)]',
      };
  }
}

export function workflowLatestReviewLabel(
  review?: WorkflowCardReviewLike | null,
  t?: TFunction
) {
  if (!review) {
    return null;
  }

  const verdict = workflowReviewVerdictMeta(review.verdict, t);
  const reviewer = review.reviewer_type
    ? toTitleCase(review.reviewer_type)
    : null;
  const round =
    typeof review.review_round === 'number' && review.review_round > 0
      ? (t?.('workflow.iterationFeedback.round', {
          round: review.review_round,
          defaultValue: `Round ${review.review_round}`,
        }) ?? `Round ${review.review_round}`)
      : null;

  return [reviewer, verdict.label, round].filter(Boolean).join(' - ');
}

export function workflowLatestReviewFeedback(
  review?: WorkflowCardReviewLike | null
) {
  const feedback = review?.feedback?.trim();
  return feedback && feedback.length > 0 ? feedback : null;
}

export function workflowLoopStatusMeta(
  status?: string | null,
  t?: TFunction
): WorkflowLoopStatusMeta {
  switch (status) {
    case 'running':
      return {
        label:
          t?.('workflow.statusLabels.running', { defaultValue: 'Running' }) ??
          'Running',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_34%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        borderColor: 'var(--primary)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-1))]',
        textClass: 'text-[var(--primary)]',
      };
    case 'waiting_review':
      return {
        label:
          t?.('workflow.statusLabels.reviewing', {
            defaultValue: 'Reviewing',
          }) ?? 'Reviewing',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        borderColor: 'var(--primary)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-1))]',
        textClass: 'text-[var(--primary)]',
      };
    case 'waiting_user':
      return {
        label:
          t?.('workflow.statusLabels.waitingUser', {
            defaultValue: 'Waiting User',
          }) ?? 'Waiting User',
        badgeClass:
          'border-[color-mix(in_srgb,var(--primary)_28%,var(--hairline))] bg-[var(--primary-tint)] text-[var(--primary)]',
        borderColor: 'var(--primary)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--primary)_8%,var(--surface-1))]',
        textClass: 'text-[var(--primary)]',
      };
    case 'passed':
      return {
        label:
          t?.('workflow.statusLabels.passed', { defaultValue: 'Passed' }) ??
          'Passed',
        badgeClass:
          'border-[color-mix(in_srgb,var(--success)_30%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))] text-[var(--success)]',
        borderColor: 'var(--success)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--success)_8%,var(--surface-1))]',
        textClass: 'text-[var(--success)]',
      };
    case 'completed':
      return {
        label:
          t?.('workflow.statusLabels.completed', {
            defaultValue: 'Completed',
          }) ?? 'Completed',
        badgeClass:
          'border-[color-mix(in_srgb,var(--success)_38%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface-1))] text-[var(--success)]',
        borderColor: 'var(--success)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))]',
        textClass: 'text-[var(--success)]',
      };
    case 'rejected':
      return {
        label:
          t?.('workflow.statusLabels.rejected', { defaultValue: 'Rejected' }) ??
          'Rejected',
        badgeClass:
          'border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_34%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_12%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)]',
        borderColor: 'var(--workflow-danger, #ef4444)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_8%,var(--surface-1))]',
        textClass: 'text-[var(--workflow-danger,#ef4444)]',
      };
    case 'failed':
      return {
        label:
          t?.('workflow.statusLabels.failed', { defaultValue: 'Failed' }) ??
          'Failed',
        badgeClass:
          'border-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_34%,var(--hairline))] bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_12%,var(--surface-1))] text-[var(--workflow-danger,#ef4444)]',
        borderColor: 'var(--workflow-danger, #ef4444)',
        surfaceClass: 'bg-[color-mix(in_srgb,var(--workflow-danger,#ef4444)_8%,var(--surface-1))]',
        textClass: 'text-[var(--workflow-danger,#ef4444)]',
      };
    default:
      return {
        label: status
          ? toTitleCase(status)
          : (t?.('workflow.statusLabels.loop', { defaultValue: 'Loop' }) ??
            'Loop'),
        badgeClass:
          'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-subtle)]',
        borderColor: 'var(--hairline-strong)',
        surfaceClass: 'bg-[var(--surface-2)]',
        textClass: 'text-[var(--ink-subtle)]',
      };
  }
}
