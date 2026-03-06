import {
  ChatCircleDotsIcon,
  ClockIcon,
  GearSixIcon,
  ListIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ChatSession } from 'shared/types';
import { cn } from '@/lib/utils';

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
}: SessionListSidebarProps) {
  const { t } = useTranslation('chat');
  const appVersion = __APP_VERSION__.trim();
  const appVersionLabel = appVersion.startsWith('v')
    ? appVersion
    : `v${appVersion}`;
  const collapseActionLabel = isCollapsed
    ? t('sidebar.expandSidebar')
    : t('sidebar.collapseSidebar');

  const getDisplaySessionTitle = (title: string | null) => {
    const fullTitle = title?.trim() || t('sidebar.untitledSession');
    if (fullTitle.length <= MAX_SESSION_TITLE_LENGTH) {
      return { fullTitle, displayTitle: fullTitle };
    }
    return {
      fullTitle,
      displayTitle: `${fullTitle.slice(0, MAX_SESSION_TITLE_LENGTH)}...`,
    };
  };

  const renderSessionItem = (session: ChatSession) => {
    const isActive = session.id === activeSessionId;
    const hasUnread = !isActive && unreadSessionIds.has(session.id);
    const { fullTitle, displayTitle } = getDisplaySessionTitle(session.title);

    return (
      <button
        key={session.id}
        type="button"
        onClick={() => onSelectSession(session.id)}
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
          ) : (
            <ChatCircleDotsIcon className="chat-session-item-icon size-icon-xs" />
          )}
          {!isCollapsed && (
            <div className="chat-session-item-content min-w-0 flex-1">
              <div
                className="chat-session-item-title truncate"
                title={fullTitle}
              >
                {displayTitle}
              </div>
            </div>
          )}
        </div>
      </button>
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
              className="chat-session-function-btn chat-session-function-btn-primary"
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
