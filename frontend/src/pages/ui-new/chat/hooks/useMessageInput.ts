import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAgent, ChatMessage } from 'shared/types';
import { mentionRegex } from '../constants';
import { extractMentions } from '../utils';

export interface UseMessageInputResult {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  selectedMentions: string[];
  setSelectedMentions: React.Dispatch<React.SetStateAction<string[]>>;
  mentionQuery: string | null;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  replyToMessage: ChatMessage | null;
  setReplyToMessage: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  handleDraftChange: (value: string) => void;
  handleMentionSelect: (name: string) => void;
  handleReplySelect: (message: ChatMessage, mentionHandle: string | null) => void;
  visibleMentionSuggestions: ChatAgent[];
  agentOptions: { value: string; label: string }[];
  resetInput: () => void;
}

export function useMessageInput(
  mentionAgents: ChatAgent[]
): UseMessageInputResult {
  const inputRef = useRef<HTMLTextAreaElement>(null!);
  const [draft, setDraft] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    const match = mentionRegex.exec(value);
    if (match) {
      setMentionQuery(match[2] ?? '');
    } else {
      setMentionQuery(null);
    }
  }, []);

  const handleMentionSelect = useCallback((name: string) => {
    setDraft((prev) => {
      const match = mentionRegex.exec(prev);
      if (!match) {
        return `${prev}${prev.endsWith(' ') || prev.length === 0 ? '' : ' '}@${name} `;
      }
      const matchIndex = match.index ?? prev.length;
      const prefix = prev.slice(0, matchIndex);
      const spacer = match[1] ?? '';
      return `${prefix}${spacer}@${name} `;
    });
    setMentionQuery(null);
    inputRef.current?.focus();
  }, []);

  const handleReplySelect = useCallback(
    (message: ChatMessage, mentionHandle: string | null) => {
      setReplyToMessage(message);
      if (mentionHandle) {
        setDraft((prev) => {
          const mentions = extractMentions(prev);
          if (mentions.has(mentionHandle)) return prev;
          const prefix = `@${mentionHandle}`;
          if (!prev.trim()) return `${prefix} `;
          return `${prefix} ${prev}`;
        });
        setSelectedMentions((prev) =>
          prev.includes(mentionHandle) ? prev : [...prev, mentionHandle]
        );
        setMentionQuery(null);
      }
      inputRef.current?.focus();
    },
    []
  );

  const visibleMentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return mentionAgents.filter((agent) =>
      agent.name.toLowerCase().includes(query)
    );
  }, [mentionAgents, mentionQuery]);

  const agentOptions = useMemo(
    () =>
      mentionAgents.map((agent) => ({
        value: agent.name,
        label: agent.name,
      })),
    [mentionAgents]
  );

  // Sync selected mentions with available agents
  useEffect(() => {
    if (mentionAgents.length === 0) {
      setSelectedMentions([]);
      return;
    }
    setSelectedMentions((prev) =>
      prev.filter((mention) =>
        mentionAgents.some((agent) => agent.name === mention)
      )
    );
  }, [mentionAgents]);

  const resetInput = useCallback(() => {
    setDraft('');
    setSelectedMentions([]);
    setMentionQuery(null);
    setReplyToMessage(null);
  }, []);

  return {
    draft,
    setDraft,
    selectedMentions,
    setSelectedMentions,
    mentionQuery,
    setMentionQuery,
    replyToMessage,
    setReplyToMessage,
    inputRef,
    handleDraftChange,
    handleMentionSelect,
    handleReplySelect,
    visibleMentionSuggestions,
    agentOptions,
    resetInput,
  };
}
