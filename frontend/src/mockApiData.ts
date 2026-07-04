import type {
  Locale,
  Member,
  Message,
  Provider,
  Session,
  SidebarBuildStats,
  SidebarNavigationItem,
  SidebarPrimaryAction,
  SidebarProjectDisplay,
  Strategy,
} from '@/types';

export type OnboardType = 'saas' | 'cli' | 'game' | 'ai';

export interface WorkspaceBootstrapMock {
  members: Member[];
  sessions: Session[];
  messagesBySession: Record<string, Message[]>;
  providers: Provider[];
  strategies: Strategy[];
  agentRepliesByMention: Record<string, string[]>;
  defaults: {
    activeSessionId: string;
    selectedStrategyId: string;
    selectedOnboardType: OnboardType;
    smartRouting: boolean;
    showCost: boolean;
    showExplanation: boolean;
    warnOverDollar: boolean;
    weeklyCost: number;
    weeklySaved: number;
    earlyBirdLeft: number;
    activeSettingsTab: string;
    toastDurationMs: number;
  };
}

export interface WorkflowPresetMock {
  id: 'feature' | 'bug' | 'chat';
  toast: string;
}

export interface OnboardingTeamMock {
  roles: Array<{ id: string; name: string; model: string; avatar: string }>;
  tip: string;
}

export interface DialogOptionsMock {
  taskTemplate: {
    title: string;
    details: string;
    chosenMembers: string[];
  };
  memberTemplate: {
    name: string;
    model: string;
  };
  providerTemplate: {
    name: string;
    key: string;
  };
  roleChips: Array<{ name: string; avatar: string }>;
  modelOptions: Array<{ value: string; label: string }>;
}

export interface SettingsOptionsMock {
  languages: Array<{ code: Locale; label: string }>;
  account: {
    email: string;
    roleLevel: string;
    keyStatus: string;
  };
  menu: Array<{
    section: string;
    items: Array<{ id: string; label: string; icon: string; disabled?: boolean }>;
  }>;
}

export interface ShellOptionsMock {
  projects: SidebarProjectDisplay[];
  primaryActions: SidebarPrimaryAction[];
  buildStats: SidebarBuildStats;
  projectManagementItems: SidebarNavigationItem[];
  systemItems: SidebarNavigationItem[];
  shipCounter: {
    features: number;
    bugsFixed: number;
  };
  repoLabel: string;
  contextFiles: string[];
}

