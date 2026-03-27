import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { cn } from '@/lib/utils';
import { useChangesView } from '@/contexts/ChangesViewContext';

interface ChatMarkdownProps {
  content: string;
  maxWidth?: string;
  className?: string;
  textClassName?: string;
  workspaceId?: string;
  hideCopyButton?: boolean;
  allowFileLinks?: boolean;
  readOnlyLinkBasePath?: string | null;
}

export function ChatMarkdown({
  content,
  maxWidth = '800px',
  className,
  textClassName = 'text-sm',
  workspaceId,
  hideCopyButton,
  allowFileLinks = false,
  readOnlyLinkBasePath = null,
}: ChatMarkdownProps) {
  const { viewFileInChanges, findMatchingDiffPath } = useChangesView();

  return (
    <div className={className} style={{ maxWidth }}>
      <WYSIWYGEditor
        value={content}
        disabled
        className={cn('whitespace-pre-wrap break-words', textClassName)}
        taskAttemptId={workspaceId}
        findMatchingDiffPath={findMatchingDiffPath}
        onCodeClick={viewFileInChanges}
        hideCopyButton={hideCopyButton}
        allowFileLinks={allowFileLinks}
        readOnlyLinkBasePath={readOnlyLinkBasePath}
      />
    </div>
  );
}
