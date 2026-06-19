// Locale synchronization checks for the Team page.
//
// Run with:
//     pnpm exec tsx src/i18n.team.test.ts

import {
  readSplitLocaleForTest,
  readTextForTest,
  testLocales,
} from "./i18n.test-utils";

const locales = testLocales;
const sourceFiles = [
  "./pages/TeamPage.tsx",
  "./pages/team/TeamConfigTabs.tsx",
  "./pages/team/TeamMemberSidebar.tsx",
] as const;
const dynamicKeys = [
  "teamPage.state.idle",
  "teamPage.state.running",
  "teamPage.state.dead",
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

const readText = readTextForTest;

const readLocale = readSplitLocaleForTest;

const teamKeys = (dict: LocaleDict) =>
  Object.keys(dict)
    .filter((key) => key.startsWith("teamPage."))
    .sort();

const usedTeamKeys = () => {
  const keys = new Set<string>(dynamicKeys);

  for (const file of sourceFiles) {
    const text = readText(file);
    for (const match of text.matchAll(/t\(["'](teamPage\.[^"']+)["']/g)) {
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
console.log("Team page locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readLocale(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = teamKeys(dictionaries.en);
const usedKeys = usedTeamKeys();

check(
  "en defines every teamPage.* key used by the Team page",
  usedKeys.every((key) => baselineKeys.includes(key)),
  usedKeys.filter((key) => !baselineKeys.includes(key)),
);

for (const locale of locales) {
  const keys = teamKeys(dictionaries[locale]);
  check(
    `${locale} has the same teamPage.* keys as en`,
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
    `${locale} keeps teamPage.* placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
