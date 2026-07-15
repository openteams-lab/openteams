import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(
  new URL('./context/WorkspaceContext.tsx', import.meta.url),
  'utf8',
);
assert.equal((app.match(/<ShortcutProvider\b/g) ?? []).length, 1);
assert.ok(app.includes('<WorkspaceProvider>'));
assert.ok(
  app.indexOf('<WorkspaceProvider>') < app.indexOf('<ShortcutProviderBridge>'),
);
assert.ok(app.includes('detectShortcutRuntime({'));
assert.ok(app.includes('osType: environment?.os_type'));
assert.ok(app.includes('userAgentDataPlatform:'));
assert.ok(app.includes('navigatorPlatform: navigator.platform'));
assert.ok(app.includes('userAgent: navigator.userAgent'));
assert.ok(app.includes('hasTauriInvoke: getTauriInvoke() !== null'));
assert.ok(app.includes('translate={t}'));
assert.ok(app.includes('saveConfigPatch={saveConfigPatch}'));
assert.ok(app.includes('config={config}'));
assert.equal(app.includes('if (!config) return <>{children}</>'), false);
assert.ok(workspace.includes('environment: Environment | null'));
assert.ok(workspace.includes('setEnvironment(info.environment)'));
assert.equal(app.includes("from './locales/en/shortcuts.json'"), false);
assert.equal(app.includes("platform: 'macos'"), false);
console.log('App shortcut bridge: PASS');

const requiredGlobalHandlers = [
  'search.open',
  'session.create',
  'build-stats.open',
  'session-tab.next',
  'session-tab.previous',
  'session.next',
  'session.previous',
  'settings.open',
  'shortcuts.settings.open',
  'issue.open-list',
  'issue.create',
  'team.member.add',
] as const;
for (const commandId of requiredGlobalHandlers) {
  assert.ok(
    app.includes(`useCommandHandler('${commandId}'`),
    `App must register ${commandId}`,
  );
}
assert.ok(
  app.includes(
    "disabledReason: selectedProjectId ? undefined : t('shortcuts.reason.selectProject')",
  ),
);
assert.ok(
  app.includes("pendingFocusTargetRef.current = 'build-stats-heading'"),
);
assert.ok(app.includes("pendingFocusTargetRef.current = 'tab-main-content'"));
assert.ok(app.includes('getRelativeSessionId('));
assert.ok(app.includes('prioritizeSessions('));
assert.ok(app.includes('useLayoutEffect(() => {'));
assert.ok(app.includes('data-shortcut-focus="tab-main-content"'));
assert.match(
  app,
  /data-shortcut-focus="tab-main-content"[\s\S]{0,180}outline-none/,
);
assert.ok(app.includes("openSettingsTab('shortcuts')"));
assert.ok(
  app.includes("target.kind === 'list' || target.kind === 'create'"),
);
assert.equal(app.includes('if (!target?.workItemId) return'), false);
console.log('App global shortcut handlers: PASS');
