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
  'onboarding.project.detecting',
  'onboarding.project.gitDetected',
  'onboarding.project.gitMissing',
  'onboarding.project.gitignoreTemplate',
  'onboarding.project.initializeGit',
  'onboarding.project.initializeAction',
  'onboarding.project.initializeFailed',
  'onboarding.project.nameRequired',
  'onboarding.project.namePlaceholder',
  'onboarding.project.nameTitle',
  'onboarding.project.pathPrompt',
  'onboarding.executor.table.executor',
  'onboarding.executor.table.model',
  'onboarding.executor.table.role',
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
    guideSource.includes("useState('workflow_execution')") &&
    guideSource.includes('const welcomeCommandOptions = useMemo') &&
    guideSource.includes("label: '本地多Agent工作区'") &&
    guideSource.includes("label: '工作流编排引擎'") &&
    guideSource.includes("label: '智能体团队模板平台'") &&
    guideSource.includes("label: '项目进度加速器'") &&
    !guideSource.includes("label: '多Agent协作'") &&
    !guideSource.includes("keyHint: 'A'") &&
    guideSource.includes('window.addEventListener(\'keydown\', handleWelcomeShortcut)') &&
    guideSource.includes('onMouseEnter={() => setSelectedWelcomeCommandId(id)}') &&
    guideSource.includes('{selectedWelcomeCommand.label}') &&
    guideSource.includes('aria-pressed={active}') &&
    guideSource.includes('"JetBrains Mono", "SF Mono", "SFMono-Regular", ui-monospace') &&
    guideSource.includes("'--ink': '#f4f4f5'") &&
    guideSource.includes("'--ink-muted': '#a1a1aa'") &&
    guideSource.includes("'--ink-subtle': '#8a8f98'") &&
    guideSource.includes('text-[#a8b3c2]') &&
    guideSource.includes('rounded-[6px] border border-white bg-white') &&
    guideSource.includes('px-9 py-3 text-[14px]') &&
    guideSource.includes('transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]') &&
    guideSource.includes('will-change-transform hover:-translate-y-[2px] hover:scale-[1.012]') &&
    guideSource.includes('hover:shadow-[inset_0_-1px_0_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.55),0_14px_34px_rgba(255,255,255,0.11)]') &&
    guideSource.includes('active:translate-y-[1px] active:scale-[0.988] active:bg-[#e7e7e7]') &&
    guideSource.includes('const onboardingNoiseTextureStyle') &&
    guideSource.includes('feTurbulence type=%27fractalNoise%27') &&
    guideSource.includes('opacity-[0.025]') &&
    guideSource.includes('shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]') &&
    guideSource.includes('pointer-events-none absolute inset-0 bg-[#0E0F11]') &&
    guideSource.includes('flex min-h-[440px] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-white/[0.12] bg-[#1A1A1A]/90') &&
    guideSource.includes('border-b border-white/[0.08] bg-[#1A1A1A]/90 px-4 py-3') &&
    guideSource.includes('h-2 w-2 rounded-full border border-white/[0.18] bg-white/[0.065]') &&
    guideSource.includes('ml-4 h-3 w-32 rounded-[3px] border border-white/[0.08] bg-white/[0.065]') &&
    guideSource.includes('flex min-h-0 flex-1 items-center justify-center px-4 py-10 sm:px-20') &&
    guideSource.includes('max-w-md -translate-y-4 overflow-hidden rounded-[6px] border border-white/[0.12] bg-[#151617]/95') &&
    guideSource.includes('min-w-6 rounded-[3px] border border-white/[0.18] bg-[#0c0c0c]') &&
    guideSource.includes("active ? 'text-white' : 'text-[#8792a3]'") &&
    guideSource.includes('absolute bottom-2 left-0 top-2 w-px') &&
    guideSource.includes('text-current opacity-55') &&
    guideSource.includes('mt-12 flex flex-col items-center gap-4') &&
    guideSource.includes('tracking-[0.22em] text-[#8f9aaa]') &&
    guideSource.includes('ALL 4 STEPS TO FINISH CONFIGURATION') &&
    !guideSource.includes('top-1/2 -z-10 h-3/4 w-3/4') &&
    !guideSource.includes('Press Enter') &&
    !guideSource.includes('h-0.5 w-10 rounded-full bg-[#f4f4f5]') &&
    !guideSource.includes('welcomeStepKey, ...onboardingSteps'),
  guideSource,
);

