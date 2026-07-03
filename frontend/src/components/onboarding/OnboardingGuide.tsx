import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Bot,
  Check,
  ChevronUp,
  Ellipsis,
  FileText,
  Folder,
  Home,
  Info,
  Layers3,
  LoaderCircle,
  Monitor,
  Moon,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
const onboardingSteps = ['appearance', 'scenario', 'executor', 'project_path'] as const;
const gitignoreTemplates = ['node', 'go', 'python', 'none'] as const;

type OnboardingStepKey = (typeof onboardingSteps)[number];
type ActiveStepKey = OnboardingStepKey | typeof welcomeStepKey;
type OnboardingMode = 'onboarding' | 'upgrade';
type GitignoreTemplate = (typeof gitignoreTemplates)[number];
const firstOnboardingStep: OnboardingStepKey = 'appearance';
const finalOnboardingStep: OnboardingStepKey = 'project_path';
type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

type OnboardingCompleteOptions = {
  createDefaultSession?: boolean;
  projectId?: string | null;
  workspacePath?: string | null;
};

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
  onComplete: (
    state: OnboardingState,
    options?: OnboardingCompleteOptions,
  ) => void | Promise<void>;
  onStateChange?: (state: OnboardingState) => void;
  onUpgradeRead: (state: OnboardingState) => void;
}

const onboardingDarkThemeVars = {
  '--canvas': '#0a0a0a',
  '--surface-1': '#0f1011',
  '--surface-2': '#141516',
  '--surface-3': '#18191a',
  '--surface-4': '#191a1b',
  '--hairline': '#23252a',
  '--hairline-strong': '#34343a',
  '--hairline-tertiary': '#3e3e44',
  '--ink': '#f4f4f5',
  '--ink-muted': '#a1a1aa',
  '--ink-subtle': '#8a8f98',
  '--ink-tertiary': '#6f6f76',
  '--primary': '#5e6ad2',
  '--primary-hover': '#828fff',
  '--on-primary': '#ffffff',
  '--primary-tint': 'rgba(94, 106, 210, 0.12)',
} as CSSProperties;

const onboardingMonoFont = {
  fontFamily:
    '"JetBrains Mono", "SF Mono", "SFMono-Regular", ui-monospace, "Cascadia Code", monospace',
} as CSSProperties;

const onboardingSansFont = {
  fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
} as CSSProperties;

const executorSelectClassName =
  'w-full [&>button]:h-7 [&>button]:rounded-[3px] [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-1.5 [&>button]:py-0 [&>button]:font-mono [&>button]:text-[13px] [&>button]:text-[#d4d4d8] [&>button]:shadow-none [&>button]:transition-colors [&>button]:duration-100 [&>button:hover]:border-transparent [&>button:hover]:bg-white/[0.035] [&>button:focus-visible]:border-white/[0.14] [&>button:focus-visible]:bg-white/[0.045] [&>button:focus-visible]:outline-none [&>button[aria-expanded=true]]:border-white/[0.14] [&>button[aria-expanded=true]]:bg-white/[0.045] [&>button[data-placeholder=true]>span]:text-[#6f6f76] [&>button>svg:last-child]:h-3 [&>button>svg:last-child]:w-3 [&>button>svg:last-child]:text-[var(--ink-tertiary)] [&>button:hover>svg:last-child]:text-[#a1a1aa]';

const onboardingProjectInputClassName =
  'mt-2 w-full rounded-[5px] border border-white/[0.08] bg-[#151617] px-3 font-mono shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] outline-none transition-[background-color,border-color,box-shadow] placeholder:text-[#5F6672] focus:border-white/[0.24] focus:bg-[#171819] focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.04)]';

const onboardingProjectSelectClassName =
  'mt-2 w-full [&>button]:h-7 [&>button]:rounded-[5px] [&>button]:border-white/[0.08] [&>button]:bg-[#151617] [&>button]:px-1.5 [&>button]:py-0 [&>button]:font-mono [&>button]:text-[12px] [&>button]:text-[#c9d2df] [&>button]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] [&>button]:outline-none [&>button:hover]:border-white/[0.16] [&>button:hover]:bg-white/[0.045] [&>button:focus-visible]:border-white/[0.24] [&>button:focus-visible]:bg-[#171819] [&>button:focus-visible]:outline-none [&>button[aria-expanded=true]]:border-white/[0.24] [&>button[aria-expanded=true]]:bg-[#171819] [&>button>svg:last-child]:h-3 [&>button>svg:last-child]:w-3 [&>button>svg:last-child]:text-[#768295]';

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
  Icon: LucideIcon;
  members: OnboardingTeamMemberConfig[];
};

