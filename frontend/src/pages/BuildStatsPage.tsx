import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeft } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { buildStatsApi } from '@/lib/buildStatsApi';
import type {
  ActivityDataPoint,
  DailyTokenDataPoint,
  ModelUsageRow,
  SessionCostEntry,
  WorkflowStepTokenEntry,
} from '@/types';
import { TimeRangeFilter } from '@/components/TimeRangeFilter';
import { DailyTokenChart } from '@/components/DailyTokenChart';
import { SessionCostList } from '@/components/SessionCostList';
import { ModelPricingTable } from '@/components/ModelPricingTable';
import { ActivityTrendChart } from '@/components/ActivityTrendChart';
import {
  formatCompactNumber,
  formatNumber,
  formatPrice,
  truncateTitle,
} from '@/lib/buildStatsUtils';
import {
  notifyBuildStatsPricingUpdated,
  onBuildStatsUpdated,
} from '@/lib/buildStatsEvents';

type TimeRange = '7d' | '30d' | '90d';

const asArray = <T,>(value: T[] | null | undefined): T[] =>
  Array.isArray(value) ? value : [];

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value) || 0
      : 0;

const asOptionalString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const normalizeDailyTokenDays = (value: unknown): DailyTokenDataPoint[] =>
  asArray(value as DailyTokenDataPoint[]).map((item) => {
    const raw = item as DailyTokenDataPoint & {
      inputTokens?: unknown;
      outputTokens?: unknown;
      cacheReadTokens?: unknown;
      reasoningOutputTokens?: unknown;
      totalTokens?: unknown;
      estimatedCost?: unknown;
    };
    const inputTokens = asNumber(raw.input_tokens ?? raw.inputTokens);
    const outputTokens = asNumber(raw.output_tokens ?? raw.outputTokens);
    const cacheReadTokens = asNumber(
      raw.cache_read_tokens ?? raw.cacheReadTokens,
    );
    const reasoningOutputTokens = asNumber(
      raw.reasoning_output_tokens ?? raw.reasoningOutputTokens,
    );
    const totalTokens = asNumber(raw.total_tokens ?? raw.totalTokens);
    return {
      date: String(raw.date ?? ''),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      reasoning_output_tokens: reasoningOutputTokens,
      total_tokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
      estimated_cost: asNumber(raw.estimated_cost ?? raw.estimatedCost),
    };
  });

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

const normalizeWorkflowStepTokens = (value: unknown): WorkflowStepTokenEntry[] =>
  asArray(value as WorkflowStepTokenEntry[]).map((item) => {
    const raw = item as WorkflowStepTokenEntry & {
      sessionId?: unknown;
      sessionTitle?: unknown;
      workflowExecutionId?: unknown;
      workflowStepId?: unknown;
      workflowStepKey?: unknown;
      workflowStepTitle?: unknown;
      agentName?: unknown;
      latestRunId?: unknown;
      runCount?: unknown;
      inputTokens?: unknown;
      outputTokens?: unknown;
      cacheReadTokens?: unknown;
      reasoningOutputTokens?: unknown;
      totalTokens?: unknown;
      estimatedCost?: unknown;
      modelId?: unknown;
      modelName?: unknown;
    };
    const inputTokens = asNumber(raw.input_tokens ?? raw.inputTokens);
    const outputTokens = asNumber(raw.output_tokens ?? raw.outputTokens);
    const cacheReadTokens = asNumber(
      raw.cache_read_tokens ?? raw.cacheReadTokens,
    );
    const totalTokens = asNumber(raw.total_tokens ?? raw.totalTokens);
    return {
      session_id: String(raw.session_id ?? raw.sessionId ?? ''),
      session_title: String(raw.session_title ?? raw.sessionTitle ?? ''),
      workflow_execution_id: String(
        raw.workflow_execution_id ?? raw.workflowExecutionId ?? '',
      ),
      workflow_step_id: String(raw.workflow_step_id ?? raw.workflowStepId ?? ''),
      workflow_step_key: String(raw.workflow_step_key ?? raw.workflowStepKey ?? ''),
      workflow_step_title: String(
        raw.workflow_step_title ?? raw.workflowStepTitle ?? '',
      ),
      agent_name: asOptionalString(raw.agent_name ?? raw.agentName),
      latest_run_id: asOptionalString(raw.latest_run_id ?? raw.latestRunId),
      run_count: asNumber(raw.run_count ?? raw.runCount),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      reasoning_output_tokens: asNumber(
        raw.reasoning_output_tokens ?? raw.reasoningOutputTokens,
      ),
      total_tokens:
        totalTokens > 0 ? totalTokens : inputTokens + outputTokens,
      estimated_cost: asNumber(raw.estimated_cost ?? raw.estimatedCost),
      model_id: asOptionalString(raw.model_id ?? raw.modelId),
      model_name: asOptionalString(raw.model_name ?? raw.modelName),
    };
  });

