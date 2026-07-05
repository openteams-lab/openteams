// Smoke tests for the Bell inbox notification popover.
//
// Run with:
//     pnpm exec tsx src/components/InboxNotificationsPopover.test.tsx

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { InboxNotificationsPopover } from "./InboxNotificationsPopover";
import { InboxItemSeverity, type InboxItem } from "../../../shared/types";
import type { Session } from "@/types";

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

console.log("InboxNotificationsPopover");

const source = readFileSync(
  new URL("./InboxNotificationsPopover.tsx", import.meta.url),
  "utf8",
);

const unreadItem: InboxItem = {
  id: "inbox-unread",
  project_id: "project-1",
  session_id: "session-1",
  kind: "workflow_review",
  severity: InboxItemSeverity.warning,
  title: "Review required",
  body: "The workflow is waiting for review.",
  source_type: "workflow_review",
  source_id: "review-1",
  dedupe_key: "workflow_review:review-1",
  read_at: null,
  archived_at: null,
  created_at: new Date("2026-07-05T00:00:00Z"),
  updated_at: new Date("2026-07-05T00:00:00Z"),
};
const session: Session = {
  id: "session-1",
  title: "Active workflow",
  icon: "AW",
  active: true,
};

const html = renderToStaticMarkup(
  <InboxNotificationsPopover
    triggerClassName="sidebar-button"
    portalTarget={null}
    sessions={[session]}
    summary={{
      unread_count: 105n,
      unread_by_kind: [],
      unread_by_severity: [],
    }}
    items={[
      unreadItem,
      { ...unreadItem, id: "inbox-read", read_at: new Date() },
      { ...unreadItem, id: "inbox-archived", archived_at: new Date() },
    ]}
    translate={(_key, fallback) => fallback}
  />,
);

check(
  "renders Bell trigger with capped unread badge",
  html.includes("Open notifications") && html.includes("99+"),
  html,
);

check(
  "unread list filters out read and archived items before sorting",
  source.includes(".filter((item) => item.read_at === null && item.archived_at === null)") &&
    source.includes("inboxItemTimeMs(right.created_at) - inboxItemTimeMs(left.created_at)"),
  source,
);

check(
  "unread list shows severity session title short body and relative time",
  source.includes("inboxSeverityTextClass") &&
    source.includes("sessionTitleById.get(item.session_id)") &&
    source.includes("formatInboxRelativeTime(item.created_at)") &&
    source.includes("{item.title}") &&
    source.includes("{item.body}"),
  source,
);

check(
  "supports open mark-read mark-all-read and archive actions",
  source.includes("openItem(item)") &&
    source.includes("onMarkItemRead") &&
    source.includes("onMarkAllRead") &&
    source.includes("onArchiveItem") &&
    source.includes('"sidebar.inbox.markAllRead"') &&
    source.includes('"sidebar.inbox.markRead"') &&
    source.includes('"Mark all"') &&
    source.includes('"Mark as read"'),
  source,
);

check(
  "labels workflow and worktree actions by handling target",
  source.includes('return "Review";') &&
    source.includes('return "Respond";') &&
    source.includes('return "Approve";') &&
    source.includes('return "Resolve";') &&
    source.includes('return "Retry";'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} InboxNotificationsPopover assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll InboxNotificationsPopover assertions passed.");
}
