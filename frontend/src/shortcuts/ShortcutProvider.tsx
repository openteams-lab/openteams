import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Config } from '@/types';
import type {
  KeyboardShortcutOverride,
  KeyboardShortcutsConfig,
} from '../../../shared/types';
import {
  mergeEffectiveBindings,
  resolveBinding,
  snapshotKeyboardEvent,
} from './bindingResolver';
import { commandRegistry } from './commandRegistry';
import { formatShortcutSequences } from './Keycap';
import {
  isEditableTarget,
  rankShortcutScope,
  resolveActiveShortcutContexts,
  shouldIgnoreKeyboardEvent,
} from './contextRules';
import {
  readShortcutConfig,
  saveShortcutConfig,
} from './shortcutConfigAdapter';
import type {
  CommandDefinition,
  CommandHandlerInput,
  CommandHandlerRegistration,
  CommandPresentation,
  BindingResolution,
  EffectiveBinding,
  ShortcutCaptureInput,
  ShortcutCaptureRegistration,
  ShortcutContextId,
  ShortcutRuntime,
  ShortcutScopeRegistration,
  ShortcutTranslate,
} from './types';

type RegisteredCommandHandler = Omit<
  CommandHandlerRegistration,
  'enabled' | 'disabledReason' | 'allowInEditable'
> & {
  getEnabled: () => boolean;
  getDisabledReason: () => string | undefined;
  getAllowInEditable: () => boolean;
};

type ShortcutsInternalValue = {
  registerHandler: (
    input: Omit<RegisteredCommandHandler, 'registrationOrder'>,
  ) => () => void;
  registerScope: (input: ShortcutScopeRegistration) => () => void;
  registerCapture: (input: ShortcutCaptureInput) => () => void;
};

export type ShortcutsContextValue = {
  runtime: ShortcutRuntime;
  definitions: readonly CommandDefinition[];
  effectiveBindings: readonly EffectiveBinding[];
  platformOverrides: Record<string, KeyboardShortcutOverride>;
  chord: { prefix: string; expiresAt: number } | null;
  paletteOpen: boolean;
  helpOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  executeCommand: (
    commandId: string,
    target?: EventTarget | null,
  ) => Promise<boolean>;
  savePlatformOverrides: (
    overrides: Record<string, KeyboardShortcutOverride>,
  ) => Promise<Config>;
  presentationFor: (commandId: string) => CommandPresentation;
};

type ShortcutProviderProps = React.PropsWithChildren<{
  runtime: ShortcutRuntime;
  translate: ShortcutTranslate;
  config: Config | null;
  saveConfigPatch: (patch: Partial<Config>) => Promise<Config>;
  showToast: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}>;

const ShortcutsInternalContext = createContext<ShortcutsInternalValue | null>(
  null,
);
const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

const snapshotHandler = (
  registration: RegisteredCommandHandler,
): CommandHandlerRegistration => ({
  commandId: registration.commandId,
  scope: registration.scope,
  contexts: registration.contexts,
  enabled: registration.getEnabled(),
  disabledReason: registration.getDisabledReason(),
  allowInEditable: registration.getAllowInEditable(),
  ownsEventTarget: registration.ownsEventTarget,
  registrationOrder: registration.registrationOrder,
  execute: registration.execute,
});

const sortHandlers = (
  left: CommandHandlerRegistration,
  right: CommandHandlerRegistration,
) =>
  rankShortcutScope(right.scope) - rankShortcutScope(left.scope) ||
  right.registrationOrder - left.registrationOrder;

const overrideSetsMatch = (
  pending: Readonly<Record<string, KeyboardShortcutOverride>>,
  acknowledged: Readonly<Record<string, readonly string[]>>,
) => {
  const entries = Object.entries(pending);
  return (
    entries.length === Object.keys(acknowledged).length &&
    entries.every(([commandId, override]) => {
      if (!override || typeof override !== 'object' || Array.isArray(override)) {
        return false;
      }
      const pendingSequence = (override as { sequence?: unknown }).sequence;
      if (
        !Array.isArray(pendingSequence) ||
        !pendingSequence.every((stroke) => typeof stroke === 'string')
      ) {
        return false;
      }
      const sequence = acknowledged[commandId];
      return (
        sequence !== undefined &&
        pendingSequence.length === sequence.length &&
        pendingSequence.every((stroke, index) => stroke === sequence[index])
      );
    })
  );
};

