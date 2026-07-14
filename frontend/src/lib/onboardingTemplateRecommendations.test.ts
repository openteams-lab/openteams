import assert from 'node:assert/strict';
import { recommendOnboardingTeamTemplate } from './onboardingTemplateRecommendations';
import { OnboardingScenario, type ChatTeamPreset } from '../../../shared/types';

const template = (
  id: string,
  patch: Partial<ChatTeamPreset> = {},
): ChatTeamPreset => ({
  id,
  name: patch.name ?? id,
  description: patch.description ?? `${id} description`,
  members: patch.members ?? [],
  lead_member_id: patch.lead_member_id ?? null,
  workflow_steps: patch.workflow_steps ?? [],
  team_protocol: patch.team_protocol ?? '',
  is_builtin: patch.is_builtin ?? true,
  enabled: patch.enabled ?? true,
  tier: patch.tier ?? 'standard',
});

const teams = [
  template('custom_disabled', { enabled: false }),
  template('fullstack_delivery_team'),
  template('product_discovery_team'),
  template('research_innovation_team'),
  template('team_collaboration_protocol'),
];

assert.equal(
  recommendOnboardingTeamTemplate(OnboardingScenario.software, teams)?.id,
  'fullstack_delivery_team',
);
assert.equal(
  recommendOnboardingTeamTemplate(OnboardingScenario.design, teams)?.id,
  'product_discovery_team',
);
assert.equal(
  recommendOnboardingTeamTemplate(OnboardingScenario.research, teams)?.id,
  'research_innovation_team',
);
assert.equal(
  recommendOnboardingTeamTemplate(OnboardingScenario.other, teams)?.id,
  'team_collaboration_protocol',
);
assert.equal(
  recommendOnboardingTeamTemplate(OnboardingScenario.software, [
    template('custom_team', { is_builtin: false }),
    template('fallback_builtin'),
  ])?.id,
  'fallback_builtin',
);
