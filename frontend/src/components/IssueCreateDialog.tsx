import {
  AlertTriangle,
  Box,
  Check,
  ChevronRight,
  FileText,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Search,
  Tag,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ProjectBreadcrumbAvatar } from '@/components/ProjectBreadcrumbAvatar';
import {
  COMMON_GITHUB_LABELS,
  labelColor,
  labelDisplayName,
  type IssueDetailTranslator,
} from '@/pages/IssueDetailPage';
import type {
  BackendChatSession,
  ProjectWorkItemPriority,
  ProjectWorkItemStatus,
} from '@/types';

export type IssueCreateDialogSubmitValue = {
  title: string;
  description: string;
  status: ProjectWorkItemStatus;
  priority: ProjectWorkItemPriority;
  labels: string[];
  sessionId: string | null;
  attachments: File[];
};

type IssueCreateDialogProps = {
  open: boolean;
  projectName: string;
  initialStatus?: ProjectWorkItemStatus;
  sessions: BackendChatSession[];
  sessionsLoading?: boolean;
  submitting?: boolean;
  tr: IssueDetailTranslator;
  availableLabels?: string[];
  onClose: () => void;
  onCreate: (value: IssueCreateDialogSubmitValue) => Promise<void> | void;
};

type PropertyMenu = 'status' | 'priority' | 'session' | 'labels' | null;

type MenuOption<TValue extends string> = {
  value: TValue;
  label: string;
  shortcut: string;
  icon?: ReactNode;
  color?: string;
};

type MenuOptionTemplate<TValue extends string> = Omit<
  MenuOption<TValue>,
  'label'
> & {
  fallback: string;
  labelKey: string;
};

const statusMenuOptions: Array<MenuOptionTemplate<ProjectWorkItemStatus>> = [
  {
    value: 'blocked',
    labelKey: 'issue.status.backlog',
    fallback: 'Backlog',
    shortcut: '1',
  },
  {
    value: 'open',
    labelKey: 'issue.status.todo',
    fallback: 'Todo',
    shortcut: '2',
  },
  {
    value: 'in_progress',
    labelKey: 'issue.status.in_progress',
    fallback: 'In Progress',
    shortcut: '3',
  },
  {
    value: 'ready_to_merge',
    labelKey: 'issue.status.ready_to_merge',
    fallback: 'Ready to Merge',
    shortcut: '4',
  },
  {
    value: 'merging',
    labelKey: 'issue.status.merging',
    fallback: 'Merging',
    shortcut: '5',
  },
  {
    value: 'done',
    labelKey: 'issue.status.done',
    fallback: 'Done',
    shortcut: '6',
  },
  {
    value: 'cancelled',
    labelKey: 'issue.status.cancelled',
    fallback: 'Canceled',
    shortcut: '7',
  },
  {
    value: 'duplicate',
    labelKey: 'issue.status.duplicate',
    fallback: 'Duplicate',
    shortcut: '8',
  },
];

const priorityMenuOptions: Array<
  MenuOptionTemplate<ProjectWorkItemPriority>
> = [
  {
    value: 'urgent',
    labelKey: 'issue.priority.urgent',
    fallback: 'Urgent',
    shortcut: '4',
  },
  {
    value: 'high',
    labelKey: 'issue.priority.high',
    fallback: 'High',
    shortcut: '3',
  },
  {
    value: 'medium',
    labelKey: 'issue.priority.medium',
    fallback: 'Medium',
    shortcut: '2',
  },
  {
    value: 'low',
    labelKey: 'issue.priority.low',
    fallback: 'Low',
    shortcut: '1',
  },
];

const buildTranslatedMenuOptions = <TValue extends string>(
  tr: IssueDetailTranslator,
  options: Array<MenuOptionTemplate<TValue>>,
): Array<MenuOption<TValue>> =>
  options.map(({ fallback, labelKey, ...option }) => ({
    ...option,
    label: tr(labelKey, fallback),
  }));

