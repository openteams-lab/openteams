import assert from 'node:assert/strict';

import type {
  Member,
  MemberQueueSnapshot,
  Message,
  QueuedMessageStatus,
} from '@/types';
import {
  correlateRunningPlaceholdersWithPending,
  findRunningPlaceholderIndexesForIncoming,
  isStartingPlaceholderRepresentedInQueue,
  makePendingAgentPlaceholders,
  mergePersistedWithRunningPlaceholders,
  mergeCarriedRunPlaceholder,
  reconcileProcessingQueuePlaceholders,
} from './WorkspaceContext';

const members: Member[] = [
  {
    id: 'session-agent-alpha',
    avatar: 'AL',
    name: '@Alpha',
    modelName: 'alpha-model',
    roleDetail: 'alpha-model · idle',
    status: 'on',
  },
  {
    id: 'session-agent-beta',
    avatar: 'BE',
    name: '@Beta',
    modelName: 'beta-model',
    roleDetail: 'beta-model · idle',
    status: 'on',
  },
];

const pending = makePendingAgentPlaceholders(
  ['alpha', 'BETA', 'alpha'],
  'msg-user-client-1',
  members,
  'session-1',
);

assert.equal(pending.length, 2, 'deduplicates targets without losing case-insensitive matches');
assert.notEqual(pending[0].id, pending[1].id, 'uses one stable identity per target');
assert.equal(pending[0].runId, undefined, 'starting placeholders never expose a run id');
assert.equal(pending[0].sessionAgentId, 'session-agent-alpha');

const runningAlpha: Message = {
  ...pending[0],
  id: 'run-real-alpha',
  runId: 'run-alpha',
  sourceMessageId: 'backend-message-1',
};
const upgraded = correlateRunningPlaceholdersWithPending(pending, [runningAlpha]);

assert.equal(upgraded.current.length, 2, 'upgrades without changing list length');
assert.equal(upgraded.current[0].id, pending[0].id, 'preserves the React key');
assert.equal(upgraded.current[0].runId, 'run-alpha', 'adds the queryable run id');
assert.equal(upgraded.current[1].id, pending[1].id, 'does not replace another target');
assert.equal(upgraded.runningPlaceholders.length, 0, 'does not append a duplicate row');

const startingSnapshot: Message = {
  ...pending[0],
  id: 'runtime-starting-alpha',
  createdAt: '2099-01-01T00:00:00.000Z',
};
const monotonic = mergeCarriedRunPlaceholder(
  upgraded.current[0],
  startingSnapshot,
);
assert.equal(monotonic.runId, 'run-alpha', 'never downgrades a real run to starting');
assert.equal(monotonic.id, pending[0].id, 'keeps the upgraded row identity');

const immediateRunning = correlateRunningPlaceholdersWithPending([], [
  runningAlpha,
]);
assert.equal(immediateRunning.current.length, 0);
assert.equal(
  immediateRunning.runningPlaceholders[0].runId,
  'run-alpha',
  'allows the first paint to be running when startup finishes within one frame',
);

const newSessionPending = makePendingAgentPlaceholders(
  ['Project Lead'],
  'msg-user-new-session',
  [],
  'session-new',
  {
    avatar: 'PL',
    name: '@Project Lead',
    modelName: 'lead-model',
  },
);
const newSessionRunning: Message = {
  ...newSessionPending[0],
  id: 'run-new-session',
  sender: '@internal-agent-name',
  sessionAgentId: 'new-session-agent-id',
  runId: 'run-new-session',
};
const newSessionUpgrade = correlateRunningPlaceholdersWithPending(
  newSessionPending,
  [newSessionRunning],
);
assert.equal(
  newSessionUpgrade.current[0].id,
  newSessionPending[0].id,
  'uses a unique client-message fallback when a new session lacks member ids',
);
assert.equal(newSessionUpgrade.current[0].runId, 'run-new-session');

const runningBeta: Message = {
  ...pending[1],
  id: 'run-real-beta',
  runId: 'run-beta',
  sourceMessageId: 'backend-message-1',
};
const twoRunning = correlateRunningPlaceholdersWithPending(pending, [
  runningAlpha,
  runningBeta,
]).current;
const finalAlpha: Message = {
  ...runningAlpha,
  id: 'final-alpha',
  text: 'alpha finished',
  isAgentRunning: undefined,
  isThinking: undefined,
};
assert.deepEqual(
  findRunningPlaceholderIndexesForIncoming(twoRunning, finalAlpha),
  [0],
  'a final reply only replaces its own target when client ids are shared',
);

const persistedUser: Message = {
  id: 'backend-message-1',
  sessionId: 'session-1',
  avatar: 'YOU',
  sender: 'You',
  time: 'just now',
  text: '@Alpha @Beta work',
  isUser: true,
  clientMessageId: 'msg-user-client-1',
};
const refreshed = mergePersistedWithRunningPlaceholders(
  [persistedUser],
  pending,
  new Set<string>(),
  [],
);
assert.deepEqual(
  refreshed.filter((message) => message.isAgentRunning).map((message) => message.id),
  pending.map((message) => message.id),
  'message refresh carries every optimistic starting placeholder',
);

