import { useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  BoxArrowDownIcon,
  BroomIcon,
  ChatCircleDotsIcon,
  ClockIcon,
  FileArchiveIcon,
  GearSixIcon,
  ListIcon,
  PencilSimpleIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ChatSession } from 'shared/types';
import { ChatSessionStatus } from 'shared/types';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui-new/primitives/Dropdown';
import { formatRelativeDateWithI18n } from '@/utils/date';

const MAX_SESSION_TITLE_LENGTH = 20;

export interface SessionListSidebarProps {
  activeSessions: ChatSession[];
  archivedSessions: ChatSession[];
  activeSessionId: string | null;
  unreadSessionIds: Set<string>;
  showArchived: boolean;
  onToggleArchived: () => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  isCreating: boolean;
  onOpenAutomation: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
  isSkillsActive?: boolean;
  width: number;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onArchiveSession: (sessionId: string) => void;
  onRestoreSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onEditSessionTitle: (sessionId: string) => void;
  onToggleCleanupMode: (sessionId: string) => void;
  isArchiving: boolean;
  isDeletingMessages: boolean;
}

export function SessionListSidebar({
  activeSessions,
  archivedSessions,
  activeSessionId,
  unreadSessionIds,
  showArchived,
  onToggleArchived,
  onSelectSession,
  onCreateSession,
  isCreating,
  onOpenAutomation,
  onOpenSkills,
  onOpenSettings,
  isSkillsActive = false,
  width,
  isCollapsed,
  onToggleCollapsed,
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onEditSessionTitle,
  onToggleCleanupMode,
  isArchiving,
  isDeletingMessages,
}: SessionListSidebarProps) {
  const { t } = useTranslation('chat');
  const [contextMenuSession, setContextMenuSession] = useState<ChatSession | null>(null);
  const appVersion = __APP_VERSION__.trim();
  const appVersionLabel = appVersion.startsWith('v')
    ? appVersion
    : `v${appVersion}`;
  const collapseActionLabel = isCollapsed
    ? t('sidebar.expandSidebar')
    : t('sidebar.collapseSidebar');

  const getDisplaySessionTitle = (session: ChatSession) => {
    const fallbackTitle = session.title?.trim() || t('sidebar.untitledSession');
    const fullTitle = fallbackTitle;
    if (fullTitle.length <= MAX_SESSION_TITLE_LENGTH) {
      return { fullTitle, displayTitle: fullTitle };
    }
    return {
      fullTitle,
      displayTitle: `${fullTitle.slice(0, MAX_SESSION_TITLE_LENGTH)}...`,
    };
  };

const handleContextMenu = (e: React.MouseEvent, session: ChatSession) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuSession(session);
  };

  const closeContextMenu = () => {
    setContextMenuSession(null);
  };

  const renderSessionItem = (session: ChatSession) => {
    const isActive = session.id === activeSessionId;
    const hasUnread = !isActive && unreadSessionIds.has(session.id);
    const isArchived = session.status === ChatSessionStatus.archived;
    const { fullTitle, displayTitle } = getDisplaySessionTitle(session);
    const summaryPreview = session.summary_text?.trim() ?? '';
    const timeLabel = formatRelativeDateWithI18n(session.updated_at, t);

    return (
      <DropdownMenu
        key={session.id}
        open={contextMenuSession?.id === session.id}
        onOpenChange={(open) => {
          if (!open) closeContextMenu();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={() => onSelectSession(session.id)}
            onContextMenu={(e) => handleContextMenu(e, session)}
            className={cn(
              'chat-session-item w-full text-left',
              isActive && 'active',
              isCollapsed && 'collapsed'
            )}
            title={fullTitle}
          >
        <div className="chat-session-item-inner flex items-center gap-half">
          {isActive ? (
            <span className="chat-session-item-active-dot" aria-hidden="true" />
          ) : hasUnread ? (
            <span className="chat-session-item-unread-dot" aria-hidden="true" />
          ) : isArchived ? (
            <FileArchiveIcon className="chat-session-item-icon size-icon-xs" />
          ) : (
            <ChatCircleDotsIcon className="chat-session-item-icon size-icon-xs" />
          )}
          {!isCollapsed && (
            <div className="chat-session-item-content min-w-0 flex-1">
              <div className="chat-session-item-title-row flex items-center gap-half">
                <div
                  className="chat-session-item-title truncate"
                  title={fullTitle}
                >
                  {displayTitle}
                </div>
                <span className="chat-session-item-time">{timeLabel}</span>
              </div>
              {summaryPreview.length > 0 && (
                <div
                  className="chat-session-item-summary truncate"
                  title={summaryPreview}
                >
                  {summaryPreview}
                </div>
              )}
            </div>
          )}
        </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={4}
          alignOffset={-4}
          className="chat-session-header-more-menu w-[200px]"
        >
          <DropdownMenuItem
            icon={PencilSimpleIcon}
            className="chat-session-header-menu-item"
            onSelect={() => {
              onEditSessionTitle(session.id);
              closeContextMenu();
            }}
          >
            {t('contextMenu.editTitle')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={isArchived ? ArrowCounterClockwiseIcon : BoxArrowDownIcon}
            className="chat-session-header-menu-item"
            onSelect={() => {
              if (isArchived) {
                onRestoreSession(session.id);
              } else {
                onArchiveSession(session.id);
              }
              closeContextMenu();
            }}
            disabled={isArchiving}
          >
            {isArchived ? t('contextMenu.restore') : t('contextMenu.archive')}
          </DropdownMenuItem>
          {!isArchived && (
            <DropdownMenuItem
              icon={BroomIcon}
              className="chat-session-header-menu-item"
              onSelect={() => {
                onToggleCleanupMode(session.id);
                closeContextMenu();
              }}
              disabled={isDeletingMessages}
            >
              {t('contextMenu.cleanupMessages')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="chat-session-header-menu-separator" />
          <DropdownMenuItem
            icon={TrashIcon}
            variant="destructive"
            className="chat-session-header-menu-item chat-session-header-menu-item-danger"
            onSelect={() => {
              onDeleteSession(session.id, fullTitle);
              closeContextMenu();
            }}
          >
            {t('contextMenu.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <aside
      className={cn(
        'chat-session-left border-r flex flex-col min-h-0 shrink-0',
        isCollapsed && 'collapsed'
      )}
      style={{ width }}
    >
      {isCollapsed ? (
        <>
          <div className="chat-session-left-collapsed-shell">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="chat-session-left-control-btn"
              aria-label={collapseActionLabel}
              title={collapseActionLabel}
            >
              <SidebarSimpleIcon className="chat-session-left-control-icon" />
            </button>
          </div>
          <div className="chat-session-left-divider" />
          <div className="chat-session-list chat-session-list-collapsed flex-1 min-h-0 overflow-y-auto p-base space-y-half">
            {activeSessions.length === 0 ? (
              <div className="chat-session-list-empty text-sm text-low">
                {t('sidebar.noActiveSessions')}
              </div>
            ) : (
              activeSessions.map((session) => renderSessionItem(session))
            )}
          </div>
          <div className="chat-session-left-divider" />
          <div className="chat-session-left-footer collapsed">
            <button
              type="button"
              onClick={onOpenSettings}
              className="chat-session-left-settings-btn icon-only"
              aria-label={t('header.settings')}
              title={t('header.settings')}
            >
              <GearSixIcon className="size-icon-xs" />
            </button>
            <div
              className="chat-session-left-version collapsed"
              title={appVersionLabel}
            >
              {appVersionLabel}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="chat-session-left-top">
            <div className="chat-session-left-top-row">
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="chat-session-left-control-btn"
                aria-label={collapseActionLabel}
                title={collapseActionLabel}
              >
                <SidebarSimpleIcon className="chat-session-left-control-icon" />
              </button>
            </div>
          </div>

          <div className="chat-session-function-panel">
            <button
              type="button"
              onClick={onCreateSession}
              disabled={isCreating}
              className={cn(
                'chat-session-function-btn',
                isCreating && 'opacity-60 cursor-not-allowed'
              )}
              aria-label={t('sidebar.createNewSession')}
              title={t('sidebar.createNewSession')}
            >
              <PlusIcon className="chat-session-function-icon size-icon-sm" />
              <span>{t('sidebar.createNewSession')}</span>
            </button>
            <button
              type="button"
              onClick={onOpenAutomation}
              className="chat-session-function-btn"
              aria-label={t('sidebar.automation', {
                defaultValue: 'Automations',
              })}
              title={t('sidebar.automation', { defaultValue: 'Automations' })}
            >
              <ClockIcon className="chat-session-function-icon size-icon-sm" />
              <span>
                {t('sidebar.automation', { defaultValue: 'Automations' })}
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenSkills}
              className={cn(
                'chat-session-function-btn',
                isSkillsActive && 'active'
              )}
              aria-label={t('sidebar.skills', { defaultValue: 'Skills' })}
              title={t('sidebar.skills', { defaultValue: 'Skills' })}
            >
              <SquaresFourIcon className="chat-session-function-icon size-icon-sm" />
              <span>{t('sidebar.skills', { defaultValue: 'Skills' })}</span>
            </button>
          </div>

          <div className="chat-session-conversation-panel">
            <div className="chat-session-conversation-header">
              <div className="chat-session-conversation-title">
                {t('sidebar.sessionSection', { defaultValue: 'Sessions' })}
              </div>
              <div className="chat-session-conversation-actions">
                <button
                  type="button"
                  onClick={onToggleArchived}
                  disabled={archivedSessions.length === 0}
                  className={cn(
                    'chat-session-conversation-action-btn',
                    archivedSessions.length === 0 &&
                      'opacity-50 cursor-not-allowed',
                    showArchived && archivedSessions.length > 0 && 'active'
                  )}
                  aria-label={
                    showArchived
                      ? t('sidebar.hideArchived')
                      : t('sidebar.showArchived')
                  }
                  title={
                    showArchived
                      ? t('sidebar.hideArchived')
                      : t('sidebar.showArchived')
                  }
                >
                  <ListIcon className="size-icon-xs" />
                </button>
              </div>
            </div>

            <div className="chat-session-conversation-list min-h-0 overflow-y-auto p-base space-y-half">
              {activeSessions.length === 0 ? (
                <div className="chat-session-list-empty text-sm text-low">
                  {t('sidebar.noActiveSessions')}
                </div>
              ) : (
                activeSessions.map((session) => renderSessionItem(session))
              )}

              {showArchived && (
                <>
                  <div className="chat-session-archived-separator" />
                  <div className="chat-session-archived-label px-base pt-half">
                    {t('sidebar.archivedSection', { defaultValue: 'Archived' })}
                  </div>
                  {archivedSessions.length === 0 ? (
                    <div className="chat-session-list-empty text-sm text-low">
                      {t('sidebar.noArchivedSessions')}
                    </div>
                  ) : (
                    archivedSessions.map((session) =>
                      renderSessionItem(session)
                    )
                  )}
                </>
              )}
            </div>
          </div>

          <div className="chat-session-left-footer">
            <button
              type="button"
              onClick={onOpenSettings}
              className="chat-session-left-settings-btn"
              aria-label={t('header.settings')}
              title={t('header.settings')}
            >
              <GearSixIcon className="size-icon-sm" />
              <span>
                {t('sidebar.settingsInSidebar', {
                  defaultValue: t('header.settings'),
                })}
              </span>
            </button>
            <div className="chat-session-left-version" title={appVersionLabel}>
              {appVersionLabel}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