check(
  'four onboarding steps are ordered as appearance, scenario, executor, project path',
  guideSource.includes(
    "const onboardingSteps = ['appearance', 'scenario', 'executor', 'project_path'] as const",
  ),
  guideSource,
);

check(
  'scenario page only exposes recommended team names, not member rows',
    guideSource.includes('renderScenarioStep') &&
    guideSource.includes('recommendedTeamName') &&
    guideSource.includes('recommendOnboardingTeamTemplate') &&
    !guideSource.includes("t('onboarding.scenario.memberDetailsHint')") &&
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
    (guideSource.match(/<DropdownSelect/g) ?? []).length >= 2 &&
    guideSource.includes("t('onboarding.executor.table.role')") &&
    guideSource.includes("t('onboarding.executor.table.executor')") &&
    guideSource.includes("t('onboarding.executor.table.model')"),
  guideSource,
);

check(
  'project path step uses existing filesystem and workspace validation APIs',
  guideSource.includes('filesystemApi.listRoots') &&
    guideSource.includes('filesystemApi.listDirectory') &&
    guideSource.includes('filesystemApi.createDirectory') &&
    guideSource.includes('filesystemApi.renameDirectory') &&
    guideSource.includes('chatSessionsApi.validateWorkspacePath') &&
    guideSource.includes('chatSessionsApi.initializeWorkspaceGit') &&
    !guideSource.includes('webkitdirectory'),
  guideSource,
);

check(
  'project path step uses the shared onboarding panel with micro Git controls',
  guideSource.includes('h-full w-full max-w-[820px] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90') &&
    guideSource.includes('lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.74fr)]') &&
    guideSource.includes('overflow-y-auto lg:grid-cols') &&
    guideSource.includes("gitignoreTemplates = ['node', 'go', 'python', 'none'] as const") &&
    guideSource.includes("grid-rows-[1fr]") &&
    guideSource.includes('chatSessionsApi.initializeWorkspaceGit') &&
    guideSource.includes('className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5]"') &&
    guideSource.includes('rounded-[6px] border border-white/[0.08] bg-[#151617]') &&
    guideSource.includes('focus:bg-[#171819]') &&
    !guideSource.includes('bg-[#111214]') &&
    guideSource.includes('<Plus className="h-3.5 w-3.5"') &&
    guideSource.includes('const commitDirectoryRename = async () =>') &&
    guideSource.includes('autoFocus') &&
    guideSource.includes('options={gitignoreOptions}') &&
    guideSource.includes('className={onboardingProjectSelectClassName}') &&
    guideSource.includes('[&>button]:h-7') &&
    guideSource.includes('[&>button]:px-1.5') &&
    guideSource.includes('panelClassName="[&_*]:!text-[12px] [&_[role=listbox]]:!py-0.5 [&_[role=option]]:!px-2 [&_[role=option]]:!py-1"') &&
    guideSource.includes('maxPanelHeightClassName="max-h-[144px]"') &&
    !guideSource.includes('<RefreshCw') &&
    !guideSource.includes('<select') &&
    !guideSource.includes("t('onboarding.project.validate')") &&
    guideSource.includes('border-l-white/[0.28] bg-white/[0.05]') &&
    guideSource.includes('border border-emerald-300/[0.14] bg-emerald-400/[0.06]') &&
    !guideSource.includes("0_4px_20px_rgba(95,99,242,0.25)") &&
    guideSource.includes("onboarding.project.gitMissing"),
  guideSource,
);

check(
  'project creation errors stay in the lower-right project configuration area',
  guideSource.includes('const projectConfigurationError = pathError || error;') &&
    guideSource.includes('className="mt-4 flex min-h-[42px] shrink-0 items-end justify-between gap-3 pt-2"') &&
    guideSource.includes('projectConfigurationError &&') &&
    guideSource.includes("error && stepKey !== 'project_path'") &&
    !guideSource.includes('{(pathError || error) &&'),
  guideSource,
);

