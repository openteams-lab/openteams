import { TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export interface CleanupModeBarProps {
  selectedCount: number;
  totalCount: number;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  isDeletingMessages: boolean;
}

export function CleanupModeBar({
  selectedCount,
  totalCount,
  onToggleSelectAll,
  onDeleteSelected,
  isDeletingMessages,
}: CleanupModeBarProps) {
  const { t } = useTranslation('chat');
  const allSelected = selectedCount === totalCount;

  return (
    <div className="chat-session-cleanup-bar px-base py-half border-b border-border text-xs text-low flex items-center justify-end gap-base">
      <span>{t('cleanup.selected', { count: selectedCount })}</span>
      <button
        type="button"
        className="chat-session-cleanup-action"
        onClick={onToggleSelectAll}
      >
        {allSelected ? t('cleanup.deselectAll') : t('cleanup.selectAll')}
      </button>
      {selectedCount > 0 && (
        <button
          type="button"
          className="chat-session-cleanup-delete flex items-center gap-half"
          onClick={onDeleteSelected}
          disabled={isDeletingMessages}
        >
          <TrashIcon className="size-icon-xs" />
          {t('cleanup.deleteSelected')}
        </button>
      )}
    </div>
  );
}
