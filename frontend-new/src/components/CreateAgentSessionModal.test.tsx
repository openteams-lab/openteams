// Smoke tests for the create-agent session modal.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/CreateAgentSessionModal.test.tsx
// Exits non-zero if any assertion fails.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CreateAgentSessionModal } from './CreateAgentSessionModal';

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

console.log('CreateAgentSessionModal');

const translations: Record<string, string> = {
  'createSession.title': 'NEW_SESSION_TITLE',
  'createSession.memberLabel': 'MEMBER_LABEL',
  'createSession.promptPlaceholder': 'PROMPT_PLACEHOLDER',
  'createSession.workflowMode': 'WORKFLOW',
  'createSession.freeChatMode': 'FREE_CHAT',
  'createSession.sendButton': 'SEND_CTRL_ENTER',
  'createSession.close': 'CLOSE_MODAL',
};
const t = (key: string) => translations[key] ?? key;
const members = [
  {
    id: 'mem-1',
    avatar: 'LD',
    status: 'on' as const,
    name: '@lead',
    roleDetail: 'Claude - idle',
    modelName: 'Claude',
  },
  {
    id: 'mem-2',
    avatar: 'BE',
    status: 'on' as const,
    name: '@backend',
    roleDetail: 'Codex - idle',
    modelName: 'Codex',
  },
];

const html = renderToStaticMarkup(
  <CreateAgentSessionModal
    open
    projectName="my-saas"
    members={members}
    t={t}
    onClose={() => undefined}
    onCreate={() => undefined}
  />,
);
const closedHtml = renderToStaticMarkup(
  <CreateAgentSessionModal
    open={false}
    t={t}
    onClose={() => undefined}
    onCreate={() => undefined}
  />,
);
const noLeadHtml = renderToStaticMarkup(
  <CreateAgentSessionModal
    open
    projectName="my-saas"
    members={members}
    leadMember={null}
    t={t}
    onClose={() => undefined}
    onCreate={() => undefined}
  />,
);
const source = readFileSync(
  new URL('./CreateAgentSessionModal.tsx', import.meta.url),
  'utf8',
);

check('does not render when closed', closedHtml === '', closedHtml);
check('renders modal dialog semantics', html.includes('role="dialog"') && html.includes('aria-modal="true"'), html);
check('renders translated title and breadcrumb project', html.includes('NEW_SESSION_TITLE') && html.includes('my-saas'), html);
check('centers the modal overlay', html.includes('items-center justify-center'), html);
check('uses light translucent blurred page overlay', html.includes('bg-[#050608]/30') && html.includes('backdrop-blur-sm'), html);
check('uses compact modal dimensions', html.includes('max-w-[620px]') && html.includes('min-h-[320px]'), html);
check('keeps modal text at 14px scale', html.includes('text-[14px]') && !html.includes('text-[16px]') && !html.includes('text-[19px]'), html);
check('renders read-only main agent in workflow mode', html.includes('MEMBER_LABEL') && html.includes('@lead') && html.includes('Claude'), html);
check('read-only workflow main agent has no outer border', source.includes('inline-flex min-w-0 max-w-[280px] items-center gap-2 rounded-md bg-[var(--surface-2)]'), source);
check('does not render member dropdown in workflow mode', !html.includes('aria-haspopup="listbox"'), html);
check('workflow mode only shows the main agent by default', html.includes('@lead') && !html.includes('@backend'), html);
check('does not fall back when App explicitly has no workflow agent', noLeadHtml.includes('No members available') && !noLeadHtml.includes('@lead'), noLeadHtml);
check('renders prompt composer placeholder', html.includes('PROMPT_PLACEHOLDER'), html);
check('renders only the current mode label', html.includes('WORKFLOW') && !html.includes('FREE_CHAT'), html);
check('mode labels omit the word mode', !html.includes('Workflow mode') && !html.includes('Free chat mode'), html);
check('renders send shortcut action only in footer', html.includes('SEND_CTRL_ENTER') && !html.includes('SWITCH_MANUAL') && !html.includes('CREATE_ANOTHER'), html);
check('does not render old no-project/manual/create-another labels', !html.includes('NO_PROJECT') && !html.includes('Create another') && !html.includes('Switch to Manual'), html);
check('supports Ctrl/Cmd+Enter submit', source.includes("event.key === 'Enter'") && source.includes('event.metaKey || event.ctrlKey'), source);
check('supports Escape close', source.includes("event.key === 'Escape'"), source);
check('uses shared DropdownSelect for member picking', source.includes('import {') && source.includes('DropdownSelect') && !source.includes('<select'), source);
check('only uses shared DropdownSelect for free chat member picking', source.includes("taskMode === 'workflow' ?") && source.includes('<DropdownSelect'), source);
check(
  'free-chat member dropdown is wider and shorter',
  source.includes('className="w-[168px] max-w-full shrink-0') &&
    source.includes('maxPanelHeightClassName="max-h-[144px]"'),
  source,
);
check('mode switch uses smaller text and a switch mark', source.includes('text-[13px]') && source.includes('ArrowLeftRight'), source);
check('mode control toggles between workflow and free chat', source.includes('handleToggleTaskMode') && source.includes("'freeChat' : 'workflow'"), source);
check('free-chat mode keeps all members selectable in source', source.includes("taskMode === 'workflow'") && source.includes(': members'), source);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll create-agent session modal assertions passed.');
}
