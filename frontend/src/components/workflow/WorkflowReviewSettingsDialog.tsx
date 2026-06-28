import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { Bell, ListTodo, RefreshCw, X } from 'lucide-react';
import type { WorkflowCardData } from '@/lib/api';
import { cn } from '@/lib/utils';
import './WorkflowReviewSettingsDialog.css';

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

type LoopReviewSettingsRow = {
  stepId: string;
  title: string;
  userReview: boolean;
};

function buildReviewSettingsDraft(
  taskRows: Array<{
    stepId: string;
    leadReview: boolean;
    userReview: boolean;
  }>,
  loopRows: LoopReviewSettingsRow[]
): ReviewSettingDraft {
  return Object.fromEntries([
    ...taskRows.map((row) => [
      row.stepId,
      {
        leadReview: row.leadReview,
        userReview: row.userReview,
      },
    ]),
    ...loopRows.map((row) => [
      row.stepId,
      {
        leadReview: false,
        userReview: row.userReview,
      },
    ]),
  ] as Array<[string, { leadReview: boolean; userReview: boolean }]>);
}

function ReviewToggleTag({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cn(
        'relative flex h-7 min-w-[54px] items-center justify-center rounded-[6px] px-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_38%,transparent)]',
        checked
          ? 'bg-[var(--wrs-toggle-active-bg)] text-[var(--wrs-toggle-active-text)] shadow-[var(--wrs-toggle-active-shadow)]'
          : null,
        !checked &&
          'bg-transparent text-[var(--wrs-toggle-inactive-text)] hover:bg-[var(--wrs-toggle-inactive-hover-bg)] hover:text-[var(--wrs-toggle-inactive-hover-text)]',
        disabled &&
          'cursor-not-allowed opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--wrs-toggle-inactive-text)]'
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}

function ReviewSegmentedControl({
  options,
}: {
  options: Array<{
    key: string;
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (checked: boolean) => void;
  }>;
}) {
  return (
    <div
      role="group"
      className="inline-flex shrink-0 flex-row items-center justify-end gap-2"
    >
      {options.map((option) => (
        <ReviewToggleTag
          key={option.key}
          label={option.label}
          checked={option.checked}
          disabled={option.disabled}
          onChange={option.onChange}
        />
      ))}
    </div>
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
            'pointer-events-none absolute left-0 top-full z-[90] mt-1 max-w-[320px] rounded-md border border-[var(--wrs-tooltip-border)] bg-[var(--wrs-tooltip-bg)] px-2.5 py-1.5 text-xs font-medium leading-4 text-[var(--wrs-tooltip-text)] shadow-[var(--wrs-tooltip-shadow)]',
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
  const { t } = useAppTranslation();
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
            title: step?.title ?? node.data.title ?? node.id,
            leadReview: step?.lead_review_required ?? true,
            userReview: step?.user_review_required ?? true,
          };
        }),
    [projection.plan.nodes, stepByKey]
  );

  const planLoopReviewSettingsRows = useMemo(
    () =>
      (projection.plan.loops ?? []).flatMap(
        (planLoop): LoopReviewSettingsRow[] => {
          const reviewStepKey =
            planLoop.reviewStep ?? planLoop.review_step_key ?? null;
          if (!reviewStepKey) return [];
          const reviewStep = stepByKey.get(reviewStepKey);
          const reviewNode = planNodeById.get(reviewStepKey);
          const loopTitle =
            planLoop.loopKey ??
            planLoop.loop_key ??
            reviewNode?.data.title ??
            reviewStep?.title ??
            reviewStepKey;
          return [
            {
              stepId: reviewStepKey,
              title: loopTitle,
              userReview:
                planLoop.userReviewRequired ??
                planLoop.user_review_required ??
                true,
            },
          ];
        }
      ),
    [planNodeById, projection.plan.loops, stepByKey]
  );

  const runtimeLoopReviewSettingsRows = useMemo(
    () =>
      workflowLoops.flatMap((workflowLoop): LoopReviewSettingsRow[] => {
        const reviewStep = stepById.get(workflowLoop.review_step_id);
        if (!reviewStep) return [];
        const reviewNode = planNodeById.get(reviewStep.step_key);
        const reviewStepTitle = reviewStep.title ?? reviewStep.step_key;
        return [
          {
            stepId: reviewStep.step_key,
            title:
              workflowLoop.loop_key ||
              reviewNode?.data.title ||
              reviewStepTitle,
            userReview: workflowLoop.user_review_required,
          },
        ];
      }),
    [planNodeById, stepById, workflowLoops]
  );

  const loopReviewSettingsRows = useMemo(
    () =>
      runtimeLoopReviewSettingsRows.length > 0
        ? runtimeLoopReviewSettingsRows
        : planLoopReviewSettingsRows,
    [planLoopReviewSettingsRows, runtimeLoopReviewSettingsRows]
  );

  const reviewSettingsShapeKey = useMemo(
    () =>
      [
        projection.execution_id ?? '',
        projection.plan_id ?? '',
        taskReviewSettingsRows.map((row) => row.stepId).join(','),
        loopReviewSettingsRows.map((row) => row.stepId).join(','),
      ].join('::'),
    [
      loopReviewSettingsRows,
      projection.execution_id,
      projection.plan_id,
      taskReviewSettingsRows,
    ]
  );
  const taskReviewSettingsRowsRef = useRef(taskReviewSettingsRows);
  const loopReviewSettingsRowsRef = useRef(loopReviewSettingsRows);

  useEffect(() => {
    taskReviewSettingsRowsRef.current = taskReviewSettingsRows;
    loopReviewSettingsRowsRef.current = loopReviewSettingsRows;
  }, [loopReviewSettingsRows, taskReviewSettingsRows]);

  useEffect(() => {
    if (!isOpen) return;
    setReviewSettingsDraft(
      buildReviewSettingsDraft(
        taskReviewSettingsRowsRef.current,
        loopReviewSettingsRowsRef.current
      )
    );
  }, [isOpen, reviewSettingsShapeKey]);

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
        "workflow-review-settings-dialog relative overflow-hidden rounded-xl border border-[var(--wrs-panel-border)] bg-[var(--wrs-panel-bg)] shadow-[var(--wrs-panel-shadow)] before:absolute before:inset-x-0 before:top-0 before:h-px before:content-['']",
        variant === 'panel'
          ? 'flex w-[400px] flex-col'
          : 'w-full max-w-[440px]',
        className
      )}
    >
      <div className="flex items-start justify-between border-b border-[var(--wrs-section-border)] bg-[var(--wrs-chrome-bg)] px-5 py-4">
        <div className="pl-1.5 pr-4">
          <div className="mb-1 text-sm font-semibold text-[var(--ink)]">
            {t('workflow.reviewSettings.title', {
              defaultValue: 'Review Settings',
            })}
          </div>
          <div className="text-xs leading-relaxed text-[var(--ink-subtle)]">
            {t('workflow.reviewSettings.description', {
              defaultValue: 'Choose who should review each workflow result.',
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="mt-0.5 shrink-0 rounded-md p-1.5 text-[var(--wrs-close-text)] transition-colors hover:bg-[var(--wrs-close-hover-bg)] hover:text-[var(--wrs-close-hover-text)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('workflow.reviewSettings.close', {
            defaultValue: 'Close review settings',
          })}
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex max-h-[500px] flex-col gap-6 overflow-y-auto p-4">
        {taskReviewSettingsRows.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--wrs-section-heading)]">
                {t('workflow.reviewSettings.taskSteps', {
                  defaultValue: 'Task Steps',
                })}
              </div>
              <div className="ml-4 w-[124px] shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.09em] text-[var(--wrs-section-caption)]">
                {t('workflow.reviewSettings.leadUserReview', {
                  defaultValue: 'Lead & User',
                })}
              </div>
            </div>
            <div className="flex flex-col">
              {taskReviewSettingsRows.map((row) => {
                const draft = reviewSettingsDraft[row.stepId] ?? {
                  leadReview: row.leadReview,
                  userReview: row.userReview,
                };

                return (
                  <div
                    key={row.stepId}
                    className="group -mx-2 flex items-center justify-between gap-6 rounded px-2 py-3.5 transition-colors duration-150 hover:bg-[var(--wrs-row-hover-bg)]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ListTodo
                        className={cn(
                          'h-3 w-3 shrink-0 transition-colors',
                          draft.leadReview || draft.userReview
                            ? 'fill-[var(--wrs-icon-active-fill)] text-[var(--wrs-icon-active)]'
                            : 'text-[var(--wrs-icon-muted)]'
                        )}
                        aria-hidden="true"
                        strokeWidth={1.8}
                      />
                      <ReviewSettingTooltipText
                        text={row.title}
                        className="truncate text-[13px] font-medium text-[var(--wrs-row-title)]"
                      />
                    </div>
                    <div className="flex w-[124px] shrink-0 items-center justify-end">
                      <ReviewSegmentedControl
                        options={[
                          {
                            key: 'lead',
                            label: t('workflow.reviewSettings.leadLabel', {
                              defaultValue: 'Lead',
                            }),
                            checked: draft.leadReview,
                            disabled: disabled || isSubmitting,
                            onChange: (checked) =>
                              updateReviewSettingDraft(
                                row.stepId,
                                'leadReview',
                                checked
                              ),
                          },
                          {
                            key: 'user',
                            label: t('workflow.reviewSettings.userLabel', {
                              defaultValue: 'User',
                            }),
                            checked: draft.userReview,
                            disabled: disabled || isSubmitting,
                            onChange: (checked) =>
                              updateReviewSettingDraft(
                                row.stepId,
                                'userReview',
                                checked
                              ),
                          },
                        ]}
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
              <div className="font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-[var(--wrs-section-heading)]">
                {t('workflow.reviewSettings.workflowLoops', {
                  defaultValue: 'Workflow Loops',
                })}
              </div>
              <div className="ml-4 w-[124px] shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.09em] text-[var(--wrs-section-caption)]">
                {t('workflow.reviewSettings.userReviewOnly', {
                  defaultValue: 'User review',
                })}
              </div>
            </div>
            <div className="flex flex-col">
              {loopReviewSettingsRows.map((row) => {
                const draft = reviewSettingsDraft[row.stepId] ?? {
                  leadReview: false,
                  userReview: row.userReview,
                };

                return (
                  <div
                    key={row.stepId}
                    className="group -mx-2 flex items-center justify-between gap-6 rounded px-2 py-3.5 transition-colors duration-150 hover:bg-[var(--wrs-row-hover-bg)]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <RefreshCw
                        className={cn(
                          'h-3 w-3 shrink-0 transition-colors',
                          draft.userReview
                            ? 'text-[var(--wrs-icon-active)]'
                            : 'text-[var(--wrs-icon-muted)]'
                        )}
                        aria-hidden="true"
                        strokeWidth={1.8}
                      />
                      <ReviewSettingTooltipText
                        text={row.title}
                        className="truncate text-[13px] font-medium text-[var(--wrs-row-title)]"
                        tooltipClassName="max-w-[340px]"
                      />
                    </div>
                    <div className="flex w-[124px] shrink-0 items-center justify-end">
                      <ReviewSegmentedControl
                        options={[
                          {
                            key: 'user',
                            label: t('workflow.reviewSettings.userLabel', {
                              defaultValue: 'User',
                            }),
                            checked: draft.userReview,
                            disabled: disabled || isSubmitting,
                            onChange: (checked) =>
                              updateReviewSettingDraft(
                                row.stepId,
                                'userReview',
                                checked
                              ),
                          },
                        ]}
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
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--primary)_32%,var(--wrs-section-border))] bg-[var(--primary-tint)] px-3 py-2 text-xs leading-5 text-[var(--primary-hover)]">
          <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span>{error}</span>
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-[var(--wrs-section-border)] bg-[var(--wrs-chrome-bg)] px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="rounded-md bg-transparent px-4 py-2 text-xs font-semibold text-[var(--wrs-cancel-text)] transition-colors hover:text-[var(--wrs-cancel-hover-text)] disabled:cursor-not-allowed disabled:opacity-50"
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
          className="rounded-md border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--on-primary)] shadow-[var(--wrs-primary-shadow)] transition-colors hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="pointer-events-none absolute inset-0 z-[200]">
        <div className="pointer-events-auto absolute right-6 top-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-review-settings-dialog-overlay fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--wrs-modal-overlay-bg)] p-4 backdrop-blur-[2px]">
      {content}
    </div>
  );
}