const scenarioDefinitions: ScenarioDefinition[] = [
  {
    key: OnboardingScenario.software,
    titleKey: 'onboarding.scenario.software.title',
    titleFallback: 'Software product',
    descKey: 'onboarding.scenario.software.desc',
    descFallback:
      'Plan requirements, split engineering tasks, implement frontend and backend changes, and move code through review and testing.',
    teamKey: 'onboarding.scenario.software.team',
    teamFallback: 'Software delivery team',
    Icon: Layers3,
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
    descFallback:
      'Translate product screens, interaction states, and visual details into implementation tasks while keeping fidelity and quality aligned.',
    teamKey: 'onboarding.scenario.design.team',
    teamFallback: 'Design implementation team',
    Icon: Sparkles,
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
    descFallback:
      'Collect source context, compare options, capture conclusions, and turn the result into an actionable decision record.',
    teamKey: 'onboarding.scenario.research.team',
    teamFallback: 'Research analysis team',
    Icon: Search,
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
    descFallback:
      'Start with a flexible collaboration team for exploration, execution, and review, then tune the members as the project takes shape.',
    teamKey: 'onboarding.scenario.other.team',
    teamFallback: 'General collaboration team',
    Icon: Ellipsis,
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
    : firstOnboardingStep;
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

const roleBadgeLabel = (name: string) => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const compact =
    words.length > 1 ? words.map((word) => word.charAt(0)).join('') : name;
  return compact.slice(0, 2).toUpperCase();
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
  onComplete,
  onStateChange,
  onUpgradeRead,
}: OnboardingGuideProps) {
  const initialStep = initialState?.welcome_seen_at
    ? stepFromBackend(initialState.current_step)
    : welcomeStepKey;
  const initialConfigurationStep: OnboardingStepKey =
    initialStep === welcomeStepKey ? firstOnboardingStep : initialStep;
  const [state, setState] = useState<OnboardingState | null>(initialState);
  const [activeStepKey, setActiveStepKey] = useState<ActiveStepKey>(initialStep);
  const [renderedConfigurationStepKey, setRenderedConfigurationStepKey] =
    useState<OnboardingStepKey>(initialConfigurationStep);
  const [configurationMotionState, setConfigurationMotionState] =
    useState<'idle' | 'slide-out' | 'slide-in'>('idle');
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
  const [directoryMutating, setDirectoryMutating] = useState(false);
  const [renamingDirectoryPath, setRenamingDirectoryPath] = useState<string | null>(
    null,
  );
  const [renamingDirectoryName, setRenamingDirectoryName] = useState('');
  const [renameDirectoryError, setRenameDirectoryError] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWelcomeCommandId, setSelectedWelcomeCommandId] =
    useState('workflow_execution');
  const pathValidationRequestRef = useRef(0);
  const onboardingTextFont = onboardingSansFont;

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
  const targetConfigurationStepKey: OnboardingStepKey =
    activeStepKey === welcomeStepKey ? firstOnboardingStep : activeStepKey;
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

  useEffect(() => {
    if (targetConfigurationStepKey === renderedConfigurationStepKey) {
      setConfigurationMotionState('idle');
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setRenderedConfigurationStepKey(targetConfigurationStepKey);
      setConfigurationMotionState('idle');
      return;
    }

    setConfigurationMotionState('slide-out');
    const exitTimer = window.setTimeout(() => {
      setRenderedConfigurationStepKey(targetConfigurationStepKey);
      setConfigurationMotionState('slide-in');
    }, 140);
    const settleTimer = window.setTimeout(() => {
      setConfigurationMotionState('idle');
    }, 300);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(settleTimer);
    };
  }, [renderedConfigurationStepKey, targetConfigurationStepKey]);

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

  const gitignoreOptions = useMemo<DropdownSelectOption[]>(
    () =>
      gitignoreTemplates.map((template) => ({
        id: template,
        label: t(`onboarding.project.gitignore.${template}`),
      })),
    [t],
  );

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
    (_scenarioKey: OnboardingScenario) => sanitizeProjectName('MyProject'),
    [],
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

  const initializeProjectWorkspaceGit = async (path: string) => {
    const initialized = await chatSessionsApi.initializeWorkspaceGit({
      workspace_path: path,
      gitignore_template: gitignoreTemplate === 'none' ? null : gitignoreTemplate,
    });
    setProjectStatus(initialized.status);
    return initialized.status;
  };

  const handleInitializeProjectGit = async () => {
    setSaving(true);
    setError(null);
    try {
      const projectDraft = await validateProjectDraft();
      if (!projectDraft || projectDraft.status.is_git_repo) return;
      await initializeProjectWorkspaceGit(projectDraft.path);
      setPathError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.project.initializeFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    const projectDraft = await validateProjectDraft();
    if (!projectDraft) return;

    setSaving(true);
    setError(null);
    try {
      if (!projectDraft.status.is_git_repo && initializeGit) {
        await initializeProjectWorkspaceGit(projectDraft.path);
      }

      const createdProject = await onCreateProjectFromOnboarding({
        name: projectDraft.name,
        path: projectDraft.path,
        teamId: recommendedTeamId,
      });
      const state = await onboardingApi.complete({
        ...currentPayload(finalOnboardingStep),
        project_name: projectDraft.name,
        project_path: projectDraft.path,
        created_project_id: createdProject.projectId,
      });
      applyState(state);
      await onComplete(state, {
        createDefaultSession: true,
        projectId: createdProject.projectId,
        workspacePath: projectDraft.path,
      });
    } catch {
      setError(t('onboarding.project.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleWelcomeNext = async () => {
    await saveState({
      welcome_seen: true,
      current_step: stepToBackend[firstOnboardingStep],
      selected_scenario: selectedScenario,
      recommended_team_name: recommendedTeamName,
    });
    setActiveStepKey(firstOnboardingStep);
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

    if (activeStepKey === finalOnboardingStep) {
      await handleFinish();
      return;
    }

    if (activeStepKey === 'project_path') {
      const projectDraft = await validateProjectDraft();
      if (!projectDraft) return;
    }

    const nextStep = onboardingSteps[activeStepIndex + 1] ?? finalOnboardingStep;
    await saveState(currentPayload(nextStep));
    setActiveStepKey(nextStep);
  };

  useEffect(() => {
    if (mode !== 'onboarding' || isWelcome) return;

    const handleConfigurationShortcut = (event: KeyboardEvent) => {
      if (saving || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      if (
        activeStepKey === 'scenario' &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        const currentIndex = scenarios.findIndex(
          (scenario) => scenario.key === selectedScenario,
        );
        if (currentIndex < 0) return;

        const usesTwoColumnGrid =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(min-width: 768px)').matches;
        const columns = usesTwoColumnGrid ? 2 : 1;
        let nextIndex = currentIndex;

        if (columns === 1) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            nextIndex = Math.min(currentIndex + 1, scenarios.length - 1);
          } else {
            nextIndex = Math.max(currentIndex - 1, 0);
          }
        } else {
          const column = currentIndex % columns;
          if (
            event.key === 'ArrowRight' &&
            column < columns - 1 &&
            currentIndex + 1 < scenarios.length
          ) {
            nextIndex = currentIndex + 1;
          } else if (event.key === 'ArrowLeft' && column > 0) {
            nextIndex = currentIndex - 1;
          } else if (
            event.key === 'ArrowDown' &&
            currentIndex + columns < scenarios.length
          ) {
            nextIndex = currentIndex + columns;
          } else if (event.key === 'ArrowUp' && currentIndex - columns >= 0) {
            nextIndex = currentIndex - columns;
          }
        }

        event.preventDefault();
        if (nextIndex !== currentIndex) {
          handleScenarioSelect(scenarios[nextIndex].key);
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        void handleStepNext();
        return;
      }

      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        event.preventDefault();
        handleStepBack();
      }
    };

    window.addEventListener('keydown', handleConfigurationShortcut);
    return () => {
      window.removeEventListener('keydown', handleConfigurationShortcut);
    };
  }, [
    activeStepIndex,
    activeStepKey,
    handleStepNext,
    isWelcome,
    mode,
    saving,
    scenarios,
    selectedScenario,
  ]);

  const handleSkip = async () => {
    setSaving(true);
    setError(null);
    try {
      const state = await onboardingApi.complete(currentPayload(finalOnboardingStep));
      applyState(state);
      await onComplete(state);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('onboarding.error.completeFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  function handleScenarioSelect(scenarioKey: OnboardingScenario) {
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
  }

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
      setRenamingDirectoryPath(null);
      setRenamingDirectoryName('');
      setRenameDirectoryError(null);
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
      setRenamingDirectoryPath(null);
      setRenamingDirectoryName('');
      setRenameDirectoryError(null);
    } catch (err) {
      setPathError(
        err instanceof Error ? err.message : t('onboarding.project.rootsFailed'),
      );
    } finally {
      setPathLoading(false);
    }
  };

  const resetDirectoryRename = () => {
    setRenamingDirectoryPath(null);
    setRenamingDirectoryName('');
    setRenameDirectoryError(null);
  };

  const createProjectDirectory = async () => {
    const parentPath = currentPath.trim();
    if (!parentPath || pathLoading || directoryMutating) return;

    setDirectoryMutating(true);
    setPathError(null);
    setRenameDirectoryError(null);
    try {
      const created = await filesystemApi.createDirectory({
        parent_path: parentPath,
        name: t('sidebar.newFolderName'),
      });
      await loadDirectory(parentPath);
      setProjectPath(created.path);
      setProjectStatus(null);
      setRenamingDirectoryPath(created.path);
      setRenamingDirectoryName(created.name);
    } catch (err) {
      setPathError(
        err instanceof Error ? err.message : t('sidebar.createFolderFailed'),
      );
    } finally {
      setDirectoryMutating(false);
    }
  };

  const commitDirectoryRename = async () => {
    const targetPath = renamingDirectoryPath;
    const nextName = renamingDirectoryName.trim();
    if (!targetPath || directoryMutating) return;
    if (!nextName) {
      setRenameDirectoryError(t('sidebar.folderNameRequired'));
      return;
    }

    const originalEntry = entries.find((entry) => entry.path === targetPath);
    if (originalEntry?.name === nextName) {
      resetDirectoryRename();
      return;
    }

    setDirectoryMutating(true);
    setRenameDirectoryError(null);
    try {
      const renamed = await filesystemApi.renameDirectory({
        path: targetPath,
        name: nextName,
      });
      const parentPath = getParentPath(renamed.path) || currentPath;
      await loadDirectory(parentPath);
      setProjectPath(renamed.path);
      setProjectStatus(null);
      resetDirectoryRename();
    } catch (err) {
      setRenameDirectoryError(
        err instanceof Error ? err.message : t('sidebar.renameFolderFailed'),
      );
    } finally {
      setDirectoryMutating(false);
    }
  };

  const handleDirectoryRenameKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void commitDirectoryRename();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      resetDirectoryRename();
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
            className="mt-4 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#5e6ad2] px-[14px] py-2 text-[13px] font-semibold text-[#f5f5f5] transition hover:bg-[#6f7ae6] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            {t('onboarding.upgrade.markRead')}
          </button>
        </aside>
      </div>
    </section>
  );

  const renderExecutorStep = () => (
    <div className="flex h-[340px] items-center justify-center">
      <div className="h-full w-full max-w-[820px] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90 px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] sm:px-7 sm:py-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] bg-transparent">
          {runtimeError && (
            <p className="shrink-0 border-b border-yellow-500/25 px-4 py-2.5 font-mono text-[12px] text-yellow-200">
              {runtimeError}
            </p>
          )}
          <div className="hidden shrink-0 px-5 pb-1.5 pt-2.5 font-mono text-[9px] font-semibold uppercase leading-none tracking-[0.05em] text-white/45 md:grid md:grid-cols-[minmax(160px,1fr)_190px_230px] md:gap-3">
            <span>{t('onboarding.executor.table.role')}</span>
            <span>{t('onboarding.executor.table.executor')}</span>
            <span>{t('onboarding.executor.table.model')}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {teamMembers.map((member, index) => {
              const runnerValue = member.runner_type || runnerOptions[0]?.id || '';
              const modelOptions = modelOptionsForRunner(runnerValue);
              const modelValue = member.model_name || modelOptions[0]?.id || '';
              return (
                <div
                  key={`${member.member}-${index}`}
                  className="mx-1 grid min-h-[54px] gap-2.5 rounded-[6px] px-3 py-2.5 transition-colors duration-100 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.05] md:mx-2 md:grid-cols-[minmax(160px,1fr)_190px_230px] md:items-center md:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded-[4px] border border-white/[0.12] bg-white/[0.03] px-1.5 text-center font-mono text-[11px] font-semibold uppercase leading-[20px] tracking-[0] text-[#a1a1aa]">
                      {roleBadgeLabel(member.member)}
                    </span>
                    <span className="truncate text-[13px] font-semibold tracking-tight text-[#f5f5f5]">
                      {member.member}
                    </span>
                  </div>
                  <DropdownSelect
                    value={runnerValue}
                    options={runnerOptions}
                    showSearch={false}
                    placeholder={t('onboarding.executor.runnerPlaceholder')}
                    className={executorSelectClassName}
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
                    className={executorSelectClassName}
                    onChange={(value) => updateTeamMember(index, { model_name: value })}
                    maxPanelHeightClassName="max-h-[190px]"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderScenarioStep = () => (
    <div className="flex h-[340px] items-center justify-center">
      <div className="h-full w-full max-w-[820px] rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90 px-10 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.32)] sm:px-7 sm:py-8">
        <section className="mx-auto grid w-full max-w-[760px] gap-3 sm:grid-cols-2">
          {scenarios.map((scenario) => {
            const selected = scenario.key === selectedScenario;
            const Icon = scenario.Icon;
            return (
              <button
                key={scenario.key}
                type="button"
                onClick={() => handleScenarioSelect(scenario.key)}
                className={cn(
                  'group min-h-[104px] cursor-pointer rounded-[8px] border p-3 text-left transition-[background-color,border-color,box-shadow,color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/[0.35] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]',
                  selected
                    ? 'border-white/[0.18] bg-white/[0.065] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_0_rgba(0,0,0,0.55)]'
                    : 'border-transparent bg-transparent',
                )}
              >
                <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3">
                  <span
                    className={cn(
                      'col-start-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
                      selected
                        ? 'text-[#f4f4f5]'
                        : 'text-[#8a8f98] group-hover:text-[#c9cdd6]',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.4} />
                  </span>
                  <h3
                    className={cn(
                      'col-start-2 min-w-0 truncate text-[13px] font-semibold tracking-[0] transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
                      selected ? 'text-[#f4f4f5]' : 'text-[#d4d4d8] group-hover:text-[#f4f4f5]',
                    )}
                  >
                    {scenario.title}
                  </h3>
                  <p
                    className={cn(
                      'col-start-2 mt-0.5 line-clamp-2 pr-1 text-[11px] leading-[1.38] tracking-[0] transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
                      selected
                        ? 'text-[#777777]'
                        : 'text-white/40 group-hover:text-[#8a8f98]',
                    )}
                  >
                    {scenario.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </section>
        <div className="-mx-5 mt-7 border-t border-white/[0.08] px-5 pt-3 sm:-mx-7 sm:px-8">
          <aside className="mx-auto flex w-full max-w-[760px] items-center justify-start gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Users className="h-4 w-4 shrink-0 text-[#a1a1aa]" strokeWidth={1.4} />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate font-mono text-[12px] font-semibold tracking-[0] text-[#f4f4f5]">
                    {recommendedTeamName}
                  </p>
                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-white/[0.14] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0] text-[#d4d4d8]">
                    <span className="text-[#f4f4f5]">+</span>
                    {t('onboarding.scenario.recommendedTeam')}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );

  const renderProjectPathStep = () => {
    const projectConfigurationError = pathError || error;
    const showInitializeGitAction = Boolean(
      projectPath.trim() &&
        initializeGit &&
        projectStatus?.valid &&
        !projectStatus.is_git_repo,
    );

    return (
      <div className="flex h-[340px] items-center justify-center">
        <div className="h-full w-full max-w-[820px] overflow-hidden rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_60px_rgba(0,0,0,0.30)] backdrop-blur-sm sm:px-7 sm:py-5">
          <div className="grid h-full min-h-0 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.74fr)] lg:gap-0 lg:divide-x lg:divide-white/[0.05] lg:overflow-hidden">
          <section className="flex min-h-0 flex-col lg:pr-6">
            <label className="block min-w-0 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#8A8F98]">
              {t('onboarding.project.nameTitle')}
              <input
                value={projectName}
                onChange={(event) => {
                  setProjectName(sanitizeProjectName(event.target.value));
                  setProjectNameTouched(true);
                }}
                className={cn(
                  onboardingProjectInputClassName,
                  'h-9 text-[13px] font-semibold normal-case tracking-[0] text-white/[0.92]',
                )}
                placeholder={t('onboarding.project.namePlaceholder')}
              />
            </label>

            <section className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border border-white/[0.08] bg-[#151617] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
              <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.05] px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] tracking-[0.03em] text-[#8A8F98]">
                  {currentPath || t('onboarding.project.localRoots')}
                </span>
                <button
                  type="button"
                  onClick={() => void loadRoots()}
                  className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5]"
                  aria-label={t('onboarding.project.roots')}
                  title={t('onboarding.project.roots')}
                >
                  <Home className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  disabled={!currentPath}
                  onClick={() => {
                    const parent = getParentPath(currentPath);
                    if (parent) void loadDirectory(parent);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t('onboarding.project.up')}
                  title={t('onboarding.project.up')}
                >
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  disabled={!currentPath || pathLoading || directoryMutating}
                  onClick={() => void createProjectDirectory()}
                  className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={t('sidebar.newFolder')}
                  title={t('sidebar.newFolder')}
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
                {pathLoading ? (
                  <div className="px-1 py-2 font-mono text-[12px] text-[#768295]">
                    {t('onboarding.project.loading')}
                  </div>
                ) : entries.length === 0 ? (
                  <div className="px-1 py-2 font-mono text-[12px] text-[#768295]">
                    {t('onboarding.project.empty')}
                  </div>
                ) : (
                  entries.map((entry) => {
                    const Icon = entry.is_directory ? Folder : FileText;
                    const selected = entry.path === projectPath.trim();
                    const isRenaming = renamingDirectoryPath === entry.path;
                    return (
                      <div
                        key={`${entry.path}-${directoryEntryTime(entry)}`}
                        className={cn(
                          'group/path-entry flex items-center rounded-[6px] border border-transparent px-2',
                          selected &&
                            'border-white/[0.08] border-l-white/[0.28] bg-white/[0.05]',
                        )}
                      >
                        {isRenaming ? (
                          <>
                            <div className="flex min-h-6 min-w-0 flex-1 items-center gap-2 py-0.5">
                              <Folder
                                className="h-3 w-3 shrink-0 text-[#768295]"
                                strokeWidth={1.5}
                              />
                              <input
                                className="h-6 min-w-0 flex-1 rounded-[4px] border border-white/[0.18] bg-[#171819] px-2 font-mono text-[11px] tracking-[0.02em] text-[#f5f5f5] outline-none focus:border-white/[0.32]"
                                value={renamingDirectoryName}
                                onChange={(event) =>
                                  setRenamingDirectoryName(event.target.value)
                                }
                                onKeyDown={handleDirectoryRenameKeyDown}
                                onClick={(event) => event.stopPropagation()}
                                disabled={directoryMutating}
                                aria-label={t('sidebar.folderName')}
                                autoFocus
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => void commitDirectoryRename()}
                              disabled={directoryMutating}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-45"
                              aria-label={t('sidebar.saveFolderName')}
                              title={t('sidebar.saveFolderName')}
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              type="button"
                              onClick={resetDirectoryRename}
                              disabled={directoryMutating}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[#768295] transition hover:bg-white/[0.05] hover:text-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-45"
                              aria-label={t('sidebar.cancelFolderRename')}
                              title={t('sidebar.cancelFolderRename')}
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={!entry.is_directory}
                              onClick={() => {
                                if (entry.is_directory) void loadDirectory(entry.path);
                              }}
                              className="flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left font-mono text-[11px] leading-none tracking-[0.02em] text-[#8A8F98] transition hover:text-[#f5f5f5] disabled:cursor-default disabled:opacity-55"
                            >
                              <Icon
                                className="h-3 w-3 shrink-0 text-[#768295]"
                                strokeWidth={1.5}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {entry.name}
                              </span>
                              {entry.is_git_repo && (
                                <span className="inline-flex h-4 items-center rounded-[3px] border border-emerald-300/[0.14] bg-emerald-400/[0.06] px-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-emerald-200/55">
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
                                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[#768295] opacity-0 transition hover:bg-white/[0.05] hover:text-[#f5f5f5] group-hover/path-entry:opacity-100',
                                  selected && '!opacity-100',
                                )}
                                aria-label={t('onboarding.project.select')}
                                title={t('onboarding.project.select')}
                              >
                                <Check
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.5}
                                />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
                {renameDirectoryError && (
                  <div className="px-1 py-2 font-mono text-[12px] text-red-400">
                    {renameDirectoryError}
                  </div>
                )}
              </div>
            </section>
          </section>

          <aside className="flex min-h-0 flex-col lg:pl-6">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4">
              <label className="block font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#8A8F98]">
                {t('onboarding.project.selectedPath')}
                <input
                  value={projectPath}
                  onChange={(event) => {
                    setProjectPath(event.target.value);
                    setProjectStatus(null);
                  }}
                  className={cn(
                    onboardingProjectInputClassName,
                    'h-8 truncate text-[12px] normal-case tracking-[0.03em] text-[#d4d4d8]',
                  )}
                  placeholder={t('onboarding.project.pathPlaceholder')}
                />
              </label>

              {!projectPath.trim() && (
                <p className="font-mono text-[12px] leading-relaxed tracking-[0.03em] text-[#768295]">
                  {t('onboarding.project.pathPrompt')}
                </p>
              )}

              {projectPath.trim() && pathDetecting && (
                <p className="font-mono text-[12px] tracking-[0.03em] text-[#768295]">
                  {t('onboarding.project.detecting')}
                </p>
              )}

              {projectPath.trim() &&
                !pathDetecting &&
                projectStatus?.valid &&
                projectStatus.is_git_repo && (
                  <p className="inline-flex w-fit items-center gap-2 rounded-[4px] border border-emerald-300/[0.14] bg-emerald-400/[0.06] px-2 py-1 font-mono text-[11px] tracking-[0.03em] text-emerald-200/60">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/50" />
                    {t('onboarding.project.gitDetected')}
                  </p>
                )}

              {projectPath.trim() &&
                !pathDetecting &&
                projectStatus?.valid &&
                !projectStatus.is_git_repo && (
                  <div className="grid grid-rows-[1fr] border-t border-white/[0.05] pt-4 transition-[grid-template-rows] duration-200">
                    <div className="space-y-4 overflow-hidden">
                      <p className="flex items-start gap-2 font-mono text-[12px] leading-relaxed tracking-[0.03em] text-[#8f9aaa]">
                        <Info
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#768295]"
                          strokeWidth={1.5}
                        />
                        <span>{t('onboarding.project.gitMissing')}</span>
                      </p>
                      <label className="group flex cursor-pointer items-center gap-2 font-mono text-[12px] tracking-[0.03em] text-[#c9d2df]">
                        <input
                          type="checkbox"
                          checked={initializeGit}
                          onChange={(event) =>
                            setInitializeGit(event.target.checked)
                          }
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center border bg-[#151617] transition-[background-color,border-color,box-shadow,color] peer-focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_0_0_4px_rgba(94,106,210,0.12)]',
                            initializeGit
                              ? 'border-white bg-white text-[#0E0F11]'
                              : 'border-white/[0.22] text-transparent group-hover:border-white/[0.36]',
                          )}
                        >
                          <Check
                            className={cn(
                              'h-3 w-3 transition-opacity',
                              initializeGit ? 'opacity-100' : 'opacity-0',
                            )}
                            strokeWidth={2.3}
                          />
                        </span>
                        {t('onboarding.project.initializeGit')}
                      </label>
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200',
                          initializeGit ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                      >
                        <label className="block overflow-hidden font-mono text-[12px] tracking-[0.03em] text-[#a1a1aa]">
                          {t('onboarding.project.gitignoreTemplate')}
                          <DropdownSelect
                            value={gitignoreTemplate}
                            options={gitignoreOptions}
                            showSearch={false}
                            className={onboardingProjectSelectClassName}
                            panelClassName="[&_*]:!text-[12px] [&_[role=listbox]]:!py-0.5 [&_[role=option]]:!px-2 [&_[role=option]]:!py-1"
                            maxPanelHeightClassName="max-h-[144px]"
                            onChange={(value) =>
                              setGitignoreTemplate(value as GitignoreTemplate)
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
            <div className="mt-4 flex min-h-[42px] shrink-0 items-end justify-between gap-3 pt-2">
              <div className="min-w-0 flex-1">
                {projectConfigurationError && (
                  <p className="font-mono text-[12px] leading-relaxed tracking-[0.03em] text-red-400">
                    {projectConfigurationError}
                  </p>
                )}
              </div>
              {showInitializeGitAction && (
                <button
                  type="button"
                  onClick={() => void handleInitializeProjectGit()}
                  disabled={saving || pathDetecting}
                  className="inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-white/[0.14] bg-white/[0.06] px-3 font-mono text-[11px] font-medium tracking-[0.03em] text-[#d4d4d8] transition hover:border-white/[0.24] hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('onboarding.project.initializeAction')}
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
    );
  };

  const renderAppearanceStep = () => {
    const languageOptions: Array<{ id: Locale; label: string }> = [
      { id: 'zh', label: t('language.zh') },
      { id: 'en', label: t('language.en') },
      { id: 'ja', label: t('language.ja') },
      { id: 'ko', label: t('language.ko') },
      { id: 'fr', label: t('language.fr') },
      { id: 'es', label: t('language.es') },
    ];
    const appearanceOptions: Array<{
      id: OnboardingAppearance;
      label: string;
      Icon: LucideIcon;
    }> = [
      {
        id: OnboardingAppearance.dark,
        label: t('onboarding.appearance.dark'),
        Icon: Moon,
      },
      {
        id: OnboardingAppearance.light,
        label: t('onboarding.appearance.light'),
        Icon: Sun,
      },
      {
        id: OnboardingAppearance.system,
        label: t('onboarding.appearance.system'),
        Icon: Monitor,
      },
    ];

    return (
      <div className="flex h-[340px] items-center justify-center">
        <div className="h-full w-full max-w-[820px] rounded-[8px] border border-white/[0.08] bg-[#1A1A1A]/90 px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] sm:px-7 sm:py-6">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.84fr)] lg:gap-10">
            <section className="space-y-3">
              <h3 className="font-mono text-[12px] font-medium tracking-[0] text-[#a1a1aa]">
                {t('onboarding.appearance.languageTitle')}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {languageOptions.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'group flex h-10 cursor-pointer items-center gap-2 rounded-[6px] border px-3 text-[13px] transition',
                      selectedLocale === option.id
                        ? 'border-white/[0.14] bg-white/[0.07] text-[#f4f4f5] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]'
                        : 'border-transparent bg-transparent text-[#8a8f98] hover:bg-white/[0.04] hover:text-[#e4e4e7]',
                    )}
                  >
                    <input
                      type="radio"
                      name="onboarding-language"
                      value={option.id}
                      checked={selectedLocale === option.id}
                      onChange={() => handleLocaleSelect(option)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-3 w-3 shrink-0 items-center justify-center rounded-full border transition-colors',
                        selectedLocale === option.id
                          ? 'border-[#d4d4d8]'
                          : 'border-white/[0.18] group-hover:border-white/[0.28]',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full transition-colors',
                          selectedLocale === option.id
                            ? 'bg-[#d4d4d8]'
                            : 'bg-transparent',
                        )}
                      />
                    </span>
                    <span className="truncate">{option.label}</span>
                  </label>
                ))}
              </div>
            </section>
            <section className="space-y-4">
              <h3 className="font-mono text-[12px] font-medium tracking-[0] text-[#a1a1aa]">
                {t('onboarding.appearance.themeTitle')}
              </h3>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                {appearanceOptions.map((option) => {
                  const selected = selectedAppearance === option.id;
                  const lightPreview = option.id === OnboardingAppearance.light;
                  const systemPreview = option.id === OnboardingAppearance.system;
                  const Icon = option.Icon;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleAppearanceSelect(option)}
                      className={cn(
                        'cursor-pointer rounded-[8px] border p-2 text-left transition',
                        selected
                          ? 'border-[#d4d4d8]/80 bg-white/[0.07] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_18px_rgba(255,255,255,0.025)]'
                          : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]',
                      )}
                    >
                      <div
                        className={cn(
                          'flex h-8 items-center justify-between rounded-[8px] border px-2.5',
                          lightPreview
                            ? 'border-black/[0.08] bg-[#e4e4e7]'
                            : systemPreview
                              ? 'border-white/[0.08] bg-[#151516]'
                              : 'border-white/[0.08] bg-[#0d0d0e]',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5',
                            lightPreview
                              ? 'text-[#52525b]'
                              : systemPreview
                                ? 'text-[#b8bcc6]'
                                : 'text-[#a1a1aa]',
                          )}
                          strokeWidth={1.4}
                        />
                        <div className="flex items-end gap-1">
                          <span
                            className={cn(
                              'h-2 w-3.5 rounded-[2px]',
                              lightPreview
                                ? 'bg-black/[0.18]'
                                : systemPreview
                                  ? 'bg-white/[0.14]'
                                  : 'bg-white/[0.16]',
                            )}
                          />
                          <span
                            className={cn(
                              'h-3 w-3.5 rounded-[2px]',
                              lightPreview
                                ? 'bg-black/[0.24]'
                                : systemPreview
                                  ? 'bg-[#d4d4d8]/70'
                                  : 'bg-white/[0.22]',
                            )}
                          />
                          <span
                            className={cn(
                              'h-1.5 w-3.5 rounded-[2px]',
                              lightPreview
                                ? 'bg-black/[0.12]'
                                : systemPreview
                                  ? 'bg-white/[0.09]'
                                  : 'bg-white/[0.1]',
                            )}
                          />
                        </div>
                      </div>
                      <p
                        className={cn(
                          'mt-1.5 text-[12px] font-semibold',
                          selected ? 'text-[#f4f4f5]' : 'text-[#a1a1aa]',
                        )}
                      >
                        {option.label}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
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
      <div
        className="relative isolate flex min-h-0 flex-1 flex-col items-center overflow-hidden px-6 text-center"
        style={onboardingTextFont}
      >
        <div className="pointer-events-none absolute inset-0 bg-[#0E0F11]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.032] mix-blend-screen"
          style={onboardingNoiseTextureStyle}
        />

        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-y-auto py-8">
          <div className="relative flex gap-2">
            {onboardingSteps.map((step, index) => {
              const current = index === activeStepIndex;
              const completed = index < activeStepIndex;
              return (
                <div
                  key={step}
                  className={cn(
                    'h-[2px] w-10 rounded-none transition-colors duration-150',
                    current
                      ? 'bg-[#f4f4f5]'
                      : completed
                        ? 'bg-white/[0.28]'
                        : 'bg-white/[0.15]',
                  )}
                />
              );
            })}
          </div>

          <div className="mt-9 max-w-4xl">
            <h1 className="text-[25px] font-[600] leading-tight tracking-[0] text-[#f4f4f5]">
              {stepTitle}
            </h1>
            <p
              className={cn(
                'mx-auto mt-2 max-w-3xl text-[12px] leading-relaxed tracking-[0]',
                stepKey === 'project_path' ? 'text-[#8A8F98]' : 'text-[#a1a1aa]',
              )}
            >
              {stepDescription}
            </p>
          </div>

          <div className="relative mt-7 w-full max-w-5xl p-0 text-left">
            <div
              className={cn(
                'relative transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform motion-reduce:transform-none motion-reduce:transition-none',
                configurationMotionState === 'slide-out' &&
                  '-translate-x-8 opacity-0',
                configurationMotionState === 'slide-in' &&
                  'translate-x-6 opacity-0',
                configurationMotionState === 'idle' && 'translate-x-0 opacity-100',
              )}
            >
              {renderActiveConfigurationContent(renderedConfigurationStepKey)}
            </div>
          </div>

          {error && stepKey !== 'project_path' && (
            <p className="mt-4 max-w-3xl text-center text-[12px] leading-relaxed text-red-300">
              {error}
            </p>
          )}

          <div className="mt-12 flex min-h-10 w-full max-w-5xl flex-col items-center gap-4 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="flex min-h-10 flex-wrap items-center justify-center gap-3 leading-none sm:justify-start">
              <button
                type="button"
                onClick={() => {
                  if (saving) return;
                  void handleSkip();
                }}
                aria-disabled={saving}
                className="inline-flex h-10 cursor-pointer items-center justify-center px-0 py-2 text-[12px] font-medium leading-none text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
              >
                {t('onboarding.action.skip')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (saving || activeStepIndex === 0) return;
                  handleStepBack();
                }}
                aria-disabled={saving || activeStepIndex === 0}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium leading-none text-[rgba(255,255,255,0.35)] transition-colors hover:text-white"
              >
                {t('onboarding.action.back')}
                <span className="inline-flex items-center gap-1 font-mono text-[10px] leading-none text-white/35">
                  <kbd className="inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[3px] border border-white/[0.06] bg-white/[0.035] px-1.5 leading-none text-white/35">
                    Esc
                  </kbd>
                </span>
              </button>
            </div>
            <p className="flex min-h-10 items-center justify-center font-mono text-[10px] leading-none uppercase tracking-[0.12em] text-[#7d8aa3]">
              Step {activeStepIndex + 1} of {onboardingSteps.length}: {stepLabel}
            </p>
            <div className="flex min-h-10 items-center justify-center sm:justify-end">
              <button
                type="button"
                onClick={() => void handleStepNext()}
                disabled={saving}
                className={cn(
                  stepKey === finalOnboardingStep
                    ? 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2.5 rounded-[4px] border border-white bg-[linear-gradient(180deg,#FFFFFF_0%,#F2F2F2_100%)] px-6 py-2 text-[13px] font-semibold text-black shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.28)] transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[linear-gradient(180deg,#FFFFFF_0%,#EDEDED_100%)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60'
                    : 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2.5 rounded-[4px] border border-white bg-white px-6 py-2 text-[13px] font-semibold text-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.92)] transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[#f2f2f2] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60',
                  stepKey === 'scenario' &&
                    'origin-center will-change-transform hover:-translate-y-[2px] hover:scale-[1.02] hover:shadow-[0_12px_30px_rgba(255,255,255,0.18)] active:translate-y-[1px] active:scale-[0.98] motion-reduce:transform-none',
                )}
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {stepKey === finalOnboardingStep
                  ? t('onboarding.action.startNow')
                  : t('onboarding.action.next')}
                <kbd className="inline-flex h-[18px] items-center rounded-[3px] border-0 bg-[rgba(0,0,0,0.05)] px-1.5 font-mono text-[10px] font-medium leading-none text-black/40 shadow-none">
                  Enter <span aria-hidden="true">&#8617;</span>
                </kbd>
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
          <div className="pointer-events-none absolute inset-0 bg-[#0E0F11]" />

          <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-10 pt-10">
            <div className="mt-16 max-w-4xl">
              <h1 className="font-sans text-[48px] font-semibold leading-[1.06] tracking-[0] text-[#f5f5f5]">
                {t('onboarding.welcome.title')}
              </h1>
              <p className="mx-auto mt-5 max-w-3xl text-[18px] leading-relaxed text-[#a8b3c2]">
                {t('onboarding.welcome.desc')}
              </p>
            </div>

            <div className="relative mt-14 flex min-h-[440px] w-full max-w-5xl flex-col overflow-hidden rounded-[8px] border border-white/[0.12] bg-[#1A1A1A]/90 p-px shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.025]"
                style={onboardingNoiseTextureStyle}
              />
              <div className="relative z-10 flex items-center gap-2 border-b border-white/[0.08] bg-[#1A1A1A]/90 px-4 py-3">
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-white/[0.065]" />
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-white/[0.065]" />
                <div className="h-2 w-2 rounded-full border border-white/[0.18] bg-white/[0.065]" />
                <div className="ml-4 h-3 w-32 rounded-[3px] border border-white/[0.08] bg-white/[0.065]" />
              </div>

              <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 py-10 sm:px-20">
                <div className="w-full max-w-md -translate-y-4 overflow-hidden rounded-[6px] border border-white/[0.12] bg-[#151617]/95 text-left">
                  <div className="flex items-center border-b border-white/[0.08] p-4">
                    <span className="mr-3 font-mono text-[15px] text-[#a8b3c2]">/</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#f5f5f5]">
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
                              : 'border-transparent text-[#8792a3] hover:border-white/[0.08] hover:bg-white/[0.035] hover:text-[#f5f5f5]',
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
        style={{ ...onboardingDarkThemeVars, ...onboardingTextFont }}
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
      style={{ ...onboardingDarkThemeVars, ...onboardingTextFont }}
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