check(
  'project path step exposes a compact lower-right Git initialize action',
  guideSource.includes('const handleInitializeProjectGit = async () =>') &&
    guideSource.includes('showInitializeGitAction') &&
    guideSource.includes('initializeGit &&') &&
    guideSource.includes('!projectStatus.is_git_repo') &&
    guideSource.includes('onClick={() => void handleInitializeProjectGit()}') &&
    guideSource.includes("t('onboarding.project.initializeAction')") &&
    guideSource.includes('h-7 shrink-0') &&
    guideSource.includes("t('onboarding.project.initializeFailed')"),
  guideSource,
);

check(
  'all onboarding step pages use the create-project base background',
    guideSource.includes('pointer-events-none absolute inset-0 bg-[#0E0F11]') &&
    !guideSource.includes("stepKey === 'project_path' ? 'bg-[#0E0F11]' : 'bg-[#0a0a0a]'") &&
    !guideSource.includes('pointer-events-none absolute inset-0 bg-black') &&
    guideSource.includes('opacity-[0.032] mix-blend-screen') &&
    guideSource.includes('items-center justify-center overflow-y-auto py-8') &&
    guideSource.includes('relative mt-7 w-full max-w-5xl p-0 text-left') &&
    guideSource.includes('mt-12 flex min-h-10 w-full max-w-5xl') &&
    guideSource.includes('const current = index === activeStepIndex') &&
    guideSource.includes("'h-[2px] w-10 rounded-none transition-colors duration-150'") &&
    guideSource.includes("? 'bg-[#f4f4f5]'") &&
    guideSource.includes("? 'bg-white/[0.28]'") &&
    guideSource.includes(": 'bg-white/[0.15]'") &&
    !guideSource.includes('const topProgressPercent =') &&
    guideSource.includes('flex h-[340px] items-center justify-center') &&
    !guideSource.includes('radial-gradient') &&
    !guideSource.includes("backgroundSize: stepKey === 'project_path'"),
  guideSource,
);

