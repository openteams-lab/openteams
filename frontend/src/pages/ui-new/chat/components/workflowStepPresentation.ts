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
      return 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]';
    case 'failed':
      return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.45)]';
    case 'paused':
      return 'bg-amber-500';
    case 'waiting':
      return 'bg-violet-500 animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.45)]';
    case 'recompiling':
      return 'bg-[#5094fb] animate-pulse shadow-[0_0_8px_rgba(80,148,251,0.5)]';
    case 'completed':
      return 'bg-emerald-500';
    default:
      return 'bg-slate-300';
  }
}

export function workflowExecutionStatusTextClass(status?: string | null) {
  switch (status) {
    case 'running':
    case 'completed':
      return 'text-emerald-600';
    case 'failed':
      return 'text-rose-600';
    case 'paused':
      return 'text-amber-600';
    case 'waiting':
      return 'text-violet-600';
    case 'recompiling':
      return 'text-[#5094fb]';
    default:
      return 'text-slate-400';
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
          badgeClass: 'bg-[#DCFCE7] text-[#166534]',
          borderColor: '#16A34A',
          accentColor: 'rgba(34,197,94,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(34,197,94,0.10)]',
        };
      case 'pre_completed':
        return {
          badgeClass: 'bg-[#CCFBF1] text-[#115E59]',
          borderColor: '#0F766E',
          accentColor: 'rgba(20,184,166,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(20,184,166,0.12)]',
        };
      case 'running':
        return {
          badgeClass: 'bg-[#DBEAFE] text-[#1D4ED8]',
          borderColor: '#2563EB',
          accentColor: 'rgba(59,130,246,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(37,99,235,0.14)]',
        };
      case 'revising':
        return {
          badgeClass: 'bg-[#FFEDD5] text-[#C2410C]',
          borderColor: '#EA580C',
          accentColor: 'rgba(249,115,22,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(249,115,22,0.14)]',
        };
      case 'failed':
      case 'interrupted':
        return {
          badgeClass: 'bg-[#FEE2E2] text-[#991B1B]',
          borderColor: '#DC2626',
          accentColor: 'rgba(239,68,68,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(220,38,38,0.12)]',
        };
      case 'interrupt_requested':
        return {
          badgeClass: 'bg-[#FEF3C7] text-[#92400E]',
          borderColor: '#D97706',
          accentColor: 'rgba(245,158,11,0.18)',
          glowClass: 'shadow-[0_20px_40px_rgba(217,119,6,0.12)]',
        };
      case 'ready':
        return {
          badgeClass: 'bg-[#FEF3C7] text-[#92400E]',
          borderColor: '#D97706',
          accentColor: 'rgba(245,158,11,0.16)',
          glowClass: 'shadow-[0_20px_40px_rgba(217,119,6,0.12)]',
        };
      case 'waiting_input':
      case 'waiting_review':
        return {
          badgeClass: 'bg-[#E0E7FF] text-[#4338CA]',
          borderColor: '#6366F1',
          accentColor: 'rgba(99,102,241,0.16)',
          glowClass: 'shadow-[0_20px_40px_rgba(99,102,241,0.12)]',
        };
      default:
        return {
          badgeClass: 'bg-[#E2E8F0] text-[#334155]',
          borderColor: '#CBD5E1',
          accentColor: 'rgba(148,163,184,0.14)',
          glowClass: 'shadow-[0_16px_34px_rgba(15,23,42,0.08)]',
        };
    }
  })();

  return {
    ...base,
    borderColor: selected ? '#1D4ED8' : base.borderColor,
  };
}

