import { useEffect } from 'react';

const HEARTBEAT_INTERVAL_MS = 10000;
const ENDPOINT = '/api/browser-session';

type BrowserSessionEvent = 'open' | 'heartbeat' | 'close';

function createSessionId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPayload(sessionId: string, event: BrowserSessionEvent) {
  return JSON.stringify({
    session_id: sessionId,
    event,
  });
}

function sendSessionEvent(
  sessionId: string,
  event: BrowserSessionEvent,
  preferBeacon = false
) {
  const payload = createPayload(sessionId, event);

  if (
    preferBeacon &&
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
  ) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(ENDPOINT, blob);
    return;
  }

  void fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload,
    keepalive: preferBeacon,
  }).catch(() => {
    // Best-effort lifecycle reporting should never block the app.
  });
}

export function useNpxBrowserLifecycle(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const sessionId = createSessionId();
    let closed = false;

    sendSessionEvent(sessionId, 'open');

    const heartbeatTimer = window.setInterval(() => {
      sendSessionEvent(sessionId, 'heartbeat');
    }, HEARTBEAT_INTERVAL_MS);

    const handleClose = () => {
      if (closed) {
        return;
      }

      closed = true;
      window.clearInterval(heartbeatTimer);
      sendSessionEvent(sessionId, 'close', true);
    };

    window.addEventListener('pagehide', handleClose);
    window.addEventListener('beforeunload', handleClose);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.removeEventListener('pagehide', handleClose);
      window.removeEventListener('beforeunload', handleClose);
      handleClose();
    };
  }, [enabled]);
}
