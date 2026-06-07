import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronRight,
  Maximize2,
  MessageSquare,
  Network,
  Paperclip,
  X,
} from 'lucide-react';
import {
  DropdownSelect,
  type DropdownSelectOption,
} from '@/components/DropdownSelect';
import type { Member } from '@/types';

type CreateTaskMode = 'workflow' | 'freeChat';

interface CreateAgentSessionModalProps {
  open: boolean;
  projectName?: string;
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

export function CreateAgentSessionModal({
  open,
  projectName,
  members = [],
  leadMember,
  t,
  onClose,
  onCreate,
}: CreateAgentSessionModalProps) {
  const [prompt, setPrompt] = useState('');
  const [taskMode, setTaskMode] = useState<CreateTaskMode>('workflow');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mainAgent = leadMember === undefined ? members[0] : leadMember;
  const selectableMembers =
    taskMode === 'workflow' ? (mainAgent ? [mainAgent] : []) : members;
  const selectedMember =
    selectableMembers.find((member) => member.id === selectedMemberId) ??
    selectableMembers[0];
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

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open || selectedMemberId || !selectedMember) return;
    setSelectedMemberId(selectedMember.id);
  }, [open, selectedMember, selectedMemberId]);

  if (!open) return null;

  const trimmedPrompt = prompt.trim();
  const canCreate = trimmedPrompt.length > 0 && Boolean(selectedMember);
  const projectLabel =
    projectName ?? translate(t, 'createSession.projectFallback', 'openteams');

  const handleCreate = () => {
    if (!canCreate || !selectedMember) return;
    onCreate(trimmedPrompt, {
      taskMode,
      memberId: selectedMember.id,
      memberName: selectedMember.name,
    });
    onClose();
  };

  const handleModeChange = (nextMode: CreateTaskMode) => {
    setTaskMode(nextMode);
    if (nextMode === 'workflow') {
      setSelectedMemberId(mainAgent?.id ?? '');
      return;
    }
    setSelectedMemberId((currentId) => currentId || mainAgent?.id || '');
  };

  const handleToggleTaskMode = () => {
    handleModeChange(taskMode === 'workflow' ? 'freeChat' : 'workflow');
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

  const CurrentModeIcon = taskMode === 'workflow' ? Network : MessageSquare;
  const currentModeLabel =
    taskMode === 'workflow'
      ? translate(t, 'createSession.workflowMode', 'Workflow')
      : translate(t, 'createSession.freeChatMode', 'Free chat');

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
                aria-label={translate(t, 'createSession.close', 'Close create session')}
                title={translate(t, 'createSession.close', 'Close create session')}
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
            {taskMode === 'workflow' ? (
              selectedMember ? (
                <div className="inline-flex min-w-0 max-w-[280px] items-center gap-2 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ink)]">
                  <span className="flex h-4.5 w-4.5 shrink-0 select-none items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--canvas)] font-mono text-[8px] text-[var(--ink-subtle)]">
                    {selectedMember.avatar}
                  </span>
                  <span className="truncate">{selectedMember.name}</span>
                  <span className="truncate font-mono text-[10px] font-medium text-[var(--ink-tertiary)]">
                    {selectedMember.modelName}
                  </span>
                </div>
              ) : (
                <span className="rounded-md border border-[var(--hairline)] px-2.5 py-1.5 text-[14px] text-[var(--ink-tertiary)]">
                  {translate(t, 'createSession.noMembers', 'No members available')}
                </span>
              )
            ) : (
              <DropdownSelect
                value={selectedMember?.id ?? ''}
                options={memberOptions}
                placeholder={translate(t, 'createSession.noMembers', 'No members available')}
                searchPlaceholder={translate(t, 'agentSearchPlaceholder', 'Filter agents...')}
                emptyLabel={translate(t, 'createSession.noMembers', 'No members available')}
                disabled={memberOptions.length === 0}
                className="w-[168px] max-w-full shrink-0 [&>button]:py-1"
                maxPanelHeightClassName="max-h-[144px]"
                panelClassName="absolute left-0 top-full max-w-none"
                onChange={(memberId) => setSelectedMemberId(memberId)}
              />
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={translate(
              t,
              'createSession.promptPlaceholder',
              'Tell the agent what to do, e.g. "let Bohan fix the inbox loading slowness in the Web project"',
            )}
            className="mt-2.5 min-h-[96px] flex-1 resize-none bg-transparent text-[14px] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--ink-subtle)]"
          />

          <div className="mt-3 flex">
            <button
              type="button"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-[13px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-3)]"
              aria-label={translate(t, 'createSession.switchTaskMode', 'Switch task mode')}
              onClick={handleToggleTaskMode}
            >
              <CurrentModeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ink-subtle)]" />
              <span>{currentModeLabel}</span>
              <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--surface-4)] text-[var(--ink-tertiary)]">
                <ArrowLeftRight className="h-3 w-3" />
              </span>
            </button>
          </div>
        </div>

        <footer className="flex min-h-[56px] flex-wrap items-center justify-between gap-2.5 border-t border-[var(--hairline)] bg-[var(--surface-2)] px-5 py-2.5">
          <button
            type="button"
            className="rounded-md p-1.5 text-[var(--ink-subtle)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            aria-label={translate(t, 'createSession.attach', 'Attach file')}
            title={translate(t, 'createSession.attach', 'Attach file')}
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
