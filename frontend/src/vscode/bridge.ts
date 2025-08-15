// VS Code Webview iframe keyboard bridge
// Forwards key events to the parent window so the VS Code webview can re-dispatch
// them and preserve editor/global shortcuts when focused inside the iframe.

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

type KeyPayload = {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  location: number;
};

function serializeKeyEvent(e: KeyboardEvent): KeyPayload {
  return {
    key: e.key,
    code: e.code,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    repeat: e.repeat,
    isComposing: e.isComposing,
    location: e.location ?? 0,
  };
}

function isMac() {
  return navigator.platform.toUpperCase().includes('MAC');
}

function isCopy(e: KeyboardEvent) {
  return (
    (isMac() ? e.metaKey : e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'c'
  );
}
function isCut(e: KeyboardEvent) {
  return (
    (isMac() ? e.metaKey : e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'x'
  );
}
function isPaste(e: KeyboardEvent) {
  return (
    (isMac() ? e.metaKey : e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'v'
  );
}

function activeEditable():
  | HTMLInputElement
  | HTMLTextAreaElement
  | (HTMLElement & { isContentEditable: boolean })
  | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea')
    return el as HTMLInputElement | HTMLTextAreaElement;
  if (el.isContentEditable)
    return el as HTMLElement & { isContentEditable: boolean };
  return null;
}

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

function getSelectedText(): string {
  const el = activeEditable() as
    | HTMLInputElement
    | HTMLTextAreaElement
    | (HTMLElement & { isContentEditable: boolean })
    | null;
  if (el && (el as HTMLInputElement).selectionStart !== undefined) {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    return start < end ? input.value.slice(start, end) : '';
  }
  const sel = window.getSelection();
  return sel ? sel.toString() : '';
}

function cutFromInput(el: HTMLInputElement | HTMLTextAreaElement) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (end > start) {
    const selected = el.value.slice(start, end);
    void writeClipboardText(selected);
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + after;
    el.setSelectionRange(start, start);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function pasteIntoInput(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = before + text + after;
  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const pasteResolvers: Record<string, (text: string) => void> = {};

export function parentClipboardWrite(text: string) {
  try {
    window.parent.postMessage(
      { type: 'vscode-iframe-clipboard-copy', text },
      '*'
    );
  } catch (_err) {
    void 0;
  }
}

export function parentClipboardRead(): Promise<string> {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    pasteResolvers[requestId] = (text: string) => resolve(text);
    try {
      window.parent.postMessage(
        { type: 'vscode-iframe-clipboard-paste-request', requestId },
        '*'
      );
    } catch {
      resolve('');
    }
  });
}

type IframeMessage = {
  type: string;
  event?: KeyPayload;
  text?: string;
  requestId?: string;
};

window.addEventListener('message', (e: MessageEvent) => {
  const data: unknown = e?.data;
  if (!data || typeof data !== 'object') return;
  const msg = data as IframeMessage;
  if (msg.type === 'vscode-iframe-clipboard-paste-result' && msg.requestId) {
    const fn = pasteResolvers[msg.requestId];
    if (fn) {
      fn(msg.text || '');
      delete pasteResolvers[msg.requestId];
    }
  }
});

export function installVSCodeIframeKeyboardBridge() {
  if (!inIframe()) return;

  const forward = (type: string, e: KeyboardEvent) => {
    try {
      window.parent.postMessage({ type, event: serializeKeyEvent(e) }, '*');
    } catch (_err) {
      void 0;
    }
  };

  const onKeyDown = async (e: KeyboardEvent) => {
    // Handle clipboard combos locally so OS shortcuts work inside the iframe
    if (isCopy(e)) {
      const text = getSelectedText();
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        const ok = await writeClipboardText(text);
        if (!ok) parentClipboardWrite(text);
        return;
      }
    } else if (isCut(e)) {
      const el = activeEditable() as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        cutFromInput(el);
        return;
      }
    } else if (isPaste(e)) {
      const el = activeEditable() as
        | HTMLInputElement
        | HTMLTextAreaElement
        | (HTMLElement & { isContentEditable: boolean })
        | null;
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        let text = await readClipboardText();
        if (!text) text = await parentClipboardRead();
        if ((el as HTMLInputElement).selectionStart !== undefined)
          pasteIntoInput(el as HTMLInputElement | HTMLTextAreaElement, text);
        else document.execCommand('insertText', false, text);
        return;
      }
    }
    // Forward everything else so VS Code can handle global shortcuts
    forward('vscode-iframe-keydown', e);
  };

  const onKeyUp = (e: KeyboardEvent) => forward('vscode-iframe-keyup', e);
  const onKeyPress = (e: KeyboardEvent) => forward('vscode-iframe-keypress', e);

  // Capture phase to run before app handlers
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('keypress', onKeyPress, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('keypress', onKeyPress, true);
}

export async function writeClipboardViaBridge(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    parentClipboardWrite(text);
    return false;
  }
}

export async function readClipboardViaBridge(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return await parentClipboardRead();
  }
}

// Auto-install on import to make it robust
installVSCodeIframeKeyboardBridge();
