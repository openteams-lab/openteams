import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Bot,
  Check,
  ChevronUp,
  FileText,
  Folder,
  Home,
  Info,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { DropdownSelect, type DropdownSelectOption } from '@/components/DropdownSelect';
import { cn } from '@/lib/utils';
import {
  agentRuntimeApi,
  chatSessionsApi,
  filesystemApi,
  onboardingApi,
} from '@/lib/api';
import { recommendOnboardingTeamTemplate } from '@/lib/onboardingTemplateRecommendations';
import { sanitizeProjectName } from '@/lib/projectName';
import { buildTemplateMemberSpecs } from '@/lib/teamTemplateRuntime';
import {
  getRunnerLabel,
  getRuntimeDisplayState,
} from '@/pages/agent-runtime/agentRuntimeViewModel';
import type {
  AgentRuntimeStatus,
  DirectoryEntry,
  Locale,
  Theme,
  ValidateWorkspacePathResponse,
} from '@/types';
import {
  OnboardingAppearance,
  OnboardingLanguage,
  OnboardingScenario,
  OnboardingStep,
  type ChatTeamPreset,
  type OnboardingState,
  type OnboardingTeamMemberConfig,
  type UpdateOnboardingStateRequest,
} from '../../../../shared/types';

const welcomeStepKey = 'welcome';
const onboardingSteps = ['scenario', 'executor', 'project_path', 'appearance'] as const;
const gitignoreTemplates = ['node', 'go', 'python', 'none'] as const;

type OnboardingStepKey = (typeof onboardingSteps)[number];
type ActiveStepKey = OnboardingStepKey | typeof welcomeStepKey;
type OnboardingMode = 'onboarding' | 'upgrade';
type GitignoreTemplate = (typeof gitignoreTemplates)[number];
type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

interface OnboardingGuideProps {
  mode: 'onboarding' | 'upgrade';
  initialState: OnboardingState | null;
  currentVersion: string;
  locale: Locale;
  theme: Theme;
  t: TranslateFn;
  teamPresets: ChatTeamPreset[];
  onCreateProjectFromOnboarding: (input: {
    name: string;
    path: string;
    teamId: string | null;
  }) => Promise<{ projectId: string; sessionId: string | null }>;
  onPreviewLocaleChange: (locale: Locale) => void;
  onPreviewAppearanceChange: (appearance: OnboardingAppearance) => void;
  onClose: () => void;
  onOpenCreateSession: (state: OnboardingState) => void;
  onStateChange?: (state: OnboardingState) => void;
  onUpgradeRead: (state: OnboardingState) => void;
}

const onboardingDarkThemeVars = {
  '--canvas': '#010102',
  '--surface-1': '#0f1011',
  '--surface-2': '#141516',
  '--surface-3': '#18191a',
  '--surface-4': '#191a1b',
  '--hairline': '#23252a',
  '--hairline-strong': '#34343a',
  '--hairline-tertiary': '#3e3e44',
  '--ink': '#f4f7fb',
  '--ink-muted': '#c5ceda',
  '--ink-subtle': '#8f9aaa',
  '--ink-tertiary': '#667083',
  '--primary': '#5e6ad2',
  '--primary-hover': '#828fff',
  '--on-primary': '#ffffff',
  '--primary-tint': 'rgba(94, 106, 210, 0.12)',
} as CSSProperties;

const onboardingMonoFont = {
  fontFamily:
    '"JetBrains Mono", "SF Mono", "SFMono-Regular", ui-monospace, "Cascadia Code", monospace',
} as CSSProperties;

const onboardingNoiseTextureStyle = {
  backgroundImage:
    'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27128%27 height=%27128%27 viewBox=%270 0 128 128%27%3E%3Cfilter id=%27noise%27 x=%270%27 y=%270%27 width=%27100%25%27 height=%27100%25%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.82%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27128%27 height=%27128%27 filter=%27url(%23noise)%27 opacity=%270.68%27/%3E%3C/svg%3E")',
} as CSSProperties;

type ScenarioDefinition = {
  key: OnboardingScenario;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  teamKey: string;
  teamFallback: string;
  members: OnboardingTeamMemberConfig[];
};

const scenarioDefinitions: ScenarioDefinition[] = [
  {
    key: OnboardingScenario.software,
    titleKey: 'onboarding.scenario.software.title',
    titleFallback: 'Software product',
    descKey: 'onboarding.scenario.software.desc',
    descFallback: 'Plan, build, review, and ship product code.',
    teamKey: 'onboarding.scenario.software.team',
    teamFallback: 'Software delivery team',
    members: [
      { member: 'Lead Agent', runner_type: 'codex', model_name: 'gpt-5' },
      { member: 'Frontend Engineer', runner_type: 'claude_code', model_name: 'claude-sonnet' },
      { member: 'Backend Engineer', runner_type: 'openteams_cli', model_name: 'gpt-5' },
      { member: 'QA Reviewer', runner_type: 'gemini', model_name: 'gemini-2.5-pro' },
    ],
  },
  {
    key: OnboardingScenario.design,
    titleKey: 'onboarding.scenario.design.title',
    titleFallback: 'Design implementation',
    descKey: 'onboarding.scenario.design.desc',
    descFallback: 'Turn product screens into polished frontend work.',
    teamKey: 'onboarding.scenario.design.team',
    teamFallback: 'Design implementation team',
    members: [
      { member: 'UX Lead', runner_type: 'claude_code', model_name: 'claude-sonnet' },
      { member: 'Visual Reviewer', runner_type: 'gemini', model_name: 'gemini-2.5-pro' },
      { member: 'Frontend Implementer', runner_type: 'codex', model_name: 'gpt-5' },
    ],
  },
  {
    key: OnboardingScenario.research,
    titleKey: 'onboarding.scenario.research.title',
    titleFallback: 'Research and analysis',
    descKey: 'onboarding.scenario.research.desc',
    descFallback: 'Collect context, compare options, and write decisions.',
    teamKey: 'onboarding.scenario.research.team',
    teamFallback: 'Research analysis team',
    members: [
      { member: 'Research Lead', runner_type: 'gemini', model_name: 'gemini-2.5-pro' },
      { member: 'Analyst', runner_type: 'claude_code', model_name: 'claude-sonnet' },
      { member: 'Report Writer', runner_type: 'openteams_cli', model_name: 'gpt-5' },
    ],
  },
  {
    key: OnboardingScenario.other,
    titleKey: 'onboarding.scenario.other.title',
    titleFallback: 'General collaboration',
    descKey: 'onboarding.scenario.other.desc',
    descFallback: 'Start with a flexible team and adapt later.',
    teamKey: 'onboarding.scenario.other.team',
    teamFallback: 'General collaboration team',
    members: [
      { member: 'General Lead', runner_type: 'openteams_cli', model_name: 'gpt-5' },
      { member: 'Executor', runner_type: 'codex', model_name: 'gpt-5' },
    ],
  },
];

