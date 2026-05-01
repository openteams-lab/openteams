import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/components/ThemeProvider';

interface SaveTeamPresetSnapshotPayload {
  team_preset_id: string;
  name: string | null;
  description: string | null;
  overwrite_strategy: 'fail_if_exists' | 'overwrite_custom';
}

export interface SaveTeamPresetSnapshotModalProps {
  isOpen: boolean;
  isSaving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (
    payload: SaveTeamPresetSnapshotPayload
  ) => Promise<boolean> | boolean;
}

export function SaveTeamPresetSnapshotModal({
  isOpen,
  isSaving = false,
  error,
  onClose,
  onSave,
}: SaveTeamPresetSnapshotModalProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [teamPresetId, setTeamPresetId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [overwriteCustom, setOverwriteCustom] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (!isOpen) return;
    setTeamPresetId('');
    setName('');
    setDescription('');
    setOverwriteCustom(false);
    setValidationError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSaving, onClose]);

  const handleSubmit = useCallback(async () => {
    if (isSaving) return;
    const normalizedTeamPresetId = teamPresetId.trim();
    if (!normalizedTeamPresetId) {
      setValidationError(
        t('members.teamPresetSnapshot.errors.idRequired', {
          defaultValue: 'Preset ID is required.',
        })
      );
      return;
    }
    setValidationError(null);
    const shouldClose = await onSave({
      team_preset_id: normalizedTeamPresetId,
      name: name.trim() || null,
      description: description.trim() || null,
      overwrite_strategy: overwriteCustom
        ? 'overwrite_custom'
        : 'fail_if_exists',
    });
    if (shouldClose !== false) {
      onClose();
    }
  }, [
    description,
    isSaving,
    name,
    onClose,
    onSave,
    overwriteCustom,
    t,
    teamPresetId,
  ]);

  if (!isOpen) return null;

  const palette = isDark
    ? {
        overlay: 'rgba(5, 10, 17, 0.72)',
        shell: '#192233',
        shellBorder: '#2A3445',
        shellShadow: '0 24px 56px rgba(0, 0, 0, 0.42)',
        title: '#F3F6FB',
        copy: '#7F8AA3',
        close: '#7F8AA3',
        fieldBg: '#111926',
        fieldBorder: '#2B3648',
        fieldText: '#F3F6FB',
        label: '#BAC4D6',
        accent: '#5EA2FF',
        errorBg: 'rgba(248, 113, 113, 0.12)',
        errorBorder: 'rgba(248, 113, 113, 0.28)',
        errorText: '#FCA5A5',
        footerBorder: '#202938',
        cancelBg: '#1A2433',
        cancelText: '#BAC4D6',
        primaryBg: '#5EA2FF',
        primaryText: '#FFFFFF',
      }
    : {
        overlay: 'rgba(0, 0, 0, 0.05)',
        shell: '#FFFFFF',
        shellBorder: '#E8EEF5',
        shellShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
        title: '#333333',
        copy: '#8C8C8C',
        close: '#cccccc',
        fieldBg: '#EEF3F9',
        fieldBorder: '#E8EEF5',
        fieldText: '#444444',
        label: '#64748B',
        accent: '#4A90E2',
        errorBg: '#fff7f7',
        errorBorder: '#f3d7d7',
        errorText: '#d14343',
        footerBorder: '#f5f5f5',
        cancelBg: '#f5f5f5',
        cancelText: '#8C8C8C',
        primaryBg: '#4A90E2',
        primaryText: '#FFFFFF',
      };

  const inputStyle = {
    width: '100%',
    background: palette.fieldBg,
    border: `1px solid ${palette.fieldBorder}`,
    borderRadius: '12px',
    padding: '10px 12px',
    boxSizing: 'border-box' as const,
    fontSize: '13px',
    color: palette.fieldText,
    outline: 'none',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: palette.overlay }}
    >
      <div
        className="flex w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        style={{
          background: palette.shell,
          borderRadius: '16px',
          boxShadow: palette.shellShadow,
          border: `1px solid ${palette.shellBorder}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <h2
              className="m-0"
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: palette.title,
              }}
            >
              {t('members.teamPresetSnapshot.modal.title', {
                defaultValue: 'Save Team',
              })}
            </h2>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: palette.copy,
              }}
            >
              {t('members.teamPresetSnapshot.modal.description', {
                defaultValue:
                  'Save this session member setup as a reusable team preset.',
              })}
            </p>
            <p
              className="m-0"
              style={{
                marginTop: '4px',
                fontSize: '12px',
                color: palette.copy,
              }}
            >
              {t('members.teamPresetSnapshot.modal.dedupeHint', {
                defaultValue:
                  'Members with duplicate names automatically get a numeric suffix.',
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('members.teamPresetSnapshot.modal.close', {
              defaultValue: 'Close save team preset dialog',
            })}
            onClick={onClose}
            disabled={isSaving}
            style={{
              cursor: isSaving ? 'default' : 'pointer',
              color: palette.close,
              fontSize: '20px',
              background: 'transparent',
              border: 'none',
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 px-6 pb-5">
          <label className="block space-y-1.5">
            <span
              className="text-[12px] font-medium"
              style={{ color: palette.label }}
            >
              {t('members.teamPresetSnapshot.modal.name', {
                defaultValue: 'Name',
              })}
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t(
                'members.teamPresetSnapshot.modal.namePlaceholder',
                {
                  defaultValue: 'Use session title',
                }
              )}
              disabled={isSaving}
              style={inputStyle}
            />
          </label>

          <label className="block space-y-1.5">
            <span
              className="text-[12px] font-medium"
              style={{ color: palette.label }}
            >
              {t('members.teamPresetSnapshot.modal.teamPresetId', {
                defaultValue: 'Preset ID',
              })}
            </span>
            <input
              value={teamPresetId}
              onChange={(event) => {
                setTeamPresetId(event.target.value);
                setValidationError(null);
              }}
              placeholder={t(
                'members.teamPresetSnapshot.modal.teamPresetIdPlaceholder',
                {
                  defaultValue: 'delivery_team',
                }
              )}
              disabled={isSaving}
              style={inputStyle}
            />
          </label>

          <label className="block space-y-1.5">
            <span
              className="text-[12px] font-medium"
              style={{ color: palette.label }}
            >
              {t('members.teamPresetSnapshot.modal.descriptionLabel', {
                defaultValue: 'Description',
              })}
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t(
                'members.teamPresetSnapshot.modal.descriptionPlaceholder',
                {
                  defaultValue: 'Optional preset description',
                }
              )}
              disabled={isSaving}
              rows={4}
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
            />
          </label>

          <label
            className="flex items-center gap-3 rounded-[12px] px-4 py-3 text-[13px]"
            style={{
              background: palette.fieldBg,
              border: `1px solid ${palette.fieldBorder}`,
              color: palette.fieldText,
            }}
          >
            <input
              type="checkbox"
              checked={overwriteCustom}
              onChange={(event) => setOverwriteCustom(event.target.checked)}
              disabled={isSaving}
              className="h-4 w-4 rounded-[4px]"
              style={{ accentColor: palette.accent }}
            />
            <span>
              {t('members.teamPresetSnapshot.modal.overwrite', {
                defaultValue:
                  'Overwrite existing custom preset with the same ID',
              })}
            </span>
          </label>

          {validationError || error ? (
            <div
              className="rounded-[10px] px-3 py-2 text-[12px]"
              style={{
                border: `1px solid ${palette.errorBorder}`,
                background: palette.errorBg,
                color: palette.errorText,
              }}
            >
              {validationError || error}
            </div>
          ) : null}
        </div>

        <div
          className="flex justify-end gap-3 px-6 py-4"
          style={{ borderTop: `1px solid ${palette.footerBorder}` }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-full px-6 py-2 text-[14px]"
            style={{
              cursor: isSaving ? 'default' : 'pointer',
              border: 'none',
              background: palette.cancelBg,
              color: palette.cancelText,
            }}
          >
            {tCommon('buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
            className="rounded-full px-6 py-2 text-[14px]"
            style={{
              cursor: isSaving ? 'default' : 'pointer',
              border: 'none',
              background: palette.primaryBg,
              color: palette.primaryText,
            }}
          >
            {isSaving
              ? tCommon('states.saving')
              : t('members.teamPresetSnapshot.modal.save', {
                  defaultValue: 'Save preset',
                })}
          </button>
        </div>
      </div>
    </div>
  );
}
