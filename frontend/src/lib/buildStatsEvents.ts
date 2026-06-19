const BUILD_STATS_PRICING_UPDATED = 'openteams:build-stats-pricing-updated';
const BUILD_STATS_UPDATED = 'openteams:build-stats-updated';

export type BuildStatsUpdateReason = 'pricing' | 'usage';

const notifyBuildStatsUpdated = (
  projectId: string,
  reason: BuildStatsUpdateReason,
) => {
  window.dispatchEvent(
    new CustomEvent(BUILD_STATS_UPDATED, {
      detail: { projectId, reason },
    }),
  );
};

export const notifyBuildStatsPricingUpdated = (projectId: string) => {
  notifyBuildStatsUpdated(projectId, 'pricing');
  window.dispatchEvent(
    new CustomEvent(BUILD_STATS_PRICING_UPDATED, {
      detail: { projectId },
    }),
  );
};

export const notifyBuildStatsUsageUpdated = (projectId: string) => {
  notifyBuildStatsUpdated(projectId, 'usage');
};

export const onBuildStatsUpdated = (
  listener: (projectId: string, reason: BuildStatsUpdateReason) => void,
) => {
  const handler = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        projectId?: string;
        reason?: BuildStatsUpdateReason;
      }>
    ).detail;
    if (detail?.projectId && detail.reason) {
      listener(detail.projectId, detail.reason);
    }
  };

  window.addEventListener(BUILD_STATS_UPDATED, handler);
  return () => window.removeEventListener(BUILD_STATS_UPDATED, handler);
};

export const onBuildStatsPricingUpdated = (
  listener: (projectId: string) => void,
) => {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ projectId?: string }>).detail;
    if (detail?.projectId) {
      listener(detail.projectId);
    }
  };

  window.addEventListener(BUILD_STATS_PRICING_UPDATED, handler);
  return () => window.removeEventListener(BUILD_STATS_PRICING_UPDATED, handler);
};
