import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandRegistry } from './shortcuts/commandRegistry';

const locales = ['en', 'zh', 'ja', 'ko', 'fr', 'es'] as const;
const loadShortcutDictionary = (locale: (typeof locales)[number]) =>
  JSON.parse(
    readFileSync(
      new URL(`./locales/${locale}/shortcuts.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, string>;
const dictionaries = locales.map(loadShortcutDictionary);
const englishKeys = Object.keys(dictionaries[0]).sort();
for (const dictionary of dictionaries.slice(1)) {
  assert.deepEqual(Object.keys(dictionary).sort(), englishKeys);
}
for (const definition of commandRegistry) {
  assert.ok(englishKeys.includes(definition.titleKey));
  assert.ok(englishKeys.includes(definition.categoryKey));
}
assert.ok(englishKeys.includes('shortcuts.reason.selectProject'));
assert.ok(englishKeys.includes('shortcuts.tooltip.shortcut'));
assert.ok(englishKeys.includes('shortcuts.recorder.recording'));
for (const dictionary of dictionaries) {
  assert.ok(dictionary['shortcuts.tooltip.shortcut'].includes('{shortcut}'));
}
assert.equal(englishKeys.length, 93);
console.log('Shortcut translations: PASS');
