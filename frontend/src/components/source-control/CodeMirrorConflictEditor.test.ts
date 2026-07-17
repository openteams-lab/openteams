import assert from 'node:assert/strict';

import {
  buildConflictPaneModel,
  getConflictSpacerLineCounts,
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
  },
  { from: 7, to: 14 },
);

console.log('CodeMirrorConflictEditor alignment: PASS');
