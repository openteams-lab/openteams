// Locale synchronization checks for Issue dialogs.
//
// Run with:
//     pnpm exec tsx src/i18n.issue.test.ts

import {
  readSplitLocaleForTest,
  readTextForTest,
  testLocales,
} from "./i18n.test-utils";

const locales = testLocales;
const sourceFiles = [
  "./pages/IssuePage.tsx",
  "./pages/IssueDetailPage.tsx",
  "./components/IssueCreateDialog.tsx",
] as const;
const dynamicKeys = [
  "issue.linkDialog.provider.github.description",
  "issue.linkDialog.provider.github.name",
  "issue.linkDialog.provider.jira.description",
  "issue.linkDialog.provider.jira.name",
  "issue.linkDialog.provider.linear.description",
  "issue.linkDialog.provider.linear.name",
] as const;
const localePrefixes = [
  "issue.createDialog.",
  "issue.detail.",
  "issue.linkDialog.",
  "issue.importDialog.",
] as const;
const requiredPlaceholders: Record<string, readonly string[]> = {
  "issue.detail.action.attachmentsSelected": ["count"],
  "issue.detail.action.moreOptionsOpened": ["id"],
  "issue.detail.action.priorityUpdated": ["priority"],
  "issue.detail.action.statusUpdated": ["status"],
  "issue.detail.action.subIssuesOpened": ["id"],
  "issue.detail.commentFocused": ["id"],
  "issue.detail.collapsePanel": ["title"],
  "issue.detail.expandPanel": ["title"],
  "issue.detail.githubIssueNumber": ["number"],
  "issue.detail.openedBy": ["date", "name"],
  "issue.detail.prompt.currentMatter": ["label"],
  "issue.detail.prompt.description": ["description"],
  "issue.detail.prompt.title": ["title"],
  "issue.detail.removeLabel": ["label"],
  "issue.detail.sourceProvider": ["provider"],
  "issue.detail.unlinkSessionAria": ["title"],
  "issue.linkDialog.auth.deviceCode": ["code"],
  "issue.linkDialog.auth.status": ["status"],
  "issue.linkDialog.auth.switchAccountFrom": ["login"],
  "issue.linkDialog.error.authorizationStatus": ["status"],
  "issue.linkDialog.error.authorizationStatusBare": ["status"],
  "issue.linkDialog.error.deviceFallbackFailed": ["error", "reason"],
  "issue.linkDialog.error.deviceFallbackOnlyFailed": ["error"],
  "issue.linkDialog.error.oauthFallback": ["reason"],
  "issue.linkDialog.header.linkedTo": ["repoName"],
  "issue.linkDialog.notice.authorizedAs": ["login"],
  "issue.linkDialog.notice.linkedRepo": ["repoName"],
  "issue.linkDialog.notice.unlinkedAndAuthOpened": ["repoName"],
  "issue.linkDialog.notice.unlinkedRepo": ["repoName"],
  "issue.linkDialog.providerUnsupportedTitle": ["providerName"],
  "issue.linkDialog.repo.linking": ["repoName"],
  "issue.linkDialog.repo.updated": ["date"],
  "issue.linkDialog.toast.repoLinked.message": ["repoName"],
  "issue.linkDialog.toast.repoUnlinked.message": ["repoName"],
  "issue.importDialog.toast.imported.message": ["number"],
  "issue.createDialog.removeAttachment": ["name"],
};

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

const readText = readTextForTest;

const readLocale = readSplitLocaleForTest;

const issueLocaleKeys = (dict: LocaleDict) =>
  Object.keys(dict)
    .filter((key) => localePrefixes.some((prefix) => key.startsWith(prefix)))
    .sort();

