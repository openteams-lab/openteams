import type {
  RefObject,
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
} from 'react';
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  GitBranchIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  QuotesIcon,
  XIcon,
  EyeIcon,
  AtIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ChatAgent, ChatMessage } from 'shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui-new/primitives/Tooltip';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import { mentionAllKeyword } from '../constants';

const allowedAttachmentExtensions = [
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.go',
  '.rs',
  '.sql',
  '.sh',
  '.bash',
  '.svg',
];

const isTextAttachment = (file: File) =>
  file.type.startsWith('text/') ||
  allowedAttachmentExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

const isImageAttachment = (file: File) => file.type.startsWith('image/');

const resizeTextarea = (textarea: HTMLTextAreaElement) => {
  textarea.style.height = 'auto';
  const newHeight = Math.min(textarea.scrollHeight, 200);
  textarea.style.height = `${Math.max(44, newHeight)}px`;
};

export const isAllowedAttachment = (file: File) =>
  isTextAttachment(file) || isImageAttachment(file);

const fallbackClipboardFileName = (file: File, index: number) => {
  if (file.name.trim()) return file.name;

  const extension = file.type.startsWith('image/')
    ? (file.type.split('/')[1] ?? 'png')
    : file.type === 'text/plain'
      ? 'txt'
      : 'dat';

  return `pasted-attachment-${Date.now()}-${index + 1}.${extension}`;
};

const normalizeClipboardFile = (file: File, index: number) =>
  file.name.trim()
    ? file
    : new File([file], fallbackClipboardFileName(file, index), {
        type: file.type,
        lastModified: file.lastModified || Date.now(),
      });

const getClipboardFiles = (clipboardData: DataTransfer) => {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const files =
    itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files);

  return files.map(normalizeClipboardFile);
};

export interface MessageInputAreaProps {
  // Input state
  draft: string;
  onDraftChange: (value: string, cursorPosition?: number | null) => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  // Mentions
  selectedMentions: string[];
  onSelectedMentionsChange: React.Dispatch<React.SetStateAction<string[]>>;
  agentOptions: { value: string; label: string }[];
  mentionAgentsCount: number;
  mentionQuery: string | null;
  showMentionAllSuggestion: boolean;
  visibleMentionSuggestions: ChatAgent[];
  highlightedMentionIndex: number;
  onMentionSelect: (name: string) => void;
  onMentionKeyDown: (event: React.KeyboardEvent) => boolean;
  // Reply
  replyToMessage: ChatMessage | null;
  replyToSenderLabel: string | null;
  replyToPreview: string | null;
  onCancelReply: () => void;
  // Attachments
  attachedFiles: File[];
  attachmentError: string | null;
  isUploadingAttachments: boolean;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPasteAttachmentFiles: (files: File[]) => void;
  onRemoveAttachedFile: (index: number) => void;
  onClearAttachedFiles: () => void;
  onPreviewFile: (file: File) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  // Send
  canSend: boolean;
  isSending: boolean;
  onSend: () => void;
  // Input mode
  chatInputMode: 'free' | 'workflow';
  onToggleChatInputMode: (mode?: 'free' | 'workflow') => void;
  isWorkflowMode: boolean;
  leadAgentName?: string | null;
  // State
  isArchived: boolean;
  activeSessionId: string | null;
}

