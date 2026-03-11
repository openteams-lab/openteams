import { WidgetProps } from '@rjsf/utils';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../primitives/Dropdown';

const settingsFieldClassName =
  'w-full rounded-[10px] border border-[#E8EEF5] bg-[#F9FBFF] px-[14px] py-[10px] text-[14px] text-[#333333] outline-none transition-all duration-200 placeholder:text-[#8C8C8C] focus:border-[#4A90E2] focus:bg-white focus:shadow-[0_0_0_3px_rgba(74,144,226,0.08)] disabled:cursor-not-allowed disabled:opacity-50';

// TextWidget - Text input matching settings dialog styling
export const TextWidget = (props: WidgetProps) => {
  const {
    id,
    value,
    disabled,
    readonly,
    onChange,
    onBlur,
    onFocus,
    placeholder,
    options,
  } = props;

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    onChange(newValue === '' ? options.emptyValue : newValue);
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (onBlur) {
      onBlur(id, event.target.value);
    }
  };

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (onFocus) {
      onFocus(id, event.target.value);
    }
  };

  return (
    <input
      id={id}
      type="text"
      value={value ?? ''}
      placeholder={placeholder || ''}
      disabled={disabled || readonly}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={cn(
        'settings-input settings-rjsf-input',
        settingsFieldClassName,
        (disabled || readonly) && 'opacity-50 cursor-not-allowed'
      )}
    />
  );
};

// SelectWidget - Dropdown select matching settings dialog styling
export const SelectWidget = (props: WidgetProps) => {
  const {
    id,
    value,
    disabled,
    readonly,
    onChange,
    options,
    schema,
    placeholder,
  } = props;

  const { t } = useTranslation('common');
  const { enumOptions } = options;

  const handleChange = (newValue: string) => {
    const finalValue = newValue === '__null__' ? options.emptyValue : newValue;
    onChange(finalValue);
  };

  // Handle nullable types
  const isNullable = Array.isArray(schema.type) && schema.type.includes('null');
  const allOptions = useMemo(() => {
    const selectOptions = enumOptions || [];
    if (isNullable) {
      return [
        { value: '__null__', label: t('form.notSpecified') },
        ...selectOptions.filter((opt) => opt.value !== null),
      ];
    }
    return selectOptions;
  }, [isNullable, enumOptions, t]);

  const currentValue = value === null ? '__null__' : (value ?? '');
  const selectedOption = allOptions.find(
    (opt) => String(opt.value) === String(currentValue)
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'settings-select-trigger settings-rjsf-select-trigger flex items-center justify-between text-left',
            settingsFieldClassName
          )}
          disabled={disabled || readonly}
        >
          <span className="truncate">
            {selectedOption?.label || placeholder || t('form.selectOption')}
          </span>
          <CaretDownIcon className="size-3 text-[#8C8C8C]" weight="fill" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="settings-select-dropdown settings-rjsf-select-dropdown w-[var(--radix-dropdown-menu-trigger-width)] rounded-[10px] border border-[#E8EEF5] bg-white p-1 shadow-[0_12px_30px_rgba(0,0,0,0.08)]">
        {allOptions.map((option) => (
          <DropdownMenuItem
            key={String(option.value)}
            className="settings-select-option settings-rjsf-select-option mx-0 rounded-[8px] px-3 py-2 text-[14px] text-[#333333] focus:bg-[#F9FBFF]"
            onClick={() => handleChange(String(option.value))}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// CheckboxWidget - Checkbox matching settings dialog styling
// Note: Label is shown in the FieldTemplate's left column, not here
export const CheckboxWidget = (props: WidgetProps) => {
  const { id, value, disabled, readonly, onChange, onBlur, onFocus } = props;

  const handleChange = (checked: boolean) => {
    onChange(checked);
  };

  const checked = Boolean(value);
  const isDisabled = disabled || readonly;

  return (
    <div className="flex items-start">
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={isDisabled}
        onClick={() => handleChange(!checked)}
        onBlur={() => onBlur?.(id, checked)}
        onFocus={() => onFocus?.(id, checked)}
        className={cn(
          'settings-rjsf-checkbox flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-2 text-white transition-colors duration-200 focus:outline-none focus:shadow-[0_0_0_3px_rgba(74,144,226,0.16)]',
          checked
            ? 'border-[#4A90E2] bg-[#4A90E2]'
            : 'border-[#E8EEF5] bg-white text-[#4A90E2]',
          !isDisabled && 'cursor-pointer',
          isDisabled && 'cursor-not-allowed opacity-50'
        )}
      >
        {checked ? (
          <CheckIcon className="h-3 w-3 text-white" weight="bold" />
        ) : null}
      </button>
    </div>
  );
};

// TextareaWidget - Textarea matching settings dialog styling
export const TextareaWidget = (props: WidgetProps) => {
  const {
    id,
    value,
    disabled,
    readonly,
    onChange,
    onBlur,
    onFocus,
    placeholder,
    options,
  } = props;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    onChange(newValue === '' ? options.emptyValue : newValue);
  };

  const handleBlur = (event: React.FocusEvent<HTMLTextAreaElement>) => {
    if (onBlur) {
      onBlur(id, event.target.value);
    }
  };

  const handleFocus = (event: React.FocusEvent<HTMLTextAreaElement>) => {
    if (onFocus) {
      onFocus(id, event.target.value);
    }
  };

  return (
    <textarea
      id={id}
      value={value ?? ''}
      placeholder={placeholder || ''}
      disabled={disabled || readonly}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      rows={4}
      className={cn(
        'settings-textarea settings-rjsf-textarea resize-y px-3 py-3',
        settingsFieldClassName,
        'resize-y',
        (disabled || readonly) && 'opacity-50 cursor-not-allowed'
      )}
    />
  );
};
