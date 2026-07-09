// Interaction tests for the global search command dialog.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/GlobalSearchDialog.test.tsx
// Exits non-zero if any assertion fails.

import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
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

type SearchRequest = (params: ChatSearchQuery) => Promise<ChatSearchResponse>;
type Translate = (
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => string;

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
const { GlobalSearchDialog } = await import("./GlobalSearchDialog");
const { globalSearchResultSessionId } = await import(
  "@/lib/globalSearchNavigation"
);

console.log("GlobalSearchDialog interactions");

const sessionResult: ChatSearchResult = {
  type: "session",
  session_id: "sess-1",
  title: "Fix login flicker",
  snippet: null,
  updated_at: "2026-07-04T00:00:00Z",
};
const messageResult: ChatSearchResult = {
  type: "message",
  message_id: "msg-1",
  session_id: "sess-2",
  session_title: "Stripe checkout",
  snippet: "checkout copy",
  sender_type: ChatSenderType.user,
  sender_id: null,
  sender_label: "User",
  message_time: "2026-07-04T00:00:00Z",
};
const issueResult: ChatSearchResult = {
  type: "issue",
  issue_id: "issue-1",
  project_id: "project-main",
  title: "Fix issue drawer",
  snippet: "drawer overflows",
  status: ProjectWorkItemStatus.open,
  priority: ProjectWorkItemPriority.high,
  updated_at: "2026-07-04T00:00:00Z",
};
const worktreeResult: ChatSearchResult = {
  type: "worktree",
  session_id: "sess-3",
  session_title: "Worktree QA",
  worktree_id: "wt-1",
  status: SessionWorktreeStatus.active,
  branch_name: "session/wt-1",
  path_summary: "sessions/wt-1",
  updated_at: "2026-07-04T00:00:00Z",
};
const worktreeMessageResult: ChatSearchResult = {
  type: "message",
  message_id: "msg-worktree-1",
  session_id: "sess-3",
  session_title: "Worktree QA",
  snippet: "worktree scoped message",
  sender_type: ChatSenderType.agent,
  sender_id: null,
  sender_label: "Agent",
  message_time: "2026-07-04T00:01:00Z",
};

let activeRoot: Root | null = null;

const wait = async (ms = 0): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

const renderDialog = async ({
  search,
  onClose = () => undefined,
  onOpenResult = () => undefined,
  translate,
}: {
  search: SearchRequest;
  onClose?: () => void;
  onOpenResult?: (result: ChatSearchResult) => void;
  translate?: Translate;
}): Promise<void> => {
  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount();
    });
  }
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    activeRoot?.render(
      <GlobalSearchDialog
        open={true}
        projectId="project-main"
        onClose={onClose}
        onOpenResult={onOpenResult}
        search={search}
        translate={translate}
      />,
    );
  });
  await wait(10);
};

const getInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="search"]');
  if (!input) {
    throw new Error("search input not found");
  }
  return input as HTMLInputElement;
};

