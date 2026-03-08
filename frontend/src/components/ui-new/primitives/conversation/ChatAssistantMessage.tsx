import { ChatMarkdown } from './ChatMarkdown';

interface ChatAssistantMessageProps {
  content: string;
  workspaceId?: string;
}

export function ChatAssistantMessage({
  content,
  workspaceId,
}: ChatAssistantMessageProps) {
  return (
    <div className="rounded-lg border border-border p-double">
      <ChatMarkdown content={content} workspaceId={workspaceId} />
    </div>
  );
}
