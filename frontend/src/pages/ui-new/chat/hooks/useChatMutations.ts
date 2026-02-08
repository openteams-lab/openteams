import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, ChatSession, JsonValue } from 'shared/types';
import { chatApi } from '@/lib/api';

export interface UseChatMutationsResult {
  createSession: ReturnType<typeof useMutation<ChatSession, Error, void>>;
  updateSession: ReturnType<
    typeof useMutation<ChatSession, Error, { sessionId: string; title: string | null }>
  >;
  archiveSession: ReturnType<typeof useMutation<ChatSession, Error, string>>;
  restoreSession: ReturnType<typeof useMutation<ChatSession, Error, string>>;
  sendMessage: ReturnType<
    typeof useMutation<
      ChatMessage,
      Error,
      { sessionId: string; content: string; meta?: JsonValue }
    >
  >;
}

export function useChatMutations(
  onSessionCreated?: (session: ChatSession) => void,
  onSessionUpdated?: (session: ChatSession) => void,
  onMessageSent?: (message: ChatMessage) => void
): UseChatMutationsResult {
  const queryClient = useQueryClient();

  const createSession = useMutation({
    mutationFn: () => chatApi.createSession({ title: null }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      onSessionCreated?.(session);
    },
  });

  const updateSession = useMutation({
    mutationFn: (params: { sessionId: string; title: string | null }) =>
      chatApi.updateSession(params.sessionId, {
        title: params.title,
        status: null,
        summary_text: null,
        archive_ref: null,
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      onSessionUpdated?.(session);
    },
  });

  const archiveSession = useMutation({
    mutationFn: (id: string) => chatApi.archiveSession(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      onSessionUpdated?.(session);
    },
  });

  const restoreSession = useMutation({
    mutationFn: (id: string) => chatApi.restoreSession(id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      onSessionUpdated?.(session);
    },
  });

  const sendMessage = useMutation({
    mutationFn: async (params: {
      sessionId: string;
      content: string;
      meta?: JsonValue;
    }) =>
      chatApi.createMessage(
        params.sessionId,
        chatApi.buildCreateMessageRequest(params.content, params.meta ?? null)
      ),
    onSuccess: (message) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
      onMessageSent?.(message);
    },
  });

  return {
    createSession,
    updateSession,
    archiveSession,
    restoreSession,
    sendMessage,
  };
}