export const mockWorkspaceBootstrap: WorkspaceBootstrapMock = {
  members: [
    { id: 'mem-1', avatar: 'LD', status: 'on', name: '@lead', roleDetail: 'Claude - idle', modelName: 'Claude' },
    { id: 'mem-2', avatar: 'BE', status: 'on', name: '@backend', roleDetail: 'Codex - done', modelName: 'Codex' },
    { id: 'mem-3', avatar: 'FE', status: 'run', name: '@frontend', roleDetail: 'Cursor - coding', modelName: 'Cursor' },
    { id: 'mem-4', avatar: 'QA', status: 'i', name: '@qa', roleDetail: 'Gemini - waiting', modelName: 'Gemini' },
    { id: 'mem-5', avatar: 'UX', status: 'on', name: '@designer', roleDetail: 'Figma - reviewing', modelName: 'Figma' },
    { id: 'mem-6', avatar: 'DB', status: 'i', name: '@database', roleDetail: 'Postgres - idle', modelName: 'Postgres' },
    { id: 'mem-7', avatar: 'SE', status: 'on', name: '@security', roleDetail: 'Claude - checking', modelName: 'Claude' },
    { id: 'mem-8', avatar: 'DO', status: 'run', name: '@devops', roleDetail: 'Codex - deploying', modelName: 'Codex' },
    { id: 'mem-9', avatar: 'PM', status: 'i', name: '@product', roleDetail: 'GPT - waiting', modelName: 'GPT' },
  ],
  sessions: [
    { id: 'sess-1', title: 'Fix login flicker', icon: 'bug', active: true },
    { id: 'sess-2', title: 'Stripe checkout', icon: 'credit-card', active: false },
    { id: 'sess-3', title: 'Deploy v0.3.2', icon: 'package', active: false },
    { id: 'sess-4', title: 'Release notes', icon: 'file-text', active: false },
    { id: 'sess-5', title: 'Quick: env var?', icon: 'message-square', active: false },
    { id: 'sess-6', title: 'Refactor auth guard', icon: 'shield', active: false },
    { id: 'sess-7', title: 'Profile API review', icon: 'route', active: false },
    { id: 'sess-8', title: 'Billing copy polish', icon: 'file-text', active: false },
    { id: 'sess-9', title: 'Mobile drawer QA', icon: 'smartphone', active: false },
    { id: 'sess-10', title: 'Tab layout tuning', icon: 'layout-panel-top', active: false },
    { id: 'sess-11', title: 'Sidebar density pass', icon: 'panel-left', active: false },
    { id: 'sess-12', title: 'Theme contrast audit', icon: 'swatch-book', active: false },
    { id: 'sess-13', title: 'Command palette spec', icon: 'terminal-square', active: false },
    { id: 'sess-14', title: 'Agent handoff notes', icon: 'notebook-tabs', active: false },
  ],
  messagesBySession: {
    'sess-1': [
      {
        id: 'msg-1',
        avatar: 'YOU',
        sender: 'You',
        time: '2m ago',
        text: '@claude the user avatar flickers right after login. Happens only on slow networks. Check AvatarLoader.tsx please.',
        isUser: true,
      },
      {
        id: 'msg-2',
        avatar: 'CL',
        sender: '@claude',
        model: 'Claude',
        time: '2m ago',
        text: "Looked at `AvatarLoader.tsx`. The flicker happens because the component renders with `src=\"\"` for one frame before the user data loads. Two fixes possible:\n\n1. Show a placeholder skeleton while loading\n2. Don't render until user data arrives\n\nI'd suggest option 1 - keeps layout stable. Want me to ask @codex to implement?",
      },
      {
        id: 'msg-3',
        avatar: 'YOU',
        sender: 'You',
        time: '1m ago',
        text: 'Yes go with option 1. @codex please implement.',
        isUser: true,
      },
      {
        id: 'msg-4',
        avatar: 'CO',
        sender: '@codex',
        model: 'Codex',
        time: 'just now',
        text: 'On it. Reading `AvatarLoader.tsx` and `UserProfile.tsx` for context.',
        isThinking: true,
      },
    ],
    'sess-2': [
      {
        id: 'msg-stripe-1',
        avatar: 'YOU',
        sender: 'You',
        time: '10m ago',
        text: 'Let us start preparing the checkout flow with @lead and @backend.',
        isUser: true,
      },
      {
        id: 'msg-stripe-2',
        avatar: 'LD',
        sender: '@lead',
        model: 'Claude 3.5 Sonnet',
        time: '8m ago',
        text: 'Drafting initial DAG plan to configure Stripe hosted sessions. We will split tasks into schema definitions, client-side button triggers, and webhook handlers.',
      },
    ],
    'sess-3': [
      {
        id: 'msg-dep-1',
        avatar: 'YOU',
        sender: 'You',
        time: '1h ago',
        text: 'Check if we are ready to tag and build production v0.3.2.',
        isUser: true,
      },
      {
        id: 'msg-dep-2',
        avatar: 'QA',
        sender: '@qa',
        model: 'Gemini 1.5 Pro',
        time: '50m ago',
        text: 'All staging integration tests passed. Performance curves look optimal on latency tests. Ready to ship and deploy.',
      },
    ],
    'sess-4': [
      {
        id: 'msg-rel-1',
        avatar: 'YOU',
        sender: 'You',
        time: '2h ago',
        text: 'Compile list of feature rollouts since v0.3.1 for the changelog.',
        isUser: true,
      },
    ],
    'sess-5': [
      {
        id: 'msg-env-1',
        avatar: 'YOU',
        sender: 'You',
        time: '3h ago',
        text: 'Quick question: does GEMINI_API_KEY need to be public?',
        isUser: true,
      },
      {
        id: 'msg-env-2',
        avatar: 'CL',
        sender: '@claude',
        model: 'Claude 3.5 Sonnet',
        time: '3h ago',
        text: 'Absolutely not. Keep its visibility server-side ONLY. Never prefix it with `VITE_` to protect it against leak onto standard client bundle builds.',
      },
    ],
    'sess-6': [
      {
        id: 'msg-auth-1',
        avatar: 'YOU',
        sender: 'You',
        time: '4h ago',
        text: 'Check whether the auth guard can be simplified before the next release.',
        isUser: true,
      },
    ],
    'sess-7': [
      {
        id: 'msg-profile-1',
        avatar: 'YOU',
        sender: 'You',
        time: '5h ago',
        text: 'Review the profile API response mapping and flag any frontend-only assumptions.',
        isUser: true,
      },
    ],
    'sess-8': [
      {
        id: 'msg-billing-copy-1',
        avatar: 'YOU',
        sender: 'You',
        time: '6h ago',
        text: 'Polish billing page copy so the upgrade path stays concise.',
        isUser: true,
      },
    ],
    'sess-9': [
      {
        id: 'msg-mobile-drawer-1',
        avatar: 'YOU',
        sender: 'You',
        time: '7h ago',
        text: 'Run a focused QA pass on the mobile drawer and sidebar density.',
        isUser: true,
      },
    ],
    'sess-10': [
      {
        id: 'msg-tab-layout-1',
        avatar: 'YOU',
        sender: 'You',
        time: '8h ago',
        text: 'Tune the top tab behavior so it stays compact while still supporting more open sessions.',
        isUser: true,
      },
    ],
    'sess-11': [
      {
        id: 'msg-sidebar-density-1',
        avatar: 'YOU',
        sender: 'You',
        time: '9h ago',
        text: 'Review sidebar spacing after the latest density pass and flag anything that feels crowded.',
        isUser: true,
      },
    ],
    'sess-12': [
      {
        id: 'msg-theme-contrast-1',
        avatar: 'YOU',
        sender: 'You',
        time: '10h ago',
        text: 'Audit dark and light mode contrast for the new rounded workspace shell.',
        isUser: true,
      },
    ],
    'sess-13': [
      {
        id: 'msg-command-palette-1',
        avatar: 'YOU',
        sender: 'You',
        time: '11h ago',
        text: 'Draft the command palette interaction spec before we wire it into global shortcuts.',
        isUser: true,
      },
    ],
    'sess-14': [
      {
        id: 'msg-handoff-1',
        avatar: 'YOU',
        sender: 'You',
        time: '12h ago',
        text: 'Summarize agent handoff expectations so workflow ownership remains clear between sessions.',
        isUser: true,
      },
    ],
  },
  providers: [
    { id: 'prov-1', monogram: 'CL', name: 'Claude', keyMask: 'mock-key-cl-****', lastUsed: '2m ago', active: true },
    { id: 'prov-2', monogram: 'CO', name: 'Codex', keyMask: 'mock-key-co-****', lastUsed: '1m ago', active: true },
    { id: 'prov-3', monogram: 'CU', name: 'Cursor', keyMask: 'mock-key-cu-****', lastUsed: 'just now', active: true },
    { id: 'prov-4', monogram: 'GE', name: 'Gemini', keyMask: 'mock-key-ge-****', lastUsed: '8m ago', active: true },
  ],
  strategies: [
    { id: 'strat-1', name: 'Smart routing', description: 'recommended - learns from your data', hint: 'Auto', recommended: true },
    { id: 'strat-2', name: 'Cost-first', description: 'always pick the cheapest model', hint: '1' },
    { id: 'strat-3', name: 'Quality-first', description: 'always pick the best model', hint: '2' },
    { id: 'strat-4', name: 'Speed-first', description: 'fastest model that can do the job', hint: '3' },
    { id: 'strat-5', name: 'Custom rules', description: 'define routing per task type', hint: '4' },
  ],
  agentRepliesByMention: {
    '@claude': [
      "I've analyzed the current file paths. The solution looks straightforward. If you'd like, I can write the full template layout to keep it highly robust.",
      'That makes perfect sense in terms of modular structure. I suggest creating a dedicated helper utility to manage the state updates smoothly.',
      'Thanks for tagging me. The client-only routing should stay fully consistent so all prototypes render without flicker.',
    ],
    '@codex': [
      'Code representation updated. I am structuring the React state hook so that adding elements triggers subtle transitions.',
      'Drafting the code changes now. Imports are aligned and standard Lucide icons are used for responsiveness.',
      'I can handle the background processing or simulate the network delays. Should we write an automatic state transitioner?',
    ],
    '@frontend': [
      'Layout polished with Tailwind utility classes. Contrast is verified for readable text.',
      'Applying the four-step surface ladder design approach from the openteams spec.',
      'Adding hover states and micro-interactions for the interactive surface.',
    ],
    '@qa': [
      'Running checks. The current surface compiles without visible TypeScript warning traces.',
      'Integration scenario validated. Locale switching should be checked with long strings.',
      'Let us verify long-message wrapping and token swatch updates across themes.',
    ],
    default: [
      "Understood. I've logged the action step into workspace tracking.",
      'I will coordinate this request with the rest of the team.',
      'Proceeding with this decision and turning the topic into a structured workflow pipeline.',
    ],
  },
  defaults: {
    activeSessionId: 'sess-1',
    selectedStrategyId: 'strat-1',
    selectedOnboardType: 'saas',
    smartRouting: true,
    showCost: true,
    showExplanation: true,
    warnOverDollar: false,
    weeklyCost: 8.42,
    weeklySaved: 4.2,
    earlyBirdLeft: 37,
    activeSettingsTab: 'appearance',
    toastDurationMs: 3000,
  },
};

