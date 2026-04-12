import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChatAgent,
  ChatMessage,
  ChatSession,
  ChatSessionAgent,
  ChatSessionStatus,
  ChatWorkItem,
} from 'shared/types';
import { chatApi } from '@/lib/api';
import type { RunHistoryItem, RunRetentionState, SessionMember } from '../types';
import { extractRunId, extractErrorFromMeta } from '../utils';

export interface UseChatDataResult {
  sessions: ChatSession[];
  sortedSessions: ChatSession[];
  activeSessions: ChatSession[];
  archivedSessions: ChatSession[];
  agents: ChatAgent[];
  sessionAgents: ChatSessionAgent[];
  messagesData: ChatMessage[];
  workItemsData: ChatWorkItem[];
  agentById: Map<string, ChatAgent>;
  sessionMembers: SessionMember[];
  mentionAgents: ChatAgent[];
  isSessionsLoading: boolean;
  isAgentsLoading: boolean;
  isSessionAgentsLoading: boolean;
  isMessagesLoading: boolean;
  isWorkItemsLoading: boolean;
  isLoading: boolean;
}

export function useChatData(activeSessionId: string | null): UseChatDataResult {
  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () => chatApi.listSessions(),
    staleTime: 0,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
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
      staleTime: 0,
      refetchOnMount: 'always',
    });

  const { data: messagesData = [], isLoading: isMessagesLoading } = useQuery({
    queryKey: ['chatMessages', activeSessionId],
    queryFn: () => chatApi.listMessages(activeSessionId!),
    enabled: !!activeSessionId,
  });

  const { data: workItemsData = [], isLoading: isWorkItemsLoading } = useQuery({
    queryKey: ['chatWorkItems', activeSessionId],
    queryFn: () => chatApi.listWorkItems(activeSessionId!),
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
    isWorkItemsLoading ||
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
    workItemsData,
    agentById,
    sessionMembers,
    mentionAgents,
    isSessionsLoading,
    isAgentsLoading,
    isSessionAgentsLoading,
    isMessagesLoading,
    isWorkItemsLoading,
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
      const errorInfo = extractErrorFromMeta(message.meta);
      const errorTypeData = (message.meta as Record<string, unknown>)?.error as
        | { error_type?: { type?: string; provider?: string } }
        | undefined;
      const errorTypeInfo = errorTypeData?.error_type?.type
        ? {
            type: errorTypeData.error_type.type,
            provider: errorTypeData.error_type.provider,
          }
        : undefined;
      runs.push({
        runId,
        agentId: message.sender_id,
        createdAt: message.created_at,
        content: message.content,
        errorSummary: errorInfo?.summary,
        errorContent: errorInfo?.content,
        errorType: errorTypeInfo,
        hasError: !!errorInfo,
      });
    }
    return runs;
  }, [messages]);
}

export function useRunRetention(
  sessionId: string | null,
  runIds: string[]
): Map<string, RunRetentionState> {
  const { data } = useQuery({
    queryKey: ['chatRunRetention', sessionId, runIds],
    queryFn: async () => {
      if (!sessionId || runIds.length === 0) return [];
      return chatApi.getSessionRunsRetention(sessionId, runIds);
    },
    enabled: !!sessionId && runIds.length > 0,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const map = new Map<string, RunRetentionState>();
    if (!data) return map;
    for (const info of data) {
      map.set(info.run_id, {
        runId: info.run_id,
        logState: info.log_state,
        artifactState: info.artifact_state,
        logTruncated: info.log_truncated,
        logCaptureDegraded: info.log_capture_degraded,
        prunedAt: info.pruned_at,
        pruneReason: info.prune_reason,
        retentionSummary: info.retention_summary,
      });
    }
    return map;
  }, [data]);
}