const buildLabelOptions = (
  tr: IssueDetailTranslator,
  availableLabels: readonly string[],
  selectedLabels: readonly string[],
): Array<MenuOption<string>> =>
  dedupeLabels([
    ...COMMON_GITHUB_LABELS,
    ...availableLabels,
    ...selectedLabels,
  ]).map((value, index) => ({
    value,
    label: labelDisplayName(value, tr),
    shortcut: index < 9 ? String(index + 1) : '',
    color: labelColor(value),
  }));

export function IssueCreateDialog({
  open,
  projectName,
  initialStatus = 'open',
  sessions,
  sessionsLoading = false,
  submitting = false,
  tr,
  availableLabels = [],
  onClose,
  onCreate,
}: IssueCreateDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectWorkItemStatus>(initialStatus);
  const [priority, setPriority] =
    useState<ProjectWorkItemPriority>('medium');
  const [labels, setLabels] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [openMenu, setOpenMenu] = useState<PropertyMenu>(null);
  const [statusQuery, setStatusQuery] = useState('');
  const [priorityQuery, setPriorityQuery] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [labelQuery, setLabelQuery] = useState('');
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const propertyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectLabel =
    projectName.trim() || tr('issue.createDialog.projectFallback', 'Project');
  const translatedStatusOptions = useMemo(
    () => buildTranslatedMenuOptions(tr, statusMenuOptions),
    [tr],
  );
  const translatedPriorityOptions = useMemo(
    () => buildTranslatedMenuOptions(tr, priorityMenuOptions),
    [tr],
  );
  const sessionOptions = useMemo<Array<MenuOption<string>>>(
    () =>
      sessions.map((session, index) => ({
        value: session.id,
        label: session.title?.trim() || session.id,
        shortcut: index < 9 ? String(index + 1) : '',
      })),
    [sessions],
  );
  const selectedSession = sessionOptions.find(
    (option) => option.value === sessionId,
  );
  const filteredStatusOptions = filterMenuOptions(
    translatedStatusOptions,
    statusQuery,
  );
  const filteredPriorityOptions = filterMenuOptions(
    translatedPriorityOptions,
    priorityQuery,
  );
  const filteredSessionOptions = filterMenuOptions(
    sessionOptions,
    sessionQuery,
  );
  const labelOptions = useMemo(
    () => buildLabelOptions(tr, availableLabels, labels),
    [availableLabels, labels, tr],
  );
  const filteredLabelOptions = filterMenuOptions(labelOptions, labelQuery);
  const noResultsLabel = tr('issue.createDialog.noResults', 'No results');

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      titleRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setStatus(initialStatus);
      setPriority('medium');
      setLabels([]);
      setSessionId(null);
      setAttachments([]);
      setExpanded(false);
      setOpenMenu(null);
      setStatusQuery('');
      setPriorityQuery('');
      setSessionQuery('');
      setLabelQuery('');
      setError('');
    }
  }, [initialStatus, open]);

  useEffect(() => {
    if (open) setStatus(initialStatus);
  }, [initialStatus, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        if (openMenu) {
          setOpenMenu(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, openMenu, submitting]);

  useEffect(() => {
    if (!openMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!propertyMenuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openMenu]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      titleRef.current?.focus();
      return;
    }

    setError('');
    try {
      await onCreate({
        title: trimmedTitle,
        description: description.trim(),
        status,
        priority,
        labels,
        sessionId,
        attachments,
      });
      onClose();
    } catch (createError) {
      setError(issueCreateErrorMessage(createError, tr));
    }
  };

  const handleFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== 'Enter' ||
      !event.ctrlKey ||
      event.nativeEvent.isComposing ||
      submitting ||
      !title.trim()
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.requestSubmit();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length > 0) {
      setAttachments((current) => [...current, ...nextFiles]);
    }
    event.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((current) =>
      current.filter((_, candidateIndex) => candidateIndex !== index),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6 text-[var(--ink)]">
      <style>{`
        .issue-create-title::placeholder,
        .issue-create-description::placeholder {
          color: var(--ink-tertiary);
          opacity: 1;
        }

        .issue-create-title,
        .issue-create-description {
          caret-color: var(--primary);
        }
      `}</style>

      <form
        aria-label={tr('issue.createDialog.ariaLabel', 'Create issue')}
        className={`flex w-[min(780px,calc(100vw-32px))] flex-col overflow-visible rounded-[22px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] shadow-[0_24px_64px_rgba(0,0,0,0.42)] transition-[height] duration-200 ${
          expanded
            ? 'h-[min(560px,calc(100vh-48px))]'
            : 'h-[min(372px,calc(100vh-48px))]'
        }`}
        onKeyDown={handleFormKeyDown}
        onSubmit={handleSubmit}
      >
        <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[var(--hairline)] px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 max-w-[260px] items-center gap-2 rounded-full bg-[var(--surface-4)] px-2.5 pr-3">
              <ProjectBreadcrumbAvatar name={projectLabel} />
              <span className="min-w-0 truncate text-[13px] font-bold leading-none text-[var(--ink)]">
                {projectLabel}
              </span>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--ink-tertiary)]"
              strokeWidth={2.4}
            />
            <h2 className="shrink-0 text-[16px] font-bold leading-none text-[var(--ink)]">
              {tr('issue.createDialog.title', 'New issue')}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 text-[var(--ink-subtle)]">
            <button
              aria-label={
                expanded
                  ? tr(
                      'issue.createDialog.action.collapse',
                      'Collapse create issue dialog',
                    )
                  : tr(
                      'issue.createDialog.action.expand',
                      'Expand create issue dialog',
                    )
              }
              aria-pressed={expanded}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              type="button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <Minimize2 aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Maximize2 aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
            <button
              aria-label={tr(
                'issue.createDialog.action.close',
                'Close create issue dialog',
              )}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              disabled={submitting}
              type="button"
              onClick={onClose}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col px-6 pb-4 pt-4">
          <label className="sr-only" htmlFor="issue-create-title">
            {tr('issue.createDialog.titleLabel', 'Issue title')}
          </label>
          <textarea
            ref={titleRef}
            id="issue-create-title"
            className="issue-create-title h-[38px] resize-none border-0 bg-transparent p-0 text-[26px] font-bold leading-[1.15] tracking-normal text-[var(--ink)] outline-none"
            placeholder={tr(
              'issue.createDialog.titlePlaceholder',
              'Issue title',
            )}
            rows={1}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label className="sr-only" htmlFor="issue-create-description">
            {tr('issue.createDialog.descriptionLabel', 'Issue description')}
          </label>
          <textarea
            id="issue-create-description"
            className="issue-create-description mt-2 min-h-[96px] flex-1 resize-none border-0 bg-transparent p-0 text-[16px] font-medium leading-[1.45] text-[var(--ink)] outline-none"
            placeholder={tr(
              'issue.createDialog.descriptionPlaceholder',
              'Add description...',
            )}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          <div
            ref={propertyMenuRef}
            className="mt-3 flex shrink-0 flex-wrap items-center gap-2"
          >
            <PropertyDropdown
              emptyLabel={noResultsLabel}
              open={openMenu === 'status'}
              options={filteredStatusOptions}
              query={statusQuery}
              searchPlaceholder={tr(
                'issue.detail.changeStatus',
                'Change status...',
              )}
              searchShortcut="S"
              selectedValue={status}
              triggerIcon={<StatusIcon status={status} />}
              triggerLabel={
                translatedStatusOptions.find(
                  (option) => option.value === status,
                )?.label ?? status
              }
              onOpenChange={(nextOpen) =>
                setOpenMenu(nextOpen ? 'status' : null)
              }
              onQueryChange={setStatusQuery}
              onSelect={(value) => {
                setStatus(value);
                setOpenMenu(null);
                setStatusQuery('');
              }}
              renderOptionIcon={(option) => (
                <StatusIcon status={option.value} />
              )}
            />

            <PropertyDropdown
              emptyLabel={noResultsLabel}
              open={openMenu === 'priority'}
              options={filteredPriorityOptions}
              query={priorityQuery}
              searchPlaceholder={tr(
                'issue.createDialog.changePriority',
                'Change priority...',
              )}
              searchShortcut="P"
              selectedValue={priority}
              triggerIcon={<PriorityIcon priority={priority} />}
              triggerLabel={
                translatedPriorityOptions.find(
                  (option) => option.value === priority,
                )?.label ?? priority
              }
              onOpenChange={(nextOpen) =>
                setOpenMenu(nextOpen ? 'priority' : null)
              }
              onQueryChange={setPriorityQuery}
              onSelect={(value) => {
                setPriority(value);
                setOpenMenu(null);
                setPriorityQuery('');
              }}
              renderOptionIcon={(option) => (
                <PriorityIcon priority={option.value} />
              )}
            />

            <PropertyDropdown
              emptyLabel={
                sessionsLoading
                  ? tr('issue.detail.loadingSessions', 'Loading sessions...')
                  : tr(
                      'issue.createDialog.noSessionsFound',
                      'No sessions found',
                    )
              }
              open={openMenu === 'session'}
              options={filteredSessionOptions}
              query={sessionQuery}
              searchPlaceholder={tr(
                'issue.detail.linkSessionPlaceholder',
                'Link session...',
              )}
              searchShortcut="L"
              selectedValue={sessionId}
              triggerIcon={<Box aria-hidden="true" className="h-3.5 w-3.5" />}
              triggerLabel={
                selectedSession?.label ??
                tr('issue.createDialog.session', 'Session')
              }
              onOpenChange={(nextOpen) =>
                setOpenMenu(nextOpen ? 'session' : null)
              }
              onQueryChange={setSessionQuery}
              onSelect={(value) => {
                setSessionId(value);
                setOpenMenu(null);
                setSessionQuery('');
              }}
            />

            <LabelDropdown
              labels={labels}
              open={openMenu === 'labels'}
              options={filteredLabelOptions}
              query={labelQuery}
              tr={tr}
              onOpenChange={(nextOpen) =>
                setOpenMenu(nextOpen ? 'labels' : null)
              }
              onQueryChange={setLabelQuery}
              onToggleLabel={(value) =>
                setLabels((current) => toggleLabel(current, value))
              }
            />
          </div>

          {attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <span
                  key={`${file.name}-${file.size}-${index}`}
                  className="inline-flex h-7 max-w-[220px] items-center gap-2 rounded-full bg-[var(--surface-3)] px-2.5 text-[12px] font-bold leading-none text-[var(--ink-muted)]"
                >
                  <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="shrink-0 text-[var(--ink-tertiary)]">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    aria-label={tr(
                      'issue.createDialog.removeAttachment',
                      'Remove {name}',
                      { name: file.name },
                    )}
                    className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-4)] hover:text-[var(--ink)]"
                    type="button"
                    onClick={() => removeAttachment(index)}
                  >
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-4 text-[13px] font-semibold text-[#ff8a85]">
              {error}
            </p>
          )}
        </main>

        <footer className="flex h-[64px] shrink-0 items-center justify-between border-t border-[var(--hairline)] px-5">
          <div>
            <input
              ref={fileInputRef}
              className="hidden"
              multiple
              type="file"
              onChange={handleFileChange}
            />
            <button
              aria-label={tr('issue.createDialog.attachFiles', 'Attach files')}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--surface-4)] text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-[0.98]"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip aria-hidden="true" className="h-[18px] w-[18px]" />
            </button>
          </div>

          <button
            className="h-9 rounded-full bg-[var(--primary)] px-4 text-[14px] font-bold leading-none text-white shadow-[0_10px_28px_rgba(98,109,222,0.24)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            disabled={submitting}
            type="submit"
          >
            {submitting
              ? tr('issue.createDialog.status.creating', 'Creating...')
              : tr('issue.createDialog.action.create', 'Create issue')}
          </button>
        </footer>
      </form>
    </div>
  );
}