export const mockWorkflowPresets: WorkflowPresetMock[] = [
  {
    id: 'feature',
    toast: 'Applied Preset: Ship Feature Workflow successfully.',
  },
  {
    id: 'bug',
    toast: 'Applied Preset: Critical Patch Bug Workflow successfully.',
  },
  {
    id: 'chat',
    toast: 'Chat converted into workflow.',
  },
];

export const mockOnboardingTeams: Record<OnboardType, OnboardingTeamMock> = {
  cli: {
    roles: [
      { id: 'cli-1', name: 'Lead', model: 'Claude 3.5 Sonnet', avatar: 'LD' },
      { id: 'cli-2', name: 'CLI core', model: 'Codex', avatar: 'BE' },
      { id: 'cli-3', name: 'Docs writer', model: 'Llama 3 70B', avatar: 'DC' },
    ],
    tip: 'CLI setups optimize for package compilers and test run pipelines.',
  },
  game: {
    roles: [
      { id: 'g1', name: 'Director', model: 'Claude 3.5 Sonnet', avatar: 'DR' },
      { id: 'g2', name: 'Unity Engine', model: 'GPT-4o', avatar: 'UN' },
      { id: 'g3', name: 'Asset pipeline', model: 'Gemini 1.5 Pro', avatar: 'AS' },
      { id: 'g4', name: 'QA player', model: 'Gemini 1.5 Flash', avatar: 'QA' },
    ],
    tip: 'Game setups support WebGL compile tests and state handlers.',
  },
  ai: {
    roles: [
      { id: 'ai-1', name: 'Architect', model: 'Claude 3.5 Sonnet', avatar: 'AR' },
      { id: 'ai-2', name: 'LLM Prompting', model: 'Gemini 1.5 Pro', avatar: 'PR' },
      { id: 'ai-3', name: 'Security agent', model: 'Claude 3 Opus', avatar: 'SE' },
    ],
    tip: 'AI products automatically evaluate model latency and API tokens.',
  },
  saas: {
    roles: [
      { id: 's1', name: 'Lead', model: 'Claude 3.5 Sonnet', avatar: 'LD' },
      { id: 's2', name: 'Backend', model: 'Codex', avatar: 'BE' },
      { id: 's3', name: 'Frontend', model: 'Cursor', avatar: 'FE' },
      { id: 's4', name: 'QA Tester', model: 'Gemini 1.5 Pro', avatar: 'QA' },
    ],
    tip: 'SaaS layout allocates frontend tasks to Cursor and backend nodes to Codex.',
  },
};

