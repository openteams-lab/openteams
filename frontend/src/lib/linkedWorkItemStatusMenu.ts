export type LinkedWorkItemStatusMenuTarget = {
  sessionId: string;
  itemId: string;
} | null;

export const isLinkedWorkItemStatusMenuTarget = (
  target: LinkedWorkItemStatusMenuTarget,
  sessionId: string,
  itemId: string,
) => target?.sessionId === sessionId && target.itemId === itemId;

export const toggleLinkedWorkItemStatusMenuTarget = (
  current: LinkedWorkItemStatusMenuTarget,
  sessionId: string,
  itemId: string,
): LinkedWorkItemStatusMenuTarget =>
  isLinkedWorkItemStatusMenuTarget(current, sessionId, itemId)
    ? null
    : { sessionId, itemId };
