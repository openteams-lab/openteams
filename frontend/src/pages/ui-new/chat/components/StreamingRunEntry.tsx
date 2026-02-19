import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import type { ChatSessionAgent } from 'shared/types';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import type { StreamRun, MessageTone } from '../types';

export interface StreamingRunEntryProps {
  runId: string;
  run: StreamRun;
  agentName: string;
  runnerType: string | null;
  tone: MessageTone;
  sessionAgent: ChatSessionAgent | undefined;
  isStopping: boolean;
  onStop: (sessionAgentId: string, agentId: string) => void;
}

export function StreamingRunEntry({
  runId,
  run,
  agentName,
  runnerType,
  tone,
  sessionAgent,
  isStopping,
  onStop,
}: StreamingRunEntryProps) {
  const { t } = useTranslation('chat');
  const avatarSeed = getAgentAvatarSeed(
    run.agentId,
    runnerType,
    agentName
  );
  const assistantContent = run.assistantContent || run.content;
  const hasThinking = run.thinkingContent.trim().length > 0;
  const hasAssistant = assistantContent.trim().length > 0;

  return (
    <div key={`stream-${runId}`} className="chat-session-message-row is-agent flex justify-start">
      <ChatEntryContainer
        variant="system"
        title={agentName}
        icon={
          <AgentBrandIcon
            runnerType={runnerType}
            className="chat-session-agent-avatar-logo"
          />
        }
        expanded
        iconContainerClassName="chat-session-message-avatar chat-session-agent-avatar"
        iconContainerStyle={getAgentAvatarStyle(avatarSeed)}
        className="chat-session-message-card chat-session-message-card-agent max-w-[760px] w-full md:w-[84%] opacity-90 shadow-sm rounded-2xl"
        headerClassName="chat-session-message-header"
        bodyClassName="chat-session-message-body"
        style={{
          backgroundColor: `var(--chat-session-message-other-bg, ${tone.bg})`,
          borderColor: `var(--chat-session-message-other-border, ${tone.border})`,
        }}
        headerRight={
          <div className="flex items-center gap-base text-xs text-low">
            <span className="flex items-center gap-half">
              <span>{t('agent.running')}</span>
              <span className="flex items-center gap-[2px]">
                <span className="size-dot rounded-full bg-brand animate-running-dot-1" />
                <span className="size-dot rounded-full bg-brand animate-running-dot-2" />
                <span className="size-dot rounded-full bg-brand animate-running-dot-3" />
              </span>
            </span>
            {sessionAgent && (
              <button
                type="button"
                className={cn(
                  'text-error hover:text-error/80',
                  isStopping && 'opacity-50 cursor-not-allowed'
                )}
                onClick={() =>
                  onStop(sessionAgent.id, run.agentId)
                }
                disabled={isStopping}
              >
                {isStopping ? t('agent.stopping') : t('agent.stop')}
              </button>
            )}
          </div>
        }
      >
        {hasThinking && (
          <div className="mb-base rounded-lg border border-border bg-secondary/40 px-base py-half">
            <div className="mb-half text-xs text-low">{t('agent.thinking')}</div>
            <ChatMarkdown content={run.thinkingContent} />
          </div>
        )}
        {hasAssistant ? (
          <ChatMarkdown content={assistantContent} />
        ) : (
          <div className="text-xs text-low">{t('agent.processing')}</div>
        )}
      </ChatEntryContainer>
    </div>
  );
}
