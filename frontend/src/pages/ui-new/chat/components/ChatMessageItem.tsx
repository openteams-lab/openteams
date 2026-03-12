import {
  CheckCircleIcon,
  XCircleIcon,
  WarningCircleIcon,
  PaperPlaneTiltIcon,
  CheckSquareIcon,
  SquareIcon,
  CopyIcon,
  ArrowClockwiseIcon,
  QuotesIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  type ChatMessage,
  ChatSenderType,
  ChatSessionAgentState,
} from 'shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatErrorMessage } from '@/components/ui-new/primitives/conversation/ChatErrorMessage';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { ChatSystemMessage } from '@/components/ui-new/primitives/conversation/ChatSystemMessage';
import { chatApi } from '@/lib/api';
import { formatDateShortWithTime } from '@/utils/date';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import type {
  ChatAttachment,
  DiffMeta,
  MentionStatus,
  MessageTone,
  RunDiffState,
} from '../types';
import {
  extractAttachments,
  detectApiError,
  formatBytes,
  tryParseAgentResponse,
  buildAgentDisplayContent,
  extractProtocolErrorMeta,
} from '../utils';
import { formatTokenCount } from '@/utils/string';

export interface ChatMessageItemProps {
  message: ChatMessage;
  senderLabel: string;
  senderRunnerType: string | null;
  tone: MessageTone;
  // Reference/reply
  referenceMessage: ChatMessage | null;
  referenceSenderLabel: string | null;
  referencePreview: string | null;
  // Mentions
  mentionList: string[];
  mentionStatusMap: Map<string, MentionStatus> | undefined;
  agentStates: Record<string, ChatSessionAgentState>;
  agentIdByName: Map<string, string>;
  // Attachments
  attachments: ChatAttachment[];
  activeSessionId: string | null;
  onAddAttachmentAsFile: (
    messageId: string,
    attachment: ChatAttachment
  ) => void;
  onPreviewAttachment: (
    message: ChatMessage,
    attachment: ChatAttachment
  ) => void;
  // Diff
  diffInfo: DiffMeta | null;
  runDiffs: Record<string, RunDiffState>;
  onOpenDiffViewer: (
    runId: string,
    untracked: string[],
    hasDiff: boolean
  ) => void;
  // Interaction
  isArchived: boolean;
  onReply: (message: ChatMessage) => void;
  // Cleanup mode
  isCleanupMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}