export const mockDialogOptions: DialogOptionsMock = {
  taskTemplate: {
    title: 'Add Stripe subscription checkout',
    details: 'Add monthly + annual plans. Use Stripe Checkout (not Elements). Test mode keys only.',
    chosenMembers: ['Lead', 'Backend', 'Frontend', 'QA'],
  },
  memberTemplate: {
    name: '@reviewer',
    model: 'Claude 3.5 Sonnet',
  },
  providerTemplate: {
    name: 'Anthropic Proxy',
    key: 'mock-provider-key',
  },
  roleChips: [
    { name: 'Lead', avatar: 'LD' },
    { name: 'Backend', avatar: 'BE' },
    { name: 'Frontend', avatar: 'FE' },
    { name: 'QA', avatar: 'QA' },
    { name: 'Security', avatar: 'SE' },
  ],
  modelOptions: [
    { value: 'Claude 3.5 Sonnet', label: 'Claude 3.5 Sonnet (Anthropic)' },
    { value: 'GPT-4o', label: 'GPT-4o (OpenAI)' },
    { value: 'Gemini 1.5 Pro', label: 'Gemini 1.5 Pro (Google)' },
    { value: 'DeepSeek Coder', label: 'DeepSeek V3 (DeepSeek)' },
    { value: 'Llama 3 70B', label: 'Llama 3 Instruct (Meta)' },
  ],
};

