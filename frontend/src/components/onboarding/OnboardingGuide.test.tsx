// Static checks for the onboarding and upgrade guide UI.
//
// Run with:
//     pnpm exec tsx src/components/onboarding/OnboardingGuide.test.tsx

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

console.log('OnboardingGuide wiring');

const guideSource = read('./OnboardingGuide.tsx');
const appSource = read('../../App.tsx');
const settingsSource = read('../SettingsWorkspace.tsx');

const requiredLocaleKeys = [
  'onboarding.welcome.title',
  'onboarding.welcome.next',
  'onboarding.step.scenario.title',
  'onboarding.step.executor.title',
  'onboarding.step.projectPath.title',
  'onboarding.step.appearance.title',
  'onboarding.action.startNow',
  'onboarding.project.createTitle',
  'onboarding.project.createDesc',
  'onboarding.project.createFailed',
  'onboarding.project.nameRequired',
  'onboarding.project.namePlaceholder',
  'onboarding.project.nameTitle',
  'onboarding.scenario.recommendedTemplate',
  'onboarding.upgrade.title',
  'onboarding.upgrade.markRead',
  'settings.onboarding.title',
  'settings.onboarding.resetGuide',
  'settings.onboarding.replayUpgrade',
];

check(
  'renders a full-screen guide component with onboarding and upgrade modes',
  guideSource.includes('export function OnboardingGuide') &&
    guideSource.includes("mode: 'onboarding' | 'upgrade'") &&
    guideSource.includes('fixed inset-0') &&
    guideSource.includes('renderUpgradeGuide'),
  guideSource,
);

check(
  'welcome page is independent from numbered steps',
  guideSource.includes("const welcomeStepKey = 'welcome'") &&
    guideSource.includes('activeStepKey === welcomeStepKey') &&
    guideSource.includes('if (isWelcome)') &&
    guideSource.includes('return renderConfigurationStep()') &&
    guideSource.includes('onboarding.welcome.next') &&
    !guideSource.includes('welcomeStepKey, ...onboardingSteps'),
  guideSource,
);

check(
  'four onboarding steps are ordered as scenario, executor, project path, appearance',
  guideSource.includes(
    "const onboardingSteps = ['scenario', 'executor', 'project_path', 'appearance'] as const",
  ),
  guideSource,
);

check(
  'scenario page only exposes recommended team names, not member rows',
  guideSource.includes('renderScenarioStep') &&
    guideSource.includes('recommendedTeamName') &&
    guideSource.includes('recommendOnboardingTeamTemplate') &&
    guideSource.includes('onboarding.scenario.memberDetailsHint') &&
    guideSource.includes('renderExecutorStep') &&
    guideSource.includes('teamMembers.map') &&
    !/renderScenarioStep[\s\S]*teamMembers\.map/.test(guideSource),
  guideSource,
);

check(
  'executor and model configuration reuses DropdownSelect',
  guideSource.includes('import { DropdownSelect') &&
    guideSource.includes('runnerOptions') &&
    guideSource.includes('modelOptionsForRunner') &&
    (guideSource.match(/<DropdownSelect/g) ?? []).length >= 2,
  guideSource,
);

check(
  'project path step uses existing filesystem and workspace validation APIs',
  guideSource.includes('filesystemApi.listRoots') &&
    guideSource.includes('filesystemApi.listDirectory') &&
    guideSource.includes('chatSessionsApi.validateWorkspacePath') &&
    !guideSource.includes('webkitdirectory'),
  guideSource,
);

check(
  'project names are sanitized on blur and before onboarding project creation',
  guideSource.includes("import { sanitizeProjectName }") &&
    guideSource.includes("const defaultProjectName = 'MyProject'") &&
    guideSource.includes('current.trim() ? current : defaultProjectName') &&
    guideSource.includes('const name = sanitizeProjectName(projectName)') &&
    guideSource.includes('setProjectName(event.target.value)') &&
    guideSource.includes('onBlur={() => setProjectName((current) => sanitizeProjectName(current))}') &&
    !guideSource.includes('setProjectName(sanitizeProjectName(event.target.value))'),
  guideSource,
);

