import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Check,
  ChevronRight,
  FileText,
  FolderGit2,
  GitBranch,
  Image as ImageIcon,
  Maximize2,
  Paperclip,
  X,
} from 'lucide-react';
import {
  CommandSelectList,
  CommandSelectMenu,
  CommandSelectNoMatches,
  CommandSelectSearchRow,
} from '@/components/CommandSelectMenu';
import {
  DropdownSelect,
  type DropdownSelectOption,
} from '@/components/DropdownSelect';
import { chatSessionsApi, projectWorkItemsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  canUseIsolatedWorktree,
  isolatedWorktreeModeOrUndefined,
  nextIsolatedWorktreeSelection,
  resolveCreateSessionWorktreeWorkspacePath,
} from '@/components/worktreeWorkspaceGuard';
import type {
  ChatSessionWorktreeMode,
  Member,
  ProjectWorkItem,
} from '@/types';
import { createPortal } from 'react-dom';

type CreateTaskMode = 'workflow' | 'freeChat';

interface CreateAgentSessionModalProps {
  open: boolean;
  projectId?: string;
  projectName?: string;
  workspacePath?: string | null;
  workflowWorkspacePath?: string | null;
  memberWorkspacePaths?: Record<string, string | null>;
  members?: Member[];
  leadMember?: Member | null;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  onClose: () => void;
  onCreate: (
    prompt: string,
    options: {
      taskMode: CreateTaskMode;
      memberId?: string;
      memberName?: string;
      memberAvatar?: string;
      memberModelName?: string;
      workItemId?: string;
      worktreeMode?: ChatSessionWorktreeMode;
      attachments?: File[];
    },
  ) => void;
}

const translate = (
  t: CreateAgentSessionModalProps['t'],
  key: string,
  fallback: string,
  replacements?: Record<string, string | number>,
) => {
  const translated = t(key, replacements);
  return translated && translated !== key ? translated : fallback;
};

const allowedTextAttachmentExtensions = [
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.go',
  '.rs',
  '.sql',
  '.sh',
  '.bash',
  '.svg',
];

const allowedImageAttachmentExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
];

const CHAT_ATTACHMENT_ACCEPT = [
  'text/*',
  'image/*',
  ...allowedTextAttachmentExtensions,
  ...allowedImageAttachmentExtensions,
].join(',');

const VSCODE_IFRAME_CLIPBOARD_FILES_EVENT =
  'openteams:vscode-clipboard-files';

const isImageAttachment = (file: File) =>
  file.type.startsWith('image/') ||
  allowedImageAttachmentExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );

const isTextAttachment = (file: File) =>
  file.type.startsWith('text/') ||
  allowedTextAttachmentExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext),
  );

const isAllowedAttachment = (file: File) =>
  isImageAttachment(file) || isTextAttachment(file);

const fallbackClipboardFileName = (file: File, index: number) => {
  if (file.name.trim()) return file.name;

  const extension = file.type.startsWith('image/')
    ? (file.type.split('/')[1] ?? 'png')
    : file.type === 'text/plain'
      ? 'txt'
      : 'dat';

  return `pasted-attachment-${Date.now()}-${index + 1}.${extension}`;
};

const normalizeClipboardFile = (file: File, index: number) =>
  file.name.trim()
    ? file
    : new File([file], fallbackClipboardFileName(file, index), {
        type: file.type,
        lastModified: file.lastModified || Date.now(),
      });

