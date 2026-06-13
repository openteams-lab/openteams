// Locale synchronization checks for the Build Stats page.
//
// Run with:
//     pnpm exec tsx src/i18n.build-stats.test.ts

import {
  readSplitLocaleForTest,
  readTextForTest,
  testLocales,
} from "./i18n.test-utils";

const locales = testLocales;
const sourceFiles = [
  "./pages/BuildStatsPage.tsx",
  "./components/ActivityTrendChart.tsx",
  "./components/DailyTokenChart.tsx",
  "./components/ModelPricingTable.tsx",
  "./components/SessionCostList.tsx",
  "./components/TimeRangeFilter.tsx",
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

const buildStatsKeys = (dict: LocaleDict) =>
  Object.keys(dict)
    .filter((key) => key.startsWith("buildStats."))
    .sort();

const usedBuildStatsKeys = () => {
  const keys = new Set<string>();

  for (const file of sourceFiles) {
    const text = readText(file);
    for (const match of text.matchAll(/(?:t|text|label)\(["'](buildStats\.[^"']+)["']/g)) {
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
console.log("Build Stats page locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readLocale(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = buildStatsKeys(dictionaries.en);
const usedKeys = usedBuildStatsKeys();

check(
  "en defines every buildStats.* key used by the Build Stats page",
  usedKeys.every((key) => baselineKeys.includes(key)),
  usedKeys.filter((key) => !baselineKeys.includes(key)),
);

for (const locale of locales) {
  const keys = buildStatsKeys(dictionaries[locale]);
  check(
    `${locale} has the same buildStats.* keys as en`,
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
    `${locale} keeps buildStats.* placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
