import type { ReactNode } from 'react';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../primitives/Dropdown';

interface TwoColumnPickerProps {
  children: ReactNode;
}

export function TwoColumnPicker({ children }: TwoColumnPickerProps) {
  return (
    <div className="mb-6 grid overflow-hidden rounded-[10px] border border-[#E8EEF5] bg-[#E8EEF5] md:grid-cols-2 md:gap-px">
      {children}
    </div>
  );
}

interface TwoColumnPickerColumnProps {
  label: string;
  headerAction?: ReactNode;
  isFirst?: boolean;
  children: ReactNode;
}

export function TwoColumnPickerColumn({
  label,
  headerAction,
  isFirst,
  children,
}: TwoColumnPickerColumnProps) {
  return (
    <div
      className={cn(
        'flex-1 bg-white',
        isFirst && 'border-b border-[#E8EEF5] md:border-b-0'
      )}
    >
      <div className="flex items-center justify-between border-b border-[#E8EEF5] bg-[#fafafa] px-3 py-2">
        <span className="text-[12px] text-[#8C8C8C]">{label}</span>
        {headerAction}
      </div>
      <div className="h-[180px] overflow-y-auto bg-white">{children}</div>
    </div>
  );
}

interface TwoColumnPickerItemProps {
  selected?: boolean;
  onClick?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

export function TwoColumnPickerItem({
  selected,
  onClick,
  leading,
  trailing,
  children,
}: TwoColumnPickerItemProps) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 border-none bg-transparent px-3 py-2 text-left transition-colors duration-200"
      style={{
        background: selected ? 'rgba(74, 144, 226, 0.06)' : 'transparent',
        color: selected ? '#4A90E2' : '#333333',
        fontWeight: selected ? 500 : 400,
      }}
      onClick={onClick}
      onMouseEnter={(event) => {
        if (!selected) {
          event.currentTarget.style.background = '#F9FBFF';
        }
      }}
      onMouseLeave={(event) => {
        if (!selected) {
          event.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {leading}
      <span className="flex-1 truncate text-[13px]">{children}</span>
      {trailing}
    </button>
  );
}

interface TwoColumnPickerBadgeProps {
  variant?: 'default' | 'brand';
  children: ReactNode;
}

export function TwoColumnPickerBadge({
  variant = 'default',
  children,
}: TwoColumnPickerBadgeProps) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-[2px] text-[11px] font-medium"
      style={{
        background:
          variant === 'brand' ? 'rgba(74, 144, 226, 0.08)' : '#F3F6FA',
        color: variant === 'brand' ? '#4A90E2' : '#8C8C8C',
      }}
    >
      {children}
    </span>
  );
}

interface TwoColumnPickerEmptyProps {
  children: ReactNode;
}

export function TwoColumnPickerEmpty({ children }: TwoColumnPickerEmptyProps) {
  return (
    <div className="px-3 py-5 text-center text-[13px] text-[#8C8C8C]">
      {children}
    </div>
  );
}

export const settingsFieldClassName =
  'w-full rounded-[10px] border border-[#E8EEF5] bg-[#F9FBFF] px-[14px] py-[10px] text-[14px] text-[#333333] outline-none transition-all duration-200 placeholder:text-[#8C8C8C] focus:border-[#4A90E2] focus:bg-white focus:shadow-[0_0_0_3px_rgba(74,144,226,0.08)] disabled:cursor-not-allowed disabled:opacity-50';

export const settingsPanelClassName =
  'rounded-[10px] border border-[#E8EEF5] bg-white';

export const settingsMutedPanelClassName =
  'rounded-[10px] border border-[#E8EEF5] bg-[#F9FBFF]';

export const settingsSecondaryButtonClassName =
  'inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] px-4 py-[10px] text-[14px] text-[#333333] transition-colors duration-200 hover:bg-[#eceff3] disabled:cursor-not-allowed disabled:opacity-50';

export const settingsPrimaryButtonClassName =
  'inline-flex items-center justify-center gap-2 rounded-[10px] border-none bg-[#4A90E2] px-4 py-[10px] text-[14px] text-white transition-all duration-200 hover:-translate-y-px hover:bg-[#357ABD] disabled:cursor-not-allowed disabled:opacity-50';

export const settingsIconButtonClassName =
  'inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] text-[#8C8C8C] transition-colors duration-200 hover:bg-[#eceff3] hover:text-[#333333] disabled:cursor-not-allowed disabled:opacity-50';

