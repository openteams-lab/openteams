import React from 'react';

type TimeRange = '7d' | '30d' | '90d';

export interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  t: (key: string, fallback: string) => string;
}

const options: { value: TimeRange; labelKey: string; fallback: string }[] = [
  { value: '7d', labelKey: 'buildStats.timeRange.7d', fallback: '1 Week' },
  { value: '30d', labelKey: 'buildStats.timeRange.30d', fallback: '1 Month' },
  { value: '90d', labelKey: 'buildStats.timeRange.90d', fallback: '3 Months' },
];

export function TimeRangeFilter({ value, onChange, t }: TimeRangeFilterProps) {
  return (
    <div
      role="group"
      aria-label={t('buildStats.timeRange.label', 'Time range')}
      className="inline-flex rounded-md border border-[var(--hairline)] overflow-hidden"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer border-none outline-none ${
              isActive
                ? 'bg-[var(--surface-3)] text-[var(--ink)]'
                : 'bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            {t(option.labelKey, option.fallback)}
          </button>
        );
      })}
    </div>
  );
}
