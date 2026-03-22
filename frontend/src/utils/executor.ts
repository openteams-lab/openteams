import type {
  BaseCodingAgent,
  ExecutorConfig,
  ExecutorConfigs,
  ExecutorAction,
  ExecutorProfileId,
  ExecutionProcess,
  JsonValue,
} from 'shared/types';
import { toPrettyCase } from './string';

export const EXECUTOR_PROFILE_VARIANT_KEY = 'executor_profile_variant';

const AUTO_MODEL_VARIANT_PREFIX = 'AUTO_MODEL_';
const FREE_SUFFIX_REGEX = /:free$/i;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeVariantValue(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.toUpperCase() === 'DEFAULT') {
    return null;
  }
  return trimmed;
}

function normalizeModelLookupValue(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.toLowerCase() : null;
}

export function isOpencodeExecutor(
  executor: BaseCodingAgent | string | null | undefined
): boolean {
  return (executor ?? '').toString().toUpperCase() === 'OPENCODE';
}

export function isOpenTeamsCliExecutor(
  executor: BaseCodingAgent | string | null | undefined
): boolean {
  return (executor ?? '').toString().toUpperCase() === 'OPEN_TEAMS_CLI';
}

export function isAutoModelExecutor(
  executor: BaseCodingAgent | string | null | undefined
): boolean {
  const normalizedExecutor = (executor ?? '').toString().toUpperCase();
  return (
    normalizedExecutor === 'OPENCODE' ||
    normalizedExecutor === 'OPEN_TEAMS_CLI'
  );
}

export function extractExecutorProfileVariant(
  toolsEnabled: unknown
): string | null {
  if (!isObjectRecord(toolsEnabled)) return null;
  const rawValue = toolsEnabled[EXECUTOR_PROFILE_VARIANT_KEY];
  if (typeof rawValue !== 'string') return null;
  return normalizeVariantValue(rawValue);
}

export function withExecutorProfileVariant(
  toolsEnabled: unknown,
  variant: string | null | undefined
): JsonValue {
  const normalizedVariant = normalizeVariantValue(variant);
  const nextToolsEnabled: Record<string, JsonValue> = isObjectRecord(
    toolsEnabled
  )
    ? ({ ...toolsEnabled } as Record<string, JsonValue>)
    : {};

  if (normalizedVariant) {
    nextToolsEnabled[EXECUTOR_PROFILE_VARIANT_KEY] = normalizedVariant;
  } else {
    delete nextToolsEnabled[EXECUTOR_PROFILE_VARIANT_KEY];
  }

  return nextToolsEnabled;
}

/**
 * Compare two ExecutorProfileIds for equality.
 * Treats null/undefined variant as equivalent to "DEFAULT".
 */
export function areProfilesEqual(
  a: ExecutorProfileId | null | undefined,
  b: ExecutorProfileId | null | undefined
): boolean {
  if (!a || !b) return a === b;
  if (a.executor !== b.executor) return false;
  // Normalize variants: null/undefined -> 'DEFAULT'
  const variantA = a.variant ?? 'DEFAULT';
  const variantB = b.variant ?? 'DEFAULT';
  return variantA === variantB;
}

/**
 * Get variant options for a given executor from profiles.
 * Returns variants sorted: DEFAULT first, then alphabetically.
 */
export function getVariantOptions(
  executor: BaseCodingAgent | string | null | undefined,
  profiles: ExecutorConfigs['executors'] | null | undefined
): string[] {
  if (!executor || !profiles) return [];
  const executorConfig = (
    profiles as Record<string, ExecutorConfig | undefined>
  )[executor];
  if (!executorConfig) return [];

  const variants = Object.keys(executorConfig);
  const variantLabels = isAutoModelExecutor(executor)
    ? new Map(
        variants.map((variant) => [
          variant,
          getVariantDisplayLabel(executor, variant, profiles),
        ])
      )
    : null;

  return variants.sort((a, b) => {
    if (a === 'DEFAULT') return -1;
    if (b === 'DEFAULT') return 1;
    if (variantLabels) {
      return (variantLabels.get(a) ?? a).localeCompare(
        variantLabels.get(b) ?? b
      );
    }
    return a.localeCompare(b);
  });
}

export function getVariantModelName(
  executor: BaseCodingAgent | string | null | undefined,
  variant: string | null | undefined,
  profiles: ExecutorConfigs['executors'] | null | undefined
): string | null {
  if (!executor || !profiles) return null;
  const executorConfig = (
    profiles as Record<string, ExecutorConfig | undefined>
  )[executor];
  if (!executorConfig) return null;

  const variantKey =
    variant && variant in executorConfig
      ? variant
      : 'DEFAULT' in executorConfig
        ? 'DEFAULT'
        : Object.keys(executorConfig)[0];
  if (!variantKey) return null;

  const variantConfig = executorConfig[variantKey];
  if (!variantConfig) return null;
  const innerConfig = Object.values(variantConfig)[0] as
    | { model?: string | null }
    | undefined;
  const model = innerConfig?.model;
  if (typeof model !== 'string' || model.trim().length === 0) return null;
  return model;
}

