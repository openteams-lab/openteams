import { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi } from '@/lib/api';
import type { RunDiffState, UntrackedFileState } from '../types';
import { splitUnifiedDiff } from '../utils';

const MAX_INLINE_DIFF_CHARS = 1_000_000;
const MAX_INLINE_DIFF_FILES = 120;

export interface UseDiffViewerResult {
  diffViewerRunId: string | null;
  diffViewerUntracked: string[];
  diffViewerHasDiff: boolean;
  diffViewerOpen: boolean;
  diffViewerFullscreen: boolean;
  runDiffs: Record<string, RunDiffState>;
  untrackedContent: Record<string, UntrackedFileState>;
  handleOpenDiffViewer: (
    runId: string,
    untracked: string[],
    hasDiff: boolean
  ) => void;
  handleCloseDiffViewer: () => void;
  handleToggleFullscreen: () => void;
  handleLoadDiff: (runId: string) => Promise<void>;
  handleToggleUntracked: (runId: string, path: string) => Promise<void>;
  resetDiffViewer: () => void;
}

export function useDiffViewer(): UseDiffViewerResult {
  const [diffViewerRunId, setDiffViewerRunId] = useState<string | null>(null);
  const [diffViewerUntracked, setDiffViewerUntracked] = useState<string[]>([]);
  const [diffViewerHasDiff, setDiffViewerHasDiff] = useState(false);
  const [diffViewerOpen, setDiffViewerOpen] = useState(false);
  const [diffViewerFullscreen, setDiffViewerFullscreen] = useState(false);
  const [runDiffs, setRunDiffs] = useState<Record<string, RunDiffState>>({});
  const runDiffsRef = useRef<Record<string, RunDiffState>>({});
  const [untrackedContent, setUntrackedContent] = useState<
    Record<string, UntrackedFileState>
  >({});

  useEffect(() => {
    runDiffsRef.current = runDiffs;
  }, [runDiffs]);

  const handleLoadDiff = useCallback(async (runId: string) => {
    const existing = runDiffsRef.current[runId];
    if (existing?.loading || existing?.files.length) {
      return;
    }

    setRunDiffs((prev) => {
      return {
        ...prev,
        [runId]: { loading: true, error: null, files: [] },
      };
    });

    try {
      const patch = await chatApi.getRunDiff(runId);
      if (patch.length > MAX_INLINE_DIFF_CHARS) {
        setRunDiffs((prev) => ({
          ...prev,
          [runId]: {
            loading: false,
            error: 'Diff is too large to render inline. Open raw diff instead.',
            files: [],
          },
        }));
        return;
      }

      const files = splitUnifiedDiff(patch);
      if (files.length > MAX_INLINE_DIFF_FILES) {
        setRunDiffs((prev) => ({
          ...prev,
          [runId]: {
            loading: false,
            error:
              'Diff has too many files to render inline. Open raw diff instead.',
            files: [],
          },
        }));
        return;
      }

      setRunDiffs((prev) => ({
        ...prev,
        [runId]: { loading: false, error: null, files },
      }));
    } catch (error) {
      console.warn('Failed to load run diff', error);
      setRunDiffs((prev) => ({
        ...prev,
        [runId]: {
          loading: false,
          error: 'Unable to load diff.',
          files: [],
        },
      }));
    }
  }, []);

  const handleOpenDiffViewer = useCallback(
    (runId: string, untracked: string[], hasDiff: boolean) => {
      setDiffViewerRunId(runId);
      setDiffViewerUntracked(untracked);
      setDiffViewerHasDiff(hasDiff);
      setDiffViewerOpen(true);
      setDiffViewerFullscreen(false);
      if (runId && hasDiff) {
        handleLoadDiff(runId);
      }
    },
    [handleLoadDiff]
  );

  const handleCloseDiffViewer = useCallback(() => {
    setDiffViewerOpen(false);
    setDiffViewerFullscreen(false);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setDiffViewerFullscreen((prev) => !prev);
  }, []);

  const handleToggleUntracked = useCallback(
    async (runId: string, path: string) => {
      const key = `${runId}:${path}`;
      const existing = untrackedContent[key];
      if (existing?.open) {
        setUntrackedContent((prev) => ({
          ...prev,
          [key]: { ...existing, open: false },
        }));
        return;
      }

      setUntrackedContent((prev) => ({
        ...prev,
        [key]: {
          loading: !existing?.content && !existing?.error,
          error: existing?.error ?? null,
          content: existing?.content ?? null,
          open: true,
        },
      }));

      if (existing?.content || existing?.error) {
        return;
      }

      try {
        const content = await chatApi.getRunUntrackedFile(runId, path);
        setUntrackedContent((prev) => ({
          ...prev,
          [key]: { loading: false, error: null, content, open: true },
        }));
      } catch (error) {
        console.warn('Failed to load untracked file content', error);
        setUntrackedContent((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: 'Unable to load file.',
            content: null,
            open: true,
          },
        }));
      }
    },
    [untrackedContent]
  );

  const resetDiffViewer = useCallback(() => {
    setDiffViewerRunId(null);
    setDiffViewerUntracked([]);
    setDiffViewerHasDiff(false);
    setDiffViewerOpen(false);
    setDiffViewerFullscreen(false);
    setRunDiffs({});
    setUntrackedContent({});
  }, []);

  return {
    diffViewerRunId,
    diffViewerUntracked,
    diffViewerHasDiff,
    diffViewerOpen,
    diffViewerFullscreen,
    runDiffs,
    untrackedContent,
    handleOpenDiffViewer,
    handleCloseDiffViewer,
    handleToggleFullscreen,
    handleLoadDiff,
    handleToggleUntracked,
    resetDiffViewer,
  };
}
