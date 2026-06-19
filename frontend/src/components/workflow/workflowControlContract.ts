import type { WorkflowCardData } from '@/lib/api';

type WorkflowProjectionLike = Pick<WorkflowCardData, 'execution_status'>;
type WorkflowStepLike = Pick<
  WorkflowCardData['steps'][number],
  | 'lead_review_required'
  | 'latest_review'
  | 'status'
  | 'summary_text'
  | 'content'
>;

export function isRetryableWorkflowStepStatus(status?: string | null) {
  return status === 'failed' || status === 'interrupted';
}

export function canRetryWorkflowStepReview(step?: WorkflowStepLike | null) {
  if (
    !step?.lead_review_required ||
    !isRetryableWorkflowStepStatus(step.status)
  ) {
    return false;
  }

  return Boolean(
    step.latest_review || step.summary_text?.trim() || step.content?.trim()
  );
}

export function isWorkflowExecutionRecompiling(
  projection: Pick<WorkflowProjectionLike, 'execution_status'>
) {
  return projection.execution_status === 'recompiling';
}

export function canPauseWorkflowExecution(projection: WorkflowProjectionLike) {
  return projection.execution_status === 'running';
}

export function canResumeWorkflowExecution(projection: WorkflowProjectionLike) {
  return (
    projection.execution_status === 'paused' ||
    projection.execution_status === 'failed'
  );
}
