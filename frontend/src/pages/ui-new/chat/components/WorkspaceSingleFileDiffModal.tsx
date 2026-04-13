import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  ArrowSquareUpRightIcon,
  CheckCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { fileSystemApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { resolveLocalPathToAbsolutePath } from '@/utils/readOnlyLinks';

const MAX_INLINE_FILE_PATCH_CHARS = 300_000;
const MIN_MODAL_WIDTH = 560;
const MIN_MODAL_HEIGHT = 360;
const DEFAULT_MODAL_WIDTH = 920;
const DEFAULT_MODAL_HEIGHT = 680;
const MODAL_HORIZONTAL_GAP = 16;
const MODAL_VERTICAL_GAP = 12;

type ResizeDirection = 'left' | 'right';

type ParsedDiffRow = {
  key: string;
  kind: 'context' | 'added' | 'removed';
  content: string;
  sign: ' ' | '+' | '-';
  lineNumber: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return {
      width: DEFAULT_MODAL_WIDTH,
      height: DEFAULT_MODAL_HEIGHT,
    };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getDefaultModalSize() {
  const viewport = getViewportSize();
  const maxWidth = Math.max(320, viewport.width - MODAL_HORIZONTAL_GAP * 2);
  const maxHeight = Math.max(240, viewport.height - MODAL_VERTICAL_GAP * 2);

  return {
    width: clamp(
      Math.min(DEFAULT_MODAL_WIDTH, maxWidth),
      Math.min(MIN_MODAL_WIDTH, maxWidth),
      maxWidth
    ),
    height: clamp(
      Math.min(DEFAULT_MODAL_HEIGHT, maxHeight),
      Math.min(MIN_MODAL_HEIGHT, maxHeight),
      maxHeight
    ),
  };
}

function getModalBounds() {
  const viewport = getViewportSize();

  return {
    minWidth: Math.min(MIN_MODAL_WIDTH, Math.max(320, viewport.width - 32)),
    maxWidth: Math.max(320, viewport.width - MODAL_HORIZONTAL_GAP * 2),
    minHeight: Math.min(MIN_MODAL_HEIGHT, Math.max(240, viewport.height - 24)),
    maxHeight: Math.max(240, viewport.height - MODAL_VERTICAL_GAP * 2),
  };
}

function parseUnifiedDiffRows(unifiedDiff: string | null): ParsedDiffRow[] {
  if (!unifiedDiff?.trim()) {
    return [];
  }

  const rows: ParsedDiffRow[] = [];
  const lines = unifiedDiff.split(/\r?\n/);
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const [index, line] of lines.entries()) {
    if (!line) {
      if (inHunk) {
        rows.push({
          key: `empty-${index}`,
          kind: 'context',
          content: '',
          sign: ' ',
          lineNumber: newLine || oldLine || null,
        });
      }
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
        inHunk = true;
      }
      continue;
    }

    if (!inHunk || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }

    const sign = line[0] as ' ' | '+' | '-';
    const content = line.slice(1);

    if (sign === '-') {
      rows.push({
        key: `removed-${index}`,
        kind: 'removed',
        content,
        sign,
        lineNumber: oldLine,
      });
      oldLine += 1;
      continue;
    }

    if (sign === '+') {
      rows.push({
        key: `added-${index}`,
        kind: 'added',
        content,
        sign,
        lineNumber: newLine,
      });
      newLine += 1;
      continue;
    }

    rows.push({
      key: `context-${index}`,
      kind: 'context',
      content,
      sign: ' ',
      lineNumber: newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return rows;
}

function getDiffStats(unifiedDiff: string | null) {
  if (!unifiedDiff?.trim()) {
    return { additions: 0, deletions: 0 };
  }

  let additions = 0;
  let deletions = 0;

  for (const line of unifiedDiff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

export interface WorkspaceSingleFileDiffModalProps {
  isOpen: boolean;
  workspacePath: string;
  filePath: string;
  unifiedDiff: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
}

export function WorkspaceSingleFileDiffModal({
  isOpen,
  workspacePath,
  filePath,
  unifiedDiff,
  loading = false,
  error = null,
  onClose,
}: WorkspaceSingleFileDiffModalProps) {
  const { t } = useTranslation('chat');
  const [isOpening, setIsOpening] = useState(false);
  const [openNotice, setOpenNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [modalSize, setModalSize] = useState(() => getDefaultModalSize());
  const [isResizing, setIsResizing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [horizontalScroll, setHorizontalScroll] = useState(0);
  const [contentViewportWidth, setContentViewportWidth] = useState(0);
  const contentViewportRef = useRef<HTMLDivElement | null>(null);
  const horizontalScrollbarRef = useRef<HTMLDivElement | null>(null);

  const isTooLarge =
    typeof unifiedDiff === 'string' &&
    unifiedDiff.length > MAX_INLINE_FILE_PATCH_CHARS;
  const diffRows = useMemo(
    () => parseUnifiedDiffRows(unifiedDiff),
    [unifiedDiff]
  );
  const diffStats = useMemo(() => getDiffStats(unifiedDiff), [unifiedDiff]);
  const showsScrollableDiff =
    !loading && !error && !isTooLarge && diffRows.length > 0;
  const contentWidth = useMemo(() => {
    const longestLine = diffRows.reduce(
      (max, row) => Math.max(max, row.content.length + 2),
      0
    );

    return Math.max(
      longestLine * 8 + 120,
      Math.max(contentViewportWidth, modalSize.width) - 48
    );
  }, [contentViewportWidth, diffRows, modalSize.width]);
  const maxHorizontalScroll = Math.max(
    0,
    contentWidth - Math.max(contentViewportWidth, 0)
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setModalSize(getDefaultModalSize());
    setIsFullscreen(false);
    setHorizontalOffset(0);
    setHorizontalScroll(0);
    setOpenNotice(null);
  }, [isOpen, filePath]);

  useEffect(() => {
    if (!openNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setOpenNotice(null);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [openNotice]);

  useEffect(() => {
    if (!isOpen || isFullscreen) {
      return;
    }

    const syncToViewport = () => {
      const bounds = getModalBounds();
      setModalSize((current) => ({
        width: clamp(current.width, bounds.minWidth, bounds.maxWidth),
        height: clamp(current.height, bounds.minHeight, bounds.maxHeight),
      }));
      setHorizontalOffset((current) => {
        const maxOffset = Math.max(0, (bounds.maxWidth - modalSize.width) / 2);
        return clamp(current, -maxOffset, maxOffset);
      });
    };

    syncToViewport();
    window.addEventListener('resize', syncToViewport);

    return () => window.removeEventListener('resize', syncToViewport);
  }, [isFullscreen, isOpen, modalSize.width]);

  useEffect(() => {
    if (!isOpen || !showsScrollableDiff) {
      return;
    }

    const viewport = contentViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateWidth = () => {
      setContentViewportWidth(viewport.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [
    isOpen,
    isFullscreen,
    modalSize.height,
    modalSize.width,
    showsScrollableDiff,
  ]);

  useEffect(() => {
    setHorizontalScroll((current) => clamp(current, 0, maxHorizontalScroll));
  }, [maxHorizontalScroll]);

  useEffect(() => {
    const scrollbar = horizontalScrollbarRef.current;
    if (!scrollbar || Math.abs(scrollbar.scrollLeft - horizontalScroll) < 1) {
      return;
    }

    scrollbar.scrollLeft = horizontalScroll;
  }, [horizontalScroll]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleStartResize = useCallback(
    (direction: ResizeDirection) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (isFullscreen) {
          return;
        }

        event.preventDefault();

        const resizeHandle = event.currentTarget;
        const pointerId = event.pointerId;
        const { style } = document.body;
        const previousUserSelect = style.userSelect;
        const previousCursor = style.cursor;

        const startX = event.clientX;
        const initialWidth = modalSize.width;
        const initialOffset = horizontalOffset;
        const bounds = getModalBounds();

        setIsResizing(true);
        style.userSelect = 'none';
        style.cursor = 'ew-resize';
        resizeHandle.setPointerCapture(pointerId);

        const cleanup = () => {
          setIsResizing(false);
          style.userSelect = previousUserSelect;
          style.cursor = previousCursor;
          if (resizeHandle.hasPointerCapture(pointerId)) {
            resizeHandle.releasePointerCapture(pointerId);
          }
          window.removeEventListener('pointermove', handlePointerMove);
          window.removeEventListener('pointerup', handlePointerUp);
          window.removeEventListener('pointercancel', handlePointerUp);
        };

        const handlePointerMove = (moveEvent: PointerEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const rawWidth =
            direction === 'right'
              ? initialWidth + deltaX
              : initialWidth - deltaX;
          const nextWidth = clamp(rawWidth, bounds.minWidth, bounds.maxWidth);
          const widthDelta = nextWidth - initialWidth;
          const rawOffset =
            direction === 'right'
              ? initialOffset + widthDelta / 2
              : initialOffset - widthDelta / 2;
          const maxOffset = Math.max(0, (bounds.maxWidth - nextWidth) / 2);

          setModalSize((current) => ({ ...current, width: nextWidth }));
          setHorizontalOffset(clamp(rawOffset, -maxOffset, maxOffset));
        };

        const handlePointerUp = () => {
          cleanup();
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
      },
    [horizontalOffset, isFullscreen, modalSize.width]
  );

  const handleHorizontalScrollbarScroll = useCallback(() => {
    const scrollbar = horizontalScrollbarRef.current;
    if (!scrollbar) {
      return;
    }

    setHorizontalScroll(scrollbar.scrollLeft);
  }, []);

  const handleViewportWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (maxHorizontalScroll <= 0) {
        return;
      }

      const deltaX =
        Math.abs(event.deltaX) > 0
          ? event.deltaX
          : event.shiftKey
            ? event.deltaY
            : 0;
      if (Math.abs(deltaX) < 1) {
        return;
      }

      event.preventDefault();
      setHorizontalScroll((current) =>
        clamp(current + deltaX, 0, maxHorizontalScroll)
      );
    },
    [maxHorizontalScroll]
  );

  if (!isOpen) return null;

  const handleOpenFile = async () => {
    const targetPath = resolveLocalPathToAbsolutePath(filePath, workspacePath);
    setIsOpening(true);
    setOpenNotice(null);

    if (!targetPath) {
      setOpenNotice({
        kind: 'error',
        message: t('modals.workspaceSingleFileDiff.openExplorerError'),
      });
      setIsOpening(false);
      return;
    }

    try {
      const result = await fileSystemApi.openInExplorer(targetPath);
      if (!result.ok) {
        setOpenNotice({
          kind: 'error',
          message: t('modals.workspaceSingleFileDiff.openExplorerError'),
        });
        return;
      }

      setOpenNotice({
        kind: 'success',
        message: t('modals.workspaceSingleFileDiff.openExplorerSuccess'),
      });
    } catch (error) {
      console.warn('Failed to open file in explorer', error);
      setOpenNotice({
        kind: 'error',
        message: t('modals.workspaceSingleFileDiff.openExplorerError'),
      });
    } finally {
      setIsOpening(false);
    }
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen((current) => !current);
  };

  const bounds = getModalBounds();
  const shellStyle = isFullscreen
    ? {
        width: '100%',
        height: '100%',
        maxWidth: '100%',
        maxHeight: '100%',
        minWidth: 0,
        minHeight: 0,
      }
    : {
        width: `${modalSize.width}px`,
        height: `${modalSize.height}px`,
        maxWidth: `${bounds.maxWidth}px`,
        maxHeight: `${bounds.maxHeight}px`,
        minWidth: `${bounds.minWidth}px`,
        minHeight: `${bounds.minHeight}px`,
        transform: `translateX(${horizontalOffset}px)`,
      };

  const FullscreenIcon = isFullscreen
    ? ArrowsInSimpleIcon
    : ArrowsOutSimpleIcon;

  return (
    <div
      className="chat-session-diff-modal-overlay fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="chat-session-diff-modal-backdrop absolute inset-0"
        onClick={onClose}
      />
      <div
        className={`chat-session-diff-modal-stage absolute inset-0 flex ${
          isFullscreen
            ? 'items-stretch justify-stretch p-3'
            : 'items-center justify-center p-4 md:p-6'
        }`}
        onClick={onClose}
      >
        {openNotice && (
          <div
            className={cn(
              'chat-session-workspaces-panel-notice',
              openNotice.kind === 'success' && 'is-success',
              openNotice.kind === 'error' && 'is-error'
            )}
            role="status"
            aria-live="polite"
          >
            {openNotice.kind === 'success' ? (
              <CheckCircleIcon
                className="chat-session-workspaces-panel-notice-icon"
                weight="fill"
              />
            ) : null}
            {openNotice.message}
          </div>
        )}
        <div
          className={`chat-session-diff-modal-shell${isFullscreen ? ' is-fullscreen' : ''}`}
          style={shellStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="chat-session-diff-modal-header">
            <div className="min-w-0">
              <div className="chat-session-diff-modal-title truncate">
                {filePath}
              </div>
              <div className="chat-session-diff-modal-path truncate">
                {workspacePath}
              </div>
            </div>
            <div className="chat-session-diff-modal-header-meta">
              <span className="chat-session-diff-modal-stat is-removed">
                - {diffStats.deletions}
              </span>
              <span className="chat-session-diff-modal-stat is-added">
                + {diffStats.additions}
              </span>
              <button
                type="button"
                className="chat-session-diff-modal-icon-button"
                onClick={handleToggleFullscreen}
                aria-label={
                  isFullscreen
                    ? t('modals.diffViewer.exitFullScreen')
                    : t('modals.diffViewer.fullScreen')
                }
              >
                <FullscreenIcon className="size-icon-sm" />
              </button>
              <button
                type="button"
                className="chat-session-diff-modal-icon-button"
                onClick={handleOpenFile}
                disabled={isOpening}
                title={t('modals.workspaceSingleFileDiff.openWorkspace')}
                aria-label={t('modals.workspaceSingleFileDiff.openWorkspace')}
              >
                <ArrowSquareUpRightIcon className="size-icon-sm" />
              </button>
              <button
                type="button"
                className="chat-session-diff-modal-icon-button"
                onClick={onClose}
                aria-label={t('modals.diffViewer.closeDiffViewer')}
              >
                <XIcon className="size-icon-sm" />
              </button>
            </div>
          </div>
          <div className="chat-session-diff-modal-body">
            {loading ? (
              <div className="chat-session-diff-modal-empty">
                {t('modals.diffViewer.loadingDiff')}
              </div>
            ) : error ? (
              <div className="chat-session-diff-modal-empty is-error">
                {error}
              </div>
            ) : isTooLarge ? (
              <div className="chat-session-diff-modal-empty">
                {t('modals.workspaceSingleFileDiff.tooLarge')}
              </div>
            ) : diffRows.length > 0 ? (
              <>
                <div
                  ref={contentViewportRef}
                  className="chat-session-diff-modal-viewport"
                  onWheel={handleViewportWheel}
                >
                  <div
                    className="chat-session-diff-modal-content"
                    style={{
                      width: `${contentWidth}px`,
                      transform: `translateX(-${horizontalScroll}px)`,
                    }}
                  >
                    {diffRows.map((row) => (
                      <div
                        key={row.key}
                        className={`chat-session-diff-line-row is-${row.kind}`}
                      >
                        <div className="chat-session-diff-line-num">
                          {row.lineNumber ?? ''}
                        </div>
                        <div className="chat-session-diff-line-content">
                          <span className="chat-session-diff-sign">
                            {row.sign}
                          </span>
                          <span>{row.content}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {maxHorizontalScroll > 0 && (
                  <div
                    ref={horizontalScrollbarRef}
                    className="chat-session-diff-modal-horizontal-scrollbar"
                    onScroll={handleHorizontalScrollbarScroll}
                  >
                    <div
                      className="chat-session-diff-modal-horizontal-scrollbar-spacer"
                      style={{ width: `${contentWidth}px` }}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="chat-session-diff-modal-empty">
                {t('conversation.unableToRenderDiff', { ns: 'common' })}
              </div>
            )}
          </div>
          {!isFullscreen && (
            <>
              <div
                className={`chat-session-diff-modal-resize-handle is-left${isResizing ? ' is-resizing' : ''}`}
                onPointerDown={handleStartResize('left')}
                aria-hidden="true"
              />
              <div
                className={`chat-session-diff-modal-resize-handle is-right${isResizing ? ' is-resizing' : ''}`}
                onPointerDown={handleStartResize('right')}
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
