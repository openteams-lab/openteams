import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { JsonValue } from 'shared/types';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';
import { Tooltip } from '@/components/ui-new/primitives/Tooltip';
import { cn } from '@/lib/utils';
import { toPrettyCase } from '@/utils/string';
import {
  getLocalizedMemberPresetNameById,
  type MemberPresetImportPlan,
} from '../utils';
import { AgentSkillsSection } from './AgentSkillsSection';

interface TeamImportPreviewModalProps {
  isOpen: boolean;
  importName: string | null;
  importPlan: MemberPresetImportPlan[] | null;
  teamImportProtocol: string | null;
  isImportingTeam: boolean;
  isCheckingAvailability: boolean;
  enabledRunnerTypes: string[];
  availableRunnerTypes: string[];
  isRunnerAvailable: (runner: string) => boolean;
  availabilityLabel: (runner: string) => string;
  workspacePathPlaceholder: string;
  memberError: string | null;
  getVariantOptions: (runnerType: string) => string[];
  getVariantLabel: (runnerType: string, variant: string) => string;
  getPlanVariant: (toolsEnabled: JsonValue) => string;
  onVariantChange: (
    index: number,
    variant: string,
    currentToolsEnabled: JsonValue
  ) => void;
  onUpdatePlanEntry: (
    index: number,
    updates: {
      finalName?: string;
      workspacePath?: string;
      runnerType?: string;
      systemPrompt?: string;
      toolsEnabled?: JsonValue;
      selectedSkillIds?: string[];
    }
  ) => void;
  onExpandPromptEditor: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

interface PreviewSectionProps {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

const CARD_SWITCH_WHEEL_STEPS = 2;
const CARD_SWITCH_WHEEL_RESET_MS = 520;
const CARD_SWITCH_WHEEL_COOLDOWN_MS = 260;

function PreviewSection({
  step,
  title,
  description,
  children,
  className,
}: PreviewSectionProps) {
  return (
    <section
      className={cn(
        'rounded-[22px] border border-slate-200/70 bg-slate-50/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_12px_32px_rgba(148,163,184,0.08)]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-white text-[11px] font-semibold tracking-[0.2em] text-[#5094FB] shadow-sm">
          {step}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {description}
          </div>
        </div>
      </div>

      <div className="mt-4">{children}</div>
    </section>
  );
}

function getActionTone(action: MemberPresetImportPlan['action']) {
  if (action === 'create') {
    return {
      pill: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
      step: 'bg-emerald-100 text-emerald-700',
    };
  }

  if (action === 'reuse') {
    return {
      pill: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100',
      step: 'bg-indigo-100 text-indigo-700',
    };
  }

  return {
    pill: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    step: 'bg-slate-200 text-slate-600',
  };
}

export function TeamImportPreviewModal({
  isOpen,
  importName,
  importPlan,
  teamImportProtocol,
  isImportingTeam,
  isCheckingAvailability,
  enabledRunnerTypes,
  availableRunnerTypes,
  isRunnerAvailable,
  availabilityLabel,
  workspacePathPlaceholder,
  memberError,
  getVariantOptions,
  getVariantLabel,
  getPlanVariant,
  onVariantChange,
  onUpdatePlanEntry,
  onExpandPromptEditor,
  onConfirm,
  onCancel,
}: TeamImportPreviewModalProps) {
  const { t } = useTranslation('chat');
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const wheelCooldownRef = useRef<number | null>(null);
  const wheelIntentResetRef = useRef<number | null>(null);
  const wheelIntentRef = useRef({ direction: 0, count: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isImportingTeam) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImportingTeam, isOpen, onCancel]);

  useEffect(() => {
    if (!isOpen || !importPlan?.length) return;
    setCurrentCardIndex(0);
  }, [isOpen, importPlan?.length]);

  useEffect(() => {
    if (!importPlan?.length) return;
    setCurrentCardIndex((prev) => Math.min(prev, importPlan.length - 1));
  }, [importPlan?.length]);

  useEffect(
    () => () => {
      if (wheelCooldownRef.current !== null) {
        window.clearTimeout(wheelCooldownRef.current);
      }
      if (wheelIntentResetRef.current !== null) {
        window.clearTimeout(wheelIntentResetRef.current);
      }
    },
    []
  );

  if (!isOpen || !importPlan || importPlan.length === 0) return null;

  const isTeamImport = importPlan.length > 1;
  const activeCardIndex = Math.min(currentCardIndex, importPlan.length - 1);
  const currentPlan = importPlan[activeCardIndex];
  const currentPlanVariant = getPlanVariant(currentPlan.toolsEnabled);
  const currentPlanVariantOptions = getVariantOptions(currentPlan.runnerType);
  const currentMemberName = getLocalizedMemberPresetNameById(
    currentPlan.presetId,
    currentPlan.presetName || currentPlan.presetId,
    t
  );
  const currentActionLabel =
    currentPlan.action === 'create'
      ? t('members.importPreview.actionCreate')
      : currentPlan.action === 'reuse'
        ? t('members.importPreview.actionReuse')
        : t('members.importPreview.actionSkip');
  const currentActionTone = getActionTone(currentPlan.action);

  const resetWheelIntent = () => {
    wheelIntentRef.current = { direction: 0, count: 0 };
    if (wheelIntentResetRef.current !== null) {
      window.clearTimeout(wheelIntentResetRef.current);
      wheelIntentResetRef.current = null;
    }
  };

  const handleCardWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (importPlan.length <= 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('.skills-dropdown-scroll')
    ) {
      return;
    }

    const currentTarget = event.currentTarget;
    const atTop = currentTarget.scrollTop <= 1;
    const atBottom =
      currentTarget.scrollTop + currentTarget.clientHeight >=
      currentTarget.scrollHeight - 1;
    const direction = event.deltaY > 0 ? 1 : -1;
    const canSwitch = (direction > 0 && atBottom) || (direction < 0 && atTop);

    if (!canSwitch) {
      resetWheelIntent();
      return;
    }

    event.preventDefault();

    if (wheelCooldownRef.current !== null) return;

    if (wheelIntentRef.current.direction !== direction) {
      wheelIntentRef.current = { direction, count: 1 };
    } else {
      wheelIntentRef.current = {
        direction,
        count: wheelIntentRef.current.count + 1,
      };
    }

    if (wheelIntentResetRef.current !== null) {
      window.clearTimeout(wheelIntentResetRef.current);
    }
    wheelIntentResetRef.current = window.setTimeout(() => {
      resetWheelIntent();
    }, CARD_SWITCH_WHEEL_RESET_MS);

    if (wheelIntentRef.current.count < CARD_SWITCH_WHEEL_STEPS) return;

    const nextIndex = Math.min(
      importPlan.length - 1,
      Math.max(0, activeCardIndex + direction)
    );

    if (nextIndex === activeCardIndex) {
      resetWheelIntent();
      return;
    }

    setCurrentCardIndex(nextIndex);
    resetWheelIntent();
    wheelCooldownRef.current = window.setTimeout(() => {
      wheelCooldownRef.current = null;
    }, CARD_SWITCH_WHEEL_COOLDOWN_MS);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm">
      <div
        className={cn(
          'team-import-preview-modal chat-session-modal-surface flex flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/72 shadow-[0_28px_90px_rgba(15,23,42,0.24)] backdrop-blur-[24px]',
          isTeamImport
            ? 'h-[88vh] max-h-[88vh] w-[min(90vw,980px)] max-w-[980px]'
            : 'h-[78vh] max-h-[78vh] w-[min(82vw,700px)] max-w-[700px]'
        )}
      >
        <div className="flex items-start justify-between gap-6 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#5094FB]">
              {t('members.importPreview.previewEyebrow')}
            </div>
            <div className="mt-3 text-[30px] font-semibold leading-none text-slate-950">
              {importName ?? t('members.importPreview.confirmImport')}
            </div>
            <div className="mt-3 max-w-[560px] text-sm leading-6 text-slate-500">
              {t('members.importPreview.description')}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isImportingTeam}
            className={cn(
              'inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/70 text-slate-500 shadow-sm backdrop-blur-md transition-colors hover:bg-white hover:text-slate-900',
              isImportingTeam && 'cursor-not-allowed opacity-50'
            )}
            aria-label={t('members.importPreview.cancel')}
          >
            <XIcon size={18} />
          </button>
        </div>
        {teamImportProtocol ? (
          <div className="mx-6 mb-4 rounded-[18px] border border-[#dbe7f5] bg-[#f8fbff] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5094FB]">
              {t('members.teamProtocol.title')}
            </div>
            <Tooltip content={teamImportProtocol} side="bottom">
              <div className="mt-2 truncate text-sm leading-6 text-slate-600">
                {teamImportProtocol}
              </div>
            </Tooltip>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden px-5 pb-4">
          <div className="flex h-full min-h-0 gap-5">
            <div className="min-h-0 min-w-0 flex-1">
              <div
                key={`${currentPlan.presetId}-${activeCardIndex}`}
                className="chat-session-member-import-card flex h-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/75 bg-white/78 shadow-[0_18px_44px_rgba(148,163,184,0.14)] animate-in fade-in-0 duration-200"
              >
                <div className="rounded-[22px] bg-[radial-gradient(circle_at_top_left,_rgba(80,148,251,0.18),_rgba(255,255,255,0)_42%),linear-gradient(180deg,_rgba(255,255,255,0.88)_0%,_rgba(241,245,249,0.72)_100%)] px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                        {t('members.importPreview.memberCounter', {
                          index: activeCardIndex + 1,
                          total: importPlan.length,
                        })}
                      </div>
                      <div className="mt-3 truncate text-[26px] font-semibold text-slate-950">
                        {currentMemberName}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
                            currentActionTone.pill
                          )}
                        >
                          {currentActionLabel}
                        </span>
                        {currentPlan.runnerType && (
                          <span className="inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200/80">
                            {toPrettyCase(currentPlan.runnerType)}
                          </span>
                        )}
                        <span className="truncate text-sm text-slate-500">
                          @{currentPlan.finalName}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4"
                  onWheel={handleCardWheel}
                >
                  {currentPlan.action !== 'skip' ? (
                    <div className="space-y-4">
                      <PreviewSection
                        step="01"
                        title={t('members.importPreview.sections.basics')}
                        description={t(
                          'members.importPreview.sections.basicsDescription'
                        )}
                      >
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              {t('members.memberNameLabel')}
                            </label>
                            <input
                              value={currentPlan.finalName}
                              onChange={(event) =>
                                onUpdatePlanEntry(activeCardIndex, {
                                  finalName: event.target.value,
                                })
                              }
                              placeholder={t('members.memberNamePlaceholder')}
                              disabled={isImportingTeam}
                              className="team-import-preview-field min-h-11 w-full rounded-2xl px-4 py-2.5 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {t('members.baseCodingAgent')}
                              </label>
                              <select
                                value={currentPlan.runnerType}
                                onChange={(event) =>
                                  onUpdatePlanEntry(activeCardIndex, {
                                    runnerType: event.target.value,
                                  })
                                }
                                disabled={
                                  isImportingTeam ||
                                  isCheckingAvailability ||
                                  enabledRunnerTypes.length === 0
                                }
                                className="team-import-preview-field min-h-11 w-full rounded-2xl px-4 py-2.5 text-[15px] leading-6 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {enabledRunnerTypes.length === 0 && (
                                  <option value="">
                                    {isCheckingAvailability
                                      ? t('members.checkingAgents')
                                      : t('members.noLocalAgentsDetected')}
                                  </option>
                                )}
                                {availableRunnerTypes.map((runner) => (
                                  <option
                                    key={runner}
                                    value={runner}
                                    disabled={!isRunnerAvailable(runner)}
                                  >
                                    {toPrettyCase(runner)}
                                    {availabilityLabel(runner)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {currentPlanVariantOptions.length > 0 && (
                              <div className="space-y-1">
                                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  {t('members.modelVariant')}
                                </label>
                                <select
                                  value={currentPlanVariant}
                                  onChange={(event) =>
                                    onVariantChange(
                                      activeCardIndex,
                                      event.target.value,
                                      currentPlan.toolsEnabled
                                    )
                                  }
                                  disabled={isImportingTeam}
                                  className="team-import-preview-field min-h-11 w-full rounded-2xl px-4 py-2.5 text-[15px] leading-6 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {currentPlanVariantOptions.map((variant) => (
                                    <option key={variant} value={variant}>
                                      {getVariantLabel(
                                        currentPlan.runnerType,
                                        variant
                                      )}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      </PreviewSection>

                      <PreviewSection
                        step="02"
                        title={t('members.importPreview.sections.environment')}
                        description={t(
                          'members.importPreview.sections.environmentDescription'
                        )}
                      >
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5094FB]">
                              {t('members.workspacePath')}
                            </label>
                            <input
                              value={currentPlan.workspacePath}
                              onChange={(event) =>
                                onUpdatePlanEntry(activeCardIndex, {
                                  workspacePath: event.target.value,
                                })
                              }
                              placeholder={workspacePathPlaceholder}
                              disabled={isImportingTeam}
                              className="team-import-preview-field min-h-11 w-full rounded-2xl px-4 py-2.5 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>

                          <div className="rounded-[18px] border border-white/70 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
                            <AgentSkillsSection
                              agentId={
                                currentPlan.action === 'reuse'
                                  ? currentPlan.agentId
                                  : null
                              }
                              runnerType={currentPlan.runnerType || null}
                              selectedSkillIds={
                                currentPlan.selectedSkillIds ?? []
                              }
                              onSelectedSkillIdsChange={(skillIds) =>
                                onUpdatePlanEntry(activeCardIndex, {
                                  selectedSkillIds: skillIds,
                                })
                              }
                              readOnly={isImportingTeam}
                              maxHeightClass="max-h-32"
                            />
                          </div>
                        </div>
                      </PreviewSection>

                      <PreviewSection
                        step="03"
                        title={t('members.importPreview.sections.prompt')}
                        description={t(
                          'members.importPreview.sections.promptDescription'
                        )}
                      >
                        <div className="team-import-preview-prompt-shell overflow-hidden rounded-[20px] border">
                          <div className="flex items-start justify-between gap-4 border-b border-[#d7e1ee] px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#5094FB]">
                                {t('members.importPreview.promptBadge')}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-slate-600">
                                {t('members.importPreview.promptHint')}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="chat-session-member-expand-btn shrink-0 rounded-full border border-[#d7e1ee] bg-white/78 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() =>
                                onExpandPromptEditor(activeCardIndex)
                              }
                              disabled={isImportingTeam}
                            >
                              {t('members.expand')}
                            </button>
                          </div>

                          <div className="team-import-preview-prompt-body flex min-h-[220px]">
                            <div className="flex w-11 shrink-0 select-none flex-col items-end gap-1 border-r border-[#d7e1ee] bg-[#e3eaf4] px-2 py-4 text-[11px] font-medium text-slate-400">
                              <span>01</span>
                              <span>02</span>
                              <span>03</span>
                              <span>04</span>
                              <span>05</span>
                            </div>
                            <textarea
                              value={currentPlan.systemPrompt}
                              onChange={(event) =>
                                onUpdatePlanEntry(activeCardIndex, {
                                  systemPrompt: event.target.value,
                                })
                              }
                              rows={6}
                              placeholder={t('members.systemPromptPlaceholder')}
                              disabled={isImportingTeam}
                              className="team-import-preview-prompt-field min-h-[220px] flex-1 resize-none px-4 py-4 font-mono text-[13px] leading-7 text-slate-700 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </div>
                        </div>
                      </PreviewSection>
                    </div>
                  ) : (
                    <PreviewSection
                      step="01"
                      title={t('members.importPreview.sections.environment')}
                      description={currentActionLabel}
                    >
                      <div className="rounded-[20px] border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm leading-6 text-slate-500">
                        @{currentPlan.finalName}
                      </div>
                    </PreviewSection>
                  )}
                </div>
              </div>
            </div>

            {importPlan.length > 1 && (
              <aside className="flex w-[196px] shrink-0 flex-col rounded-[24px] border border-white/70 bg-white/65 p-3 shadow-[0_18px_36px_rgba(148,163,184,0.12)] backdrop-blur-xl">
                <div className="border-b border-slate-200/70 px-2 pb-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    {t('members.importPreview.membersLabel')}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">
                    {t('members.importPreview.switchHint')}
                  </div>
                </div>

                <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
                  {importPlan.map((plan, index) => {
                    const planName = getLocalizedMemberPresetNameById(
                      plan.presetId,
                      plan.presetName || plan.presetId,
                      t
                    );
                    const actionLabel =
                      plan.action === 'create'
                        ? t('members.importPreview.actionCreate')
                        : plan.action === 'reuse'
                          ? t('members.importPreview.actionReuse')
                          : t('members.importPreview.actionSkip');
                    const actionTone = getActionTone(plan.action);

                    return (
                      <button
                        key={`${plan.presetId}-step-${index}`}
                        type="button"
                        onClick={() => setCurrentCardIndex(index)}
                        aria-label={t('members.importPreview.memberPage', {
                          index: index + 1,
                          total: importPlan.length,
                        })}
                        aria-current={
                          index === activeCardIndex ? 'step' : undefined
                        }
                        className={cn(
                          'flex w-full items-start gap-3 rounded-[20px] border px-3 py-3 text-left transition-all duration-200',
                          index === activeCardIndex
                            ? 'border-indigo-200 bg-indigo-50/95 shadow-[0_14px_28px_rgba(99,102,241,0.12)]'
                            : 'border-white/70 bg-white/60 hover:bg-white/90'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-2xl text-[11px] font-semibold',
                            index === activeCardIndex
                              ? 'bg-white text-[#5094FB] shadow-sm'
                              : actionTone.step
                          )}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {planName}
                          </span>
                          <span className="mt-1 block truncate text-xs leading-5 text-slate-500">
                            {actionLabel}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
          {memberError && (
            <div className="flex-1 text-sm text-red-500">{memberError}</div>
          )}
          <PrimaryButton
            variant="tertiary"
            value={t('members.importPreview.cancel')}
            onClick={onCancel}
            disabled={isImportingTeam}
            className="chat-session-member-btn cancel"
          />
          <PrimaryButton
            value={
              isImportingTeam
                ? t('members.importPreview.importing')
                : t('members.importPreview.confirmImport')
            }
            onClick={onConfirm}
            actionIcon={isImportingTeam ? 'spinner' : undefined}
            disabled={isImportingTeam}
            className="chat-session-member-btn chat-session-member-btn-primary"
          />
        </div>
      </div>
    </div>
  );
}
