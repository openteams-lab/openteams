import React from 'react';
import { GlobalTooltip } from '@/components/GlobalTooltip';
import { ChordHintOverlay } from './ChordHintOverlay';
import { CommandPalette } from './CommandPalette';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';

export function ShortcutOverlays() {
  return (
    <>
      <GlobalTooltip />
      <CommandPalette />
      <ShortcutHelpDialog />
      <ChordHintOverlay />
    </>
  );
}
