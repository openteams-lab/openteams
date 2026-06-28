import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAppScale } from '@/context/AppScaleContext';

export interface DropdownSelectOption {
  id: string;
  label: string;
  description?: string;
  group?: string;
  hint?: string;
  disabled?: boolean;
  leading?: React.ReactNode;
}

interface DropdownSelectBaseProps {
  options: DropdownSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  footer?: React.ReactNode;
  triggerIcon?: React.ReactNode;
  disabled?: boolean;
  defaultOpen?: boolean;
  showSearch?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  panelMinWidth?: number;
  maxPanelHeightClassName?: string;
}

interface DropdownSelectSingleProps extends DropdownSelectBaseProps {
  selectionMode?: 'single';
  value: string;
  onChange: (value: string, option: DropdownSelectOption) => void;
}

interface DropdownSelectMultiProps extends DropdownSelectBaseProps {
  selectionMode: 'multiple';
  values: string[];
  onChange: (values: string[], changedOption: DropdownSelectOption) => void;
  formatValueLabel?: (selectedOptions: DropdownSelectOption[]) => string;
}

export type DropdownSelectProps =
  | DropdownSelectSingleProps
  | DropdownSelectMultiProps;

const triggerClass =
  'flex w-full items-center gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[14px] text-[var(--ink)] cursor-pointer hover:border-[var(--hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60 transition';

const panelClass =
  'fixed overflow-hidden rounded-lg border border-[var(--hairline-strong)] bg-[var(--surface-3)] shadow-[0_14px_40px_rgba(0,0,0,0.18)] z-[1000]';

const searchClass =
  'flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2 text-[14px] text-[var(--ink-tertiary)]';

const optionClass =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] cursor-pointer hover:bg-[var(--surface-1)] disabled:cursor-not-allowed disabled:opacity-45 transition';