export function BuildStatsPage() {
  const { t, selectedProjectId } = useWorkspace();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [selectedTokenDate, setSelectedTokenDate] = useState<string | null>(
    null,
  );
  const [selectedSession, setSelectedSession] =
    useState<SessionCostEntry | null>(null);

  const [dailyTokens, setDailyTokens] = useState<DailyTokenDataPoint[]>([]);
  const [dailyTokensLoading, setDailyTokensLoading] = useState(true);
  const [dailyTokensError, setDailyTokensError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionCostEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [workflowStepTokens, setWorkflowStepTokens] = useState<
    WorkflowStepTokenEntry[]
  >([]);
  const [workflowStepTokensLoading, setWorkflowStepTokensLoading] =
    useState(false);
  const [workflowStepTokensError, setWorkflowStepTokensError] = useState<
    string | null
  >(null);

  const [activityDays, setActivityDays] = useState<ActivityDataPoint[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [models, setModels] = useState<ModelUsageRow[]>([]);
  const [modelCostModels, setModelCostModels] = useState<ModelUsageRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsLoadedRef = useRef(false);

  const text = useCallback(
    (key: string, fallback: string) => {
      const value = t(key);
      return value === key ? fallback : value;
    },
    [t],
  );

  const fetchDailyTokens = useCallback(async () => {
    if (!selectedProjectId) {
      setDailyTokens([]);
      setDailyTokensLoading(false);
      setDailyTokensError(null);
      return;
    }
    setDailyTokensLoading(true);
    setDailyTokensError(null);
    try {
      const res = await buildStatsApi.getDailyTokens(selectedProjectId, timeRange);
      const days = normalizeDailyTokenDays(res?.days);
      setDailyTokens(days);
    } catch {
      setDailyTokens([]);
      setDailyTokensError(t('buildStats.error.fetchFailed'));
    } finally {
      setDailyTokensLoading(false);
    }
  }, [selectedProjectId, timeRange, t]);

  const fetchActivity = useCallback(async () => {
    if (!selectedProjectId) {
      setActivityDays([]);
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
        setActivityDays(days);
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
        setActivityDays(legacyDays);
      }
    } catch {
      setActivityDays([]);
      setActivityError(t('buildStats.error.fetchFailed'));
    } finally {
      setActivityLoading(false);
    }
  }, [selectedProjectId, timeRange, t]);

  const fetchSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([]);
      setSessionsLoading(false);
      setSessionsError(null);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await buildStatsApi.getSessionTokens(selectedProjectId);
      const sessions = asArray(res?.sessions);
      setSessions(sessions);
    } catch {
      setSessions([]);
      setSessionsError(t('buildStats.error.fetchFailed'));
    } finally {
      setSessionsLoading(false);
    }
  }, [selectedProjectId, t]);

  const fetchWorkflowStepTokens = useCallback(async () => {
    if (!selectedSession) {
      setWorkflowStepTokens([]);
      setWorkflowStepTokensLoading(false);
      setWorkflowStepTokensError(null);
      return;
    }
    if (!selectedProjectId) {
      setWorkflowStepTokens([]);
      setWorkflowStepTokensLoading(false);
      setWorkflowStepTokensError(null);
      return;
    }

    setWorkflowStepTokensLoading(true);
    setWorkflowStepTokensError(null);
    try {
      const res = await buildStatsApi.getSessionWorkflowStepTokens(
        selectedProjectId,
        selectedSession.session_id,
      );
      setWorkflowStepTokens(normalizeWorkflowStepTokens(res?.steps));
    } catch {
      setWorkflowStepTokens([]);
      setWorkflowStepTokensError(t('buildStats.error.fetchFailed'));
    } finally {
      setWorkflowStepTokensLoading(false);
    }
  }, [selectedProjectId, selectedSession, t]);

  const fetchModels = useCallback(async () => {
    if (!selectedProjectId) {
      setModels([]);
      setModelCostModels([]);
      setModelsLoading(false);
      setModelsError(null);
      modelsLoadedRef.current = true;
      return;
    }
    setModelsLoading(!modelsLoadedRef.current);
    setModelsError(null);
    try {
      const res = await buildStatsApi.getModelPricing(
        selectedProjectId,
        timeRange,
        selectedTokenDate ?? undefined,
      );
      const models = asArray(res?.models);
      setModels(models);
      if (!selectedTokenDate) {
        setModelCostModels(models);
      }
      modelsLoadedRef.current = true;
    } catch {
      if (!modelsLoadedRef.current) {
        setModels([]);
        setModelsError(t('buildStats.error.fetchFailed'));
      }
    } finally {
      setModelsLoading(false);
    }
  }, [selectedProjectId, selectedTokenDate, timeRange, t]);

  const refreshCostData = useCallback(async () => {
    await Promise.all([fetchDailyTokens(), fetchSessions(), fetchModels()]);
    if (selectedProjectId) {
      notifyBuildStatsPricingUpdated(selectedProjectId);
    }
  }, [fetchDailyTokens, fetchSessions, fetchModels, selectedProjectId]);

  useEffect(() => {
    void fetchDailyTokens();
    void fetchActivity();
  }, [fetchDailyTokens, fetchActivity]);

  useEffect(() => {
    modelsLoadedRef.current = false;
  }, [selectedProjectId]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    void fetchWorkflowStepTokens();
  }, [fetchWorkflowStepTokens]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    if (!selectedProjectId) return undefined;
    return onBuildStatsUpdated((projectId) => {
      if (projectId === selectedProjectId) {
        void fetchDailyTokens();
        void fetchActivity();
        void fetchSessions();
        void fetchModels();
      }
    });
  }, [
    selectedProjectId,
    fetchDailyTokens,
    fetchActivity,
    fetchSessions,
    fetchModels,
  ]);

  useEffect(() => {
    setSelectedSession(null);
    setWorkflowStepTokens([]);
    setWorkflowStepTokensError(null);
  }, [selectedProjectId]);

  useEffect(() => {
    if (
      selectedSession &&
      !sessions.some((session) => session.session_id === selectedSession.session_id)
    ) {
      setSelectedSession(null);
      setWorkflowStepTokens([]);
      setWorkflowStepTokensError(null);
    }
  }, [selectedSession, sessions]);

  useEffect(() => {
    if (
      selectedTokenDate &&
      !dailyTokens.some((datum) => datum.date === selectedTokenDate)
    ) {
      setSelectedTokenDate(null);
    }
  }, [dailyTokens, selectedTokenDate]);

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
    const modelCost = modelCostModels.reduce(
      (sum, item) => sum + asNumber(item.estimated_cost),
      0,
    );
    return { tokenTotal, bugsFixed, featuresDelivered, modelCost };
  }, [activityDays, dailyTokens, modelCostModels]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)] p-3 md:p-4">
      <div className="mb-3 flex shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--ink)]">
            {t('buildStats.title')}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--ink-subtle)]">
            {text(
              'buildStats.subtitle',
              'Token usage, delivery activity, session cost, and model spend for the current project.',
            )}
          </p>
        </div>
        <TimeRangeFilter value={timeRange} onChange={setTimeRange} t={text} />
      </div>

      <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
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
          label={text('buildStats.modelCost', 'Model cost')}
          value={formatPrice(totals.modelCost)}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[repeat(4,minmax(0,1fr))] gap-3 lg:grid-cols-2 lg:grid-rows-[repeat(2,minmax(0,1fr))]">
        <Panel
          title={t('buildStats.dailyTokens')}
          error={dailyTokensError}
          onRetry={() => void fetchDailyTokens()}
          retryLabel={t('buildStats.error.retry')}
        >
          <DailyTokenChart
            data={dailyTokens}
            loading={dailyTokensLoading}
            onDateSelect={setSelectedTokenDate}
            t={t}
            fillHeight
          />
        </Panel>

        <Panel
          title={text('buildStats.deliveryTrend', 'Build statistics')}
          error={activityError}
          onRetry={() => void fetchActivity()}
          retryLabel={t('buildStats.error.retry')}
        >
          <ActivityTrendChart
            data={activityDays}
            loading={activityLoading}
            t={t}
            fillHeight
          />
        </Panel>

        <Panel
          title={t('buildStats.sessionTokens')}
          error={sessionsError}
          onRetry={() => void fetchSessions()}
          retryLabel={t('buildStats.error.retry')}
        >
          {selectedSession ? (
            <WorkflowStepTokenDrilldown
              session={selectedSession}
              steps={workflowStepTokens}
              loading={workflowStepTokensLoading}
              error={workflowStepTokensError}
              onBack={() => setSelectedSession(null)}
              onRetry={() => void fetchWorkflowStepTokens()}
              t={text}
            />
          ) : (
            <SessionCostList
              sessions={sessions}
              loading={sessionsLoading}
              mode="bar"
              selectedSessionId={null}
              onSessionSelect={setSelectedSession}
              t={t}
            />
          )}
        </Panel>

        <Panel
          title={text('buildStats.modelUsage', 'Model usage')}
          action={
            selectedTokenDate ? (
              <button
                type="button"
                onClick={() => setSelectedTokenDate(null)}
                aria-label={text(
                  'buildStats.clearDateFilter',
                  'Clear date filter',
                )}
                className="inline-flex items-center gap-1 rounded-sm border border-[var(--hairline)] px-2 py-1 font-mono text-[11px] text-[var(--ink-subtle)] transition hover:text-[var(--ink)]"
              >
                {selectedTokenDate}
                <span aria-hidden="true">x</span>
              </button>
            ) : undefined
          }
        >
          <ModelPricingTable
            models={models}
            loading={modelsLoading}
            error={modelsError}
            onRetry={() => void fetchModels()}
            projectId={selectedProjectId}
            onPricingUpdated={refreshCostData}
            t={t}
          />
        </Panel>
      </div>
    </div>
  );
}

