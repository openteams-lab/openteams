import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('chat');
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [pendingInput.input_id]);

  const trimmedValue = value.trim();
  const disabled =
    pendingActionId === pendingInput.step_id ||
    pendingActionId === pendingInput.input_id;

  return (
    <div className="workflow-pending-input-card rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-indigo-800">
        <MessageSquare className="h-4 w-4" />
        {t('workflow.pendingInput.title', { defaultValue: 'Input Required' })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-700">
          {pendingInput.target_title}
        </span>
      </div>

      <p className="mb-3 text-[11px] font-medium leading-relaxed text-slate-700">
        {pendingInput.prompt ||
          t('workflow.pendingInput.defaultPrompt', {
            defaultValue: 'The agent needs more input to continue.',
          })}
      </p>

      {pendingInput.description && (
        <div className="mb-3 rounded-lg border border-indigo-100 bg-white/80 p-3 text-[11px] leading-relaxed text-slate-600">
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
        className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-60"
      />

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => {
            onSubmit?.(pendingInput.step_id, trimmedValue);
          }}
          disabled={disabled || !onSubmit || trimmedValue.length === 0}
          className="rounded bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('workflow.pendingInput.submit', { defaultValue: 'SUBMIT' })}
        </button>
      </div>
    </div>
  );
}
