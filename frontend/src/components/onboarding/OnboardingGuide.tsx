import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Bot,
  Check,
  ChevronUp,
  FileText,
  Folder,
  FolderOpen,
  Home,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Search,
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
const defaultProjectName = 'MyProject';
const onboardingSteps = ['scenario', 'executor', 'project_path', 'appearance'] as const;

type OnboardingStepKey = (typeof onboardingSteps)[number];
type ActiveStepKey = OnboardingStepKey | typeof welcomeStepKey;
type OnboardingMode = 'onboarding' | 'upgrade';
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
  '--ink': '#f7f8f8',
  '--ink-muted': '#d0d6e0',
  '--ink-subtle': '#8a8f98',
  '--ink-tertiary': '#62666d',
  '--primary': '#5e6ad2',
  '--primary-hover': '#828fff',
  '--on-primary': '#ffffff',
  '--primary-tint': 'rgba(94, 106, 210, 0.12)',
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

const isGitRepoLabel = (value: boolean, t: TranslateFn) =>
  value ? t('onboarding.project.gitYes') : t('onboarding.project.gitNo');

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
  const [pathError, setPathError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          (current.trim() ? current : defaultProjectName),
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

    return { name, path };
  };

  const handleFinish = async () => {
    const projectDraft = await validateProjectDraft();
    if (!projectDraft) return;

    setSaving(true);
    setError(null);
    try {
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
      setProjectName(defaultProjectName);
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

  const validateProjectPath = async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      setProjectStatus(null);
      return null;
    }
    setPathLoading(true);
    setPathError(null);
    try {
      const status = await chatSessionsApi.validateWorkspacePath(trimmed);
      setProjectStatus(status);
      if (!status.valid) {
        setPathError(status.error ?? t('onboarding.project.invalid'));
      }
      return status;
    } catch (err) {
      setProjectStatus(null);
      setPathError(
        err instanceof Error ? err.message : t('onboarding.project.invalid'),
      );
      throw err;
    } finally {
      setPathLoading(false);
    }
  };

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
            className="mt-4 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#5e6ad2] px-[14px] py-2 text-[13px] font-semibold text-white transition hover:bg-[#6f7ae6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            {t('onboarding.upgrade.markRead')}
          </button>
        </aside>
      </div>
    </section>
  );

  const renderExecutorStep = () => (
    <div className="space-y-4">
      {runtimeError && (
        <p className="rounded-[8px] border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[12px] text-yellow-200">
          {runtimeError}
        </p>
      )}
      <div className="overflow-hidden rounded-[10px] border border-white/10 bg-[#161616]/85">
        {teamMembers.map((member, index) => {
          const runnerValue = member.runner_type || runnerOptions[0]?.id || '';
          const modelOptions = modelOptionsForRunner(runnerValue);
          const modelValue = member.model_name || modelOptions[0]?.id || '';
          return (
            <div
              key={`${member.member}-${index}`}
              className={cn(
                'grid gap-3 px-6 py-4 md:grid-cols-[minmax(150px,1fr)_minmax(160px,220px)_minmax(160px,220px)] md:items-center',
                index < teamMembers.length - 1 && 'border-b border-white/5',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] font-mono text-[11px] font-semibold text-[#d0d6e0]">
                  {member.member.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate text-[13px] font-semibold text-[var(--ink)]">
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
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {scenarios.map((scenario) => {
          const selected = scenario.key === selectedScenario;
          return (
            <button
              key={scenario.key}
              type="button"
              onClick={() => handleScenarioSelect(scenario.key)}
              className={cn(
                'min-h-[118px] cursor-pointer rounded-[10px] border bg-[#161616]/75 p-6 text-left transition hover:border-white/20 hover:bg-white/[0.06]',
                selected
                  ? 'border-white/25 bg-white/[0.08]'
                  : 'border-white/10',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="truncate text-[13px] font-semibold text-[var(--ink)]">
                  {scenario.title}
                </h3>
                {selected && <Check className="h-4 w-4 text-[var(--primary)]" />}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-[#aeb8c8]">
                {scenario.desc}
              </p>
            </button>
          );
        })}
      </div>
      <div className="rounded-[10px] border border-white/10 bg-[#161616]/70 p-6">
        <p className="text-[12px] font-semibold text-[#7e8795]">
          {t('onboarding.scenario.recommendedTeam')}
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-3">
          <Users className="h-4 w-4 shrink-0 text-[var(--primary)]" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
              {recommendedTeamName}
            </p>
            <p className="mt-0.5 text-[12px] text-[#aeb8c8]">
              {t('onboarding.scenario.memberDetailsHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderProjectPathStep = () => (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-[10px] border border-white/10 bg-[#161616]/75 p-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <label className="block min-w-0 text-[12px] font-semibold text-[#7e8795]">
          {t('onboarding.project.nameTitle')}
          <input
            value={projectName}
            onChange={(event) => {
              setProjectName(event.target.value);
              setProjectNameTouched(true);
            }}
            className="mt-2 h-9 w-full rounded-[8px] border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white outline-none transition placeholder:text-[#7e8795] focus:border-white/25"
            placeholder={t('onboarding.project.namePlaceholder')}
          />
        </label>
        <div className="min-w-0 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2">
          <p className="font-mono text-[11px] font-semibold text-[#7e8795]">
            {t('onboarding.scenario.recommendedTemplate')}
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold text-[var(--ink)]">
            {recommendedTeamName}
          </p>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <section className="overflow-hidden rounded-[10px] border border-white/10 bg-[#161616]/75">
          <div className="flex items-center gap-1.5 border-b border-white/5 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#7e8795]">
              {currentPath || t('onboarding.project.localRoots')}
            </span>
            <button
              type="button"
              onClick={() => void loadRoots()}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#7e8795] transition hover:bg-white/[0.06] hover:text-white"
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
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#7e8795] transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('onboarding.project.up')}
              title={t('onboarding.project.up')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void loadDirectory(projectPath)}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#7e8795] transition hover:bg-white/[0.06] hover:text-white"
              aria-label={t('onboarding.project.refresh')}
              title={t('onboarding.project.refresh')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="h-[236px] overflow-y-auto p-1.5">
            {pathLoading ? (
              <div className="px-2 py-2 text-[12px] text-[#7e8795]">
                {t('onboarding.project.loading')}
              </div>
            ) : entries.length === 0 ? (
              <div className="px-2 py-2 text-[12px] text-[#7e8795]">
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
                      'group/path-entry flex items-center rounded-[6px]',
                      selected && 'bg-white/[0.06]',
                    )}
                  >
                    <button
                      type="button"
                      disabled={!entry.is_directory}
                      onClick={() => {
                        if (entry.is_directory) void loadDirectory(entry.path);
                      }}
                      className="flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-[#aeb8c8] transition hover:bg-white/[0.06] hover:text-white disabled:cursor-default disabled:opacity-55"
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          entry.is_git_repo
                            ? 'text-[var(--primary)]'
                            : 'text-[#7e8795]',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {entry.name}
                      </span>
                      {entry.is_git_repo && (
                        <span className="rounded-[4px] bg-[var(--primary-tint)] px-1.5 py-px font-mono text-[10px] font-semibold text-[var(--primary-hover)]">
                          GIT
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
                          'mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-[#7e8795] opacity-0 transition hover:bg-white/[0.06] hover:text-white group-hover/path-entry:opacity-100',
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

        <aside className="space-y-3 rounded-[10px] border border-white/10 bg-[#161616]/75 p-4">
          <label className="block text-[12px] font-semibold text-[#7e8795]">
            {t('onboarding.project.selectedPath')}
            <input
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              className="mt-2 h-9 w-full rounded-[8px] border border-white/10 bg-white/[0.04] px-3 font-mono text-[12px] text-white outline-none transition placeholder:text-[#7e8795] focus:border-white/25"
              placeholder={t('onboarding.project.pathPlaceholder')}
            />
          </label>
          <button
            type="button"
            onClick={() => void validateProjectPath(projectPath)}
            disabled={!projectPath.trim() || pathLoading}
            className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.06] px-[14px] py-2 text-[12px] font-semibold text-[#d0d6e0] transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t('onboarding.project.validate')}
          </button>
          <div className="divide-y divide-white/5 rounded-[8px] border border-white/10 bg-white/[0.04] text-[12px]">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[var(--ink-subtle)]">
                {t('onboarding.project.status')}
              </span>
              <span className="font-semibold text-[var(--ink)]">
                {projectStatus?.valid
                  ? t('onboarding.project.valid')
                  : t('onboarding.project.pending')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[var(--ink-subtle)]">
                {t('onboarding.project.gitStatus')}
              </span>
              <span className="font-semibold text-[var(--ink)]">
                {projectStatus
                  ? isGitRepoLabel(projectStatus.is_git_repo, t)
                  : '-'}
              </span>
            </div>
          </div>
          {(pathError || error) && (
            <p className="text-[12px] leading-relaxed text-red-400">
              {pathError || error}
            </p>
          )}
        </aside>
      </div>
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
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">
            {t('onboarding.appearance.languageTitle')}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {languageOptions.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-2 text-[13px] transition',
                  selectedLocale === option.id
                    ? 'border-white/25 bg-white/[0.08] text-white'
                    : 'border-white/10 bg-[#161616]/75 text-[#aeb8c8] hover:border-white/20 hover:text-white',
                )}
              >
                <input
                  type="radio"
                  name="onboarding-language"
                  value={option.id}
                  checked={selectedLocale === option.id}
                  onChange={() => handleLocaleSelect(option)}
                  className="h-3.5 w-3.5 accent-[var(--primary)]"
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">
            {t('onboarding.appearance.themeTitle')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {appearanceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleAppearanceSelect(option)}
                className={cn(
                  'cursor-pointer rounded-[8px] border p-6 text-left transition',
                  selectedAppearance === option.id
                    ? 'border-white/25 bg-white/[0.08]'
                    : 'border-white/10 bg-[#161616]/75 hover:border-white/20 hover:bg-white/[0.06]',
                )}
              >
                <div className="h-12 rounded-[6px] border border-white/10 bg-white/[0.04] p-2">
                  <div className="h-2 rounded bg-white/10" />
                  <div className="mt-3 h-2 w-1/2 rounded bg-[var(--primary)]" />
                </div>
                <p className="mt-2 text-[13px] font-semibold text-[var(--ink)]">
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
        <div className="pointer-events-none absolute inset-0 bg-[#030303]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(94,106,210,0.22)_0%,rgba(3,3,3,0)_58%)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-10 pt-10">
          <div className="flex gap-3">
            {onboardingSteps.map((step, index) => (
              <div
                key={step}
                className={cn(
                  'h-0.5 w-10 rounded-full',
                  index <= activeStepIndex ? 'bg-white' : 'bg-white/10',
                )}
              />
            ))}
          </div>

          <div className="mt-12 max-w-4xl">
            <h1 className="font-sans text-[44px] font-semibold leading-[1.08] tracking-[-1.2px] text-white">
              {stepTitle}
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-[#aeb8c8]">
              {stepDescription}
            </p>
          </div>

          <div className="relative mt-12 w-full max-w-5xl rounded-[14px] border border-white/10 bg-white/[0.03] p-6 text-left shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
            {renderActiveConfigurationContent(stepKey)}
          </div>

          {error && (
            <p className="mt-4 max-w-3xl text-center text-[12px] leading-relaxed text-red-300">
              {error}
            </p>
          )}

          <div className="mt-8 flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={saving}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-[13px] font-medium text-[#d0d6e0] transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('onboarding.action.skip')}
              </button>
              <button
                type="button"
                onClick={handleStepBack}
                disabled={saving || activeStepIndex === 0}
                className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-2 text-[13px] font-medium text-[#d0d6e0] transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('onboarding.action.back')}
              </button>
              <button
                type="button"
                onClick={() => void handleStepNext()}
                disabled={saving}
                className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-8 py-3 text-[15px] font-semibold text-black transition hover:bg-[#e7e9ee] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {stepKey === 'appearance'
                  ? t('onboarding.action.startNow')
                  : t('onboarding.action.next')}
              </button>
            </div>
            <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-[#5f6d82]">
              Step {activeStepIndex + 1} of {onboardingSteps.length}: {stepLabel}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderStepBody = () => {
    if (isWelcome) {
      return (
        <div className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[#030303]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(94,106,210,0.22)_0%,rgba(3,3,3,0)_58%)]" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-10 pt-10">
            <div className="flex gap-3">
              <div className="h-0.5 w-10 rounded-full bg-white" />
              <div className="h-0.5 w-10 rounded-full bg-white/10" />
              <div className="h-0.5 w-10 rounded-full bg-white/10" />
              <div className="h-0.5 w-10 rounded-full bg-white/10" />
            </div>

            <div className="mt-16 max-w-4xl">
              <h1 className="font-sans text-[48px] font-semibold leading-[1.06] tracking-[-1.3px] text-white">
                {t('onboarding.welcome.title')}
              </h1>
              <p className="mx-auto mt-5 max-w-3xl text-[18px] leading-relaxed text-[#aeb8c8]">
                {t('onboarding.welcome.desc')}
              </p>
            </div>

            <div className="relative mt-14 w-full max-w-5xl rounded-[14px] border border-white/10 bg-white/[0.03] p-2 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <div className="h-2 w-2 rounded-full bg-white/10" />
                <div className="h-2 w-2 rounded-full bg-white/10" />
                <div className="h-2 w-2 rounded-full bg-white/10" />
                <div className="ml-4 h-3 w-32 rounded bg-white/5" />
              </div>

              <div className="flex justify-center px-4 py-12 sm:px-20">
                <div className="w-full max-w-md overflow-hidden rounded-[10px] border border-white/10 bg-[#161616]/95 text-left shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                  <div className="flex items-center border-b border-white/5 p-4">
                    <span className="mr-3 font-mono text-[15px] text-[#8a8f98]">/</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-white/80">
                      {t('onboarding.welcome.pointWorkflow')}
                    </span>
                  </div>
                  <div className="p-2">
                    {[
                      {
                        label: t('onboarding.welcome.pointTeams'),
                        Icon: Users,
                        keyHint: 'T',
                        active: true,
                      },
                      {
                        label: t('onboarding.welcome.pointLocal'),
                        Icon: Search,
                        keyHint: 'L',
                        active: false,
                      },
                      {
                        label: t('onboarding.welcome.pointWorkflow'),
                        Icon: Zap,
                        keyHint: 'W',
                        active: false,
                      },
                    ].map(({ label, Icon, keyHint, active }) => (
                      <div
                        key={label}
                        className={cn(
                          'flex items-center justify-between rounded-[8px] px-3 py-2 text-[14px]',
                          active
                            ? 'bg-white/[0.06] text-white'
                            : 'text-[#7e8795]',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{label}</span>
                        </div>
                        <span className="ml-3 rounded-[4px] border border-white/10 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#8a8f98]">
                          {keyHint}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-3/4 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5e6ad2]/10 blur-[100px]" />
            </div>

            <div className="mt-16 flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => void handleWelcomeNext()}
                disabled={saving}
                className="inline-flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-10 py-3 text-[16px] font-semibold text-black transition hover:bg-[#e7e9ee] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {t('onboarding.welcome.next')}
                <span className="font-mono text-[12px] font-normal text-black/45">Enter</span>
              </button>
              <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-[#5f6d82]">
                Step 1 of {onboardingSteps.length}: Command center
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