export function workflowStatusBadgeClass(status?: string | null) {
  switch (status) {
    case 'completed':
      return 'border-[#86EFAC] bg-[#DCFCE7] text-[#166534]';
    case 'pre_completed':
      return 'border-[#99F6E4] bg-[#CCFBF1] text-[#115E59]';
    case 'running':
      return 'border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]';
    case 'revising':
      return 'border-[#FDBA74] bg-[#FFEDD5] text-[#C2410C]';
    case 'failed':
    case 'interrupted':
      return 'border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]';
    case 'interrupt_requested':
    case 'ready':
      return 'border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]';
    case 'waiting_input':
    case 'waiting_review':
      return 'border-[#C7D2FE] bg-[#E0E7FF] text-[#4338CA]';
    default:
      return 'border-[#CBD5E1] bg-[#F8FAFC] text-[#334155]';
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
        badgeClass: 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]',
        textClass: 'text-[#1D4ED8]',
      };
    case 'lead_reviewing':
      return {
        label:
          t?.('workflow.reviewPhase.leadReview', {
            defaultValue: 'Lead Review',
          }) ?? 'Lead Review',
        badgeClass: 'border-[#FCD34D] bg-[#FFFBEB] text-[#B45309]',
        textClass: 'text-[#B45309]',
      };
    case 'waiting_user':
      return {
        label:
          t?.('workflow.reviewPhase.waitingUser', {
            defaultValue: 'Waiting User',
          }) ?? 'Waiting User',
        badgeClass: 'border-[#C7D2FE] bg-[#EEF2FF] text-[#4338CA]',
        textClass: 'text-[#4338CA]',
      };
    default:
      return reviewPhase
        ? {
            label: toTitleCase(reviewPhase),
            badgeClass: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]',
            textClass: 'text-[#475569]',
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
        badgeClass: 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534]',
        textClass: 'text-[#166534]',
      };
    case 'rejected':
      return {
        label:
          t?.('workflow.reviewVerdict.rejected', {
            defaultValue: 'Rejected',
          }) ?? 'Rejected',
        badgeClass: 'border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]',
        textClass: 'text-[#991B1B]',
      };
    default:
      return {
        label: verdict
          ? toTitleCase(verdict)
          : (t?.('workflow.reviewVerdict.reviewed', {
              defaultValue: 'Reviewed',
            }) ?? 'Reviewed'),
        badgeClass: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]',
        textClass: 'text-[#475569]',
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
        badgeClass: 'border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]',
        borderColor: '#60A5FA',
        surfaceClass: 'bg-[rgba(219,234,254,0.28)]',
        textClass: 'text-[#1D4ED8]',
      };
    case 'waiting_review':
      return {
        label:
          t?.('workflow.statusLabels.reviewing', {
            defaultValue: 'Reviewing',
          }) ?? 'Reviewing',
        badgeClass: 'border-[#C7D2FE] bg-[#E0E7FF] text-[#4338CA]',
        borderColor: '#818CF8',
        surfaceClass: 'bg-[rgba(224,231,255,0.28)]',
        textClass: 'text-[#4338CA]',
      };
    case 'waiting_user':
      return {
        label:
          t?.('workflow.statusLabels.waitingUser', {
            defaultValue: 'Waiting User',
          }) ?? 'Waiting User',
        badgeClass: 'border-[#DDD6FE] bg-[#F3E8FF] text-[#7C3AED]',
        borderColor: '#A78BFA',
        surfaceClass: 'bg-[rgba(243,232,255,0.28)]',
        textClass: 'text-[#7C3AED]',
      };
    case 'passed':
      return {
        label:
          t?.('workflow.statusLabels.passed', { defaultValue: 'Passed' }) ??
          'Passed',
        badgeClass: 'border-[#99F6E4] bg-[#CCFBF1] text-[#115E59]',
        borderColor: '#2DD4BF',
        surfaceClass: 'bg-[rgba(204,251,241,0.30)]',
        textClass: 'text-[#115E59]',
      };
    case 'completed':
      return {
        label:
          t?.('workflow.statusLabels.completed', {
            defaultValue: 'Completed',
          }) ?? 'Completed',
        badgeClass: 'border-[#86EFAC] bg-[#DCFCE7] text-[#166534]',
        borderColor: '#4ADE80',
        surfaceClass: 'bg-[rgba(220,252,231,0.30)]',
        textClass: 'text-[#166534]',
      };
    case 'rejected':
      return {
        label:
          t?.('workflow.statusLabels.rejected', { defaultValue: 'Rejected' }) ??
          'Rejected',
        badgeClass: 'border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]',
        borderColor: '#F87171',
        surfaceClass: 'bg-[rgba(254,226,226,0.34)]',
        textClass: 'text-[#991B1B]',
      };
    case 'failed':
      return {
        label:
          t?.('workflow.statusLabels.failed', { defaultValue: 'Failed' }) ??
          'Failed',
        badgeClass: 'border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]',
        borderColor: '#EF4444',
        surfaceClass: 'bg-[rgba(254,226,226,0.34)]',
        textClass: 'text-[#991B1B]',
      };
    default:
      return {
        label: status
          ? toTitleCase(status)
          : (t?.('workflow.statusLabels.loop', { defaultValue: 'Loop' }) ??
            'Loop'),
        badgeClass: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]',
        borderColor: '#CBD5E1',
        surfaceClass: 'bg-[rgba(241,245,249,0.30)]',
        textClass: 'text-[#475569]',
      };
  }
}
