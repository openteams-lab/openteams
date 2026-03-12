import { useState } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
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
  const thinkingContent = run?.thinkingContent ?? '';
  const assistantContent = run?.assistantContent || run?.content || '';
  const hasThinking = thinkingContent.trim().length > 0;
  const hasAssistant = assistantContent.trim().length > 0;

  return (
    <div className="chat-session-message-row is-agent flex justify-start">
      <div className="relative w-full max-w-[680px] overflow-hidden rounded-2xl p-[1px]">
        <div className="absolute inset-[-50%] animate-spin-slow" style={{ background: 'conic-gradient(from 0deg, transparent, #8BBEFF, transparent 30%)' }} />
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
            backgroundColor: 'var(--chat-session-glass-bg, rgba(255, 255, 255, 0.78))',
            borderColor: 'var(--chat-session-glass-border, rgba(255, 255, 255, 0.52))',
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
                  <span>{thinkingExpanded ? t('collapse') : t('expand')}</span>
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
                    {thinkingContent}
                  </pre>
                </div>
              )}
            </div>
          )}

          {hasAssistant && (
            <ChatMarkdown content={assistantContent} textClassName="text-sm" />
          )}
        </div>
        </ChatEntryContainer>
      </div>
    </div>
  );
}
