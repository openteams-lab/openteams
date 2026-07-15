import type {
  CommandHandlerRegistration,
  EffectiveBinding,
  ShortcutContextId,
  ShortcutScope,
  ShortcutScopeRegistration,
} from './types';

type ContextRule = {
  pageDomain: 'any' | 'session' | 'issues' | 'agents';
  activation: 'always' | 'mounted' | 'focused' | 'state';
  exclusiveGroup?: string;
  exclusiveValue?: string;
};

export const contextCatalog: Record<ShortcutContextId, ContextRule> = {
  global: { pageDomain: 'any', activation: 'always' },
  'session-workspace': { pageDomain: 'session', activation: 'mounted' },
  'chat-composer': { pageDomain: 'session', activation: 'focused' },
  'source-control-list': { pageDomain: 'session', activation: 'focused' },
  'source-control-commit': { pageDomain: 'session', activation: 'focused' },
  worktree: { pageDomain: 'session', activation: 'mounted' },
  'issue-list': {
    pageDomain: 'issues',
    activation: 'focused',
    exclusiveGroup: 'issue-view',
    exclusiveValue: 'list',
  },
  'issue-detail': {
    pageDomain: 'issues',
    activation: 'state',
    exclusiveGroup: 'issue-view',
    exclusiveValue: 'detail',
  },
  'agent-runtime': { pageDomain: 'agents', activation: 'mounted' },
  'workflow-session': { pageDomain: 'session', activation: 'mounted' },
  'workflow-graph': { pageDomain: 'session', activation: 'focused' },
  'workflow-node-detail': { pageDomain: 'session', activation: 'state' },
  'workflow-preview': {
    pageDomain: 'session',
    activation: 'focused',
    exclusiveGroup: 'workflow-execution',
    exclusiveValue: 'preview',
  },
  'workflow-running': {
    pageDomain: 'session',
    activation: 'state',
    exclusiveGroup: 'workflow-execution',
    exclusiveValue: 'running',
  },
  'workflow-review': { pageDomain: 'session', activation: 'focused' },
};

export function contextsMayOverlap(
  leftId: ShortcutContextId,
  rightId: ShortcutContextId,
) {
  const left = contextCatalog[leftId];
  const right = contextCatalog[rightId];
  if (leftId === 'global' || rightId === 'global') return true;
  if (left.pageDomain !== right.pageDomain) return false;
  if (
    left.exclusiveGroup &&
    left.exclusiveGroup === right.exclusiveGroup &&
    left.exclusiveValue !== right.exclusiveValue
  ) {
    return false;
  }
  if (
    left.activation === 'focused' &&
    right.activation === 'focused' &&
    leftId !== rightId
  ) {
    return false;
  }
  return true;
}

export const rankShortcutScope = (scope: ShortcutScope) =>
  ({
    global: 100,
    page: 200,
    'focused-component': 300,
    'modal-menu': 400,
    recorder: 500,
  })[scope];

type FocusedScopeMatch = {
  contextId: ShortcutContextId;
  root: HTMLElement;
};

const rootContainsTarget = (
  root: HTMLElement,
  target: EventTarget | null,
) => {
  const NodeConstructor = root.ownerDocument.defaultView?.Node;
  return Boolean(
    target && NodeConstructor && target instanceof NodeConstructor && root.contains(target),
  );
};

export function resolveActiveShortcutContexts(
  registrations: readonly ShortcutScopeRegistration[],
  target: EventTarget | null,
): ReadonlySet<ShortcutContextId> {
  const activeContextIds = new Set<ShortcutContextId>(['global']);
  const focusedMatches: FocusedScopeMatch[] = [];

  for (const registration of registrations) {
    if (!registration.active || registration.contextId === 'global') continue;
    const rule = contextCatalog[registration.contextId];
    if (rule.activation !== 'focused') {
      activeContextIds.add(registration.contextId);
      continue;
    }
    const root = registration.rootRef?.current;
    if (root && rootContainsTarget(root, target)) {
      focusedMatches.push({ contextId: registration.contextId, root });
    }
  }

  for (const match of focusedMatches) {
    const shadowedByDeeperRoot = focusedMatches.some(
      (other) =>
        other.root !== match.root &&
        match.root.contains(other.root),
    );
    if (!shadowedByDeeperRoot) activeContextIds.add(match.contextId);
  }

  return activeContextIds;
}

export const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
};

export function hasBlockingModalOrMenu(document: Document) {
  return Boolean(
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], [role="menu"]',
    ),
  );
}

export function isEmbeddedEditorFocused(document: Document) {
  return document.activeElement instanceof HTMLIFrameElement;
}

export function shouldIgnoreKeyboardEvent(
  event: KeyboardEvent,
  binding: EffectiveBinding,
  registration: CommandHandlerRegistration,
): boolean {
  if (event.defaultPrevented || event.isComposing || event.key === 'Process') {
    return true;
  }
  if (isEmbeddedEditorFocused(document)) return true;
  if (isEditableTarget(event.target)) {
    const ownedEditable = Boolean(
      registration.allowInEditable &&
        registration.ownsEventTarget?.(event.target),
    );
    if (ownedEditable) return false;
    const firstStroke = binding.sequence[0] ?? '';
    const hasCommandModifier = firstStroke
      .split('+')
      .some(
        (token) => token === 'ctrl' || token === 'meta' || token === 'alt',
      );
    if (
      binding.sequence.length > 1 ||
      !hasCommandModifier ||
      registration.scope !== 'global'
    ) {
      return true;
    }
  }
  return (
    hasBlockingModalOrMenu(document) &&
    registration.scope !== 'modal-menu' &&
    registration.scope !== 'recorder'
  );
}
