import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { buildStatsApi } from '@/lib/buildStatsApi';
import type {
  ActivityDataPoint,
  DailyTokenDataPoint,
  ModelUsageRow,
  SessionCostEntry,
} from '@/types';
import { TimeRangeFilter } from '@/components/TimeRangeFilter';
import { DailyTokenChart } from '@/components/DailyTokenChart';
import { SessionCostList, type SessionCostViewMode } from '@/components/SessionCostList';
import { ModelPricingTable } from '@/components/ModelPricingTable';
import { ActivityTrendChart } from '@/components/ActivityTrendChart';
import {
  formatCompactNumber,
  formatNumber,
  formatPrice,
} from '@/lib/buildStatsUtils';

type TimeRange = '7d' | '30d' | '90d';

const asArray = <T,>(value: T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : [];

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value) || 0
      : 0;

const normalizeDailyTokenDays = (value: unknown): DailyTokenDataPoint[] =>
  asArray(value as DailyTokenDataPoint[]).map((item) => {
    const raw = item as DailyTokenDataPoint & {
      inputTokens?: unknown;
      outputTokens?: unknown;
      totalTokens?: unknown;
    };
    const inputTokens = asNumber(raw.input_tokens ?? raw.inputTokens);
    const outputTokens = asNumber(raw.output_tokens ?? raw.outputTokens);
    const totalTokens = asNumber(raw.total_tokens ?? raw.totalTokens);
    return {
      date: String(raw.date ?? ''),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
    };
  });

const hasTokenData = (days: DailyTokenDataPoint[]): boolean =>
  days.some(
    (item) =>
      asNumber(item.total_tokens) > 0 ||
      asNumber(item.input_tokens) > 0 ||
      asNumber(item.output_tokens) > 0,
  );

const normalizeActivityDays = (value: unknown): ActivityDataPoint[] =>
  asArray(value as ActivityDataPoint[]).map((item) => {
    const raw = item as ActivityDataPoint & {
      bugsFixed?: unknown;
      featuresDelivered?: unknown;
    };
    return {
      date: String(raw.date ?? ''),
      bugs_fixed: asNumber(raw.bugs_fixed ?? raw.bugsFixed),
      features_delivered: asNumber(
        raw.features_delivered ?? raw.featuresDelivered,
      ),
    };
  });

const hasActivityData = (days: ActivityDataPoint[]): boolean =>
  days.some(
    (item) =>
      asNumber(item.bugs_fixed) > 0 ||
      asNumber(item.features_delivered) > 0,
  );

