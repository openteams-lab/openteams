import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('./WorkflowCard.tsx', import.meta.url), 'utf8');
const graph = readFileSync(
  new URL('./WorkflowGraphBoard.tsx', import.meta.url),
  'utf8',
);
const inspector = readFileSync(
  new URL('./WorkflowWindow.tsx', import.meta.url),
  'utf8',
);

assert.ok(card.includes('const [skipConfirmationStepId'));
assert.ok(card.includes('onSkipStep={handleRequestSkipStep}'));
assert.ok(card.includes('workflow.confirm.skipStepTitle'));
assert.ok(card.includes('workflow.confirm.skipStepDescription'));
assert.ok(card.includes('onConfirm={confirmSkipStep}'));
assert.ok(card.includes('workflowApi.skipStep(sessionId, stepId)'));

const graphActionsStart = graph.indexOf('{(canRetryStep || canSkipStep)');
const graphSkipActionStart = graph.indexOf(
  '{canSkipStep &&',
  graphActionsStart,
);
const graphRetryActionStart = graph.indexOf(
  '{canRetryStep &&',
  graphActionsStart,
);
assert.ok(graphSkipActionStart < graphRetryActionStart);
const graphSkipAction = graph.slice(graphSkipActionStart, graphRetryActionStart);
assert.ok(graphSkipAction.includes('bg-slate-500'));
assert.ok(graphSkipAction.includes('hover:bg-slate-600'));
assert.ok(graphSkipAction.includes('text-white'));
assert.equal(graphSkipAction.includes('bg-slate-500/'), false);

const inspectorSkipAction = inspector.slice(
  inspector.indexOf('{canSkipWorkflowStep(step.status)'),
  inspector.indexOf("{t('workflow.controls.skipStep'"),
);
assert.ok(inspectorSkipAction.includes('bg-transparent'));
assert.ok(inspectorSkipAction.includes('text-[var(--ink-tertiary)]'));

console.log('Workflow skip controls and confirmation: PASS');
