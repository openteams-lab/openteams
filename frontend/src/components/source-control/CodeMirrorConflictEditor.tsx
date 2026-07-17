import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Extension, Range } from '@codemirror/state';
import { languages } from '@codemirror/language-data';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { ArrowDown, ArrowUp } from 'lucide-react';

import {
  useCommandHandler,
  useShortcutScope,
} from '@/shortcuts/ShortcutProvider';
import type {
  ConflictHunkChoice,
  ParsedConflictText,
  WorktreeMergeConflictsViewProps,
} from './WorktreeMergeConflictsView';

interface CodeMirrorConflictEditorProps {
  path: string;
  currentContent: string;
  incomingContent: string;
  resultContent: string;
  parsed: ParsedConflictText;
  currentBranch: string;
  incomingBranch: string;
  tr: WorktreeMergeConflictsViewProps['tr'];
  onUseCurrent: () => void;
  onUseIncoming: () => void;
  onAcceptBoth: () => void;
  onChange: (content: string) => void;
}

const joinAcceptedBoth = (current: string, incoming: string): string => {
  if (!current) return incoming;
  if (!incoming) return current;
  return `${current}${current.endsWith('\n') ? '' : '\n'}${incoming}`;
};

const buildResult = (
  parsed: ParsedConflictText,
  choices: Record<string, ConflictHunkChoice>,
): string =>
  parsed.segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.content;
      const choice = choices[segment.hunk.id];
      if (!choice) return segment.hunk.original;
      if (choice === 'current') return segment.hunk.current;
      if (choice === 'session') return segment.hunk.session;
      return joinAcceptedBoth(segment.hunk.current, segment.hunk.session);
    })
    .join('');

const newlineCount = (content: string) =>
  content.match(/\n/g)?.length ?? 0;

const buildConflictRegions = (
  parsed: ParsedConflictText,
  side: 'current' | 'session',
  choices: Record<string, ConflictHunkChoice>,
  emptyLabel: string,
): ConflictRegion[] => {
  let line = 1;
  const regions: ConflictRegion[] = [];
  parsed.segments.forEach((segment) => {
    if (segment.kind === 'text') {
      line += newlineCount(segment.content);
      return;
    }
    const text = segment.hunk[side];
    regions.push({
      id: segment.hunk.id,
      text,
      lineHint: line,
      emptyLabel,
      choice: choices[segment.hunk.id],
    });
    line += newlineCount(text);
  });
  return regions;
};

export const CodeMirrorConflictEditor: React.FC<
  CodeMirrorConflictEditorProps
