import assert from 'node:assert/strict';

import {
  buildConflictPaneModel,
  getConflictPaneActions,
  getConflictSpacerLineCounts,
  mergeConflictChoiceState,
} from './CodeMirrorConflictEditor';
import { parseConflictText } from './WorktreeMergeConflictsView';

assert.deepEqual(getConflictSpacerLineCounts('', 'one\ntwo\nthree\n'), {
  current: 3,
  incoming: 0,
});
assert.deepEqual(getConflictSpacerLineCounts('one\n', ''), {
  current: 0,
  incoming: 1,
});
assert.deepEqual(getConflictSpacerLineCounts('one\ntwo\n', 'three\n'), {
  current: 0,
  incoming: 1,
});
assert.deepEqual(getConflictSpacerLineCounts('one\n', 'two\n'), {
  current: 0,
  incoming: 0,
});

const repeatedTextConflict = parseConflictText(
  [
    'repeat\n',
    '<<<<<<< HEAD\n',
    'repeat\n',
    '=======\n',
    'incoming\n',
    '>>>>>>> session\n',
    'after\n',
  ].join(''),
);
const currentPane = buildConflictPaneModel(
  repeatedTextConflict,
  'current',
  {},
  'empty',
);
assert.equal(currentPane.content, 'repeat\nrepeat\nafter\n');
assert.deepEqual(
  {
    from: currentPane.regions[0]?.from,
    to: currentPane.regions[0]?.to,
    resolutionState: currentPane.regions[0]?.resolutionState,
  },
  { from: 7, to: 14, resolutionState: 'unresolved' },
);

const acceptedCurrentPane = buildConflictPaneModel(
  repeatedTextConflict,
  'current',
  { 'hunk-1': 'both' },
  'empty',
  { 'hunk-1': 'current' },
);
const suppressedIncomingPane = buildConflictPaneModel(
  repeatedTextConflict,
  'session',
  { 'hunk-1': 'both' },
  'empty',
  { 'hunk-1': 'current' },
);
assert.equal(acceptedCurrentPane.regions[0]?.resolutionState, 'accepted');
assert.equal(suppressedIncomingPane.regions[0]?.resolutionState, 'suppressed');

const firstChoice = mergeConflictChoiceState(
  {},
  {},
  'hunk-1',
  'session',
  'incoming',
);
const secondChoice = mergeConflictChoiceState(
  firstChoice.choices,
  firstChoice.receivers,
  'hunk-2',
  'both',
  'incoming',
);
assert.deepEqual(secondChoice, {
  choices: { 'hunk-1': 'session', 'hunk-2': 'both' },
  receivers: { 'hunk-1': 'incoming', 'hunk-2': 'incoming' },
});

assert.deepEqual(
  getConflictPaneActions('current', {
    own: 'current',
    both: 'both',
    ignore: 'ignore',
  }),
  [
    { label: 'current', choice: 'current' },
    { label: 'both', choice: 'both' },
    { label: 'ignore', choice: 'session' },
  ],
);
assert.deepEqual(
  getConflictPaneActions('incoming', {
    own: 'incoming',
    both: 'both',
    ignore: 'ignore',
  }),
  [
    { label: 'incoming', choice: 'session' },
    { label: 'both', choice: 'both' },
    { label: 'ignore', choice: 'current' },
  ],
);

console.log('CodeMirrorConflictEditor alignment: PASS');
