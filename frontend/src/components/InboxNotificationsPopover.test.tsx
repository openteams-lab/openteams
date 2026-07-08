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
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const badgeStart = source.indexOf("{unreadCount > 0 && (");
const badgeEnd = source.indexOf("{inboxBadgeLabel(unreadCount)}", badgeStart);
const badgeSource =
  badgeStart >= 0 && badgeEnd > badgeStart
    ? source.slice(badgeStart, badgeEnd)
    : "";

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
  "renders unread badge as light-gray text over the Bell top-right",
  source.includes("relative inline-flex h-3.5 w-3.5") &&
    badgeSource.includes("-right-1 -top-1.5") &&
    badgeSource.includes("text-[#f3f4f6]") &&
    !badgeSource.includes("rounded-full") &&
    !badgeSource.includes("bg-red-500") &&
    !badgeSource.includes("text-white"),
  badgeSource,
);

check(
  "highlights Bell trigger bright white and decorates it with a tiny red unread dot",
  source.includes("text-[#f8fafc] drop-shadow-[0_0_6px_rgba(248,250,252,0.55)]") &&
    source.includes("-bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500") &&
    source.includes('aria-hidden="true"'),
  source,
);

check(
  "swings the Bell icon while unread notifications are present",
  source.includes("[clip-path:inset(0_0_45%_0)]") &&
    source.includes("inbox-bell-lower-swing") &&
    source.includes("[clip-path:inset(45%_0_0_0)]") &&
    styles.includes("@keyframes inbox-bell-lower-swing") &&
    styles.includes("transform: translateX(-1.5px)") &&
    styles.includes("will-change: transform") &&
    styles.includes("@media (prefers-reduced-motion: reduce)"),
  { source, styles },
);

check(
  "unread list filters out read and archived items before sorting",
  source.includes(".filter((item) => item.read_at === null && item.archived_at === null)") &&
    source.includes("inboxItemTimeMs(right.created_at) - inboxItemTimeMs(left.created_at)"),
  source,
);

check(
  "unread list shows severity session title short body and relative time",
  source.includes("inboxSeverityPillClass") &&
    source.includes("sessionTitleById.get(item.session_id)") &&
    source.includes("formatInboxRelativeTime(item.created_at)") &&
    source.includes("{item.title}") &&
    source.includes("{item.body}"),
  source,
);

check(
  "uses Linear-style popover depth header hierarchy and unread dot",
  source.includes("border border-white/[0.08]") &&
    source.includes("shadow-[0_18px_60px_rgba(0,0,0,0.48),0_4px_14px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.08)]") &&
    source.includes("via-white/[0.18]") &&
    source.includes("text-[13px] font-medium text-[var(--ink-subtle)]") &&
    source.includes("border-b border-white/[0.06]") &&
    source.includes("hover:bg-white/[0.06]") &&
    source.includes("rounded-[4px] border px-1.5 py-0.5 text-[10px]") &&
    source.includes("h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]") &&
    source.includes("leading-[1.5]"),
  source,
);

check(
  "supports open mark-read and mark-all-read actions",
  source.includes("openItem(item)") &&
    source.includes("onMarkItemRead") &&
    source.includes("onMarkAllRead") &&
    source.includes('"sidebar.inbox.markAllRead"') &&
    source.includes('"sidebar.inbox.markRead"') &&
    source.includes('"Mark all"'),
  source,
);

check(
  "keeps inbox rows compact with only a hover mark-read icon",
  source.includes("px-2.5 py-1.5 pr-8 text-left") &&
    source.includes("line-clamp-1") &&
    source.includes("right-2 top-1.5") &&
    !source.includes("-translate-y-1/2") &&
    source.includes("group-hover:opacity-100") &&
    source.includes("<Check") &&
    !source.includes("inboxActionLabel(item)") &&
    !source.includes("<Archive"),
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
