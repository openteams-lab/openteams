import { useEffect, useRef } from 'react';
import {
  ArrowCounterClockwiseIcon,
  BoxArrowDownIcon,
  BroomIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ChatSession } from 'shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui-new/primitives/Dropdown';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { formatDateShortWithTime } from '@/utils/date';
import { formatTokenCount } from '@/utils/string';

export interface ChatHeaderProps {
  activeSession: ChatSession | null;
  displayTitle: string;
  isGeneratedTitle: boolean;
  messageCount: number;
  totalTokens?: number;
  isSearchOpen: boolean;
  searchQuery: string;
  onCloseSearch: () => void;
  onSearchQueryChange: (value: string) => void;
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
  displayTitle,
  isGeneratedTitle,
  messageCount,
  totalTokens,
  isSearchOpen,
  searchQuery,
  onCloseSearch,
  onSearchQueryChange,
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
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isSearchOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (searchInputContainerRef.current?.contains(target)) {
        return;
      }

      onCloseSearch();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isSearchOpen, onCloseSearch]);

  return (
    <header className="chat-session-header border-b border-border">
      <div className="chat-session-header-shell flex items-center justify-between gap-base">
        <div className="chat-session-header-main min-w-0">
          {!isEditingTitle && (
            <>
              <div className="chat-session-header-title-row flex items-center gap-half flex-wrap">
                <div className="chat-session-header-title text-sm text-normal font-medium truncate">
                  {displayTitle}
                </div>
                {activeSession && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="chat-session-header-more-trigger"
                        aria-label={t('header.moreActions')}
                        title={t('header.moreActions')}
                      >
                        <DotsThreeIcon
                          className="chat-session-header-more-trigger-icon"
                          weight="bold"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="bottom"
                      sideOffset={10}
                      className="chat-session-header-more-menu w-[280px]"
                    >
                      <DropdownMenuItem
                        icon={PencilSimpleIcon}
                        className="chat-session-header-menu-item"
                        onSelect={onStartEditTitle}
                      >
                        {t('header.editSessionName')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        icon={
                          isArchived
                            ? ArrowCounterClockwiseIcon
                            : BoxArrowDownIcon
                        }
                        className="chat-session-header-menu-item"
                        onSelect={isArchived ? onRestore : onArchive}
                        disabled={isArchiving}
                      >
                        {isArchived
                          ? t('header.restoreSession')
                          : t('header.archiveSession')}
                      </DropdownMenuItem>
                      {!isArchived && (
                        <DropdownMenuItem
                          icon={BroomIcon}
                          className={cn(
                            'chat-session-header-menu-item',
                            isCleanupMode && 'is-active'
                          )}
                          onSelect={onToggleCleanupMode}
                          disabled={isDeletingMessages}
                        >
                          {isCleanupMode
                            ? t('header.exitCleanupMode')
                            : t('header.cleanupMessages')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator className="chat-session-header-menu-separator" />
                      <DropdownMenuItem
                        icon={TrashIcon}
                        variant="destructive"
                        className="chat-session-header-menu-item chat-session-header-menu-item-danger"
                        onSelect={onDeleteSession}
                      >
                        {t('header.deleteSession')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {isGeneratedTitle && (
                  <span className="chat-session-header-generated-badge">
                    {t('header.generatedTitleBadge')}
                  </span>
                )}
              </div>
              {activeSession && (
                <div className="chat-session-header-insights">
                  <span className="chat-session-header-meta-pill">
                    {t('header.created')}{' '}
                    {formatDateShortWithTime(activeSession.created_at)}
                  </span>
                  <span className="chat-session-header-meta-pill">
                    {t('header.totalMessages')}: {messageCount}
                  </span>
                  {totalTokens !== undefined && totalTokens > 0 && (
                    <span className="chat-session-header-meta-pill">
                      {t('header.tokenUsage', {
                        value: formatTokenCount(totalTokens),
                      })}
                    </span>
                  )}
                </div>
              )}
            </>
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
                placeholder={t('header.sessionNamePlaceholder')}
                disabled={isSavingTitle}
                className={cn(
                  'w-[240px] max-w-full rounded-sm px-base py-half',
                  'chat-session-header-input',
                  'text-sm text-normal focus:outline-none'
                )}
              />
              <PrimaryButton
                value={tCommon('buttons.save')}
                onClick={onSaveTitle}
                disabled={isSavingTitle}
                className="chat-session-header-btn"
              />
              <PrimaryButton
                variant="tertiary"
                value={tCommon('buttons.cancel')}
                onClick={onCancelTitleEdit}
                disabled={isSavingTitle}
                className="chat-session-header-btn chat-session-header-cancel-btn"
              />
            </div>
          )}
          {titleError && <div className="text-xs text-error">{titleError}</div>}
        </div>
        <div className="chat-session-header-actions flex items-center gap-base">
          {activeSession && isSearchOpen && (
            <div
              ref={searchInputContainerRef}
              className="chat-session-header-search flex items-center gap-half"
            >
              <div className="chat-session-header-search-input-wrap">
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onCloseSearch();
                    }
                  }}
                  placeholder={t('header.searchMessages')}
                  className={cn(
                    'chat-session-header-search-input',
                    'px-base py-half text-sm text-normal focus:outline-none'
                  )}
                  aria-label={t('header.searchMessages')}
                />
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    className="chat-session-header-search-clear-btn"
                    onClick={() => {
                      onSearchQueryChange('');
                      searchInputRef.current?.focus();
                    }}
                    aria-label={t('header.clearSearch')}
                    title={t('header.clearSearch')}
                  >
                    <XIcon className="size-icon-2xs" weight="bold" />
                  </button>
                )}
              </div>
            </div>
          )}
          {activeSession && isArchived && (
            <Badge
              variant="secondary"
              className="chat-session-archived-badge text-xs"
            >
              {t('header.archived')}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
