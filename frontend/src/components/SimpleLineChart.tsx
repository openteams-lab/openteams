import React, { useEffect, useRef, useState } from 'react';
import { formatChartDate, formatNumber } from '@/lib/buildStatsUtils';

export interface SimpleLineChartSeries<T> {
  id: string;
  label: string;
  color: string;
  value: (datum: T) => number;
}

export interface SimpleLineChartTooltipRow {
  id: string;
  label: string;
  value: string;
  color?: string;
}

export interface SimpleLineChartProps<T extends { date: string }> {
  data: T[];
  series: SimpleLineChartSeries<T>[];
  loading: boolean;
  emptyLabel: string;
  height?: number;
  fillHeight?: boolean;
  formatValue?: (value: number) => string;
  tooltipRows?: (datum: T) => SimpleLineChartTooltipRow[];
  onDatumClick?: (datum: T) => void;
  loadingLabel?: string;
  pointAriaLabel?: (date: string, seriesLabel: string) => string;
}

const chartPadding = {
  top: 16,
  right: 18,
  bottom: 28,
  left: 44,
};

export function SimpleLineChart<T extends { date: string }>({
  data,
  series,
  loading,
  emptyLabel,
  height = 220,
  fillHeight = false,
  formatValue = formatNumber,
  tooltipRows,
  onDatumClick,
  loadingLabel = 'Loading chart',
  pointAriaLabel,
}: SimpleLineChartProps<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [measuredSize, setMeasuredSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const chartData = Array.isArray(data) ? data : [];
  const chartSeries = Array.isArray(series) ? series : [];
  const numberValue = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value) || 0
        : 0;
  const seriesValue = (item: SimpleLineChartSeries<T>, datum: T): number => {
    try {
      return numberValue(item.value(datum));
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    if (!fillHeight || !frameRef.current) return;

    const element = frameRef.current;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setMeasuredSize({
        width: rect.width > 0 ? Math.round(rect.width) : 720,
        height: rect.height > 0 ? Math.round(rect.height) : height,
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fillHeight, height]);

  const chartWidth = fillHeight ? (measuredSize?.width ?? 720) : 720;
  const chartHeight = fillHeight ? (measuredSize?.height ?? height) : height;

  if (loading) {
    return (
      <div
        className={`w-full animate-pulse rounded bg-[var(--surface-2)] ${
          fillHeight ? 'h-full min-h-0' : ''
        }`}
        style={fillHeight ? undefined : { height }}
        role="status"
        aria-label={loadingLabel}
      />
    );
  }

  if (chartData.length === 0 || chartSeries.length === 0) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-[var(--hairline)] bg-[var(--surface-2)] text-xs text-[var(--ink-subtle)] ${
          fillHeight ? 'h-full min-h-0' : ''
        }`}
        style={fillHeight ? undefined : { height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const width = Math.max(320, chartWidth);
  const effectiveHeight = Math.max(120, chartHeight);
  const innerWidth = width - chartPadding.left - chartPadding.right;
  const innerHeight =
    effectiveHeight - chartPadding.top - chartPadding.bottom;
  const values = chartData.flatMap((datum) =>
    chartSeries.map((item) => Math.max(0, seriesValue(item, datum))),
  );
  const maxValue = Math.max(1, ...values);
  const xFor = (index: number) =>
    chartPadding.left +
    (chartData.length <= 1
      ? innerWidth / 2
      : (index / (chartData.length - 1)) * innerWidth);
  const yFor = (value: number) =>
    chartPadding.top +
    innerHeight -
    (Math.max(0, value) / maxValue) * innerHeight;
  const yTicks = Array.from(new Set([0, Math.ceil(maxValue / 2), maxValue]));
  const xTickIndexes = Array.from(
    new Set(
      [0, Math.floor((chartData.length - 1) / 2), chartData.length - 1].filter(
        (index) => index >= 0,
      ),
    ),
  );
  const activeDatum =
    activeIndex === null ? null : (chartData[activeIndex] ?? null);
  const activeTooltipRows = activeDatum ? (tooltipRows?.(activeDatum) ?? []) : [];
  const tooltipWidth = 240;
  const tooltipHeight =
    38 + chartSeries.length * 18 + activeTooltipRows.length * 22;
  const tooltipX =
    activeIndex === null
      ? 0
      : Math.min(
          width - tooltipWidth - 8,
          Math.max(8, xFor(activeIndex) - tooltipWidth / 2),
        );
  const activeMaxY =
    activeDatum === null
      ? chartPadding.top
      : Math.min(
          ...chartSeries.map((item) => yFor(seriesValue(item, activeDatum))),
        );
  const tooltipY =
    activeDatum === null
      ? 0
      : Math.max(8, activeMaxY - tooltipHeight - 12);

  return (
    <div
      className={fillHeight ? 'flex h-full min-h-0 w-full flex-col' : 'w-full'}
    >
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        {chartSeries.map((item) => (
          <span
            key={item.id}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink-muted)]"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
      <div ref={frameRef} className={fillHeight ? 'min-h-0 flex-1' : ''}>
        <svg
          viewBox={`0 0 ${width} ${effectiveHeight}`}
          className={`w-full overflow-visible ${fillHeight ? 'h-full' : ''}`}
          style={fillHeight ? undefined : { height: effectiveHeight }}
          role="img"
        >
          {yTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line
                  x1={chartPadding.left}
                  x2={width - chartPadding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--hairline)"
                  strokeDasharray={tick === 0 ? undefined : '4 5'}
                />
                <text
                  x={chartPadding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[var(--ink-tertiary)] text-[10px]"
                >
                  {formatValue(tick)}
                </text>
              </g>
            );
          })}

        {chartSeries.map((item) => {
          const points = chartData
            .map(
              (datum, index) =>
                `${xFor(index)},${yFor(seriesValue(item, datum))}`,
            )
            .join(' ');
          return (
            <polyline
              key={item.id}
              points={points}
              fill="none"
              stroke={item.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {chartSeries.flatMap((item) =>
          chartData.map((datum, index) => (
            <circle
              key={`${item.id}-${datum.date}`}
              cx={xFor(index)}
              cy={yFor(seriesValue(item, datum))}
              r={activeIndex === index ? 4 : 2.75}
              fill={item.color}
              stroke="var(--surface-1)"
              strokeWidth={activeIndex === index ? 2 : 1}
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}

        {chartSeries.flatMap((item) =>
          chartData.map((datum, index) => (
            <circle
              key={`hit-${item.id}-${datum.date}-${index}`}
              cx={xFor(index)}
              cy={yFor(seriesValue(item, datum))}
              r={12}
              fill="transparent"
              tabIndex={0}
              role={onDatumClick ? 'button' : undefined}
              aria-label={
                pointAriaLabel?.(formatChartDate(datum.date), item.label) ??
                `${formatChartDate(datum.date)} ${item.label} chart point`
              }
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              onPointerEnter={() => setActiveIndex(index)}
              onPointerLeave={() => setActiveIndex(null)}
              onClick={() => onDatumClick?.(datum)}
              onKeyDown={(event) => {
                if (!onDatumClick) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onDatumClick(datum);
                }
              }}
              className={onDatumClick ? 'cursor-pointer' : undefined}
            />
          )),
        )}

        {activeIndex !== null && activeDatum && (
          <g pointerEvents="none">
            <line
              x1={xFor(activeIndex)}
              x2={xFor(activeIndex)}
              y1={chartPadding.top}
              y2={effectiveHeight - chartPadding.bottom}
              stroke="var(--ink-tertiary)"
              strokeDasharray="3 4"
              opacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
            <foreignObject
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
            >
              <div className="rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-3 py-2 text-xs">
                <div className="mb-1 font-semibold text-[var(--ink)]">
                  {formatChartDate(activeDatum.date)}
                </div>
                <div className="space-y-1">
                  {chartSeries.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--ink-subtle)]">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[var(--ink)]">
                        {formatValue(seriesValue(item, activeDatum))}
                      </span>
                    </div>
                  ))}
                  {activeTooltipRows.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-1"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--ink-subtle)]">
                        {item.color && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[var(--ink)]">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </foreignObject>
          </g>
        )}

        {xTickIndexes.map((index) => (
          <text
            key={index}
            x={xFor(index)}
            y={effectiveHeight - 8}
            textAnchor="middle"
            className="fill-[var(--ink-tertiary)] text-[10px]"
          >
            {formatChartDate(chartData[index]?.date ?? '')}
          </text>
        ))}
        </svg>
      </div>
    </div>
  );
}