const fallbackRunnerOptions: DropdownSelectOption[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'openteams_cli', label: 'OpenTeams CLI' },
  { id: 'qwen_code', label: 'Qwen Code' },
  { id: 'opencode', label: 'OpenCode' },
];

const stepToBackend: Record<OnboardingStepKey, OnboardingStep> = {
  scenario: OnboardingStep.scenario,
  executor: OnboardingStep.executor,
  project_path: OnboardingStep.project_path,
  appearance: OnboardingStep.appearance,
};
const stepI18nKeys: Record<OnboardingStepKey, string> = {
  scenario: 'scenario',
  executor: 'executor',
  project_path: 'projectPath',
  appearance: 'appearance',
};

const stepFromBackend = (
  value: OnboardingState['current_step'] | null | undefined,
): OnboardingStepKey => {
  return onboardingSteps.includes(value as OnboardingStepKey)
    ? (value as OnboardingStepKey)
    : 'scenario';
};

const scenarioFromState = (
  value: OnboardingState['selected_scenario'] | null | undefined,
) =>
  scenarioDefinitions.some((scenario) => scenario.key === value)
    ? (value as OnboardingScenario)
    : OnboardingScenario.software;

const localeToOnboardingLanguage: Record<Locale, OnboardingLanguage> = {
  en: OnboardingLanguage.en,
  zh: OnboardingLanguage.zh_hans,
  ja: OnboardingLanguage.ja,
  ko: OnboardingLanguage.ko,
  fr: OnboardingLanguage.fr,
  es: OnboardingLanguage.es,
};

const onboardingLanguageToLocale = (
  language: OnboardingLanguage | null | undefined,
  fallback: Locale,
): Locale => {
  switch (language) {
    case OnboardingLanguage.en:
      return 'en';
    case OnboardingLanguage.fr:
      return 'fr';
    case OnboardingLanguage.ja:
      return 'ja';
    case OnboardingLanguage.ko:
      return 'ko';
    case OnboardingLanguage.es:
      return 'es';
    case OnboardingLanguage.zh_hans:
    case OnboardingLanguage.zh_hant:
      return 'zh';
    default:
      return fallback;
  }
};

const directoryEntryTime = (entry: DirectoryEntry): number =>
  typeof entry.last_modified === 'number' ? entry.last_modified : 0;

const getParentPath = (path: string): string => {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return '';

  const slash = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (slash < 0) return '';
  if (slash === 0) return '/';
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, slash))) {
    return `${trimmed.slice(0, slash)}\\`;
  }
  return trimmed.slice(0, slash);
};

