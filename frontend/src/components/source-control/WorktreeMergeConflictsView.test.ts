// Behavior tests for the merge-conflict resolver.
//
// Run with:
//     pnpm exec tsx src/components/source-control/WorktreeMergeConflictsView.test.ts

import {
  buildConflictResolutionContent,
  buildResolveConflictRequest,
  canContinueMerge,
  containsConflictMarkers,
  isNonTextConflict,
  parseConflictText,
  type FileResolution,
} from './WorktreeMergeConflictsView';
import type { ConflictFileContent, ConflictFileInfo } from '@/types';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const conflict = (
  status: string,
  detail: Partial<ConflictFileContent> = {},
): [ConflictFileInfo, ConflictFileContent] => [
  { path: 'src/file.bin', status },
  {
    path: 'src/file.bin',
    base: 'base',
    current: 'current',
    session: 'session',
    working_tree: '<<<<<<<',
    is_binary: false,
    is_too_large: false,
    size_bytes: 8,
    ...detail,
  },
];

console.log('WorktreeMergeConflictsView behavior');

for (const [label, status] of [
  ['deleted by current side', 'deleted_by_us'],
  ['deleted by session side', 'deleted_by_them'],
  ['both deleted', 'both_deleted'],
  ['renamed conflict', 'renamed'],
] as const) {
  const [info, detail] = conflict(status);
  check(
    `${label} uses file-level choices`,
    isNonTextConflict(info, detail),
  );
}

{
  const [info, detail] = conflict('both_modified', { is_binary: true });
  check('binary content uses file-level choices', isNonTextConflict(info, detail));
}

{
  const [info, detail] = conflict('both_modified', {
    is_too_large: true,
    size_bytes: 300_000,
  });
  check('too-large content uses file-level choices', isNonTextConflict(info, detail));
}

{
  const [info, detail] = conflict('both_modified');
  check('ordinary text conflict stays in text editor', !isNonTextConflict(info, detail));
}

const requests: Array<[string, FileResolution, unknown]> = [
  [
    'text result writes content',
    { kind: 'text', content: 'merged result' },
    { path: 'src/file.bin', content: 'merged result' },
  ],
  [
    'keep current resolves with ours stage',
    { kind: 'binary', choice: 'current' },
    { path: 'src/file.bin', use_stage: 'current' },
  ],
  [
    'use session resolves with theirs stage',
    { kind: 'binary', choice: 'session' },
    { path: 'src/file.bin', use_stage: 'session' },
  ],
  [
    'delete file resolves with delete_file',
    { kind: 'binary', choice: 'deleted' },
    { path: 'src/file.bin', delete_file: true },
  ],
];

for (const [label, resolution, expected] of requests) {
  check(
    label,
    JSON.stringify(buildResolveConflictRequest('src/file.bin', resolution)) ===
      JSON.stringify(expected),
    buildResolveConflictRequest('src/file.bin', resolution),
  );
}

check(
  'continue is disabled while unresolved files remain even if a draft resolution exists',
  !canContinueMerge([{ path: 'src/file.bin', status: 'both_modified' }], true, false),
);

check(
  'continue is enabled after refreshList reports no conflicts remaining',
  canContinueMerge([], true, false),
);

check(
  'continue stays disabled before the conflict list has loaded',
  !canContinueMerge([], false, false),
);

check(
  'continue stays disabled while the conflict list is refreshing',
  !canContinueMerge([], true, true),
);

const conflictText = [
  'before\n',
  '<<<<<<< HEAD\n',
  'current line\n',
  '=======\n',
  'source line\n',
  '>>>>>>> openteams/session/demo\n',
  'after\n',
].join('');
const parsed = parseConflictText(conflictText);

check(
  'parses conflict markers into a selectable conflict point',
  parsed.hunks.length === 1 &&
    parsed.hunks[0].current === 'current line\n' &&
    parsed.hunks[0].session === 'source line\n' &&
    parsed.hunks[0].startLine === 2,
  parsed,
);

check(
  'accept current for one conflict point preserves surrounding content',
  buildConflictResolutionContent(parsed, { 'hunk-1': 'current' }) ===
    'before\ncurrent line\nafter\n',
  buildConflictResolutionContent(parsed, { 'hunk-1': 'current' }),
);

check(
  'accept both for one conflict point joins current then source',
  buildConflictResolutionContent(parsed, { 'hunk-1': 'both' }) ===
    'before\ncurrent line\nsource line\nafter\n',
  buildConflictResolutionContent(parsed, { 'hunk-1': 'both' }),
);

check(
  'unresolved conflict point keeps conflict markers in the draft result',
  containsConflictMarkers(buildConflictResolutionContent(parsed, {})),
  buildConflictResolutionContent(parsed, {}),
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} WorktreeMergeConflictsView assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll WorktreeMergeConflictsView behavior assertions passed.');
}