> = ({
  path,
  currentContent,
  incomingContent,
  resultContent,
  parsed,
  currentBranch,
  incomingBranch,
  tr,
  onUseCurrent,
  onUseIncoming,
  onAcceptBoth,
  onChange,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedHunkIndex, setSelectedHunkIndex] = useState(0);
  const [choices, setChoices] = useState<Record<string, ConflictHunkChoice>>(
    {},
  );
  const selectedHunk = parsed.hunks[selectedHunkIndex] ?? null;
  const unresolvedCount = parsed.hunks.filter(
    (hunk) => !choices[hunk.id],
  ).length;
  const currentRegions = useMemo(
    () =>
      buildConflictRegions(
        parsed,
        'current',
        choices,
        tr('worktree.merge.emptyCurrent', 'No current-side content'),
      ),
    [choices, parsed, tr],
  );
  const incomingRegions = useMemo(
    () =>
      buildConflictRegions(
        parsed,
        'session',
        choices,
        tr('worktree.merge.emptySession', 'No incoming-side content'),
      ),
    [choices, parsed, tr],
  );
  const selectedCurrentRegion = currentRegions[selectedHunkIndex] ?? null;
  const selectedIncomingRegion = incomingRegions[selectedHunkIndex] ?? null;

  useEffect(() => {
    setSelectedHunkIndex(0);
    setChoices({});
  }, [path]);

  const chooseHunk = (choice: ConflictHunkChoice) => {
    if (!selectedHunk) return;
    const nextChoices = { ...choices, [selectedHunk.id]: choice };
    setChoices(nextChoices);
    onChange(buildResult(parsed, nextChoices));
  };

  const moveHunk = (offset: number) => {
    setSelectedHunkIndex((index) =>
      Math.min(parsed.hunks.length - 1, Math.max(0, index + offset)),
    );
  };

  const ownsEventTarget = (target: EventTarget | null) =>
    target instanceof Node && Boolean(rootRef.current?.contains(target));
  const handlerBase = {
    scope: 'modal-menu' as const,
    contexts: ['worktree-merge-conflict'] as const,
    allowInEditable: true,
    ownsEventTarget,
  };

  useShortcutScope('worktree-merge-conflict', {
    active: true,
    rootRef,
  });
  useCommandHandler('worktree.conflict.previous', {
    ...handlerBase,
    enabled: selectedHunkIndex > 0,
    execute: () => moveHunk(-1),
  });
  useCommandHandler('worktree.conflict.next', {
    ...handlerBase,
    enabled: selectedHunkIndex < parsed.hunks.length - 1,
    execute: () => moveHunk(1),
  });
  useCommandHandler('worktree.conflict.accept-current', {
    ...handlerBase,
    enabled: Boolean(selectedHunk),
    execute: () => chooseHunk('current'),
  });
  useCommandHandler('worktree.conflict.accept-incoming', {
    ...handlerBase,
    enabled: Boolean(selectedHunk),
    execute: () => chooseHunk('session'),
  });
  useCommandHandler('worktree.conflict.accept-both', {
    ...handlerBase,
    enabled: Boolean(selectedHunk),
    execute: () => chooseHunk('both'),
  });

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-1 border-b border-[var(--hairline)] px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-tertiary)]">
          {path}
        </span>
        {parsed.hunks.length > 0 && (
          <>
            <span className="px-1 text-[10px] text-[var(--ink-tertiary)]">
              {tr('worktree.merge.unresolvedCount', '{count} unresolved', {
                count: unresolvedCount,
              })}
            </span>
            <button
              type="button"
              onClick={() => moveHunk(-1)}
              disabled={selectedHunkIndex === 0}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-25"
              title={tr('worktree.merge.previousHunk', 'Previous conflict point')}
            >
              <ArrowUp className="h-3 w-3" aria-hidden />
            </button>
            <span className="min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--ink-tertiary)]">
              {selectedHunkIndex + 1}/{parsed.hunks.length}
            </span>
            <button
              type="button"
              onClick={() => moveHunk(1)}
              disabled={selectedHunkIndex === parsed.hunks.length - 1}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:opacity-25"
              title={tr('worktree.merge.nextHunk', 'Next conflict point')}
            >
              <ArrowDown className="h-3 w-3" aria-hidden />
            </button>
          </>
        )}
      </div>

      {!selectedHunk && (
        <div className="flex min-h-8 shrink-0 items-center border-b border-[var(--hairline)] px-3 text-[10px]">
          <CodeLensAction
            active={false}
            label={tr('worktree.merge.useCurrent', 'Use current')}
            onClick={onUseCurrent}
          />
          <CodeLensSeparator />
          <CodeLensAction
            active={false}
            label={tr('worktree.merge.useSession', 'Use incoming')}
            onClick={onUseIncoming}
          />
          <CodeLensSeparator />
          <CodeLensAction
            active={false}
            label={tr('worktree.merge.acceptBoth', 'Accept both')}
            onClick={onAcceptBoth}
          />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(180px,1fr)_minmax(150px,0.72fr)] divide-y divide-[var(--hairline)] overflow-hidden">
        <div className="grid min-h-0 grid-cols-1 divide-y divide-[var(--hairline)] overflow-hidden lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <CodeEditorPane
            label={tr('worktree.merge.pane.current', 'Current')}
            description={tr(
              'worktree.merge.currentDescription',
              'Current modification',
            )}
            branch={currentBranch}
            path={path}
            content={currentContent}
            focusText={selectedHunk?.current ?? null}
            focusLine={selectedCurrentRegion?.lineHint ?? null}
            conflicts={currentRegions}
            selectedConflictId={selectedHunk?.id ?? null}
            actionLabels={{
              current: tr('worktree.merge.acceptCurrent', 'Accept current'),
              incoming: tr('worktree.merge.acceptSource', 'Accept incoming'),
              both: tr('worktree.merge.acceptBoth', 'Accept both'),
            }}
            onChooseConflict={(hunkId, choice) => {
              const hunkIndex = parsed.hunks.findIndex(
                (hunk) => hunk.id === hunkId,
              );
              if (hunkIndex >= 0) setSelectedHunkIndex(hunkIndex);
              const nextChoices = { ...choices, [hunkId]: choice };
              setChoices(nextChoices);
              onChange(buildResult(parsed, nextChoices));
            }}
            tone="current"
          />
          <CodeEditorPane
            label={tr('worktree.merge.pane.incoming', 'Incoming')}
            description={tr(
              'worktree.merge.incomingDescription',
              'Modification being merged',
            )}
            branch={incomingBranch}
            path={path}
            content={incomingContent}
            focusText={selectedHunk?.session ?? null}
            focusLine={selectedIncomingRegion?.lineHint ?? null}
            conflicts={incomingRegions}
            selectedConflictId={selectedHunk?.id ?? null}
            actionLabels={{
              current: tr('worktree.merge.acceptCurrent', 'Accept current'),
              incoming: tr('worktree.merge.acceptSource', 'Accept incoming'),
              both: tr('worktree.merge.acceptBoth', 'Accept both'),
            }}
            onChooseConflict={(hunkId, choice) => {
              const hunkIndex = parsed.hunks.findIndex(
                (hunk) => hunk.id === hunkId,
              );
              if (hunkIndex >= 0) setSelectedHunkIndex(hunkIndex);
              const nextChoices = { ...choices, [hunkId]: choice };
              setChoices(nextChoices);
              onChange(buildResult(parsed, nextChoices));
            }}
            tone="incoming"
          />
        </div>
        <CodeResultPane
          title={tr('worktree.merge.pane.result', 'Result')}
          path={path}
          content={resultContent}
          markerWarning={resultContent.includes('<<<<<<<')}
          tr={tr}
          onChange={onChange}
        />
      </div>
    </div>
  );
};

