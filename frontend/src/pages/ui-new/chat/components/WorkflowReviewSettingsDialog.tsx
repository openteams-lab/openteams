import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, Crown, Hand, X, type LucideIcon } from 'lucide-react';
import type { WorkflowCardData } from '@/lib/api';
import { cn } from '@/lib/utils';

export type WorkflowReviewSettingOverride = {
  stepId: string;
  leadReview: boolean | null;
  userReview: boolean;
};

type WorkflowReviewSettingsDialogProps = {
  projection: WorkflowCardData;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    overrides: WorkflowReviewSettingOverride[]
  ) => Promise<unknown> | void;
  submitLabel: string;
  submittingLabel: string;
  isSubmitting?: boolean;
  disabled?: boolean;
  error?: string | null;
  variant?: 'panel' | 'modal';
  className?: string;
};

type ReviewSettingDraft = Record<
  string,
  {
    leadReview: boolean;
    userReview: boolean;
  }
>;

function ReviewSwitch({
  icon: Icon,
  label,
  tooltip,
  checked,
  disabled = false,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cn(
        'group relative flex h-9 items-center justify-between gap-2 rounded-lg border px-2.5 text-left transition-all',
        checked
          ? 'border-[#5094fb]/30 bg-[#5094fb]/5'
          : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-white'
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            checked ? 'text-[#5094fb]' : 'text-slate-400'
          )}
        />
        <span className="truncate text-xs font-semibold text-slate-700">
          {label}
        </span>
      </span>
      <span
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-[#5094fb]' : 'bg-slate-200'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          )}
        />
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-[90] mt-1 hidden max-w-[240px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium leading-4 text-slate-900 shadow-lg group-hover:block">
        {tooltip}
      </span>
    </button>
  );
}

function ReviewSettingTooltipText({
  text,
  className,
  tooltipClassName,
}: {
  text: string;
  className: string;
  tooltipClassName?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative min-w-0"
      onMouseEnter={(event) => {
        const element = event.currentTarget
          .firstElementChild as HTMLDivElement | null;
        if (!element) return;
        setShowTooltip(
          element.scrollWidth > element.clientWidth ||
            element.scrollHeight > element.clientHeight
        );
      }}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={className}>{text}</div>
      {showTooltip && (
        <div
          className={cn(
            'pointer-events-none absolute left-0 top-full z-[90] mt-1 max-w-[320px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium leading-4 text-slate-900 shadow-lg',
            tooltipClassName
          )}
        >
          {text}
        </div>
      )}
    </div>
  );
}

export function WorkflowReviewSettingsDialog({
  projection,
  isOpen,
  onClose,
  onSubmit,
  submitLabel,
  submittingLabel,
  isSubmitting = false,
  disabled = false,
  error,
  variant = 'modal',
  className,
}: WorkflowReviewSettingsDialogProps) {
  const { t } = useTranslation('chat');
  const [reviewSettingsDraft, setReviewSettingsDraft] =
    useState<ReviewSettingDraft>({});

  const stepByKey = useMemo(
    () => new Map(projection.steps.map((step) => [step.step_key, step])),
    [projection.steps]
  );
  const stepById = useMemo(
    () => new Map(projection.steps.map((step) => [step.id, step])),
    [projection.steps]
  );
  const planNodeById = useMemo(
    () => new Map(projection.plan.nodes.map((node) => [node.id, node])),
    [projection.plan.nodes]
  );
  const workflowLoops = useMemo(
    () => projection.loops ?? [],
    [projection.loops]
  );

  const taskReviewSettingsRows = useMemo(
    () =>
      projection.plan.nodes
        .filter((node) => node.data.stepType === 'task')
        .map((node) => {
          const step = stepByKey.get(node.id);
          return {
            stepId: node.id,
            title: step?.title ?? node.data.title,
            leadReview: step?.lead_review_required ?? true,
            userReview: step?.user_review_required ?? true,
          };
        }),
    [projection.plan.nodes, stepByKey]
  );

  const loopReviewSettingsRows = useMemo(
    () =>
      workflowLoops.flatMap((workflowLoop) => {
        const reviewStep = stepById.get(workflowLoop.review_step_id);
        if (!reviewStep) return [];
        const reviewNode = planNodeById.get(reviewStep.step_key);
        return {
          stepId: reviewStep.step_key,
          title:
            workflowLoop.loop_key || reviewNode?.data.title || reviewStep.title,
          description: `${workflowLoop.member_step_ids.length} tasks / review step: ${reviewStep.title}`,
          userReview: workflowLoop.user_review_required,
        };
      }),
    [planNodeById, stepById, workflowLoops]
  );

  useEffect(() => {
    if (!isOpen) return;
    setReviewSettingsDraft(
      Object.fromEntries([
        ...taskReviewSettingsRows.map((row) => [
          row.stepId,
          {
            leadReview: row.leadReview,
            userReview: row.userReview,
          },
        ]),
        ...loopReviewSettingsRows.map((row) => [
          row.stepId,
          {
            leadReview: false,
            userReview: row.userReview,
          },
        ]),
      ] as Array<[string, { leadReview: boolean; userReview: boolean }]>)
    );
  }, [isOpen, loopReviewSettingsRows, taskReviewSettingsRows]);

  const updateReviewSettingDraft = useCallback(
    (stepId: string, key: 'leadReview' | 'userReview', value: boolean) => {
      setReviewSettingsDraft((prev) => ({
        ...prev,
        [stepId]: {
          leadReview: prev[stepId]?.leadReview ?? true,
          userReview: prev[stepId]?.userReview ?? true,
          [key]: value,
        },
      }));
    },
    []
  );

  const handleSubmit = useCallback(() => {
    if (disabled || isSubmitting) return;
    return onSubmit([
      ...taskReviewSettingsRows.map((row) => ({
        stepId: row.stepId,
        leadReview:
          reviewSettingsDraft[row.stepId]?.leadReview ?? row.leadReview,
        userReview:
          reviewSettingsDraft[row.stepId]?.userReview ?? row.userReview,
      })),
      ...loopReviewSettingsRows.map((row) => ({
        stepId: row.stepId,
        leadReview: null,
        userReview:
          reviewSettingsDraft[row.stepId]?.userReview ?? row.userReview,
      })),
    ]);
  }, [
    disabled,
    isSubmitting,
    loopReviewSettingsRows,
    onSubmit,
    reviewSettingsDraft,
    taskReviewSettingsRows,
  ]);

  if (!isOpen) return null;

  const content = (
    <div
      className={cn(
        'workflow-review-settings-dialog overflow-hidden rounded-xl border border-slate-100/70 bg-white shadow-xl',
        variant === 'panel'
          ? 'flex w-[400px] flex-col'
          : 'w-full max-w-[440px]',
        className
      )}
    >
      <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="pr-4">
          <div className="mb-1 text-sm font-semibold text-slate-900">
            {t('workflow.reviewSettings.title', {
              defaultValue: 'Review Settings',
            })}
          </div>
          <div className="text-xs leading-relaxed text-slate-500">
            {t('workflow.reviewSettings.description', {
              defaultValue: 'Choose who should review each workflow result.',
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="mt-0.5 shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('workflow.reviewSettings.close', {
            defaultValue: 'Close review settings',
          })}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex max-h-[500px] flex-col gap-6 overflow-y-auto p-4">
        {taskReviewSettingsRows.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                {t('workflow.reviewSettings.taskSteps', {
                  defaultValue: 'Task Steps',
                })}
              </div>
              <div className="text-[11px] text-slate-500">
                {t('workflow.reviewSettings.leadUserReview', {
                  defaultValue: 'Lead / User review',
                })}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {taskReviewSettingsRows.map((row) => {
                const draft = reviewSettingsDraft[row.stepId] ?? {
                  leadReview: row.leadReview,
                  userReview: row.userReview,
                };

                return (
                  <div
                    key={row.stepId}
                    className="flex flex-col gap-2.5 rounded-lg border border-slate-100 bg-white p-3"
                  >
                    <ReviewSettingTooltipText
                      text={row.title}
                      className="truncate text-sm font-semibold text-slate-800"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <ReviewSwitch
                        icon={Crown}
                        label={t('workflow.reviewSettings.leadLabel', {
                          defaultValue: 'Lead',
                        })}
                        tooltip={
                          draft.leadReview
                            ? t('workflow.reviewSettings.leadReviewOff', {
                                defaultValue:
                                  'Disable lead agent review for this task step',
                              })
                            : t('workflow.reviewSettings.leadReviewOn', {
                                defaultValue:
                                  'Enable lead agent review for this task step',
                              })
                        }
                        checked={draft.leadReview}
                        disabled={disabled || isSubmitting}
                        onChange={(checked) =>
                          updateReviewSettingDraft(
                            row.stepId,
                            'leadReview',
                            checked
                          )
                        }
                      />
                      <ReviewSwitch
                        icon={Hand}
                        label={t('workflow.reviewSettings.userLabel', {
                          defaultValue: 'User',
                        })}
                        tooltip={
                          draft.userReview
                            ? t('workflow.reviewSettings.userReviewOff', {
                                defaultValue:
                                  'Disable user review for this task step',
                              })
                            : t('workflow.reviewSettings.userReviewOn', {
                                defaultValue:
                                  'Enable user review for this task step',
                              })
                        }
                        checked={draft.userReview}
                        disabled={disabled || isSubmitting}
                        onChange={(checked) =>
                          updateReviewSettingDraft(
                            row.stepId,
                            'userReview',
                            checked
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loopReviewSettingsRows.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                {t('workflow.reviewSettings.workflowLoops', {
                  defaultValue: 'Workflow Loops',
                })}
              </div>
              <div className="text-[11px] text-slate-500">
                {t('workflow.reviewSettings.userReviewOnly', {
                  defaultValue: 'User review only',
                })}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {loopReviewSettingsRows.map((row) => {
                const draft = reviewSettingsDraft[row.stepId] ?? {
                  leadReview: false,
                  userReview: row.userReview,
                };

                return (
                  <div
                    key={row.stepId}
                    className="flex flex-col gap-2.5 rounded-lg border border-slate-100 bg-white p-3"
                  >
                    <div>
                      <ReviewSettingTooltipText
                        text={row.title}
                        className="truncate text-sm font-semibold text-slate-800"
                      />
                      <ReviewSettingTooltipText
                        text={row.description}
                        className="mt-0.5 line-clamp-2 text-[11px] text-slate-400"
                        tooltipClassName="max-w-[340px]"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <ReviewSwitch
                        icon={Hand}
                        label={t('workflow.reviewSettings.userLabel', {
                          defaultValue: 'User',
                        })}
                        tooltip={
                          draft.userReview
                            ? t('workflow.reviewSettings.loopUserReviewOff', {
                                defaultValue:
                                  'Disable user review for this workflow loop',
                              })
                            : t('workflow.reviewSettings.loopUserReviewOn', {
                                defaultValue:
                                  'Enable user review for this workflow loop',
                              })
                        }
                        checked={draft.userReview}
                        disabled={disabled || isSubmitting}
                        onChange={(checked) =>
                          updateReviewSettingDraft(
                            row.stepId,
                            'userReview',
                            checked
                          )
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 shadow-sm">
          <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('workflow.reviewSettings.cancel', {
            defaultValue: 'Cancel',
          })}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={disabled || isSubmitting}
          className="rounded-md bg-[#5094fb] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#4080e0] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </div>
  );

  if (variant === 'panel') {
    return <div className="absolute right-6 top-6 z-[70]">{content}</div>;
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/35 p-4">
      {content}
    </div>
  );
}