const usedIssueLocaleKeys = () => {
  const keys = new Set<string>(dynamicKeys);

  for (const file of sourceFiles) {
    const text = readText(file);
    for (const match of text.matchAll(
      /tr\(\s*["'](issue\.(?:createDialog|detail|linkDialog|importDialog)\.[^"']+)["']/g,
    )) {
      keys.add(match[1]);
    }
  }

  return Array.from(keys).sort();
};

const issueDetailHardcodedPatterns: Array<[string, RegExp]> = [
  [
    "literal placeholders",
    /placeholder="(?:Add a description|Leave a comment|Change status|Set priority|Add labels|Link session)\.\.\."/,
  ],
  ["literal sync aria labels", /aria-label="Sync (?:description|comments)/],
  ["literal sync titles", /title="Sync (?:description|comments)/],
  ["literal detail panel titles", /<DetailPanel title="/],
  [
    "literal detail page text nodes",
    />\s*(?:Loading description|Add a description|Add sub-issues|Activity|No comments yet|Clear|Attach|Open GitHub issue|Create session|Issues)\s*</,
  ],
  ["literal issue prompt", /`当前事项是\$\{label\}`/],
];

const placeholders = (value: string) =>
  Array.from(value.matchAll(/\{([a-zA-Z0-9_]+)\}/g))
    .map((match) => match[1])
    .sort();

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

// eslint-disable-next-line no-console
console.log("Issue page locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readLocale(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = issueLocaleKeys(dictionaries.en);
const usedKeys = usedIssueLocaleKeys();

check(
  "en defines every Issue detail/dialog key used by the Issue page",
  usedKeys.every((key) => baselineKeys.includes(key)),
  usedKeys.filter((key) => !baselineKeys.includes(key)),
);

check(
  "en keeps required Issue detail/dialog placeholders",
  Object.entries(requiredPlaceholders).every(([key, expected]) =>
    same(placeholders(dictionaries.en[key]), [...expected].sort()),
  ),
  Object.entries(requiredPlaceholders)
    .filter(
      ([key, expected]) =>
        !same(placeholders(dictionaries.en[key]), [...expected].sort()),
    )
    .map(([key, expected]) => ({
      key,
      expected: [...expected].sort(),
      actual: placeholders(dictionaries.en[key]),
      value: dictionaries.en[key],
    })),
);

const issueDetailSource = readText("./pages/IssueDetailPage.tsx");
const hardcodedMatches = issueDetailHardcodedPatterns
  .filter(([, pattern]) => pattern.test(issueDetailSource))
  .map(([label]) => label);

check(
  "Issue detail page removes known untranslated hardcoded strings",
  hardcodedMatches.length === 0,
  hardcodedMatches,
);

const issueCreateSource = readText("./components/IssueCreateDialog.tsx");
const issueCreateHardcodedPatterns: Array<[string, RegExp]> = [
  [
    "literal create dialog aria labels",
    /aria-label="(?:Create issue|Close create issue dialog|Attach files)"/,
  ],
  [
    "literal create dialog placeholders",
    /placeholder="(?:Issue title|Add description|Change status|Change priority|Link session)\.\.\."|placeholder="Issue title"/,
  ],
  [
    "literal create dialog text nodes",
    />\s*(?:New issue|Create issue|Creating\.\.\.|Issue title|Issue description|No sessions found|No results)\s*</,
  ],
  [
    "literal remove attachment aria label",
    /aria-label=\{`Remove \$\{file\.name\}`\}/,
  ],
];
const createHardcodedMatches = issueCreateHardcodedPatterns
  .filter(([, pattern]) => pattern.test(issueCreateSource))
  .map(([label]) => label);

check(
  "Issue create dialog removes known untranslated hardcoded strings",
  createHardcodedMatches.length === 0,
  createHardcodedMatches,
);

for (const locale of locales) {
  const keys = issueLocaleKeys(dictionaries[locale]);
  check(
    `${locale} has the same Issue detail/dialog keys as en`,
    same(keys, baselineKeys),
    {
      missing: baselineKeys.filter((key) => !keys.includes(key)),
      extra: keys.filter((key) => !baselineKeys.includes(key)),
    },
  );

  const placeholderMismatches = baselineKeys
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
    `${locale} keeps Issue detail/dialog placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
