import React, { useEffect, useState } from 'react';
import {
  CHAT_MESSAGE_FONT_SIZE_OPTIONS,
  useWorkspace,
} from '@/context/WorkspaceContext';
import {
  AlertTriangle,
  Archive,
  RotateCcw,
  Bell,
  Cpu,
  CreditCard,
  FlaskConical,
  Github,
  Key,
  Keyboard,
  Route,
  SlidersHorizontal,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { DropdownSelect, type DropdownSelectOption } from '@/components/DropdownSelect';
import { ResourceStateNotice } from '@/components/ResourceState';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { githubAuthApi } from '@/lib/api';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import type { SettingsOptionsMock } from '@/mockApiData';
import type { GitHubAccount, Session } from '@/types';

type NotificationToggleKey =
  | 'newMessage'
  | 'workflowStatus'
  | 'agentActivity'
  | 'systemBanner'
  | 'soundEnabled';

interface NotificationSettingRowProps {
  title: string;
  description: string;
  checked?: boolean;
  onToggle?: () => void;
  control?: React.ReactNode;
  divided?: boolean;
}

const NotificationSettingRow: React.FC<NotificationSettingRowProps> = ({
  title,
  description,
  checked = false,
  onToggle,
  control,
  divided = true,
}) => (
  <div className={`flex items-center justify-between gap-5 px-5 py-4 ${divided ? 'border-b border-[var(--hairline)]' : ''}`}>
    <div className="min-w-0">
      <p className="text-sm leading-tight text-[var(--ink)]">{title}</p>
      <p className="mt-1 text-sm leading-snug text-[var(--ink-subtle)]">{description}</p>
    </div>
    {control ?? (
      <button
        type="button"
        aria-label={title}
        aria-pressed={checked}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked
            ? 'border-[var(--primary)] bg-[var(--primary)]'
            : 'border-[var(--hairline-strong)] bg-[var(--surface-3)]'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    )}
  </div>
);

const sessionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? `${fallback}: ${error.message}` : fallback;

export const SettingsWorkspace: React.FC = () => {
  const {
    t,
    theme,
    setTheme,
    locale,
    setLocale,
    activeSettingsTab,
    setActiveSettingsTab,
    chatMessageFontSize,
    setChatMessageFontSize,
    configAsync,
    refreshConfig,
    archivedSessionsAsync,
    refreshArchivedSessions,
    restoreSession,
    deleteSession,
  } = useWorkspace();
  const [settingsOptions, setSettingsOptions] =
    useState<SettingsOptionsMock | null>(null);
  const [githubAccount, setGithubAccount] = useState<GitHubAccount | null>(
    null,
  );
  const [notificationToggles, setNotificationToggles] = useState<Record<NotificationToggleKey, boolean>>({
    newMessage: true,
    workflowStatus: true,
    agentActivity: true,
    systemBanner: true,
    soundEnabled: true,
  });
  const [notificationSound, setNotificationSound] = useState('soft-chime');
  const [restoringArchivedSessionId, setRestoringArchivedSessionId] =
    useState<string | null>(null);
  const [deletingArchivedSession, setDeletingArchivedSession] =
    useState<Session | null>(null);
  const [deleteArchivedSessionInFlight, setDeleteArchivedSessionInFlight] =
    useState(false);
  const [archivedSessionActionError, setArchivedSessionActionError] =
    useState<string | null>(null);
  const [deleteArchivedSessionError, setDeleteArchivedSessionError] =
    useState<string | null>(null);
  const chatMessageFontSizeOptions: DropdownSelectOption[] =
    CHAT_MESSAGE_FONT_SIZE_OPTIONS.map((size) => ({
      id: String(size),
      label: t('settings.appearance.chatMessageFontSizeOption', { size }),
    }));

  useEffect(() => {
    let cancelled = false;
    void mockFrontendApi.getSettingsOptions().then((options) => {
      if (!cancelled) setSettingsOptions(options);
    });
    void githubAuthApi
      .getAccount()
      .then((account) => {
        if (!cancelled) setGithubAccount(account);
      })
      .catch(() => {
        if (!cancelled) setGithubAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeSettingsTab !== 'archived-sessions') return;
    void refreshArchivedSessions();
  }, [activeSettingsTab, refreshArchivedSessions]);

  const translate = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const translated = t(key, replacements);
    return translated && translated !== key ? translated : fallback;
  };

  const handleToggleNotification = (key: NotificationToggleKey) => {
    setNotificationToggles((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const handleRestoreArchivedSession = async (session: Session) => {
    if (restoringArchivedSessionId || deleteArchivedSessionInFlight) return;

    setRestoringArchivedSessionId(session.id);
    setArchivedSessionActionError(null);
    try {
      await restoreSession(session.id);
    } catch (error) {
      setArchivedSessionActionError(
        sessionErrorMessage(
          error,
          t('settings.archivedSessions.restoreFailed'),
        ),
      );
    } finally {
      setRestoringArchivedSessionId(null);
    }
  };

  const startDeleteArchivedSession = (session: Session) => {
    setDeletingArchivedSession(session);
    setDeleteArchivedSessionError(null);
    setArchivedSessionActionError(null);
  };

  const closeDeleteArchivedSessionDialog = () => {
    if (deleteArchivedSessionInFlight) return;
    setDeletingArchivedSession(null);
    setDeleteArchivedSessionError(null);
  };

  const confirmDeleteArchivedSession = async () => {
    if (!deletingArchivedSession) return;

    setDeleteArchivedSessionInFlight(true);
    setDeleteArchivedSessionError(null);
    try {
      await deleteSession(deletingArchivedSession.id);
      setDeletingArchivedSession(null);
    } catch (error) {
      setDeleteArchivedSessionError(
        sessionErrorMessage(
          error,
          t('settings.archivedSessions.deleteFailed'),
        ),
      );
    } finally {
      setDeleteArchivedSessionInFlight(false);
    }
  };

  const accountDisplayLabel =
    githubAccount?.login ?? settingsOptions?.account.email ?? '-';

  const renderActiveSettingPanel = () => {
    switch (activeSettingsTab) {
      case 'appearance':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.appearance.title')}</h3>
              <p className="mt-0.5 text-sm text-[var(--ink-subtle)]">{t('settings.appearance.desc')}</p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--ink)]">{t('settings.appearance.pageLanguage')}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(settingsOptions?.languages ?? []).map((lang) => (
                  <label
                    key={lang.code}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
                      locale === lang.code
                        ? 'border-[var(--primary)] bg-[var(--surface-2)] text-[var(--ink)]'
                        : 'border-[var(--hairline)] bg-[var(--surface-1)] text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:border-[var(--hairline-strong)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="workspace-language"
                      value={lang.code}
                      checked={locale === lang.code}
                      onChange={() => setLocale(lang.code)}
                      className="h-3.5 w-3.5 accent-[var(--primary)]"
                    />
                    <span className="truncate">{translate(`language.${lang.code}`, lang.label)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--ink)]">{t('settings.appearance.theme')}</h4>
              <div className="grid grid-cols-2 gap-3.5">
              <div 
                onClick={() => setTheme('dark')}
                className={`rounded-xl border p-4 cursor-pointer flex flex-col gap-2.5 transition ${
                  theme === 'dark' ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--hairline)] bg-[var(--surface-1)] hover:border-[var(--hairline-strong)]'
                }`}
              >
                <div className="h-16 rounded-lg bg-[#010102] border border-[var(--hairline)] relative overflow-hidden">
                  <div className="absolute top-2 left-2 right-2 h-2 bg-[#0f1011] rounded" />
                  <div className="absolute bottom-2 left-2 w-8 h-2 bg-[var(--primary)] rounded" />
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${theme === 'dark' ? 'bg-[var(--primary)]' : 'bg-transparent'}`} />
                  <span>{t('settings.appearance.darkThemeDefault')}</span>
                </div>
              </div>

              <div 
                onClick={() => setTheme('light')}
                className={`rounded-xl border p-4 cursor-pointer flex flex-col gap-2.5 transition ${
                  theme === 'light' ? 'border-[var(--primary)] bg-[var(--surface-2)]' : 'border-[var(--hairline)] bg-[var(--surface-1)] hover:border-[var(--hairline-strong)]'
                }`}
              >
                <div className="h-16 rounded-lg bg-[#fbfbfc] border border-[#e3e5ea] relative overflow-hidden">
                  <div className="absolute top-2 left-2 right-2 h-2 bg-[#ffffff] border border-[#e3e5ea] rounded" />
                  <div className="absolute bottom-2 left-2 w-8 h-2 bg-[var(--primary)] rounded" />
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <span className={`h-1.5 w-1.5 rounded-full ${theme === 'light' ? 'bg-[var(--primary)]' : 'bg-transparent'}`} />
                  <span>{t('settings.appearance.lightThemeInverted')}</span>
                </div>
              </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-[var(--ink)]">{t('settings.appearance.chatMessageFontSize')}</h4>
              <div className="flex flex-col gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-snug text-[var(--ink-subtle)]">{t('settings.appearance.chatMessageFontSizeDesc')}</p>
                <DropdownSelect
                  value={String(chatMessageFontSize)}
                  options={chatMessageFontSizeOptions}
                  showSearch={false}
                  placeholder={t('settings.appearance.chatMessageFontSize')}
                  onChange={(value) => setChatMessageFontSize(Number(value))}
                  className="w-full shrink-0 sm:w-[160px]"
                  maxPanelHeightClassName="max-h-[180px]"
                />
              </div>
            </div>
          </div>
        );

      case 'notifications': {
        const inboxRows: Array<{
          key: NotificationToggleKey;
          titleKey: string;
          descKey: string;
        }> = [
          {
            key: 'newMessage',
            titleKey: 'settings.notifications.newMessage.title',
            descKey: 'settings.notifications.newMessage.desc',
          },
          {
            key: 'workflowStatus',
            titleKey: 'settings.notifications.workflowStatus.title',
            descKey: 'settings.notifications.workflowStatus.desc',
          },
          {
            key: 'agentActivity',
            titleKey: 'settings.notifications.agentActivity.title',
            descKey: 'settings.notifications.agentActivity.desc',
          },
        ];
        const soundOptions: DropdownSelectOption[] = [
          {
            id: 'soft-chime',
            label: t('settings.notifications.sound.softChime'),
          },
          {
            id: 'bright-ping',
            label: t('settings.notifications.sound.brightPing'),
          },
          {
            id: 'low-bell',
            label: t('settings.notifications.sound.lowBell'),
          },
          {
            id: 'none',
            label: t('settings.notifications.sound.none'),
          },
        ];

        return (
          <div className="settings-notifications-panel mx-auto max-w-5xl space-y-10 text-sm">
            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.notifications.inbox.title')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-subtle)]">{t('settings.notifications.inbox.desc')}</p>
              </div>

              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                {inboxRows.map((row, index) => (
                  <NotificationSettingRow
                    key={row.key}
                    title={t(row.titleKey)}
                    description={t(row.descKey)}
                    checked={notificationToggles[row.key]}
                    onToggle={() => handleToggleNotification(row.key)}
                    divided={index < inboxRows.length - 1}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.notifications.system.title')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-subtle)]">{t('settings.notifications.system.desc')}</p>
              </div>

              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                <NotificationSettingRow
                  title={t('settings.notifications.systemBanner.title')}
                  description={t('settings.notifications.systemBanner.desc')}
                  checked={notificationToggles.systemBanner}
                  onToggle={() => handleToggleNotification('systemBanner')}
                />
                <NotificationSettingRow
                  title={t('settings.notifications.soundEnabled.title')}
                  description={t('settings.notifications.soundEnabled.desc')}
                  checked={notificationToggles.soundEnabled}
                  onToggle={() => handleToggleNotification('soundEnabled')}
                />
                <NotificationSettingRow
                  title={t('settings.notifications.soundSelect.title')}
                  description={t('settings.notifications.soundSelect.desc')}
                  divided={false}
                  control={
                    <DropdownSelect
                      value={notificationSound}
                      options={soundOptions}
                      showSearch={false}
                      disabled={!notificationToggles.soundEnabled}
                      placeholder={t('settings.notifications.soundSelect.placeholder')}
                      onChange={(value) => setNotificationSound(value)}
                      className="w-[180px] shrink-0"
                      maxPanelHeightClassName="max-h-[180px]"
                    />
                  }
                />
              </div>
            </section>
          </div>
        );
      }

      case 'archived-sessions':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.archivedSessions.title')}</h3>
              <p className="mt-0.5 text-sm text-[var(--ink-subtle)]">{t('settings.archivedSessions.desc')}</p>
            </div>

            <ResourceStateNotice
              resource={archivedSessionsAsync}
              className="!text-sm [&_button]:!text-sm [&_p]:!text-sm"
              labels={{
                loading: t('settings.archivedSessions.loading'),
                empty: t('settings.archivedSessions.empty'),
                error: t('settings.archivedSessions.error'),
              }}
              onRetry={() => void refreshArchivedSessions()}
            />

            {archivedSessionActionError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {archivedSessionActionError}
              </p>
            )}

            {archivedSessionsAsync.data.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                {archivedSessionsAsync.data.map((session, index) => {
                  const restoring = restoringArchivedSessionId === session.id;
                  const busy = Boolean(
                    restoringArchivedSessionId || deleteArchivedSessionInFlight,
                  );
                  return (
                    <div
                      key={session.id}
                      className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                        index < archivedSessionsAsync.data.length - 1
                          ? 'border-b border-[var(--hairline)]'
                          : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {session.title}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-xs text-[var(--ink-tertiary)]">
                          {session.id}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRestoreArchivedSession(session)}
                          disabled={busy}
                          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCcw className={`h-3.5 w-3.5 ${restoring ? 'animate-spin' : ''}`} />
                          {restoring
                            ? t('settings.archivedSessions.restoring')
                            : t('settings.archivedSessions.restore')}
                        </button>
                        <button
                          type="button"
                          onClick={() => startDeleteArchivedSession(session)}
                          disabled={busy}
                          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('settings.archivedSessions.delete')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'account':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.account.title')}</h3>
              <p className="mt-0.5 text-sm text-[var(--ink-subtle)]">{t('settings.account.desc')}</p>
            </div>

            <ResourceStateNotice
              resource={configAsync}
              className="!text-sm [&_button]:!text-sm [&_p]:!text-sm"
              labels={{
                loading: t('resource.accountConfig.loading'),
                empty: t('resource.accountConfig.empty'),
                error: t('resource.accountConfig.error'),
              }}
              onRetry={() => void refreshConfig()}
            />

            <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-4 font-mono text-sm">
              <div className="flex justify-between gap-4 py-1">
                <span className="text-[var(--ink-subtle)]">{t('settings.account.emailEndpoint')}</span>
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--ink)] font-semibold select-all">
                  {githubAccount ? (
                    <Github
                      className="h-3.5 w-3.5 shrink-0 text-[var(--ink-subtle)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {accountDisplayLabel}
                  </span>
                </span>
              </div>
            </div>
          </div>
        );

      case 'shortcuts':
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.shortcuts.title')}</h3>
              <p className="mt-0.5 text-sm text-[var(--ink-subtle)]">{t('settings.shortcuts.desc')}</p>
            </div>

            <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] divide-y divide-[var(--hairline)] font-mono text-sm text-[var(--ink-muted)]">
              <div className="flex justify-between items-center p-3">
                <span>{t('settings.shortcuts.toggleWorkspaceSearch')}</span>
                <kbd className="rounded border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-1.5 py-0.5 text-sm text-[var(--ink)]">⌘K</kbd>
              </div>
              <div className="flex justify-between items-center p-3">
                <span>{t('settings.shortcuts.startTaskExecution')}</span>
                <kbd className="rounded border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-1.5 py-0.5 text-sm text-[var(--ink)]">⌘↵</kbd>
              </div>
              <div className="flex justify-between items-center p-3">
                <span>{t('settings.shortcuts.dismissModalTriggers')}</span>
                <kbd className="rounded border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-1.5 py-0.5 text-sm text-[var(--ink)]">esc</kbd>
              </div>
            </div>
          </div>
        );

      default:
        return <ProviderSettingsPanel />;
    }
  };

  const renderMenuIcon = (icon: string) => {
    const iconProps = { className: 'h-3.5 w-3.5', strokeWidth: 1.5 };
    const icons: Record<string, React.ReactNode> = {
      user: <User {...iconProps} />,
      archive: <Archive {...iconProps} />,
      'credit-card': <CreditCard {...iconProps} />,
      bell: <Bell {...iconProps} />,
      cpu: <Cpu {...iconProps} />,
      route: <Route {...iconProps} />,
      users: <Users {...iconProps} />,
      github: <Github {...iconProps} />,
      key: <Key {...iconProps} />,
      sliders: <SlidersHorizontal {...iconProps} />,
      keyboard: <Keyboard {...iconProps} />,
      flask: <FlaskConical {...iconProps} />,
    };
    return icons[icon] ?? <SlidersHorizontal {...iconProps} />;
  };

  const menuItems = settingsOptions?.menu ?? [];
  const isProviderSettingsTab = activeSettingsTab === 'providers';
  const getMenuSectionLabel = (section: string) =>
    translate(`settings.menu.section.${section.toLowerCase()}`, section);
  const getMenuItemLabel = (id: string, label: string) => {
    const keyId = id.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    return translate(`settings.menu.item.${keyId}`, label);
  };

  return (
    <div className="settings-workspace h-full w-full overflow-hidden font-sans text-sm select-none">
      {deletingArchivedSession && (
        <div
          className="fixed inset-0 z-[1002] flex items-center justify-center p-4"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            onClick={closeDeleteArchivedSessionDialog}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-archived-session-dialog-title"
            aria-describedby="delete-archived-session-dialog-desc"
            className="relative w-full max-w-md overflow-hidden rounded-xl border border-[var(--hairline-strong)] bg-[var(--canvas)] select-none"
          >
            <div className="p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <p
                id="delete-archived-session-dialog-title"
                className="text-base font-semibold tracking-tight text-[var(--ink)]"
              >
                {translate(
                  'settings.archivedSessions.deleteConfirmTitle',
                  'Delete archived session?',
                )}
              </p>
              <p
                id="delete-archived-session-dialog-desc"
                className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]"
              >
                {translate(
                  'settings.archivedSessions.deleteConfirmDesc',
                  `"${deletingArchivedSession.title}" will be permanently deleted. This action cannot be undone.`,
                  { name: deletingArchivedSession.title },
                )}
              </p>
              {deleteArchivedSessionError && (
                <p className="mt-2 text-xs text-red-400">
                  {deleteArchivedSessionError}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--hairline)] bg-[var(--surface-1)] px-5 py-3">
              <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
                {translate('escToCancel', 'Esc to cancel')}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-md border border-[var(--hairline-strong)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={closeDeleteArchivedSessionDialog}
                  disabled={deleteArchivedSessionInFlight}
                >
                  {translate('cancel', 'Cancel')}
                </button>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void confirmDeleteArchivedSession()}
                  disabled={deleteArchivedSessionInFlight}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteArchivedSessionInFlight
                    ? t('settings.archivedSessions.deleting')
                    : t('settings.archivedSessions.delete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[196px_1fr]">
        {/* Left Nav menu list */}
        <aside className="settings-sidebar border-r border-[var(--hairline)] p-3 space-y-3 overflow-y-auto">
          {menuItems.map(group => (
            <div key={group.section} className="space-y-0.5">
              <div className="settings-section-label font-semibold text-[var(--ink-tertiary)] uppercase px-1.5 mb-1.5">{getMenuSectionLabel(group.section)}</div>
              {group.items.map(item => {
                const active = item.id === activeSettingsTab;
                return (
                  <button
                    key={item.id}
                    onClick={() => !item.disabled && setActiveSettingsTab(item.id)}
                    disabled={item.disabled}
                    className={`w-full flex min-h-8 items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left border transition-colors ${
                      active 
                        ? 'text-[var(--ink)] bg-[var(--surface-1)] font-medium border-[var(--hairline)]' 
                        : 'text-[var(--ink-subtle)] hover:bg-[var(--surface-1)] hover:text-[var(--ink)] border-transparent'
                    } ${item.disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : 'cursor-pointer'}`}
                  >
                    <span className="shrink-0">{renderMenuIcon(item.icon)}</span>
                    <span className="truncate">{getMenuItemLabel(item.id, item.label)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Right content manager */}
        <main
          className={`min-h-0 min-w-0 p-6 ${
            isProviderSettingsTab ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {renderActiveSettingPanel()}
        </main>
      </div>

    </div>
  );
};
