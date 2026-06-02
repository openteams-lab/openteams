// Smoke tests for the TimeRangeFilter component.
//
// Run with:
//     pnpm exec tsx src/components/TimeRangeFilter.test.tsx
// Exits non-zero if any assertion fails.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimeRangeFilter } from './TimeRangeFilter';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const t = (key: string, fallback: string) => fallback;

console.log('TimeRangeFilter');

// Default render with 7d selected
const html7d = renderToStaticMarkup(
  <TimeRangeFilter value="7d" onChange={() => undefined} t={t} />,
);

// Render with 30d selected
const html30d = renderToStaticMarkup(
  <TimeRangeFilter value="30d" onChange={() => undefined} t={t} />,
);

// Render with 90d selected
const html90d = renderToStaticMarkup(
  <TimeRangeFilter value="90d" onChange={() => undefined} t={t} />,
);

// Test: renders all three options
check('renders 7d label', html7d.includes('1 Week'), html7d);
check('renders 30d label', html7d.includes('1 Month'), html7d);
check('renders 90d label', html7d.includes('3 Months'), html7d);

// Test: role="group" with aria-label
check('has role=group', html7d.includes('role="group"'), html7d);
check('has aria-label', html7d.includes('aria-label="Time range"'), html7d);

// Test: active button has aria-pressed="true"
check(
  '7d button has aria-pressed=true when value is 7d',
  html7d.includes('aria-pressed="true"'),
  html7d,
);

// Test: active styling applied (surface-3 background)
check(
  'active button uses surface-3 background',
  html7d.includes('bg-[var(--surface-3)]'),
  html7d,
);

// Test: inactive buttons use transparent background
check(
  'inactive buttons use transparent background',
  html7d.includes('bg-transparent'),
  html7d,
);

// Test: active button uses --ink text color
check(
  'active button uses ink text color',
  html7d.includes('text-[var(--ink)]'),
  html7d,
);

// Test: inactive buttons use --ink-muted text color
check(
  'inactive buttons use ink-muted text color',
  html7d.includes('text-[var(--ink-muted)]'),
  html7d,
);

// Test: hairline border around the group
check(
  'group has hairline border',
  html7d.includes('border-[var(--hairline)]'),
  html7d,
);

// Test: only one button is active at a time
const countPressed = (html: string) =>
  (html.match(/aria-pressed="true"/g) || []).length;

check('only one button active for 7d', countPressed(html7d) === 1, countPressed(html7d));
check('only one button active for 30d', countPressed(html30d) === 1, countPressed(html30d));
check('only one button active for 90d', countPressed(html90d) === 1, countPressed(html90d));

// Test: uses Inter font
check('uses Inter font family', html7d.includes('Inter'), html7d);

// Test: uses translation function
const customT = (key: string, _fallback: string) => {
  if (key === 'buildStats.timeRange.7d') return 'カスタム1週間';
  return _fallback;
};
const htmlCustom = renderToStaticMarkup(
  <TimeRangeFilter value="7d" onChange={() => undefined} t={customT} />,
);
check('uses t() for labels', htmlCustom.includes('カスタム1週間'), htmlCustom);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll TimeRangeFilter assertions passed.');
}
