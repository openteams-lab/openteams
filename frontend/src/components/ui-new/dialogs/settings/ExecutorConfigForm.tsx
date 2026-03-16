import { useMemo, useEffect, useState, useCallback } from 'react';
import Form from '@rjsf/core';
import type { IChangeEvent } from '@rjsf/core';
import { RJSFValidationError } from '@rjsf/utils';
import validator from '@rjsf/validator-ajv8';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent } from 'shared/types';
import { settingsRjsfTheme } from './rjsf/theme';
import { localizeExecutorSchema } from '@/lib/agentConfigLocalization';

interface ExecutorConfigFormProps {
  executor: BaseCodingAgent;
  value: unknown;
  onChange?: (formData: unknown) => void;
  onValidationChange?: (hasValidationErrors: boolean) => void;
  disabled?: boolean;
}

import schemas from 'virtual:executor-schemas';

export function ExecutorConfigForm({
  executor,
  value,
  onChange,
  onValidationChange,
  disabled = false,
}: ExecutorConfigFormProps) {
  const { t, i18n } = useTranslation('settings');
  const [formData, setFormData] = useState<unknown>(value || {});
  const [validationErrors, setValidationErrors] = useState<
    RJSFValidationError[]
  >([]);

  const schema = useMemo(() => {
    const baseSchema = schemas[executor];
    return baseSchema ? localizeExecutorSchema(baseSchema, i18n.language) : null;
  }, [executor, i18n.language]);

  // Custom handler for env field updates
  const handleEnvChange = useCallback(
    (envData: Record<string, string> | undefined) => {
      const newFormData = {
        ...(formData as Record<string, unknown>),
        env: envData,
      };
      setFormData(newFormData);
      if (onChange) {
        onChange(newFormData);
      }
    },
    [formData, onChange]
  );

  const uiSchema = useMemo(
    () => ({
      env: {
        'ui:field': 'KeyValueField',
      },
    }),
    []
  );

  // Pass the env update handler via formContext
  const formContext = useMemo(
    () => ({
      onEnvChange: handleEnvChange,
    }),
    [handleEnvChange]
  );

  useEffect(() => {
    setFormData(value || {});
    setValidationErrors([]);
  }, [value, executor]);

  useEffect(() => {
    onValidationChange?.(validationErrors.length > 0);
  }, [onValidationChange, validationErrors]);

  const handleChange = (event: IChangeEvent<unknown>) => {
    const newFormData = event.formData;
    setFormData(newFormData);
    if (onChange) {
      onChange(newFormData);
    }
  };

  const handleError = (errors: RJSFValidationError[]) => {
    setValidationErrors(errors);
  };

  if (!schema) {
    return (
      <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
        {t('settings.agents.errors.schemaNotFound', { executor })}
      </div>
    );
  }

  const hasValidationErrors = validationErrors.length > 0;

  return (
    <div className="space-y-4">
      <Form
        schema={schema}
        uiSchema={uiSchema}
        formData={formData}
        formContext={formContext}
        onChange={handleChange}
        onError={handleError}
        validator={validator}
        disabled={disabled}
        liveValidate
        showErrorList={false}
        widgets={settingsRjsfTheme.widgets}
        templates={settingsRjsfTheme.templates}
        fields={settingsRjsfTheme.fields}
      >
        <></>
      </Form>

      {hasValidationErrors && (
        <div className="rounded-[10px] border border-[#f3d7d7] bg-[#fff7f7] p-4 text-[13px] text-[#d14343]">
          <ul className="list-disc list-inside space-y-1">
            {validationErrors.map((error, index) => (
              <li key={index}>
                {error.property}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
