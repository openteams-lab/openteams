import { cn } from '@/lib/utils';
import { ChatEntryContainer } from '@/components/ui-new/primitives/conversation/ChatEntryContainer';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import type { ChatSessionAgent } from 'shared/types';
import type { StreamRun, MessageTone } from '../types';

export interface StreamingRunEntryProps {
  runId: string;
  run: StreamRun;
  agentName: string;
  tone: MessageTone;
  sessionAgent: ChatSessionAgent | undefined;
  isStopping: boolean;
  onStop: (sessionAgentId: string, agentId: string) => void;
}

export function StreamingRunEntry({
  runId,
  run,
  agentName,
  tone,
  sessionAgent,
  isStopping,
  onStop,
}: StreamingRunEntryProps) {
  return (
    <div key={`stream-${runId}`} className="flex justify-start">
      <ChatEntryContainer
        variant="system"
        title={agentName}
        expanded
        className="max-w-[720px] w-full md:w-[80%] opacity-90 shadow-sm rounded-2xl"
        headerClassName="bg-transparent"
        style={{
          backgroundColor: tone.bg,
          borderColor: tone.border,
        }}
        headerRight={
          <div className="flex items-center gap-base text-xs text-low">
            <span className="flex items-center gap-half">
              <span>工作执行中，请稍等</span>
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
                {isStopping ? '停止中...' : '停止'}
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