const getClipboardFiles = (clipboardData: DataTransfer) => {
  const itemFiles = Array.from(clipboardData.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const files =
    itemFiles.length > 0 ? itemFiles : Array.from(clipboardData.files);

  return files.map(normalizeClipboardFile);
};

const attachmentIdentity = (file: File) =>
  `${file.name}:${file.size}:${file.lastModified}`;

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export function CreateAgentSessionModal({
  open,
  projectId,
  projectName,
  workspacePath,
  workflowWorkspacePath,
  memberWorkspacePaths = {},
  members = [],
  leadMember,
  t,
  onClose,
  onCreate,
}: CreateAgentSessionModalProps) {
  const [prompt, setPrompt] = useState('');
  const [taskMode, setTaskMode] = useState<CreateTaskMode>('freeChat');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [workItems, setWorkItems] = useState<ProjectWorkItem[]>([]);
  const [workItemsLoading, setWorkItemsLoading] = useState(false);
  const [workItemsError, setWorkItemsError] = useState('');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const [workItemMenuOpen, setWorkItemMenuOpen] = useState(false);
  const [workItemMenuRect, setWorkItemMenuRect] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [activeWorkItemOptionIndex, setActiveWorkItemOptionIndex] = useState(0);
  const [workItemQuery, setWorkItemQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [isolateWorktree, setIsolateWorktree] = useState(false);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workItemMenuRef = useRef<HTMLDivElement | null>(null);
  const workItemPortalRef = useRef<HTMLDivElement | null>(null);
  const activeWorkItemOptionRef = useRef<HTMLButtonElement | null>(null);
  const mainAgent = leadMember === undefined ? members[0] : leadMember;
  const isPlanMode = taskMode === 'workflow';
  const selectableMembers = useMemo(
    () => (isPlanMode ? (mainAgent ? [mainAgent] : []) : members),
    [isPlanMode, mainAgent, members],
  );
  const selectedMember =
    selectableMembers.find((member) => member.id === selectedMemberId) ??
    selectableMembers[0];
  const selectedWorkItem = workItems.find(
    (item) => item.id === selectedWorkItemId,
  );
  const workspacePathForWorktree = useMemo(() => {
    return resolveCreateSessionWorktreeWorkspacePath({
      isPlanMode,
      selectedMemberName: selectedMember?.name,
      projectWorkspacePath: workspacePath,
      workflowWorkspacePath,
      memberWorkspacePaths,
    });
  }, [
    isPlanMode,
    memberWorkspacePaths,
    selectedMember?.name,
    workflowWorkspacePath,
    workspacePath,
  ]);
  const memberOptions = useMemo<DropdownSelectOption[]>(
    () =>
      selectableMembers.map((member) => ({
        id: member.id,
        label: member.name,
        description: member.roleDetail,
        leading: (
          <span className="flex h-4.5 w-4.5 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] font-mono text-[8px] text-[var(--ink-subtle)]">
            {member.avatar}
          </span>
        ),
      })),
    [selectableMembers],
  );
  const workItemOptions = useMemo(() => {
    const normalizedQuery = workItemQuery.trim().toLowerCase();
    return workItems
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [
          item.title,
          item.status,
          item.priority,
          item.source,
          item.description ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .map((item) => ({
        value: item.id,
        label: item.title,
        detail: `${item.status.replaceAll('_', ' ')} - ${item.priority}`,
      }));
  }, [workItemQuery, workItems]);

  const addAttachedFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const allowedFiles = list.filter((file) => isAllowedAttachment(file));
      const rejectedCount = list.length - allowedFiles.length;

      if (rejectedCount > 0) {
        setAttachmentError(
          translate(
            t,
            'attachment.unsupported',
            `${rejectedCount} unsupported attachment(s) skipped. Only text files and images are allowed.`,
            { count: rejectedCount },
          ),
        );
      } else {
        setAttachmentError('');
      }

      if (allowedFiles.length === 0) return;

      setAttachedFiles((current) => {
        const existing = new Set(current.map(attachmentIdentity));
        const next = [...current];
        for (const file of allowedFiles) {
          const identity = attachmentIdentity(file);
          if (!existing.has(identity)) {
            existing.add(identity);
            next.push(file);
          }
        }
        return next;
      });
    },
    [t],
  );

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleClipboardFiles = (event: Event) => {
      const files =
        (event as CustomEvent<{ files?: File[] }>).detail?.files ?? [];
      if (files.length === 0) return;
      event.preventDefault();
      addAttachedFiles(files);
    };

    const textarea = textareaRef.current;
    textarea?.addEventListener(
      VSCODE_IFRAME_CLIPBOARD_FILES_EVENT,
      handleClipboardFiles,
    );
    window.addEventListener(
      VSCODE_IFRAME_CLIPBOARD_FILES_EVENT,
      handleClipboardFiles,
    );

    return () => {
      textarea?.removeEventListener(
        VSCODE_IFRAME_CLIPBOARD_FILES_EVENT,
        handleClipboardFiles,
      );
      window.removeEventListener(
        VSCODE_IFRAME_CLIPBOARD_FILES_EVENT,
        handleClipboardFiles,
      );
    };
  }, [addAttachedFiles, open]);

  useEffect(() => {
    if (open) return;
    setWorkItemMenuOpen(false);
    setWorkItemMenuRect(null);
    setWorkItemQuery('');
    setActiveWorkItemOptionIndex(0);
    setAttachedFiles([]);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [open]);

  useEffect(() => {
    if (!workItemMenuOpen) return;
    setActiveWorkItemOptionIndex(0);
  }, [workItemMenuOpen, workItemQuery]);

  useEffect(() => {
    if (!workItemMenuOpen) return;
    setActiveWorkItemOptionIndex((current) =>
      workItemOptions.length === 0
        ? 0
        : Math.min(current, workItemOptions.length - 1),
    );
  }, [workItemMenuOpen, workItemOptions.length]);

  useEffect(() => {
    if (!workItemMenuOpen) return;
    activeWorkItemOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeWorkItemOptionIndex, workItemMenuOpen, workItemOptions.length]);

  useEffect(() => {
    if (!open) return;
    const nextMember = selectableMembers.find(
      (member) => member.id === selectedMemberId,
    );
    if (nextMember) return;
    setSelectedMemberId(selectableMembers[0]?.id ?? '');
  }, [open, selectableMembers, selectedMemberId]);

  useEffect(() => {
    if (!open || !projectId) {
      setWorkItems([]);
      setWorkItemsLoading(false);
      setWorkItemsError('');
      setSelectedWorkItemId('');
      return;
    }

    let cancelled = false;
    setWorkItemsLoading(true);
    setWorkItemsError('');
    void projectWorkItemsApi
      .list(projectId)
      .then((items) => {
        if (cancelled) return;
        setWorkItems(items);
        setSelectedWorkItemId((current) =>
          current && items.some((item) => item.id === current) ? current : '',
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setWorkItems([]);
        setSelectedWorkItemId('');
        setWorkItemsError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (!cancelled) setWorkItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Detect Git support for the exact workspace path that will be submitted.
  // Repo integrations are not enough here: a project can have repos connected
  // while its current workspace path is plain or missing.
  useEffect(() => {
    if (!open) {
      setGitAvailable(null);
      return;
    }
    const trimmedWorkspacePath = workspacePathForWorktree?.trim() ?? '';
    if (!trimmedWorkspacePath) {
      setGitAvailable(false);
      setIsolateWorktree(false);
      return;
    }
    let cancelled = false;
    setGitAvailable(null);
    void chatSessionsApi
      .validateWorkspacePath(trimmedWorkspacePath)
      .then((response) => {
        if (cancelled) return;
        const available = response.valid && response.is_git_repo;
        setGitAvailable(available);
        if (!available) setIsolateWorktree(false);
      })
      .catch(() => {
        if (cancelled) return;
        setGitAvailable(false);
        setIsolateWorktree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePathForWorktree]);

  useEffect(() => {
    if (canUseIsolatedWorktree(gitAvailable)) return;
    setIsolateWorktree(false);
  }, [gitAvailable]);

  // Reset the worktree toggle whenever the composer closes so a prior choice
  // does not leak into the next session creation (default = main workspace).
  useEffect(() => {
    if (open) return;
    setIsolateWorktree(false);
  }, [open]);

  useEffect(() => {
    if (!workItemMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        !workItemMenuRef.current?.contains(event.target as Node) &&
        !workItemPortalRef.current?.contains(event.target as Node)
      ) {
        setWorkItemMenuOpen(false);
        setWorkItemQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [workItemMenuOpen]);

  if (!open) return null;

  const trimmedPrompt = prompt.trim();
  const canCreate =
    (trimmedPrompt.length > 0 || attachedFiles.length > 0) &&
    Boolean(selectedMember);
  const projectLabel =
    projectName ?? translate(t, 'createSession.projectFallback', 'openteams');

  const handleCreate = () => {
    if (!canCreate || !selectedMember) return;
    onCreate(trimmedPrompt, {
      taskMode,
      memberId: selectedMember.id,
      memberName: selectedMember.name,
      memberAvatar: selectedMember.avatar,
      memberModelName: selectedMember.modelName,
      workItemId: selectedWorkItemId || undefined,
      worktreeMode: isolatedWorktreeModeOrUndefined(
        isolateWorktree,
        gitAvailable,
      ),
      attachments: attachedFiles,
    });
    setPrompt('');
    setAttachedFiles([]);
    setAttachmentError('');
    onClose();
  };

  const handleAttachmentInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (event.target.files) {
      addAttachedFiles(event.target.files);
    }
    event.target.value = '';
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getClipboardFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    addAttachedFiles(files);
  };

  const removeAttachedFile = (fileIndex: number) => {
    setAttachedFiles((current) =>
      current.filter((_, index) => index !== fileIndex),
    );
  };

  const handleModeChange = (nextMode: CreateTaskMode) => {
    setTaskMode(nextMode);
    if (nextMode === 'workflow') {
      setSelectedMemberId(mainAgent?.id ?? '');
      return;
    }
    setSelectedMemberId((currentId) =>
      members.some((member) => member.id === currentId)
        ? currentId
        : members[0]?.id || '',
    );
  };

  const handleTogglePlanMode = () => {
    handleModeChange(isPlanMode ? 'freeChat' : 'workflow');
  };

  const updateWorkItemMenuRect = () => {
    const trigger = workItemMenuRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(360, window.innerWidth - 32);
    setWorkItemMenuRect({
      left: Math.min(
        Math.max(16, rect.left),
        window.innerWidth - menuWidth - 16,
      ),
      top: rect.top - 8,
    });
  };

  const handleToggleWorkItemMenu = () => {
    setWorkItemMenuOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) updateWorkItemMenuRect();
      return nextOpen;
    });
  };

  const handleWorkItemSelect = (workItemId: string) => {
    setSelectedWorkItemId((current) =>
      current === workItemId ? '' : workItemId,
    );
    setWorkItemMenuOpen(false);
    setWorkItemQuery('');
  };

  const handleWorkItemMenuKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setWorkItemMenuOpen(false);
      setWorkItemQuery('');
      return;
    }

    if (workItemOptions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveWorkItemOptionIndex(
        (current) => (current + 1) % workItemOptions.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveWorkItemOptionIndex(
        (current) =>
          (current - 1 + workItemOptions.length) % workItemOptions.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = workItemOptions[activeWorkItemOptionIndex];
      if (option) handleWorkItemSelect(option.value);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleCreate();
    }
  };

  const memberEngineLabel =
    selectedMember?.modelName?.trim() ||
    selectedMember?.roleDetail?.split(' - ')[0]?.trim() ||
    'agent';
  const workItemButtonLabel = selectedWorkItem
    ? selectedWorkItem.title
    : workItemsLoading
      ? translate(t, 'createSession.issueLoading', 'Loading issues...')
      : translate(t, 'createSession.issueLink', 'Link issue');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#050608]/30 p-4 backdrop-blur-sm sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={translate(t, 'createSession.close', 'Close create session')}
        onClick={onClose}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-session-title"
        className={`relative flex w-full flex-col overflow-hidden rounded-[14px] border border-[var(--hairline-strong)] bg-[var(--surface-2)] text-[14px] text-[var(--ink)] shadow-2xl shadow-black/40 ${
          expanded
            ? 'h-[min(620px,calc(100vh-48px))] max-w-[min(780px,calc(100vw-32px))]'
            : 'min-h-[320px] max-w-[620px]'
        }`}
      >
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-3.5 pt-5">
          <header className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2 text-[14px]">
              <span className="truncate text-[var(--ink-subtle)]">
                {projectLabel}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-tertiary)]" />
              <h2
                id="create-agent-session-title"
                className="truncate font-semibold text-[var(--ink)]"
              >
                {translate(t, 'createSession.title', 'New session')}
              </h2>
            </div>

            <div className="flex shrink-0 items-center gap-3 text-[var(--ink-subtle)]">
              <button
                type="button"
                className="rounded-md p-1 transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                aria-pressed={expanded}
                aria-label={
                  expanded
                    ? translate(t, 'createSession.shrink', 'Shrink composer')
                    : translate(t, 'createSession.expand', 'Expand composer')
                }
                title={
                  expanded
                    ? translate(t, 'createSession.shrink', 'Shrink composer')
                    : translate(t, 'createSession.expand', 'Expand composer')
                }
                onClick={() => setExpanded((current) => !current)}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                aria-label={translate(
                  t,
                  'createSession.close',
                  'Close create session',
                )}
                title={translate(
                  t,
                  'createSession.close',
                  'Close create session',
                )}
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="mt-5 flex items-start gap-2 text-[14px] text-[var(--ink-subtle)]">
            <span className="shrink-0 pt-1">
              {translate(t, 'createSession.memberLabel', 'Member')}
            </span>
            {isPlanMode ? (
              selectedMember ? (
                <div className="inline-flex min-w-0 max-w-[280px] items-center gap-2 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ink)]">
                  <span className="flex h-4.5 w-4.5 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] font-mono text-[8px] text-[var(--ink-subtle)]">
                    {selectedMember.avatar}
                  </span>
                  <span className="truncate">{selectedMember.name}</span>
                  <span className="truncate font-mono text-[10px] font-medium text-[var(--ink-tertiary)]">
                    {memberEngineLabel}
                  </span>
                </div>
              ) : (
                <span className="rounded-md border border-[var(--hairline)] px-2.5 py-1.5 text-[14px] text-[var(--ink-tertiary)]">
                  {translate(
                    t,
                    'createSession.noMembers',
                    'No members available',
                  )}
                </span>
              )
            ) : (
              <DropdownSelect
                value={selectedMember?.id ?? ''}
                options={memberOptions}
                placeholder={translate(
                  t,
                  'createSession.noMembers',
                  'No members available',
                )}
                searchPlaceholder={translate(
                  t,
                  'agentSearchPlaceholder',
                  'Filter agents...',
                )}
                emptyLabel={translate(
                  t,
                  'createSession.noMembers',
                  'No members available',
                )}
                disabled={memberOptions.length === 0}
                className="w-[168px] max-w-full shrink-0 [&>button]:py-1"
                maxPanelHeightClassName="max-h-[144px]"
                panelClassName="absolute left-0 top-full max-w-none"
                onChange={(memberId) => setSelectedMemberId(memberId)}
              />
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            accept={CHAT_ATTACHMENT_ACCEPT}
            onChange={handleAttachmentInputChange}
          />

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={translate(
              t,
              'createSession.promptPlaceholder',
              'Tell the agent what to do, e.g. "let Bohan fix the inbox loading slowness in the Web project"',
            )}
            className="mt-2.5 min-h-[96px] flex-1 resize-none bg-transparent text-[14px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)]"
          />

          {attachmentError && (
            <div className="mt-2 rounded-md border border-[color-mix(in_srgb,#e11d48_32%,var(--hairline))] bg-[color-mix(in_srgb,#e11d48_8%,var(--surface-1))] px-3 py-2 text-[11px] font-medium text-[#be123c]">
              {attachmentError}
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => {
                const AttachmentIcon = isImageAttachment(file)
                  ? ImageIcon
                  : FileText;
                return (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    className="flex max-w-full items-center gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)]"
                  >
                    <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
                    <span
                      className="max-w-[180px] truncate font-medium text-[var(--ink)]"
                      title={file.name}
                    >
                      {file.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--ink-tertiary)]">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(index)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
                      title={translate(
                        t,
                        'attachment.remove',
                        'Remove attachment',
                      )}
                      aria-label={translate(
                        t,
                        'attachment.remove',
                        'Remove attachment',
                      )}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(
                'plan-mode-toggle flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] font-medium transition cursor-pointer',
                isPlanMode
                  ? 'plan-mode-toggle-active border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)]'
                  : 'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:bg-[var(--surface-3)]',
              )}
              title={
                isPlanMode
                  ? translate(t, 'switchToChatMode', 'Switch to chat mode')
                  : translate(t, 'switchToPlanMode', 'Switch to plan mode')
              }
              aria-pressed={isPlanMode}
              aria-label={
                isPlanMode
                  ? translate(t, 'switchToChatMode', 'Switch to chat mode')
                  : translate(t, 'switchToPlanMode', 'Switch to plan mode')
              }
              onClick={handleTogglePlanMode}
            >
              <GitBranch className="h-3 w-3" />
              <span>{translate(t, 'planMode', 'Plan mode')}</span>
            </button>

            <button
              type="button"
              disabled={!canUseIsolatedWorktree(gitAvailable)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-1 text-[12px] font-medium transition',
                isolateWorktree
                  ? 'border-[var(--primary)] bg-[var(--primary-tint)] text-[var(--primary)] cursor-pointer'
                  : 'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:bg-[var(--surface-3)] cursor-pointer',
                !canUseIsolatedWorktree(gitAvailable) &&
                  'cursor-not-allowed opacity-50 hover:bg-[var(--surface-2)]',
              )}
              title={
                gitAvailable === null
                  ? translate(
                      t,
                      'createSession.worktreeCheckingGit',
                      'Checking Git workspace',
                    )
                  : gitAvailable === false
                  ? translate(
                      t,
                      'createSession.worktreeRequiresGit',
                      'Requires a Git workspace',
                    )
                  : translate(
                      t,
                      'createSession.isolateWorktree',
                      'Isolate this session in a Git worktree',
                    )
              }
              aria-pressed={isolateWorktree}
              aria-label={translate(
                t,
                'createSession.isolateWorktree',
                'Isolate this session in a Git worktree',
              )}
              onClick={() =>
                setIsolateWorktree((current) =>
                  nextIsolatedWorktreeSelection(current, gitAvailable),
                )
              }
            >
              <FolderGit2 className="h-3 w-3" />
              <span>
                {translate(
                  t,
                  'createSession.isolateWorktree',
                  'Isolate worktree',
                )}
              </span>
            </button>

            <div ref={workItemMenuRef} className="relative min-w-0">
              <button
                type="button"
                disabled={!projectId}
                aria-haspopup="listbox"
                aria-expanded={workItemMenuOpen}
                className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1 text-[12px] font-medium leading-none text-[var(--ink-muted)] transition hover:bg-[var(--surface-3)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleToggleWorkItemMenu}
              >
                <Box
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0"
                  strokeWidth={2.3}
                />
                <span className="min-w-0 truncate">{workItemButtonLabel}</span>
              </button>

              {workItemMenuOpen &&
                workItemMenuRect &&
                createPortal(
                  <div ref={workItemPortalRef}>
                    <CommandSelectMenu
                      align="left"
                      className="fixed top-auto mt-0"
                      style={{
                        left: workItemMenuRect.left,
                        top: workItemMenuRect.top,
                        transform: 'translateY(-100%)',
                      }}
                    >
                      <CommandSelectSearchRow
                        placeholder={translate(
                          t,
                          'createSession.issueSearch',
                          'Search issues...',
                        )}
                        shortcut="I"
                        value={workItemQuery}
                        onChange={setWorkItemQuery}
                        onKeyDown={handleWorkItemMenuKeyDown}
                      />
                      <CommandSelectList>
                        {workItemsLoading ? (
                          <CommandSelectNoMatches>
                            {translate(
                              t,
                              'createSession.issueLoading',
                              'Loading issues...',
                            )}
                          </CommandSelectNoMatches>
                        ) : workItemsError ? (
                          <CommandSelectNoMatches>
                            {translate(
                              t,
                              'createSession.issueError',
                              'Failed to load issues',
                            )}
                          </CommandSelectNoMatches>
                        ) : workItemOptions.length > 0 ? (
                          workItemOptions.map((option, index) => {
                            const selected =
                              option.value === selectedWorkItemId;
                            const active = index === activeWorkItemOptionIndex;
                            return (
                              <button
                                ref={
                                  active ? activeWorkItemOptionRef : undefined
                                }
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                data-active={active ? 'true' : undefined}
                                className={cn(
                                  'flex min-h-12 w-full items-center gap-3 rounded-[7px] px-3 py-2 text-left text-[12px] font-bold leading-normal text-[var(--ink-muted)] transition hover:bg-[var(--surface-4)]',
                                  active && 'bg-[var(--surface-4)]',
                                )}
                                onClick={() =>
                                  handleWorkItemSelect(option.value)
                                }
                                onMouseEnter={() =>
                                  setActiveWorkItemOptionIndex(index)
                                }
                              >
                                <Box
                                  aria-hidden="true"
                                  className="h-[13px] w-[13px] shrink-0 text-[var(--ink-subtle)]"
                                  strokeWidth={2.3}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate leading-snug">
                                    {option.label}
                                  </span>
                                  <span className="mt-1 block truncate text-[10px] font-semibold leading-normal text-[var(--ink-tertiary)]">
                                    {option.detail}
                                  </span>
                                </span>
                                <span className="ml-auto flex w-4 shrink-0 items-center justify-center text-[var(--ink-subtle)]">
                                  {selected ? (
                                    <Check
                                      aria-hidden="true"
                                      className="h-[13px] w-[13px]"
                                      strokeWidth={3}
                                    />
                                  ) : (
                                    <span
                                      aria-hidden="true"
                                      className="h-[13px] w-[13px]"
                                    />
                                  )}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <CommandSelectNoMatches>
                            {translate(
                              t,
                              'createSession.issueEmpty',
                              'No issues found',
                            )}
                          </CommandSelectNoMatches>
                        )}
                      </CommandSelectList>
                    </CommandSelectMenu>
                  </div>,
                  document.body,
                )}
            </div>
          </div>
        </div>

        <footer className="flex min-h-[56px] flex-wrap items-center justify-between gap-2.5 border-t border-[var(--hairline)] bg-[var(--surface-2)] px-5 py-2.5">
          <button
            type="button"
            className="rounded-md p-1.5 text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            aria-label={translate(t, 'createSession.attach', 'Attach file')}
            title={translate(t, 'createSession.attach', 'Attach file')}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              disabled={!canCreate}
              className="rounded-lg bg-[var(--primary)] px-3.5 py-1.5 text-[14px] font-semibold text-white transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-70"
              onClick={handleCreate}
            >
              {translate(t, 'createSession.sendButton', 'Send (Ctrl+Enter)')}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
