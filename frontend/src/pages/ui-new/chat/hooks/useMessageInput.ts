import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAgent, ChatMessage } from 'shared/types';
import {
  isMentionAllAlias,
  mentionAllAliases,
  mentionAllKeyword,
  mentionRegex,
} from '../constants';
import { extractMentions } from '../utils';

export interface UseMessageInputResult {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  selectedMentions: string[];
  setSelectedMentions: React.Dispatch<React.SetStateAction<string[]>>;
  mentionQuery: string | null;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  showMentionAllSuggestion: boolean;
  replyToMessage: ChatMessage | null;
  setReplyToMessage: React.Dispatch<React.SetStateAction<ChatMessage | null>>;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  handleDraftChange: (value: string, cursorPosition?: number | null) => void;
  handleMentionSelect: (name: string) => void;
  handleReplySelect: (
    message: ChatMessage,
    mentionHandle: string | null
  ) => void;
  visibleMentionSuggestions: ChatAgent[];
  agentOptions: { value: string; label: string }[];
  resetInput: () => void;
  highlightedMentionIndex: number;
  setHighlightedMentionIndex: React.Dispatch<React.SetStateAction<number>>;
  handleMentionKeyDown: (event: React.KeyboardEvent) => boolean;
}

export function useMessageInput(
  mentionAgents: ChatAgent[]
): UseMessageInputResult {
  const inputRef = useRef<HTMLTextAreaElement>(null!);
  const [draft, setDraft] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(
    null
  );
  const [highlightedMentionIndex, setHighlightedMentionIndex] = useState(0);

  const getActiveMentionMatch = useCallback(
    (value: string, cursorPosition?: number | null) => {
      const fallbackCursorPosition = value.length;
      const safeCursorPosition = Math.max(
        0,
        Math.min(cursorPosition ?? fallbackCursorPosition, value.length)
      );
      const textBeforeCursor = value.slice(0, safeCursorPosition);
      const match = mentionRegex.exec(textBeforeCursor);

      if (!match) {
        return null;
      }

      const replaceStart =
        match.index +
        (match[0].lastIndexOf('@') >= 0 ? match[0].lastIndexOf('@') : 0);

      return {
        query: match[2] ?? '',
        replaceEnd: safeCursorPosition,
        replaceStart,
      };
    },
    []
  );

  const handleDraftChange = useCallback(
    (value: string, cursorPosition?: number | null) => {
      setDraft(value);
      const activeMentionMatch = getActiveMentionMatch(value, cursorPosition);
      if (activeMentionMatch) {
        setMentionQuery(activeMentionMatch.query);
        setHighlightedMentionIndex(0);
        return;
      }

      setMentionQuery(null);
      setHighlightedMentionIndex(0);
    },
    [getActiveMentionMatch]
  );

  const handleMentionSelect = useCallback(
    (name: string) => {
      setDraft((prev) => {
        const textarea = inputRef.current;
        const selectionStart = textarea?.selectionStart ?? prev.length;
        const selectionEnd = textarea?.selectionEnd ?? selectionStart;
        const activeMentionMatch = getActiveMentionMatch(prev, selectionStart);

        if (!activeMentionMatch) {
          const prefix = prev.slice(0, selectionStart);
          const suffix = prev.slice(selectionEnd);
          const needsLeadingSpace = prefix.length > 0 && !/\s$/u.test(prefix);
          const insertedMention = `${needsLeadingSpace ? ' ' : ''}@${name} `;

          requestAnimationFrame(() => {
            const nextCursor = selectionStart + insertedMention.length;
            textarea?.focus();
            textarea?.setSelectionRange(nextCursor, nextCursor);
          });

          return `${prefix}${insertedMention}${suffix}`;
        }

        const prefix = prev.slice(0, activeMentionMatch.replaceStart);
        const suffix = prev.slice(activeMentionMatch.replaceEnd);
        const nextValue = `${prefix}@${name} ${suffix}`;
        const nextCursor = prefix.length + name.length + 2;

        requestAnimationFrame(() => {
          textarea?.focus();
          textarea?.setSelectionRange(nextCursor, nextCursor);
        });

        return nextValue;
      });
      setSelectedMentions((prev) =>
        prev.includes(name) ? prev : [...prev, name]
      );
      setMentionQuery(null);
      inputRef.current?.focus();
    },
    [getActiveMentionMatch]
  );

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

  const showMentionAllSuggestion = useMemo(() => {
    if (mentionQuery === null) return false;
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      mentionAllAliases.some((alias) =>
        alias.toLowerCase().startsWith(query)
      ) ||
      isMentionAllAlias(query) ||
      mentionAllKeyword.startsWith(query)
    );
  }, [mentionQuery]);

  // Handle keyboard navigation for mention suggestions
  // Returns true if the event was handled (should prevent default behavior)
  const handleMentionKeyDown = useCallback(
    (event: React.KeyboardEvent): boolean => {
      // Only handle when mention suggestions are visible
      const totalSuggestionCount =
        visibleMentionSuggestions.length + (showMentionAllSuggestion ? 1 : 0);
      if (mentionQuery === null || totalSuggestionCount === 0) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedMentionIndex((prev) =>
          prev < totalSuggestionCount - 1 ? prev + 1 : 0
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedMentionIndex((prev) =>
          prev > 0 ? prev - 1 : totalSuggestionCount - 1
        );
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (showMentionAllSuggestion && highlightedMentionIndex === 0) {
          handleMentionSelect(mentionAllKeyword);
          return true;
        }
        const agentIndex =
          highlightedMentionIndex - (showMentionAllSuggestion ? 1 : 0);
        const selectedAgent = visibleMentionSuggestions[agentIndex];
        if (selectedAgent) {
          handleMentionSelect(selectedAgent.name);
        }
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        setHighlightedMentionIndex(0);
        return true;
      }

      return false;
    },
    [
      mentionQuery,
      visibleMentionSuggestions,
      showMentionAllSuggestion,
      highlightedMentionIndex,
      handleMentionSelect,
    ]
  );

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
      prev.filter(
        (mention) =>
          mention === mentionAllKeyword ||
          mentionAgents.some((agent) => agent.name === mention)
      )
    );
  }, [mentionAgents]);

  const resetInput = useCallback(() => {
    setDraft('');
    setSelectedMentions([]);
    setMentionQuery(null);
    setReplyToMessage(null);
    setHighlightedMentionIndex(0);
    if (inputRef.current) {
      inputRef.current.style.height = '44px';
    }
  }, []);

  return {
    draft,
    setDraft,
    selectedMentions,
    setSelectedMentions,
    mentionQuery,
    setMentionQuery,
    showMentionAllSuggestion,
    replyToMessage,
    setReplyToMessage,
    inputRef,
    handleDraftChange,
    handleMentionSelect,
    handleReplySelect,
    visibleMentionSuggestions,
    agentOptions,
    resetInput,
    highlightedMentionIndex,
    setHighlightedMentionIndex,
    handleMentionKeyDown,
  };
}
