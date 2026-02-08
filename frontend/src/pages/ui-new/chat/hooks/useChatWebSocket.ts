import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, ChatSessionAgentState, ChatStreamEvent } from 'shared/types';
import { chatApi } from '@/lib/api';
import type { StreamRun } from '../types';
import { extractRunId } from '../utils';

export interface UseChatWebSocketResult {
  streamingRuns: Record<string, StreamRun>;
  agentStates: Record<string, ChatSessionAgentState>;
  setAgentStates: React.Dispatch<
    React.SetStateAction<Record<string, ChatSessionAgentState>>
  >;
}

export function useChatWebSocket(
  activeSessionId: string | null,
  onMessageReceived: (message: ChatMessage) => void
): UseChatWebSocketResult {
  const [streamingRuns, setStreamingRuns] = useState<Record<string, StreamRun>>(
    {}
  );
  const [agentStates, setAgentStates] = useState<
    Record<string, ChatSessionAgentState>
  >({});

  const handleMessageNew = useCallback(
    (message: ChatMessage) => {
      onMessageReceived(message);
      const runId = extractRunId(message.meta);
      if (runId) {
        setStreamingRuns((prev) => {
          if (!prev[runId]) return prev;
          const next = { ...prev };
          delete next[runId];
          return next;
        });
      }
    },
    [onMessageReceived]
  );

  const handleAgentDelta = useCallback(
    (payload: ChatStreamEvent & { type: 'agent_delta' }) => {
      setStreamingRuns((prev) => {
        const previous = prev[payload.run_id];
        const content =
          payload.delta && previous
            ? `${previous.content}${payload.content}`
            : payload.content;
        return {
          ...prev,
          [payload.run_id]: {
            agentId: payload.agent_id,
            content,
            isFinal: payload.is_final,
          },
        };
      });
      if (payload.is_final) {
        setTimeout(() => {
          setStreamingRuns((prev) => {
            if (!prev[payload.run_id]) return prev;
            const next = { ...prev };
            delete next[payload.run_id];
            return next;
          });
        }, 1500);
      }
    },
    []
  );

  const handleAgentState = useCallback(
    (payload: ChatStreamEvent & { type: 'agent_state' }) => {
      setAgentStates((prev) => ({
        ...prev,
        [payload.agent_id]: payload.state,
      }));
    },
    []
  );

  useEffect(() => {
    if (!activeSessionId) return;
    let ws: WebSocket | null = null;
    let shouldReconnect = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const streamUrl = chatApi.getStreamUrl(activeSessionId);
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}${streamUrl}`;
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ChatStreamEvent;
          if (payload.type === 'message_new') {
            handleMessageNew(payload.message);
            return;
          }

          if (payload.type === 'agent_delta') {
            handleAgentDelta(payload);
            return;
          }

          if (payload.type === 'agent_state') {
            handleAgentState(payload);
          }
        } catch (error) {
          console.warn('Failed to parse chat stream payload', error);
        }
      };

      ws.onclose = () => {
        if (!shouldReconnect) return;
        reconnectTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [activeSessionId, handleMessageNew, handleAgentDelta, handleAgentState]);

  // Reset state when session changes
  useEffect(() => {
    setStreamingRuns({});
    setAgentStates({});
  }, [activeSessionId]);

  return {
    streamingRuns,
    agentStates,
    setAgentStates,
  };
}
