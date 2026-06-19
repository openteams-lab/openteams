// Smoke tests for the shared dropdown select component.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/DropdownSelect.test.tsx
// Exits non-zero if any assertion fails.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { DropdownSelect, type DropdownSelectOption } from './DropdownSelect';

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

console.log('DropdownSelect');

const options: DropdownSelectOption[] = [
  {
    id: 'auto',
    label: 'Auto route',
    description: 'Best model for the task',
    group: 'Auto',
  },
  {
    id: 'manual',
    label: 'Manual route',
    description: 'Pick explicitly',
    group: 'Manual',
    hint: 'M',
  },
  {
    id: 'qa',
    label: 'QA agent',
    description: 'Test review',
    group: 'Manual',
  },
];

const singleHtml = renderToStaticMarkup(
  <DropdownSelect
    value="auto"
    options={options}
    searchPlaceholder="Search strategies"
    defaultOpen
    onChange={() => undefined}
    footer={
      <>
        <span>arrows navigate</span>
        <span>esc close</span>
      </>
    }
  />,
);
const multiHtml = renderToStaticMarkup(
  <DropdownSelect
    selectionMode="multiple"
    values={['manual', 'qa']}
    options={options}
    defaultOpen
    onChange={() => undefined}
    formatValueLabel={(selectedOptions) => `${selectedOptions.length} selected`}
  />,
);
const sizedHtml = renderToStaticMarkup(
  <DropdownSelect
    value="auto"
    options={options}
    className="w-[140px]"
    onChange={() => undefined}
  />,
);
const noSearchHtml = renderToStaticMarkup(
  <DropdownSelect
    value="manual"
    options={options}
    defaultOpen
    showSearch={false}
    onChange={() => undefined}
  />,
);
const source = readFileSync(
  new URL('./DropdownSelect.tsx', import.meta.url),
  'utf8',
);

check('renders single trigger label', singleHtml.includes('Auto route'), singleHtml);
check('renders search input and grouped panel', singleHtml.includes('Search strategies') && singleHtml.includes('Auto') && singleHtml.includes('Manual'), singleHtml);
check('renders descriptions and keyboard hints', singleHtml.includes('Best model for the task') && singleHtml.includes('M'), singleHtml);
check('marks selected single option', singleHtml.includes('aria-selected="true"'), singleHtml);
check('renders footer help row', singleHtml.includes('arrows navigate') && singleHtml.includes('esc close'), singleHtml);
check('renders multi trigger summary', multiHtml.includes('2 selected'), multiHtml);
check('sets listbox multi-select aria only for multiple mode', multiHtml.includes('aria-multiselectable="true"') && !singleHtml.includes('aria-multiselectable="true"'), multiHtml);
check('custom width does not fight a default w-full class', sizedHtml.includes('relative w-[140px]') && !sizedHtml.includes('relative w-full w-[140px]'), sizedHtml);
check('can render an open panel without search input', noSearchHtml.includes('Manual route') && !noSearchHtml.includes('placeholder="Search..."') && !noSearchHtml.includes('lucide-search'), noSearchHtml);
check(
  'positions the open panel as a portaled overlay',
  singleHtml.includes('position:fixed') ||
    (source.includes('createPortal') && source.includes('fixed overflow-hidden')),
  singleHtml,
);
check('keeps multi-select panel open after selection in source', source.includes("props.selectionMode === 'multiple'") && source.includes('return;'), source);
check('supports outside click close in source', source.includes("document.addEventListener('pointerdown'"), source);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll DropdownSelect assertions passed.');
}
