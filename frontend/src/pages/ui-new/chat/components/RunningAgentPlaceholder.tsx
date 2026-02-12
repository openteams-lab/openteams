import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../avatar';
import type { SessionMember, AgentStateInfo, MessageTone } from '../types';

export interface RunningAgentPlaceholderProps {
  member: SessionMember;
  tone: MessageTone;
  stateInfo: AgentStateInfo | undefined;
  clock: number;
  isStopping: boolean;
  onStop: (sessionAgentId: string, agentId: string) => void;
}

export function RunningAgentPlaceholder({
  member,
  tone,
  stateInfo,
  clock,
  isStopping,
  onStop,
}: RunningAgentPlaceholderProps) {
  const startedAtStr = stateInfo?.startedAt;
  const startedAtMs = startedAtStr
    ? new Date(startedAtStr).getTime()
    : clock;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((clock - startedAtMs) / 1000)
  );
  const avatarSeed = getAgentAvatarSeed(
    member.agent.id,
    member.agent.runner_type,
    member.agent.name
  );

  return (
    <div className="chat-session-message-row is-agent flex justify-start">
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
        className="chat-session-message-card chat-session-message-card-agent max-w-[760px] w-full md:w-[84%] opacity-80 shadow-sm rounded-2xl"
        headerClassName="chat-session-message-header"
        bodyClassName="chat-session-message-body"
        style={{
          backgroundColor: `var(--chat-session-message-other-bg, ${tone.bg})`,
          borderColor: `var(--chat-session-message-other-border, ${tone.border})`,
        }}
        headerRight={
          <button
            type="button"
            className={cn(
              'text-xs text-error hover:text-error/80',
              isStopping && 'opacity-50 cursor-not-allowed'
            )}
            onClick={() =>
              onStop(member.sessionAgent.id, member.agent.id)
            }
            disabled={isStopping}
          >
            {isStopping ? 'Stopping...' : 'Stop'}
          </button>
        }
      >
        <div className="text-sm text-low">
          Agent is running. Elapsed {elapsedSeconds}s.
        </div>
      </ChatEntryContainer>
    </div>
  );
}