export function SettingsCard({
  title,
  description,
  children,
  headerAction,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="m-0 text-[14px] font-semibold text-[#333333]">
            {title}
          </h3>
          {description ? (
            <p className="mt-2 text-[12px] leading-5 text-[#8C8C8C]">
              {description}
            </p>
          ) : null}
        </div>
        {headerAction}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SettingsField({
  label,
  description,
  error,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 last:mb-0">
      {label ? (
        <div className="mb-2 text-[12px] text-[#8C8C8C]">{label}</div>
      ) : null}
      {children}
      {error ? (
        <p className="mt-2 text-[12px] text-[#d14343]">{error}</p>
      ) : description ? (
        <div className="mt-2 text-[12px] leading-5 text-[#8C8C8C]">
          {description}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsCheckbox({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'mb-5 flex w-full items-start gap-[10px] border-none bg-transparent p-0 text-left last:mb-0',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className="mt-[1px] flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border-2 transition-colors duration-200"
        style={{
          borderColor: checked ? '#4A90E2' : '#E8EEF5',
          background: checked ? '#4A90E2' : '#FFFFFF',
        }}
      >
        {checked ? (
          <CheckIcon className="h-3 w-3 text-white" weight="bold" />
        ) : null}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-[14px] text-[#333333]">{label}</span>
        {description ? (
          <span className="text-[12px] leading-5 text-[#8C8C8C]">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  contentClassName,
  itemClassName,
  selectedItemClassName,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
  selectedItemClassName?: string;
}) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            settingsFieldClassName,
            'flex items-center justify-between text-left',
            className
          )}
        >
          <span className="truncate">
            {selectedOption?.label || placeholder || ''}
          </span>
          <CaretDownIcon className="size-icon-xs text-[#8C8C8C]" weight="fill" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn(
          'w-[var(--radix-dropdown-menu-trigger-width)] rounded-[10px] border border-[#E8EEF5] bg-white p-1 shadow-[0_12px_30px_rgba(0,0,0,0.08)]',
          contentClassName
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value;

          return (
            <DropdownMenuItem
              key={option.value}
              data-selected={isSelected ? 'true' : undefined}
              className={cn(
                'mx-0 rounded-[8px] px-3 py-2 text-[14px] text-[#333333] focus:bg-[#F9FBFF]',
                itemClassName,
                isSelected && selectedItemClassName
              )}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  error,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        settingsFieldClassName,
        error &&
          'border-[#d14343] focus:border-[#d14343] focus:shadow-[0_0_0_3px_rgba(209,67,67,0.08)]'
      )}
    />
  );
}

export function SettingsNumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  error,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  error?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        settingsFieldClassName,
        '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        error &&
          'border-[#d14343] focus:border-[#d14343] focus:shadow-[0_0_0_3px_rgba(209,67,67,0.08)]'
      )}
    />
  );
}

export function SettingsTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  rows = 4,
  monospace = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  monospace?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      className={cn(
        settingsFieldClassName,
        'resize-y px-3 py-3',
        monospace && 'font-mono text-[13px]'
      )}
    />
  );
}

export function SettingsSaveBar({
  show,
  saving,
  saveDisabled,
  unsavedMessage,
  onSave,
  onDiscard,
  layout = 'section',
}: {
  show: boolean;
  saving: boolean;
  saveDisabled?: boolean;
  unsavedMessage?: string;
  onSave: () => void;
  onDiscard?: () => void;
  layout?: 'section' | 'panel' | 'floating-panel';
}) {
  const { t } = useTranslation(['settings', 'common']);

  if (!show) return <div />;

  const wrapperClassName =
    layout === 'panel'
      ? 'mt-6 -mx-4 border-t border-[#f5f5f5] bg-white px-4 pt-4'
      : layout === 'floating-panel'
        ? 'rounded-[14px] border border-[#E8EEF5] bg-white/95 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm'
        : 'mt-8 -mx-8 sticky bottom-0 border-t border-[#f5f5f5] bg-white px-8 py-4';
  const innerClassName =
    layout === 'floating-panel'
      ? 'flex-col gap-3 sm:flex-row sm:items-center'
      : layout === 'panel'
        ? 'pb-0'
        : '';

  return (
    <div className={wrapperClassName}>
      <div
        className={cn(
          'flex items-center',
          onDiscard ? 'justify-between' : 'justify-end',
          innerClassName
        )}
      >
        {onDiscard ? (
          <span className="text-[12px] text-[#8C8C8C]">
            {unsavedMessage ?? t('settings.common.unsavedChanges')}
          </span>
        ) : null}
        <div className="flex items-center gap-3">
          {onDiscard ? (
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className={settingsSecondaryButtonClassName}
            >
              {t('common:buttons.discard')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || saveDisabled}
            className={settingsPrimaryButtonClassName}
          >
            {saving ? t('common:states.saving') : t('common:buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
