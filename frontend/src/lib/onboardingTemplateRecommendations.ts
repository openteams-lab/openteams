import {
  OnboardingScenario,
  type ChatTeamPreset,
} from '../../../shared/types';

const scenarioTemplateHints = {
  [OnboardingScenario.software]: [
    'fullstack_delivery_team',
    'rapid_bugfix_team',
    'architecture_governance_team',
  ],
  [OnboardingScenario.design]: [
    'product_discovery_team',
    'content_studio_team',
  ],
  [OnboardingScenario.research]: [
    'research_innovation_team',
    'ai_prompt_quality_team',
  ],
  [OnboardingScenario.other]: ['blank_team'],
} as const;

const normalizeTemplateText = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/[\s-]+/gu, '_');

const matchesTemplateHint = (team: ChatTeamPreset, hint: string): boolean => {
  const normalizedHint = normalizeTemplateText(hint);
  return [team.id, team.name, team.description].some((value) =>
    normalizeTemplateText(value).includes(normalizedHint),
  );
};

export const recommendOnboardingTeamTemplate = (
  scenario: OnboardingScenario,
  teams: ChatTeamPreset[],
): ChatTeamPreset | null => {
  const enabledBuiltinTeams = teams.filter(
    (team) => team.enabled !== false && team.is_builtin !== false,
  );
  const hints = scenarioTemplateHints[scenario] ?? scenarioTemplateHints.other;
  return (
    hints
      .map((hint) =>
        enabledBuiltinTeams.find((team) => matchesTemplateHint(team, hint)),
      )
      .find(Boolean) ??
    enabledBuiltinTeams[0] ??
    null
  );
};
