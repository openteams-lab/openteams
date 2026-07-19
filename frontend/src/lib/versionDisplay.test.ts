import assert from 'node:assert/strict';

import { formatVersionForDisplay } from './versionDisplay';

assert.equal(formatVersionForDisplay('0.5.0-20260718151836'), '0.5.0');
assert.equal(formatVersionForDisplay('0.5.0'), '0.5.0');
assert.equal(formatVersionForDisplay('0.5.0-beta.1'), '0.5.0-beta.1');
assert.equal(formatVersionForDisplay('0.5.0-20260718'), '0.5.0-20260718');
assert.equal(
  formatVersionForDisplay('0.5.0-20260718151836-beta'),
  '0.5.0-20260718151836-beta',
);
