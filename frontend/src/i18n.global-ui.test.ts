// Locale synchronization checks for shared global UI chrome.
//
// Run with:
//     pnpm exec tsx src/i18n.global-ui.test.ts

import { readSplitLocaleForTest, testLocales } from "./i18n.test-utils";

const locales = testLocales;
const requiredKeys = [
  "globalSearch.clear",
  "globalSearch.dialogLabel",
  "globalSearch.empty",
  "globalSearch.errorFallback",
  "globalSearch.issueFallback",
  "globalSearch.loading",
  "globalSearch.messageSnippet",
  "globalSearch.meta.issue",
  "globalSearch.meta.message",
  "globalSearch.meta.session",
  "globalSearch.meta.worktree",
  "globalSearch.meta.worktreeWithStatus",
  "globalSearch.placeholder",
  "globalSearch.results",
  "globalSearch.retry",
  "globalSearch.sessionFallback",
  "globalSearch.worktreeFilter",
  "globalSearch.worktreeSnippet",
  "globalSearch.worktreeStatus.active",
  "globalSearch.worktreeStatus.archived",
  "globalSearch.worktreeStatus.cleanup_failed",
  "globalSearch.worktreeStatus.cleanup_pending",
  "globalSearch.worktreeStatus.creating",
  "globalSearch.worktreeStatus.dirty",
  "globalSearch.worktreeStatus.merged",
  "globalSearch.worktreeStatus.merging",
  "globalSearch.worktreeStatus.needs_conflict_resolution",
  "sidebar.aria.openNotifications",
  "sidebar.inbox.empty",
  "sidebar.inbox.loading",
  "sidebar.inbox.markAllRead",
  "sidebar.inbox.markRead",
  "sidebar.inbox.refreshFailed",
  "sidebar.inbox.retry",
  "sidebar.inbox.session",
  "sidebar.inbox.severity.error",
  "sidebar.inbox.severity.info",
  "sidebar.inbox.severity.warning",
  "sidebar.inbox.time.days",
  "sidebar.inbox.time.hours",
  "sidebar.inbox.time.minutes",
  "sidebar.inbox.time.now",
  "sidebar.inbox.title",
  "toast.dismissNotification",
] as const;

type Locale = (typeof locales)[number];
type LocaleDict = Record<string, string>;

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (condition) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
    return;
  }

  failures += 1;
  // eslint-disable-next-line no-console
  console.error(`  FAIL ${label}`, detail ?? "");
};

const placeholders = (value: string) =>
  Array.from(value.matchAll(/\{([a-zA-Z0-9_]+)\}/g))
    .map((match) => match[1])
    .sort();

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

// eslint-disable-next-line no-console
console.log("Global UI locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readSplitLocaleForTest(locale)]),
) as Record<Locale, LocaleDict>;

for (const locale of locales) {
  const missing = requiredKeys.filter((key) => !dictionaries[locale][key]);
  check(`${locale} defines global search and inbox chrome keys`, missing.length === 0, {
    missing,
  });

  const placeholderMismatches = requiredKeys
    .filter((key) => dictionaries[locale][key] !== undefined)
    .filter(
      (key) =>
        !same(
          placeholders(dictionaries[locale][key]),
          placeholders(dictionaries.en[key]),
        ),
    )
    .map((key) => ({
      key,
      expected: placeholders(dictionaries.en[key]),
      actual: placeholders(dictionaries[locale][key]),
      value: dictionaries[locale][key],
    }));

  check(
    `${locale} keeps global UI placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
