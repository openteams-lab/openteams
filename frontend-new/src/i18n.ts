import { Locale } from '@/types';
import enAgents from '@/locales/en/agents.json';
import enBuildStats from '@/locales/en/build-stats.json';
import enCommon from '@/locales/en/common.json';
import enIssue from '@/locales/en/issue.json';
import enSettings from '@/locales/en/settings.json';
import enTeam from '@/locales/en/team.json';
import enWorkspace from '@/locales/en/workspace.json';
import esAgents from '@/locales/es/agents.json';
import esBuildStats from '@/locales/es/build-stats.json';
import esCommon from '@/locales/es/common.json';
import esIssue from '@/locales/es/issue.json';
import esSettings from '@/locales/es/settings.json';
import esTeam from '@/locales/es/team.json';
import esWorkspace from '@/locales/es/workspace.json';
import frAgents from '@/locales/fr/agents.json';
import frBuildStats from '@/locales/fr/build-stats.json';
import frCommon from '@/locales/fr/common.json';
import frIssue from '@/locales/fr/issue.json';
import frSettings from '@/locales/fr/settings.json';
import frTeam from '@/locales/fr/team.json';
import frWorkspace from '@/locales/fr/workspace.json';
import jaAgents from '@/locales/ja/agents.json';
import jaBuildStats from '@/locales/ja/build-stats.json';
import jaCommon from '@/locales/ja/common.json';
import jaIssue from '@/locales/ja/issue.json';
import jaSettings from '@/locales/ja/settings.json';
import jaTeam from '@/locales/ja/team.json';
import jaWorkspace from '@/locales/ja/workspace.json';
import koAgents from '@/locales/ko/agents.json';
import koBuildStats from '@/locales/ko/build-stats.json';
import koCommon from '@/locales/ko/common.json';
import koIssue from '@/locales/ko/issue.json';
import koSettings from '@/locales/ko/settings.json';
import koTeam from '@/locales/ko/team.json';
import koWorkspace from '@/locales/ko/workspace.json';
import zhAgents from '@/locales/zh/agents.json';
import zhBuildStats from '@/locales/zh/build-stats.json';
import zhCommon from '@/locales/zh/common.json';
import zhIssue from '@/locales/zh/issue.json';
import zhSettings from '@/locales/zh/settings.json';
import zhTeam from '@/locales/zh/team.json';
import zhWorkspace from '@/locales/zh/workspace.json';

type LocaleDict = Record<string, string>;

const mergeLocale = (...parts: LocaleDict[]): LocaleDict =>
  Object.assign({}, ...parts);

export const i18nDict: Record<Locale, LocaleDict> = {
  en: mergeLocale(
    enCommon,
    enWorkspace,
    enAgents,
    enBuildStats,
    enIssue,
    enSettings,
    enTeam,
  ),
  zh: mergeLocale(
    zhCommon,
    zhWorkspace,
    zhAgents,
    zhBuildStats,
    zhIssue,
    zhSettings,
    zhTeam,
  ),
  ja: mergeLocale(
    jaCommon,
    jaWorkspace,
    jaAgents,
    jaBuildStats,
    jaIssue,
    jaSettings,
    jaTeam,
  ),
  ko: mergeLocale(
    koCommon,
    koWorkspace,
    koAgents,
    koBuildStats,
    koIssue,
    koSettings,
    koTeam,
  ),
  fr: mergeLocale(
    frCommon,
    frWorkspace,
    frAgents,
    frBuildStats,
    frIssue,
    frSettings,
    frTeam,
  ),
  es: mergeLocale(
    esCommon,
    esWorkspace,
    esAgents,
    esBuildStats,
    esIssue,
    esSettings,
    esTeam,
  ),
};
