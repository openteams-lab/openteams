type ShortcutSequence = readonly string[];
type ShortcutContextId =
  | 'global'
  | 'session-workspace'
  | 'chat-composer'
  | 'source-control-list'
  | 'source-control-commit'
  | 'worktree'
  | 'issue-list'
  | 'issue-detail'
  | 'agent-runtime'
  | 'workflow-session'
  | 'workflow-graph'
  | 'workflow-node-detail'
  | 'workflow-preview'
  | 'workflow-running'
  | 'workflow-review';
type CommandRisk = 'safe' | 'guarded' | 'confirmation_required';
type ExpectedCommandDefinition = {
  id: string;
  featureGroup: number | null;
  titleKey: string;
  categoryKey: string;
  defaults: Record<
    'macos' | 'windows' | 'linux',
    readonly ShortcutSequence[]
  >;
  contexts: readonly ShortcutContextId[];
  risk: CommandRisk;
  focusResult: string;
  customizable: true;
};

const sequence = (...strokes: string[]): ShortcutSequence => strokes;
const same = (...bindings: ShortcutSequence[]) => ({
  macos: bindings,
  windows: bindings,
  linux: bindings,
});
const split = (
  macos: readonly ShortcutSequence[],
  windowsLinux: readonly ShortcutSequence[],
) => ({ macos, windows: windowsLinux, linux: windowsLinux });
const expectedCommand = (
  id: string,
  featureGroup: number | null,
  category: string,
  defaults: ExpectedCommandDefinition['defaults'],
  contexts: readonly ShortcutContextId[],
  risk: CommandRisk,
  focusResult: string,
): ExpectedCommandDefinition => ({
  id,
  featureGroup,
  titleKey: `shortcuts.command.${id}`,
  categoryKey: `shortcuts.category.${category}`,
  defaults,
  contexts,
  risk,
  focusResult,
  customizable: true,
});

