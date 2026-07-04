// Integration coverage for the sidebar search entry, command dialog, API
// adapter, result priority, navigation, worktree mode, and compact viewport
// constraints.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/GlobalSearchIntegration.test.tsx
// Exits non-zero if any assertion fails.

import React, { useState } from "react";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import { GlobalSearchDialog } from "./GlobalSearchDialog";
import { ProjectSidebar } from "./ProjectSidebar";
import { mockShellOptions, mockWorkspaceBootstrap } from "@/mockApiData";
import {
  ChatSearchMode,
  ChatSenderType,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
  SessionWorktreeStatus,
  type ChatSearchQuery,
  type ChatSearchResponse,
  type ChatSearchResult,
} from "../../../shared/types";
import {
  resolveGlobalSearchNavigationAction,
  type GlobalSearchNavigationAction,
} from "@/lib/globalSearchNavigation";

type FixtureSession = {
  id: string;
  projectId: string | null;
  title: string;
  updatedAt: string;
};

type FixtureIssue = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  updatedAt: string;
};

type FixtureMessage = {
  id: string;
  sessionId: string;
  senderType: ChatSenderType;
  content: string;
  createdAt: string;
};

type FixtureWorktree = {
  id: string;
  sessionId: string;
  status: SessionWorktreeStatus;
  branchName: string;
  worktreePath: string;
  updatedAt: string;
};

type FetchCall = {
  pathname: string;
  projectId: string | null;
  q: string | null;
  mode: string | null;
};

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? "");
  }
};

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
Object.defineProperty(dom.window, "innerWidth", {
  value: 360,
  configurable: true,
});
Object.defineProperty(dom.window, "innerHeight", {
  value: 640,
  configurable: true,
});
dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
  dom.window.setTimeout(() => callback(Date.now()), 0);
dom.window.cancelAnimationFrame = (handle: number): void => {
  dom.window.clearTimeout(handle);
};
const htmlElementPrototype = dom.window.HTMLElement.prototype as HTMLElement & {
  attachEvent?: () => void;
  detachEvent?: () => void;
};
htmlElementPrototype.attachEvent = () => undefined;
htmlElementPrototype.detachEvent = () => undefined;