export function MessageInputArea({
  draft,
  onDraftChange,
  inputRef,
  selectedMentions,
  onSelectedMentionsChange,
  mentionAgentsCount,
  mentionQuery,
  showMentionAllSuggestion,
  visibleMentionSuggestions,
  highlightedMentionIndex,
  onMentionSelect,
  onMentionKeyDown,
  replyToMessage,
  replyToSenderLabel,
  replyToPreview,
  onCancelReply,
  attachedFiles,
  attachmentError,
  isUploadingAttachments,
  onAttachmentInputChange,
  onPasteAttachmentFiles,
  onRemoveAttachedFile,
  onClearAttachedFiles,
  onPreviewFile,
  fileInputRef,
  canSend,
  isSending,
  onSend,
  onToggleChatInputMode,
  isWorkflowMode,
  isArchived,
  activeSessionId,
}: MessageInputAreaProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const attachmentStatus =
    attachedFiles.length > 0
      ? t('input.attachmentCount', { count: attachedFiles.length })
      : isUploadingAttachments
        ? t('input.uploadingAttachments')
        : null;
  const replyPreviewText =
    (replyToPreview ?? t('input.referencedMessage'))
      .replace(/\s+/g, ' ')
      .trim() || t('input.referencedMessage');
  const replySummaryText = replyToSenderLabel
    ? `${t('input.replyingTo', { name: replyToSenderLabel })} · ${replyPreviewText}`
    : replyPreviewText;
  const modeSwitchLabel = isWorkflowMode
    ? t('input.modeSwitchTooltip', {
        currentMode: t('input.workflowModeName'),
        targetMode: t('input.chatModeName'),
      })
    : t('input.modeSwitchTooltip', {
        currentMode: t('input.chatModeName'),
        targetMode: t('input.workflowModeName'),
      });
  const mentionSuggestionEntries = [
    ...(showMentionAllSuggestion ? [{ type: 'all' as const }] : []),
    ...visibleMentionSuggestions.map((agent) => ({
      type: 'agent' as const,
      agent,
    })),
  ];
  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (isArchived || !activeSessionId || isUploadingAttachments) return;

    const files = getClipboardFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    onPasteAttachmentFiles(files);
  };

  return (
    <div className="chat-session-input-area shrink-0 relative flex flex-col">
      <div
        className={cn(
          'chat-session-input-shell flex flex-col transition-all duration-300 overflow-visible relative',
          'bg-white dark:bg-[#0a0a0a] border border-slate-200 dark:border-slate-800 shadow-sm',
          isWorkflowMode ? 'rounded-2xl ring-1 ring-blue-500/10' : 'rounded-2xl'
        )}
      >
        {replyToMessage && (
          <div className="chat-session-reply-card" title={replySummaryText}>
            <div className="chat-session-reply-main">
              <QuotesIcon className="chat-session-reply-quote" weight="fill" />
              <div className="chat-session-reply-content">
                {replySummaryText}
              </div>
            </div>
            <button
              type="button"
              className="chat-session-reply-cancel"
              onClick={onCancelReply}
              title={tCommon('buttons.cancel')}
              aria-label={tCommon('buttons.cancel')}
            >
              <XIcon className="size-icon-2xs" />
            </button>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="chat-session-attachments">
            {attachedFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="chat-session-attachment-item"
              >
                <PaperclipIcon className="chat-session-attachment-icon" />
                <span
                  className="chat-session-attachment-name"
                  title={file.name}
                >
                  {file.name}
                </span>
                {isAllowedAttachment(file) && (
                  <button
                    type="button"
                    className="chat-session-attachment-action"
                    onClick={() => onPreviewFile(file)}
                    title={t('input.preview')}
                  >
                    <EyeIcon className="size-icon-2xs" />
                  </button>
                )}
                <button
                  type="button"
                  className="chat-session-attachment-action"
                  onClick={() => onRemoveAttachedFile(index)}
                >
                  <XIcon className="size-icon-2xs" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="chat-session-attachment-clear"
              onClick={onClearAttachedFiles}
            >
              {t('input.clearAll')}
            </button>
          </div>
        )}

        {attachmentError && (
          <div className="text-xs text-error">{attachmentError}</div>
        )}

        <div className="chat-session-input-editor relative">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value, event.target.selectionStart);
              resizeTextarea(event.target);
            }}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (onMentionKeyDown(event)) {
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              isArchived
                ? t('input.archivedPlaceholder')
                : isWorkflowMode
                  ? t('input.workflowPlaceholder')
                  : t('input.inputPlaceholder')
            }
            disabled={isArchived || !activeSessionId}
            className={cn(
              'chat-session-textarea w-full resize-none',
              'p-0 text-normal leading-relaxed focus:outline-none',
              isArchived && 'opacity-60 cursor-not-allowed'
            )}
          />
          {!isWorkflowMode &&
            mentionQuery !== null &&
            mentionSuggestionEntries.length > 0 && (
              <div className="chat-session-mention-suggestions absolute z-20 left-0 right-0 bottom-full mb-half border border-border rounded-sm shadow">
                {mentionSuggestionEntries.map((entry, index) => (
                  <button
                    key={
                      entry.type === 'all' ? '__mention_all__' : entry.agent.id
                    }
                    type="button"
                    onClick={() =>
                      onMentionSelect(
                        entry.type === 'all'
                          ? mentionAllKeyword
                          : entry.agent.name
                      )
                    }
                    className={cn(
                      'chat-session-mention-option w-full px-base py-half text-left text-sm',
                      'flex items-center justify-between',
                      index === highlightedMentionIndex
                        ? 'bg-[#A8C9FF] text-normal dark:bg-[rgba(94,162,255,0.18)] dark:text-[#F3F6FB]'
                        : 'text-normal hover:bg-[#A8C9FF]/40 dark:text-[#BAC4D6] dark:hover:bg-[rgba(94,162,255,0.12)] dark:hover:text-[#F3F6FB]'
                    )}
                  >
                    <span className="flex items-center gap-half min-w-0">
                      {entry.type === 'all' ? (
                        <>
                          <span className="chat-session-mention-avatar bg-panel border border-border text-xs font-semibold flex items-center justify-center">
                            @
                          </span>
                          <span className="truncate">
                            {t('input.mentionAllSuggestion')}
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            className="chat-session-mention-avatar"
                            style={getAgentAvatarStyle(
                              getAgentAvatarSeed(
                                entry.agent.id,
                                entry.agent.runner_type,
                                entry.agent.name
                              )
                            )}
                          >
                            <AgentBrandIcon
                              runnerType={entry.agent.runner_type}
                              className="chat-session-mention-avatar-logo"
                            />
                          </span>
                          <span className="truncate">@{entry.agent.name}</span>
                        </>
                      )}
                    </span>
                    <CaretRightIcon
                      className={cn(
                        'size-icon-xs',
                        index === highlightedMentionIndex
                          ? 'text-on-brand'
                          : 'text-low'
                      )}
                    />
                  </button>
                ))}
              </div>
            )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onAttachmentInputChange}
        />

        <div className="chat-session-input-footer">
          <div className="chat-session-input-toolbar-left">
            <Tooltip content={t('input.addAttachment')} side="top">
              <span className="inline-flex">
                <button
                  type="button"
                  className="chat-session-input-icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    isArchived || !activeSessionId || isUploadingAttachments
                  }
                  aria-label={t('input.addAttachment')}
                >
                  <PaperclipIcon className="size-icon-xs" />
                </button>
              </span>
            </Tooltip>
            <Tooltip content={modeSwitchLabel} side="top">
              <span className="inline-flex">
                <button
                  type="button"
                  className={cn(
                    'chat-session-input-icon-btn relative',
                    isWorkflowMode &&
                      'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                  )}
                  onClick={() => onToggleChatInputMode()}
                  disabled={isArchived || !activeSessionId}
                  aria-label={modeSwitchLabel}
                >
                  <span className="relative flex size-icon-xs items-center justify-center">
                    {isWorkflowMode ? (
                      <GitBranchIcon className="size-icon-xs" weight="bold" />
                    ) : (
                      <ChatCircleDotsIcon
                        className="size-icon-xs"
                        weight="bold"
                      />
                    )}
                    <ArrowsClockwiseIcon
                      className="absolute -right-1 -bottom-1 size-2.5 rounded-full bg-white text-slate-400 dark:bg-[#0a0a0a] dark:text-slate-500"
                      weight="bold"
                    />
                  </span>
                </button>
              </span>
            </Tooltip>
            {!isWorkflowMode && (
              <Tooltip content={t('input.mentionAgents')} side="top">
                <span className="inline-flex">
                  <button
                    type="button"
                    className="chat-session-input-icon-btn"
                    onClick={() => {
                      if (inputRef.current) {
                        const textarea = inputRef.current;
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const value = draft;
                        const newValue =
                          value.substring(0, start) +
                          '@' +
                          value.substring(end);
                        onDraftChange(newValue, start + 1);
                        textarea.focus();
                        requestAnimationFrame(() => {
                          textarea.setSelectionRange(start + 1, start + 1);
                        });
                      }
                    }}
                    disabled={
                      !activeSessionId || mentionAgentsCount === 0 || isArchived
                    }
                    aria-label={t('input.mentionAgents')}
                  >
                    <AtIcon className="size-icon-xs" />
                  </button>
                </span>
              </Tooltip>
            )}
            {!isWorkflowMode && selectedMentions.length > 0 && (
              <div className="chat-session-selected-mentions">
                {selectedMentions.map((mention) => (
                  <Badge
                    key={mention}
                    variant="secondary"
                    className="chat-session-selected-mention"
                  >
                    {mention === mentionAllKeyword
                      ? t('input.mentionAllBadge')
                      : `@${mention}`}
                    <button
                      type="button"
                      onClick={() =>
                        onSelectedMentionsChange((prev) =>
                          prev.filter((item) => item !== mention)
                        )
                      }
                      className="chat-session-selected-mention-remove"
                    >
                      <XIcon className="size-icon-2xs" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="chat-session-input-toolbar-right">
            {attachmentStatus && (
              <div className="chat-session-input-status">
                {attachmentStatus}
              </div>
            )}
            <Tooltip content={tCommon('buttons.send')} side="top">
              <button
                type="button"
                className="chat-session-send-btn"
                onClick={onSend}
                disabled={!canSend}
                aria-label={tCommon('buttons.send')}
              >
                {isSending ? (
                  <span className="chat-session-send-spinner" />
                ) : (
                  <PaperPlaneRightIcon className="size-icon-xs" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="chat-session-input-assistive">{t('input.sendHint')}</div>
    </div>
  );
}
