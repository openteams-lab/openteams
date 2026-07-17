import { Locale } from '@/types';
import enAgents from '@/locales/en/agents.json';
import enBuildStats from '@/locales/en/build-stats.json';
import enCommon from '@/locales/en/common.json';
import enIssue from '@/locales/en/issue.json';
import enSettings from '@/locales/en/settings.json';
import enShortcuts from '@/locales/en/shortcuts.json';
import enTeam from '@/locales/en/team.json';
import enTeamTemplates from '@/locales/en/team-templates.json';
import enWorkflow from '@/locales/en/workflow.json';
import enWorkspace from '@/locales/en/workspace.json';
import esAgents from '@/locales/es/agents.json';
import esBuildStats from '@/locales/es/build-stats.json';
import esCommon from '@/locales/es/common.json';
import esIssue from '@/locales/es/issue.json';
import esSettings from '@/locales/es/settings.json';
import esShortcuts from '@/locales/es/shortcuts.json';
import esTeam from '@/locales/es/team.json';
import esTeamTemplates from '@/locales/es/team-templates.json';
import esWorkflow from '@/locales/es/workflow.json';
import esWorkspace from '@/locales/es/workspace.json';
import frAgents from '@/locales/fr/agents.json';
import frBuildStats from '@/locales/fr/build-stats.json';
import frCommon from '@/locales/fr/common.json';
import frIssue from '@/locales/fr/issue.json';
import frSettings from '@/locales/fr/settings.json';
import frShortcuts from '@/locales/fr/shortcuts.json';
import frTeam from '@/locales/fr/team.json';
import frTeamTemplates from '@/locales/fr/team-templates.json';
import frWorkflow from '@/locales/fr/workflow.json';
import frWorkspace from '@/locales/fr/workspace.json';
import jaAgents from '@/locales/ja/agents.json';
import jaBuildStats from '@/locales/ja/build-stats.json';
import jaCommon from '@/locales/ja/common.json';
import jaIssue from '@/locales/ja/issue.json';
import jaSettings from '@/locales/ja/settings.json';
import jaShortcuts from '@/locales/ja/shortcuts.json';
import jaTeam from '@/locales/ja/team.json';
import jaTeamTemplates from '@/locales/ja/team-templates.json';
import jaWorkflow from '@/locales/ja/workflow.json';
import jaWorkspace from '@/locales/ja/workspace.json';
import koAgents from '@/locales/ko/agents.json';
import koBuildStats from '@/locales/ko/build-stats.json';
import koCommon from '@/locales/ko/common.json';
import koIssue from '@/locales/ko/issue.json';
import koSettings from '@/locales/ko/settings.json';
import koShortcuts from '@/locales/ko/shortcuts.json';
import koTeam from '@/locales/ko/team.json';
import koTeamTemplates from '@/locales/ko/team-templates.json';
import koWorkflow from '@/locales/ko/workflow.json';
import koWorkspace from '@/locales/ko/workspace.json';
import zhAgents from '@/locales/zh/agents.json';
import zhBuildStats from '@/locales/zh/build-stats.json';
import zhCommon from '@/locales/zh/common.json';
import zhIssue from '@/locales/zh/issue.json';
import zhSettings from '@/locales/zh/settings.json';
import zhShortcuts from '@/locales/zh/shortcuts.json';
import zhTeam from '@/locales/zh/team.json';
import zhTeamTemplates from '@/locales/zh/team-templates.json';
import zhWorkflow from '@/locales/zh/workflow.json';
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
    enTeamTemplates,
    enWorkflow,
    enShortcuts,
  ),
  zh: mergeLocale(
    zhCommon,
    zhWorkspace,
    zhAgents,
    zhBuildStats,
    zhIssue,
    zhSettings,
    zhTeam,
    zhTeamTemplates,
    zhWorkflow,
    zhShortcuts,
  ),
  ja: mergeLocale(
    jaCommon,
    jaWorkspace,
    jaAgents,
    jaBuildStats,
    jaIssue,
    jaSettings,
    jaTeam,
    jaTeamTemplates,
    jaWorkflow,
    jaShortcuts,
  ),
  ko: mergeLocale(
    koCommon,
    koWorkspace,
    koAgents,
    koBuildStats,
    koIssue,
    koSettings,
    koTeam,
    koTeamTemplates,
    koWorkflow,
    koShortcuts,
  ),
  fr: mergeLocale(
    frCommon,
    frWorkspace,
    frAgents,
    frBuildStats,
    frIssue,
    frSettings,
    frTeam,
    frTeamTemplates,
    frWorkflow,
    frShortcuts,
  ),
  es: mergeLocale(
    esCommon,
    esWorkspace,
    esAgents,
    esBuildStats,
    esIssue,
    esSettings,
    esTeam,
    esTeamTemplates,
    esWorkflow,
    esShortcuts,
  ),
};
