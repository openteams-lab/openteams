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
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  return (
    <SimpleLineChart
      data={data}
      loading={loading}
      emptyLabel={label('buildStats.empty.noActivityData', 'No build activity data')}
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