check(
  'configuration form steps keep the flat onboarding treatment',
    guideSource.includes('renderScenarioStep') &&
    guideSource.includes('renderExecutorStep') &&
    guideSource.includes('renderProjectPathStep') &&
    guideSource.includes('renderAppearanceStep') &&
    guideSource.includes('flex h-[340px] items-center justify-center') &&
    guideSource.includes('h-full w-full max-w-[820px] rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90') &&
    guideSource.includes('h-full w-full max-w-[820px] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90') &&
    !guideSource.includes('bg-[#121212]/90') &&
    guideSource.includes('px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] sm:px-7 sm:py-5') &&
    guideSource.includes('md:grid-cols-[minmax(160px,1fr)_190px_230px]') &&
    guideSource.includes("const executorSelectClassName =") &&
    guideSource.includes('text-[25px] font-[600] leading-tight tracking-[0] text-[#f4f4f5]') &&
    !guideSource.includes('text-[22px] font-medium text-white/[0.92]') &&
    guideSource.includes('font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#8A8F98]') &&
    guideSource.includes('shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]') &&
    guideSource.includes('bg-[linear-gradient(180deg,#FFFFFF_0%,#F2F2F2_100%)]') &&
    guideSource.includes('shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.28)]') &&
    guideSource.includes('flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] bg-transparent') &&
    !guideSource.includes('bg-[#0a0a0a]/30') &&
    guideSource.includes('[&>button]:h-7 [&>button]:rounded-[3px]') &&
    guideSource.includes('[&>button]:border-transparent [&>button]:bg-transparent') &&
    guideSource.includes('[&>button:hover]:border-transparent [&>button:hover]:bg-white/[0.035]') &&
    guideSource.includes('[&>button[data-placeholder=true]>span]:text-[#6f6f76]') &&
    guideSource.includes('[&>button>svg:last-child]:text-[var(--ink-tertiary)]') &&
    !guideSource.includes('executorSelectPanelClassName') &&
    guideSource.includes('text-[9px] font-semibold uppercase leading-none tracking-[0.05em] text-white/45') &&
    guideSource.includes('hover:bg-white/[0.05] md:mx-2') &&
    guideSource.includes('leading-[20px]') &&
    !guideSource.includes("index < teamMembers.length - 1 && 'border-b border-white/[0.08]'") &&
    guideSource.includes('lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.84fr)] lg:gap-10') &&
    guideSource.includes('mx-auto grid w-full max-w-[760px] gap-3 sm:grid-cols-2') &&
    guideSource.includes('group min-h-[104px] cursor-pointer rounded-[8px] border p-3') &&
    guideSource.includes('hover:bg-white/[0.04] focus-visible:outline-none') &&
    guideSource.includes('border-white/[0.18] bg-white/[0.065]') &&
    guideSource.includes('inset_0_1px_0_rgba(255,255,255,0.05)') &&
    guideSource.includes(": 'border-transparent bg-transparent'") &&
    guideSource.includes('border-white/[0.14] bg-white/[0.07]') &&
    guideSource.includes('border-transparent bg-transparent text-[#8a8f98] hover:bg-white/[0.04]') &&
    guideSource.includes('className="sr-only"') &&
    guideSource.includes('flex h-3 w-3 shrink-0 items-center justify-center rounded-full border') &&
    guideSource.includes('Icon: Moon') &&
    guideSource.includes('Icon: Sun') &&
    guideSource.includes('Icon: Monitor') &&
    guideSource.includes('Icon: Ellipsis') &&
    guideSource.includes('cursor-pointer rounded-[8px] border p-2 text-left transition') &&
    guideSource.includes('flex h-8 items-center justify-between rounded-[8px] border px-2.5') &&
    guideSource.includes('mt-1.5 text-[12px] font-semibold') &&
    guideSource.includes('border-[#d4d4d8]/80 bg-white/[0.07]') &&
    guideSource.includes('strokeWidth={1.4}') &&
    guideSource.includes('items-center justify-between') &&
    guideSource.includes('-mx-5 mt-7 border-t border-white/[0.08] px-5 pt-3') &&
    guideSource.includes('mx-auto flex w-full max-w-[760px] items-center justify-start') &&
    guideSource.includes('flex min-w-0 items-center gap-3') &&
    guideSource.includes('border border-white/[0.14] bg-white/[0.05]') &&
    guideSource.includes('text-[9px] font-medium uppercase tracking-[0]') &&
    guideSource.includes('tracking-[0] text-[#f4f4f5]') &&
    !guideSource.includes("t('onboarding.scenario.memberDetailsHint')") &&
    guideSource.includes('mt-0.5 line-clamp-2 pr-1 text-[11px] leading-[1.38]') &&
    !guideSource.includes('[ ↳ Details in next step ]') &&
    guideSource.includes('tracking-[0.12em] text-[#7d8aa3]') &&
    guideSource.includes('rounded-[8px]') &&
    !guideSource.includes('selected && <Check') &&
    !guideSource.includes('text-[44px]') &&
    !guideSource.includes('rounded-full border border-white/10 bg-white/[0.06]'),
  guideSource,
);

check(
  'scenario next button owns the hover motion treatment',
  guideSource.includes("stepKey === 'scenario' &&") &&
    guideSource.includes('transition-[background-color,box-shadow,transform] duration-200') &&
    guideSource.includes('hover:-translate-y-[2px] hover:scale-[1.02]') &&
    guideSource.includes('active:translate-y-[1px] active:scale-[0.98]') &&
    guideSource.includes('hover:shadow-[0_12px_30px_rgba(255,255,255,0.18)]') &&
    !guideSource.includes('hover:scale-[1.006]') &&
    !guideSource.includes('hover:shadow-[0_12px_30px_rgba(0,0,0,0.32)]') &&
    !guideSource.includes('hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)'),
  guideSource,
);

