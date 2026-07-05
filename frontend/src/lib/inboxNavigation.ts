import type { InboxItem } from '../../../shared/types';

export const INBOX_WORKFLOW_FOCUS_EVENT = 'openteams:inbox-workflow-focus';

export interface InboxWorkflowFocusTarget {
  sessionId: string;
  kind: InboxItem['kind'];
  sourceType: InboxItem['source_type'];
  sourceId: InboxItem['source_id'];
}

let pendingWorkflowFocusTarget: InboxWorkflowFocusTarget | null = null;

const sameWorkflowFocusTarget = (
  left: InboxWorkflowFocusTarget | null,
  right: InboxWorkflowFocusTarget,
): boolean =>
  left?.sessionId === right.sessionId &&
  left.kind === right.kind &&
  left.sourceType === right.sourceType &&
  left.sourceId === right.sourceId;

export const notifyInboxWorkflowFocus = (
  target: InboxWorkflowFocusTarget,
): void => {
  pendingWorkflowFocusTarget = target;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<InboxWorkflowFocusTarget>(INBOX_WORKFLOW_FOCUS_EVENT, {
      detail: target,
    }),
  );
};

export const consumeInboxWorkflowFocus = (
  sessionId: string,
): InboxWorkflowFocusTarget | null => {
  if (pendingWorkflowFocusTarget?.sessionId !== sessionId) return null;
  const target = pendingWorkflowFocusTarget;
  pendingWorkflowFocusTarget = null;
  return target;
};

export const getPendingInboxWorkflowFocus = (
  sessionId: string,
): InboxWorkflowFocusTarget | null =>
  pendingWorkflowFocusTarget?.sessionId === sessionId
    ? pendingWorkflowFocusTarget
    : null;

export const clearInboxWorkflowFocus = (
  target: InboxWorkflowFocusTarget,
): void => {
  if (sameWorkflowFocusTarget(pendingWorkflowFocusTarget, target)) {
    pendingWorkflowFocusTarget = null;
  }
};
