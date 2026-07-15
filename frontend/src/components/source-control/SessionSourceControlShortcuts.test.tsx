import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('./SessionSourceControlPanel.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./SourceControlFileRow.tsx', import.meta.url), 'utf8');
for (const commandId of [
  'source-control.selection.next',
  'source-control.selection.previous',
  'source-control.selection.toggle-stage',
  'source-control.selection.open-diff',
]) {
  assert.ok(panel.includes(`useCommandHandler('${commandId}'`), commandId);
}
assert.ok(panel.includes("useShortcutScope('source-control-list'"));
assert.ok(panel.includes('files.some((file) => file.path === selectedPath)'));
assert.ok(panel.includes('files[0]?.path ?? null'));
assert.ok(panel.includes('emptyStateHeadingRef.current?.focus()'));
assert.ok(panel.includes('commitMessageRef.current?.focus()'));
assert.ok(panel.includes('commitFocusRequestKey'));
assert.match(panel, /tabIndex=\{-1\}/);
assert.ok(panel.includes("tr('sourceControl.empty.noChanges'"));
assert.ok(panel.includes('handleStageFiles([selectedFile])'));
assert.ok(panel.includes('handleUnstageFiles([selectedFile])'));
assert.ok(panel.includes('shortcutSelectionFocusPathRef.current = selectedFile.path'));
assert.ok(panel.includes('fileRowRefs.current.get(path)?.focus()'));
assert.ok(panel.includes('[selectedFile?.area, selectedFile?.path]'));
assert.ok(panel.includes('handleOpenDiff(selectedFile'));
assert.ok(row.includes('data-source-control-path={file.path}'));
assert.ok(row.includes('tabIndex={selected ? 0 : -1}'));

for (const commandId of [
  'source-control.commit',
  'source-control.stage-all',
  'worktree.merge',
  'worktree.discard',
]) {
  assert.ok(panel.includes(`useCommandHandler('${commandId}'`), commandId);
}
assert.ok(panel.includes("useShortcutScope('source-control-commit'"));
assert.ok(panel.includes('allowInEditable: true'));
assert.ok(panel.includes('ownsEventTarget: (target) => target === commitMessageRef.current'));
assert.ok(panel.includes('enabled: viewModel.canCommit && commitMessage.trim().length > 0'));
assert.ok(panel.includes("action.id === 'stage-all'"));
assert.ok(panel.includes('handleBatchAction(stageAllAction, changesSection)'));
assert.ok(panel.includes("requestWorktreeAction('merge')"));
assert.ok(panel.includes("requestWorktreeAction('discard')"));
assert.ok(panel.includes('const confirmed = await requestConfirm(confirmCopy[action])'));
assert.ok(panel.includes('if (confirmed) await handleConfirmedWorktreeAction(action)'));
assert.equal(
  panel.includes("useCommandHandler('worktree.merge', {\n  execute: mergeWorktree"),
  false,
);
console.log('Session source-control shortcuts: PASS');