check(
  'scenario page applies final contrast spacing footer and slide transition polish',
  guideSource.includes('focus-visible:ring-1 focus-visible:ring-white/[0.35]') &&
    guideSource.includes('grid grid-cols-[28px_minmax(0,1fr)]') &&
    guideSource.includes('rounded-[7px] transition-colors') &&
    guideSource.includes(": 'text-[#8a8f98] group-hover:text-[#c9cdd6]'") &&
    guideSource.includes('text-white/40 group-hover:text-[#8a8f98]') &&
    guideSource.includes('border-0 bg-[rgba(0,0,0,0.05)]') &&
    guideSource.includes('bg-[rgba(0,0,0,0.05)]') &&
    guideSource.includes('text-black/40 shadow-none') &&
    guideSource.includes('text-[rgba(255,255,255,0.35)]') &&
    guideSource.includes('flex min-h-10 w-full max-w-5xl flex-col items-center') &&
    guideSource.includes('flex min-h-10 items-center justify-center') &&
    guideSource.includes('renderedConfigurationStepKey') &&
    guideSource.includes("configurationMotionState === 'slide-out'") &&
    guideSource.includes('-translate-x-8 opacity-0') &&
    guideSource.includes('transition-[opacity,transform] duration-[180ms]'),
  guideSource,
);

check(
  'configuration footer keeps left actions visually stable while saving',
  guideSource.includes('aria-disabled={saving}') &&
    guideSource.includes('if (saving) return;') &&
    guideSource.includes('aria-disabled={saving || activeStepIndex === 0}') &&
    !guideSource.includes('\n                disabled={saving || activeStepIndex === 0}'),
  guideSource,
);

check(
  'scenario cards support arrow-key selection',
  guideSource.includes("['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']") &&
    guideSource.includes("activeStepKey === 'scenario'") &&
    guideSource.includes("window.matchMedia?.('(min-width: 768px)').matches") &&
    guideSource.includes('handleScenarioSelect(scenarios[nextIndex].key)') &&
    guideSource.includes('event.preventDefault()'),
  guideSource,
);

check(
  'zh scenario copy matches the requested first-step wording',
  read('../../locales/zh/common.json').includes(
    '"onboarding.scenario.title": "你正在构建什么？"',
  ) &&
    read('../../locales/zh/common.json').includes(
      '"onboarding.scenario.other.title": "其他"',
    ),
  guideSource,
);

check(
  'project names are sanitized before onboarding project creation',
  guideSource.includes("import { sanitizeProjectName }") &&
    guideSource.includes("sanitizeProjectName('MyProject')") &&
    guideSource.includes('const name = sanitizeProjectName(projectName)') &&
    guideSource.includes('setProjectName(sanitizeProjectName(event.target.value))'),
  guideSource,
);

check(
  'final action creates a real project, completes onboarding, then creates a default session',
  guideSource.indexOf('await onCreateProjectFromOnboarding') <
    guideSource.indexOf('await onboardingApi.complete') &&
  guideSource.includes('await onboardingApi.complete') &&
    guideSource.includes('path: projectDraft.path') &&
    guideSource.includes('created_project_id: createdProject.projectId') &&
    guideSource.includes('await onComplete(state, {') &&
    guideSource.includes('createDefaultSession: true') &&
    appSource.includes('onCreateProjectFromOnboarding={handleCreateOnboardingProject}') &&
    appSource.includes('return { projectId: project.id, sessionId: null }') &&
    appSource.includes('handleOnboardingCompleted') &&
    appSource.includes('setIsCreateSessionModalOpen(false)') &&
    appSource.includes('await handleCreateDefaultSession({') &&
    appSource.includes('startOnboardingAppTransition()') &&
    read('../../locales/zh/common.json').includes(
      '"onboarding.action.startNow": "创建会话"',
    ),
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
  'onboarding state changes do not feed saved progress back into the mounted guide',
  appSource.includes('const handleOnboardingStateChange = (nextState: OnboardingState) => {') &&
    appSource.includes('setOnboardingState(nextState);') &&
    !appSource.includes('current ? { ...current, state: nextState } : current'),
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