function WorkflowStepTokenDrilldown({
  session,
  steps,
  loading,
  error,
  onBack,
  onRetry,
  t,
}: {
  session: SessionCostEntry;
  steps: WorkflowStepTokenEntry[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  t: (key: string, fallback: string) => string;
}) {
  const totals = steps.reduce(
    (sum, step) => ({
      tokens: sum.tokens + asNumber(step.total_tokens),
      cost: sum.cost + asNumber(step.estimated_cost),
      runs: sum.runs + asNumber(step.run_count),
    }),
    { tokens: 0, cost: 0, runs: 0 },
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mb-1 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ink-subtle)] transition hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t('buildStats.workflowSteps.back', 'Sessions')}
          </button>
          <p className="truncate text-[13px] font-medium text-[var(--ink)]">
            {session.title || session.session_id}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-3 gap-2 text-right">
          <MetricPill
            label={t('buildStats.workflowSteps.tokens', 'Tokens')}
            value={formatCompactNumber(totals.tokens)}
          />
          <MetricPill
            label={t('buildStats.workflowSteps.runs', 'Runs')}
            value={formatNumber(totals.runs)}
          />
          <MetricPill
            label={t('buildStats.workflowSteps.cost', 'Cost')}
            value={formatPrice(totals.cost)}
          />
        </div>
      </div>

      {loading ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-8 animate-pulse rounded bg-[var(--surface-2)]"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[12px] text-[var(--ink-subtle)]">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="font-medium text-[var(--primary)] hover:underline"
          >
            {t('buildStats.error.retry', 'Retry')}
          </button>
        </div>
      ) : steps.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-[var(--hairline)] bg-[var(--surface-1)] px-3 text-center text-[12px] text-[var(--ink-subtle)]">
          {t(
            'buildStats.workflowSteps.empty',
            'No workflow step token usage for this session yet.',
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-[var(--hairline)]">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-[var(--surface-1)] text-[var(--ink-tertiary)]">
              <tr className="border-b border-[var(--hairline)]">
                <th className="px-3 py-1.5 font-medium">
                  {t('buildStats.workflowSteps.step', 'Step')}
                </th>
                <th className="px-3 py-1.5 font-medium">
                  {t('buildStats.workflowSteps.agent', 'Agent')}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t('buildStats.workflowSteps.total', 'Total')}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t('buildStats.workflowSteps.breakdown', 'In / Out')}
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t('buildStats.workflowSteps.cost', 'Cost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr
                  key={step.workflow_step_id}
                  className="border-b border-[var(--hairline)] last:border-b-0"
                >
                  <td className="max-w-[220px] px-3 py-1.5">
                    <div
                      className="truncate font-medium text-[var(--ink)]"
                      title={step.workflow_step_title}
                    >
                      {truncateTitle(
                        step.workflow_step_title || step.workflow_step_key,
                        44,
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-[var(--ink-tertiary)]">
                      {step.workflow_step_key}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-[var(--ink-muted)]">
                    {step.agent_name || step.model_name || '-'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--ink)]">
                    {formatNumber(asNumber(step.total_tokens))}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--ink-muted)]">
                    {formatCompactNumber(asNumber(step.input_tokens))} /{' '}
                    {formatCompactNumber(asNumber(step.output_tokens))}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--ink)]">
                    {formatPrice(asNumber(step.estimated_cost))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-[var(--ink-tertiary)]">
        {label}
      </div>
      <div className="font-mono text-[12px] font-semibold text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2">
      <p className="text-[11px] font-medium text-[var(--ink-tertiary)]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base font-semibold text-[var(--ink)]">
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
    <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-[var(--ink)]">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {error && onRetry && (
        <div className="mt-2 flex shrink-0 items-center gap-2 text-[12px] text-[var(--ink-subtle)]">
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
