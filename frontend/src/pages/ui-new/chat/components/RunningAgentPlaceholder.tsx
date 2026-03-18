import { useState } from 'react';
import { CaretDownIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatErrorMessage } from '@/components/ui-new/primitives/conversation/ChatErrorMessage';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import type {
  SessionMember,
  AgentStateInfo,
  MessageTone,
  StreamRun,
} from '../types';

export interface RunningAgentPlaceholderProps {
  member: SessionMember;
  run?: StreamRun;
  tone: MessageTone;
  stateInfo: AgentStateInfo | undefined;
  clock: number;
  isStopping: boolean;
  onStop: (sessionAgentId: string, agentId: string) => void;
}

export function RunningAgentPlaceholder({
  member,
  run,
  stateInfo,
  clock,
  isStopping,
  onStop,
}: RunningAgentPlaceholderProps) {
  const { t } = useTranslation('chat');
  const [thinkingExpanded, setThinkingExpanded] = useState(true);
  const startedAtStr = stateInfo?.startedAt;
  const startedAtMs = startedAtStr ? new Date(startedAtStr).getTime() : clock;
  const elapsedSeconds = Math.max(0, Math.floor((clock - startedAtMs) / 1000));
  const avatarSeed = getAgentAvatarSeed(
    member.agent.id,
    member.agent.runner_type,
    member.agent.name
  );
  const displayThinkingContent = (run?.thinkingContent ?? '').trim();
  const displayAssistantContent = (
    run?.assistantContent || run?.content || ''
  ).trim();
  const displayUnifiedContent = [
    displayThinkingContent,
    displayAssistantContent.length > 0 &&
    displayAssistantContent !== displayThinkingContent
      ? displayAssistantContent
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const hasThinking = displayUnifiedContent.length > 0;
  const hasError = (run?.errorContent ?? '').trim().length > 0;

  return (
    <div className="chat-session-message-row is-agent flex justify-start">
      <div className="relative w-full max-w-[680px] overflow-hidden rounded-2xl p-[1px]">
        <div
          className="absolute inset-[-50%] animate-spin-slow"
          style={{
            background:
              'conic-gradient(from 0deg, transparent, #8BBEFF, transparent 30%)',
          }}
        />
        <ChatEntryContainer
          variant="system"
          title={member.agent.name}
          icon={
            <AgentBrandIcon
              runnerType={member.agent.runner_type}
              className="chat-session-agent-avatar-logo"
            />
          }
          expanded
          iconContainerClassName="chat-session-message-avatar chat-session-agent-avatar"
          iconContainerStyle={getAgentAvatarStyle(avatarSeed)}
          className="chat-session-message-card chat-session-message-card-agent is-agent-message is-running shadow-sm rounded-2xl relative"
          headerClassName="chat-session-message-header"
          bodyClassName="chat-session-message-body"
          style={{
            backgroundColor:
              'var(--chat-session-glass-bg, rgba(255, 255, 255, 0.78))',
            borderColor:
              'var(--chat-session-glass-border, rgba(255, 255, 255, 0.52))',
          }}
          headerRight={
            <div className="flex items-center gap-2">
              <div className="chat-session-running-indicator" />
              <button
                type="button"
                className={cn(
                  'chat-session-stop-btn',
                  isStopping && 'opacity-50 cursor-not-allowed'
                )}
                onClick={() => onStop(member.sessionAgent.id, member.agent.id)}
                disabled={isStopping}
              >
                {isStopping ? t('agent.stopping') : t('agent.stop')}
              </button>
            </div>
          }
        >
          <div className="space-y-base">
            <div className="text-sm text-low">
              {t('agent.runningElapsed', { seconds: elapsedSeconds })}
            </div>

            {hasThinking && (
              <div className="rounded-lg border border-border/50 bg-[#f9fafb] p-3">
                <div className="mb-2.5 flex items-center justify-between text-xs font-medium text-low uppercase tracking-wide">
                  <span>{t('agent.thinking')}</span>
                  <button
                    type="button"
                    className="flex items-center gap-1"
                    onClick={() =>
                      setThinkingExpanded((prevExpanded) => !prevExpanded)
                    }
                    aria-expanded={thinkingExpanded}
                    aria-label={t('agent.thinking')}
                  >
                    <span>
                      {thinkingExpanded ? t('collapse') : t('expand')}
                    </span>
                    <CaretDownIcon
                      className={cn(
                        'size-3 transition-transform',
                        !thinkingExpanded && '-rotate-90'
                      )}
                    />
                  </button>
                </div>
                {thinkingExpanded && (
                  <div className="rounded-[4px_8px_8px_4px] border-l-[3px] border-l-[#5094FB] bg-white px-4 py-3 shadow-sm">
                    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-ibm-plex-mono text-xs leading-relaxed text-low">
                      {displayUnifiedContent}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {hasError && (
              <div className="rounded-lg border border-error/50 bg-error/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#EF4444] uppercase tracking-wide">
                  <WarningCircleIcon className="size-3.5" weight="fill" />
                  <span>{t('agent.error', { defaultValue: 'Error' })}</span>
                </div>
                <div className="rounded-[4px_8px_8px_4px] border-l-[3px] border-l-error/70 bg-white px-4 py-3 shadow-sm">
                  <ChatErrorMessage
                    content={run?.errorContent ?? ''}
                    expanded
                    tone="error"
                  />
                </div>
              </div>
            )}
          </div>
        </ChatEntryContainer>
      </div>
    </div>
  );
}
