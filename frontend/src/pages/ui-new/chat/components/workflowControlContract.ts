import type { WorkflowCardData } from '@/lib/api';

type WorkflowProjectionLike = Pick<WorkflowCardData, 'execution_status'>;

export function isRetryableWorkflowStepStatus(status?: string | null) {
  return status === 'failed' || status === 'interrupted';
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
