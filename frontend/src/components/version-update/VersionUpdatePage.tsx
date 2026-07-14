import { useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleArrowUp,
  ExternalLink,
  FileText,
  Info,
  Layers3,
  LoaderCircle,
  Monitor,
  RefreshCw,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { VersionCheckResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getUpdatePageViewModel } from '@/lib/updatePresentation';
import type { VersionUpdateCheckStatus } from '@/hooks/useVersionUpdate';
import type { Theme } from '@/types';
import type {
  UpdateErrorInfo,
  UpdateOperationState,
} from '../../../../shared/types';

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

export interface VersionUpdatePageProps {
  currentVersion: string;
  theme: Theme;
  t: TranslateFn;
  onClose: () => void;
  versionUpdateInfo: VersionCheckResponse | null;
  versionUpdateCheckStatus: VersionUpdateCheckStatus;
  versionUpdateCheckError: UpdateErrorInfo | null;
  versionUpdateState: UpdateOperationState | null;
  versionUpdateBusy: boolean;
  onInstallUpdate: () => Promise<void>;
  onCheckUpdate: () => Promise<VersionCheckResponse | null>;
  manualFallbackAvailable: boolean;
  onOpenManualFallback: () => Promise<void>;
}

const updateDetailIconByLabel: Record<string, LucideIcon> = {
  'onboarding.upgrade.checkStatus': RefreshCw,
  'onboarding.upgrade.platform': Monitor,
  'onboarding.upgrade.method': Layers3,
  'onboarding.upgrade.publishedAt': CalendarDays,
  'onboarding.upgrade.signatureVerification': ShieldCheck,
  'onboarding.upgrade.downloadStatus': ArrowRight,
  'onboarding.upgrade.installStatus': Check,
  'onboarding.upgrade.downloadProgress': ArrowRight,
};

const upgradeDarkThemeVars = {
  '--upgrade-sidebar': '#111113',
  '--upgrade-card': '#141415',
  '--upgrade-accent-card': '#151518',
  '--upgrade-text': '#ededed',
  '--upgrade-text-strong': 'rgba(255, 255, 255, 0.9)',
  '--upgrade-text-muted': 'rgba(255, 255, 255, 0.45)',
  '--upgrade-text-subtle': 'rgba(255, 255, 255, 0.35)',
  '--upgrade-text-faint': 'rgba(255, 255, 255, 0.28)',
  '--upgrade-line': 'rgba(255, 255, 255, 0.055)',
  '--upgrade-line-soft': 'rgba(255, 255, 255, 0.045)',
  '--upgrade-fill': 'rgba(255, 255, 255, 0.035)',
  '--upgrade-fill-soft': 'rgba(255, 255, 255, 0.018)',
  '--upgrade-fill-hover': 'rgba(255, 255, 255, 0.035)',
  '--upgrade-shell-shadow':
    '0 20px 60px rgba(0, 0, 0, 0.52), inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
  '--upgrade-card-shadow':
    '0 8px 24px rgba(0, 0, 0, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.055)',
  '--upgrade-accent-card-shadow':
    '0 8px 24px rgba(0, 0, 0, 0.14), inset 0 0 0 1px rgba(122, 162, 247, 0.11)',
  '--upgrade-accent': '#7aa2f7',
  '--upgrade-accent-text': '#8dafef',
  '--upgrade-accent-hover': '#a8c3ff',
  '--upgrade-accent-soft': 'rgba(122, 162, 247, 0.065)',
  '--upgrade-accent-line': 'rgba(122, 162, 247, 0.09)',
  '--upgrade-warning-bg': 'rgba(252, 211, 77, 0.04)',
  '--upgrade-warning-text': 'rgba(254, 243, 199, 0.55)',
  '--upgrade-warning-icon': 'rgba(253, 230, 138, 0.55)',
  '--upgrade-warning-accent': 'rgba(252, 211, 77, 0.32)',
  '--upgrade-warning-line': 'rgba(252, 211, 77, 0.08)',
  '--upgrade-danger-bg': 'rgba(248, 113, 113, 0.045)',
  '--upgrade-danger-text': 'rgba(254, 202, 202, 0.8)',
  '--upgrade-danger-line': 'rgba(248, 113, 113, 0.1)',
  '--upgrade-disabled-border': '#333333',
  '--upgrade-disabled-text': '#666666',
} as CSSProperties;

const upgradeLightThemeVars = {
  '--upgrade-sidebar': '#fbfbfc',
  '--upgrade-card': '#ffffff',
  '--upgrade-accent-card': '#f8f9ff',
  '--upgrade-text': '#202124',
  '--upgrade-text-strong': 'rgba(17, 17, 19, 0.92)',
  '--upgrade-text-muted': 'rgba(43, 45, 52, 0.62)',
  '--upgrade-text-subtle': 'rgba(62, 66, 75, 0.68)',
  '--upgrade-text-faint': 'rgba(82, 86, 96, 0.62)',
  '--upgrade-line': 'rgba(15, 23, 42, 0.1)',
  '--upgrade-line-soft': 'rgba(15, 23, 42, 0.075)',
  '--upgrade-fill': 'rgba(15, 23, 42, 0.045)',
  '--upgrade-fill-soft': 'rgba(15, 23, 42, 0.025)',
  '--upgrade-fill-hover': 'rgba(15, 23, 42, 0.055)',
  '--upgrade-shell-shadow':
    '0 20px 60px rgba(15, 23, 42, 0.18), inset 0 0 0 1px rgba(15, 23, 42, 0.1)',
  '--upgrade-card-shadow':
    '0 8px 24px rgba(15, 23, 42, 0.07), inset 0 0 0 1px rgba(15, 23, 42, 0.09)',
  '--upgrade-accent-card-shadow':
    '0 8px 24px rgba(55, 65, 120, 0.08), inset 0 0 0 1px rgba(94, 106, 210, 0.18)',
  '--upgrade-accent': '#5e6ad2',
  '--upgrade-accent-text': '#4f5bc5',
  '--upgrade-accent-hover': '#3846b5',
  '--upgrade-accent-soft': 'rgba(94, 106, 210, 0.09)',
  '--upgrade-accent-line': 'rgba(94, 106, 210, 0.14)',
  '--upgrade-warning-bg': 'rgba(245, 158, 11, 0.08)',
  '--upgrade-warning-text': 'rgba(146, 64, 14, 0.82)',
  '--upgrade-warning-icon': 'rgba(180, 83, 9, 0.76)',
  '--upgrade-warning-accent': 'rgba(217, 119, 6, 0.58)',
  '--upgrade-warning-line': 'rgba(217, 119, 6, 0.18)',
  '--upgrade-danger-bg': 'rgba(239, 68, 68, 0.07)',
  '--upgrade-danger-text': 'rgba(185, 28, 28, 0.84)',
  '--upgrade-danger-line': 'rgba(220, 38, 38, 0.16)',
  '--upgrade-disabled-border': '#d7d9df',
  '--upgrade-disabled-text': '#9a9da5',
} as CSSProperties;

const updateMonoFont = {
  fontFamily:
    '"JetBrains Mono", "SF Mono", "SFMono-Regular", ui-monospace, "Cascadia Code", monospace',
} as CSSProperties;

const updateNoiseTextureStyle = {
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27128%27 height=%27128%27 viewBox=%270 0 128 128%27%3E%3Cfilter id=%27noise%27 x=%270%27 y=%270%27 width=%27100%25%27 height=%27100%25%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.82%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27128%27 height=%27128%27 filter=%27url(%23noise)%27 opacity=%270.68%27/%3E%3C/svg%3E")',
} as CSSProperties;

export function VersionUpdatePage({
  currentVersion,
  theme,
  t,
  onClose,
  versionUpdateInfo,
  versionUpdateCheckStatus,
  versionUpdateCheckError,
  versionUpdateState,
  versionUpdateBusy,
  onInstallUpdate,
  onCheckUpdate,
  manualFallbackAvailable,
  onOpenManualFallback,
}: VersionUpdatePageProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentDisplay = versionUpdateInfo?.current_version ?? currentVersion;
  const latestDisplay = versionUpdateInfo?.latest_version ?? currentVersion;
  const releaseNotes = versionUpdateInfo?.release_notes?.trim();
  const hasUpdate = Boolean(versionUpdateInfo?.has_update);
  const updateView = getUpdatePageViewModel({
    info: versionUpdateInfo,
    checkStatus: versionUpdateCheckStatus,
    checkError: versionUpdateCheckError,
    operation: versionUpdateState,
    isBusy: versionUpdateBusy || saving,
    manualFallbackAvailable,
  });
  const updateButtonLabel = saving
    ? t('onboarding.upgrade.installing')
    : t(updateView.primaryAction.labelKey);
  const themeStyle = {
    ...(theme === 'light' ? upgradeLightThemeVars : upgradeDarkThemeVars),
    '--upgrade-shell': 'var(--surface-2)',
    '--upgrade-toolbar': 'var(--surface-2)',
    colorScheme: theme,
    fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
  } as CSSProperties;

  const handleInstallUpdate = async () => {
    setSaving(true);
    setError(null);
    try {
      await onInstallUpdate();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.upgrade.installFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleOpenManualFallback = async () => {
    setSaving(true);
    setError(null);
    try {
      await onOpenManualFallback();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.upgrade.installFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCheckUpdate = async () => {
    setSaving(true);
    setError(null);
    try {
      await onCheckUpdate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-2 text-[var(--upgrade-text)] backdrop-blur-[2px] [scrollbar-width:none] sm:p-3 [&::-webkit-scrollbar]:hidden',
        theme === 'light' ? 'bg-slate-950/20' : 'bg-black/45',
      )}
      style={themeStyle}
    >
      <div className="w-full max-w-[1080px]">
        <section className="relative isolate flex h-[min(720px,calc(100vh-32px))] min-h-[560px] w-full flex-col overflow-hidden rounded-[12px] bg-[var(--upgrade-shell)] text-[var(--upgrade-text-strong)] shadow-[var(--upgrade-shell-shadow)]">
          <div className="pointer-events-none absolute inset-0 bg-[var(--upgrade-shell)]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025] mix-blend-soft-light"
            style={updateNoiseTextureStyle}
          />
          <div className="relative z-10 flex min-h-11 items-center gap-2 bg-[var(--upgrade-toolbar)] px-3 py-2.5 shadow-[inset_0_-1px_0_var(--upgrade-line)] backdrop-blur-xl">
            <span className="h-2 w-2 rounded-full border border-[var(--upgrade-line)] bg-[var(--upgrade-fill)]" />
            <span className="h-2 w-2 rounded-full border border-[var(--upgrade-line)] bg-[var(--upgrade-fill)]" />
            <span className="h-2 w-2 rounded-full border border-[var(--upgrade-line)] bg-[var(--upgrade-fill)]" />
            <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-[var(--upgrade-line)] bg-[var(--upgrade-fill)] px-2.5 py-1.5">
              <CircleArrowUp className="h-3.5 w-3.5 shrink-0 text-[var(--upgrade-text-subtle)]" strokeWidth={1.25} />
              <span className="truncate font-sans text-[11px] font-medium tracking-[0] text-[var(--upgrade-text-muted)]">
                {t('onboarding.upgrade.eyebrow', { version: latestDisplay })}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('onboarding.upgrade.later')}
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-[var(--upgrade-text-subtle)] transition hover:border-[var(--upgrade-line)] hover:bg-[var(--upgrade-fill-hover)] hover:text-[var(--upgrade-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--upgrade-accent)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 overflow-y-auto [scrollbar-width:none] lg:grid-cols-[minmax(0,1fr)_328px] lg:overflow-hidden [&::-webkit-scrollbar]:hidden">
            <main className="flex min-h-0 min-w-0 flex-col overflow-y-auto px-6 pb-[10px] pt-6 [scrollbar-width:none] sm:px-8 lg:overflow-hidden lg:px-9 [&::-webkit-scrollbar]:hidden">
              <p
                className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--upgrade-text-subtle)]"
                style={updateMonoFont}
              >
                {t('onboarding.upgrade.eyebrow', { version: latestDisplay })}
              </p>
              <h1 className="mt-3 max-w-2xl font-sans text-[28px] font-[600] leading-tight tracking-[-0.02em] text-[var(--upgrade-text)] sm:text-[32px]">
                {t('onboarding.upgrade.title')}
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[var(--upgrade-text-muted)] sm:text-[15px]">
                {t('onboarding.upgrade.desc')}
              </p>

              {updateView.primaryAction.labelKey === 'onboarding.upgrade.updateUnsupported' && (
                <div className="mt-6 flex items-center gap-2 rounded-[4px] border-l-2 border-[var(--upgrade-warning-accent)] bg-[var(--upgrade-warning-bg)] px-3 py-2.5 text-[13px] text-[var(--upgrade-warning-text)]">
                  <Info className="h-4 w-4 shrink-0 text-[var(--upgrade-warning-icon)]" strokeWidth={1.25} />
                  {t('onboarding.upgrade.updateUnsupported')}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[var(--upgrade-text-muted)]">
                    {t('onboarding.upgrade.currentVersion')}
                  </span>
                  <span className="truncate font-sans text-[14px] font-semibold tracking-[-0.015em] text-[var(--upgrade-text-strong)]">
                    {currentDisplay}
                  </span>
                  <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-[var(--upgrade-fill)] px-1.5 font-sans text-[10px] font-medium text-[var(--upgrade-text-muted)]">
                    {t('onboarding.upgrade.installedTag')}
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--upgrade-text-faint)]" strokeWidth={1.25} />
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[var(--upgrade-text-muted)]">
                    {t('onboarding.upgrade.latestVersion')}
                  </span>
                  <span className="truncate font-sans text-[14px] font-semibold tracking-[-0.015em] text-[var(--upgrade-text-strong)]">
                    {latestDisplay}
                  </span>
                  <span className="inline-flex h-5 shrink-0 items-center rounded-[4px] bg-[var(--upgrade-fill)] px-1.5 font-sans text-[10px] font-medium text-[var(--upgrade-text-muted)]">
                    {t('onboarding.upgrade.releaseTag')}
                  </span>
                </div>
              </div>

              <section className="mt-6 flex min-h-0 flex-1 flex-col border-t border-[var(--upgrade-line)] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="h-5 w-[2px] rounded-full bg-[#5E6AD2]" />
                    <FileText className="h-4 w-4 text-[var(--upgrade-text-subtle)]" strokeWidth={1.25} />
                    <h2 className="text-[16px] font-medium tracking-[-0.01em] text-[var(--upgrade-text)]">
                      {t('onboarding.upgrade.releaseNotes')}
                    </h2>
                  </div>
                  {versionUpdateInfo?.release_url && (
                    <a
                      href={versionUpdateInfo.release_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--upgrade-accent)] transition hover:-translate-y-px hover:text-[var(--upgrade-accent-hover)] hover:underline"
                    >
                      {t('onboarding.upgrade.viewFullChangelog')}
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.25} />
                    </a>
                  )}
                </div>
                <div className="mt-3.5 min-h-0 flex-1 overflow-y-auto break-words font-sans text-[13px] leading-[1.75] tracking-[0] text-[var(--upgrade-text-muted)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_a]:text-[var(--upgrade-accent)] [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:rounded [&_code]:bg-[var(--upgrade-fill)] [&_code]:px-1 [&_h1]:mb-3 [&_h1]:font-semibold [&_h1]:text-[var(--upgrade-text-strong)] [&_h2]:mb-3 [&_h2]:font-semibold [&_h2]:text-[var(--upgrade-text-strong)] [&_h3]:mb-2 [&_h3]:font-medium [&_h3]:text-[var(--upgrade-text-strong)] [&_li]:pl-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-[var(--upgrade-text-faint)]">
                  <ReactMarkdown>
                    {releaseNotes || t('onboarding.upgrade.releaseNotesEmpty')}
                  </ReactMarkdown>
                </div>
              </section>
            </main>

            <aside className="flex min-h-0 flex-col overflow-hidden border-t border-[var(--upgrade-line)] bg-[var(--upgrade-shell)] px-5 py-6 lg:border-l lg:border-t-0">
              <h2 className="font-sans text-[14px] font-medium tracking-[-0.01em] text-[var(--upgrade-text)]">
                {t('onboarding.upgrade.stateTitle')}
              </h2>
              <div className="mt-4 min-h-0 flex-1 divide-y divide-[var(--upgrade-line-soft)] overflow-y-auto text-[12px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {updateView.rows.map(({ labelKey, valueKey, value }) => (
                  <div key={labelKey} className="grid min-h-9 grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 px-4 py-1.5">
                    <span className="flex min-w-0 items-center gap-2 text-[var(--upgrade-text-subtle)]">
                      {(() => {
                        const DetailIcon = updateDetailIconByLabel[labelKey] ?? Info;
                        return <DetailIcon className="h-3.5 w-3.5 shrink-0 text-[var(--upgrade-text-faint)]" strokeWidth={1.25} />;
                      })()}
                      <span className="truncate text-[11px] font-medium">{t(labelKey)}</span>
                    </span>
                    <span className="truncate text-right font-sans text-[11px] font-medium text-[var(--upgrade-text-strong)]">
                      {valueKey ? t(valueKey) : value}
                    </span>
                  </div>
                ))}
                {versionUpdateInfo?.release_url && (
                  <a
                    href={versionUpdateInfo.release_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-9 items-center justify-between gap-3 px-4 py-1.5 text-[var(--upgrade-accent)] transition hover:bg-[var(--upgrade-fill-hover)] hover:text-[var(--upgrade-accent-hover)]"
                  >
                    <span className="flex items-center gap-2 text-[11px] font-medium">
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.25} />
                      {t('onboarding.upgrade.releaseLink')}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.25} />
                  </a>
                )}
              </div>
              {(error ?? updateView.error?.message) && (
                <p className="mt-4 rounded-[8px] bg-[var(--upgrade-danger-bg)] px-3 py-2.5 text-[12px] leading-5 text-[var(--upgrade-danger-text)] shadow-[inset_0_0_0_1px_var(--upgrade-danger-line)]">
                  {error ?? updateView.error?.message}
                </p>
              )}
              <div className="relative z-10 mt-auto grid shrink-0 gap-2 bg-[var(--upgrade-shell)] pt-5">
                <button
                  type="button"
                  onClick={() => void (updateView.primaryAction.kind === 'check' ? handleCheckUpdate() : handleInstallUpdate())}
                  disabled={updateView.primaryAction.disabled || (!hasUpdate && updateView.primaryAction.kind !== 'check')}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-[8px] border border-[#727ee0] bg-[#5E6AD2] px-5 py-2 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_20px_rgba(32,37,105,0.28)] transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-px hover:bg-[#6874d9] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_12px_24px_rgba(32,37,105,0.34)] active:translate-y-0 disabled:cursor-not-allowed disabled:border-[var(--upgrade-disabled-border)] disabled:bg-transparent disabled:text-[var(--upgrade-disabled-text)] disabled:shadow-none disabled:opacity-100"
                >
                  {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {updateButtonLabel}
                </button>
                {updateView.manualFallbackAvailable && (
                  <button
                    type="button"
                    onClick={() => void handleOpenManualFallback()}
                    disabled={saving}
                    className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[8px] border border-[var(--upgrade-line)] bg-transparent px-4 py-2 text-[12px] font-medium text-[var(--upgrade-text-muted)] transition hover:-translate-y-px hover:border-[var(--upgrade-text-faint)] hover:bg-[var(--upgrade-fill-hover)] hover:text-[var(--upgrade-text)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('onboarding.upgrade.openManualFallback')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[8px] border border-transparent px-4 py-2 text-[12px] font-medium text-[var(--upgrade-text-muted)] transition hover:-translate-y-px hover:bg-[var(--upgrade-fill-hover)] hover:text-[var(--upgrade-text)]"
                >
                  {t('onboarding.upgrade.later')}
                </button>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
