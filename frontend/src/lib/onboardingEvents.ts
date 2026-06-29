import type { OnboardingState } from '../../../shared/types';

export const ONBOARDING_GUIDE_RESET_EVENT = 'openteams:onboarding-guide-reset';
export const ONBOARDING_UPGRADE_REPLAY_EVENT =
  'openteams:onboarding-upgrade-replay';

export const dispatchOnboardingGuideReset = (state: OnboardingState) => {
  window.dispatchEvent(
    new CustomEvent<OnboardingState>(ONBOARDING_GUIDE_RESET_EVENT, {
      detail: state,
    }),
  );
};

export const dispatchOnboardingUpgradeReplay = (state: OnboardingState) => {
  window.dispatchEvent(
    new CustomEvent<OnboardingState>(ONBOARDING_UPGRADE_REPLAY_EVENT, {
      detail: state,
    }),
  );
};