const compareVersions = (left: string | null | undefined, right: string) => {
  const leftParts = String(left ?? '')
    .replace(/^v/u, '')
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right
    .replace(/^v/u, '')
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

function useTranslatedScenario(t: TranslateFn, selectedScenario: OnboardingScenario) {
  const scenarios = useMemo(
    () =>
      scenarioDefinitions.map((scenario) => ({
        ...scenario,
        title: t(scenario.titleKey) || scenario.titleFallback,
        desc: t(scenario.descKey) || scenario.descFallback,
        teamName: t(scenario.teamKey) || scenario.teamFallback,
      })),
    [t],
  );
  const currentScenario =
    scenarios.find((scenario) => scenario.key === selectedScenario) ??
    scenarios[0];

  return { scenarios, currentScenario };
}

const teamPresetToOnboardingConfig = (
  teamPreset: ChatTeamPreset | null,
  runtimes: AgentRuntimeStatus[],
): OnboardingTeamMemberConfig[] => {
  if (!teamPreset) return [];
  const resolvedMembers = buildTemplateMemberSpecs(teamPreset, null, runtimes);
  if (resolvedMembers.length > 0) {
    return resolvedMembers.map((member) => ({
      member: member.name,
      runner_type: member.runnerType,
      model_name: member.modelName ?? undefined,
    }));
  }

  return teamPreset.members
    .filter((member) => member.enabled !== false)
    .map((member) => ({
      member: member.name,
      runner_type: member.runner_type?.trim() || undefined,
      model_name: member.recommended_model?.trim() || undefined,
    }));
};

export { compareVersions };

export function OnboardingGuide({
  mode,
  initialState,
  currentVersion,
  locale,
  theme,
  t,
  teamPresets,
  onCreateProjectFromOnboarding,
  onPreviewLocaleChange,
  onPreviewAppearanceChange,
  onClose,
  onOpenCreateSession,
  onStateChange,
  onUpgradeRead,
}: OnboardingGuideProps) {
  const initialStep = initialState?.welcome_seen_at
    ? stepFromBackend(initialState.current_step)
    : welcomeStepKey;
  const [state, setState] = useState<OnboardingState | null>(initialState);
  const [activeStepKey, setActiveStepKey] = useState<ActiveStepKey>(initialStep);
  const [selectedScenario, setSelectedScenario] = useState<OnboardingScenario>(
    scenarioFromState(initialState?.selected_scenario),
  );
  const [teamConfig, setTeamConfig] = useState<OnboardingTeamMemberConfig[]>(
    initialState?.team_config?.length
      ? initialState.team_config
      : scenarioDefinitions[0].members,
  );
  const [projectName, setProjectName] = useState(initialState?.project_name ?? '');
  const [projectNameTouched, setProjectNameTouched] = useState(
    Boolean(initialState?.project_name?.trim()),
  );
  const [projectPath, setProjectPath] = useState(initialState?.project_path ?? '');
  const [projectStatus, setProjectStatus] =
    useState<ValidateWorkspacePathResponse | null>(
      initialState?.project_path
        ? {
            valid: true,
            is_git_repo: initialState.project_path_is_git,
            error: null,
          }
        : null,
    );
  const [initializeGit, setInitializeGit] = useState(true);
  const [gitignoreTemplate, setGitignoreTemplate] =
    useState<GitignoreTemplate>('node');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(
    onboardingLanguageToLocale(initialState?.language, locale),
  );
  const [selectedAppearance, setSelectedAppearance] =
    useState<OnboardingAppearance>(
      initialState?.appearance ??
        (theme === 'light' ? OnboardingAppearance.light : OnboardingAppearance.dark),
    );
  const [runtimes, setRuntimes] = useState<AgentRuntimeStatus[]>([]);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [pathLoading, setPathLoading] = useState(false);
  const [pathDetecting, setPathDetecting] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWelcomeCommandId, setSelectedWelcomeCommandId] =
    useState('workflow_execution');
  const pathValidationRequestRef = useRef(0);

  const { scenarios, currentScenario } = useTranslatedScenario(
    t,
    selectedScenario,
  );
  const recommendedTeam = useMemo(
    () => recommendOnboardingTeamTemplate(selectedScenario, teamPresets),
    [selectedScenario, teamPresets],
  );
  const isWelcome = activeStepKey === welcomeStepKey;
  const activeStepIndex = isWelcome
    ? -1
    : onboardingSteps.indexOf(activeStepKey);
  const recommendedTeamName = recommendedTeam?.name ?? currentScenario.teamName;
  const recommendedTeamId = recommendedTeam?.id ?? null;
  const teamMembers = teamConfig;
  const welcomeCommandOptions = useMemo(
    () => [
      {
        id: 'local_workspace',
        label: '本地多Agent工作区',
        Icon: Folder,
        keyHint: 'L',
      },
      {
        id: 'workflow_execution',
        label: '工作流编排引擎',
        Icon: Zap,
        keyHint: 'W',
      },
      {
        id: 'agent_team',
        label: '智能体团队模板平台',
        Icon: Bot,
        keyHint: 'T',
      },
      {
        id: 'personal_project_management',
        label: '项目进度加速器',
        Icon: FileText,
        keyHint: 'P',
      },
    ],
    [],
  );
  const selectedWelcomeCommand =
    welcomeCommandOptions.find(
      (option) => option.id === selectedWelcomeCommandId,
    ) ?? welcomeCommandOptions[0];

  const runnerOptions = useMemo(() => {
    const availableRunners = runtimes
      .filter((runner) => getRuntimeDisplayState(runner) === 'available')
      .map((runner) => ({
        id: runner.runner_type,
        label: getRunnerLabel(runner.runner_type),
        description: runner.version ?? undefined,
      }));
    return availableRunners.length > 0 ? availableRunners : fallbackRunnerOptions;
  }, [runtimes]);

  useEffect(() => {
    if (!isWelcome) return;

    const handleWelcomeShortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      const key = event.key.toUpperCase();
      const command = welcomeCommandOptions.find(
        (option) => option.keyHint === key,
      );
      if (!command) return;
      event.preventDefault();
      setSelectedWelcomeCommandId(command.id);
    };

    window.addEventListener('keydown', handleWelcomeShortcut);
    return () => {
      window.removeEventListener('keydown', handleWelcomeShortcut);
    };
  }, [isWelcome, welcomeCommandOptions]);

  const modelOptionsForRunner = (runnerType?: string): DropdownSelectOption[] => {
    const runtime = runtimes.find((candidate) => candidate.runner_type === runnerType);
    const discoveredModels = runtime?.discovered_models ?? [];
    const configuredModel =
      runtime?.executor_options &&
      typeof runtime.executor_options === 'object' &&
      !Array.isArray(runtime.executor_options) &&
      typeof runtime.executor_options.model === 'string'
        ? runtime.executor_options.model
        : '';
    const models = Array.from(
      new Set([configuredModel, ...discoveredModels].filter(Boolean)),
    );
    if (models.length === 0) {
      return [
        { id: 'gpt-5', label: 'gpt-5' },
        { id: 'claude-sonnet', label: 'claude-sonnet' },
        { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
      ];
    }
    return models.map((model) => ({
      id: model,
      label: model,
      description: t('onboarding.executor.discoveredModel'),
    }));
  };

  const projectNameForScenario = useCallback(
    (scenarioKey: OnboardingScenario) => {
      const scenario =
        scenarios.find((candidate) => candidate.key === scenarioKey) ??
        currentScenario;
      return sanitizeProjectName(`${scenario.title} workspace`);
    },
    [currentScenario, scenarios],
  );

  const buildTeamConfigForScenario = useCallback(
    (
      scenarioKey: OnboardingScenario,
      runtimeOptions: AgentRuntimeStatus[] = runtimes,
    ) => {
      const teamPreset = recommendOnboardingTeamTemplate(
        scenarioKey,
        teamPresets,
      );
      const templateConfig = teamPresetToOnboardingConfig(
        teamPreset,
        runtimeOptions,
      );
      if (templateConfig.length > 0) return templateConfig;

      return (
        scenarioDefinitions.find((scenario) => scenario.key === scenarioKey)
          ?.members ?? scenarioDefinitions[0].members
      );
    },
    [runtimes, teamPresets],
  );

  const initializeFromState = (nextInitialState: OnboardingState | null) => {
    setState(nextInitialState);
    setActiveStepKey(
      nextInitialState?.welcome_seen_at
        ? stepFromBackend(nextInitialState.current_step)
        : welcomeStepKey,
    );
    const nextScenario = scenarioFromState(nextInitialState?.selected_scenario);
    setSelectedScenario(nextScenario);
    setTeamConfig(
      nextInitialState?.team_config?.length
        ? nextInitialState.team_config
        : buildTeamConfigForScenario(nextScenario),
    );
    setProjectName((current) =>
      sanitizeProjectName(
        nextInitialState?.project_name ??
          (current.trim() ? current : projectNameForScenario(nextScenario)),
      ),
    );
    setProjectNameTouched((current) =>
      Boolean(nextInitialState?.project_name?.trim()) || current,
    );
    setProjectPath(nextInitialState?.project_path ?? '');
    setProjectStatus(
      nextInitialState?.project_path
        ? {
            valid: true,
            is_git_repo: nextInitialState.project_path_is_git,
            error: null,
          }
        : null,
    );
    setSelectedLocale(onboardingLanguageToLocale(nextInitialState?.language, locale));
    setSelectedAppearance(
      nextInitialState?.appearance ??
        (theme === 'light'
          ? OnboardingAppearance.light
          : OnboardingAppearance.dark),
    );
  };

  useEffect(() => {
    initializeFromState(initialState);
  }, [initialState]);

  useEffect(() => {
    if (mode !== 'onboarding') return;
    let cancelled = false;
    void agentRuntimeApi
      .list()
      .then((response) => {
        if (!cancelled) {
          setRuntimes(response.runners);
          if (!initialState?.team_config?.length) {
            const teamPreset = recommendOnboardingTeamTemplate(
              selectedScenario,
              teamPresets,
            );
            const templateConfig = teamPresetToOnboardingConfig(
              teamPreset,
              response.runners,
            );
            setTeamConfig(
              templateConfig.length > 0
                ? templateConfig
                : (scenarioDefinitions.find(
                    (scenario) => scenario.key === selectedScenario,
                  )?.members ?? scenarioDefinitions[0].members),
            );
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRuntimeError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialState?.team_config?.length, mode, selectedScenario, teamPresets]);

  useEffect(() => {
    if (mode !== 'onboarding' || activeStepKey !== 'project_path') return;
    if (entries.length > 0 || pathLoading) return;
    void loadRoots();
  }, [activeStepKey, entries.length, mode, pathLoading]);

  const applyState = (nextState: OnboardingState) => {
    setState(nextState);
    onStateChange?.(nextState);
  };

  const saveState = async (payload: UpdateOnboardingStateRequest) => {
    setSaving(true);
    setError(null);
    try {
      const nextState = await onboardingApi.updateState(payload);
      applyState(nextState);
      return nextState;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('onboarding.error.saveFailed');
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const currentPayload = (
    targetStep?: OnboardingStepKey,
  ): UpdateOnboardingStateRequest => ({
    current_step: targetStep ? stepToBackend[targetStep] : undefined,
    selected_scenario: selectedScenario,
    recommended_team_name: recommendedTeamName,
    team_config: teamConfig,
    project_path: projectPath.trim() || undefined,
    project_name: sanitizeProjectName(projectName) || undefined,
    created_project_id: state?.created_project_id ?? undefined,
    language: localeToOnboardingLanguage[selectedLocale],
    appearance: selectedAppearance,
  });

  const saveDraft = (payload: UpdateOnboardingStateRequest) => {
    void saveState({
      ...currentPayload(activeStepKey === welcomeStepKey ? undefined : activeStepKey),
      ...payload,
    }).catch(() => undefined);
  };

  const validateProjectDraft = async () => {
    const name = sanitizeProjectName(projectName);
    if (!name) {
      setError(t('onboarding.project.nameRequired'));
      return null;
    }
    setProjectName(name);

    const path = projectPath.trim();
    if (!path) {
      setError(t('onboarding.project.invalid'));
      return null;
    }

    const status = await validateProjectPath(path);
    if (!status?.valid) {
      setError(status?.error ?? t('onboarding.project.invalid'));
      return null;
    }

    return { name, path, status };
  };

  const handleFinish = async () => {
    const projectDraft = await validateProjectDraft();
    if (!projectDraft) return;

    setSaving(true);
    setError(null);
    try {
      if (!projectDraft.status.is_git_repo && initializeGit) {
        const initialized = await chatSessionsApi.initializeWorkspaceGit({
          workspace_path: projectDraft.path,
          gitignore_template:
            gitignoreTemplate === 'none' ? null : gitignoreTemplate,
        });
        setProjectStatus(initialized.status);
      }

      const createdProject = await onCreateProjectFromOnboarding({
        name: projectDraft.name,
        path: projectDraft.path,
        teamId: recommendedTeamId,
      });
      const state = await onboardingApi.complete({
        ...currentPayload('appearance'),
        project_name: projectDraft.name,
        project_path: projectDraft.path,
        created_project_id: createdProject.projectId,
      });
      applyState(state);
      onOpenCreateSession(state);
    } catch {
      setError(t('onboarding.project.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleWelcomeNext = async () => {
    await saveState({
      welcome_seen: true,
      current_step: OnboardingStep.scenario,
      selected_scenario: selectedScenario,
      recommended_team_name: recommendedTeamName,
    });
    setActiveStepKey('scenario');
  };

  const handleStepBack = () => {
    if (isWelcome) return;
    const previousIndex = Math.max(0, activeStepIndex - 1);
    setActiveStepKey(onboardingSteps[previousIndex]);
  };

  const handleStepNext = async () => {
    if (isWelcome) {
      await handleWelcomeNext();
      return;
    }

    if (activeStepKey === 'project_path') {
      const projectDraft = await validateProjectDraft();
      if (!projectDraft) return;
    }

    if (activeStepKey === 'appearance') {
      await handleFinish();
      return;
    }

    const nextStep = onboardingSteps[activeStepIndex + 1] ?? 'appearance';
    await saveState(currentPayload(nextStep));
    setActiveStepKey(nextStep);
  };

  const handleSkip = async () => {
    setSaving(true);
    setError(null);
    try {
      const state = await onboardingApi.complete(currentPayload('appearance'));
      applyState(state);
      onOpenCreateSession(state);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.error.completeFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleScenarioSelect = (scenarioKey: OnboardingScenario) => {
    const scenario =
      scenarioDefinitions.find((candidate) => candidate.key === scenarioKey) ??
      scenarioDefinitions[0];
    const teamPreset = recommendOnboardingTeamTemplate(scenarioKey, teamPresets);
    const templateConfig = teamPresetToOnboardingConfig(teamPreset, runtimes);
    const nextTeamConfig =
      templateConfig.length > 0 ? templateConfig : scenario.members;
    const nextTeamName =
      teamPreset?.name ??
      scenarios.find((candidate) => candidate.key === scenarioKey)?.teamName ??
      scenario.teamFallback;
    setSelectedScenario(scenarioKey);
    setTeamConfig(nextTeamConfig);
    if (!projectNameTouched) {
      setProjectName(projectNameForScenario(scenarioKey));
    }
    setState((current) =>
      current
        ? {
            ...current,
            selected_scenario: scenarioKey,
            recommended_team_name: nextTeamName,
            team_config: nextTeamConfig,
          }
        : current,
    );
  };

  const updateTeamMember = (
    index: number,
    patch: Partial<OnboardingTeamMemberConfig>,
  ) => {
    setTeamConfig((members) =>
      members.map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member,
      ),
    );
  };

  const handleLocaleSelect = (option: { id: Locale; label: string }) => {
    setSelectedLocale(option.id);
    onPreviewLocaleChange(option.id);
    saveDraft({ language: localeToOnboardingLanguage[option.id] });
  };

  const handleAppearanceSelect = (option: { id: OnboardingAppearance }) => {
    setSelectedAppearance(option.id);
    onPreviewAppearanceChange(option.id);
    saveDraft({ appearance: option.id });
  };

  const loadDirectory = async (path?: string) => {
    setPathLoading(true);
    setPathError(null);
    try {
      const response = await filesystemApi.listDirectory(path?.trim() || undefined);
      const sortedEntries = [...response.entries].sort((a, b) => {
        if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sortedEntries);
      setCurrentPath(response.current_path);
      setProjectPath(response.current_path);
      setProjectStatus(null);
    } catch (err) {
      setPathError(
        err instanceof Error ? err.message : t('onboarding.project.readFailed'),
      );
    } finally {
      setPathLoading(false);
    }
  };

  const loadRoots = async () => {
    setPathLoading(true);
    setPathError(null);
    try {
      const roots = await filesystemApi.listRoots();
      setEntries(roots);
      setCurrentPath('');
    } catch (err) {
      setPathError(
        err instanceof Error ? err.message : t('onboarding.project.rootsFailed'),
      );
    } finally {
      setPathLoading(false);
    }
  };

  const validateProjectPath = useCallback(async (path: string) => {
    const trimmed = path.trim();
    const requestId = pathValidationRequestRef.current + 1;
    pathValidationRequestRef.current = requestId;
    if (!trimmed) {
      setProjectStatus(null);
      setPathDetecting(false);
      return null;
    }
    setPathDetecting(true);
    setPathError(null);
    try {
      const status = await chatSessionsApi.validateWorkspacePath(trimmed);
      if (pathValidationRequestRef.current !== requestId) return status;
      setProjectStatus(status);
      if (!status.valid) {
        setPathError(status.error ?? t('onboarding.project.invalid'));
      }
      return status;
    } catch (err) {
      if (pathValidationRequestRef.current === requestId) {
        setProjectStatus(null);
        setPathError(
          err instanceof Error ? err.message : t('onboarding.project.invalid'),
        );
      }
      throw err;
    } finally {
      if (pathValidationRequestRef.current === requestId) {
        setPathDetecting(false);
      }
    }
  }, [t]);

  useEffect(() => {
    if (mode !== 'onboarding' || activeStepKey !== 'project_path') return;
    const trimmed = projectPath.trim();
    if (!trimmed) {
      pathValidationRequestRef.current += 1;
      setProjectStatus(null);
      setPathDetecting(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      void validateProjectPath(trimmed).catch(() => undefined);
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [activeStepKey, mode, projectPath, validateProjectPath]);

  const handleMarkUpgradeRead = async () => {
    setSaving(true);
    setError(null);
    try {
      const state = await onboardingApi.markUpgradeRead({ version: currentVersion });
      applyState(state);
      onUpgradeRead(state);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.error.upgradeReadFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const renderUpgradeGuide = () => (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)]">
      <div className="flex min-h-12 items-center justify-between border-b border-[var(--hairline)] px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--primary)]" />
          <span className="truncate text-[13px] font-semibold text-[var(--ink)]">
            {t('onboarding.upgrade.eyebrow', { version: currentVersion })}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-3)] px-[14px] py-2 text-[12px] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
        >
          {t('onboarding.upgrade.later')}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-6">
            <h1 className="font-sans text-[22px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {t('onboarding.upgrade.title')}
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--ink-muted)]">
              {t('onboarding.upgrade.desc')}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                title: t('onboarding.upgrade.featureGuide.title'),
                desc: t('onboarding.upgrade.featureGuide.desc'),
                Icon: Rocket,
              },
              {
                title: t('onboarding.upgrade.featureTeam.title'),
                desc: t('onboarding.upgrade.featureTeam.desc'),
                Icon: Users,
              },
              {
                title: t('onboarding.upgrade.featureComposer.title'),
                desc: t('onboarding.upgrade.featureComposer.desc'),
                Icon: Bot,
              },
            ].map(({ title, desc, Icon }) => (
              <div
                key={title}
                className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-6"
              >
                <Icon className="h-4 w-4 text-[var(--primary)]" />
                <h2 className="mt-3 text-[13px] font-semibold text-[var(--ink)]">
                  {title}
                </h2>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-muted)]">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
        <aside className="rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] p-6">
          <h2 className="text-[13px] font-semibold text-[var(--ink)]">
            {t('onboarding.upgrade.stateTitle')}
          </h2>
          <div className="mt-3 divide-y divide-[var(--hairline)] rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-1)] text-[12px]">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[var(--ink-subtle)]">current_version</span>
              <span className="font-mono text-[var(--ink)]">{currentVersion}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[var(--ink-subtle)]">
                last_seen_upgrade_version
              </span>
              <span className="truncate font-mono text-[var(--ink)]">
                {state?.last_seen_upgrade_version ?? 'null'}
              </span>
            </div>
          </div>
          {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
          <button
            type="button"
            onClick={() => void handleMarkUpgradeRead()}
            disabled={saving}
            className="mt-4 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#5e6ad2] px-[14px] py-2 text-[13px] font-semibold text-[#f4f7fb] transition hover:bg-[#6f7ae6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            {t('onboarding.upgrade.markRead')}
          </button>
        </aside>
      </div>
    </section>
  );

  const renderExecutorStep = () => (
    <div className="min-h-[420px] border-y border-[#222]">
      {runtimeError && (
        <p className="border-b border-yellow-500/25 px-0 py-3 font-mono text-[12px] text-yellow-200">
          {runtimeError}
        </p>
      )}
      <div className="divide-y divide-[#222]">
        {teamMembers.map((member, index) => {
          const runnerValue = member.runner_type || runnerOptions[0]?.id || '';
          const modelOptions = modelOptionsForRunner(runnerValue);
          const modelValue = member.model_name || modelOptions[0]?.id || '';
          return (
            <div
              key={`${member.member}-${index}`}
              className="grid gap-3 py-4 md:grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_minmax(160px,220px)] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#222] font-mono text-[11px] font-semibold text-[#8f9aaa]">
                  {member.member.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate text-[13px] font-semibold text-[#f4f7fb]">
                  {member.member}
                </span>
              </div>
              <DropdownSelect
                value={runnerValue}
                options={runnerOptions}
                showSearch={false}
                placeholder={t('onboarding.executor.runnerPlaceholder')}
                onChange={(value) =>
                  updateTeamMember(index, {
                    runner_type: value,
                    model_name: modelOptionsForRunner(value)[0]?.id,
                  })
                }
                maxPanelHeightClassName="max-h-[190px]"
              />
              <DropdownSelect
                value={modelValue}
                options={modelOptions}
                placeholder={t('onboarding.executor.modelPlaceholder')}
                onChange={(value) => updateTeamMember(index, { model_name: value })}
                maxPanelHeightClassName="max-h-[190px]"
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderScenarioStep = () => (
    <div className="flex min-h-[420px] flex-col justify-center border-y border-[#222] py-6">
      <section className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
        {scenarios.map((scenario) => {
          const selected = scenario.key === selectedScenario;
          return (
            <button
              key={scenario.key}
              type="button"
              onClick={() => handleScenarioSelect(scenario.key)}
              className={cn(
                'min-h-[112px] cursor-pointer rounded-[8px] border p-4 text-left transition',
                selected
                  ? 'border-white/35 bg-[#121216] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-white/45'
                  : 'border-white/[0.08] bg-[#111111] hover:border-white/20',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  className={cn(
                    'truncate text-[13px] font-semibold tracking-[0.02em]',
                    selected ? 'text-[#f4f7fb]' : 'text-[#8f9aaa]',
                  )}
                >
                  {scenario.title}
                </h3>
              </div>
              <p
                className={cn(
                  'mt-2 text-[12px] leading-relaxed',
                  selected ? 'text-[#a8b3c2]' : 'text-[#768295]',
                )}
              >
                {scenario.desc}
              </p>
            </button>
          );
        })}
      </section>
      <aside className="mx-auto mt-5 flex max-w-4xl items-center justify-between gap-4 rounded-[8px] border border-white/[0.08] bg-white/[0.035] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-3 w-3 shrink-0 text-[#8f9aaa]" strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="font-mono text-[12px] font-semibold text-[#f4f7fb]">
              {recommendedTeamName}
            </p>
          </div>
        </div>
        <p className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-[#667083]">
          <span>Details in next step</span>
          <span aria-hidden="true" className="text-[12px] text-[#768295]">
            ↵
          </span>
        </p>
      </aside>
    </div>
  );

  const renderProjectPathStep = () => (
    <div className="grid min-h-[420px] border-y border-[#222] lg:grid-cols-[minmax(0,65%)_minmax(280px,35%)]">
      <section className="space-y-7 py-6 lg:border-r lg:border-[#222] lg:pr-8">
        <label className="block min-w-0 text-[12px] font-medium text-[#768295]">
          {t('onboarding.project.nameTitle')}
          <input
            value={projectName}
            onChange={(event) => {
              setProjectName(sanitizeProjectName(event.target.value));
              setProjectNameTouched(true);
            }}
            className="mt-2 h-10 w-full border-0 border-b border-[#222] bg-transparent px-0 font-mono text-[18px] font-semibold text-[#f4f7fb] outline-none transition placeholder:text-[#5b6678] focus:border-[#4b5568]"
            placeholder={t('onboarding.project.namePlaceholder')}
          />
        </label>

        <section>
          <div className="flex items-center gap-2 border-b border-[#222] pb-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] tracking-[0.05em] text-[#8f9aaa]">
              {currentPath || t('onboarding.project.localRoots')}
            </span>
            <button
              type="button"
              onClick={() => void loadRoots()}
              className="flex h-7 w-7 items-center justify-center text-[#768295] transition hover:text-[#f4f7fb]"
              aria-label={t('onboarding.project.roots')}
              title={t('onboarding.project.roots')}
            >
              <Home className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!currentPath}
              onClick={() => {
                const parent = getParentPath(currentPath);
                if (parent) void loadDirectory(parent);
              }}
              className="flex h-7 w-7 items-center justify-center text-[#768295] transition hover:text-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={t('onboarding.project.up')}
              title={t('onboarding.project.up')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void loadDirectory(projectPath)}
              className="flex h-7 w-7 items-center justify-center text-[#768295] transition hover:text-[#f4f7fb]"
              aria-label={t('onboarding.project.refresh')}
              title={t('onboarding.project.refresh')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="h-[286px] overflow-y-auto py-2">
            {pathLoading ? (
              <div className="py-2 font-mono text-[12px] text-[#768295]">
                {t('onboarding.project.loading')}
              </div>
            ) : entries.length === 0 ? (
              <div className="py-2 font-mono text-[12px] text-[#768295]">
                {t('onboarding.project.empty')}
              </div>
            ) : (
              entries.map((entry) => {
                const Icon = entry.is_directory ? Folder : FileText;
                const selected = entry.path === projectPath.trim();
                return (
                  <div
                    key={`${entry.path}-${directoryEntryTime(entry)}`}
                    className={cn(
                      'group/path-entry flex items-center border-b border-transparent',
                      selected && 'border-[#222]',
                    )}
                  >
                    <button
                      type="button"
                      disabled={!entry.is_directory}
                      onClick={() => {
                        if (entry.is_directory) void loadDirectory(entry.path);
                      }}
                      className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left font-mono text-[12px] tracking-[0.05em] text-[#8f9aaa] transition hover:text-[#f4f7fb] disabled:cursor-default disabled:opacity-55"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[#768295]" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.is_git_repo && (
                        <span className="font-mono text-[10px] text-emerald-400/80">
                          git
                        </span>
                      )}
                    </button>
                    {entry.is_directory && (
                      <button
                        type="button"
                        onClick={() => {
                          setProjectPath(entry.path);
                          void validateProjectPath(entry.path);
                        }}
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center text-[#768295] opacity-0 transition hover:text-[#f4f7fb] group-hover/path-entry:opacity-100',
                          selected && '!opacity-100',
                        )}
                        aria-label={t('onboarding.project.select')}
                        title={t('onboarding.project.select')}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </section>

      <aside className="py-6 lg:pl-8">
        <div className="space-y-5">
          <label className="block text-[12px] font-medium text-[#768295]">
            {t('onboarding.project.selectedPath')}
            <input
              value={projectPath}
              onChange={(event) => {
                setProjectPath(event.target.value);
                setProjectStatus(null);
              }}
              className="mt-2 h-8 w-full truncate border-0 border-b border-[#222] bg-transparent px-0 font-mono text-[12px] tracking-[0.05em] text-[#8f9aaa] outline-none transition placeholder:text-[#5b6678] focus:border-[#4b5568]"
              placeholder={t('onboarding.project.pathPlaceholder')}
            />
          </label>

          <button
            type="button"
            onClick={() => void validateProjectPath(projectPath)}
            disabled={!projectPath.trim() || pathLoading || pathDetecting}
            className="font-mono text-[11px] tracking-[0.05em] text-[#768295] transition hover:text-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('onboarding.project.validate')}
          </button>

          {!projectPath.trim() && (
            <p className="font-mono text-[12px] leading-relaxed tracking-[0.05em] text-[#768295]">
              {t('onboarding.project.pathPrompt')}
            </p>
          )}

          {projectPath.trim() && pathDetecting && (
            <p className="font-mono text-[12px] tracking-[0.05em] text-[#768295]">
              {t('onboarding.project.detecting')}
            </p>
          )}

          {projectPath.trim() &&
            !pathDetecting &&
            projectStatus?.valid &&
            projectStatus.is_git_repo && (
            <p className="flex items-center gap-2 font-mono text-[12px] tracking-[0.05em] text-emerald-400/80">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t('onboarding.project.gitDetected')}
            </p>
          )}

          {projectPath.trim() &&
            !pathDetecting &&
            projectStatus?.valid &&
            !projectStatus.is_git_repo && (
            <div className="grid grid-rows-[1fr] border-t border-[#222] pt-4 transition-[grid-template-rows] duration-200">
              <div className="space-y-4 overflow-hidden">
                <p className="flex items-start gap-2 font-mono text-[12px] leading-relaxed tracking-[0.05em] text-[#8f9aaa]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#768295]" />
                  <span>{t('onboarding.project.gitMissing')}</span>
                </p>
                <label className="flex cursor-pointer items-center gap-2 font-mono text-[12px] tracking-[0.05em] text-[#c9d2df]">
                  <input
                    type="checkbox"
                    checked={initializeGit}
                    onChange={(event) => setInitializeGit(event.target.checked)}
                    className="h-3.5 w-3.5 accent-white"
                  />
                  {t('onboarding.project.initializeGit')}
                </label>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200',
                    initializeGit ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                  )}
                >
                  <label className="block overflow-hidden font-mono text-[12px] tracking-[0.05em] text-[#768295]">
                    {t('onboarding.project.gitignoreTemplate')}
                    <select
                      value={gitignoreTemplate}
                      onChange={(event) =>
                        setGitignoreTemplate(event.target.value as GitignoreTemplate)
                      }
                      className="mt-2 h-8 w-full rounded-[4px] border border-[#333] bg-black px-2 font-mono text-[12px] text-[#c9d2df] outline-none focus:border-[#555]"
                    >
                      {gitignoreTemplates.map((template) => (
                        <option key={template} value={template}>
                          {t(`onboarding.project.gitignore.${template}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          )}

          {(pathError || error) && (
            <p className="font-mono text-[12px] leading-relaxed tracking-[0.05em] text-red-400">
              {pathError || error}
            </p>
          )}
        </div>
      </aside>
    </div>
  );

  const renderAppearanceStep = () => {
    const languageOptions: Array<{ id: Locale; label: string }> = [
      { id: 'zh', label: t('language.zh') },
      { id: 'en', label: t('language.en') },
      { id: 'ja', label: t('language.ja') },
      { id: 'ko', label: t('language.ko') },
      { id: 'fr', label: t('language.fr') },
      { id: 'es', label: t('language.es') },
    ];
    const appearanceOptions = [
      {
        id: OnboardingAppearance.dark,
        label: t('onboarding.appearance.dark'),
      },
      {
        id: OnboardingAppearance.light,
        label: t('onboarding.appearance.light'),
      },
      {
        id: OnboardingAppearance.system,
        label: t('onboarding.appearance.system'),
      },
    ];

    return (
      <div className="grid min-h-[420px] border-y border-[#222] lg:grid-cols-2">
        <section className="space-y-4 py-6 lg:border-r lg:border-[#222] lg:pr-8">
          <h3 className="font-mono text-[12px] font-medium tracking-[0.05em] text-[#768295]">
            {t('onboarding.appearance.languageTitle')}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {languageOptions.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border px-3 py-2 text-[13px] transition',
                  selectedLocale === option.id
                    ? 'border-white/35 bg-white/[0.05] text-[#f4f7fb]'
                    : 'border-[#222] bg-transparent text-[#8f9aaa] hover:border-[#4b5568] hover:text-[#f4f7fb]',
                )}
              >
                <input
                  type="radio"
                  name="onboarding-language"
                  value={option.id}
                  checked={selectedLocale === option.id}
                  onChange={() => handleLocaleSelect(option)}
                  className="h-3.5 w-3.5 accent-white"
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="space-y-4 py-6 lg:pl-8">
          <h3 className="font-mono text-[12px] font-medium tracking-[0.05em] text-[#768295]">
            {t('onboarding.appearance.themeTitle')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {appearanceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleAppearanceSelect(option)}
                className={cn(
                  'cursor-pointer border p-4 text-left transition',
                  selectedAppearance === option.id
                    ? 'border-white/35 bg-white/[0.05]'
                    : 'border-[#222] bg-transparent hover:border-[#4b5568] hover:bg-white/[0.03]',
                )}
              >
                <div className="h-10 border border-[#222] bg-black p-2">
                  <div className="h-1.5 bg-white/20" />
                  <div className="mt-2 h-1.5 w-1/2 bg-white" />
                </div>
                <p className="mt-3 text-[13px] font-semibold text-[#f4f7fb]">
                  {option.label}
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const renderActiveConfigurationContent = (stepKey: OnboardingStepKey) => {
    switch (stepKey) {
      case 'executor':
        return renderExecutorStep();
      case 'project_path':
        return renderProjectPathStep();
      case 'appearance':
        return renderAppearanceStep();
      case 'scenario':
      default:
        return renderScenarioStep();
    }
  };

  const renderConfigurationStep = () => {
    const stepKey =
      activeStepKey === welcomeStepKey ? 'scenario' : activeStepKey;
    const stepTitle =
      stepKey === 'executor'
        ? t('onboarding.executor.teamTitle', { team: recommendedTeamName })
        : stepKey === 'project_path'
          ? t('onboarding.project.createTitle')
          : stepKey === 'appearance'
            ? t('onboarding.appearance.title')
            : t('onboarding.scenario.title');
    const stepDescription =
      stepKey === 'executor'
        ? t('onboarding.executor.desc')
        : stepKey === 'project_path'
          ? t('onboarding.project.createDesc')
          : stepKey === 'appearance'
            ? t('onboarding.appearance.desc')
            : t('onboarding.scenario.desc');
    const stepLabel = t(`onboarding.step.${stepI18nKeys[stepKey]}.title`);

    return (
      <div className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6 text-center">
        <div className="pointer-events-none absolute inset-0 bg-black" />
        <div className="pointer-events-none absolute left-1/2 top-[48%] h-[520px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.05] blur-[120px]" />

        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto py-10">
          <div className="flex gap-3">
            {onboardingSteps.map((step, index) => (
              <div
                key={step}
                className={cn(
                  'h-0.5 w-10 rounded-full',
                  index <= activeStepIndex ? 'bg-white' : 'bg-white/15',
                )}
              />
            ))}
          </div>

          <div className="mt-10 max-w-4xl">
            <h1 className="font-sans text-[24px] font-semibold leading-tight tracking-[0.02em] text-[#f4f7fb]">
              {stepTitle}
            </h1>
            <p className="mx-auto mt-2 max-w-3xl text-[13px] leading-relaxed tracking-[0.02em] text-[#8f9aaa]">
              {stepDescription}
            </p>
          </div>

          <div className="relative mt-8 w-full max-w-5xl p-0 text-left">
            {renderActiveConfigurationContent(stepKey)}
          </div>

          {error && (
            <p className="mt-4 max-w-3xl text-center text-[12px] leading-relaxed text-red-300">
              {error}
            </p>
          )}

          <div className="mt-16 grid w-full max-w-5xl grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={saving}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center px-0 py-2 text-[13px] font-medium text-[#768295] transition hover:text-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('onboarding.action.skip')}
              </button>
              <button
                type="button"
                onClick={handleStepBack}
                disabled={saving || activeStepIndex === 0}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center px-3 py-2 text-[13px] font-medium text-[#768295] transition hover:text-[#f4f7fb] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('onboarding.action.back')}
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#7d8aa3]">
              Step {activeStepIndex + 1} of {onboardingSteps.length}: {stepLabel}
            </p>
            <div className="flex justify-center sm:justify-end">
              <button
                type="button"
                onClick={() => void handleStepNext()}
                disabled={saving}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2.5 rounded-[4px] border border-[#4f59b8] border-t-white/30 bg-[linear-gradient(180deg,#6f7ae6_0%,#5e6ad2_100%)] px-6 py-2 text-[13px] font-semibold text-[#f4f7fb] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {stepKey === 'appearance'
                  ? t('onboarding.action.startNow')
                  : t('onboarding.action.next')}
                <span aria-hidden="true" className="font-mono text-[12px] text-[#c5ceda]">
                  ↵
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStepBody = () => {
    if (isWelcome) {
      return (
        <div className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6 text-center">
          <div className="pointer-events-none absolute inset-0 bg-black" />

          <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-10 pt-10">
            <div className="mt-16 max-w-4xl">
              <h1 className="font-sans text-[48px] font-semibold leading-[1.06] tracking-[0] text-[#f4f7fb]">
                {t('onboarding.welcome.title')}
              </h1>
              <p className="mx-auto mt-5 max-w-3xl text-[18px] leading-relaxed text-[#a8b3c2]">
                {t('onboarding.welcome.desc')}
              </p>
            </div>

            <div className="relative mt-14 flex min-h-[440px] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-white/[0.12] bg-[#0a0a0a] p-px shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.025]"
                style={onboardingNoiseTextureStyle}
              />
              <div className="relative z-10 flex items-center gap-2 border-b border-white/[0.08] bg-[#0c0c0c] px-4 py-3">
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-transparent" />
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-transparent" />
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-transparent" />
                <div className="ml-4 h-3 w-32 rounded-[3px] border border-white/[0.08] bg-white/[0.03]" />
              </div>

              <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-10 sm:px-20">
                <div className="w-full max-w-md -translate-y-4 overflow-hidden rounded-[6px] border border-white/[0.12] bg-[#0a0a0a] text-left">
                  <div className="flex items-center border-b border-white/[0.08] p-4">
                    <span className="mr-3 font-mono text-[15px] text-[#a8b3c2]">/</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#f4f7fb]">
                      {selectedWelcomeCommand.label}
                    </span>
                  </div>
                  <div className="p-2">
                    {welcomeCommandOptions.map(({ id, label, Icon, keyHint }) => {
                      const active = selectedWelcomeCommand.id === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setSelectedWelcomeCommandId(id)}
                          onFocus={() => setSelectedWelcomeCommandId(id)}
                          onMouseEnter={() => setSelectedWelcomeCommandId(id)}
                          aria-pressed={active}
                          className={cn(
                            'relative flex w-full cursor-pointer items-center justify-between rounded-[5px] border px-3 py-2 text-left text-[14px] transition',
                            active
                              ? 'border-white/[0.1] bg-white/[0.065] text-white'
                              : 'border-transparent text-[#8792a3] hover:border-white/[0.08] hover:bg-white/[0.035] hover:text-[#f4f7fb]',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute bottom-2 left-0 top-2 w-px',
                              active ? 'bg-white' : 'bg-transparent',
                            )}
                          />
                          <div className="flex min-w-0 items-center gap-3">
                            <Icon className="h-4 w-4 shrink-0 text-current opacity-55" />
                            <span className="truncate">{label}</span>
                          </div>
                          <span
                            className={cn(
                              'ml-3 min-w-6 rounded-[3px] border border-white/[0.18] bg-[#0c0c0c] px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold',
                              active ? 'text-white' : 'text-[#8792a3]',
                            )}
                            style={onboardingMonoFont}
                          >
                            {keyHint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-12 flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => void handleWelcomeNext()}
                disabled={saving}
                className="inline-flex min-h-12 origin-center cursor-pointer items-center justify-center gap-3 rounded-[6px] border border-white bg-white px-9 py-3 text-[14px] font-semibold text-black shadow-[inset_0_-1px_0_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.35)] transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform hover:-translate-y-[2px] hover:scale-[1.012] hover:bg-[#f7f7f7] hover:shadow-[inset_0_-1px_0_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.55),0_14px_34px_rgba(255,255,255,0.11)] active:translate-y-[1px] active:scale-[0.988] active:bg-[#e7e7e7] active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.22),0_1px_2px_rgba(0,0,0,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {t('onboarding.welcome.next')}
              </button>
              <p
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8f9aaa]"
                style={onboardingMonoFont}
              >
                ALL 4 STEPS TO FINISH CONFIGURATION
              </p>
            </div>
          </div>
        </div>
      );
    }

    return renderConfigurationStep();
  };

  if (mode === 'upgrade') {
    return (
      <div
        className="fixed inset-0 z-[90] bg-[var(--canvas)] p-4 text-[var(--ink)]"
        style={onboardingDarkThemeVars}
      >
        <div className="mx-auto flex h-full max-w-6xl flex-col">
          {renderUpgradeGuide()}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] bg-[var(--canvas)] text-[var(--ink)]"
      style={onboardingDarkThemeVars}
    >
      <section className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden bg-transparent">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {renderStepBody()}
          </div>
        </main>
      </section>
    </div>
  );
}