const alphaQueue: MemberQueueSnapshot[] = [
  {
    session_id: 'session-1',
    session_agent_id: 'session-agent-alpha',
    agent_id: 'agent-alpha',
    status: 'queued' as const,
    blocked: false,
    paused: false,
    can_continue: false,
    queued_count: 1n,
    items: [
      {
        message: {
          id: 'queue-alpha',
          session_id: 'session-1',
          session_agent_id: 'session-agent-alpha',
          agent_id: 'agent-alpha',
          chat_message_id: 'msg-user-client-1',
          status: 'queued' as QueuedMessageStatus,
          created_at: '2026-07-19T00:00:00.000Z',
          updated_at: '2026-07-19T00:00:00.000Z',
          processing_started_at: null,
          run_id: null,
          failure_reason: null,
        },
        can_delete: false,
      },
    ],
  },
];
assert.equal(
  isStartingPlaceholderRepresentedInQueue(pending[0], alphaQueue, 'session-1'),
  true,
);
assert.equal(
  isStartingPlaceholderRepresentedInQueue(pending[1], alphaQueue, 'session-1'),
  false,
  'another target queue cannot keep this failed starting placeholder alive',
);

const processingAlphaQueue: MemberQueueSnapshot = {
  ...alphaQueue[0],
  status: 'processing' as const,
  queued_count: 0n,
  items: [
    {
      message: {
        ...alphaQueue[0].items[0].message,
        id: 'queue-processing-alpha',
        chat_message_id: persistedUser.id,
        status: 'processing' as QueuedMessageStatus,
        processing_started_at: '2026-07-20T00:00:01.000Z',
      },
      can_delete: false,
    },
  ],
};
const claimed = reconcileProcessingQueuePlaceholders(
  [persistedUser, pending[1]],
  processingAlphaQueue,
  members,
);
const claimedAlpha = claimed.find(
  (message) =>
    message.isAgentRunning &&
    message.sessionAgentId === 'session-agent-alpha',
);
assert.ok(claimedAlpha, 'a claimed queue item creates a starting placeholder');
assert.equal(claimedAlpha.runId, undefined, 'processing never exposes a run id');
assert.equal(claimedAlpha.sourceMessageId, persistedUser.id);
assert.equal(claimedAlpha.clientMessageId, persistedUser.clientMessageId);
assert.match(
  claimedAlpha.id,
  /^pending-agent-queue-processing-/,
  'uses a distinct deterministic queue-processing identity',
);
assert.equal(
  claimed.indexOf(claimedAlpha),
  claimed.indexOf(persistedUser) + 1,
  'anchors the placeholder directly after its source message',
);

const claimedAgain = reconcileProcessingQueuePlaceholders(
  claimed,
  processingAlphaQueue,
  members,
);
assert.equal(
  claimedAgain.filter((message) => message.id === claimedAlpha.id).length,
  1,
  'repeated processing snapshots are idempotent',
);
assert.ok(
  claimedAgain.some((message) => message.id === pending[1].id),
  'reconciling one member leaves a sibling Agent placeholder intact',
);

const claimedUpgrade = correlateRunningPlaceholdersWithPending(claimedAgain, [
  runningAlpha,
]);
const upgradedClaimedAlpha = claimedUpgrade.current.find(
  (message) => message.runId === runningAlpha.runId,
);
assert.equal(
  upgradedClaimedAlpha?.id,
  claimedAlpha.id,
  'agent_run_started upgrades the claimed placeholder without changing its key',
);

const runningAlphaQueue: MemberQueueSnapshot = {
  ...processingAlphaQueue,
  status: 'running' as const,
  items: processingAlphaQueue.items.map((item) => ({
    ...item,
    message: {
      ...item.message,
      status: 'running' as QueuedMessageStatus,
      run_id: 'run-alpha',
    },
  })),
};
assert.ok(
  reconcileProcessingQueuePlaceholders(
    claimedAgain,
    runningAlphaQueue,
    members,
  ).some((message) => message.id === claimedAlpha.id),
  'the queue running snapshot cannot remove the row before run correlation',
);

const failedAlphaQueue: MemberQueueSnapshot = {
  ...processingAlphaQueue,
  status: 'paused' as const,
  blocked: true,
  paused: true,
  items: processingAlphaQueue.items.map((item) => ({
    ...item,
    message: {
      ...item.message,
      status: 'failed' as QueuedMessageStatus,
      failure_reason: 'failed before run creation',
    },
  })),
};
const failedClaim = reconcileProcessingQueuePlaceholders(
  claimedAgain,
  failedAlphaQueue,
  members,
);
assert.ok(
  !failedClaim.some((message) => message.id === claimedAlpha.id),
  'a failed queue claim removes only its still-starting placeholder',
);
assert.ok(
  failedClaim.some((message) => message.id === pending[1].id),
  'failure cleanup does not remove another Agent placeholder',
);

console.log('agent placeholder state: ok');
