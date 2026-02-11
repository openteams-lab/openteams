import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
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

  return (
    <div className="flex justify-start">
      <ChatEntryContainer
        variant="system"
        title={member.agent.name}
        expanded
        className="max-w-[720px] w-full md:w-[80%] opacity-80 shadow-sm rounded-2xl"
        headerClassName="bg-transparent"
        style={{
          backgroundColor: tone.bg,
          borderColor: tone.border,
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
            {isStopping ? '停止中...' : '停止'}
          </button>
        }
      >
        <div className="text-sm text-low">
          工作执行中，请稍等... 已用{elapsedSeconds}秒
        </div>
      </ChatEntryContainer>
    </div>
  );
}