export function ChatMessageItem({
  message,
  senderLabel,
  senderRunnerType,
  referenceMessage,
  referenceSenderLabel,
  referencePreview,
  mentionList,
  mentionStatusMap,
  agentStates,
  agentIdByName,
  attachments,
  activeSessionId,
  onAddAttachmentAsFile,
  onPreviewAttachment,
  isArchived,
  onReply,
  isCleanupMode,
  isSelected,
  onToggleSelect,
}: ChatMessageItemProps) {
  const { t } = useTranslation('chat');
  const isUser = message.sender_type === ChatSenderType.user;
  const isAgent = message.sender_type === ChatSenderType.agent;
  const agentAvatarSeed = isAgent
    ? getAgentAvatarSeed(message.sender_id, senderRunnerType, senderLabel)
    : '';
  const agentAvatarStyle = isAgent
    ? getAgentAvatarStyle(agentAvatarSeed)
    : undefined;

  const referenceId =
    referenceMessage?.id ??
    (message.meta &&
      typeof message.meta === 'object' &&
      !Array.isArray(message.meta) &&
      (message.meta as { reference?: { message_id?: string } }).reference
        ?.message_id) ??
    null;
  const contextCompacted =
    isAgent &&
    message.meta &&
    typeof message.meta === 'object' &&
    !Array.isArray(message.meta) &&
    (message.meta as { context_compacted?: unknown }).context_compacted ===
      true;
  // Try to parse new JSON format for agent messages
  const parsedAgentResponse = isAgent ? tryParseAgentResponse(message.content) : null;
  const displayContent = (() => {
    if (!isAgent) return message.content;
    if (parsedAgentResponse) {
      return buildAgentDisplayContent(parsedAgentResponse, senderLabel);
    }
    return message.content;
  })();

  const meta = message.meta;
  const tokenUsage =
    isAgent &&
    meta &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    'token_usage' in meta
      ? (
          meta as {
            token_usage?: {
              total_tokens?: number;
              is_estimated?: boolean;
            };
          }
        ).token_usage
      : null;
  const tokenCount =
    typeof tokenUsage?.total_tokens === 'number'
      ? tokenUsage.total_tokens
      : null;
  const isEstimated = tokenUsage?.is_estimated === true;
  const protocolError = extractProtocolErrorMeta(message.meta);

  // System messages
  if (message.sender_type === ChatSenderType.system) {
    if (protocolError) {
      const summary = protocolError.reason?.trim() || message.content;
      const detail = protocolError.detail?.trim() ?? '';
      const rawOutput = protocolError.rawOutput?.trim() ?? '';

      return (
        <div className="chat-session-message-row is-system flex items-start gap-base">
          {isCleanupMode && (
            <button
              type="button"
              className="flex-shrink-0 mt-1"
              onClick={onToggleSelect}
            >
              {isSelected ? (
                <CheckSquareIcon
                  className="size-icon text-brand"
                  weight="fill"
                />
              ) : (
                <SquareIcon className="size-icon text-low" />
              )}
            </button>
          )}
          <div className="flex-1 rounded-xl border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.06)] px-base py-base">
            <ChatErrorMessage content={summary} expanded />
            {detail && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-panel px-3 py-2 font-ibm-plex-mono text-xs text-low">
                {detail}
              </pre>
            )}
            {rawOutput && (
              <div className="mt-3 rounded-lg border border-border/60 bg-panel px-3 py-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-low">
                  Raw assistant output
                </div>
                <ChatMarkdown content={rawOutput} hideCopyButton />
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="chat-session-message-row is-system flex items-start gap-base">
        {isCleanupMode && (
          <button
            type="button"
            className="flex-shrink-0 mt-1"
            onClick={onToggleSelect}
          >
            {isSelected ? (
              <CheckSquareIcon className="size-icon text-brand" weight="fill" />
            ) : (
              <SquareIcon className="size-icon text-low" />
            )}
          </button>
        )}
        <div className="flex-1">
          <ChatSystemMessage content={message.content} expanded />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-session-message-item">
      {contextCompacted && (
        <div
          className="chat-session-context-compacted-separator"
          role="separator"
          aria-label={t('message.contextCompressed')}
        >
          <span className="chat-session-context-compacted-separator-line" />
          <span className="chat-session-context-compacted-separator-text">
            {t('message.contextCompressed')}
          </span>
          <span className="chat-session-context-compacted-separator-line" />
        </div>
      )}
<div
        id={`chat-message-${message.id}`}
        className={cn(
          'chat-session-message-row group flex items-start gap-base',
          isUser ? 'is-user justify-end' : 'is-agent justify-start'
        )}
      >
        {isCleanupMode && !isUser && (
          <button
            type="button"
            className="flex-shrink-0 mt-1"
            onClick={onToggleSelect}
          >
            {isSelected ? (
              <CheckSquareIcon className="size-icon text-brand" weight="fill" />
            ) : (
              <SquareIcon className="size-icon text-low" />
            )}
          </button>
        )}
<div className={cn('relative', !isUser && 'w-full max-w-[680px]')}>
          <ChatEntryContainer
          variant={isUser ? 'user' : 'system'}
          title={isUser ? undefined : senderLabel}
          icon={
            isAgent ? (
              <AgentBrandIcon
                runnerType={senderRunnerType}
                className="chat-session-agent-avatar-logo"
              />
            ) : undefined
          }
          expanded
          iconContainerClassName={cn(
            'chat-session-message-avatar',
            isUser ? 'is-user' : 'chat-session-agent-avatar'
          )}
          iconContainerStyle={agentAvatarStyle}
          iconClassName={
            isUser ? 'chat-session-message-avatar-icon' : undefined
          }
headerRight={
            isUser ? (
              <div className="chat-session-message-meta flex items-center gap-half text-xs text-low">
                <span>{formatDateShortWithTime(message.created_at)}</span>
              </div>
            ) : null
          }
          className={cn(
            'chat-session-message-card max-w-full shadow-sm rounded-3xl',
            isUser
              ? 'w-[600px] chat-session-message-card-self is-user-message ml-auto'
              : 'chat-session-message-card-agent is-agent-message',
            isCleanupMode && isSelected && 'ring-2 ring-[#EF4444]'
          )}
          headerClassName={cn(
            'chat-session-message-header',
            isUser && 'hidden'
          )}
          bodyClassName="chat-session-message-body"
          style={{
            backgroundColor: isUser
              ? 'var(--chat-session-message-self-bg)'
              : 'var(--chat-session-glass-bg)',
            borderColor:
              isCleanupMode && isSelected
                ? '#EF4444'
                : isUser
                  ? 'var(--chat-session-message-self-border)'
                  : 'var(--chat-session-glass-border)',
          }}
        >
          <div>
            {referenceId && (
              <div className="chat-session-reference-card mb-half border rounded-sm px-base py-half text-xs text-low" style={{ backgroundColor: '#ecedf1', borderColor: 'var(--chat-session-message-self-bg, #e8f4fd)' }}>
                <div className="flex items-center justify-between gap-base">
                  <span className="font-medium text-normal">
                    {t('message.replyingTo', {
                      name: referenceSenderLabel ?? 'message',
                    })}
                  </span>
                  <button
                    type="button"
                    className="hover:opacity-80"
                    style={{ color: '#5094FB' }}
                    onClick={() => {
                      if (referenceMessage) {
                        const element = document.getElementById(
                          `chat-message-${referenceMessage.id}`
                        );
                        element?.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                  >
                    {t('message.view')}
                  </button>
                </div>
                <div className="mt-half">
                  {referencePreview ??
                    t('message.referencedMessageUnavailable')}
                </div>
                {referenceMessage &&
                  extractAttachments(referenceMessage.meta).length > 0 && (
                    <div className="mt-half text-xs text-low">
                      {t('message.attachments')}:{' '}
                      {extractAttachments(referenceMessage.meta)
                        .map((item) => item.name)
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(', ')}
                    </div>
                  )}
              </div>
            )}
            {(() => {
              const apiError = isAgent ? detectApiError(message.content) : null;
              const isWarningApiError =
                apiError?.type === 'quota_exceeded' ||
                apiError?.type === 'rate_limit' ||
                apiError?.type === 'context_limit';
              return apiError ? (
                <div
                  className={cn(
                    'mb-half flex items-center gap-half rounded-sm border px-base py-half text-xs',
                    isWarningApiError
                      ? 'bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.35)] text-[#F59E0B]'
                      : 'bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.35)] text-[#EF4444]'
                  )}
                >
                  {isWarningApiError ? (
                    <WarningCircleIcon
                      className="size-icon-sm flex-shrink-0"
                      weight="fill"
                    />
                  ) : (
                    <XCircleIcon
                      className="size-icon-sm flex-shrink-0"
                      weight="fill"
                    />
                  )}
                  <span className="font-medium">{apiError.message}</span>
                  <span
                    className={
                      isWarningApiError
                        ? 'text-[rgba(245,158,11,0.78)]'
                        : 'text-[rgba(239,68,68,0.78)]'
                    }
                  >
                    - {t('message.apiError.checkQuota')}
                  </span>
                </div>
              ) : null;
            })()}
            <ChatMarkdown content={displayContent} hideCopyButton />
            {mentionList.length > 0 && (
              <div className="chat-session-mentions mt-half flex flex-wrap items-center gap-half text-xs text-low">
                {mentionList.map((mention) => {
                  const agentId = agentIdByName.get(mention);
                  const mentionStatus = mentionStatusMap?.get(mention);
                  const isFallbackRunning =
                    !mentionStatusMap &&
                    !!agentId &&
                    agentStates[agentId] === ChatSessionAgentState.running;
                  const isRunning =
                    mentionStatus === 'running' || isFallbackRunning;
                  const isCompleted = mentionStatus === 'completed';
                  const isFailed = mentionStatus === 'failed';
                  const showCheck = !isFailed && (isRunning || isCompleted);
                  const pulse = mentionStatus === 'running';
                  return (
                    <Badge
                      key={`${message.id}-mention-${mention}`}
                      variant="secondary"
                      className="chat-session-mention-tag flex items-center gap-1 px-2 py-0.5 text-xs"
                    >
                      @{mention}
                      {showCheck && (
                        <CheckCircleIcon
                          className={cn(
                            'size-icon-2xs text-success',
                            pulse && 'animate-pulse'
                          )}
                          weight="fill"
                        />
                      )}
                      {isFailed && (
                        <XCircleIcon
                          className="size-icon-2xs text-error"
                          weight="fill"
                        />
                      )}
                    </Badge>
                  );
                })}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="chat-session-attachments mt-half space-y-half">
                {attachments.map((attachment) => {
                  const attachmentUrl =
                    activeSessionId && attachment.id
                      ? chatApi.getChatAttachmentUrl(
                          activeSessionId,
                          message.id,
                          attachment.id
                        )
                      : '#';
                  const isImage =
                    attachment.kind === 'image' ||
                    (attachment.mime_type ?? '').startsWith('image/');
                  const isHtml =
                    (attachment.mime_type ?? '').includes('html') ||
                    attachment.name.toLowerCase().endsWith('.html') ||
                    attachment.name.toLowerCase().endsWith('.htm');
                  const canPreviewInline = isImage || isHtml;
                  return (
                    <div
                      key={attachment.id}
                      className="chat-session-attachment-card border border-border rounded-sm bg-panel px-base py-half text-xs text-normal"
                    >
                      <div className="flex items-center justify-between gap-base">
                        {canPreviewInline ? (
                          <button
                            type="button"
                            className="chat-session-attachment-name-btn font-ibm-plex-mono break-all text-left"
                            onClick={() =>
                              onPreviewAttachment(message, attachment)
                            }
                          >
                            {attachment.name}
                          </button>
                        ) : (
                          <span className="font-ibm-plex-mono break-all">
                            {attachment.name}
                          </span>
                        )}
                        <div className="flex gap-half">
                          <button
                            type="button"
                            className="text-brand hover:text-brand-hover px-1 py-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddAttachmentAsFile(message.id, attachment);
                            }}
                            title={t('message.sendToAgent')}
                          >
                            <PaperPlaneTiltIcon className="size-icon-sm" />
                          </button>
                          {canPreviewInline && (
                            <button
                              type="button"
                              className="text-brand hover:text-brand-hover"
                              onClick={() =>
                                onPreviewAttachment(message, attachment)
                              }
                            >
                              {t('message.view')}
                            </button>
                          )}
                          <a
                            className="text-brand hover:text-brand-hover"
                            href={attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('message.open')}
                          </a>
                        </div>
                      </div>
                      {attachment.size_bytes && (
                        <div className="text-xs text-low">
                          {formatBytes(attachment.size_bytes)}
                        </div>
                      )}
                      {isImage && attachmentUrl !== '#' && (
                        <img
                          src={attachmentUrl}
                          alt={attachment.name}
                          loading="lazy"
                          className="mt-half max-h-56 w-auto rounded-sm border border-border"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {isAgent && (
              <div className="chat-session-message-footer mt-4 flex items-center justify-between opacity-50 text-[10px] font-ibm-plex-mono">
                {tokenCount !== null && (
                  <span>
                    {isEstimated && (
                      <span className="text-yellow-500 mr-0.5">~</span>
                    )}
                    Tokens: {formatTokenCount(tokenCount)}
                  </span>
                )}
                <span className={tokenCount !== null ? '' : 'ml-auto'}>
                  {formatDateShortWithTime(message.created_at)}
                </span>
              </div>
            )}
          </div>
        </ChatEntryContainer>
        {(isAgent || isUser) && (
          <div
            className={cn(
              'chat-session-message-actions absolute opacity-0 group-hover:opacity-100 flex items-center gap-2 -bottom-8 transition-opacity duration-200',
              isAgent ? 'left-0' : 'right-0'
            )}
          >
            <button
              type="button"
              className="p-1.5 rounded text-low hover:bg-[rgba(168,201,255,0.16)] transition-colors"
              onClick={() => {
                navigator.clipboard.writeText(message.content);
              }}
              title={t('message.copy')}
            >
              <CopyIcon className="size-icon-xs" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded text-low hover:bg-[rgba(168,201,255,0.16)] transition-colors"
              title={t('message.regenerate')}
            >
              <ArrowClockwiseIcon className="size-icon-xs" />
            </button>
            <button
              type="button"
              className={cn(
                'p-1.5 rounded text-low hover:bg-[rgba(168,201,255,0.16)] transition-colors',
                isArchived && 'pointer-events-none opacity-50'
              )}
              onClick={() => onReply(message)}
              disabled={isArchived}
              title={t('message.quote')}
            >
              <QuotesIcon className="size-icon-xs" />
            </button>
          </div>
        )}
      </div>
        {isCleanupMode && isUser && (
          <button
            type="button"
            className="flex-shrink-0 mt-1"
            onClick={onToggleSelect}
          >
            {isSelected ? (
              <CheckSquareIcon className="size-icon text-brand" weight="fill" />
            ) : (
              <SquareIcon className="size-icon text-low" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
