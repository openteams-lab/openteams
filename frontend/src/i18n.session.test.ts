// Locale synchronization checks for the session workspace.
//
// Run with:
//     pnpm exec tsx src/i18n.session.test.ts

import {
  readSplitLocaleForTest,
  readTextForTest,
  testLocales,
} from "./i18n.test-utils";

const locales = testLocales;
const sourceFiles = [
  "./components/AgentMessageContent.tsx",
  "./components/CreateAgentSessionModal.tsx",
  "./components/FreeChatWorkspace.tsx",
  "./components/source-control/SessionSourceControlPanel.tsx",
  "./components/source-control/SourceControlFileRow.tsx",
  "./components/source-control/sourceControlViewModel.ts",
] as const;
const prefixes = [
  "agentActivity.",
  "createSession.",
  "linkedWorkItems.",
  "queue.",
  "relatedFiles.",
  "sourceControl.",
  "worktree.",
] as const;
const requiredWorktreeKeys = [
  "worktree.confirm.mergeDescription",
  "worktree.confirm.mergeTitle",
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

const isSessionKey = (key: string) =>
  prefixes.some((prefix) => key.startsWith(prefix));

const sessionKeys = (dict: LocaleDict) =>
  Object.keys(dict).filter(isSessionKey).sort();

const usedSessionKeys = () => {
  const keys = new Set<string>();

  for (const file of sourceFiles) {
    const text = readText(file);
    for (const match of text.matchAll(
      /["']((?:agentActivity|createSession|linkedWorkItems|queue|relatedFiles|sourceControl)\.[^"']+)["']/g,
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
console.log("Session workspace locale sync");

const dictionaries = Object.fromEntries(
  locales.map((locale) => [locale, readLocale(locale)]),
) as Record<Locale, LocaleDict>;
const baselineKeys = sessionKeys(dictionaries.en);
const usedKeys = usedSessionKeys();

check(
  "en defines every session workspace key used by session components",
  [...usedKeys, ...requiredWorktreeKeys].every((key) =>
    baselineKeys.includes(key),
  ),
  [...usedKeys, ...requiredWorktreeKeys].filter(
    (key) => !baselineKeys.includes(key),
  ),
);

for (const locale of locales) {
  const keys = sessionKeys(dictionaries[locale]);
  check(`${locale} has the same session workspace keys as en`, same(keys, baselineKeys), {
    missing: baselineKeys.filter((key) => !keys.includes(key)),
    extra: keys.filter((key) => !baselineKeys.includes(key)),
  });

  const placeholderMismatches = baselineKeys
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
    `${locale} keeps session workspace placeholders aligned with en`,
    placeholderMismatches.length === 0,
    placeholderMismatches,
  );
}

if (failures > 0) {
  process.exit(1);
}