function PropertyDropdown<TValue extends string>({
  emptyLabel,
  open,
  options,
  query,
  searchPlaceholder,
  searchShortcut,
  selectedValue,
  triggerIcon,
  triggerLabel,
  onOpenChange,
  onQueryChange,
  onSelect,
  renderOptionIcon,
}: {
  emptyLabel: string;
  open: boolean;
  options: Array<MenuOption<TValue>>;
  query: string;
  searchPlaceholder: string;
  searchShortcut: string;
  selectedValue: TValue | null;
  triggerIcon?: ReactNode;
  triggerLabel: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onSelect: (value: TValue) => void;
  renderOptionIcon?: (option: MenuOption<TValue>) => ReactNode;
}) {
  return (
    <div className="relative">
      <PropertyTrigger
        icon={triggerIcon}
        label={triggerLabel}
        open={open}
        onClick={() => onOpenChange(!open)}
      />

      {open && (
        <PropertyMenuShell>
          <PropertySearchRow
            placeholder={searchPlaceholder}
            shortcut={searchShortcut}
            value={query}
            onChange={onQueryChange}
          />
          <div
            className="max-h-[220px] space-y-1 overflow-y-auto px-3 py-3 ot-scroll-area-styled"
            role="listbox"
          >
            {options.length > 0 ? (
              options.map((option) => {
                const selected = selectedValue === option.value;
                return (
                  <button
                    key={option.value}
                    aria-selected={selected}
                    className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[7px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]"
                    role="option"
                    type="button"
                    onClick={() => onSelect(option.value)}
                  >
                    {renderOptionIcon?.(option) ?? option.icon}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <OptionShortcut
                      selected={selected}
                      shortcut={option.shortcut}
                    />
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-2 text-[13px] font-bold text-[var(--ink-tertiary)]">
                {emptyLabel}
              </p>
            )}
          </div>
        </PropertyMenuShell>
      )}
    </div>
  );
}

function LabelDropdown({
  labels,
  open,
  options,
  query,
  tr,
  onOpenChange,
  onQueryChange,
  onToggleLabel,
}: {
  labels: string[];
  open: boolean;
  options: Array<MenuOption<string>>;
  query: string;
  tr: IssueDetailTranslator;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  onToggleLabel: (label: string) => void;
}) {
  const labelText =
    labels.length === 0
      ? tr('issue.detail.panel.labels', 'Labels')
      : labels.map((label) => labelDisplayName(label, tr)).join(', ');
  const createLabelValue = query.trim();
  const canCreateLabel =
    createLabelValue !== '' &&
    !options.some(
      (option) => labelKey(option.value) === labelKey(createLabelValue),
    );
  const createLabelDisplay = labelDisplayName(createLabelValue, tr);

  const handleSearchEnter = () => {
    if (canCreateLabel) {
      onToggleLabel(createLabelValue);
      return;
    }
    const firstMatch = options.find((option) =>
      labelMatches(option.value, createLabelValue),
    );
    if (firstMatch) {
      onToggleLabel(firstMatch.value);
      return;
    }
    if (options[0]) onToggleLabel(options[0].value);
  };

  return (
    <div className="relative">
      <PropertyTrigger
        icon={<Tag aria-hidden="true" className="h-3.5 w-3.5" />}
        label={labelText}
        open={open}
        onClick={() => onOpenChange(!open)}
      />

      {open && (
        <PropertyMenuShell>
          <PropertySearchRow
            placeholder={tr(
              'issue.detail.addLabelsPlaceholder',
              'Add labels...',
            )}
            shortcut="L"
            value={query}
            onChange={onQueryChange}
            onEnter={handleSearchEnter}
          />
          <div
            className="max-h-[220px] space-y-1 overflow-y-auto px-3 py-3 ot-scroll-area-styled"
            role="listbox"
          >
            {options.map((option) => {
              const selected = labels.some((label) =>
                labelMatches(label, option.value),
              );
              return (
                <button
                  key={option.value}
                  aria-selected={selected}
                  className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[7px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]"
                  role="option"
                  type="button"
                  onClick={() => onToggleLabel(option.value)}
                >
                  <LabelColorDot color={option.color ?? '#8ddfcb'} />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  <OptionShortcut
                    selected={selected}
                    shortcut={option.shortcut}
                  />
                </button>
              );
            })}
            {canCreateLabel && (
              <button
                key={`create-${createLabelValue}`}
                aria-label={tr(
                  'issue.detail.createLabel',
                  "Create new label '{label}'",
                  { label: createLabelDisplay },
                )}
                className="flex h-8 w-full items-center gap-3 whitespace-nowrap rounded-[7px] px-3 text-left text-[13px] font-bold leading-none text-[var(--ink)] transition hover:bg-[var(--surface-4)]"
                role="option"
                type="button"
                onClick={() => onToggleLabel(createLabelValue)}
              >
                <Plus
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]"
                  strokeWidth={2.6}
                />
                <span className="min-w-0 flex-1 truncate">
                  {tr(
                    'issue.detail.createLabel',
                    "Create new label '{label}'",
                    { label: createLabelDisplay },
                  )}
                </span>
              </button>
            )}
          </div>
        </PropertyMenuShell>
      )}
    </div>
  );
}

function PropertyTrigger({
  icon,
  label,
  open,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      aria-haspopup="listbox"
      className="inline-flex h-8 max-w-[220px] items-center gap-2 rounded-full bg-[var(--surface-4)] px-3 text-[13px] font-bold leading-none text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] active:scale-[0.98]"
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function PropertyMenuShell({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-0 top-full z-50 mt-2 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[16px] border border-[var(--hairline-strong)] bg-[var(--surface-1)] text-[var(--ink)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
      {children}
    </div>
  );
}

function PropertySearchRow({
  placeholder,
  shortcut,
  value,
  onChange,
  onEnter,
}: {
  placeholder: string;
  shortcut: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  return (
    <div className="flex h-12 items-center gap-2.5 border-b border-[var(--hairline)] px-4">
      <Search
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]"
      />
      <input
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium leading-none text-[var(--ink)] caret-[var(--primary)] outline-none placeholder:text-[var(--ink-tertiary)]"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={
          onEnter
            ? (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onEnter();
                }
              }
            : undefined
        }
      />
      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-[5px] border border-[var(--hairline)] px-1 font-mono text-[11px] font-bold text-[var(--ink-tertiary)]">
        {shortcut}
      </span>
    </div>
  );
}

function OptionShortcut({
  selected,
  shortcut,
}: {
  selected: boolean;
  shortcut: string;
}) {
  return (
    <span className="ml-auto flex w-10 shrink-0 items-center justify-between text-[var(--ink-subtle)]">
      {selected ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-[var(--ink)]" />
      ) : (
        <span />
      )}
      {shortcut && (
        <span className="font-mono text-[11px] font-bold text-[var(--ink-tertiary)]">
          {shortcut}
        </span>
      )}
    </span>
  );
}

function StatusIcon({ status }: { status: ProjectWorkItemStatus }) {
  const dimension = 14;
  const borderWidth = 2;
  const iconSizeStyle = { height: dimension, width: dimension };
  const innerBackground = 'var(--surface-1)';

  if (status === 'blocked') {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full"
        style={{
          ...iconSizeStyle,
          background:
            'repeating-conic-gradient(#a9aab0 0deg 13deg, transparent 13deg 30deg)',
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${
            borderWidth * 2
          }px), #000 calc(100% - ${borderWidth}px))`,
        }}
      />
    );
  }

  if (status === 'open') {
    return (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full border-[#d9d9de]"
        style={{ ...iconSizeStyle, borderWidth }}
      />
    );
  }

  if (status === 'in_progress') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#f0c400]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute left-1/2 top-[2px] -translate-x-1/2 rounded-full bg-[#f0c400]"
          style={{ height: dimension * 0.32, width: borderWidth }}
        />
        <span
          className="absolute left-1/2 top-1/2 -translate-y-1/2 rounded-full bg-[#f0c400]"
          style={{ height: borderWidth, width: dimension * 0.32 }}
        />
      </span>
    );
  }

  if (status === 'ready_to_merge') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 overflow-hidden rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-r-full bg-[#4fc38b]"
          style={{
            bottom: borderWidth,
            right: borderWidth,
            top: borderWidth,
            width: dimension * 0.29,
          }}
        />
        <span
          className="absolute rounded-full"
          style={{
            backgroundColor: innerBackground,
            inset: borderWidth * 2,
          }}
        />
      </span>
    );
  }

  if (status === 'merging') {
    return (
      <span
        aria-hidden="true"
        className="relative shrink-0 rounded-full border-[#4fc38b]"
        style={{ ...iconSizeStyle, borderWidth }}
      >
        <span
          className="absolute rounded-full border-l-[#4fc38b] border-t-[#4fc38b]"
          style={{
            backgroundColor: innerBackground,
            borderLeftWidth: borderWidth * 1.6,
            borderTopWidth: borderWidth * 1.6,
            height: dimension * 0.48,
            left: dimension * 0.19,
            top: dimension * 0.16,
            width: dimension * 0.48,
          }}
        />
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-[#6671e8] text-[#141519]"
        style={iconSizeStyle}
      >
        <Check aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3.2} />
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span
        aria-hidden="true"
        className="relative flex shrink-0 items-center justify-center rounded-full bg-[#acbac8]"
        style={iconSizeStyle}
      >
        <span
          className="absolute rotate-45 rounded-full bg-white"
          style={{
            height: borderWidth * 1.08,
            width: dimension * 0.46,
          }}
        />
        <span
          className="absolute -rotate-45 rounded-full bg-white"
          style={{
            height: borderWidth * 1.08,
            width: dimension * 0.46,
          }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center rounded-full bg-[#acbac8]"
      style={iconSizeStyle}
    >
      <span
        className="absolute rounded-full bg-white"
        style={{
          height: borderWidth * 0.96,
          transform: `translateY(${-dimension * 0.12}px) rotate(-45deg)`,
          width: dimension * 0.45,
        }}
      />
      <span
        className="absolute rounded-full bg-white"
        style={{
          height: borderWidth * 0.96,
          transform: `translateY(${dimension * 0.12}px) rotate(-45deg)`,
          width: dimension * 0.45,
        }}
      />
    </span>
  );
}

function PriorityIcon({ priority }: { priority: ProjectWorkItemPriority }) {
  if (priority === 'urgent') {
    return (
      <AlertTriangle
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-[#f25f67]"
        strokeWidth={2.4}
      />
    );
  }

  const activeBars =
    priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;

  return (
    <span
      aria-hidden="true"
      className="flex h-3.5 w-3.5 shrink-0 items-end gap-[2px]"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={`w-[3px] rounded-full bg-[var(--ink-subtle)] ${
            index < activeBars ? 'opacity-100' : 'opacity-25'
          }`}
          style={{ height: [5, 8, 11][index] }}
        />
      ))}
    </span>
  );
}

function LabelColorDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function filterMenuOptions<TOption extends { label: string }>(
  options: TOption[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;
  return options.filter((option) =>
    option.label.toLowerCase().includes(normalizedQuery),
  );
}

function toggleLabel(labels: string[], label: string) {
  return labels.some((item) => labelMatches(item, label))
    ? labels.filter((item) => !labelMatches(item, label))
    : [...labels, label];
}

function labelMatches(left: string, right: string) {
  return labelKey(left) === labelKey(right);
}

function dedupeLabels(labels: readonly string[]) {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = labelKey(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labelKey(label: string) {
  return label.trim().toLowerCase();
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function issueCreateErrorMessage(
  error: unknown,
  tr: IssueDetailTranslator,
) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return tr(
    'issue.createDialog.error.createFailed',
    'Issue could not be created. Please try again.',
  );
}
