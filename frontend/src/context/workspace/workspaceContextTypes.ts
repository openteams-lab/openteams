import type {
  ChatActiveRun,
  Member,
  QuotedMessageReference,
  UpdateChatSession,
} from '@/types';

export type ListUpdater<T> = T[] | ((prev: T[]) => T[]);

export type ChatInputMode = 'free' | 'workflow';
export const DEFAULT_CHAT_INPUT_MODE: ChatInputMode = 'free';
export type RuntimeActiveRun = ChatActiveRun;

export const resolveChatInputMode = (
  value: string | null | undefined,
): ChatInputMode => (value === 'workflow' ? 'workflow' : 'free');

export const toSessionChatInputMode = (mode: ChatInputMode): string | null =>
  mode === 'workflow' ? 'workflow' : null;

export const chatSessionUpdatePayload = (
  patch: Partial<UpdateChatSession>,
): UpdateChatSession => ({
  title: null,
  status: null,
  summary_text: null,
  archive_ref: null,
  last_seen_diff_key: null,
  default_workspace_path: null,
  ...patch,
});

export interface SendMessageOptions {
  chatInputMode?: ChatInputMode;
  quotedMessage?: QuotedMessageReference;
  routeMentions?: string[];
  fallbackMention?: string | null;
  workflowLeadAgentId?: string | null;
  persistToBackend?: boolean;
  placeholderMember?: Pick<Member, 'avatar' | 'name' | 'modelName'> | null;
}

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type WorkspaceToast = {
  message: string;
  tone: ToastTone;
};

export type WorkflowRuntimeLine = {
  id: string;
  executionId: string;
  workflowAgentSessionId: string | null;
  stepId: string;
  stepKey: string;
  agentId: string;
  agentName: string;
  streamType: 'assistant' | 'thinking' | 'error';
  content: string;
  createdAt: string;
};