export function findVariantByModel(
  executor: BaseCodingAgent | string | null | undefined,
  model: string | null | undefined,
  profiles: ExecutorConfigs['executors'] | null | undefined
): string | null {
  if (!executor || !profiles) return null;

  const targetModel = normalizeModelLookupValue(model);
  if (!targetModel) return null;

  const variants = getVariantOptions(executor as BaseCodingAgent, profiles);
  for (const variant of variants) {
    const normalizedVariantName =
      isOpenTeamsCliExecutor(executor) && variant !== 'DEFAULT'
        ? normalizeModelLookupValue(variant)
        : null;
    if (normalizedVariantName === targetModel) {
      return variant;
    }

    const variantModel = getVariantModelName(executor, variant, profiles);
    const normalizedVariantModel = normalizeModelLookupValue(variantModel);
    if (normalizedVariantModel === targetModel) {
      return variant;
    }

    const formattedVariantModel = normalizeModelLookupValue(
      formatExecutorModelLabel(executor, variantModel)
    );
    if (formattedVariantModel === targetModel) {
      return variant;
    }
  }

  return null;
}

export function formatOpencodeModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;

  const hasFreeTag = FREE_SUFFIX_REGEX.test(trimmed);
  const normalizedPath = trimmed.replace(FREE_SUFFIX_REGEX, '');
  const segments = normalizedPath
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let normalizedModel = normalizedPath.toLowerCase();
  if (segments.length >= 2) {
    const vendor = segments[segments.length - 2].toLowerCase();
    const modelName = segments[segments.length - 1].toLowerCase();
    normalizedModel = `${vendor}/${modelName}`;
  } else if (segments.length === 1) {
    normalizedModel = segments[0].toLowerCase();
  }

  return hasFreeTag ? `${normalizedModel}:free` : normalizedModel;
}

export function formatExecutorModelLabel(
  executor: BaseCodingAgent | string | null | undefined,
  model: string | null | undefined
): string | null {
  if (!model) return null;
  if (isAutoModelExecutor(executor)) {
    return formatOpencodeModelLabel(model);
  }
  return model;
}

export function getVariantDisplayLabel(
  executor: BaseCodingAgent | string | null | undefined,
  variantName: string,
  profiles: ExecutorConfigs['executors'] | null | undefined
): string {
  const normalizedVariantName = variantName.trim();
  const modelName = getVariantModelName(executor, variantName, profiles);

  if (isOpenTeamsCliExecutor(executor) && normalizedVariantName !== 'DEFAULT') {
    if (normalizedVariantName.startsWith(AUTO_MODEL_VARIANT_PREFIX) && modelName) {
      return formatExecutorModelLabel(executor, modelName) ?? modelName;
    }
    return normalizedVariantName;
  }

  const prettyVariant = toPrettyCase(variantName);
  if (!modelName) return prettyVariant;

  const modelLabel = formatExecutorModelLabel(executor, modelName) ?? modelName;
  if (
    isOpencodeExecutor(executor) &&
    normalizedVariantName.startsWith(AUTO_MODEL_VARIANT_PREFIX)
  ) {
    return modelLabel;
  }

  return `${prettyVariant} (${modelLabel})`;
}

/**
 * Extract ExecutorProfileId from an ExecutorAction chain.
 * Traverses the action chain to find the first coding agent request.
 */
export function extractProfileFromAction(
  action: ExecutorAction | null
): ExecutorProfileId | null {
  let curr: ExecutorAction | null = action;
  while (curr) {
    const typ = curr.typ;
    switch (typ.type) {
      case 'CodingAgentInitialRequest':
      case 'CodingAgentFollowUpRequest':
      case 'ReviewRequest':
        return typ.executor_profile_id;
      case 'ScriptRequest':
      default:
        curr = curr.next_action;
        continue;
    }
  }
  return null;
}

/**
 * Get the latest ExecutorProfileId from a list of execution processes.
 * Searches from most recent to oldest.
 */
export function getLatestProfileFromProcesses(
  processes: ExecutionProcess[] | undefined
): ExecutorProfileId | null {
  if (!processes?.length) return null;
  return (
    processes
      .slice()
      .reverse()
      .map((p) => extractProfileFromAction(p.executor_action ?? null))
      .find((pid) => pid !== null) ?? null
  );
}
