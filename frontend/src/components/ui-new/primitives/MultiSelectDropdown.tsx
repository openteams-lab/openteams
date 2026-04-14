import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CaretDownIcon, CheckIcon, type Icon } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui-new/primitives/Dropdown';
import { Badge } from '@/components/ui/badge';

export interface MultiSelectDropdownOption<T extends string = string> {
  value: T;
  label: string;
  renderOption?: () => ReactNode;
}

export interface MultiSelectDropdownProps<T extends string = string> {
  values: T[];
  options: MultiSelectDropdownOption<T>[];
  onChange: (values: T[]) => void;
  icon: Icon;
  label: string;
  menuLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  menuContentClassName?: string;
}

export function MultiSelectDropdown<T extends string = string>({
  values,
  options,
  onChange,
  icon: IconComponent,
  label,
  menuLabel,
  disabled,
  triggerClassName,
  menuContentClassName,
}: MultiSelectDropdownProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex items-center gap-half px-base py-half bg-panel rounded-sm border border-border',
            'text-sm text-normal hover:bg-secondary transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            triggerClassName
          )}
        >
          <IconComponent className="size-icon-xs" weight="bold" />
          <span>{label}</span>
          {values.length > 0 && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-xs h-5 min-w-5 justify-center bg-brand border-none"
            >
              {values.length}
            </Badge>
          )}
          <CaretDownIcon className="size-icon-2xs text-low" weight="bold" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuContentClassName}>
        {menuLabel && (
          <>
            <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={values.includes(option.value)}
            className={cn(
              'focus:bg-[#DCEBFF] focus:text-[#0F172A]',
              'data-[highlighted]:bg-[#DCEBFF] data-[highlighted]:text-[#0F172A]',
              'data-[state=checked]:bg-[#DCEBFF] data-[state=checked]:text-[#0F172A]'
            )}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => {
              const newValues = values.includes(option.value)
                ? values.filter((v) => v !== option.value)
                : [...values, option.value];
              onChange(newValues);
            }}
          >
            <div className="flex w-full items-center gap-base">
              <div className="min-w-0 flex-1">
                {option.renderOption?.() ?? option.label}
              </div>
              {values.includes(option.value) ? (
                <CheckIcon
                  className="size-icon-xs shrink-0 text-[#a8c9ff] dark:text-[#5EA2FF]"
                  weight="bold"
                />
              ) : null}
            </div>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
