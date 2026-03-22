import type {
  FieldTemplateProps,
  ObjectFieldTemplateProps,
  ArrayFieldTemplateProps,
  ArrayFieldItemTemplateProps,
} from '@rjsf/utils';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// FieldTemplate - Two-column layout matching settings dialog styling
export const FieldTemplate = (props: FieldTemplateProps) => {
  const {
    children,
    rawErrors = [],
    rawHelp,
    rawDescription,
    hidden,
    label,
    required,
    schema,
  } = props;
  const isBooleanField =
    schema.type === 'boolean' ||
    (Array.isArray(schema.type) && schema.type.includes('boolean'));

  if (schema.type === 'object') {
    return children;
  }

  if (hidden) {
    return children;
  }

  return (
    <div className="settings-rjsf-field-row grid grid-cols-1 gap-3 py-4 md:grid-cols-2 md:gap-5">
      {/* Left column: Label and description */}
      <div className="space-y-1">
        {label && (
          <div className="settings-rjsf-field-label text-[12px] text-[#8C8C8C]">
            {label}
            {required && <span className="ml-1 text-[#d14343]">*</span>}
          </div>
        )}

        {rawDescription && (
          <p className="settings-rjsf-field-description text-[12px] leading-5 text-[#8C8C8C]">
            {rawDescription}
          </p>
        )}

        {rawHelp && (
          <p className="settings-rjsf-field-help text-[12px] leading-5 text-[#8C8C8C]">
            {rawHelp}
          </p>
        )}
      </div>

      {/* Right column: Field content */}
      <div className="space-y-2">
        <div className={cn(isBooleanField && 'flex items-start pt-[2px]')}>
          {children}
        </div>

        {rawErrors.length > 0 && (
          <div className="settings-rjsf-field-errors space-y-1">
            {rawErrors.map((error, index) => (
              <p
                key={index}
                className="settings-rjsf-field-error text-[12px] text-[#d14343]"
              >
                {error}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ObjectFieldTemplate - Container for object fields
export const ObjectFieldTemplate = (props: ObjectFieldTemplateProps) => {
  const { properties } = props;

  return (
    <div className="settings-rjsf-object divide-y divide-[#f5f5f5]">
      {properties.map((element) => (
        <div key={element.name}>{element.content}</div>
      ))}
    </div>
  );
};

// ArrayFieldTemplate - Array field with add button
export const ArrayFieldTemplate = (props: ArrayFieldTemplateProps) => {
  const { t } = useTranslation('common');
  const { canAdd, items, onAddClick, disabled, readonly } = props;

  if (!items || (items.length === 0 && !canAdd)) {
    return null;
  }

  return (
    <div className="settings-rjsf-array space-y-4">
      <div>{items}</div>

      {canAdd && (
        <button
          type="button"
          onClick={onAddClick}
          disabled={disabled || readonly}
          className={cn(
            'settings-add-button inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] px-4 py-[10px] text-[14px] text-[#333333]',
            'focus:outline-none focus:ring-0',
            'hover:bg-[#eceff3]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          )}
        >
          <PlusIcon className="size-icon-xs" weight="bold" />
          {t('buttons.addItem')}
        </button>
      )}
    </div>
  );
};

// ArrayFieldItemTemplate - Individual array item with remove button
export const ArrayFieldItemTemplate = (props: ArrayFieldItemTemplateProps) => {
  const { children, buttonsProps, disabled, readonly } = props;

  return (
    <div className="settings-rjsf-array-item flex items-center gap-2">
      <div className="flex-1">{children}</div>

      {buttonsProps.hasRemove && (
        <button
          type="button"
          onClick={buttonsProps.onRemoveItem}
          disabled={disabled || readonly || buttonsProps.disabled}
          className={cn(
            'settings-icon-action flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[#E8EEF5] bg-[#F3F5F8] p-0 text-[#8C8C8C]',
            'focus:outline-none focus:ring-0',
            'hover:bg-[#fff7f7] hover:text-[#d14343]',
            'disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
          )}
          title="Remove item"
        >
          <XIcon className="size-icon-xs" weight="bold" />
        </button>
      )}
    </div>
  );
};

// FormTemplate - Root form container
export const FormTemplate = ({ children }: React.PropsWithChildren) => {
  return <div className="settings-rjsf-form w-full">{children}</div>;
};
