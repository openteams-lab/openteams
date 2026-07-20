import { useEffect } from 'react';

type ConfirmationDialogKeyboardOptions = {
  enabled?: boolean;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function useConfirmationDialogKeyboard({
  enabled = true,
  confirming = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirming) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (
        event.key === 'Enter' &&
        !event.repeat &&
        !event.isComposing &&
        !confirming
      ) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirming, enabled, onCancel, onConfirm]);
}
