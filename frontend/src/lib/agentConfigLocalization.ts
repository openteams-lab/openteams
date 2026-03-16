import type { RJSFSchema } from '@rjsf/utils';
import { normalizeAppLanguageCode } from '@/i18n/languages';
import { toPrettyCase } from '@/utils/string';

type SupportedAgentConfigLanguage = 'en' | 'zh-Hans' | 'zh-Hant';

type FieldCopy = {
  label: string;
  description?: string;
};

type CreateConfigurationDialogCopy = {
  title: string;
  description: (executorType: string) => string;
  nameLabel: string;
  namePlaceholder: string;
  cloneLabel: string;
  clonePlaceholder: string;
  startBlank: string;
  cloneFrom: (configuration: string) => string;
  createButton: string;
  closeAriaLabel: string;
  errors: {
    empty: string;
    tooLong: string;
    invalid: string;
    exists: string;
  };
};

const FIELD_COPY: Record<
  SupportedAgentConfigLanguage,
  Partial<Record<string, FieldCopy>>
> = {
  en: {
    add_dir: { label: 'Add directory' },
    additional_params: {
      label: 'Additional parameters',
      description:
        'Extra command-line parameters appended to the executor command.',
    },
    agent: { label: 'Agent' },
    allow_all_tools: { label: 'Allow all tools' },
    allow_tool: { label: 'Allowed tools' },
    append_prompt: {
      label: 'Append prompt',
      description: 'Extra text appended to every prompt.',
    },
    approvals: { label: 'Approvals', description: 'Enable approval mode.' },
    ask_for_approval: {
      label: 'Ask for approval',
      description: 'Choose when the executor should request approval.',
    },
    auto_approve: { label: 'Auto approve' },
    auto_compact: { label: 'Auto compact' },
    autonomy: { label: 'Autonomy' },
    base_command_override: {
      label: 'Base command override',
      description: 'Override the base command with a custom command.',
    },
    base_instructions: { label: 'Base instructions' },
    claude_code_router: { label: 'Claude Code Router' },
    compact_prompt: { label: 'Compact prompt' },
    dangerously_allow_all: { label: 'Dangerously allow all' },
    dangerously_skip_permissions: { label: 'Dangerously skip permissions' },
    deny_tool: { label: 'Blocked tools' },
    developer_instructions: { label: 'Developer instructions' },
    disable_api_key: { label: 'Disable API key' },
    disable_mcp_server: { label: 'Disable MCP server' },
    env: {
      label: 'Environment variables',
      description:
        'Environment variables to set when running the executor.',
    },
    force: { label: 'Force' },
    include_apply_patch_tool: { label: 'Include apply_patch tool' },
    model: { label: 'Model' },
    model_provider: { label: 'Model provider' },
    model_reasoning_effort: {
      label: 'Reasoning effort',
      description: 'Reasoning effort for the underlying model.',
    },
    model_reasoning_summary: {
      label: 'Reasoning summary',
      description: 'Summary style for model reasoning.',
    },
    model_reasoning_summary_format: {
      label: 'Reasoning summary format',
      description: 'Output format for model reasoning summaries.',
    },
    oss: { label: 'OSS mode' },
    plan: { label: 'Plan mode' },
    profile: { label: 'Profile' },
    reasoning_effort: { label: 'Reasoning effort' },
    sandbox: {
      label: 'Sandbox',
      description: 'Sandbox policy for the executor.',
    },
    variant: { label: 'Variant' },
    yolo: { label: 'Yolo mode' },
  },
  'zh-Hans': {
    add_dir: { label: '附加目录' },
    additional_params: {
      label: '附加参数',
      description: '追加到执行器命令后的额外命令行参数。',
    },
    agent: { label: '代理' },
    allow_all_tools: { label: '允许全部工具' },
    allow_tool: { label: '允许的工具' },
    append_prompt: {
      label: '附加提示词',
      description: '会追加到每次提示词末尾的额外文本。',
    },
    approvals: { label: '审批模式', description: '启用审批模式。' },
    ask_for_approval: {
      label: '审批策略',
      description: '选择执行器何时需要请求审批。',
    },
    auto_approve: { label: '自动批准' },
    auto_compact: { label: '自动压缩' },
    autonomy: { label: '自治级别' },
    base_command_override: {
      label: '基础命令覆盖',
      description: '使用自定义命令覆盖默认基础命令。',
    },
    base_instructions: { label: '基础指令' },
    claude_code_router: { label: 'Claude Code 路由' },
    compact_prompt: { label: '压缩提示词' },
    dangerously_allow_all: { label: '危险：允许全部' },
    dangerously_skip_permissions: { label: '危险：跳过权限检查' },
    deny_tool: { label: '禁用的工具' },
    developer_instructions: { label: '开发者指令' },
    disable_api_key: { label: '禁用 API Key' },
    disable_mcp_server: { label: '禁用 MCP 服务' },
    env: {
      label: '环境变量',
      description: '运行执行器时注入的环境变量。',
    },
    force: { label: '强制执行' },
    include_apply_patch_tool: { label: '包含 apply_patch 工具' },
    model: { label: '模型' },
    model_provider: { label: '模型提供方' },
    model_reasoning_effort: {
      label: '推理强度',
      description: '底层模型的推理强度设置。',
    },
    model_reasoning_summary: {
      label: '推理摘要',
      description: '模型推理摘要的展示风格。',
    },
    model_reasoning_summary_format: {
      label: '推理摘要格式',
      description: '模型推理摘要的输出格式。',
    },
    oss: { label: 'OSS 模式' },
    plan: { label: '计划模式' },
    profile: { label: '配置档案' },
    reasoning_effort: { label: '推理强度' },
    sandbox: {
      label: '沙箱模式',
      description: '执行器使用的沙箱策略。',
    },
    variant: { label: '变体' },
    yolo: { label: 'Yolo 模式' },
  },
  'zh-Hant': {
    add_dir: { label: '附加目錄' },
    additional_params: {
      label: '附加參數',
      description: '追加到執行器命令後的額外命令列參數。',
    },
    agent: { label: '代理' },
    allow_all_tools: { label: '允許全部工具' },
    allow_tool: { label: '允許的工具' },
    append_prompt: {
      label: '附加提示詞',
      description: '會追加到每次提示詞末尾的額外文字。',
    },
    approvals: { label: '審批模式', description: '啟用審批模式。' },
    ask_for_approval: {
      label: '審批策略',
      description: '選擇執行器何時需要請求審批。',
    },
    auto_approve: { label: '自動批准' },
    auto_compact: { label: '自動壓縮' },
    autonomy: { label: '自治等級' },
    base_command_override: {
      label: '基礎命令覆蓋',
      description: '使用自訂命令覆蓋預設基礎命令。',
    },
    base_instructions: { label: '基礎指令' },
    claude_code_router: { label: 'Claude Code 路由' },
    compact_prompt: { label: '壓縮提示詞' },
    dangerously_allow_all: { label: '危險：允許全部' },
    dangerously_skip_permissions: { label: '危險：跳過權限檢查' },
    deny_tool: { label: '停用的工具' },
    developer_instructions: { label: '開發者指令' },
    disable_api_key: { label: '停用 API Key' },
    disable_mcp_server: { label: '停用 MCP 服務' },
    env: {
      label: '環境變數',
      description: '執行執行器時注入的環境變數。',
    },
    force: { label: '強制執行' },
    include_apply_patch_tool: { label: '包含 apply_patch 工具' },
    model: { label: '模型' },
    model_provider: { label: '模型提供方' },
    model_reasoning_effort: {
      label: '推理強度',
      description: '底層模型的推理強度設定。',
    },
    model_reasoning_summary: {
      label: '推理摘要',
      description: '模型推理摘要的顯示風格。',
    },
    model_reasoning_summary_format: {
      label: '推理摘要格式',
      description: '模型推理摘要的輸出格式。',
    },
    oss: { label: 'OSS 模式' },
    plan: { label: '計畫模式' },
    profile: { label: '設定檔案' },
    reasoning_effort: { label: '推理強度' },
    sandbox: {
      label: '沙箱模式',
      description: '執行器使用的沙箱策略。',
    },
    variant: { label: '變體' },
    yolo: { label: 'Yolo 模式' },
  },
};

