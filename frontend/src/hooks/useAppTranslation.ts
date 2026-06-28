import { useCallback } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';

type TranslationOptions = Record<string, unknown> & {
  defaultValue?: string;
};

const interpolate = (
  value: string,
  replacements: Record<string, string | number>,
) =>
  Object.entries(replacements).reduce(
    (current, [key, replacement]) =>
      current
        .replaceAll(`{${key}}`, String(replacement))
        .replaceAll(`{{${key}}}`, String(replacement)),
    value,
  );

export function useAppTranslation() {
  const { t: workspaceT } = useWorkspace();

  const t = useCallback(
    (key: string, options: TranslationOptions = {}) => {
      const { defaultValue, ...rest } = options;
      const replacements = Object.fromEntries(
        Object.entries(rest).filter(
          (entry): entry is [string, string | number] =>
            typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      );
      const translated = workspaceT(key, replacements);
      const value = translated && translated !== key ? translated : defaultValue ?? key;
      return interpolate(value, replacements);
    },
    [workspaceT],
  );

  return { t };
}
