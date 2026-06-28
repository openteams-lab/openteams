// Smoke tests for the structured agent reply parser.
//
// This project has no test runner installed (no jest/vitest). Run with:
//     pnpm exec tsx src/lib/parseStructuredReply.test.ts
// Exits non-zero if any assertion fails.

import {
  extractArtifactPaths,
  normalizeArtifactPath,
  parseStructuredAgentReply,
} from './parseStructuredReply';

let failures = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

// ---- plain text stays plain -------------------------------------------------
ok(
  'plain markdown stays plain',
  parseStructuredAgentReply('Hello world').kind === 'plain',
);
ok(
  'markdown list stays plain',
  parseStructuredAgentReply('- one\n- two').kind === 'plain',
);
ok('empty string stays plain', parseStructuredAgentReply('').kind === 'plain');
ok(
  'text with link stays plain',
  parseStructuredAgentReply('see [docs](https://x)').kind === 'plain',
);

// ---- invalid JSON arrays stay plain ----------------------------------------
ok(
  'truncated json stays plain',
  parseStructuredAgentReply('[ {"type":"send"').kind === 'plain',
);
ok(
  'json object (not array) stays plain',
  parseStructuredAgentReply('{"type":"send","content":"hi"}').kind === 'plain',
);
ok('empty array stays plain', parseStructuredAgentReply('[]').kind === 'plain');
ok(
  'array with unknown type stays plain',
  parseStructuredAgentReply('[{"type":"bogus","content":"x"}]').kind === 'plain',
);
ok(
  'array with non-string content stays plain',
  parseStructuredAgentReply('[{"type":"send","content":123}]').kind === 'plain',
);
ok(
  'array mixing valid and invalid stays plain',
  parseStructuredAgentReply(
    '[{"type":"send","content":"hi"},{"type":"x","content":"y"}]',
  ).kind === 'plain',
);
ok(
  'array with only records uses record fallback',
  (() => {
    const parsed = parseStructuredAgentReply(
      '[{"type":"record","content":"x"}]',
    );
    return parsed.kind === 'structured' && parsed.replyText === 'x';
  })(),
);

// ---- valid structured replies ----------------------------------------------
const sendOnly = parseStructuredAgentReply(
  '[{"type":"send","to":"you","content":"Done."}]',
);
ok('send-only is structured', sendOnly.kind === 'structured');
ok(
  'send-only replyText',
  sendOnly.kind === 'structured' && sendOnly.replyText === 'Done.',
);
ok(
  'send-only has no artifacts',
  sendOnly.kind === 'structured' && sendOnly.artifacts.length === 0,
);

const multi = parseStructuredAgentReply(
  '[{"type":"send","to":"you","content":"A"},{"type":"send","to":"you","content":"B"}]',
);
ok(
  'multiple sends joined by blank line',
  multi.kind === 'structured' && multi.replyText === 'A\n\nB',
);

const conclusionFallback = parseStructuredAgentReply(
  '[{"type":"artifact","content":"frontend/src/a.tsx"},{"type":"conclusion","content":"all done"}]',
);
ok('no-send uses conclusion', conclusionFallback.kind === 'structured');
ok(
  'conclusion becomes replyText',
  conclusionFallback.kind === 'structured' &&
    conclusionFallback.replyText === 'all done',
);
ok(
  'artifacts extracted and trimmed',
  conclusionFallback.kind === 'structured' &&
    conclusionFallback.artifacts.length === 1 &&
    conclusionFallback.artifacts[0].path === 'frontend/src/a.tsx',
);

const recordFallback = parseStructuredAgentReply(
  '[{"type":"artifact","content":"frontend/src/a.tsx"},{"type":"record","content":"remember this"}]',
);
ok(
  'record becomes replyText when no send or conclusion',
  recordFallback.kind === 'structured' &&
    recordFallback.replyText === 'remember this',
);

const whitespacePath = parseStructuredAgentReply(
  '[{"type":"artifact","content":"  ./src/b.ts  "}]',
);
ok(
  'artifact path trimmed',
  whitespacePath.kind === 'structured' &&
    whitespacePath.artifacts[0].path === 'src/b.ts',
);
ok(
  'artifact raw preserved',
  whitespacePath.kind === 'structured' &&
    whitespacePath.artifacts[0].raw === '  ./src/b.ts  ',
);

const onlyArtifacts = parseStructuredAgentReply(
  '[{"type":"artifact","content":"a.ts"},{"type":"artifact","content":"b.ts"}]',
);
ok(
  'artifacts-only has empty body',
  onlyArtifacts.kind === 'structured' &&
    onlyArtifacts.replyText === '' &&
    onlyArtifacts.artifacts.length === 2,
);

