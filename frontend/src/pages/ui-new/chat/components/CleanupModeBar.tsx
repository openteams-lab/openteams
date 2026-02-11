import { TrashIcon } from '@phosphor-icons/react';

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
  const allSelected = selectedCount === totalCount;

  return (
    <div className="px-base py-half border-b border-border text-xs text-low flex items-center justify-end gap-base">
      <span>Selected: {selectedCount}</span>
      <button
        type="button"
        className="text-brand hover:text-brand-hover"
        onClick={onToggleSelectAll}
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>
      {selectedCount > 0 && (
        <button
          type="button"
          className="text-error hover:text-error/80 flex items-center gap-half"
          onClick={onDeleteSelected}
          disabled={isDeletingMessages}
        >
          <TrashIcon className="size-icon-xs" />
          Delete Selected
        </button>
      )}
    </div>
  );
}
