import { ChatsTeardropIcon, PlusIcon } from '@phosphor-icons/react';
import type { ChatSession } from 'shared/types';
import { cn } from '@/lib/utils';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { formatDateShortWithTime } from '@/utils/date';

export interface SessionListSidebarProps {
  activeSessions: ChatSession[];
  archivedSessions: ChatSession[];
  activeSessionId: string | null;
  showArchived: boolean;
  onToggleArchived: () => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  isCreating: boolean;
  width: number;
}

export function SessionListSidebar({
  activeSessions,
  archivedSessions,
  activeSessionId,
  showArchived,
  onToggleArchived,
  onSelectSession,
  onCreateSession,
  isCreating,
  width,
}: SessionListSidebarProps) {
  return (
    <aside
      className="border-r border-border flex flex-col min-h-0 shrink-0 bg-white"
      style={{ width }}
    >
      <div className="px-base py-base border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-half text-normal font-medium">
          <ChatsTeardropIcon className="size-icon-sm" />
          <span>Chat Groups</span>
        </div>
        <PrimaryButton
          variant="secondary"
          value="New"
          onClick={onCreateSession}
          disabled={isCreating}
        >
          <PlusIcon className="size-icon-xs" />
        </PrimaryButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-base space-y-half">
        {activeSessions.length === 0 && archivedSessions.length === 0 && (
          <div className="text-sm text-low">
            No sessions yet. Create your first group chat.
          </div>
        )}
        {activeSessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={cn(
                'w-full text-left rounded-sm border px-base py-half',
                isActive
                  ? 'border-brand bg-brand/10 text-normal'
                  : 'border-transparent hover:border-border hover:bg-secondary text-low'
              )}
            >
              <div className="flex items-center justify-between gap-base">
                <span className="text-sm font-medium truncate text-normal">
                  {session.title || 'Untitled session'}
                </span>
                <span className="text-xs text-low">
                  {formatDateShortWithTime(session.updated_at)}
                </span>
              </div>
            </button>
          );
        })}
        {archivedSessions.length > 0 && (
          <div className="pt-base mt-base border-t border-border space-y-half">
            <button
              type="button"
              onClick={onToggleArchived}
              className="text-xs text-low uppercase tracking-wide hover:text-normal"
            >
              {showArchived ? 'Hide Archived' : 'Show Archived'} (
              {archivedSessions.length})
            </button>
            {showArchived &&
              archivedSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className={cn(
                      'w-full text-left rounded-sm border px-base py-half',
                      isActive
                        ? 'border-brand bg-brand/10 text-normal'
                        : 'border-transparent hover:border-border hover:bg-secondary text-low'
                    )}
                  >
                    <div className="flex items-center justify-between gap-base">
                      <span className="text-sm font-medium truncate text-normal">
                        {session.title || 'Untitled session'}
                      </span>
                      <span className="text-xs text-low">
                        {formatDateShortWithTime(session.updated_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </aside>
  );
}