const withRecord = parseStructuredAgentReply(
  '[{"type":"record","content":"secret"},{"type":"send","content":"hi"},{"type":"artifact","content":"f.ts"}]',
);
ok(
  'record ignored, send+artifact kept',
  withRecord.kind === 'structured' &&
    withRecord.replyText === 'hi' &&
    withRecord.artifacts.length === 1,
);

const sentenceArtifact = parseStructuredAgentReply(
  '[{"type":"artifact","content":"Saved `docs/a.md` and `src/b.ts`."},{"type":"conclusion","content":"done"}]',
);
ok(
  'artifact sentences keep only paths',
  sentenceArtifact.kind === 'structured' &&
    sentenceArtifact.artifacts.length === 2 &&
    sentenceArtifact.artifacts[0].path === 'docs/a.md' &&
    sentenceArtifact.artifacts[1].path === 'src/b.ts',
);

const listArtifact = parseStructuredAgentReply(
  '[{"type":"artifact","content":["docs/a.md","src/b.ts"]},{"type":"conclusion","content":"done"}]',
);
ok(
  'artifact list content is supported',
  listArtifact.kind === 'structured' &&
    listArtifact.artifacts.length === 2 &&
    listArtifact.artifacts[0].path === 'docs/a.md' &&
    listArtifact.artifacts[1].path === 'src/b.ts',
);

const invalidArtifact = parseStructuredAgentReply(
  '[{"type":"send","content":"done"},{"type":"artifact","content":"not a file path"}]',
);
ok(
  'invalid artifact content is ignored',
  invalidArtifact.kind === 'structured' &&
    invalidArtifact.artifacts.length === 0,
);

// leading/trailing whitespace around the whole array is tolerated
const padded = parseStructuredAgentReply(
  '   \n[{"type":"send","content":"hi"}]\n   ',
);
ok('padded array parses', padded.kind === 'structured');

// ---- normalizeArtifactPath --------------------------------------------------
ok(
  'normalize strips leading ./',
  normalizeArtifactPath('./src/A.tsx') === 'src/a.tsx',
);
ok(
  'normalize strips leading /',
  normalizeArtifactPath('/src/A.tsx') === 'src/a.tsx',
);
ok('normalize lowercases', normalizeArtifactPath('SRC/F.tsx') === 'src/f.tsx');
ok('normalize trims', normalizeArtifactPath('  x.ts  ') === 'x.ts');

// ---- extractArtifactPaths ---------------------------------------------------
const arraysEqual = <T>(a: T[], b: T[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
ok(
  'extract: bare single path',
  arraysEqual(extractArtifactPaths('frontend/src/a.tsx'), [
    'frontend/src/a.tsx',
  ]),
);
ok(
  'extract: backtick paths in a sentence',
  arraysEqual(
    extractArtifactPaths('Saved `binaries/x.txt`, `src/y.rs`, and `z.json`.'),
    ['binaries/x.txt', 'src/y.rs', 'z.json'],
  ),
);
ok(
  'extract: json path list',
  arraysEqual(extractArtifactPaths('["docs/a.md","src/b.ts"]'), [
    'docs/a.md',
    'src/b.ts',
  ]),
);
ok(
  'extract: strips leading ./ from backtick tokens',
  arraysEqual(extractArtifactPaths('touched `./src/b.ts`'), ['src/b.ts']),
);
ok(
  'extract: dedupes by normalized path',
  arraysEqual(
    extractArtifactPaths('`src/A.ts` and `./src/a.ts`'),
    ['src/A.ts'],
  ),
);
ok(
  'extract: ignores non-path backtick tokens',
  arraysEqual(extractArtifactPaths('set `latency_p95` metric'), []),
);
ok(
  'extract: comma-split fallback yields path-like tokens',
  arraysEqual(
    extractArtifactPaths('src/a.ts, src/b.rs'),
    ['src/a.ts', 'src/b.rs'],
  ),
);
ok(
  'extract: plain sentence yields nothing',
  arraysEqual(extractArtifactPaths('The metrics are X and Y.'), []),
);
ok(
  'extract: top-level file with extension',
  arraysEqual(extractArtifactPaths('README.md'), ['README.md']),
);
ok('extract: empty content', extractArtifactPaths('').length === 0);


// ---- Result ----------------------------------------------------------------
if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll parseStructuredReply assertions passed.');
}
