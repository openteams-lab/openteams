// Locale synchronization checks for the Issue link dialog.
//
// Run with:
//     pnpm exec tsx src/i18n.issue.test.ts

import { readFileSync } from "node:fs";

const locales = ["en", "zh", "ja", "ko", "fr", "es"] as const;
const sourceFiles = ["./pages/IssuePage.tsx"] as const;
const dynamicKeys = [
  "issue.linkDialog.provider.github.description",
  "issue.linkDialog.provider.github.name",
  "issue.linkDialog.provider.jira.description",
  "issue.linkDialog.provider.jira.name",
  "issue.linkDialog.provider.linear.description",
  "issue.linkDialog.provider.linear.name",
] as const;
const requiredPlaceholders: Record<string, readonly string[]> = {
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

const readText = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const readLocale = (locale: Locale): LocaleDict =>
  JSON.parse(readText(`./locales/${locale}.json`)) as LocaleDict;

const issueLinkDialogKeys = (dict: LocaleDict) =>
  Object.keys(dict)
    .filter((key) => key.startsWith("issue.linkDialog."))
    .sort();

const usedIssueLinkDialogKeys = () => {
  const keys = new Set<string>(dynamicKeys);

  for (const file of sourceFiles) {
    const text = readText(file);
    for (const match of text.matchAll(
      /tr\(\s*["'](issue\.linkDialog\.[^"']+)["']/g,
    )) {
      keys.add(match[1]);
    }
  }

  return Array.from(keys).sort();
};

const placeholders = (value: string) =>
  Array.from(value.matchAll(/\{([a-zA-Z0-9_]+)\}/g))
    .map((match) => match[1])
    .sort();

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

// eslint-disable-next-line no-console
console.log("Issue link dialog locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readLocale(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = issueLinkDialogKeys(dictionaries.en);
const usedKeys = usedIssueLinkDialogKeys();

check(
  "en defines every issue.linkDialog.* key used by the Issue page",
  usedKeys.every((key) => baselineKeys.includes(key)),
  usedKeys.filter((key) => !baselineKeys.includes(key)),
);

check(
  "en keeps required issue.linkDialog.* placeholders",
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

for (const locale of locales) {
  const keys = issueLinkDialogKeys(dictionaries[locale]);
  check(
    `${locale} has the same issue.linkDialog.* keys as en`,
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
    `${locale} keeps issue.linkDialog.* placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
