import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  normalizeKeyboardEvent,
  snapshotKeyboardEvent,
} from './bindingResolver';
import { useShortcutCapture } from './ShortcutProvider';
import type { ShortcutSequence, ShortcutTranslate } from './types';

export type KeybindingRecorderProps = {
  active: boolean;
  translate: ShortcutTranslate;
  onComplete: (sequence: ShortcutSequence) => void;
  onCancel: () => void;
};

export function KeybindingRecorder({
  active,
  translate,
  onComplete,
  onCancel,
}: KeybindingRecorderProps) {
  const [firstStroke, setFirstStroke] = useState<string | null>(null);
  const recorderRef = useRef<HTMLDivElement>(null);
  const firstStrokeRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const complete = (sequence: ShortcutSequence) => {
    clearTimer();
    firstStrokeRef.current = null;
    setFirstStroke(null);
    onComplete(sequence);
  };

  useShortcutCapture({
    active,
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        clearTimer();
        firstStrokeRef.current = null;
        setFirstStroke(null);
        onCancel();
        return true;
      }
      if (event.key === 'Enter' && firstStrokeRef.current) {
        complete([firstStrokeRef.current]);
        return true;
      }
      const snapshot = snapshotKeyboardEvent(event);
      const stroke = normalizeKeyboardEvent(snapshot);
      if (!stroke) return true;
      if (firstStrokeRef.current) {
        complete([firstStrokeRef.current, stroke]);
        return true;
      }
      if (
        snapshot.ctrlKey ||
        snapshot.metaKey ||
        snapshot.altKey ||
        snapshot.shiftKey
      ) {
        complete([stroke]);
        return true;
      }
      firstStrokeRef.current = stroke;
      setFirstStroke(stroke);
      clearTimer();
      timerRef.current = window.setTimeout(() => complete([stroke]), 1200);
      return true;
    },
  });

  useEffect(() => {
    if (!active) {
      clearTimer();
      firstStrokeRef.current = null;
      setFirstStroke(null);
    }
  }, [active]);
  useLayoutEffect(() => {
    if (active) recorderRef.current?.focus();
  }, [active]);
  useEffect(() => clearTimer, []);
  return (
    <div
      ref={recorderRef}
      data-shortcut-recorder
      tabIndex={0}
      aria-live="polite"
      className="inline-flex items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-[var(--ink-subtle)] outline-none"
    >
      {translate('shortcuts.recorder.recording')}
    </div>
  );
}