const CREATE_CONFIGURATION_DIALOG_COPY: Record<
  SupportedAgentConfigLanguage,
  CreateConfigurationDialogCopy
> = {
  en: {
    title: 'Create New Configuration',
    description: (executorType) =>
      `Add a new configuration for the ${executorType} executor.`,
    nameLabel: 'Configuration name',
    namePlaceholder: 'e.g., PRODUCTION, DEVELOPMENT',
    cloneLabel: 'Clone from (optional)',
    clonePlaceholder: 'Start blank or clone existing',
    startBlank: 'Start blank',
    cloneFrom: (configuration) => `Clone from ${configuration}`,
    createButton: 'Create Configuration',
    closeAriaLabel: 'Close',
    errors: {
      empty: 'Configuration name cannot be empty',
      tooLong: 'Configuration name must be 40 characters or less',
      invalid:
        'Configuration name can only contain letters, numbers, underscores, and hyphens',
      exists: 'A configuration with this name already exists',
    },
  },
  'zh-Hans': {
    title: '新建配置',
    description: (executorType) => `为 ${executorType} 执行器添加新的配置。`,
    nameLabel: '配置名称',
    namePlaceholder: '例如 PRODUCTION、DEVELOPMENT',
    cloneLabel: '克隆自（可选）',
    clonePlaceholder: '从空白开始或克隆现有配置',
    startBlank: '从空白开始',
    cloneFrom: (configuration) => `从 ${configuration} 克隆`,
    createButton: '创建配置',
    closeAriaLabel: '关闭',
    errors: {
      empty: '配置名称不能为空',
      tooLong: '配置名称长度不能超过 40 个字符',
      invalid: '配置名称只能包含字母、数字、下划线和连字符',
      exists: '已存在同名配置',
    },
  },
  'zh-Hant': {
    title: '新增配置',
    description: (executorType) => `為 ${executorType} 執行器新增設定。`,
    nameLabel: '配置名稱',
    namePlaceholder: '例如 PRODUCTION、DEVELOPMENT',
    cloneLabel: '複製自（可選）',
    clonePlaceholder: '從空白開始或複製既有設定',
    startBlank: '從空白開始',
    cloneFrom: (configuration) => `從 ${configuration} 複製`,
    createButton: '建立配置',
    closeAriaLabel: '關閉',
    errors: {
      empty: '配置名稱不能為空',
      tooLong: '配置名稱長度不能超過 40 個字元',
      invalid: '配置名稱只能包含字母、數字、底線與連字號',
      exists: '已存在同名配置',
    },
  },
};

