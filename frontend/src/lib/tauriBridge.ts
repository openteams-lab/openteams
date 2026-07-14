export type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export type TauriEvent = {
  event: string;
  id: number;
  windowLabel?: string;
  payload: unknown;
};

export type TauriEventListener = (event: TauriEvent) => void;
export type TauriUnlisten = () => void | Promise<void>;
export type TauriListen = (
  event: string,
  handler: TauriEventListener,
) => Promise<TauriUnlisten>;
export type TauriShellOpen = (path: string, withApp?: string) => Promise<void>;

type TauriGlobal = {
  invoke?: TauriInvoke;
  tauri?: {
    invoke?: TauriInvoke;
  };
  event?: {
    listen?: TauriListen;
  };
  shell?: {
    open?: TauriShellOpen;
  };
};

export const getTauriInvoke = (): TauriInvoke | null => {
  if (typeof window === 'undefined') return null;

  const tauriGlobal = (window as Window & { __TAURI__?: TauriGlobal })
    .__TAURI__;
  return tauriGlobal?.tauri?.invoke ?? tauriGlobal?.invoke ?? null;
};

export const getTauriEventListen = (): TauriListen | null => {
  if (typeof window === 'undefined') return null;

  const tauriGlobal = (window as Window & { __TAURI__?: TauriGlobal })
    .__TAURI__;
  return tauriGlobal?.event?.listen ?? null;
};

export const getTauriShellOpen = (): TauriShellOpen | null => {
  if (typeof window === 'undefined') return null;

  const tauriGlobal = (window as Window & { __TAURI__?: TauriGlobal })
    .__TAURI__;
  return tauriGlobal?.shell?.open ?? null;
};
