export type LinkedWorkItemsChangedDetail = {
  projectId: string;
  sessionId: string;
  workItemId?: string;
};

export const LINKED_WORK_ITEMS_CHANGED_EVENT =
  "openteams:linked-work-items-changed";

export function notifyLinkedWorkItemsChanged(
  detail: LinkedWorkItemsChangedDetail,
): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<LinkedWorkItemsChangedDetail>(
      LINKED_WORK_ITEMS_CHANGED_EVENT,
      { detail },
    ),
  );
}