function resolveAgentConfigLanguage(
  language: string | undefined | null
): SupportedAgentConfigLanguage {
  const normalized = normalizeAppLanguageCode(language);
  if (normalized === 'zh-Hans' || normalized === 'zh-Hant') {
    return normalized;
  }
  return 'en';
}

function localizeSchemaNode(
  schema: RJSFSchema,
  language: SupportedAgentConfigLanguage,
  propertyKey?: string
): RJSFSchema {
  const localized: FieldCopy | undefined = propertyKey
    ? FIELD_COPY[language][propertyKey] || FIELD_COPY.en[propertyKey]
    : undefined;

  const next: RJSFSchema = { ...schema };

  if (propertyKey) {
    next.title = localized?.label ?? next.title ?? toPrettyCase(propertyKey);
    if (localized?.description) {
      next.description = localized.description;
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    next.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        localizeSchemaNode(child as RJSFSchema, language, key),
      ])
    );
  }

  if (schema.items) {
    next.items = Array.isArray(schema.items)
      ? schema.items.map((item) =>
          localizeSchemaNode(item as RJSFSchema, language)
        )
      : localizeSchemaNode(schema.items as RJSFSchema, language);
  }

  if (schema.oneOf) {
    next.oneOf = schema.oneOf.map((item) =>
      typeof item === 'object' ? localizeSchemaNode(item as RJSFSchema, language) : item
    );
  }

  if (schema.anyOf) {
    next.anyOf = schema.anyOf.map((item) =>
      typeof item === 'object' ? localizeSchemaNode(item as RJSFSchema, language) : item
    );
  }

  if (schema.allOf) {
    next.allOf = schema.allOf.map((item) =>
      typeof item === 'object' ? localizeSchemaNode(item as RJSFSchema, language) : item
    );
  }

  return next;
}

export function localizeExecutorSchema(
  schema: RJSFSchema,
  language: string | undefined | null
): RJSFSchema {
  return localizeSchemaNode(schema, resolveAgentConfigLanguage(language));
}

export function getCreateConfigurationDialogCopy(
  language: string | undefined | null
): CreateConfigurationDialogCopy {
  return CREATE_CONFIGURATION_DIALOG_COPY[
    resolveAgentConfigLanguage(language)
  ];
}