export const mockSettingsOptions: SettingsOptionsMock = {
  languages: [
    { code: 'zh', label: 'Chinese' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'fr', label: 'Francais' },
    { code: 'es', label: 'Espanol' },
  ],
  account: {
    email: 'mock-user@example.com',
    roleLevel: 'Workspace Creator',
    keyStatus: 'Active - Secured',
  },
  menu: [
    {
      section: 'Personal',
      items: [
        { id: 'account', label: 'Account', icon: 'user' },
        { id: 'appearance', label: 'Perferences', icon: 'sliders' },
        { id: 'notifications', label: 'Notifications', icon: 'bell' },
        { id: 'archived-sessions', label: 'Archived sessions', icon: 'archive' },
      ],
    },
    {
      section: 'AI',
      items: [
        { id: 'providers', label: 'Providers', icon: 'cpu' },
        { id: 'routing', label: 'Smart routing', icon: 'route', disabled: true },
        { id: 'presets', label: 'Team presets', icon: 'users', disabled: true },
      ],
    },
    {
      section: 'Integrations',
      items: [
        { id: 'github', label: 'GitHub', icon: 'github', disabled: true },
        { id: 'apikeys', label: 'API keys', icon: 'key', disabled: true },
      ],
    },
    {
      section: 'App',
      items: [
        { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard' },
        { id: 'experiments', label: 'Experiments', icon: 'flask', disabled: true },
      ],
    },
  ],
};

export const mockShellOptions: ShellOptionsMock = {
  projects: [
    {
      id: 'project-main',
      label: 'my-saas',
      active: true,
      monogram: 'MS',
      repository: 'indiebob/my-saas',
      description: 'SaaS workspace for checkout, auth, and release automation.',
    },
    {
      id: 'project-side',
      label: 'side-tool',
      active: false,
      monogram: 'ST',
      repository: 'indiebob/side-tool',
      description: 'Internal utility project used for local experiments.',
    },
  ],
  primaryActions: [
    {
      id: 'search',
      label: '搜索',
      icon: 'search',
      helper: '搜索当前项目的会话、事项、消息和隔离 worktree。',
    },
    {
      id: 'new-session',
      label: 'New session',
      icon: 'plus-circle',
      helper: 'Starts the UI flow only; no backend session is created here.',
    },
  ],
  buildStats: {
    title: 'Build stats',
    defaultExpanded: true,
    summary: '',
    stats: [
      {
        id: 'features',
        label: 'Features shipped',
        value: '5',
        helper: 'Feature delivery events in the last 7 days.',
        tone: 'success',
      },
      {
        id: 'bugs-fixed',
        label: 'Bugs fixed',
        value: '12',
        helper: 'Bugfix delivery events in the last 7 days.',
        tone: 'accent',
      },
      {
        id: 'weekly-spend',
        label: 'Weekly spend',
        value: '$8.42',
        helper: '7-day model cost in USD from token usage.',
        tone: 'warning',
      },
    ],
  },
  projectManagementItems: [
    {
      id: 'project-issue',
      label: 'Issues',
      icon: 'circle-dot',
      helper: 'View project issues.',
      targetPage: 'issue',
    },
    {
      id: 'member-configuration',
      label: 'Members',
      icon: 'users',
      helper: 'Configure project collaborators and agent roles.',
      targetPage: 'team',
    },
  ],
  systemItems: [
    {
      id: 'team-templates',
      label: 'Team templates',
      icon: 'users',
      helper: 'Review reusable team templates.',
      targetPage: 'team-templates',
    },
    {
      id: 'agent-runtime',
      label: 'Agent runtime',
      icon: 'bot',
      helper: 'Configure local agent runtimes and diagnostics.',
      targetPage: 'agents',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      helper: 'Provider keys, preferences, and local workspace settings.',
      targetPage: 'providers',
    },
  ],
  shipCounter: {
    features: 5,
    bugsFixed: 12,
  },
  repoLabel: 'indiebob/my-saas',
  contextFiles: ['AvatarLoader.tsx', 'UserProfile.tsx'],
};