check(
  'start now creates a real project, completes onboarding, then opens the existing session composer',
  guideSource.indexOf('await onCreateProjectFromOnboarding') <
    guideSource.indexOf('await onboardingApi.complete') &&
  guideSource.includes('await onboardingApi.complete') &&
    guideSource.includes('path: projectDraft.path') &&
    guideSource.includes('created_project_id: createdProject.projectId') &&
    guideSource.includes('onOpenCreateSession(state)') &&
    appSource.includes('onCreateProjectFromOnboarding={handleCreateOnboardingProject}') &&
    appSource.includes('return { projectId: project.id, sessionId: null }') &&
    appSource.includes('handleOnboardingCompleted') &&
    appSource.includes('setIsCreateSessionModalOpen(true)'),
  { guideSource, appSource },
);

check(
  'App loads onboarding state on startup and gates upgrade by current version',
  appSource.includes('onboardingApi.getState()') &&
    appSource.includes('compareVersions(') &&
    appSource.includes('last_seen_upgrade_version') &&
    appSource.includes('currentUpgradeVersion') &&
    appSource.includes('<OnboardingGuide'),
  appSource,
);

check(
  'onboarding state changes keep the active overlay state synchronized',
  appSource.includes('setOnboardingOverlay((current) =>') &&
    appSource.includes('current ? { ...current, state: nextState } : current'),
  appSource,
);

check(
  'initialization effect does not reset the active step when runtimes templates locale or theme change',
  guideSource.includes('const initializeFromState =') &&
    guideSource.includes('useEffect(() => {') &&
    guideSource.includes('initializeFromState(initialState);') &&
    guideSource.includes('}, [initialState]);') &&
    !guideSource.includes('buildTeamConfigForScenario,\n    initialState,\n    locale,') &&
    !guideSource.includes('projectNameForScenario,\n    theme,'),
  guideSource,
);

check(
  'SettingsWorkspace provides reset and replay actions through onboarding API',
  settingsSource.includes('onboardingApi.reset()') &&
    settingsSource.includes('onboardingApi.resetUpgradeRead()') &&
    settingsSource.includes('ONBOARDING_GUIDE_RESET_EVENT') &&
    settingsSource.includes('ONBOARDING_UPGRADE_REPLAY_EVENT'),
  settingsSource,
);

check(
  'upgrade guide marks the current version as read',
  guideSource.includes('onboardingApi.markUpgradeRead({ version: currentVersion })') &&
    guideSource.includes('onUpgradeRead(state)'),
  guideSource,
);

check(
  'language and appearance selections preview immediately and save draft state',
  guideSource.includes('onPreviewLocaleChange(option.id)') &&
    guideSource.includes('onPreviewAppearanceChange(option.id)') &&
    guideSource.includes("saveDraft({ language: localeToOnboardingLanguage[option.id] })") &&
    guideSource.includes("saveDraft({ appearance: option.id })") &&
    appSource.includes('onPreviewLocaleChange={setLocale}') &&
    appSource.includes('onPreviewAppearanceChange={handleOnboardingPreviewAppearanceChange}'),
  { guideSource, appSource },
);

for (const locale of ['en', 'zh', 'ja', 'ko', 'fr', 'es']) {
  const commonSource = read(`../../locales/${locale}/common.json`);
  const settingsLocaleSource = read(`../../locales/${locale}/settings.json`);
  check(
    `locale ${locale} contains onboarding and settings guide keys`,
    requiredLocaleKeys.every((key) =>
      key.startsWith('settings.')
        ? settingsLocaleSource.includes(`"${key}"`)
        : commonSource.includes(`"${key}"`),
    ),
    { commonSource, settingsLocaleSource },
  );
}

if (failures > 0) {
  process.exitCode = 1;
}