export const expectedCommandRegistry = [
  expectedCommand('commandPalette.open', null, 'general', split([sequence('meta+shift+p')], [sequence('ctrl+shift+p')]), ['global'], 'safe', 'command-search-input'),
  expectedCommand('shortcuts.help.open', null, 'general', same(sequence('shift+/')), ['global'], 'safe', 'shortcut-help-first-control'),
  expectedCommand('sidebar.right.toggle', null, 'navigation', split([sequence('meta+alt+b')], [sequence('ctrl+alt+b')]), ['session-workspace'], 'safe', 'preserve-right-sidebar-selection'),
  expectedCommand('shortcuts.settings.open', null, 'settings', same(), ['global'], 'safe', 'shortcut-settings-search'),
  expectedCommand('agent-runtime.sidebar.toggle', null, 'agents', split([sequence('meta+b')], [sequence('ctrl+b')]), ['agent-runtime'], 'safe', 'preserve-agent-selection'),
  expectedCommand('project.create', 1, 'create', same(sequence('c', 'p')), ['global'], 'safe', 'project-name-input'),
  expectedCommand('search.open', 2, 'general', split([sequence('meta+k')], [sequence('ctrl+k')]), ['global'], 'safe', 'global-search-input'),
  expectedCommand('session.create', 3, 'create', split([sequence('meta+n')], [sequence('ctrl+n')]), ['global'], 'safe', 'session-prompt-textarea'),
  expectedCommand('build-stats.open', 4, 'navigation', same(sequence('g', 'b')), ['global'], 'safe', 'build-stats-heading'),
  expectedCommand('session-tab.next', 5, 'navigation', same(sequence('ctrl+tab')), ['global'], 'safe', 'next-tab-content'),
  expectedCommand('session-tab.previous', 5, 'navigation', same(sequence('ctrl+shift+tab')), ['global'], 'safe', 'previous-tab-content'),
  expectedCommand('session.next', 5, 'navigation', same(sequence('alt+arrowdown')), ['session-workspace'], 'safe', 'tab-main-content'),
  expectedCommand('session.previous', 5, 'navigation', same(sequence('alt+arrowup')), ['session-workspace'], 'safe', 'tab-main-content'),
  expectedCommand('source-control.open', 6, 'sourceControl', same(sequence('ctrl+shift+g')), ['session-workspace'], 'safe', 'selected-or-first-source-file'),
  expectedCommand('source-control.selection.next', 6, 'sourceControl', same(sequence('j'), sequence('arrowdown')), ['source-control-list'], 'safe', 'next-source-file'),
  expectedCommand('source-control.selection.previous', 6, 'sourceControl', same(sequence('k'), sequence('arrowup')), ['source-control-list'], 'safe', 'previous-source-file'),
  expectedCommand('source-control.selection.toggle-stage', 6, 'sourceControl', same(sequence('space')), ['source-control-list'], 'guarded', 'same-source-file'),
  expectedCommand('source-control.selection.open-diff', 6, 'sourceControl', same(sequence('enter')), ['source-control-list'], 'safe', 'source-diff-tab'),
  expectedCommand('source-control.stage-all', 6, 'sourceControl', same(), ['source-control-list'], 'guarded', 'source-control-list'),
  expectedCommand('source-control.commit-message.focus', 7, 'sourceControl', same(sequence('g', 'c')), ['session-workspace'], 'safe', 'commit-message-input'),
  expectedCommand('source-control.commit', 7, 'sourceControl', split([sequence('meta+enter')], [sequence('ctrl+enter')]), ['source-control-commit'], 'guarded', 'commit-message-input'),
  expectedCommand('worktree.merge', 8, 'sourceControl', same(), ['worktree'], 'confirmation_required', 'worktree-merge-confirmation'),
  expectedCommand('worktree.discard', 9, 'sourceControl', same(), ['worktree'], 'confirmation_required', 'worktree-discard-confirmation'),
  expectedCommand('issue.create', 10, 'issues', same(sequence('c', 'i')), ['global'], 'safe', 'issue-title-input'),
  expectedCommand('issue.open-list', 11, 'issues', same(sequence('g', 'i')), ['global'], 'safe', 'selected-or-first-issue-row'),
  expectedCommand('issue.selection.next', 11, 'issues', same(sequence('j'), sequence('arrowdown')), ['issue-list'], 'safe', 'next-issue-row'),
  expectedCommand('issue.selection.previous', 11, 'issues', same(sequence('k'), sequence('arrowup')), ['issue-list'], 'safe', 'previous-issue-row'),
  expectedCommand('issue.selection.open', 11, 'issues', same(sequence('enter')), ['issue-list'], 'safe', 'issue-detail-heading'),
  expectedCommand('issue.detail.back', 11, 'issues', same(sequence('escape')), ['issue-detail'], 'safe', 'origin-issue-row'),
  expectedCommand('issue.status.open', 12, 'issues', same(sequence('s')), ['issue-detail'], 'safe', 'issue-status-search'),
  expectedCommand('issue.priority.open', 12, 'issues', same(sequence('k')), ['issue-detail'], 'safe', 'issue-priority-search'),
  expectedCommand('issue.labels.open', 12, 'issues', same(sequence('l')), ['issue-detail'], 'safe', 'issue-label-search'),
  expectedCommand('issue.session.create', 13, 'issues', same(sequence('c', 's')), ['issue-detail'], 'safe', 'issue-session-first-option'),
  expectedCommand('team.member.add', 14, 'team', same(sequence('c', 'm')), ['global'], 'safe', 'team-add-member-action'),
  expectedCommand('session.plan-mode.toggle', null, 'workflow', same(sequence('shift+tab')), ['chat-composer'], 'safe', 'chat-composer-input'),
  expectedCommand('workflow.open', 15, 'workflow', same(sequence('g', 'w')), ['workflow-session'], 'safe', 'current-or-first-workflow-node'),
  expectedCommand('workflow.node.up', 16, 'workflow', same(sequence('arrowup')), ['workflow-graph'], 'safe', 'nearest-workflow-node-up'),
  expectedCommand('workflow.node.down', 16, 'workflow', same(sequence('arrowdown')), ['workflow-graph'], 'safe', 'nearest-workflow-node-down'),
  expectedCommand('workflow.node.left', 16, 'workflow', same(sequence('arrowleft')), ['workflow-graph'], 'safe', 'nearest-workflow-node-left'),
  expectedCommand('workflow.node.right', 16, 'workflow', same(sequence('arrowright')), ['workflow-graph'], 'safe', 'nearest-workflow-node-right'),
  expectedCommand('workflow.node.open', 16, 'workflow', same(sequence('enter')), ['workflow-graph'], 'safe', 'workflow-node-inspector'),
  expectedCommand('workflow.start', 16, 'workflow', split([sequence('meta+enter')], [sequence('ctrl+enter')]), ['workflow-preview'], 'guarded', 'workflow-review-settings'),
  expectedCommand('workflow.node.retry', 16, 'workflow', split([sequence('meta+r')], [sequence('ctrl+r')]), ['workflow-node-detail'], 'guarded', 'workflow-node-inspector'),
  expectedCommand('workflow.node.retry-review', 16, 'workflow', split([sequence('meta+t')], [sequence('ctrl+t')]), ['workflow-node-detail'], 'guarded', 'workflow-node-inspector'),
  expectedCommand('workflow.node.stop', 16, 'workflow', split([sequence('meta+x')], [sequence('ctrl+x')]), ['workflow-node-detail'], 'confirmation_required', 'workflow-node-stop-confirmation'),
  expectedCommand('workflow.node.chat.toggle', 16, 'workflow', split([sequence('meta+q')], [sequence('ctrl+q')]), ['workflow-node-detail'], 'safe', 'workflow-node-chat'),
  expectedCommand('workflow.stop', 16, 'workflow', same(), ['workflow-running'], 'confirmation_required', 'workflow-stop-confirmation'),
  expectedCommand('workflow.review.select-approve', 17, 'workflow', same(sequence('a')), ['workflow-review'], 'confirmation_required', 'workflow-review-confirm-button'),
  expectedCommand('workflow.review.select-reject', 17, 'workflow', same(sequence('r')), ['workflow-review'], 'confirmation_required', 'workflow-review-confirm-button'),
  expectedCommand('workflow.review.confirm', 17, 'workflow', same(sequence('enter')), ['workflow-review'], 'confirmation_required', 'workflow-review-result'),
  expectedCommand('settings.open', 18, 'settings', split([sequence('meta+comma')], [sequence('ctrl+comma')]), ['global'], 'safe', 'settings-active-sidebar-item'),
  expectedCommand('session.linked-issue.status.open', null, 'issues', same(sequence('s')), ['session-workspace'], 'safe', 'linked-issue-status-menu'),
] satisfies readonly ExpectedCommandDefinition[];
