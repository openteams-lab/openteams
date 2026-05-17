import { chatApi } from '@/lib/api';
import {
  FORBIDDEN_METADATA_KEYS,
  buildWorkflowEventPayload,
  buildReviewDecisionRecordedOptions,
  fileSizeBucket,
  messageLengthBucket,
  type WorkflowEventContext,
  type WorkflowEventName,
  type WorkflowReviewDecisionResolution,
} from '@/lib/workflowEventCore';

const dedupCache = new Map<string, number>();
const DEDUP_INTERVAL_MS = 5000;
const DEDUP_EVENT_NAMES: ReadonlySet<WorkflowEventName> = new Set([
  'engagement.workflow_card_opened',
  'engagement.transcript_opened',
  'engagement.diff_viewed',
]);

function getDedupKey(
  eventName: WorkflowEventName,
  context: WorkflowEventContext,
  status?: string | null,
  actionKey?: string | null
): string {
  return `${eventName}:${context.session_id ?? ''}:${context.workflow_id ?? ''}:${context.plan_id ?? ''}:${context.task_id ?? ''}:${status ?? ''}:${actionKey ?? ''}`;
}

type WorkflowEventOptions = {
  status?: string | null;
  duration_ms?: number | null;
  error_code?: string | null;
  metadata?: Record<string, unknown>;
};

export function recordWorkflowEvent(
  eventName: WorkflowEventName,
  context: WorkflowEventContext,
  options?: WorkflowEventOptions
): void {
  if (DEDUP_EVENT_NAMES.has(eventName)) {
    const actionKey =
      typeof options?.metadata?.action_key === 'string'
        ? options.metadata.action_key
        : null;
    const dedupKey = getDedupKey(
      eventName,
      context,
      options?.status,
      actionKey
    );
    const now = Date.now();
    const lastSent = dedupCache.get(dedupKey);
    if (lastSent !== undefined && now - lastSent < DEDUP_INTERVAL_MS) {
      return;
    }
    dedupCache.set(dedupKey, now);
  }

  try {
    const payload = buildWorkflowEventPayload(eventName, context, options);
    void chatApi.trackWorkflowEvent(payload).catch(() => undefined);
  } catch {
    // intentionally swallowed - analytics must not block UI
  }
}

export function resetWorkflowEventDedupCache(): void {
  dedupCache.clear();
}

export {
  FORBIDDEN_METADATA_KEYS,
  buildReviewDecisionRecordedOptions,
  fileSizeBucket,
  messageLengthBucket,
  type WorkflowEventContext,
  type WorkflowEventName,
  type WorkflowReviewDecisionResolution,
};
