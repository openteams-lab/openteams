import type React from 'react';
import { useEffect, useState } from 'react';
import {
  CHAT_MESSAGE_FONT_SIZE_OPTIONS,
  useWorkspace,
} from '@/context/WorkspaceContext';
import {
  AlertTriangle,
  Archive,
  RotateCcw,
  Bell,
  Check,
  ChevronDown,
  CircleArrowUp,
  Cpu,
  CreditCard,
  FlaskConical,
  FolderOpen,
  Github,
  Key,
  Keyboard,
  Languages,
  Monitor,
  Moon,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { DropdownSelect, type DropdownSelectOption } from '@/components/DropdownSelect';
import { ResourceStateNotice } from '@/components/ResourceState';
import { useConfirmationDialogKeyboard } from '@/components/useConfirmationDialogKeyboard';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { KeyboardShortcutSettings } from '@/shortcuts/KeyboardShortcutSettings';
import {
  filesystemApi,
  githubAuthApi,
  onboardingApi,
  systemApi,
} from '@/lib/api';
import {
  ONBOARDING_GUIDE_RESET_EVENT,
  ONBOARDING_UPGRADE_REPLAY_EVENT,
} from '@/lib/onboardingEvents';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import { cn } from '@/lib/utils';
import type { SettingsOptionsMock } from '@/mockApiData';
import type { GitHubAccount, Session, UserSystemInfo } from '@/types';
import {
  SoundFile,
  type NotificationConfig,
  type NotificationInboxSourcesConfig,
} from '../../../shared/types';

type NotificationConfigField =
  | 'push_enabled'
  | 'sound_enabled'
  | 'sound_file'
  | 'inbox_sources';

type PrivacySettingField =
  | 'analytics_enabled'
  | 'error_reporting_enabled';

const trimTrailingPathSeparators = (path: string): string =>
  path.replace(/[\\/]+$/, '');

const pathSeparatorFor = (path: string, osType?: string): '\\' | '/' => {
  if (path.includes('\\')) return '\\';
  return osType?.toLowerCase().includes('windows') ? '\\' : '/';
};

const joinPath = (
  basePath: string,
  segments: string[],
  osType?: string,
): string => {
  const separator = pathSeparatorFor(basePath, osType);
  const base = trimTrailingPathSeparators(basePath);
  return [base, ...segments].filter(Boolean).join(separator);
};

const expandHomePath = (path: string, homeDirectory?: string): string => {
  if (!path.startsWith('~') || !homeDirectory) return path;
  if (path === '~') return homeDirectory;
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return joinPath(homeDirectory, [path.slice(2)]);
  }
  return path;
};

const defaultWorktreeTempRoot = (
  osType: string | undefined,
  homeDirectory: string | undefined,
): string => {
  const normalizedOs = osType?.toLowerCase() ?? '';
  if (
    normalizedOs.includes('linux') ||
    normalizedOs.includes('ubuntu') ||
    normalizedOs.includes('debian')
  ) {
    return '/var/tmp';
  }
  if (normalizedOs.includes('windows') && homeDirectory) {
    return joinPath(homeDirectory, ['AppData', 'Local', 'Temp'], 'windows');
  }
  return '/var/tmp';
};

const defaultMacWorktreeRoot = (
  homeDirectory: string,
  appIdentifier: string,
): string =>
  joinPath(
    homeDirectory,
    ['Library', 'Application Support', appIdentifier],
    'macos',
  );

const getDefaultWorktreeSessionsDir = (
  config: UserSystemInfo['config'] | null,
  systemInfo: Pick<UserSystemInfo, 'home_directory' | 'environment'> | null,
): string => {
  if (!systemInfo) return '';

  const osType = systemInfo?.environment.os_type;
  const workspaceDir =
    typeof config?.workspace_dir === 'string'
      ? config.workspace_dir.trim()
      : '';
  const expandedWorkspaceDir = workspaceDir
    ? expandHomePath(workspaceDir, systemInfo?.home_directory)
    : '';
  if (expandedWorkspaceDir) {
    return joinPath(
      expandedWorkspaceDir,
      ['.openteams-workspaces', 'sessions'],
      osType,
    );
  }

  const appTempName = import.meta.env.DEV ? 'openteams-dev' : 'openteams';
  if (osType?.toLowerCase().includes('mac') && systemInfo.home_directory) {
    const appIdentifier = import.meta.env.DEV
      ? 'ai.openteams-lab-dev.openteams'
      : 'ai.openteams-lab.openteams';
    return joinPath(
      defaultMacWorktreeRoot(systemInfo.home_directory, appIdentifier),
      ['worktrees', 'sessions'],
      osType,
    );
  }
  return joinPath(
    defaultWorktreeTempRoot(osType, systemInfo?.home_directory),
    [appTempName, 'worktrees', 'sessions'],
    osType,
  );
};

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  sound_enabled: true,
  push_enabled: true,
  sound_file: SoundFile.ABSTRACT_SOUND3,
  inbox_sources: {
    chat_message: true,
    workflow_action: true,
    approval: true,
    worktree: true,
    failure: true,
  },
};

