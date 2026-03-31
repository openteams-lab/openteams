import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowCircleUpIcon,
  ArrowCounterClockwiseIcon,
  BoxArrowDownIcon,
  BroomIcon,
  ChatCircleDotsIcon,
  FileArchiveIcon,
  GearSixIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  TrashIcon,
  UsersThreeIcon,
  XIcon,
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
  onOpenAiTeam: () => void;
  onOpenSkills: () => void;
  onOpenSettings: () => void;
  onOpenVersionDialog: () => void;
  hasAvailableUpdate?: boolean;
  latestVersion?: string | null;
  isAiTeamActive?: boolean;
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
  onOpenAiTeam,
  onOpenSkills,
  onOpenSettings,
  onOpenVersionDialog,
  hasAvailableUpdate = false,
  latestVersion = null,
  isAiTeamActive = false,
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
  const [contextMenuSession, setContextMenuSession] =
    useState<ChatSession | null>(null);
  const [isSessionSearchOpen, setIsSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  const sessionSearchContainerRef = useRef<HTMLDivElement | null>(null);
  const hasNoSessions =
    activeSessions.length === 0 && archivedSessions.length === 0;
  const appVersion = __APP_VERSION__.trim();
  const appVersionLabel = appVersion.startsWith('v')
    ? appVersion
    : `v${appVersion}`;
  const latestVersionLabel = latestVersion
    ? latestVersion.startsWith('v')
      ? latestVersion
      : `v${latestVersion}`
    : null;
  const newVersionLabel = t('sidebar.newVersion');
  const updateButtonLabel = latestVersionLabel
    ? t('sidebar.updateAvailableVersion', {
        version: latestVersionLabel,
      })
    : t('sidebar.updateAvailable');
  const collapseActionLabel = isCollapsed
    ? t('sidebar.expandSidebar')
    : t('sidebar.collapseSidebar');
  const trimmedSessionSearchQuery = sessionSearchQuery.trim();
  const normalizedSessionSearchQuery =
    trimmedSessionSearchQuery.toLocaleLowerCase();
  const hasSessionSearchQuery = normalizedSessionSearchQuery.length > 0;

  const closeSessionSearch = useCallback(() => {
    setIsSessionSearchOpen(false);
    setSessionSearchQuery('');
  }, []);

  useEffect(() => {
    if (!isSessionSearchOpen) return;
    const timer = window.setTimeout(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isSessionSearchOpen]);

  useEffect(() => {
    if (!isSessionSearchOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (sessionSearchContainerRef.current?.contains(target)) {
        return;
      }
      closeSessionSearch();
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [closeSessionSearch, isSessionSearchOpen]);

  const getSessionSearchTitle = useCallback(
    (session: ChatSession) =>
      session.title?.trim() || t('sidebar.untitledSession'),
    [t]
  );

  const filteredActiveSessions = useMemo(() => {
    if (!hasSessionSearchQuery) return activeSessions;
    return activeSessions.filter((session) =>
      getSessionSearchTitle(session)
        .toLocaleLowerCase()
        .includes(normalizedSessionSearchQuery)
    );
  }, [
    activeSessions,
    getSessionSearchTitle,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
  ]);

  const filteredArchivedSessions = useMemo(() => {
    if (!hasSessionSearchQuery) return archivedSessions;
    return archivedSessions.filter((session) =>
      getSessionSearchTitle(session)
        .toLocaleLowerCase()
        .includes(normalizedSessionSearchQuery)
    );
  }, [
    archivedSessions,
    getSessionSearchTitle,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
  ]);

  const shouldShowArchivedSection = showArchived || hasSessionSearchQuery;
  const shouldRenderArchivedBlock =
    shouldShowArchivedSection &&
    (filteredArchivedSessions.length > 0 || !hasSessionSearchQuery);
  const hasSessionMatches =
    filteredActiveSessions.length > 0 || filteredArchivedSessions.length > 0;

  const getDisplaySessionTitle = (session: ChatSession) => {
    const fallbackTitle = getSessionSearchTitle(session);
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
                <span
                  className="chat-session-item-active-dot"
                  aria-hidden="true"
                />
              ) : hasUnread ? (
                <span
                  className="chat-session-item-unread-dot"
                  aria-hidden="true"
                />
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
            {hasAvailableUpdate && (
              <button
                type="button"
                onClick={onOpenVersionDialog}
                className="chat-session-left-settings-btn chat-session-left-update-btn icon-only"
                aria-label={updateButtonLabel}
                title={updateButtonLabel}
              >
                <span className="chat-session-left-update-icon-wrap">
                  <ArrowCircleUpIcon className="size-icon-xs" />
                  <span
                    className="chat-session-left-update-dot"
                    aria-hidden="true"
                  />
                </span>
              </button>
            )}
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
                hasNoSessions && 'chat-session-function-btn-empty-state',
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
              onClick={onOpenAiTeam}
              className={cn(
                'chat-session-function-btn',
                isAiTeamActive && 'active'
              )}
              aria-label={t('sidebar.aiTeam', {
                defaultValue: 'AI Team',
              })}
              title={t('sidebar.aiTeam', { defaultValue: 'AI Team' })}
            >
              <UsersThreeIcon className="chat-session-function-icon size-icon-sm" />
              <span>{t('sidebar.aiTeam', { defaultValue: 'AI Team' })}</span>
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
                {isSessionSearchOpen ? (
                  <div
                    ref={sessionSearchContainerRef}
                    className="chat-session-conversation-search"
                  >
                    <div className="chat-session-conversation-search-input-wrap">
                      <MagnifyingGlassIcon className="chat-session-conversation-search-icon size-icon-xs" />
                      <input
                        ref={sessionSearchInputRef}
                        value={sessionSearchQuery}
                        onChange={(event) =>
                          setSessionSearchQuery(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            closeSessionSearch();
                          }
                        }}
                        placeholder={t('sidebar.searchSessionsPlaceholder')}
                        aria-label={t('sidebar.searchSessions')}
                        className="chat-session-conversation-search-input"
                      />
                      <button
                        type="button"
                        onClick={closeSessionSearch}
                        className="chat-session-conversation-search-clear-btn"
                        aria-label={t('sidebar.clearSessionSearch')}
                        title={t('sidebar.clearSessionSearch')}
                      >
                        <XIcon className="size-icon-2xs" weight="bold" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsSessionSearchOpen(true)}
                    className="chat-session-conversation-action-btn"
                    aria-label={t('sidebar.searchSessions')}
                    title={t('sidebar.searchSessions')}
                  >
                    <MagnifyingGlassIcon className="size-icon-xs" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onToggleArchived}
                  disabled={archivedSessions.length === 0}
                  className={cn(
                    'chat-session-conversation-action-btn',
                    archivedSessions.length === 0 &&
                      'opacity-50 cursor-not-allowed',
                    shouldShowArchivedSection &&
                      archivedSessions.length > 0 &&
                      'active'
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
              {hasSessionSearchQuery && !hasSessionMatches ? (
                <div className="chat-session-list-empty text-sm text-low">
                  {t('sidebar.noSearchResults', {
                    query: trimmedSessionSearchQuery,
                  })}
                </div>
              ) : (
                <>
                  {filteredActiveSessions.length === 0 &&
                  !hasSessionSearchQuery ? (
                    <div className="chat-session-list-empty text-sm text-low">
                      {t('sidebar.noActiveSessions')}
                    </div>
                  ) : (
                    filteredActiveSessions.map((session) =>
                      renderSessionItem(session)
                    )
                  )}

                  {shouldRenderArchivedBlock && (
                    <>
                      <div className="chat-session-archived-separator" />
                      <div className="chat-session-archived-label px-base pt-half">
                        {t('sidebar.archivedSection', {
                          defaultValue: 'Archived',
                        })}
                      </div>
                      {filteredArchivedSessions.length === 0 ? (
                        <div className="chat-session-list-empty text-sm text-low">
                          {t('sidebar.noArchivedSessions')}
                        </div>
                      ) : (
                        filteredArchivedSessions.map((session) =>
                          renderSessionItem(session)
                        )
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="chat-session-left-footer">
            <div className="chat-session-left-footer-actions">
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
            </div>
            <div className="chat-session-left-version-group">
              {hasAvailableUpdate && (
                <button
                  type="button"
                  onClick={onOpenVersionDialog}
                  className="chat-session-left-settings-btn chat-session-left-update-btn"
                  aria-label={updateButtonLabel}
                  title={updateButtonLabel}
                >
                  <span className="chat-session-left-update-icon-wrap">
                    <ArrowCircleUpIcon className="size-icon-xs" />
                    <span
                      className="chat-session-left-update-dot"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="chat-session-left-update-label">
                    {newVersionLabel}
                  </span>
                </button>
              )}
              <div
                className="chat-session-left-version"
                title={appVersionLabel}
              >
                {appVersionLabel}
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