const timeRangeDays: Record<TimeRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const isoDateNDaysAgo = (daysAgo: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

const mockDailyTokens = (range: TimeRange): DailyTokenDataPoint[] => {
  const days = timeRangeDays[range];
  return Array.from({ length: days }, (_, index) => {
    const age = days - index - 1;
    const wave = Math.sin(index / 2.7) * 420_000;
    const input = Math.round(
      3_200_000 + index * 140_000 + wave + (index % 4) * 260_000,
    );
    const output = Math.round(
      1_450_000 + index * 80_000 + wave * 0.35 + (index % 3) * 180_000,
    );
    return {
      date: isoDateNDaysAgo(age),
      input_tokens: Math.max(0, input),
      output_tokens: Math.max(0, output),
      total_tokens: Math.max(0, input + output),
    };
  });
};

const mockActivityDays = (range: TimeRange): ActivityDataPoint[] => {
  const days = timeRangeDays[range];
  return Array.from({ length: days }, (_, index) => ({
    date: isoDateNDaysAgo(days - index - 1),
    bugs_fixed: index % 5 === 0 ? 0 : 1 + ((index * 2) % 4),
    features_delivered: index % 6 === 1 ? 0 : 1 + (index % 3),
  }));
};

const mockSessions: SessionCostEntry[] = [
  {
    session_id: 'mock-session-1',
    title: '修复登录流程中的 OAuth 回调问题',
    input_tokens: 48200,
    output_tokens: 19400,
    total_tokens: 67600,
  },
  {
    session_id: 'mock-session-2',
    title: '构建项目级构建统计 Dashboard',
    input_tokens: 42100,
    output_tokens: 17250,
    total_tokens: 59350,
  },
  {
    session_id: 'mock-session-3',
    title: '重构容器服务与本地部署状态同步',
    input_tokens: 31840,
    output_tokens: 11820,
    total_tokens: 43660,
  },
  {
    session_id: 'mock-session-4',
    title: '补齐模型价格同步与展示逻辑',
    input_tokens: 24600,
    output_tokens: 9400,
    total_tokens: 34000,
  },
  {
    session_id: 'mock-session-5',
    title: '前端空状态与错误兜底验证',
    input_tokens: 15320,
    output_tokens: 6110,
    total_tokens: 21430,
  },
];

const mockScrollableSessions: SessionCostEntry[] = [
  ...mockSessions,
  {
    session_id: 'mock-session-6',
    title: 'Stabilize build statistics hover state',
    input_tokens: 12420,
    output_tokens: 3980,
    total_tokens: 16400,
  },
  {
    session_id: 'mock-session-7',
    title: 'Audit pricing cache sync behavior',
    input_tokens: 10840,
    output_tokens: 2860,
    total_tokens: 13700,
  },
  {
    session_id: 'mock-session-8',
    title: 'Polish chart responsive layout',
    input_tokens: 9120,
    output_tokens: 2440,
    total_tokens: 11560,
  },
  {
    session_id: 'mock-session-9',
    title: 'Validate project scoped analytics query',
    input_tokens: 7800,
    output_tokens: 2180,
    total_tokens: 9980,
  },
  {
    session_id: 'mock-session-10',
    title: 'Repair fallback data normalization',
    input_tokens: 6400,
    output_tokens: 1720,
    total_tokens: 8120,
  },
  {
    session_id: 'mock-session-11',
    title: 'Review session token sorting',
    input_tokens: 5200,
    output_tokens: 1420,
    total_tokens: 6620,
  },
  {
    session_id: 'mock-session-12',
    title: 'Tune compact number formatting',
    input_tokens: 3980,
    output_tokens: 980,
    total_tokens: 4960,
  },
];

const mockModels: ModelUsageRow[] = [
  {
    model_id: 'gpt-5.4',
    model_name: 'GPT-5.4',
    input_tokens: 84500,
    output_tokens: 32900,
    total_tokens: 117400,
    input_price_per_1m: 1.25,
    output_price_per_1m: 10,
    estimated_cost: 0.4356,
    price_source: 'mock',
  },
  {
    model_id: 'claude-sonnet-4-6',
    model_name: 'Claude Sonnet 4.6',
    input_tokens: 61200,
    output_tokens: 22800,
    total_tokens: 84000,
    input_price_per_1m: 3,
    output_price_per_1m: 15,
    estimated_cost: 0.5256,
    price_source: 'mock',
  },
  {
    model_id: 'gpt-5.4-mini',
    model_name: 'GPT-5.4 mini',
    input_tokens: 53100,
    output_tokens: 18700,
    total_tokens: 71800,
    input_price_per_1m: 0.15,
    output_price_per_1m: 0.6,
    estimated_cost: 0.0192,
    price_source: 'mock',
  },
  {
    model_id: 'gemini-3-pro',
    model_name: 'Gemini 3 Pro',
    input_tokens: 38200,
    output_tokens: 14100,
    total_tokens: 52300,
    input_price_per_1m: 1.25,
    output_price_per_1m: 10,
    estimated_cost: 0.1888,
    price_source: 'mock',
  },
  {
    model_id: 'kimi-k2.6',
    model_name: 'Kimi K2.6',
    input_tokens: 29500,
    output_tokens: 9900,
    total_tokens: 39400,
    input_price_per_1m: 0.6,
    output_price_per_1m: 2.5,
    estimated_cost: 0.0425,
    price_source: 'mock',
  },
];

export function BuildStatsPage() {
  const { t, selectedProjectId } = useWorkspace();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [sessionViewMode, setSessionViewMode] =
    useState<SessionCostViewMode>('bar');

  const [dailyTokens, setDailyTokens] = useState<DailyTokenDataPoint[]>([]);
  const [dailyTokensLoading, setDailyTokensLoading] = useState(true);
  const [dailyTokensError, setDailyTokensError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionCostEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [activityDays, setActivityDays] = useState<ActivityDataPoint[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [models, setModels] = useState<ModelUsageRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const text = useCallback(
    (key: string, fallback: string) => {
      const value = t(key);
      return value === key ? fallback : value;
    },
    [t],
  );

  const fetchDailyTokens = useCallback(async () => {
    if (!selectedProjectId) {
      setDailyTokens(mockDailyTokens(timeRange));
      setDailyTokensLoading(false);
      setDailyTokensError(null);
      return;
    }
    setDailyTokensLoading(true);
    setDailyTokensError(null);
    try {
      const res = await buildStatsApi.getDailyTokens(selectedProjectId, timeRange);
      const days = normalizeDailyTokenDays(res?.days);
      setDailyTokens(hasTokenData(days) ? days : mockDailyTokens(timeRange));
    } catch {
      setDailyTokens(mockDailyTokens(timeRange));
      setDailyTokensError(null);
    } finally {
      setDailyTokensLoading(false);
    }
  }, [selectedProjectId, timeRange, t]);

  const fetchActivity = useCallback(async () => {
    if (!selectedProjectId) {
      setActivityDays(mockActivityDays(timeRange));
      setActivityLoading(false);
      setActivityError(null);
      return;
    }
    setActivityLoading(true);
    setActivityError(null);
    try {
      const res = await buildStatsApi.getActivity(selectedProjectId, timeRange);
      if (Array.isArray(res?.days)) {
        const days = normalizeActivityDays(res.days);
        setActivityDays(hasActivityData(days) ? days : mockActivityDays(timeRange));
      } else {
        const legacy = res as unknown as {
          bugs_fixed?: number;
          features_delivered?: number;
        };
        const legacyDays = [
          {
            date: new Date().toISOString().slice(0, 10),
            bugs_fixed: asNumber(legacy?.bugs_fixed),
            features_delivered: asNumber(legacy?.features_delivered),
          },
        ];
        setActivityDays(
          hasActivityData(legacyDays) ? legacyDays : mockActivityDays(timeRange),
        );
      }
    } catch {
      setActivityDays(mockActivityDays(timeRange));
      setActivityError(null);
    } finally {
      setActivityLoading(false);
    }
  }, [selectedProjectId, timeRange, t]);

  const fetchSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions(mockScrollableSessions);
      setSessionsLoading(false);
      setSessionsError(null);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await buildStatsApi.getSessionTokens(selectedProjectId);
      const sessions = asArray(res?.sessions);
      setSessions(sessions.length > 0 ? sessions : mockScrollableSessions);
    } catch {
      setSessions(mockScrollableSessions);
      setSessionsError(null);
    } finally {
      setSessionsLoading(false);
    }
  }, [selectedProjectId, t]);

  const fetchModels = useCallback(async () => {
    if (!selectedProjectId) {
      setModels(mockModels);
      setModelsLoading(false);
      setModelsError(null);
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await buildStatsApi.getModelPricing(selectedProjectId);
      const models = asArray(res?.models);
      setModels(models.length > 0 ? models : mockModels);
    } catch {
      setModels(mockModels);
      setModelsError(null);
    } finally {
      setModelsLoading(false);
    }
  }, [selectedProjectId, t]);

  useEffect(() => {
    void fetchDailyTokens();
    void fetchActivity();
  }, [fetchDailyTokens, fetchActivity]);

  useEffect(() => {
    void fetchSessions();
    void fetchModels();
  }, [fetchSessions, fetchModels]);

  const totals = useMemo(() => {
    const tokenTotal = dailyTokens.reduce(
      (sum, item) => sum + asNumber(item.total_tokens),
      0,
    );
    const bugsFixed = activityDays.reduce(
      (sum, item) => sum + asNumber(item.bugs_fixed),
      0,
    );
    const featuresDelivered = activityDays.reduce(
      (sum, item) => sum + asNumber(item.features_delivered),
      0,
    );
    const modelCost = models.reduce(
      (sum, item) => sum + asNumber(item.estimated_cost),
      0,
    );
    return { tokenTotal, bugsFixed, featuresDelivered, modelCost };
  }, [activityDays, dailyTokens, models]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--surface-2)] p-4 md:p-5">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--ink)]">
            {t('buildStats.title')}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--ink-subtle)]">
            {text(
              'buildStats.subtitle',
              'Token usage, delivery activity, session cost, and model spend for the current project.',
            )}
          </p>
        </div>
        <TimeRangeFilter value={timeRange} onChange={setTimeRange} t={text} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label={text('buildStats.totalTokens', 'Total tokens')}
          value={formatCompactNumber(totals.tokenTotal)}
        />
        <MetricTile
          label={t('buildStats.bugsFixed')}
          value={formatNumber(totals.bugsFixed)}
        />
        <MetricTile
          label={t('buildStats.featuresDelivered')}
          value={formatNumber(totals.featuresDelivered)}
        />
        <MetricTile
          label={text('buildStats.topModelCost', 'Top model cost')}
          value={formatPrice(totals.modelCost)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title={t('buildStats.dailyTokens')}
          error={dailyTokensError}
          onRetry={() => void fetchDailyTokens()}
          retryLabel={t('buildStats.error.retry')}
        >
          <DailyTokenChart data={dailyTokens} loading={dailyTokensLoading} t={t} />
        </Panel>

        <Panel
          title={text('buildStats.deliveryTrend', 'Build statistics')}
          error={activityError}
          onRetry={() => void fetchActivity()}
          retryLabel={t('buildStats.error.retry')}
        >
          <ActivityTrendChart data={activityDays} loading={activityLoading} t={t} />
        </Panel>

        <Panel
          title={t('buildStats.sessionTokens')}
          error={sessionsError}
          onRetry={() => void fetchSessions()}
          retryLabel={t('buildStats.error.retry')}
          action={
            <div className="inline-flex overflow-hidden rounded-sm border border-[var(--hairline)]">
              {(['list', 'bar'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sessionViewMode === mode}
                  onClick={() => setSessionViewMode(mode)}
                  className={`px-2.5 py-1 text-[12px] font-medium transition ${
                    sessionViewMode === mode
                      ? 'bg-[var(--surface-3)] text-[var(--ink)]'
                      : 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
                  }`}
                >
                  {mode === 'list'
                    ? text('buildStats.view.list', 'List')
                    : text('buildStats.view.bar', 'Bar')}
                </button>
              ))}
            </div>
          }
        >
          <SessionCostList
            sessions={sessions}
            loading={sessionsLoading}
            mode={sessionViewMode}
            t={t}
          />
        </Panel>

        <Panel title={text('buildStats.topModels', 'Top 5 model usage')}>
          <ModelPricingTable
            models={models}
            loading={modelsLoading}
            error={modelsError}
            onRetry={() => void fetchModels()}
            t={t}
          />
        </Panel>
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2.5">
      <p className="text-[12px] font-medium text-[var(--ink-tertiary)]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-semibold text-[var(--ink)]">
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  children,
  error,
  onRetry,
  retryLabel,
  action,
}: {
  title: string;
  children: React.ReactNode;
  error?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-[var(--ink)]">{title}</h2>
        {action}
      </div>
      {children}
      {error && onRetry && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--ink-subtle)]">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer font-medium text-[var(--primary)] hover:underline"
          >
            {retryLabel}
          </button>
        </div>
      )}
    </section>
  );
}