const SOUND_FILE_VALUES = new Set<string>(Object.values(SoundFile));

const notificationInboxSourcesFrom = (
  value: unknown,
): NotificationInboxSourcesConfig => {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<Record<keyof NotificationInboxSourcesConfig, unknown>>)
      : {};
  const defaults = DEFAULT_NOTIFICATION_CONFIG.inbox_sources;
  return {
    chat_message:
      typeof candidate.chat_message === 'boolean'
        ? candidate.chat_message
        : defaults.chat_message,
    workflow_action:
      typeof candidate.workflow_action === 'boolean'
        ? candidate.workflow_action
        : defaults.workflow_action,
    approval:
      typeof candidate.approval === 'boolean'
        ? candidate.approval
        : defaults.approval,
    worktree:
      typeof candidate.worktree === 'boolean'
        ? candidate.worktree
        : defaults.worktree,
    failure:
      typeof candidate.failure === 'boolean'
        ? candidate.failure
        : defaults.failure,
  };
};

const notificationInboxSourcesEqual = (
  left: NotificationInboxSourcesConfig,
  right: NotificationInboxSourcesConfig,
) =>
  left.chat_message === right.chat_message &&
  left.workflow_action === right.workflow_action &&
  left.approval === right.approval &&
  left.worktree === right.worktree &&
  left.failure === right.failure;

const notificationConfigFrom = (value: unknown): NotificationConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_NOTIFICATION_CONFIG;
  }

  const candidate = value as {
    sound_enabled?: unknown;
    push_enabled?: unknown;
    sound_file?: unknown;
    inbox_sources?: unknown;
  };
  return {
    sound_enabled:
      typeof candidate.sound_enabled === 'boolean'
        ? candidate.sound_enabled
        : DEFAULT_NOTIFICATION_CONFIG.sound_enabled,
    push_enabled:
      typeof candidate.push_enabled === 'boolean'
        ? candidate.push_enabled
        : DEFAULT_NOTIFICATION_CONFIG.push_enabled,
    sound_file:
      typeof candidate.sound_file === 'string' &&
      SOUND_FILE_VALUES.has(candidate.sound_file)
        ? (candidate.sound_file as SoundFile)
        : DEFAULT_NOTIFICATION_CONFIG.sound_file,
    inbox_sources: notificationInboxSourcesFrom(candidate.inbox_sources),
  };
};

interface NotificationSettingRowProps {
  title: string;
  description: string;
  checked?: boolean;
  onToggle?: () => void;
  control?: React.ReactNode;
  divided?: boolean;
  disabled?: boolean;
}