const ariaShortcutFor = (sequence: readonly string[]) => {
  if (sequence.length !== 1) return '';
  return sequence[0]
    .split('+')
    .map((token) => {
      if (token === 'ctrl') return 'Control';
      if (token === 'meta') return 'Meta';
      if (token === 'alt') return 'Alt';
      if (token === 'shift') return 'Shift';
      if (token === 'comma') return ',';
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join('+');
};

const useShortcutInternals = () => {
  const value = useContext(ShortcutsInternalContext);
  if (!value) throw new Error('Shortcut hooks must be used inside ShortcutProvider');
  return value;
};

export function ShortcutProvider({
  runtime,
  translate,
  config,
  saveConfigPatch,
  showToast,
  children,
}: ShortcutProviderProps) {
  const handlersRef = useRef(new Map<symbol, RegisteredCommandHandler>());
  const scopesRef = useRef(new Map<symbol, ShortcutScopeRegistration>());
  const capturesRef = useRef(new Map<symbol, ShortcutCaptureRegistration>());
  const nextRegistrationOrderRef = useRef(0);
  const [handlerRegistryVersion, setHandlerRegistryVersion] = useState(0);
  const [chord, setChord] = useState<{
    prefix: string;
    expiresAt: number;
  } | null>(null);
  const chordRef = useRef(chord);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const paletteInvocationTargetRef = useRef<EventTarget | null>(null);

  const shortcutConfig = useMemo(
    () =>
      config
        ? readShortcutConfig(config, runtime.platform, commandRegistry)
        : { overrides: {}, preservedUnknown: {}, invalidCommandIds: [] },
    [config, runtime.platform],
  );
  const acknowledgedPlatformOverrides = useMemo<
    Record<string, KeyboardShortcutOverride>
  >(
    () =>
      Object.fromEntries(
        Object.entries(shortcutConfig.overrides).map(([commandId, sequence]) => [
          commandId,
          { sequence: [...sequence] },
        ]),
      ),
    [shortcutConfig.overrides],
  );
  const [pendingPlatformOverrides, setPendingPlatformOverrides] = useState<
    Record<string, KeyboardShortcutOverride> | null
  >(null);
  useEffect(() => {
    if (
      pendingPlatformOverrides &&
      overrideSetsMatch(pendingPlatformOverrides, shortcutConfig.overrides)
    ) {
      setPendingPlatformOverrides(null);
    }
  }, [pendingPlatformOverrides, shortcutConfig.overrides]);
  const platformOverrides =
    pendingPlatformOverrides ?? acknowledgedPlatformOverrides;
  const mergedBindings = useMemo(
    () =>
      mergeEffectiveBindings(
        commandRegistry,
        runtime.platform,
        platformOverrides,
      ).bindings,
    [platformOverrides, runtime.platform],
  );

  const clearChord = useCallback(() => {
    if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
    chordTimerRef.current = null;
    chordRef.current = null;
    setChord(null);
  }, []);
  const beginChord = useCallback(
    (next: { prefix: string; expiresAt: number }) => {
      clearChord();
      chordRef.current = next;
      setChord(next);
      chordTimerRef.current = setTimeout(
        clearChord,
        Math.max(0, next.expiresAt - Date.now()),
      );
    },
    [clearChord],
  );

  const registerHandler = useCallback(
    (input: Omit<RegisteredCommandHandler, 'registrationOrder'>) => {
      const id = Symbol(input.commandId);
      handlersRef.current.set(id, {
        ...input,
        registrationOrder: ++nextRegistrationOrderRef.current,
      });
      setHandlerRegistryVersion((version) => version + 1);
      return () => {
        handlersRef.current.delete(id);
        setHandlerRegistryVersion((version) => version + 1);
      };
    },
    [],
  );
  const registerScope = useCallback((input: ShortcutScopeRegistration) => {
    const id = Symbol(input.contextId);
    scopesRef.current.set(id, input);
    return () => {
      scopesRef.current.delete(id);
    };
  }, []);
  const registerCapture = useCallback((input: ShortcutCaptureInput) => {
    const id = Symbol('shortcut-capture');
    capturesRef.current.set(id, {
      ...input,
      id,
      registrationOrder: ++nextRegistrationOrderRef.current,
    });
    return () => capturesRef.current.delete(id);
  }, []);
  const internalValue = useMemo<ShortcutsInternalValue>(
    () => ({ registerHandler, registerScope, registerCapture }),
    [registerCapture, registerHandler, registerScope],
  );

  const activeContextsFor = useCallback((target: EventTarget | null) => {
    return resolveActiveShortcutContexts(
      [...scopesRef.current.values()],
      target,
    );
  }, []);

  const setPaletteOpen = useCallback(
    (open: boolean) => {
      if (open && !paletteOpen) {
        paletteInvocationTargetRef.current = document.activeElement;
      }
      if (!open) paletteInvocationTargetRef.current = null;
      setPaletteOpenState(open);
    },
    [paletteOpen],
  );

  const executeCommand = useCallback(
    async (commandId: string, target: EventTarget | null = null) => {
      if (commandId === 'commandPalette.open') {
        setPaletteOpen(true);
        return true;
      }
      if (commandId === 'shortcuts.help.open') {
        setHelpOpen(true);
        return true;
      }
      const invocationTarget = target ?? paletteInvocationTargetRef.current;
      const activeContexts = activeContextsFor(invocationTarget);
      const handlers = [...handlersRef.current.values()]
        .map(snapshotHandler)
        .filter(
          (handler) =>
            handler.commandId === commandId &&
            (handler.contexts ?? ['global']).some((context) =>
              activeContexts.has(context),
            ),
        )
        .sort(sortHandlers);
      const handler = handlers.find((candidate) => candidate.enabled);
      if (!handler) {
        const reason = handlers[0]?.disabledReason;
        if (reason) showToast(reason, 'warning');
        return false;
      }
      await handler.execute();
      return true;
    },
    [activeContextsFor, setPaletteOpen, showToast],
  );

  const presentationFor = useCallback(
    (commandId: string): CommandPresentation => {
      const definition = commandRegistry.find((item) => item.id === commandId);
      if (!definition) throw new Error(`Unknown shortcut command: ${commandId}`);
      const sequences = mergedBindings
        .filter((item) => item.commandId === commandId)
        .map((item) => item.sequence);
      const sequence = sequences[0] ?? [];
      const label = formatShortcutSequences(sequences, runtime.platform, translate);
      const tooltipShortcut = sequence.length > 0
        ? translate('shortcuts.tooltip.shortcut', { shortcut: label })
        : '';
      const handler = [...handlersRef.current.values()]
        .map(snapshotHandler)
        .filter((item) => item.commandId === commandId)
        .sort(sortHandlers)[0];
      return {
        commandId,
        title: translate(definition.titleKey),
        sequence,
        label,
        ariaKeyShortcuts: ariaShortcutFor(sequence),
        tooltipShortcut,
        tooltip: tooltipShortcut
          ? `${translate(definition.titleKey)} (${tooltipShortcut})`
          : translate(definition.titleKey),
        disabledReason: handler?.enabled ? undefined : handler?.disabledReason,
      };
    },
    [handlerRegistryVersion, mergedBindings, runtime.platform, translate],
  );

  const savePlatformOverrides = useCallback(
    async (overrides: Record<string, KeyboardShortcutOverride>) => {
      if (!config) throw new Error('Config is not loaded');
      setPendingPlatformOverrides(overrides);
      const current = readShortcutConfig(config, runtime.platform, commandRegistry);
      const keyboardShortcuts: KeyboardShortcutsConfig = {
        ...config.keyboard_shortcuts,
        platform_overrides: {
          ...config.keyboard_shortcuts.platform_overrides,
          [runtime.platform]: {
            ...current.preservedUnknown,
            ...overrides,
          },
        },
      };
      try {
        return await saveShortcutConfig(
          config,
          keyboardShortcuts,
          saveConfigPatch,
        );
      } catch (error) {
        setPendingPlatformOverrides((pending) =>
          pending === overrides ? null : pending,
        );
        throw error;
      }
    },
    [config, runtime.platform, saveConfigPatch],
  );

  const resolverRef = useRef<
    (
      event: KeyboardEvent,
      currentChord: typeof chord,
    ) => BindingResolution
  >(
    (_event: KeyboardEvent, _currentChord: typeof chord) => ({
      kind: 'none' as const,
    }),
  );
  resolverRef.current = (event, currentChord) => {
    const activeContexts = activeContextsFor(event.target);
    const handlers = [...handlersRef.current.values()].map(snapshotHandler);
    const enabledHandlers = handlers.filter((handler) => handler.enabled);
    const candidates = enabledHandlers.flatMap((handler) =>
      mergedBindings
        .filter((binding) => binding.commandId === handler.commandId)
        .filter((binding) =>
          (handler.contexts ?? binding.contexts).some((context) =>
            activeContexts.has(context),
          ),
        )
        .filter(
          (binding) => !shouldIgnoreKeyboardEvent(event, binding, handler),
        )
        .map((binding) => ({
          ...binding,
          contexts: handler.contexts ?? binding.contexts,
          scopeRank: rankShortcutScope(handler.scope),
          registrationOrder: handler.registrationOrder,
        })),
    );
    for (const commandId of ['commandPalette.open', 'shortcuts.help.open']) {
      const binding = mergedBindings.find((item) => item.commandId === commandId);
      if (binding) {
        const builtin: CommandHandlerRegistration = {
          commandId,
          scope: 'global',
          contexts: ['global'],
          enabled: true,
          registrationOrder: 0,
          execute: () => undefined,
        };
        if (!shouldIgnoreKeyboardEvent(event, binding, builtin)) {
          candidates.push({ ...binding, scopeRank: 100, registrationOrder: 0 });
        }
      }
    }
    return resolveBinding({
      event: snapshotKeyboardEvent(event),
      chordPrefix: currentChord?.prefix ?? null,
      bindings: candidates,
      availableCommandIds: new Set(candidates.map((item) => item.commandId)),
      activeContextIds: activeContexts,
      now: Date.now(),
    });
  };

  const executeCommandRef = useRef(executeCommand);
  executeCommandRef.current = executeCommand;
  useEffect(() => {
    const onCapturedKeyDown = (event: KeyboardEvent) => {
      const capture = [...capturesRef.current.values()]
        .filter((entry) => entry.active)
        .sort(
          (left, right) => right.registrationOrder - left.registrationOrder,
        )[0];
      if (capture?.onKeyDown(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearChord();
        return;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const result = resolverRef.current(event, chordRef.current);
      if (result.kind === 'waiting') {
        event.preventDefault();
        beginChord(result);
        return;
      }
      clearChord();
      if (result.kind === 'execute') {
        event.preventDefault();
        void executeCommandRef.current(result.commandId, event.target);
      }
    };
    const onBlur = () => {
      paletteInvocationTargetRef.current = null;
      clearChord();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (
        isEditableTarget(event.target) ||
        event.target instanceof HTMLIFrameElement
      ) {
        clearChord();
      }
    };
    // Active capture leases (for example the keybinding recorder) must run
    // before page-level React/native handlers can stop propagation. Regular
    // shortcuts intentionally remain on the bubble listener below.
    window.addEventListener('keydown', onCapturedKeyDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onCapturedKeyDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('focusin', onFocusIn, true);
      clearChord();
    };
  }, [beginChord, clearChord]);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      runtime,
      definitions: commandRegistry,
      effectiveBindings: mergedBindings,
      platformOverrides,
      chord,
      paletteOpen,
      helpOpen,
      setPaletteOpen,
      setHelpOpen,
      executeCommand,
      savePlatformOverrides,
      presentationFor,
    }),
    [
      chord,
      executeCommand,
      helpOpen,
      mergedBindings,
      paletteOpen,
      platformOverrides,
      presentationFor,
      runtime,
      savePlatformOverrides,
      setPaletteOpen,
    ],
  );

  return (
    <ShortcutsInternalContext.Provider value={internalValue}>
      <ShortcutsContext.Provider value={value}>
        {children}
      </ShortcutsContext.Provider>
    </ShortcutsInternalContext.Provider>
  );
}

export function useShortcuts(): ShortcutsContextValue {
  const value = useContext(ShortcutsContext);
  if (!value) throw new Error('useShortcuts must be used inside ShortcutProvider');
  return value;
}

export function useCommandHandler(commandId: string, input: CommandHandlerInput) {
  const { registerHandler } = useShortcutInternals();
  const latest = useRef(input);
  latest.current = input;
  useLayoutEffect(() => {
    const definition = commandRegistry.find((item) => item.id === commandId);
    if (!definition) throw new Error(`Unknown shortcut command: ${commandId}`);
    const contexts = latest.current.contexts ?? definition.contexts;
    if (contexts.some((context) => !definition.contexts.includes(context))) {
      throw new Error(`Invalid shortcut context for ${commandId}`);
    }
    return registerHandler({
      commandId,
      scope: latest.current.scope,
      contexts,
      getEnabled: () => latest.current.enabled,
      getDisabledReason: () => latest.current.disabledReason,
      getAllowInEditable: () => latest.current.allowInEditable === true,
      ownsEventTarget: (target) =>
        latest.current.ownsEventTarget?.(target) ?? false,
      execute: () => latest.current.execute(),
    });
  }, [commandId, registerHandler]);
}

export function useShortcutScope(
  contextId: ShortcutContextId,
  input: Omit<ShortcutScopeRegistration, 'contextId'>,
) {
  const { registerScope } = useShortcutInternals();
  const latest = useRef(input);
  latest.current = input;
  useLayoutEffect(
    () => registerScope({ contextId, ...latest.current }),
    [contextId, input.active, registerScope],
  );
}

export function useShortcutCapture(input: ShortcutCaptureInput) {
  const { registerCapture } = useShortcutInternals();
  const latest = useRef(input);
  latest.current = input;
  useLayoutEffect(
    () =>
      registerCapture({
        active: input.active,
        onKeyDown: (event) => latest.current.onKeyDown(event),
      }),
    [input.active, registerCapture],
  );
}

export function useCommandPresentation(commandId: string) {
  return useShortcuts().presentationFor(commandId);
}
