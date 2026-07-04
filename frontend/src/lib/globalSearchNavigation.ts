import type { ChatSearchResult } from "../../../shared/types";
import type { IssueNavigationTarget } from "./issueNavigation";

export type GlobalSearchNavigationAction =
  | { kind: "session"; sessionId: string }
  | { kind: "issue"; target: IssueNavigationTarget }
  | null;

export const globalSearchResultSessionId = (
  result: ChatSearchResult,
): string | null => {
  if (result.type === "session") return result.session_id;
  if (result.type === "message") return result.session_id;
  if (result.type === "worktree") return result.session_id;
  return null;
};

export const resolveGlobalSearchNavigationAction = (
  result: ChatSearchResult,
): GlobalSearchNavigationAction => {
  if (result.type === "issue") {
    return {
      kind: "issue",
      target: {
        projectId: result.project_id,
        workItemId: result.issue_id,
      },
    };
  }

  const sessionId = globalSearchResultSessionId(result);
  return sessionId ? { kind: "session", sessionId } : null;
};
