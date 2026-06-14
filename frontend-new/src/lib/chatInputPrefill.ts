export type ChatInputPrefillMode = "free" | "workflow";

export type ChatInputPrefillDetail = {
  sessionId: string;
  text: string;
  mode?: ChatInputPrefillMode;
};

export const CHAT_INPUT_PREFILL_EVENT = "openteams:chat-input-prefill";

const CHAT_INPUT_PREFILL_STORAGE_KEY = "openteams:chat-input-prefill";

function isChatInputPrefillDetail(
  value: unknown,
): value is ChatInputPrefillDetail {
  if (!value || typeof value !== "object") return false;

  const detail = value as Partial<ChatInputPrefillDetail>;
  const mode = detail.mode;
  return (
    typeof detail.sessionId === "string" &&
    detail.sessionId.length > 0 &&
    typeof detail.text === "string" &&
    (mode === undefined || mode === "free" || mode === "workflow")
  );
}

export function notifyChatInputPrefill(detail: ChatInputPrefillDetail): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      CHAT_INPUT_PREFILL_STORAGE_KEY,
      JSON.stringify(detail),
    );
  } catch {
    // The live event below still covers the already-mounted composer case.
  }

  window.dispatchEvent(
    new CustomEvent<ChatInputPrefillDetail>(CHAT_INPUT_PREFILL_EVENT, {
      detail,
    }),
  );
}

export function readChatInputPrefill(
  sessionId: string,
): ChatInputPrefillDetail | null {
  if (typeof window === "undefined" || !sessionId) return null;

  try {
    const raw = window.sessionStorage.getItem(CHAT_INPUT_PREFILL_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!isChatInputPrefillDetail(parsed) || parsed.sessionId !== sessionId) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearChatInputPrefill(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;

  try {
    const raw = window.sessionStorage.getItem(CHAT_INPUT_PREFILL_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (isChatInputPrefillDetail(parsed) && parsed.sessionId === sessionId) {
      window.sessionStorage.removeItem(CHAT_INPUT_PREFILL_STORAGE_KEY);
    }
  } catch {
    // A malformed pending value should not block the composer.
  }
}
