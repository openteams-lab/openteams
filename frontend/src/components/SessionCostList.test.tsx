// Smoke tests for the SessionCostList component.
//
// Run with:
//     pnpm exec tsx src/components/SessionCostList.test.tsx
// Exits non-zero if any assertion fails.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionCostList } from './SessionCostList';
import type { SessionCostEntry } from '@/types';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const t = (key: string) => {
  const map: Record<string, string> = {
    'buildStats.empty.noSessions': 'No session token data available',
    'buildStats.sessionTokens': 'Per-Session Token Usage',
  };
  return map[key] ?? key;
};

const session = (
  item: Pick<
    SessionCostEntry,
    'session_id' | 'title' | 'total_tokens' | 'input_tokens' | 'output_tokens'
  >,
): SessionCostEntry => ({
  ...item,
  run_count: 0,
  cache_read_tokens: 0,
  reasoning_output_tokens: 0,
  estimated_cost: 0,
});

const sessions: SessionCostEntry[] = [
  session({ session_id: 's1', title: 'Short title', total_tokens: 500, input_tokens: 200, output_tokens: 300 }),
  session({ session_id: 's2', title: 'Highest usage session', total_tokens: 12345678, input_tokens: 5000000, output_tokens: 7345678 }),
  session({ session_id: 's3', title: 'Medium session', total_tokens: 5000, input_tokens: 2000, output_tokens: 3000 }),
];

console.log('SessionCostList');

// --- Loading state ---
const htmlLoading = renderToStaticMarkup(
  <SessionCostList sessions={[]} loading={true} t={t} />,
);
check('loading: renders skeleton placeholders', htmlLoading.includes('animate-pulse'), htmlLoading);
check('loading: renders surface-2 background', htmlLoading.includes('bg-[var(--surface-2)]'), htmlLoading);

// --- Empty state ---
const htmlEmpty = renderToStaticMarkup(
  <SessionCostList sessions={[]} loading={false} t={t} />,
);
check('empty: shows empty state message', htmlEmpty.includes('No session token data available'), htmlEmpty);

// --- Normal render with sessions ---
const htmlNormal = renderToStaticMarkup(
  <SessionCostList sessions={sessions} loading={false} t={t} />,
);

// Test: renders all sessions
check('renders session s1 title', htmlNormal.includes('Short title'), htmlNormal);
check('renders session s2 title', htmlNormal.includes('Highest usage session'), htmlNormal);
check('renders session s3 title', htmlNormal.includes('Medium session'), htmlNormal);

// Test: formats numbers with thousands separators
check('formats large number with commas', htmlNormal.includes('12,345,678'), htmlNormal);
check('formats medium number with commas', htmlNormal.includes('5,000'), htmlNormal);
check('formats small number', htmlNormal.includes('500'), htmlNormal);

// Test: sorted by total_tokens DESC (highest first in HTML output)
const idx2 = htmlNormal.indexOf('12,345,678');
const idx3 = htmlNormal.indexOf('5,000');
const idx1 = htmlNormal.indexOf('>500<');
check('sorted: highest tokens first', idx2 < idx3, { idx2, idx3 });
check('sorted: medium before lowest', idx3 < idx1, { idx3, idx1 });

// Test: uses Inter font for titles
check('uses Inter font for titles', htmlNormal.includes('Inter'), htmlNormal);

// Test: uses JetBrains Mono for numbers
check('uses JetBrains Mono for numbers', htmlNormal.includes('JetBrains Mono'), htmlNormal);

// Test: uses design tokens for styling
check('uses surface-2 for row backgrounds', htmlNormal.includes('bg-[var(--surface-2)]'), htmlNormal);
check('uses hairline borders between rows', htmlNormal.includes('border-[var(--hairline)]'), htmlNormal);
check('uses ink color for title text', htmlNormal.includes('text-[var(--ink)]'), htmlNormal);
check('uses ink-muted for token count', htmlNormal.includes('text-[var(--ink-muted)]'), htmlNormal);

// Test: has role="list" for accessibility
check('has role=list', htmlNormal.includes('role="list"'), htmlNormal);
check('has role=listitem', htmlNormal.includes('role="listitem"'), htmlNormal);

// Test: scrollable container
check('has overflow-y-auto for scrolling', htmlNormal.includes('overflow-y-auto'), htmlNormal);

// --- Title truncation ---
const longTitle = 'A'.repeat(80);
const sessionsWithLong: SessionCostEntry[] = [
  session({ session_id: 'long', title: longTitle, total_tokens: 100, input_tokens: 50, output_tokens: 50 }),
];
const htmlLong = renderToStaticMarkup(
  <SessionCostList sessions={sessionsWithLong} loading={false} t={t} />,
);
// Should truncate to 60 chars + ellipsis (U+2026)
check('truncates long title to 60 chars + ellipsis', htmlLong.includes('A'.repeat(60) + '\u2026'), htmlLong);
// The full title is preserved in the title attribute for tooltip, but the visible text is truncated
check('visible text is truncated (ellipsis present)', htmlLong.includes('\u2026'), htmlLong);

// --- Zero token count ---
const sessionsWithZero: SessionCostEntry[] = [
  session({ session_id: 'zero', title: 'Zero session', total_tokens: 0, input_tokens: 0, output_tokens: 0 }),
];
const htmlZero = renderToStaticMarkup(
  <SessionCostList sessions={sessionsWithZero} loading={false} t={t} />,
);
check('displays zero token count as "0"', htmlZero.includes('>0<'), htmlZero);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll SessionCostList assertions passed.');
}
