import React from 'react';
import type { ActivityDataPoint } from '@/types';
import { SimpleLineChart } from '@/components/SimpleLineChart';

export interface ActivityTrendChartProps {
  data: ActivityDataPoint[];
  loading: boolean;
  t: (key: string, replacements?: Record<string, string | number>) => string;
}

export function ActivityTrendChart({
  data,
  loading,
  t,
}: ActivityTrendChartProps) {
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
      emptyLabel={label(
        'buildStats.empty.noActivityData',
        'No build activity data',
      )}
      pointAriaLabel={(date, series) =>
        label('buildStats.chart.point', '{date} {series} chart point', {
          date,
          series,
        })
      }
      series={[
        {
          id: 'bugs',
          label: label('buildStats.bugsFixed', 'Bugs fixed'),
          color: '#2f9e8f',
          value: (datum) => datum.bugs_fixed,
        },
        {
          id: 'features',
          label: label('buildStats.featuresDelivered', 'Features delivered'),
          color: '#5e6ad2',
          value: (datum) => datum.features_delivered,
        },
      ]}
    />
  );
}