const getFilterButton = (): HTMLButtonElement => {
  const button = document.querySelector("[data-search-worktree-filter]");
  if (!button) {
    throw new Error("worktree filter button not found");
  }
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

const main = async () => {
  const searchCalls: ChatSearchQuery[] = [];
  const search: SearchRequest = async (params) => {
    searchCalls.push(params);
    if (params.mode === ChatSearchMode.worktree) {
      return {
        results: params.q?.trim() ? [worktreeMessageResult] : [worktreeResult],
      };
    }
    return { results: [sessionResult, messageResult, worktreeResult] };
  };
  let closeCount = 0;
  const openedResults: ChatSearchResult[] = [];

  await renderDialog({
    search,
    onClose: () => {
      closeCount += 1;
    },
    onOpenResult: (result) => {
      openedResults.push(result);
    },
  });
  await wait(20);

  check("打开后真实聚焦输入框", document.activeElement === getInput());
  check(
    "uses default global search copy when no translator is provided",
    getInput().placeholder === "Search sessions, issues, and messages" &&
      getFilterButton().getAttribute("aria-label") ===
        "Filter isolated worktree",
  );
  check(
    "空查询不请求接口也不显示结果项",
    searchCalls.length === 0 &&
      getOptions().length === 0 &&
      getResultsPanel() === null &&
      getClearButton() === null,
    searchCalls,
  );
  check(
    "空查询没有默认选中项",
    getOptions().length === 0,
  );

  check(
    "worktree filter uses a workspace-oriented icon",
    getFilterButton().innerHTML.includes("lucide-folder-git-2") === true &&
      getFilterButton().innerHTML.includes("lucide-git-branch") === false,
  );

  const callsBeforeDebounce = searchCalls.length;
  await setInputValue("ab");
  await wait(80);
  check("输入 1-2 字符不会绕过 debounce", searchCalls.length === callsBeforeDebounce);
  await wait(160);
  check(
    "debounce 后真实请求后端搜索",
    searchCalls.at(-1)?.q === "ab" &&
      searchCalls.at(-1)?.mode === ChatSearchMode.all,
    searchCalls,
  );
  check(
    "results panel uses the expanded height cap after a query",
    getResultsPanel()?.className.includes(
      "max-h-[min(520px,calc(100vh-128px))]",
    ) === true &&
      getClearButton()?.className.includes("global-search-clear-button") ===
        true &&
      getClearButton()?.className.includes("hover:bg") === false &&
      getClearButton()?.innerHTML.includes("lucide-x") === true,
  );

  await pressKey("ArrowDown");
  check(
    "ArrowDown 真实移动选中项",
    getOptions()[1]?.getAttribute("aria-selected") === "true",
  );
  await pressKey("ArrowUp");
  check(
    "ArrowUp 真实循环回上一项",
    getOptions()[0]?.getAttribute("aria-selected") === "true",
  );
  await pressKey("ArrowUp");
  check(
    "ArrowUp 在首项真实循环到末项",
    getOptions()[2]?.getAttribute("aria-selected") === "true",
  );

  getOptions()[1]?.dispatchEvent(
    new dom.window.MouseEvent("mouseover", { bubbles: true }),
  );
  check(
    "鼠标 hover 不抢占键盘选中项",
    getOptions()[2]?.getAttribute("aria-selected") === "true",
  );

  await pressKey("Enter");
  check(
    "Enter 真实打开当前选中项并关闭弹窗",
    openedResults[0] === worktreeResult && closeCount === 1,
    openedResults,
  );

  closeCount = 0;
  openedResults.length = 0;
  await renderDialog({
    search,
    onClose: () => {
      closeCount += 1;
    },
    onOpenResult: (result) => {
      openedResults.push(result);
    },
  });
  await wait(20);
  await setInputValue("ab");
  await wait(220);
  await click(getOptions()[1]);
  check(
    "鼠标点击真实直接打开目标结果",
    openedResults[0] === messageResult && closeCount === 1,
    openedResults,
  );

  closeCount = 0;
  await renderDialog({
    search,
    onClose: () => {
      closeCount += 1;
    },
  });
  await wait(20);
  await pressKey("Escape");
  check("Esc 真实关闭弹窗", closeCount === 1);

  searchCalls.length = 0;
  await renderDialog({ search });
  await wait(20);
  await click(getFilterButton());
  await wait(40);
  check(
    "clicking the worktree icon lists current isolated workspace sessions",
    getFilterButton().getAttribute("aria-pressed") === "true" &&
      searchCalls.at(-1)?.mode === ChatSearchMode.worktree &&
      searchCalls.at(-1)?.q === "" &&
      getResultsPanel() !== null &&
      document.body.textContent?.includes("Worktree QA") === true,
    searchCalls,
  );
  await setInputValue("qa");
  await wait(220);
  check(
    "worktree 筛选真实切换模式并请求 worktree 结果",
    getFilterButton().getAttribute("aria-pressed") === "true" &&
      searchCalls.at(-1)?.mode === ChatSearchMode.worktree &&
      document.body.textContent?.includes("Worktree QA") === true,
    searchCalls,
  );

  check(
    "typing in worktree mode searches messages within isolated workspace sessions",
    searchCalls.at(-1)?.q === "qa" &&
      document.body.textContent?.includes("worktree scoped message") === true,
    searchCalls,
  );

  await renderDialog({ search: async () => ({ results: [] }) });
  await wait(20);
  await setInputValue("zz");
  await wait(220);
  check(
    "空结果真实显示空状态",
    document.body.textContent?.includes("No matching results") === true,
  );

  const clearButton = getClearButton();
  if (!clearButton) {
    check("clear button renders for a non-empty query", false);
  } else {
    await click(clearButton);
    await wait(20);
    check(
      "clear button empties the query and collapses the results panel",
      getInput().value === "" &&
        getOptions().length === 0 &&
        getResultsPanel() === null,
    );
  }

  const retryCalls: ChatSearchQuery[] = [];
  let shouldFail = true;
  const retrySearch: SearchRequest = async (params) => {
    retryCalls.push(params);
    if (params.q === "xy" && shouldFail) {
      shouldFail = false;
      throw new Error("boom");
    }
    return { results: [] };
  };
  await renderDialog({ search: retrySearch });
  await wait(20);
  await setInputValue("xy");
  await wait(220);
  check(
    "失败状态保留输入内容并显示重试行",
    getInput().value === "xy" &&
      document.body.textContent?.includes("Search failed, click to retry") ===
        true,
  );
  const retryButton = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Search failed, click to retry"),
  );
  if (!retryButton) {
    check("错误状态提供可点击重试行", false);
  } else {
    await click(retryButton);
    await wait(220);
    check(
      "点击重试行真实复用当前输入重新请求",
      retryCalls.at(-1)?.q === "xy" &&
        document.body.textContent?.includes("No matching results") === true,
      retryCalls,
    );
  }

  await renderDialog({
    search,
    translate: (key, fallback, replacements) => {
      const translated: Record<string, string> = {
        "globalSearch.clear": "CLEAR_TRANSLATED",
        "globalSearch.dialogLabel": "SEARCH_DIALOG_TRANSLATED",
        "globalSearch.placeholder": "PLACEHOLDER_TRANSLATED",
        "globalSearch.worktreeFilter": "WORKTREE_FILTER_TRANSLATED",
      };
      let value = translated[key] ?? fallback;
      if (replacements) {
        for (const [name, replacement] of Object.entries(replacements)) {
          value = value.replace(`{${name}}`, String(replacement));
        }
      }
      return value;
    },
  });
  await wait(20);
  check(
    "global search control labels come from the active translator",
    getInput().placeholder === "PLACEHOLDER_TRANSLATED" &&
      document
        .querySelector('[role="dialog"]')
        ?.getAttribute("aria-label") === "SEARCH_DIALOG_TRANSLATED" &&
      getFilterButton().getAttribute("aria-label") ===
        "WORKTREE_FILTER_TRANSLATED",
  );

  check(
    "session/message/worktree 结果映射到会话，issue 不误映射",
    globalSearchResultSessionId(sessionResult) === "sess-1" &&
      globalSearchResultSessionId(messageResult) === "sess-2" &&
      globalSearchResultSessionId(worktreeResult) === "sess-3" &&
      globalSearchResultSessionId(issueResult) === null,
  );
};

await main();

if (activeRoot) {
  await act(async () => {
    activeRoot?.unmount();
  });
}

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} GlobalSearchDialog assertion(s) failed.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log("\nAll GlobalSearchDialog interaction assertions passed.");