const getOptionSearchText = (option: DropdownSelectOption) =>
  [option.label, option.description, option.group, option.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function DropdownSelect(props: DropdownSelectProps) {
  const {
    options,
    placeholder = 'Select option',
    searchPlaceholder = 'Search...',
    emptyLabel = 'No options match this search.',
    footer,
    triggerIcon,
    disabled,
    defaultOpen = false,
    showSearch = true,
    className,
    triggerClassName,
    panelClassName,
    panelMinWidth,
    maxPanelHeightClassName = 'max-h-[160px]',
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const appScale = useAppScale();
  const [open, setOpen] = useState(defaultOpen);
  const [searchText, setSearchText] = useState('');
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({
    left: 0,
    top: 0,
    width: 280,
  });
  const isMultiple = props.selectionMode === 'multiple';
  const portalTarget =
    appScale.portalRoot ??
    (typeof document === 'undefined' ? null : document.body);
  const overlayScale =
    appScale.enabled && portalTarget === appScale.portalRoot
      ? appScale.scale
      : 1;
  const toOverlayValue = (value: number) => value / overlayScale;

  const updatePanelPosition = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const panelWidth = panelMinWidth
      ? Math.max(toOverlayValue(rect.width), panelMinWidth)
      : toOverlayValue(rect.width);
    const viewportWidth = toOverlayValue(window.innerWidth);
    const left = Math.max(
      8,
      Math.min(toOverlayValue(rect.left), viewportWidth - panelWidth - 8),
    );
    setPanelStyle({
      left,
      top: toOverlayValue(rect.bottom) + 4,
      width: panelWidth,
    });
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [
    appScale.enabled,
    appScale.portalRoot,
    appScale.scale,
    open,
    panelMinWidth,
  ]);

  const selectedIds = isMultiple
    ? new Set(props.values)
    : new Set([props.value]);
  const selectedOptions = options.filter((option) => selectedIds.has(option.id));
  const activeSingleOption = selectedOptions[0];

  const triggerLabel = (() => {
    if (isMultiple) {
      if (props.formatValueLabel) return props.formatValueLabel(selectedOptions);
      if (selectedOptions.length === 0) return placeholder;
      if (selectedOptions.length === 1) return selectedOptions[0].label;
      return `${selectedOptions.length} selected`;
    }
    return activeSingleOption?.label ?? placeholder;
  })();
  const isPlaceholder = selectedOptions.length === 0;

  const filteredOptions = useMemo(() => {
    if (!showSearch) return options;
    const needle = searchText.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => getOptionSearchText(option).includes(needle));
  }, [options, searchText, showSearch]);

  const groupedOptions = useMemo(() => {
    const groups: Array<{ name: string; options: DropdownSelectOption[] }> = [];
    for (const option of filteredOptions) {
      const groupName = option.group ?? '';
      let group = groups.find((candidate) => candidate.name === groupName);
      if (!group) {
        group = { name: groupName, options: [] };
        groups.push(group);
      }
      group.options.push(option);
    }
    return groups;
  }, [filteredOptions]);

  const handleOptionClick = (option: DropdownSelectOption) => {
    if (option.disabled) return;

    if (isMultiple) {
      const nextValues = selectedIds.has(option.id)
        ? props.values.filter((value) => value !== option.id)
        : [...props.values, option.id];
      props.onChange(nextValues, option);
      return;
    }

    props.onChange(option.id, option);
    setOpen(false);
  };

  const panel = (
    <div
      ref={panelRef}
      className={`${panelClass} ${panelClassName ?? ''}`}
      style={panelStyle}
    >
      {showSearch && (
        <div className={searchClass}>
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
          <input
            className="flex-1 border-none bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)] select-text"
            placeholder={searchPlaceholder}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>
      )}

      <div
        role="listbox"
        aria-multiselectable={isMultiple || undefined}
        className={`overflow-y-auto py-1 divide-y divide-[var(--hairline)] ${maxPanelHeightClassName}`}
      >
        {groupedOptions.length === 0 ? (
          <div className="px-3 py-2 text-[14px] text-[var(--ink-tertiary)]">
            {emptyLabel}
          </div>
        ) : (
          groupedOptions.map((group) => (
            <div key={group.name || 'ungrouped'} className="py-1">
              {group.name && (
                <div className="px-3 py-1 text-[13px] font-medium uppercase tracking-[0.4px] text-[var(--ink-tertiary)]">
                  {group.name}
                </div>
              )}
              {group.options.map((option) => {
                const active = selectedIds.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={option.disabled}
                    onClick={() => handleOptionClick(option)}
                    className={`${optionClass} ${
                      active
                        ? 'bg-[var(--primary)]/8 font-medium text-[var(--ink)]'
                        : 'text-[var(--ink)]'
                    }`}
                  >
                    {option.leading}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium leading-tight">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="mt-0.5 block truncate font-mono text-[13px] leading-none text-[var(--ink-tertiary)]">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {active ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                    ) : option.hint ? (
                      <kbd className="rounded-xs bg-[var(--surface-4)] px-1 font-mono text-[12px] text-[var(--ink-tertiary)]">
                        {option.hint}
                      </kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {footer && (
        <div className="flex items-center gap-3 border-t border-[var(--hairline)] bg-[var(--surface-4)] px-3 py-1.5 text-[13px] font-mono text-[var(--ink-tertiary)]">
          {footer}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`relative ${className ?? 'w-full'}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-placeholder={isPlaceholder ? 'true' : undefined}
        onClick={() => {
          if (!open) updatePanelPosition();
          setOpen((current) => !current);
        }}
        className={`${triggerClass} ${triggerClassName ?? ''} ${open ? 'border-[var(--primary)] text-[var(--ink)]' : ''}`}
      >
        {triggerIcon}
        <span
          className={`min-w-0 flex-1 truncate text-left ${
            isPlaceholder ? 'text-[var(--ink-tertiary)]' : ''
          }`}
        >
          {triggerLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
      </button>

      {open &&
        (portalTarget ? createPortal(panel, portalTarget) : panel)}
    </div>
  );
}
