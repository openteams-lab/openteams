import { FieldProps } from '@rjsf/utils';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

type KeyValueData = Record<string, string>;

interface EnvFormContext {
  onEnvChange?: (envData: KeyValueData | undefined) => void;
}

// KeyValueField - Key-value pairs editor matching settings dialog styling
export function KeyValueField({
  formData,
  disabled,
  readonly,
  registry,
}: FieldProps<KeyValueData>) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const formContext = registry.formContext as EnvFormContext | undefined;

  const data: KeyValueData = useMemo(() => formData ?? {}, [formData]);
  const entries = useMemo(() => Object.entries(data), [data]);

  const updateValue = useCallback(
    (newData: KeyValueData | undefined) => {
      formContext?.onEnvChange?.(newData);
    },
    [formContext]
  );

  const handleAdd = useCallback(() => {
    const trimmedKey = newKey.trim();
    if (trimmedKey) {
      updateValue({
        ...data,
        [trimmedKey]: newValue,
      });
      setNewKey('');
      setNewValue('');
    }
  }, [data, newKey, newValue, updateValue]);

  const handleRemove = useCallback(
    (key: string) => {
      const updated = { ...data };
      delete updated[key];
      updateValue(Object.keys(updated).length > 0 ? updated : undefined);
    },
    [data, updateValue]
  );

  const handleValueChange = useCallback(
    (key: string, value: string) => {
      updateValue({ ...data, [key]: value });
    },
    [data, updateValue]
  );

  const isDisabled = disabled || readonly;

  const inputClassName = cn(
    'settings-input settings-rjsf-keyvalue-input min-w-[50px] flex-1 rounded-[10px] border border-[#E8EEF5] bg-[#F9FBFF] px-[14px] py-[10px] font-mono text-[13px] text-[#333333]',
    'placeholder:text-[#8C8C8C] focus:border-[#4A90E2] focus:bg-white focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(74,144,226,0.08)]',
    isDisabled && 'opacity-50 cursor-not-allowed'
  );

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 items-center">
          <input
            value={key}
            disabled
            className={cn(inputClassName, 'opacity-70')}
            aria-label="Environment variable key"
          />
          <input
            value={value ?? ''}
            onChange={(e) => handleValueChange(key, e.target.value)}
            disabled={isDisabled}
            className={inputClassName}
            placeholder="Value"
            aria-label={`Value for ${key}`}
          />
          <button
            type="button"
            onClick={() => handleRemove(key)}
            disabled={isDisabled}
            className={cn(
              'settings-icon-action flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] p-0 text-[#8C8C8C]',
              'focus:outline-none focus:ring-0',
              'hover:bg-[#fff7f7] hover:text-[#d14343]',
              'disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            )}
            aria-label={`Remove ${key}`}
          >
            <XIcon className="size-icon-xs" weight="bold" />
          </button>
        </div>
      ))}

      {/* Add new entry row */}
      <div className="flex gap-2 items-center">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          disabled={isDisabled}
          placeholder="KEY"
          className={inputClassName}
          aria-label="New environment variable key"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          disabled={isDisabled}
          placeholder="value"
          className={inputClassName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          aria-label="New environment variable value"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isDisabled || !newKey.trim()}
          className={cn(
            'settings-add-button flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] p-0 text-[#333333]',
            'focus:outline-none focus:ring-0',
            'hover:bg-[#eceff3]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          )}
          aria-label="Add environment variable"
        >
          <PlusIcon className="size-icon-xs" weight="bold" />
        </button>
      </div>
    </div>
  );
}
