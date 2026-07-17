import { readFileSync } from "node:fs";
import type { Locale } from "./types";

export type LocaleDict = Record<string, string>;

export const testLocales = ["en", "zh", "ja", "ko", "fr", "es"] as const;

const localeFiles = [
  "common",
  "workspace",
  "agents",
  "build-stats",
  "issue",
  "settings",
  "team",
  "team-templates",
  "workflow",
] as const;

export const readTextForTest = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

export const readSplitLocaleForTest = (locale: Locale): LocaleDict =>
  Object.assign(
    {},
    ...localeFiles.map(
      (file) =>
        JSON.parse(
          readTextForTest(`./locales/${locale}/${file}.json`),
        ) as LocaleDict,
    ),
  );
