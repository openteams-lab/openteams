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
  'createSession.issueLink': 'LINK_ISSUE',
  planMode: 'PLAN_MODE',
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
check(
  'renders modal dialog semantics',
  html.includes('role="dialog"') && html.includes('aria-modal="true"'),
  html,
);
check(
  'renders translated title and breadcrumb project',
  html.includes('NEW_SESSION_TITLE') && html.includes('my-saas'),
  html,
);
check(
  'centers the modal overlay',
  html.includes('items-center justify-center'),
  html,
);
check(
  'uses light translucent blurred page overlay',
  html.includes('bg-[#050608]/30') && html.includes('backdrop-blur-sm'),
  html,
);
check(
  'uses compact modal dimensions',
  html.includes('max-w-[620px]') && html.includes('min-h-[320px]'),
  html,
);
check(
  'keeps modal text at 14px scale',
  html.includes('text-[14px]') &&
    !html.includes('text-[16px]') &&
    !html.includes('text-[19px]'),
  html,
);
check(
  'renders member picker by default',
  html.includes('MEMBER_LABEL') && html.includes('aria-haspopup="listbox"'),
  html,
);
check(
  'passes selected member display data to new session creation',
  source.includes('memberAvatar?: string') &&
    source.includes('memberModelName?: string') &&
    source.includes('memberAvatar: selectedMember.avatar') &&
    source.includes('memberModelName: selectedMember.modelName'),
  source,
);
check(
  'read-only workflow main agent has no outer border',
  source.includes(
    'inline-flex min-w-0 max-w-[280px] items-center gap-2 rounded-md bg-[var(--surface-2)]',
  ),
  source,
);
check(
  'plan mode source switches member list to the main agent',
  source.includes('isPlanMode ? (mainAgent ? [mainAgent] : []) : members'),
  source,
);
check(
  'does not require a workflow lead before plan mode is activated',
  noLeadHtml.includes('MEMBER_LABEL') &&
    !noLeadHtml.includes('No members available'),
  noLeadHtml,
);
check(
  'renders prompt composer placeholder',
  html.includes('PROMPT_PLACEHOLDER'),
  html,
);
check(
  'new session composer supports file attachment selection',
  source.includes('accept={CHAT_ATTACHMENT_ACCEPT}') &&
    source.includes('type="file"') &&
    source.includes('multiple') &&
    source.includes('fileInputRef.current?.click()'),
  source,
);
check(
  'new session composer adds pasted clipboard files as attachments',
  source.includes('onPaste={handlePaste}') &&
    source.includes('getClipboardFiles(event.clipboardData)') &&
    source.includes('normalizeClipboardFile') &&
    source.includes('openteams:vscode-clipboard-files'),
  source,
);
check(
  'new session can be created with attachments only',
  source.includes('trimmedPrompt.length > 0 || attachedFiles.length > 0') &&
    source.includes('attachments: attachedFiles'),
  source,
);
check(
  'clears submitted prompt before the next new session composer opens',
  source.includes("attachments: attachedFiles,\n    });\n    setPrompt('');") &&
    source.includes("setPrompt('');\n    setAttachedFiles([]);\n    setAttachmentError('');\n    onClose();"),
  source,
);
check(
  'renders plan mode button instead of mode labels',
  html.includes('PLAN_MODE') &&
    !html.includes('WORKFLOW') &&
    !html.includes('FREE_CHAT'),
  html,
);
check(
  'mode labels omit the word mode',
  !html.includes('Workflow mode') && !html.includes('Free chat mode'),
  html,
);
check('renders issue linker control', html.includes('LINK_ISSUE'), html);
check(
  'issue linker uses plan-mode button text sizing',
  source.includes('px-2 py-1 text-[12px] font-medium') &&
    source.includes('className="h-3 w-3 shrink-0"'),
  source,
);
check(
  'issue menu renders through a fixed portal outside the modal clipping context',
  source.includes('createPortal(') &&
    source.includes('document.body') &&
    source.includes('className="fixed top-auto mt-0"') &&
    source.includes("transform: 'translateY(-100%)'"),
  source,
);
check(
  'issue menu option rows leave room for descenders',
  source.includes('flex min-h-12 w-full') &&
    source.includes('text-[12px] font-bold leading-normal') &&
    source.includes('truncate leading-snug') &&
    source.includes('text-[10px] font-semibold leading-normal'),
  source,
);
check(
  'issue menu options do not show unexplained shortcut numbers',
  !source.includes('option.shortcut') &&
    !source.includes('shortcut: index < 9 ? String(index + 1)'),
  source,
);
check(
  'issue menu supports keyboard option navigation',
  source.includes('activeWorkItemOptionIndex') &&
    source.includes("event.key === 'ArrowDown'") &&
    source.includes("event.key === 'ArrowUp'") &&
    source.includes("event.key === 'Enter'") &&
    source.includes('onKeyDown={handleWorkItemMenuKeyDown}') &&
    source.includes("scrollIntoView({ block: 'nearest' })") &&
    source.includes('onMouseEnter={() =>'),
  source,
);
check(
  'renders send shortcut action only in footer',
  html.includes('SEND_CTRL_ENTER') &&
    !html.includes('SWITCH_MANUAL') &&
    !html.includes('CREATE_ANOTHER'),
  html,
);
check(
  'does not render old no-project/manual/create-another labels',
  !html.includes('NO_PROJECT') &&
    !html.includes('Create another') &&
    !html.includes('Switch to Manual'),
  html,
);
check(
  'supports Ctrl/Cmd+Enter submit',
  source.includes("event.key === 'Enter'") &&
    source.includes('event.metaKey || event.ctrlKey'),
  source,
);
check(
  'supports Escape close',
  source.includes("event.key === 'Escape'"),
  source,
);
check(
  'uses shared DropdownSelect for member picking',
  source.includes('import {') &&
    source.includes('DropdownSelect') &&
    !source.includes('<select'),
  source,
);
check(
  'only uses shared DropdownSelect for free chat member picking',
  source.includes('isPlanMode ?') && source.includes('<DropdownSelect'),
  source,
);
check(
  'free-chat member dropdown is wider and shorter',
  source.includes('className="w-[168px] max-w-full shrink-0') &&
    source.includes('maxPanelHeightClassName="max-h-[144px]"'),
  source,
);
check(
  'plan mode button uses chat composer animation class',
  source.includes('plan-mode-toggle-active') && source.includes('GitBranch'),
  source,
);
check(
  'plan mode control toggles between workflow and free chat',
  source.includes('handleTogglePlanMode') &&
    source.includes("isPlanMode ? 'freeChat' : 'workflow'"),
  source,
);
check(
  'free-chat mode keeps all members selectable in source',
  source.includes('isPlanMode ?') && source.includes(': members'),
  source,
);
check(
  'member selection reacts to updated selectable members',
  source.includes('selectableMembers.find(') &&
    source.includes("setSelectedMemberId(selectableMembers[0]?.id ?? '')"),
  source,
);
check(
  'issue menu reuses shared command select menu',
  source.includes('CommandSelectMenu') &&
    source.includes('CommandSelectSearchRow'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll create-agent session modal assertions passed.');
}
