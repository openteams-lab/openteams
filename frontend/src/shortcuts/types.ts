export type ShortcutPlatform = 'macos' | 'windows' | 'linux';

export type ShortcutTranslate = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

export type ShortcutStroke = string;
export type ShortcutSequence = readonly ShortcutStroke[];

export type ShortcutContextId =
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

export type ShortcutScope =
  | 'global'
  | 'page'
  | 'focused-component'
  | 'modal-menu'
  | 'recorder';

export type CommandRisk = 'safe' | 'guarded' | 'confirmation_required';

export type CommandAvailability =
  | { available: true }
  | { available: false; reason: string };

export type BindingResolution =
  | { kind: 'none' }
  | { kind: 'waiting'; prefix: string; expiresAt: number }
  | { kind: 'execute'; commandId: string };

export type KeyboardEventSnapshot = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  altGraph: boolean;
};

export type ShortcutRuntime = {
  platform: ShortcutPlatform;
  isDesktopShell: boolean;
  source:
    | 'server'
    | 'user-agent-data'
    | 'navigator-platform'
    | 'user-agent'
    | 'fallback';
};

export type CommandDefinition = {
  id: string;
  featureGroup: number | null;
  titleKey: string;
  categoryKey: string;
  defaults: Record<ShortcutPlatform, readonly ShortcutSequence[]>;
  contexts: readonly ShortcutContextId[];
  risk: CommandRisk;
  focusResult: string;
  customizable: boolean;
};

export type CommandHandlerRegistration = {
  commandId: string;
  scope: ShortcutScope;
  contexts?: readonly ShortcutContextId[];
  enabled: boolean;
  disabledReason?: string;
  allowInEditable?: boolean;
  ownsEventTarget?: (target: EventTarget | null) => boolean;
  registrationOrder: number;
  execute: () => void | Promise<void>;
};

export type CommandHandlerInput = Omit<
  CommandHandlerRegistration,
  'commandId' | 'registrationOrder'
>;

export type ShortcutCaptureRegistration = {
  id: symbol;
  active: boolean;
  registrationOrder: number;
  /** 返回 true 表示事件已被录入器消费，Provider 不再进入命令解析。 */
  onKeyDown: (event: KeyboardEvent) => boolean;
};

export type ShortcutCaptureInput = Omit<
  ShortcutCaptureRegistration,
  'id' | 'registrationOrder'
>;

export type ShortcutScopeRegistration = {
  contextId: ShortcutContextId;
  active: boolean;
  rootRef?: { current: HTMLElement | null };
};

export type EffectiveBinding = {
  commandId: string;
  sequence: ShortcutSequence;
  contexts: readonly ShortcutContextId[];
  scopeRank: number;
  registrationOrder: number;
};

export type ResolveBindingInput = {
  event: KeyboardEventSnapshot;
  chordPrefix: string | null;
  bindings: readonly EffectiveBinding[];
  availableCommandIds: ReadonlySet<string>;
  activeContextIds: ReadonlySet<ShortcutContextId>;
  now: number;
};

export type BindingMergeWarning = {
  commandId: string;
  kind: 'invalid' | 'unknown';
};

export type CommandPresentation = {
  commandId: string;
  title: string;
  sequence: ShortcutSequence;
  label: string;
  ariaKeyShortcuts: string;
  tooltipShortcut: string;
  tooltip: string;
  disabledReason?: string;
};
