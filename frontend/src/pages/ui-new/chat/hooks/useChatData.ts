import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChatAgent,
  ChatMessage,
  ChatSession,
  ChatSessionAgent,
  ChatSessionStatus,
} from 'shared/types';
import { chatApi } from '@/lib/api';
import type { RunHistoryItem, SessionMember } from '../types';
import { extractRunId } from '../utils';

export interface UseChatDataResult {
  sessions: ChatSession[];
  sortedSessions: ChatSession[];
  activeSessions: ChatSession[];
  archivedSessions: ChatSession[];
  agents: ChatAgent[];
  sessionAgents: ChatSessionAgent[];
  messagesData: ChatMessage[];
  agentById: Map<string, ChatAgent>;
  sessionMembers: SessionMember[];
  mentionAgents: ChatAgent[];
  isSessionsLoading: boolean;
  isAgentsLoading: boolean;
  isSessionAgentsLoading: boolean;
  isMessagesLoading: boolean;
  isLoading: boolean;
}

export function useChatData(activeSessionId: string | null): UseChatDataResult {
  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () => chatApi.listSessions(),
  });

  const { data: agents = [], isLoading: isAgentsLoading } = useQuery({
    queryKey: ['chatAgents'],
    queryFn: () => chatApi.listAgents(),
  });

  const { data: sessionAgents = [], isLoading: isSessionAgentsLoading } =
    useQuery({
      queryKey: ['chatSessionAgents', activeSessionId],
      queryFn: () => chatApi.listSessionAgents(activeSessionId!),
      enabled: !!activeSessionId,
    });

  const { data: messagesData = [], isLoading: isMessagesLoading } = useQuery({
    queryKey: ['chatMessages', activeSessionId],
    queryFn: () => chatApi.listMessages(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ),
    [sessions]
  );

  const activeSessions = useMemo(
    () =>
      sortedSessions.filter(
        (session) => session.status === ChatSessionStatus.active
      ),
    [sortedSessions]
  );

  const archivedSessions = useMemo(
    () =>
      sortedSessions.filter(
        (session) => session.status === ChatSessionStatus.archived
      ),
    [sortedSessions]
  );

  const agentById = useMemo(() => {
    const map = new Map<string, ChatAgent>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const sessionMembers = useMemo<SessionMember[]>(() => {
    return sessionAgents
      .map((sessionAgent) => {
        const agent = agentById.get(sessionAgent.agent_id);
        if (!agent) return null;
        return { agent, sessionAgent };
      })
      .filter((item): item is SessionMember => item !== null);
  }, [agentById, sessionAgents]);

  const mentionAgents = useMemo(
    () => sessionMembers.map((member) => member.agent),
    [sessionMembers]
  );

  const isLoading =
    isSessionsLoading ||
    isMessagesLoading ||
    isAgentsLoading ||
    isSessionAgentsLoading;

  return {
    sessions,
    sortedSessions,
    activeSessions,
    archivedSessions,
    agents,
    sessionAgents,
    messagesData,
    agentById,
    sessionMembers,
    mentionAgents,
    isSessionsLoading,
    isAgentsLoading,
    isSessionAgentsLoading,
    isMessagesLoading,
    isLoading,
  };
}

export function useRunHistory(messages: ChatMessage[]): RunHistoryItem[] {
  return useMemo(() => {
    const runs: RunHistoryItem[] = [];
    for (const message of messages) {
      if (message.sender_type !== 'agent' || !message.sender_id) {
        continue;
      }
      const runId = extractRunId(message.meta);
      if (!runId) continue;
      runs.push({
        runId,
        agentId: message.sender_id,
        createdAt: message.created_at,
        content: message.content,
      });
    }
    return runs;
  }, [messages]);
}
