import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import type { ChatSessionAgent } from 'shared/types';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../avatar';
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
  const avatarSeed = getAgentAvatarSeed(
    run.agentId,
    runnerType,
    agentName
  );

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
              <span>Agent is running</span>
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
                {isStopping ? 'Stopping...' : 'Stop'}
              </button>
            )}
          </div>
        }
      >
        <ChatMarkdown content={run.content} />
      </ChatEntryContainer>
    </div>
  );
}
