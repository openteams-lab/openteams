import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findNextWorkflowNodeId } from './WorkflowGraphBoard';

const current = { id: 'center', centerX: 100, centerY: 100 };
const nodes = [
  current,
  { id: 'left-near', centerX: 80, centerY: 140 },
  { id: 'left-far', centerX: 50, centerY: 100 },
  { id: 'right', centerX: 130, centerY: 105 },
  { id: 'up', centerX: 110, centerY: 70 },
  { id: 'down', centerX: 90, centerY: 125 },
];
assert.equal(findNextWorkflowNodeId(current, nodes, 'left'), 'left-near');
assert.equal(findNextWorkflowNodeId(current, nodes, 'right'), 'right');
assert.equal(findNextWorkflowNodeId(current, nodes, 'up'), 'up');
assert.equal(findNextWorkflowNodeId(current, nodes, 'down'), 'down');
assert.equal(findNextWorkflowNodeId(current, [current], 'left'), null);

const card = readFileSync(new URL('./WorkflowCard.tsx', import.meta.url), 'utf8');
const windowSource = readFileSync(new URL('./WorkflowWindow.tsx', import.meta.url), 'utf8');
const graph = readFileSync(new URL('./WorkflowGraphBoard.tsx', import.meta.url), 'utf8');
assert.ok(card.includes("useShortcutScope('workflow-session'"));
assert.ok(card.includes("useCommandHandler('workflow.open'"));
assert.ok(card.includes('setWindowOpen(true)'));
assert.ok(graph.includes("useShortcutScope('workflow-graph'"));
assert.ok(graph.includes('active: isOpen && !historicalRound'));
assert.ok(graph.includes('data-workflow-node-id={node.id}'));
for (const commandId of [
  'workflow.node.up',
  'workflow.node.down',
  'workflow.node.left',
  'workflow.node.right',
  'workflow.node.open',
  'workflow.node.retry',
  'workflow.node.retry-review',
  'workflow.node.chat.toggle',
]) {
  assert.ok(windowSource.includes(`useCommandHandler('${commandId}'`), commandId);
}
assert.ok(windowSource.includes('handleNodeClick'));
assert.ok(windowSource.includes("useShortcutScope('workflow-node-detail'"));
assert.ok(windowSource.includes("onRetryStep?.(activeStep.id, 'review')"));
assert.ok(windowSource.includes('setIsChatVisible((visible) => !visible)'));
console.log('Workflow open and spatial shortcuts: PASS');
