import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(
  projectRoot,
  'src',
  'lib',
  'workflowRequestPolicy.ts'
);

const source = await readFile(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiled.outputText
).toString('base64')}`;

const {
  WORKFLOW_CARD_REFETCH_INTERVAL_MS,
  WORKFLOW_TRANSCRIPT_REFETCH_INTERVAL_MS,
  buildWorkflowCardUrl,
  getWorkflowCardMessageIdsNeedingRefresh,
  getWorkflowCardRefetchInterval,
  getWorkflowTranscriptRefetchInterval,
  isTerminalWorkflowProjection,
} = await import(moduleUrl);

const terminalProjection = {
  state: 'completed',
  execution_status: 'completed',
};

const runningProjection = {
  state: 'running',
  execution_status: 'running',
};

assert.equal(
  buildWorkflowCardUrl('message 1'),
  '/api/chat/messages/message%201/workflow-card?detail=summary'
);

assert.equal(isTerminalWorkflowProjection(terminalProjection), true);
assert.equal(isTerminalWorkflowProjection(runningProjection), false);
assert.equal(
  isTerminalWorkflowProjection({
    state: 'waiting',
    execution_status: 'waiting',
    is_terminal: true,
  }),
  true
);

assert.equal(getWorkflowCardRefetchInterval([terminalProjection]), false);
assert.equal(
  getWorkflowCardRefetchInterval([undefined]),
  WORKFLOW_CARD_REFETCH_INTERVAL_MS
);
assert.equal(
  getWorkflowCardRefetchInterval([terminalProjection, runningProjection]),
  WORKFLOW_CARD_REFETCH_INTERVAL_MS
);

assert.equal(
  getWorkflowTranscriptRefetchInterval({
    isOpen: true,
    projection: terminalProjection,
  }),
  false
);
assert.equal(
  getWorkflowTranscriptRefetchInterval({
    isOpen: true,
    projection: runningProjection,
  }),
  WORKFLOW_TRANSCRIPT_REFETCH_INTERVAL_MS
);

assert.deepEqual(
  getWorkflowCardMessageIdsNeedingRefresh({
    messageIds: ['a', 'b', 'c'],
    cachedProjectionByMessageId: {
      a: terminalProjection,
      b: runningProjection,
    },
  }),
  ['b', 'c']
);

assert.deepEqual(
  getWorkflowCardMessageIdsNeedingRefresh({
    messageIds: ['a', 'b'],
    cachedProjectionByMessageId: {
      a: terminalProjection,
      b: runningProjection,
    },
    force: true,
  }),
  ['a', 'b']
);

console.log('workflow request policy tests passed');
