import {
  PencilSimpleIcon,
  TrashIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import type { ChatSession } from 'shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { formatDateShortWithTime } from '@/utils/date';

export interface ChatHeaderProps {
  activeSession: ChatSession | null;
  messageCount: number;
  memberCount: number;
  isArchived: boolean;
  // Title editing
  isEditingTitle: boolean;
  titleDraft: string;
  titleError: string | null;
  isSavingTitle: boolean;
  onStartEditTitle: () => void;
  onTitleDraftChange: (value: string) => void;
  onSaveTitle: () => void;
  onCancelTitleEdit: () => void;
  // Session actions
  onDeleteSession: () => void;
  onArchive: () => void;
  onRestore: () => void;
  isArchiving: boolean;
  // Cleanup mode
  isCleanupMode: boolean;
  onToggleCleanupMode: () => void;
  isDeletingMessages: boolean;
}

export function ChatHeader({
  activeSession,
  messageCount,
  memberCount,
  isArchived,
  isEditingTitle,
  titleDraft,
  titleError,
  isSavingTitle,
  onStartEditTitle,
  onTitleDraftChange,
  onSaveTitle,
  onCancelTitleEdit,
  onDeleteSession,
  onArchive,
  onRestore,
  isArchiving,
  isCleanupMode,
  onToggleCleanupMode,
  isDeletingMessages,
}: ChatHeaderProps) {
  return (
    <header className="px-base py-half border-b border-border flex items-center justify-between">
      <div className="min-w-0">
        {!isEditingTitle && (
          <div className="flex items-center gap-half">
            <div className="text-sm text-normal font-medium truncate">
              {activeSession?.title || 'Untitled session'}
            </div>
            {activeSession && (
              <>
                <button
                  type="button"
                  className="text-low hover:text-normal"
                  onClick={onStartEditTitle}
                  aria-label="Edit session name"
                >
                  <PencilSimpleIcon className="size-icon-xs" />
                </button>
                <button
                  type="button"
                  className="text-low hover:text-error"
                  onClick={onDeleteSession}
                  aria-label="Delete session"
                  title="Delete session"
                >
                  <TrashIcon className="size-icon-xs" />
                </button>
              </>
            )}
          </div>
        )}
        {isEditingTitle && (
          <div className="flex items-center gap-half flex-wrap">
            <input
              value={titleDraft}
              onChange={(event) => onTitleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSaveTitle();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelTitleEdit();
                }
              }}
              placeholder="Session name"
              disabled={isSavingTitle}
              className={cn(
                'w-[240px] max-w-full rounded-sm border border-border bg-panel px-base py-half',
                'text-sm text-normal focus:outline-none focus:ring-1 focus:ring-brand'
              )}
            />
            <PrimaryButton
              value="Save"
              onClick={onSaveTitle}
              disabled={isSavingTitle}
            />
            <PrimaryButton
              variant="tertiary"
              value="Cancel"
              onClick={onCancelTitleEdit}
              disabled={isSavingTitle}
            />
          </div>
        )}
        {titleError && (
          <div className="text-xs text-error">{titleError}</div>
        )}
        {activeSession && (
          <div className="text-xs text-low">
            Created {formatDateShortWithTime(activeSession.created_at)} /
            Total messages: {messageCount}
          </div>
        )}
      </div>
      <div className="flex items-center gap-base">
        <div className="flex items-center gap-base text-xs text-low">
          <UsersIcon className="size-icon-xs" />
          <span>{memberCount} AI members</span>
        </div>
        {activeSession && (
          <div className="flex items-center gap-half">
            {isArchived && (
              <Badge variant="secondary" className="text-xs">
                Archived
              </Badge>
            )}
            <PrimaryButton
              variant="tertiary"
              value={isArchived ? 'Restore' : 'Archive'}
              onClick={isArchived ? onRestore : onArchive}
              disabled={isArchiving}
            />
            {!isArchived && (
              <PrimaryButton
                variant={isCleanupMode ? 'default' : 'secondary'}
                value={isCleanupMode ? 'Exit Cleanup' : 'Cleanup'}
                onClick={onToggleCleanupMode}
                disabled={isDeletingMessages}
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
