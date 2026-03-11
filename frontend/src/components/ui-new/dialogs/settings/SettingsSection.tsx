import { useTranslation } from 'react-i18next';
import { XIcon } from '@phosphor-icons/react';

import { GeneralSettingsSectionContent } from './GeneralSettingsSection';
import { AgentsSettingsSectionContent } from './AgentsSettingsSection';
import { McpSettingsSectionContent } from './McpSettingsSection';
import { ChatPresetsSettingsSectionContent } from './ChatPresetsSettingsSection';

export type SettingsSectionType = 'general' | 'agents' | 'mcp' | 'presets';

// Section-specific initial state types
export type SettingsSectionInitialState = {
  general: undefined;
  agents: { executor?: string; variant?: string } | undefined;
  mcp: undefined;
  presets: undefined;
};

interface SettingsSectionProps {
  type: SettingsSectionType;
  onClose?: () => void;
}

export function SettingsSection({ type, onClose }: SettingsSectionProps) {
  const { t } = useTranslation('settings');

  const renderContent = () => {
    switch (type) {
      case 'general':
        return <GeneralSettingsSectionContent />;
      case 'agents':
        return <AgentsSettingsSectionContent />;
      case 'mcp':
        return <McpSettingsSectionContent />;
      case 'presets':
        return <ChatPresetsSettingsSectionContent />;
      default:
        return <GeneralSettingsSectionContent />;
    }
  };

  return (
    <div className="settings-section flex flex-col h-full">
      <div
        className="settings-section-header hidden items-center justify-between sm:flex"
        style={{ padding: '24px 32px' }}
      >
        <h2
          className="m-0"
          style={{ fontSize: '16px', fontWeight: 600, color: '#333333' }}
        >
          {t(`settings.layout.nav.${type}`)}
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="border-none bg-transparent p-0 transition-colors duration-200"
            style={{ cursor: 'pointer', color: '#cccccc' }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = '#333333';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = '#cccccc';
            }}
          >
            <XIcon className="h-4 w-4" weight="bold" />
            <span className="sr-only">{t('close', { ns: 'common' })}</span>
          </button>
        )}
      </div>

      <div
        className="settings-section-body flex-1 min-h-0 overflow-y-auto"
        style={{ padding: '0 32px' }}
      >
        {renderContent()}
      </div>
    </div>
  );
}
