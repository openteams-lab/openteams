import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import type { WorkflowPendingInputData } from '@/lib/api';

type WorkflowPendingInputCardProps = {
  pendingInput: WorkflowPendingInputData;
  pendingActionId?: string | null;
  onSubmit?: (stepId: string, inputText: string) => void;
};

export function WorkflowPendingInputCard({
  pendingInput,
  pendingActionId,
  onSubmit,
}: WorkflowPendingInputCardProps) {
  const { t } = useAppTranslation();
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [pendingInput.input_id]);

  const trimmedValue = value.trim();
  const disabled =
    pendingActionId === pendingInput.step_id ||
    pendingActionId === pendingInput.input_id;

  return (
    <div className="workflow-pending-input-card rounded-[0_12px_12px_0] border border-[var(--hairline)] border-l-2 border-l-[var(--primary)] bg-[var(--surface-1)] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-[var(--primary)]">
        <MessageSquare className="h-4 w-4" />
        {t('workflow.pendingInput.title', { defaultValue: 'Input Required' })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-[var(--ink-subtle)]">
          {pendingInput.target_title}
        </span>
      </div>

      <p className="mb-3 text-[11px] font-medium leading-relaxed text-[var(--ink-muted)]">
        {pendingInput.prompt ||
          t('workflow.pendingInput.defaultPrompt', {
            defaultValue: 'The agent needs more input to continue.',
          })}
      </p>

      {pendingInput.description && (
        <div className="mb-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] p-3 text-[11px] leading-relaxed text-[var(--ink-muted)]">
          {pendingInput.description}
        </div>
      )}

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        disabled={disabled}
        placeholder={
          pendingInput.placeholder ??
          t('workflow.pendingInput.placeholder', {
            defaultValue: 'Type your response here',
          })
        }
        className="w-full rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-tertiary)] focus:border-[var(--primary)] focus:outline-2 focus:outline-[color-mix(in_srgb,var(--primary-focus)_48%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => {
            onSubmit?.(pendingInput.step_id, trimmedValue);
          }}
          disabled={disabled || !onSubmit || trimmedValue.length === 0}
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 font-mono text-[10px] font-medium text-[var(--on-primary)] transition-colors hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('workflow.pendingInput.submit', { defaultValue: 'SUBMIT' })}
        </button>
      </div>
    </div>
  );
}