Object.defineProperty(globalThis, "window", {
  value: dom.window,
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
Object.defineProperty(globalThis, "HTMLElement", {
  value: dom.window.HTMLElement,
  configurable: true,
});
Object.defineProperty(globalThis, "HTMLButtonElement", {
  value: dom.window.HTMLButtonElement,
  configurable: true,
});
Object.defineProperty(globalThis, "Event", {
  value: dom.window.Event,
  configurable: true,
});
Object.defineProperty(globalThis, "KeyboardEvent", {
  value: dom.window.KeyboardEvent,
  configurable: true,
});
Object.defineProperty(globalThis, "MouseEvent", {
  value: dom.window.MouseEvent,
  configurable: true,
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

console.log("Global search sidebar-to-dialog integration");

const projectMain = "project-main";
const projectOther = "project-other";
const searchLabel = "\u641c\u7d22";
const sessions: FixtureSession[] = [
  {
    id: "session-title-main",
    projectId: projectMain,
    title: "Alpha planning session",
    updatedAt: "2026-07-04T00:10:00Z",
  },
  {
    id: "session-title-other",
    projectId: projectOther,
    title: "Alpha planning session from another project",
    updatedAt: "2026-07-04T00:20:00Z",
  },
  {
    id: "session-issue-main",
    projectId: projectMain,
    title: "Issue triage room",
    updatedAt: "2026-07-04T00:09:00Z",
  },
  {
    id: "session-message-new",
    projectId: projectMain,
    title: "Newer message session",
    updatedAt: "2026-07-04T00:08:00Z",
  },
  {
    id: "session-message-old",
    projectId: projectMain,
    title: "Older message session",
    updatedAt: "2026-07-04T00:07:00Z",
  },
  {
    id: "session-worktree-main",
    projectId: projectMain,
    title: "Worktree QA session",
    updatedAt: "2026-07-04T00:06:00Z",
  },
  {
    id: "session-worktree-other",
    projectId: projectOther,
    title: "Other project worktree",
    updatedAt: "2026-07-04T00:05:00Z",
  },
];

const issues: FixtureIssue[] = [
  {
    id: "issue-delta-description",
    projectId: projectMain,
    title: "Backlog item",
    description: "Delta appears only in the description.",
    updatedAt: "2026-07-04T00:14:00Z",
  },
  {
    id: "issue-delta-title",
    projectId: projectMain,
    title: "Delta title issue",
    description: null,
    updatedAt: "2026-07-04T00:13:00Z",
  },
  {
    id: "issue-alpha",
    projectId: projectMain,
    title: "Alpha issue should lose to session title priority",
    description: null,
    updatedAt: "2026-07-04T00:15:00Z",
  },
  {
    id: "issue-delta-other",
    projectId: projectOther,
    title: "Delta title issue from another project",
    description: null,
    updatedAt: "2026-07-04T00:16:00Z",
  },
];

const messages: FixtureMessage[] = [
  {
    id: "message-alpha",
    sessionId: "session-title-main",
    senderType: ChatSenderType.user,
    content: "Alpha message should lose to session title priority.",
    createdAt: "2026-07-04T00:17:00Z",
  },
  {
    id: "message-needle-new",
    sessionId: "session-message-new",
    senderType: ChatSenderType.agent,
    content: "Needle fallback content from the newer message.",
    createdAt: "2026-07-04T00:18:00Z",
  },
  {
    id: "message-needle-old",
    sessionId: "session-message-old",
    senderType: ChatSenderType.user,
    content: "Needle fallback content from the older message.",
    createdAt: "2026-07-04T00:12:00Z",
  },
  {
    id: "message-needle-other",
    sessionId: "session-title-other",
    senderType: ChatSenderType.user,
    content: "Needle fallback content from another project.",
    createdAt: "2026-07-04T00:19:00Z",
  },
];

const worktrees: FixtureWorktree[] = [
  {
    id: "worktree-main",
    sessionId: "session-worktree-main",
    status: SessionWorktreeStatus.active,
    branchName: "session/worktree-filter",
    worktreePath: "C:/tmp/openteams/session-worktree-main",
    updatedAt: "2026-07-04T00:21:00Z",
  },
  {
    id: "worktree-other",
    sessionId: "session-worktree-other",
    status: SessionWorktreeStatus.active,
    branchName: "session/worktree-filter-other",
    worktreePath: "C:/tmp/openteams/session-worktree-other",
    updatedAt: "2026-07-04T00:22:00Z",
  },
];

const sessionById = new Map(sessions.map((session) => [session.id, session]));
const fetchCalls: FetchCall[] = [];
const openedActions: GlobalSearchNavigationAction[] = [];
let activeRoot: Root | null = null;

const includesQuery = (value: string | null | undefined, q: string): boolean =>
  (value ?? "").toLowerCase().includes(q);

const newestFirst = <T extends { updatedAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const scopedSession = (
  session: FixtureSession,
  projectId: string | null,
): boolean => session.projectId === projectId;

const pathSummary = (path: string): string =>
  path.replaceAll("\\", "/").split("/").filter(Boolean).slice(-2).join("/");

const toSessionResult = (session: FixtureSession, q: string): ChatSearchResult => ({
  type: "session",
  session_id: session.id,
  title: session.title,
  snippet: q ? session.title : null,
  updated_at: session.updatedAt,
});

const toIssueResult = (issue: FixtureIssue, q: string): ChatSearchResult => ({
  type: "issue",
  issue_id: issue.id,
  project_id: issue.projectId,
  title: issue.title,
  snippet: includesQuery(issue.description, q)
    ? issue.description
    : issue.title,
  status: ProjectWorkItemStatus.open,
  priority: ProjectWorkItemPriority.high,
  updated_at: issue.updatedAt,
});

const toMessageResult = (
  message: FixtureMessage,
  session: FixtureSession,
): ChatSearchResult => ({
  type: "message",
  message_id: message.id,
  session_id: session.id,
  session_title: session.title,
  snippet: message.content,
  sender_type: message.senderType,
  sender_id: null,
  sender_label: message.senderType === ChatSenderType.agent ? "Agent" : "User",
  message_time: message.createdAt,
});

const toWorktreeResult = (
  worktree: FixtureWorktree,
  session: FixtureSession,
): ChatSearchResult => ({
  type: "worktree",
  session_id: session.id,
  session_title: session.title,
  worktree_id: worktree.id,
  status: worktree.status,
  branch_name: worktree.branchName,
  path_summary: pathSummary(worktree.worktreePath),
  updated_at: worktree.updatedAt,
});

const fixtureSearch = (params: ChatSearchQuery): ChatSearchResponse => {
  const projectId = params.project_id ?? null;
  const q = (params.q ?? "").trim().toLowerCase();
  const mode = params.mode ?? ChatSearchMode.all;

  if (mode === ChatSearchMode.worktree) {
    return {
      results: newestFirst(worktrees)
        .filter((worktree) => {
          const session = sessionById.get(worktree.sessionId);
          if (!session || !scopedSession(session, projectId)) return false;
          if (!q) return true;
          return (
            includesQuery(session.title, q) ||
            includesQuery(worktree.branchName, q) ||
            includesQuery(worktree.worktreePath, q) ||
            includesQuery(worktree.status, q)
          );
        })
        .map((worktree) =>
          toWorktreeResult(
            worktree,
            sessionById.get(worktree.sessionId) as FixtureSession,
          ),
        ),
    };
  }

  const scopedSessions = sessions.filter((session) =>
    scopedSession(session, projectId),
  );
  if (!q) {
    return {
      results: newestFirst(scopedSessions).slice(0, 8).map((session) =>
        toSessionResult(session, q),
      ),
    };
  }

  const sessionResults = newestFirst(
    scopedSessions.filter((session) => includesQuery(session.title, q)),
  );
  if (sessionResults.length > 0) {
    return { results: sessionResults.map((session) => toSessionResult(session, q)) };
  }

  const issueResults = newestFirst(
    issues.filter(
      (issue) =>
        issue.projectId === projectId &&
        (includesQuery(issue.title, q) || includesQuery(issue.description, q)),
    ),
  );
  if (issueResults.length > 0) {
    return { results: issueResults.map((issue) => toIssueResult(issue, q)) };
  }

  return {
    results: messages
      .filter((message) => {
        const session = sessionById.get(message.sessionId);
        return (
          !!session &&
          scopedSession(session, projectId) &&
          includesQuery(message.content, q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((message) =>
        toMessageResult(message, sessionById.get(message.sessionId) as FixtureSession),
      ),
  };
};

Object.defineProperty(globalThis, "fetch", {
  value: (async (input) => {
    const requestUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const url = new URL(requestUrl, "http://localhost");
    const modeParam = url.searchParams.get("mode");
    const params: ChatSearchQuery = {
      project_id: url.searchParams.get("project_id"),
      q: url.searchParams.get("q"),
      mode:
        modeParam === ChatSearchMode.worktree
          ? ChatSearchMode.worktree
          : ChatSearchMode.all,
    };
    fetchCalls.push({
      pathname: url.pathname,
      projectId: params.project_id ?? null,
      q: params.q ?? null,
      mode: modeParam,
    });
    const data =
      url.pathname === "/api/chat/search"
        ? fixtureSearch(params)
        : url.pathname === "/api/build-stats/activity"
          ? { days: [] }
          : url.pathname === "/api/build-stats/model-pricing"
            ? { models: [] }
            : null;
    return new Response(
      JSON.stringify({
        success: true,
        data,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) satisfies typeof fetch,
  configurable: true,
});

const wait = async (ms = 0): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

function SearchValidationShell() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <ProjectSidebar
        shellOptions={mockShellOptions}
        projects={[]}
        selectedProjectId={projectMain}
        sessions={mockWorkspaceBootstrap.sessions}
        activeSessionId={mockWorkspaceBootstrap.defaults.activeSessionId}
        activePage="workspace"
        weeklyCost={mockWorkspaceBootstrap.defaults.weeklyCost}
        onNavigate={() => undefined}
        onSessionSelect={() => undefined}
        onPrimaryAction={(action) => {
          if (action.id === "search") setSearchOpen(true);
        }}
        onProjectAction={() => undefined}
      />
      <GlobalSearchDialog
        open={searchOpen}
        projectId={projectMain}
        onClose={() => setSearchOpen(false)}
        onOpenResult={(result) => {
          openedActions.push(resolveGlobalSearchNavigationAction(result));
        }}
      />
    </>
  );
}

const renderShell = async (): Promise<void> => {
  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount();
    });
  }
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    activeRoot?.render(<SearchValidationShell />);
  });
  await wait(10);
};

const getSearchEntryButton = (): HTMLButtonElement => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof dom.window.HTMLButtonElement &&
      candidate.textContent?.includes(searchLabel) === true,
  );
  if (!button) throw new Error("sidebar search button not found");
  return button;
};

const getInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="search"]');
  if (!input) throw new Error("search input not found");
  return input as HTMLInputElement;
};

const getFilterButton = (): HTMLButtonElement => {
  const button = document.querySelector("[data-search-worktree-filter]");
  if (!button) throw new Error("worktree filter button not found");
  return button as HTMLButtonElement;
};

const getOptions = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll('[role="option"]')).filter(
    (node): node is HTMLButtonElement =>
      node instanceof dom.window.HTMLButtonElement,
  );

const getResultsPanel = (): HTMLElement | null =>
  document.querySelector("[data-global-search-results-panel]");

const getClearButton = (): HTMLButtonElement | null =>
  document.querySelector("[data-global-search-clear]");

const getSelectedIndex = (): number =>
  getOptions().findIndex(
    (option) => option.getAttribute("aria-selected") === "true",
  );

const setInputValue = async (value: string): Promise<void> => {
  await act(async () => {
    const input = getInput();
    const descriptor = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};

const pressKey = async (key: string): Promise<void> => {
  await act(async () => {
    getInput().dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  });
};

const click = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
};

const openSearch = async (): Promise<void> => {
  await click(getSearchEntryButton());
  await wait(20);
};

await renderShell();
check(
  "sidebar exposes the Search primary action with the lucide icon",
  getSearchEntryButton().textContent?.includes(searchLabel) === true &&
    document.body.innerHTML.includes("lucide-search"),
);

await openSearch();
check("clicking sidebar Search opens the dialog", !!document.querySelector('[role="dialog"]'));
check("dialog focuses the query input", document.activeElement === getInput());
check(
  "empty query does not call the search API or render result rows",
  !fetchCalls.some((call) => call.pathname === "/api/chat/search") &&
    getOptions().length === 0 &&
    getResultsPanel() === null &&
    getClearButton() === null,
  fetchCalls,
);
const dialogShell = document.querySelector('[role="dialog"]')?.parentElement;
check(
  "narrow viewport keeps the 16px horizontal safety margin",
  dialogShell?.className.includes("px-4") === true &&
    document
      .querySelector('[role="dialog"]')
      ?.className.includes("max-h-[min(640px,calc(100vh-32px))]") === true,
  document.body.innerHTML,
);

const callsBeforeDebounce = fetchCalls.length;
await setInputValue("al");
await wait(80);
check(
  "typing a two-character query waits for debounce before the API call",
  fetchCalls.length === callsBeforeDebounce,
  fetchCalls,
);
await wait(160);
check(
  "debounced query still carries project scope",
  fetchCalls.at(-1)?.projectId === projectMain &&
    fetchCalls.at(-1)?.q === "al",
  fetchCalls,
);
check(
  "session title matches have priority over issue and message matches",
    getOptions().length === 1 &&
    getResultsPanel()?.className.includes("max-h-[min(520px,calc(100vh-128px))]") === true &&
    getClearButton()?.className.includes("global-search-clear-button") === true &&
    getClearButton()?.className.includes("hover:bg") === false &&
    getClearButton()?.innerHTML.includes("lucide-x") === true &&
    getOptions()[0]?.textContent?.includes("Alpha planning session") === true &&
    !document.body.textContent?.includes("Alpha issue should lose") &&
    !document.body.textContent?.includes("another project"),
  document.body.textContent,
);
check("result list selects the first result by default", getSelectedIndex() === 0);

await setInputValue("delta");
await wait(220);
check(
  "issue title and description matches appear when no session title matches",
  getOptions().length === 2 &&
    getOptions()[0]?.textContent?.includes("Backlog item") === true &&
    getOptions()[1]?.textContent?.includes("Delta title issue") === true &&
    !document.body.textContent?.includes("another project"),
  document.body.textContent,
);
await click(getOptions()[0] as HTMLButtonElement);
check(
  "mouse click opens an issue result through centralized navigation",
  JSON.stringify(openedActions.at(-1)) ===
    JSON.stringify({
      kind: "issue",
      target: { projectId: projectMain, workItemId: "issue-delta-description" },
    }),
  openedActions,
);

await openSearch();
await setInputValue("needle");
await wait(220);
check(
  "message fallback appears only after session and issue searches miss",
  getOptions().length === 2 &&
    getOptions()[0]?.textContent?.includes("Newer message session") === true &&
    getOptions()[1]?.textContent?.includes("Older message session") === true &&
    !document.body.textContent?.includes("another project"),
  document.body.textContent,
);
check("message fallback sorts by newest message first", getSelectedIndex() === 0);
await pressKey("ArrowUp");
check("ArrowUp cycles from the first result to the last", getSelectedIndex() === 1);
await pressKey("ArrowDown");
check("ArrowDown cycles selection back to the first result", getSelectedIndex() === 0);
await pressKey("ArrowUp");
await pressKey("Enter");
check(
  "Enter opens the selected message result as its session",
  JSON.stringify(openedActions.at(-1)) ===
    JSON.stringify({ kind: "session", sessionId: "session-message-old" }),
  openedActions,
);

await openSearch();
await click(getFilterButton());
await wait(30);
await setInputValue("worktree-filter");
await wait(220);
check(
  "worktree filter requests worktree mode and shows scoped worktree sessions",
  getFilterButton().getAttribute("aria-pressed") === "true" &&
    fetchCalls.at(-1)?.mode === ChatSearchMode.worktree &&
    getOptions().length === 1 &&
    getOptions()[0]?.textContent?.includes("Worktree QA session") === true &&
    !document.body.textContent?.includes("Other project worktree"),
  { fetchCalls, body: document.body.textContent },
);
await click(getOptions()[0] as HTMLButtonElement);
check(
  "clicking a worktree result opens its owning session",
  JSON.stringify(openedActions.at(-1)) ===
    JSON.stringify({ kind: "session", sessionId: "session-worktree-main" }),
  openedActions,
);

if (activeRoot) {
  await act(async () => {
    activeRoot?.unmount();
  });
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} integration assertion(s) failed.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("\nAll global search integration assertions passed.");
