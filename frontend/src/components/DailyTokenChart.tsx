import React from 'react';
import type { DailyTokenDataPoint } from '@/types';
import { SimpleLineChart } from '@/components/SimpleLineChart';
import { formatCompactNumber, formatPrice } from '@/lib/buildStatsUtils';

export interface DailyTokenChartProps {
  data: DailyTokenDataPoint[];
  loading: boolean;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  onDateSelect?: (date: string) => void;
  height?: number;
  fillHeight?: boolean;
}

const numberValue = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value) || 0
      : 0;

const estimateDailyCost = (datum: DailyTokenDataPoint): number =>
  numberValue(datum.estimated_cost);

export function DailyTokenChart({
  data,
  loading,
  t,
  onDateSelect,
  height,
  fillHeight,
}: DailyTokenChartProps) {
  const label = (
    key: string,
    fallback: string,
    replacements?: Record<string, string | number>,
  ) => {
    const value = t(key, replacements);
    const fallbackText = replacements
      ? Object.entries(replacements).reduce(
          (text, [name, replacement]) =>
            text.replace(`{${name}}`, String(replacement)),
          fallback,
        )
      : fallback;
    return value === key ? fallbackText : value;
  };

  return (
    <SimpleLineChart
      data={data}
      loading={loading}
      loadingLabel={label('buildStats.chart.loading', 'Loading chart')}
      emptyLabel={label('buildStats.empty.noTokenData', 'No token usage data')}
      pointAriaLabel={(date, series) =>
        label('buildStats.chart.point', '{date} {series} chart point', {
          date,
          series,
        })
      }
      formatValue={formatCompactNumber}
      height={height}
      fillHeight={fillHeight}
      onDatumClick={
        onDateSelect ? (datum) => onDateSelect(datum.date) : undefined
      }
      series={[
        {
          id: 'total',
          label: label('buildStats.totalTokens', 'Total tokens'),
          color: '#5e6ad2',
          value: (datum) => datum.total_tokens,
        },
        {
          id: 'input',
          label: label('buildStats.inputTokens', 'Input tokens'),
          color: '#2f9e8f',
          value: (datum) => datum.input_tokens,
        },
        {
          id: 'output',
          label: label('buildStats.outputTokens', 'Output tokens'),
          color: '#d18616',
          value: (datum) => datum.output_tokens,
        },
      ]}
      tooltipRows={(datum) => {
        const cache = numberValue(datum.cache_read_tokens);
        return [
          ...(cache > 0
            ? [
                {
                  id: 'cache',
                  label: label(
                    'buildStats.cacheInputTokens',
                    'Cache input tokens',
                  ),
                  value: formatCompactNumber(cache),
                  color: '#6f7c8e',
                },
              ]
            : []),
          {
            id: 'estimated-cost',
            label: label('buildStats.cost', 'Cost'),
            value: formatPrice(estimateDailyCost(datum)),
            color: '#8a63d2',
          },
        ];
      }}
    />
  );
}