const CodeLensAction: React.FC<{
  active: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
}> = ({ active, label, shortcut, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded px-1.5 py-0.5 transition focus:outline-none ${
      active
        ? 'text-[var(--ink)] underline decoration-[var(--ink-tertiary)] underline-offset-4'
        : 'text-[var(--ink-tertiary)] hover:text-[var(--ink)] focus:text-[var(--ink)]'
    }`}
    title={shortcut ? `${label} (${shortcut})` : label}
  >
    {label}
    {shortcut && (
      <span className="ml-1 text-[9px] text-[var(--ink-tertiary)]">
        {shortcut}
      </span>
    )}
  </button>
);

const CodeLensSeparator = () => (
  <span className="text-[var(--hairline)]" aria-hidden>
    |
  </span>
);

interface ConflictRegion {
  id: string;
  text: string;
  lineHint: number;
  emptyLabel: string;
  choice?: ConflictHunkChoice;
}

interface ConflictActionLabels {
  current: string;
  incoming: string;
  both: string;
}

class ConflictActionsWidget extends WidgetType {
  constructor(
    readonly region: ConflictRegion,
    readonly selected: boolean,
    readonly labels: ConflictActionLabels,
    readonly onChoose: (hunkId: string, choice: ConflictHunkChoice) => void,
  ) {
    super();
  }

  eq(other: ConflictActionsWidget) {
    return (
      other.region.id === this.region.id &&
      other.region.choice === this.region.choice &&
      other.selected === this.selected &&
      other.labels.current === this.labels.current &&
      other.labels.incoming === this.labels.incoming &&
      other.labels.both === this.labels.both
    );
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = `cm-conflict-codelens${this.selected ? ' is-selected' : ''}`;

    const actions: Array<{
      label: string;
      choice: ConflictHunkChoice;
    }> = [
      { label: this.labels.current, choice: 'current' },
      { label: this.labels.incoming, choice: 'session' },
      { label: this.labels.both, choice: 'both' },
    ];
    actions.forEach((action, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'cm-conflict-codelens-separator';
        separator.textContent = '|';
        container.append(separator);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-conflict-codelens-action';
      if (this.region.choice === action.choice) button.classList.add('is-active');
      button.textContent = action.label;
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onChoose(this.region.id, action.choice);
      });
      container.append(button);
    });
    return container;
  }

  ignoreEvent() {
    return true;
  }
}

class EmptyConflictWidget extends WidgetType {
  constructor(
    readonly regionId: string,
    readonly label: string,
    readonly selected: boolean,
  ) {
    super();
  }

  eq(other: EmptyConflictWidget) {
    return (
      other.regionId === this.regionId &&
      other.label === this.label &&
      other.selected === this.selected
    );
  }

  toDOM() {
    const placeholder = document.createElement('div');
    placeholder.className = `cm-conflict-empty${this.selected ? ' is-selected' : ''}`;
    placeholder.setAttribute('role', 'note');
    placeholder.setAttribute('aria-label', this.label);
    const label = document.createElement('span');
    label.textContent = this.label;
    placeholder.append(label);
    return placeholder;
  }

  ignoreEvent() {
    return true;
  }
}

const conflictEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--surface-1)',
    color: 'var(--ink)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.55',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-1)',
    color: 'var(--ink-tertiary)',
    borderRight: '1px solid var(--hairline)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 16%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-conflict-block': {
    backgroundColor:
      'color-mix(in srgb, rgb(170, 216, 174) 22%, transparent)',
    borderLeft: '3px solid rgb(190, 126, 28)',
    borderRight: '3px solid rgb(190, 126, 28)',
    paddingLeft: '8px',
  },
  '.cm-conflict-block-start': {
    borderTop: '3px solid rgb(190, 126, 28)',
    paddingTop: '3px',
  },
  '.cm-conflict-block-end': {
    borderBottom: '3px solid rgb(190, 126, 28)',
    paddingBottom: '3px',
  },
  '.cm-conflict-block-selected': {
    backgroundColor:
      'color-mix(in srgb, rgb(150, 210, 160) 30%, transparent)',
  },
  '.cm-conflict-codelens': {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    minHeight: '25px',
    padding: '2px 8px',
    borderTop: '3px solid rgb(190, 126, 28)',
    borderLeft: '3px solid rgb(190, 126, 28)',
    borderRight: '3px solid rgb(190, 126, 28)',
    backgroundColor: 'var(--surface-1)',
    color: 'var(--ink-tertiary)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '10px',
  },
  '.cm-conflict-codelens-action': {
    border: '0',
    borderRadius: '3px',
    background: 'transparent',
    color: 'var(--ink-tertiary)',
    cursor: 'pointer',
    padding: '1px 5px',
  },
  '.cm-conflict-codelens-action:hover, .cm-conflict-codelens-action.is-active': {
    color: 'var(--ink)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },
  '.cm-conflict-codelens-separator': {
    color: 'var(--hairline)',
  },
  '.cm-conflict-empty': {
    boxSizing: 'border-box',
    minHeight: '38px',
    display: 'flex',
    alignItems: 'center',
    padding: '6px 11px',
    borderLeft: '3px solid rgb(190, 126, 28)',
    borderRight: '3px solid rgb(190, 126, 28)',
    borderBottom: '3px solid rgb(190, 126, 28)',
    background:
      'repeating-linear-gradient(-45deg, color-mix(in srgb, rgb(170, 216, 174) 20%, transparent) 0 7px, transparent 7px 14px)',
    color: 'var(--ink-tertiary)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '10px',
  },
  '.cm-conflict-empty.is-selected': {
    background:
      'repeating-linear-gradient(-45deg, color-mix(in srgb, rgb(150, 210, 160) 30%, transparent) 0 7px, transparent 7px 14px)',
  },
});

const useCodeLanguage = (path: string): Extension[] => {
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    let active = true;
    const fileName = path.split('/').at(-1) ?? path;
    const lowerFileName = fileName.toLowerCase();
    const description = languages.find(
      (language) =>
        language.filename?.test(fileName) ||
        language.extensions.some((extension) =>
          lowerFileName.endsWith(`.${extension.toLowerCase()}`),
        ),
    );

    if (!description) {
      setExtensions([]);
      return () => {
        active = false;
      };
    }

    void description.load().then((support) => {
      if (active) setExtensions([support]);
    });
    return () => {
      active = false;
    };
  }, [path]);

  return extensions;
};

const conflictDecorations = (
  content: string,
  conflicts: ConflictRegion[],
  selectedConflictId: string | null,
  labels: ConflictActionLabels,
  onChoose: (hunkId: string, choice: ConflictHunkChoice) => void,
): Extension[] => {
  const ranges: Range<Decoration>[] = [];
  let searchFrom = 0;

  conflicts.forEach((region) => {
    if (!region.text) {
      const position = positionForLine(content, region.lineHint);
      const selected = region.id === selectedConflictId;
      ranges.push(
        Decoration.widget({
          widget: new ConflictActionsWidget(region, selected, labels, onChoose),
          block: true,
          side: -2,
        }).range(position),
        Decoration.widget({
          widget: new EmptyConflictWidget(
            region.id,
            region.emptyLabel,
            selected,
          ),
          block: true,
          side: -1,
        }).range(position),
      );
      return;
    }
    let start = content.indexOf(region.text, searchFrom);
    if (start < 0) start = content.indexOf(region.text);
    if (start < 0) return;
    searchFrom = start + region.text.length;

    const selected = region.id === selectedConflictId;
    const lastCharacter = Math.max(start, start + region.text.length - 1);
    let lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineStarts: number[] = [];
    while (lineStart <= lastCharacter) {
      lineStarts.push(lineStart);
      const nextBreak = content.indexOf('\n', lineStart);
      if (nextBreak < 0 || nextBreak >= lastCharacter) break;
      lineStart = nextBreak + 1;
    }

    ranges.push(
      Decoration.widget({
        widget: new ConflictActionsWidget(region, selected, labels, onChoose),
        block: true,
        side: -1,
      }).range(lineStarts[0] ?? start),
    );
    lineStarts.forEach((position, index) => {
      const classes = [
        'cm-conflict-block',
        index === 0 ? 'cm-conflict-block-start' : '',
        index === lineStarts.length - 1 ? 'cm-conflict-block-end' : '',
        selected ? 'cm-conflict-block-selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      ranges.push(Decoration.line({ class: classes }).range(position));
    });
  });

  return ranges.length > 0
    ? [EditorView.decorations.of(Decoration.set(ranges, true))]
    : [];
};

const positionForLine = (content: string, lineNumber: number): number => {
  if (lineNumber <= 1) return 0;
  let position = 0;
  for (let line = 1; line < lineNumber; line += 1) {
    const nextBreak = content.indexOf('\n', position);
    if (nextBreak < 0) return content.length;
    position = nextBreak + 1;
  }
  return position;
};

const scrollEditorToConflict = (
  view: EditorView,
  content: string,
  focusText: string | null,
  focusLine: number | null,
) => {
  const textPosition = focusText ? content.indexOf(focusText) : -1;
  const position =
    focusLine !== null
      ? positionForLine(content, focusLine)
      : textPosition;
  if (position < 0) return;
  requestAnimationFrame(() => {
    view.dispatch({
      effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
  });
};

const SyntaxCodeEditor: React.FC<{
  path: string;
  content: string;
  editable: boolean;
  focusText?: string | null;
  focusLine?: number | null;
  conflicts?: ConflictRegion[];
  selectedConflictId?: string | null;
  actionLabels?: ConflictActionLabels;
  onChooseConflict?: (
    hunkId: string,
    choice: ConflictHunkChoice,
  ) => void;
  onChange?: (content: string) => void;
}> = ({
  path,
  content,
  editable,
  focusText = null,
  focusLine = null,
  conflicts = [],
  selectedConflictId = null,
  actionLabels,
  onChooseConflict,
  onChange,
}) => {
  const editorRef = useRef<EditorView | null>(null);
  const languageExtensions = useCodeLanguage(path);
  const focusExtensions = useMemo(
    () =>
      actionLabels && onChooseConflict
        ? conflictDecorations(
            content,
            conflicts,
            selectedConflictId,
            actionLabels,
            onChooseConflict,
          )
        : [],
    [
      actionLabels,
      conflicts,
      content,
      onChooseConflict,
      selectedConflictId,
    ],
  );

  useEffect(() => {
    if (editorRef.current) {
      scrollEditorToConflict(editorRef.current, content, focusText, focusLine);
    }
  }, [content, focusLine, focusText]);

  return (
    <CodeMirror
      value={content}
      height="100%"
      readOnly={!editable}
      editable={editable}
      theme={conflictEditorTheme}
      extensions={[...languageExtensions, ...focusExtensions]}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      onCreateEditor={(view) => {
        editorRef.current = view;
        scrollEditorToConflict(view, content, focusText, focusLine);
      }}
      onChange={(value) => onChange?.(value)}
      className="h-full min-h-0 overflow-hidden [&_.cm-editor]:h-full"
    />
  );
};

const CodeEditorPane: React.FC<{
  label: string;
  description: string;
  branch: string;
  path: string;
  content: string;
  focusText: string | null;
  focusLine: number | null;
  conflicts: ConflictRegion[];
  selectedConflictId: string | null;
  actionLabels: ConflictActionLabels;
  onChooseConflict: (
    hunkId: string,
    choice: ConflictHunkChoice,
  ) => void;
  tone: 'current' | 'incoming';
}> = ({
  label,
  description,
  branch,
  path,
  content,
  focusText,
  focusLine,
  conflicts,
  selectedConflictId,
  actionLabels,
  onChooseConflict,
  tone,
}) => (
  <div className="flex min-h-0 min-w-0 flex-col">
    <div
      className={`flex h-7 shrink-0 items-center gap-2 border-b border-[var(--hairline)] border-t-2 px-3 ${
        tone === 'current'
          ? 'border-t-sky-400/60'
          : 'border-t-emerald-400/50'
      }`}
    >
      <span className="text-[11px] font-semibold text-[var(--ink)]">
        {label}
      </span>
      <span className="truncate text-[10px] text-[var(--ink-tertiary)]">
        {description} · {branch}
      </span>
    </div>
    <div className="min-h-0 flex-1">
      <SyntaxCodeEditor
        path={path}
        content={content}
        editable={false}
        focusText={focusText}
        focusLine={focusLine}
        conflicts={conflicts}
        selectedConflictId={selectedConflictId}
        actionLabels={actionLabels}
        onChooseConflict={onChooseConflict}
      />
    </div>
  </div>
);

const CodeResultPane: React.FC<{
  title: string;
  path: string;
  content: string;
  markerWarning: boolean;
  tr: WorktreeMergeConflictsViewProps['tr'];
  onChange: (content: string) => void;
}> = ({ title, path, content, markerWarning, tr, onChange }) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3">
      <span className="text-[11px] font-semibold text-[var(--ink)]">{title}</span>
      <span className="min-w-0 truncate font-mono text-[9px] text-[var(--ink-tertiary)]">
        {path}
      </span>
      {markerWarning && (
        <span className="ml-auto border-l border-rose-500/40 pl-2 text-[9px] text-rose-600">
          {tr('worktree.merge.markersRemain', 'Conflict markers remain')}
        </span>
      )}
    </div>
    <div className="min-h-0 flex-1">
      <SyntaxCodeEditor
        path={path}
        content={content}
        editable
        onChange={onChange}
      />
    </div>
  </div>
);
