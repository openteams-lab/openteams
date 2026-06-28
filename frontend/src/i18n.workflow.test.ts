// Locale synchronization checks for workflow UI.
//
// Run with:
//     pnpm exec tsx src/i18n.workflow.test.ts

import {
  readSplitLocaleForTest,
  readTextForTest,
  testLocales,
} from "./i18n.test-utils";

const locales = testLocales;
const sourceFiles = [
  "./components/workflow/WorkflowCard.tsx",
  "./components/workflow/ChatWorkflowCard.tsx",
  "./components/workflow/WorkflowGraphBoard.tsx",
  "./components/workflow/WorkflowIterationFeedbackCard.tsx",
  "./components/workflow/WorkflowPendingInputCard.tsx",
  "./components/workflow/WorkflowPendingReviewCard.tsx",
  "./components/workflow/WorkflowReviewSettingsDialog.tsx",
  "./components/workflow/WorkflowWindow.tsx",
  "./components/workflow/workflowGeneratedText.ts",
  "./components/workflow/workflowStepPresentation.ts",
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

const workflowKeys = (dict: LocaleDict) =>
  Object.keys(dict).filter((key) => key.startsWith("workflow.")).sort();

const usedWorkflowKeys = () => {
  const keys = new Set<string>();

  for (const file of sourceFiles) {
    const text = readTextForTest(file);
    for (const match of text.matchAll(/["'](workflow\.[^"']+)["']/g)) {
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
console.log("Workflow locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readSplitLocaleForTest(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = workflowKeys(dictionaries.en);
const usedKeys = usedWorkflowKeys();

check(
  "en defines every workflow key used by workflow components",
  usedKeys.every((key) => baselineKeys.includes(key)),
  usedKeys.filter((key) => !baselineKeys.includes(key)),
);

for (const locale of locales) {
  const keys = workflowKeys(dictionaries[locale]);
  check(`${locale} has the same workflow keys as en`, same(keys, baselineKeys), {
    missing: baselineKeys.filter((key) => !keys.includes(key)),
    extra: keys.filter((key) => !baselineKeys.includes(key)),
  });

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
    `${locale} keeps workflow placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
