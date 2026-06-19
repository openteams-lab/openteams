export type SourceControlRefreshRequestedDetail = {
  projectId?: string | null;
  sessionId: string;
};

export const SOURCE_CONTROL_REFRESH_REQUESTED_EVENT =
  'openteams:source-control-refresh-requested';

export function notifySourceControlRefreshRequested(
  detail: SourceControlRefreshRequestedDetail,
): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<SourceControlRefreshRequestedDetail>(
      SOURCE_CONTROL_REFRESH_REQUESTED_EVENT,
      { detail },
    ),
  );
}
