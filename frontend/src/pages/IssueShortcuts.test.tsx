import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./IssuePage.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./IssueDetailPage.tsx', import.meta.url), 'utf8');
for (const commandId of [
  'issue.selection.next',
  'issue.selection.previous',
  'issue.selection.open',
]) {
  assert.ok(page.includes(`useCommandHandler('${commandId}'`), commandId);
}
for (const commandId of [
  'issue.detail.back',
  'issue.status.open',
  'issue.priority.open',
  'issue.labels.open',
  'issue.session.create',
]) {
  assert.ok(detail.includes(`useCommandHandler('${commandId}'`), commandId);
}
assert.ok(page.includes("useShortcutScope('issue-list'"));
assert.ok(page.includes('active: activeIssue === null'));
assert.ok(page.includes("useShortcutScope('issue-detail'"));
assert.ok(page.includes('active: activeIssue !== null'));
assert.ok(page.includes("useCommandPresentation('issue.create')"));
assert.ok(page.includes('{createIssuePresentation.label}'));
assert.ok(page.includes('data-issue-row-id={issue.id}'));
assert.ok(page.includes('tabIndex={selected ? 0 : -1}'));
assert.ok(page.includes("scrollIntoView({ block:"));
assert.ok(page.includes('focusSelectedOrFirstIssueRow()'));
assert.ok(detail.includes('data-shortcut-focus="issue-detail-heading"'));
assert.ok(detail.includes('headingRef.current?.focus()'));
assert.ok(detail.includes('handleStatusMenuSelect'));
assert.ok(detail.includes("setOpenPropertyMenu('status')"));
assert.ok(detail.includes("setOpenPropertyMenu('priority')"));
assert.ok(detail.includes('shortcut="K"'));
assert.ok(detail.includes("setOpenPropertyMenu('labels')"));
assert.ok(detail.includes('handleOpenCreateSessionDialog'));
assert.equal(
  /document\.addEventListener\('keydown',[\s\S]{0,120}openPropertyMenu/.test(detail),
  false,
);
console.log('Issue shortcuts: PASS');
