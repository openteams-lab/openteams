import { ChatDotsIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from './ChatMarkdown';

interface ChatThinkingMessageProps {
  content: string;
  className?: string;
  taskAttemptId?: string;
}

export function ChatThinkingMessage({
  content,
  className,
  taskAttemptId,
}: ChatThinkingMessageProps) {
  return (
    <div
      className={cn('flex items-start gap-base text-sm text-low', className)}
    >
      <ChatDotsIcon className="shrink-0 size-icon-base mt-0.5" />
      <div className="max-h-[150px] overflow-y-auto">
        <ChatMarkdown content={content} workspaceId={taskAttemptId} />
      </div>
    </div>
  );
}
