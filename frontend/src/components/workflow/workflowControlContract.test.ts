import assert from 'node:assert/strict';
import type { WorkflowCardData } from '@/lib/api';
import {
  canMarkWorkflowExecutionCompleted,
  canPauseWorkflowExecution,
  canResumeWorkflowExecution,
  canSkipWorkflowStep,
} from './workflowControlContract';

const projection = (execution_status: string, stopped_by_user: boolean) =>
  ({ execution_status, stopped_by_user }) satisfies Pick<
    WorkflowCardData,
    'execution_status' | 'stopped_by_user'
  >;

assert.equal(canPauseWorkflowExecution(projection('running', false)), true);
assert.equal(canPauseWorkflowExecution(projection('failed', false)), false);
assert.equal(canResumeWorkflowExecution(projection('paused', false)), true);
assert.equal(canResumeWorkflowExecution(projection('failed', false)), true);
assert.equal(canResumeWorkflowExecution(projection('failed', true)), false);
assert.equal(canResumeWorkflowExecution(projection('running', false)), false);
for (const status of ['interrupted', 'blocked', 'failed']) {
  assert.equal(canSkipWorkflowStep(status), true);
}
for (const status of ['pending', 'running', 'completed', 'skipped']) {
  assert.equal(canSkipWorkflowStep(status), false);
}
assert.equal(
  canMarkWorkflowExecutionCompleted(projection('failed', false)),
  true
);
assert.equal(
  canMarkWorkflowExecutionCompleted(projection('paused', false)),
  true
);
for (const status of [
  'pending',
  'running',
  'waiting',
  'recompiling',
  'completed',
]) {
  assert.equal(
    canMarkWorkflowExecutionCompleted(projection(status, false)),
    false
  );
}
console.log('workflowControlContract stop and skip semantics: PASS');
