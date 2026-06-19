export type IssueNavigationTarget = {
  projectId?: string;
  workItemId: string;
};

export const ISSUE_NAVIGATION_EVENT = "openteams:navigate-issue";
export const ISSUE_NAVIGATION_TARGET_CHANGED_EVENT =
  "openteams:issue-target-updated";

const ISSUE_NAVIGATION_STORAGE_KEY = "openteams:issue-navigation-target";

function isIssueNavigationTarget(
  value: unknown,
): value is IssueNavigationTarget {
  if (!value || typeof value !== "object") return false;

  const target = value as Partial<IssueNavigationTarget>;
  return typeof target.workItemId === "string" && target.workItemId.length > 0;
}

export function readIssueNavigationTarget(): IssueNavigationTarget | null {
  if (typeof window === "undefined") return null;

  try {
    const rawTarget = window.sessionStorage.getItem(
      ISSUE_NAVIGATION_STORAGE_KEY,
    );
    if (!rawTarget) return null;

    const parsedTarget = JSON.parse(rawTarget);
    return isIssueNavigationTarget(parsedTarget) ? parsedTarget : null;
  } catch {
    return null;
  }
}

export function storeIssueNavigationTarget(
  target: IssueNavigationTarget,
): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      ISSUE_NAVIGATION_STORAGE_KEY,
      JSON.stringify(target),
    );
  } catch {
    // Ignore storage failures; the live navigation event still opens the page.
  }
}

export function clearIssueNavigationTarget(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(ISSUE_NAVIGATION_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}