const NotificationSettingRow: React.FC<NotificationSettingRowProps> = ({
  title,
  description,
  checked = false,
  onToggle,
  control,
  divided = true,
  disabled = false,
}) => {
  const toggleDisabled = disabled || !onToggle;

  return (
    <div className={`settings-preference-row flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${divided ? 'border-b border-[var(--hairline)]' : ''}`}>
      <div className="min-w-0">
        <p className="settings-row-title leading-tight">{title}</p>
        <p className="settings-row-description mt-1 leading-snug">{description}</p>
      </div>
      {control ?? (
        <button
          type="button"
          aria-label={title}
          aria-pressed={checked}
          disabled={toggleDisabled}
          onClick={toggleDisabled ? undefined : onToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
            checked
              ? 'border-[var(--primary)] bg-[var(--primary)]'
              : 'border-[var(--hairline-strong)] bg-[var(--surface-3)]'
          } ${
            toggleDisabled
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer'
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
};

const sessionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? `${fallback}: ${error.message}` : fallback;

const browserNotificationApi = (): typeof Notification | null => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }
  return window.Notification;
};

export const SettingsWorkspace: React.FC = () => {
  const {
    t,
    themePreference,
    setTheme,
    locale,
    setLocale,
    activeSettingsTab,
    setActiveSettingsTab,
    chatMessageFontSize,
    setChatMessageFontSize,
    configAsync,
    refreshConfig,
    saveConfigPatch,
    archivedSessionsAsync,
    refreshArchivedSessions,
    restoreSession,
    deleteSession,
  } = useWorkspace();
  const [settingsOptions, setSettingsOptions] =
    useState<SettingsOptionsMock | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [githubAccount, setGithubAccount] = useState<GitHubAccount | null>(
    null,
  );
  const [analyticsUserId, setAnalyticsUserId] = useState<string | null>(null);
  const [notificationSavingField, setNotificationSavingField] =
    useState<NotificationConfigField | null>(null);
  const [notificationSettingsMessage, setNotificationSettingsMessage] =
    useState<string | null>(null);
  const [privacySavingField, setPrivacySavingField] =
    useState<PrivacySettingField | null>(null);
  const [privacySettingsMessage, setPrivacySettingsMessage] =
    useState<string | null>(null);
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
  const [onboardingAction, setOnboardingAction] = useState<
    'reset' | 'upgrade' | null
  >(null);
  const [worktreeSessionsDirDraft, setWorktreeSessionsDirDraft] =
    useState('');
  const [worktreeSessionsDirSaving, setWorktreeSessionsDirSaving] =
    useState(false);
  const [worktreeSessionsDirMessage, setWorktreeSessionsDirMessage] =
    useState<string | null>(null);
  const [worktreeSessionsDirSelecting, setWorktreeSessionsDirSelecting] =
    useState(false);
  const [worktreeDefaultSystemInfo, setWorktreeDefaultSystemInfo] =
    useState<Pick<UserSystemInfo, 'home_directory' | 'environment'> | null>(
      null,
    );
  const configuredWorktreeSessionsDir =
    typeof configAsync.data?.worktree_sessions_dir === 'string'
      ? configAsync.data.worktree_sessions_dir.trim()
      : '';
  const worktreeSessionsDirPlaceholder = getDefaultWorktreeSessionsDir(
    configAsync.data,
    worktreeDefaultSystemInfo,
  );
  const chatMessageFontSizeOptions: DropdownSelectOption[] =
    CHAT_MESSAGE_FONT_SIZE_OPTIONS.map((size) => ({
      id: String(size),
      label: t('settings.appearance.chatMessageFontSizeOption', { size }),
    }));
  const notificationConfig = notificationConfigFrom(
    configAsync.data?.notifications,
  );
  const notificationSettingsDisabled =
    !configAsync.data || Boolean(notificationSavingField);
  const analyticsEnabled = configAsync.data?.analytics_enabled ?? true;
  const errorReportingEnabled =
    configAsync.data?.error_reporting_enabled ?? true;
  const privacySettingsDisabled =
    !configAsync.data || Boolean(privacySavingField);

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

  useEffect(() => {
    let cancelled = false;
    void systemApi
      .getInfo()
      .then((info) => {
        if (cancelled) return;
        setAnalyticsUserId(info.analytics_user_id.trim() || null);
        setWorktreeDefaultSystemInfo({
          home_directory: info.home_directory,
          environment: info.environment,
        });
      })
      .catch(() => {
        if (!cancelled) setWorktreeDefaultSystemInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setWorktreeSessionsDirDraft(configuredWorktreeSessionsDir);
  }, [configuredWorktreeSessionsDir]);

  const translate = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const translated = t(key, replacements);
    return translated && translated !== key ? translated : fallback;
  };

  const persistNotificationConfig = async (
    patch: Partial<NotificationConfig>,
    field: NotificationConfigField,
  ) => {
    const currentConfig = configAsync.data;
    if (!currentConfig || notificationSavingField) return;

    const currentNotifications = notificationConfigFrom(
      currentConfig.notifications,
    );
    const nextNotifications: NotificationConfig = {
      ...currentNotifications,
      ...patch,
    };
    if (
      nextNotifications.push_enabled === currentNotifications.push_enabled &&
      nextNotifications.sound_enabled === currentNotifications.sound_enabled &&
      nextNotifications.sound_file === currentNotifications.sound_file &&
      notificationInboxSourcesEqual(
        nextNotifications.inbox_sources,
        currentNotifications.inbox_sources,
      )
    ) {
      return;
    }

    if (field === 'push_enabled' && nextNotifications.push_enabled) {
      const BrowserNotification = browserNotificationApi();
      if (!BrowserNotification) {
        setNotificationSettingsMessage(
          translate(
            'settings.notifications.systemPermission.unsupported',
            'System notifications are not supported in this browser.',
          ),
        );
        return;
      }
      if (BrowserNotification.permission === 'denied') {
        setNotificationSettingsMessage(
          translate(
            'settings.notifications.systemPermission.denied',
            'Allow system notifications in your browser or operating system settings, then turn this on again.',
          ),
        );
        return;
      }
      if (BrowserNotification.permission !== 'granted') {
        const permission = await BrowserNotification.requestPermission();
        if (permission !== 'granted') {
          setNotificationSettingsMessage(
            translate(
              'settings.notifications.systemPermission.denied',
              'Allow system notifications in your browser or operating system settings, then turn this on again.',
            ),
          );
          return;
        }
      }
    }

    setNotificationSavingField(field);
    setNotificationSettingsMessage(null);
    try {
      await systemApi.saveConfig({
        ...currentConfig,
        notifications: {
          sound_enabled: nextNotifications.sound_enabled,
          push_enabled: nextNotifications.push_enabled,
          sound_file: nextNotifications.sound_file,
          inbox_sources: {
            chat_message: nextNotifications.inbox_sources.chat_message,
            workflow_action: nextNotifications.inbox_sources.workflow_action,
            approval: nextNotifications.inbox_sources.approval,
            worktree: nextNotifications.inbox_sources.worktree,
            failure: nextNotifications.inbox_sources.failure,
          },
        },
      });
      await refreshConfig();
    } catch (error) {
      setNotificationSettingsMessage(
        sessionErrorMessage(
          error,
          translate(
            'settings.notifications.saveFailed',
            'Failed to save notification settings.',
          ),
        ),
      );
    } finally {
      setNotificationSavingField(null);
    }
  };

  const persistPrivacySetting = async (
    field: PrivacySettingField,
    enabled: boolean,
  ) => {
    if (!configAsync.data || privacySavingField) return;

    setPrivacySavingField(field);
    setPrivacySettingsMessage(null);
    try {
      await saveConfigPatch({ [field]: enabled });
      if (field === 'error_reporting_enabled') {
        setPrivacySettingsMessage(
          translate(
            'settings.privacy.errorReporting.restartNotice',
            'Restart OpenTeams for the error reporting change to take effect.',
          ),
        );
      }
    } catch (error) {
      setPrivacySettingsMessage(
        sessionErrorMessage(
          error,
          translate(
            'settings.privacy.saveFailed',
            'Failed to save privacy settings.',
          ),
        ),
      );
    } finally {
      setPrivacySavingField(null);
    }
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

  useConfirmationDialogKeyboard({
    enabled: Boolean(deletingArchivedSession),
    confirming: deleteArchivedSessionInFlight,
    onCancel: closeDeleteArchivedSessionDialog,
    onConfirm: () => void confirmDeleteArchivedSession(),
  });

  const handleResetOnboardingGuide = async () => {
    if (onboardingAction) return;
    setOnboardingAction('reset');
    try {
      const state = await onboardingApi.reset();
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_GUIDE_RESET_EVENT, { detail: state }),
      );
    } catch (error) {
      console.error(t('settings.onboarding.actionFailed'), error);
    } finally {
      setOnboardingAction(null);
    }
  };

  const handleReplayUpgradeGuide = async () => {
    if (onboardingAction) return;
    setOnboardingAction('upgrade');
    try {
      const state = await onboardingApi.resetUpgradeRead();
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_UPGRADE_REPLAY_EVENT, { detail: state }),
      );
    } catch (error) {
      console.error(t('settings.onboarding.actionFailed'), error);
    } finally {
      setOnboardingAction(null);
    }
  };

  const handleSelectWorktreeSessionsDir = async () => {
    if (
      !configAsync.data ||
      worktreeSessionsDirSaving ||
      worktreeSessionsDirSelecting
    ) {
      return;
    }

    setWorktreeSessionsDirSelecting(true);
    setWorktreeSessionsDirMessage(null);
    try {
      const response = await filesystemApi.selectDirectory({
        title: translate(
          'settings.storage.worktreeSessionsDirPickerTitle',
          'Select session worktree directory',
        ),
        initial_directory:
          worktreeSessionsDirDraft.trim() ||
          worktreeSessionsDirPlaceholder ||
          undefined,
      });
      if (response.cancelled || !response.path) return;

      setWorktreeSessionsDirDraft(response.path);
      await persistWorktreeSessionsDir(response.path);
    } catch (error) {
      setWorktreeSessionsDirMessage(
        error instanceof Error
          ? error.message
          : translate(
              'settings.storage.worktreeSessionsDirSelectFailed',
              'Failed to select folder.',
            ),
      );
    } finally {
      setWorktreeSessionsDirSelecting(false);
    }
  };

  const persistWorktreeSessionsDir = async (nextDir: string) => {
    const currentConfig = configAsync.data;
    if (!currentConfig || worktreeSessionsDirSaving) return;

    const trimmed = nextDir.trim();
    const currentTrimmed =
      typeof currentConfig.worktree_sessions_dir === 'string'
        ? currentConfig.worktree_sessions_dir.trim()
        : '';
    if (trimmed === currentTrimmed) return;

    setWorktreeSessionsDirSaving(true);
    setWorktreeSessionsDirMessage(null);
    try {
      await systemApi.saveConfig({
        ...currentConfig,
        worktree_sessions_dir: trimmed || null,
      });
      await refreshConfig();
      setWorktreeSessionsDirDraft(trimmed);
    } catch (error) {
      setWorktreeSessionsDirMessage(
        error instanceof Error
          ? error.message
          : translate('settings.storage.saveFailed', 'Failed to save settings.'),
      );
    } finally {
      setWorktreeSessionsDirSaving(false);
    }
  };

  const accountDisplayLabel = githubAccount?.login ?? analyticsUserId ?? '-';
  const languageOptions = settingsOptions?.languages ?? [];
  const selectedLanguage = languageOptions.find((lang) => lang.code === locale);
  const selectedLanguageLabel = selectedLanguage
    ? translate(`language.${selectedLanguage.code}`, selectedLanguage.label)
    : translate(`language.${locale}`, locale);

  const renderActiveSettingPanel = () => {
    switch (activeSettingsTab) {
      case 'appearance':
        return (
          <div className="settings-content-panel settings-preferences-panel space-y-7">
            <div>
              <h3 className="settings-preference-main-title">{t('settings.appearance.title')}</h3>
              <p className="settings-preference-panel-desc mt-0.5">{t('settings.appearance.desc')}</p>
            </div>

            <section className="space-y-2.5">
              <h4 className="settings-section-header">
                {translate('settings.appearance.group.appearance', 'Appearance')}
              </h4>
              <div className="settings-list-group rounded-lg border">
                <div className="settings-theme-selector-row border-b border-[var(--hairline)] px-4 py-3.5">
                  <div
                    className="grid grid-cols-3 gap-5"
                    aria-label={t('settings.appearance.theme')}
                  >
                    {([
                      {
                        id: 'dark',
                        label: t('settings.appearance.darkThemeDefault'),
                        Icon: Moon,
                      },
                      {
                        id: 'light',
                        label: t('settings.appearance.lightThemeInverted'),
                        Icon: Sun,
                      },
                      {
                        id: 'system',
                        label: t('settings.appearance.systemTheme'),
                        Icon: Monitor,
                      },
                    ] as const).map((option) => {
                      const selected = themePreference === option.id;
                      const lightPreview = option.id === 'light';
                      const systemPreview = option.id === 'system';
                      const Icon = option.Icon;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setTheme(option.id)}
                          aria-pressed={selected}
                          className={cn(
                            'cursor-pointer rounded-[8px] border p-2 text-left transition',
                            selected
                              ? 'border-[var(--primary)] bg-white/[0.07] shadow-[inset_0_0_0_1px_rgba(94,106,210,0.26),inset_0_1px_18px_rgba(94,106,210,0.08)]'
                              : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]',
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-8 items-center justify-between rounded-[8px] border px-2.5',
                              lightPreview
                                ? 'border-black/[0.08] bg-[#f5f6f8]'
                                : systemPreview
                                  ? 'border-white/[0.08] bg-[#151516]'
                                  : 'border-white/[0.08] bg-[#0d0d0e]',
                            )}
                          >
                            <Icon
                              className={cn(
                                'h-3.5 w-3.5',
                                lightPreview ? 'text-[#52525b]' : 'text-white',
                              )}
                              strokeWidth={1.4}
                            />
                            <div className="flex items-end gap-1">
                              <span
                                className={cn(
                                  'h-2 w-3.5 rounded-[2px]',
                                  lightPreview
                                    ? 'bg-black/[0.18]'
                                    : systemPreview
                                      ? 'bg-white/[0.14]'
                                      : 'bg-white/[0.16]',
                                )}
                              />
                              <span
                                className={cn(
                                  'h-3 w-3.5 rounded-[2px]',
                                  lightPreview
                                    ? 'bg-black/[0.24]'
                                    : systemPreview
                                      ? 'bg-[#d4d4d8]/70'
                                      : 'bg-white/[0.22]',
                                )}
                              />
                              <span
                                className={cn(
                                  'h-1.5 w-3.5 rounded-[2px]',
                                  lightPreview
                                    ? 'bg-black/[0.12]'
                                    : systemPreview
                                      ? 'bg-white/[0.09]'
                                      : 'bg-white/[0.1]',
                                )}
                              />
                            </div>
                          </div>
                          <p
                            className="settings-row-title mt-1.5 leading-tight"
                          >
                            {option.label}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="settings-preference-row flex flex-col gap-3 border-b border-[var(--hairline)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="settings-row-title leading-tight">
                      {t('settings.appearance.pageLanguage')}
                    </p>
                  </div>
                  <div
                    className="settings-language-dropdown relative w-full shrink-0 sm:w-[220px]"
                    onBlur={(event) => {
                      const nextFocus = event.relatedTarget as Node | null;
                      if (!event.currentTarget.contains(nextFocus)) {
                        setLanguageMenuOpen(false);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="settings-language-trigger flex w-full items-center gap-2 rounded-md border px-3 py-2 transition disabled:cursor-not-allowed disabled:opacity-50"
                      aria-haspopup="listbox"
                      aria-expanded={languageMenuOpen}
                      disabled={languageOptions.length === 0}
                      onClick={() => setLanguageMenuOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setLanguageMenuOpen(false);
                        }
                      }}
                    >
                      <Languages className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {selectedLanguageLabel}
                      </span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                          languageMenuOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {languageMenuOpen && languageOptions.length > 0 && (
                      <div
                        className="settings-language-menu absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-md border"
                        role="listbox"
                        aria-label={t('settings.appearance.pageLanguage')}
                      >
                        {languageOptions.map((lang) => {
                          const selected = locale === lang.code;
                          return (
                            <button
                              key={lang.code}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              className={`settings-language-menu-option flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition ${
                                selected
                                  ? 'settings-language-menu-option-active'
                                  : ''
                              }`}
                              onClick={() => {
                                setLocale(lang.code);
                                setLanguageMenuOpen(false);
                              }}
                            >
                              <span className="truncate">
                                {translate(`language.${lang.code}`, lang.label)}
                              </span>
                              {selected && (
                                <Check className="h-3.5 w-3.5 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <NotificationSettingRow
                  title={t('settings.appearance.chatMessageFontSize')}
                  description={t('settings.appearance.chatMessageFontSizeDesc')}
                  divided={false}
                  control={
                    <DropdownSelect
                      value={String(chatMessageFontSize)}
                      options={chatMessageFontSizeOptions}
                      showSearch={false}
                      placeholder={t('settings.appearance.chatMessageFontSize')}
                      onChange={(value) =>
                        setChatMessageFontSize(Number(value))
                      }
                      className="w-full shrink-0 sm:w-[132px]"
                      maxPanelHeightClassName="max-h-[180px]"
                    />
                  }
                />
              </div>
            </section>

            <section className="space-y-2.5">
              <h4 className="settings-section-header">
                {translate('settings.appearance.group.environment', 'Environment')}
              </h4>
              <div className="settings-list-group rounded-lg border">
                <div className="settings-preference-row flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="settings-row-title leading-tight">
                      {translate(
                        'settings.storage.worktreeSessionsDir',
                        'Default git worktree directory',
                      )}
                    </p>
                    <p className="settings-row-description mt-1 leading-snug">
                      {translate(
                        'settings.storage.worktreeSessionsDirDesc',
                        'Choose where isolated session worktree folders are created.',
                      )}
                    </p>
                  </div>
                  <div className="flex min-w-0 shrink-0 flex-col gap-2 lg:w-[420px] lg:flex-row lg:items-center">
                    <input
                      type="text"
                      value={worktreeSessionsDirDraft}
                      onChange={(event) =>
                        setWorktreeSessionsDirDraft(event.target.value)
                      }
                      onBlur={() =>
                        void persistWorktreeSessionsDir(worktreeSessionsDirDraft)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder={worktreeSessionsDirPlaceholder}
                      className="settings-path-input min-h-9 min-w-0 flex-1 rounded-md border px-3 font-mono text-sm outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSelectWorktreeSessionsDir()}
                      disabled={
                        worktreeSessionsDirSaving ||
                        worktreeSessionsDirSelecting ||
                        !configAsync.data
                      }
                      className="settings-secondary-button inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {worktreeSessionsDirSaving
                        ? translate('settings.storage.saving', 'Saving...')
                        : translate('settings.storage.browse', 'Browse')}
                    </button>
                  </div>
                </div>
                {worktreeSessionsDirMessage && (
                  <p className="border-t border-[var(--hairline)] px-4 py-2 text-xs text-[var(--ink-subtle)]">
                    {worktreeSessionsDirMessage}
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-2.5">
              <h4 className="settings-section-header">
                {translate('settings.appearance.group.actions', 'Actions')}
              </h4>
              <div className="settings-list-group overflow-hidden rounded-lg border">
                <NotificationSettingRow
                  title={t('settings.onboarding.resetGuide')}
                  description={t('settings.onboarding.resetGuideDesc')}
                  control={
                    <button
                      type="button"
                      onClick={() => void handleResetOnboardingGuide()}
                      disabled={Boolean(onboardingAction)}
                      className="settings-secondary-button inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className={`h-3.5 w-3.5 ${onboardingAction === 'reset' ? 'animate-spin' : ''}`} />
                      {onboardingAction === 'reset'
                        ? t('settings.onboarding.working')
                        : t('settings.onboarding.resetGuide')}
                    </button>
                  }
                />
                <NotificationSettingRow
                  title={t('settings.onboarding.replayUpgrade')}
                  description={t('settings.onboarding.replayUpgradeDesc')}
                  divided={false}
                  control={
                    <button
                      type="button"
                      onClick={() => void handleReplayUpgradeGuide()}
                      disabled={Boolean(onboardingAction)}
                      className="settings-secondary-button inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CircleArrowUp className={`h-3.5 w-3.5 ${onboardingAction === 'upgrade' ? 'animate-pulse' : ''}`} />
                      {onboardingAction === 'upgrade'
                        ? t('settings.onboarding.working')
                        : t('settings.onboarding.replayUpgrade')}
                    </button>
                  }
                />
              </div>
            </section>
          </div>
        );

      case 'notifications': {
        const soundOptions: DropdownSelectOption[] = [
          {
            id: SoundFile.ABSTRACT_SOUND1,
            label: translate(
              'settings.notifications.sound.abstractSound1',
              'Abstract sound 1',
            ),
          },
          {
            id: SoundFile.ABSTRACT_SOUND2,
            label: translate(
              'settings.notifications.sound.abstractSound2',
              'Abstract sound 2',
            ),
          },
          {
            id: SoundFile.ABSTRACT_SOUND3,
            label: translate(
              'settings.notifications.sound.abstractSound3',
              'Abstract sound 3',
            ),
          },
          {
            id: SoundFile.ABSTRACT_SOUND4,
            label: translate(
              'settings.notifications.sound.abstractSound4',
              'Abstract sound 4',
            ),
          },
          {
            id: SoundFile.PHONE_VIBRATION,
            label: translate(
              'settings.notifications.sound.phoneVibration',
              'Phone vibration',
            ),
          },
          {
            id: SoundFile.ROOSTER,
            label: translate(
              'settings.notifications.sound.rooster',
              'Rooster',
            ),
          },
          {
            id: SoundFile.COW_MOOING,
            label: translate(
              'settings.notifications.sound.cowMooing',
              'Cow mooing',
            ),
          },
        ];
        const notificationSourceRows: Array<{
          key: keyof NotificationInboxSourcesConfig;
          titleKey: string;
          descKey: string;
        }> = [
          {
            key: 'chat_message',
            titleKey: 'settings.notifications.source.chatMessage.title',
            descKey: 'settings.notifications.source.chatMessage.desc',
          },
          {
            key: 'workflow_action',
            titleKey: 'settings.notifications.source.workflowAction.title',
            descKey: 'settings.notifications.source.workflowAction.desc',
          },
          {
            key: 'approval',
            titleKey: 'settings.notifications.source.approval.title',
            descKey: 'settings.notifications.source.approval.desc',
          },
          {
            key: 'worktree',
            titleKey: 'settings.notifications.source.worktree.title',
            descKey: 'settings.notifications.source.worktree.desc',
          },
          {
            key: 'failure',
            titleKey: 'settings.notifications.source.failure.title',
            descKey: 'settings.notifications.source.failure.desc',
          },
        ];

        return (
          <div className="settings-content-panel settings-notifications-panel space-y-10 text-sm">
            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.notifications.inboxSources.title')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-subtle)]">{t('settings.notifications.inboxSources.desc')}</p>
              </div>

              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                {notificationSourceRows.map((row, index) => (
                  <NotificationSettingRow
                    key={row.key}
                    title={t(row.titleKey)}
                    description={t(row.descKey)}
                    checked={notificationConfig.inbox_sources[row.key]}
                    disabled={notificationSettingsDisabled}
                    onToggle={() =>
                      void persistNotificationConfig(
                        {
                          inbox_sources: {
                            ...notificationConfig.inbox_sources,
                            [row.key]: !notificationConfig.inbox_sources[row.key],
                          },
                        },
                        'inbox_sources',
                      )
                    }
                    divided={index < notificationSourceRows.length - 1}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)] tracking-tight">{t('settings.notifications.system.title')}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink-subtle)]">{t('settings.notifications.system.desc')}</p>
              </div>

              {notificationSettingsMessage && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {notificationSettingsMessage}
                </p>
              )}

              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)]">
                <NotificationSettingRow
                  title={t('settings.notifications.systemBanner.title')}
                  description={t('settings.notifications.systemBanner.desc')}
                  checked={notificationConfig.push_enabled}
                  disabled={notificationSettingsDisabled}
                  onToggle={() =>
                    void persistNotificationConfig(
                      { push_enabled: !notificationConfig.push_enabled },
                      'push_enabled',
                    )
                  }
                />
                <NotificationSettingRow
                  title={t('settings.notifications.soundEnabled.title')}
                  description={t('settings.notifications.soundEnabled.desc')}
                  checked={notificationConfig.sound_enabled}
                  disabled={notificationSettingsDisabled}
                  onToggle={() =>
                    void persistNotificationConfig(
                      { sound_enabled: !notificationConfig.sound_enabled },
                      'sound_enabled',
                    )
                  }
                />
                <NotificationSettingRow
                  title={t('settings.notifications.soundSelect.title')}
                  description={t('settings.notifications.soundSelect.desc')}
                  divided={false}
                  control={
                    <DropdownSelect
                      value={notificationConfig.sound_file}
                      options={soundOptions}
                      showSearch={false}
                      disabled={
                        notificationSettingsDisabled ||
                        !notificationConfig.sound_enabled
                      }
                      placeholder={t('settings.notifications.soundSelect.placeholder')}
                      onChange={(value) =>
                        void persistNotificationConfig(
                          { sound_file: value as SoundFile },
                          'sound_file',
                        )
                      }
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

      case 'privacy':
        return (
          <div className="settings-content-panel space-y-8 text-sm">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[var(--ink)]">
                {t('settings.privacy.title')}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--ink-subtle)]">
                {t('settings.privacy.desc')}
              </p>
            </div>

            {privacySettingsMessage && (
              <p
                className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--ink-subtle)]"
                role="status"
              >
                {privacySettingsMessage}
              </p>
            )}

            <section className="space-y-2.5">
              <h4 className="settings-section-header">
                {t('settings.privacy.group.dataSharing')}
              </h4>
              <div className="settings-list-group overflow-hidden rounded-lg border">
                <NotificationSettingRow
                  title={t('settings.privacy.analytics.title')}
                  description={t('settings.privacy.analytics.desc')}
                  checked={analyticsEnabled}
                  disabled={privacySettingsDisabled}
                  onToggle={() =>
                    void persistPrivacySetting(
                      'analytics_enabled',
                      !analyticsEnabled,
                    )
                  }
                />
                <NotificationSettingRow
                  title={t('settings.privacy.errorReporting.title')}
                  description={t('settings.privacy.errorReporting.desc')}
                  checked={errorReportingEnabled}
                  disabled={privacySettingsDisabled}
                  divided={false}
                  onToggle={() =>
                    void persistPrivacySetting(
                      'error_reporting_enabled',
                      !errorReportingEnabled,
                    )
                  }
                />
              </div>
            </section>

            <section className="space-y-2.5">
              <h4 className="settings-section-header">
                {t('settings.privacy.group.collectedData')}
              </h4>
              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-3.5">
                <p className="settings-row-description leading-relaxed">
                  {t('settings.privacy.collectedData')}
                </p>
                <p className="settings-row-description mt-2 leading-relaxed">
                  {t('settings.privacy.excludedData')}
                </p>
              </div>
            </section>
          </div>
        );

      case 'archived-sessions':
        return (
          <div className="settings-content-panel space-y-4">
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
          <div className="settings-content-panel space-y-4">
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
          <div className="settings-content-panel space-y-4">
            <KeyboardShortcutSettings translate={t} />
          </div>
        );

      default:
        return <ProviderSettingsPanel />;
    }
  };

  const renderMenuIcon = (icon: string) => {
    const iconProps = { className: 'h-3.5 w-3.5', strokeWidth: 1.35 };
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
      shield: <ShieldCheck {...iconProps} />,
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
                    className={`settings-nav-row w-full flex min-h-8 items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left border transition-colors ${
                      active 
                        ? 'settings-nav-row-active text-[var(--ink)] font-medium border-transparent' 
                        : 'text-[var(--ink-subtle)] hover:text-[var(--ink)] border-transparent'
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
            isProviderSettingsTab
              ? 'settings-provider-main overflow-hidden'
              : 'overflow-y-auto'
          }`}
        >
          {renderActiveSettingPanel()}
        </main>
      </div>

    </div>
  );
};
