// Smoke tests for the free-chat workspace layout source.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/components/FreeChatWorkspace.test.tsx

import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? "");
  }
};

console.log("FreeChatWorkspace");

const source = readFileSync(
  new URL("./FreeChatWorkspace.tsx", import.meta.url),
  "utf8",
);
const runStatusSource = readFileSync(
  new URL("./AgentRunStatusPill.tsx", import.meta.url),
  "utf8",
);
const activityPanelSource = readFileSync(
  new URL("./AgentActivityPanel.tsx", import.meta.url),
  "utf8",
);
const activityPanelCssSource = readFileSync(
  new URL("./workflow/WorkflowAgentLogPanel.css", import.meta.url),
  "utf8",
);
const messageContentSource = readFileSync(
  new URL("./AgentMessageContent.tsx", import.meta.url),
  "utf8",
);
const markdownSource = readFileSync(
  new URL("./AgentMarkdown.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("./SettingsWorkspace.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../lib/api.ts", import.meta.url),
  "utf8",
);
const chatInputPrefillSource = readFileSync(
  new URL("../lib/chatInputPrefill.ts", import.meta.url),
  "utf8",
);
const activityPanelIndex = messageContentSource.indexOf("<AgentActivityPanel");
const markdownIndex = messageContentSource.indexOf("<AgentMarkdown");
const errorBlockCss =
  activityPanelCssSource.match(/\.wf-log-error-block \{([\s\S]*?)\}/)?.[1] ?? "";
const errorSingleCss =
  activityPanelCssSource.match(/\.wf-log-error-block--single \{([\s\S]*?)\}/)?.[1] ?? "";
const errorSummaryCss =
  activityPanelCssSource.match(/\.wf-log-error-block-summary \{([\s\S]*?)\}/)?.[1] ?? "";
const errorDetailCss =
  activityPanelCssSource.match(/\.wf-log-error-detail \{([\s\S]*?)\}/)?.[1] ?? "";
const taskStatusCss =
  activityPanelCssSource.match(/\.wf-log-task-status \{([\s\S]*?)\}/)?.[1] ?? "";
const taskRowCss =
  activityPanelCssSource.match(/\.wf-log-task-row \{([\s\S]*?)\}/)?.[1] ?? "";
const taskLabelCss =
  activityPanelCssSource.match(/\.wf-log-task-label \{([\s\S]*?)\}/)?.[1] ?? "";
const taskTargetCss =
  activityPanelCssSource.match(/\.wf-log-task-target \{([\s\S]*?)\}/)?.[1] ?? "";
const toolChevronCss =
  activityPanelCssSource.match(/\.wf-log-task-chevron \{([\s\S]*?)\}/)?.[1] ?? "";
const errorChevronCss =
  activityPanelCssSource.match(/\.wf-log-error-chevron \{([\s\S]*?)\}/)?.[1] ?? "";
const composerQuoteIndex = source.indexOf("{quotedMessage && (");
const composerAttachmentIndex = source.indexOf(
  'className="mb-2 flex flex-wrap gap-2"',
);
const composerInputIndex = source.indexOf(
  'className={`relative rounded-md border border-[var(--hairline-strong)]',
);
const memberRailIndex = source.indexOf("ref={memberRailRef}");
const memberRailCloseIndex = source.indexOf("</ScrollArea>", memberRailIndex);
const memberRailSource =
  memberRailIndex >= 0 && memberRailCloseIndex > memberRailIndex
    ? source.slice(memberRailIndex, memberRailCloseIndex)
    : "";
const memberInviteIndex = source.indexOf(
  'title={t("inviteMember")}',
  memberRailIndex,
);
const memberInviteSource =
  memberInviteIndex >= 0
    ? source.slice(memberInviteIndex, memberInviteIndex + 160)
    : "";

check(
  "uses a wider related-files default width",
  source.includes("const RELATED_FILES_DEFAULT_WIDTH = 300"),
  source,
);
check(
  "allows related-files panel to compress before collapsing",
  source.includes("const RELATED_FILES_MIN_WIDTH = 200") &&
    source.includes("effectiveRelatedFilesWidth") &&
    source.includes("relatedFilesMaxAvailableWidth"),
  source,
);
check(
  "auto-collapses related-files panel when workspace is too narrow",
  source.includes("wasRelatedFilesAutoCollapsed") &&
    source.includes("setWasRelatedFilesAutoCollapsed(true)") &&
    source.includes("setIsRelatedFilesOpen(false)"),
  source,
);
check(
  "keeps related-files panel as a right-side column while open",
  source.includes("grid-cols-[minmax(0,1fr)_6px_var(--related-files-width)]") &&
    !source.includes("grid-rows-[minmax(0,1fr)_16rem]") &&
    !source.includes("xl:grid-cols-[minmax(0,1fr)_6px_var"),
  source,
);
check(
  "uses session workspace changes mapper for related files",
  source.includes("flattenWorkspaceChanges") &&
    source.includes("hasRelatedFileDiff") &&
    source.includes('statusTextTone: Record<RelatedFileStatus, string>') &&
    source.includes('U: "text-sky-500"'),
  source,
);
check(
  "shows a manual related-files refresh action",
  source.includes('title={t("relatedFiles.refresh")}') &&
    source.includes("reloadRelatedFiles") &&
    source.includes("resetWorkspaceChanges"),
  source,
);
check(
  "consumes pending chat input prefill events for newly opened sessions",
  source.includes("CHAT_INPUT_PREFILL_EVENT") &&
    source.includes("readChatInputPrefill(activeSessionId)") &&
    source.includes("clearChatInputPrefill(detail.sessionId)") &&
    source.includes("sessionDraftCache.set(detail.sessionId, detail.text)") &&
    source.includes("applyChatInputPrefill") &&
    source.includes("setChatInputMode(detail.mode)") &&
    source.includes("setInputText(detail.text)") &&
    chatInputPrefillSource.includes("window.sessionStorage.setItem") &&
    chatInputPrefillSource.includes("openteams:chat-input-prefill"),
  { source, chatInputPrefillSource },
);
check(
  "caches composer drafts per session as input changes",
  source.includes("const setInputTextDraft = useCallback") &&
    source.includes("sessionDraftCache.set(activeSessionId, nextText)") &&
    source.includes("sessionDraftCache.delete(activeSessionId)") &&
    source.includes("setInputTextDraft(nextValue)") &&
    source.includes('setInputTextDraft("")') &&
    !source.includes("inputTextRef"),
  source,
);
check(
  "uses the main agent mention in the free-mode placeholder",
  source.includes('const freeModePlaceholder = t("discussPlaceholder", {') &&
    source.includes("agent: mainAgentHandle") &&
    source.includes(": freeModePlaceholder"),
  source,
);
check(
  "opens files when a related file has no inline diff",
  source.includes("openFileInVSCode") &&
    source.includes("openAsDiff: false") &&
    source.includes("relatedFiles.noDiffOpenFile"),
  source,
);
check(
  "phase four wires source-control panel while preserving plain related files fallback",
  source.includes("SessionSourceControlPanel") &&
    source.includes("plainRelatedFilesContent") &&
    source.includes("onOpenSourceControlDiffTab") &&
    source.includes("fallbackRelatedFiles={plainRelatedFilesContent}") &&
    source.includes('title={t("relatedFiles.refresh")}'),
  source,
);
check(
  "refreshes plain related files from source-control refresh events",
  source.includes("SOURCE_CONTROL_REFRESH_REQUESTED_EVENT") &&
    source.includes("SourceControlRefreshRequestedDetail") &&
    source.includes("handleSourceControlRefresh") &&
    source.includes("detail.sessionId !== activeSessionId") &&
    source.includes("usesProjectSourceControl") &&
    source.includes("reloadRelatedFiles();"),
  source,
);
check(
  "keeps the member invite action fixed outside the avatar rail and uses click filtering",
  memberRailIndex >= 0 &&
    memberRailCloseIndex > memberRailIndex &&
    memberInviteIndex > memberRailCloseIndex &&
    source.includes(
      "railWidth <= 0) {\n    return 0;\n  }",
    ) &&
    source.includes(
      "className={`flex min-w-0 flex-1 gap-1.5 overflow-hidden px-1",
    ) &&
    source.includes("h-12 -mb-2 items-start pb-2 pt-1.5") &&
    source.includes("h-10 items-center") &&
    source.includes("ChevronsRight") &&
    source.includes("requestTeamMemberInviteNavigation({") &&
    source.includes("projectId: selectedProjectId ?? undefined") &&
    memberInviteSource.includes("data-tooltip-nowrap") &&
    !memberRailSource.includes('"..."') &&
    source.includes("selectedSidebarMemberId") &&
    source.includes("const selectedSidebarMember =") &&
    source.includes("const displayedMessages = selectedSidebarMember") &&
    source.includes("message.sender === selectedSidebarMember.name") &&
    source.includes("const extractMentionHandles = (text: string): string[]") &&
    source.includes("/@[\\p{L}\\p{N}_-]+/gu") &&
    source.includes("const memberMentionHandles = new Set(") &&
    source.includes("const matchedMemberMentions = extractMentionHandles(") &&
    source.includes("memberMentionHandles.has(mention)") &&
    source.includes("const mainAgentHandle =") &&
    source.includes("normalizedMainAgentHandle") &&
    source.includes(
      "normalizeMentionHandle(selectedSidebarMember.name)",
    ) &&
    source.includes("{displayedMessages.map((msg) => (") &&
    source.includes("key={msg.id}") &&
    !source.includes("key={msg.clientMessageId ?? msg.id}") &&
    source.includes(
      "(!messagesAsync.loading || displayedMessages.length === 0)",
    ) &&
    source.includes("aria-pressed={isSelected}") &&
    source.includes("title={member.name}") &&
    source.includes(
      "border-[var(--primary-focus)] ring-2 ring-[var(--primary-focus)]/55",
    ) &&
    !source.includes("hoveredSidebarMemberId") &&
    !source.includes("setHoveredSidebarMemberId") &&
    !source.includes("hover:w-32") &&
    !source.includes("group-hover/member:max-w-20") &&
    !source.includes("SIDEBAR_MEMBER_COLLAPSED_MIN_VISIBLE"),
  { memberRailIndex, memberRailCloseIndex, memberInviteIndex, source },
);
check(
  "delegates agent message rendering to an isolated component",
  source.includes("AgentMessageContent") &&
    messageContentSource.includes("useRunActivity") &&
    messageContentSource.includes("AgentRunStatusPill") &&
    messageContentSource.includes("AgentActivityPanel") &&
    messageContentSource.includes("AgentMarkdown") &&
    !source.includes("formatMessageText={formatMsgText}"),
  { source, messageContentSource },
);
check(
  "renders agent model inline after the agent name",
  source.includes("{msg.model && (") &&
    source.includes("{msg.model}") &&
    source.includes("rounded-full bg-[var(--surface-3)]") &&
    source.includes("text-[9px] font-mono text-[var(--ink-muted)]"),
  source,
);
check(
  "shows thinking details above the final agent markdown",
  activityPanelIndex >= 0 &&
    markdownIndex >= 0 &&
    activityPanelIndex < markdownIndex,
  { activityPanelIndex, markdownIndex },
);
check(
  "collapses thinking details after an agent run finishes",
  messageContentSource.includes("const wasRunningRef = useRef(isRunning)") &&
    messageContentSource.includes("wasRunningRef.current = true") &&
    messageContentSource.includes("setExpanded(false)") &&
    messageContentSource.includes("wasRunningRef.current = false"),
  messageContentSource,
);
check(
  "thinking process toggle title uses compact type",
  messageContentSource.includes("text-[12px]") &&
    messageContentSource.includes('t("agentActivity.toggle")'),
  messageContentSource,
);
check(
  "hides empty thinking panel and filters final assistant activity lines after completion",
  messageContentSource.includes("isRunning") &&
    messageContentSource.includes('line.line_type !== "assistant"') &&
    messageContentSource.includes("hasVisibleActivityLines") &&
    messageContentSource.includes("hasActivityPanelState") &&
    activityPanelSource.includes("if (showEmpty) return null"),
  { messageContentSource, activityPanelSource },
);
check(
  "wraps long agent thinking lines inside the message column",
  source.includes("group/message relative flex w-full min-w-0") &&
    markdownSource.includes("min-w-0 max-w-full break-words") &&
    markdownSource.includes("[overflow-wrap:anywhere]") &&
    messageContentSource.includes("min-w-0 max-w-full space-y-2") &&
    activityPanelCssSource.includes("white-space: normal") &&
    activityPanelCssSource.includes("overflow-wrap: anywhere") &&
    activityPanelCssSource.includes("white-space: pre-wrap"),
  { source, markdownSource, activityPanelCssSource },
);
check(
  "loads activity through the run-scoped store",
  messageContentSource.includes("useRunActivity(message.runId") &&
    messageContentSource.includes("isRunning || expanded") &&
    messageContentSource.includes("activity.lines") &&
    !messageContentSource.includes("activityRequestIdRef") &&
    !messageContentSource.includes("ACTIVITY_LOAD_TIMEOUT_MS") &&
    !messageContentSource.includes("chatRunsApi.getActivity"),
  messageContentSource,
);
check(
  "keeps activity loading silent for live and historical agent messages",
  /activity\.status === "loading"\s*\?\s*"idle"/.test(messageContentSource),
  messageContentSource,
);
check(
  "renders agent errors as neutral terminal text with conditional disclosure",
  activityPanelSource.includes("if (!detail)") &&
    activityPanelSource.includes("wf-log-error-block--single") &&
    activityPanelSource.includes('<details className="wf-log-error-block">') &&
    activityPanelSource.includes('className="wf-log-error-status"') &&
    (activityPanelSource.match(/className="wf-log-task-tool-icon wf-log-error-tool-icon"/g)?.length ?? 0) === 2 &&
    (activityPanelSource.match(/<Terminal className="w-3 h-3" aria-hidden="true" \/>/g)?.length ?? 0) === 2 &&
    !activityPanelSource.includes("wf-log-error-icon") &&
    !/(?:^|\s)(?:background|border|border-radius)\s*:/.test(errorBlockCss) &&
    errorSingleCss.includes("grid-template-columns: 14px 12px minmax(0, 1fr)") &&
    errorSingleCss.includes("column-gap: 10px") &&
    errorSummaryCss.includes("grid-template-columns: 14px 12px minmax(0, 1fr)") &&
    errorSummaryCss.includes("column-gap: 10px") &&
    errorDetailCss.includes("padding: 3px 0 0 58px") &&
    taskStatusCss.includes("width: 14px") &&
    taskRowCss.includes("font-family: 'JetBrains Mono', monospace") &&
    taskRowCss.includes("font-size: 11px") &&
    taskRowCss.includes("color: var(--ink-muted") &&
    taskLabelCss.includes("font-size: inherit") &&
    taskLabelCss.includes("color: inherit") &&
    taskTargetCss.includes("font-size: inherit") &&
    taskTargetCss.includes("color: inherit") &&
    toolChevronCss.includes("width: 12px") &&
    toolChevronCss.includes("height: 12px") &&
    errorChevronCss.includes("width: 12px") &&
    errorChevronCss.includes("height: 12px"),
  {
    activityPanelSource,
    errorBlockCss,
    errorSingleCss,
    errorSummaryCss,
    errorDetailCss,
    taskStatusCss,
    taskRowCss,
    taskLabelCss,
    taskTargetCss,
    toolChevronCss,
    errorChevronCss,
  },
);
check(
  "agent markdown renders leading mentions outside markdown content",
  markdownSource.includes("extractAgentMarkdownParts") &&
    markdownSource.includes("@[\\p{L}\\p{N}_-]+(?=\\s|$)") &&
    markdownSource.includes("ReactMarkdown") &&
    markdownSource.includes("remarkGfm") &&
    markdownSource.includes("remarkPlugins={[remarkGfm]}") &&
    markdownSource.includes("data-agent-mention") &&
    markdownSource.includes("parts.markdown") &&
    markdownSource.includes(
      'className="font-mono font-semibold text-[var(--primary)]"',
    ) &&
    markdownSource.includes("fontSize = 14") &&
    markdownSource.includes("style={markdownStyle}") &&
    markdownSource.includes("text-[1.35em]") &&
    markdownSource.includes("text-[1.22em]") &&
    markdownSource.includes("text-[0.95em]") &&
    markdownSource.includes("text-[0.92em]") &&
    !markdownSource.includes("text-[13px]") &&
    !markdownSource.includes("stripLeadingAgentMentions"),
  markdownSource,
);
check(
  "uses the configured chat message font size for user and agent bodies",
  source.includes("chatMessageFontSize") &&
    source.includes("style={{ fontSize: `${chatMessageFontSize}px` }}") &&
    source.includes("messageFontSize={chatMessageFontSize}") &&
    markdownSource.includes("text-[0.95em]") &&
    messageContentSource.includes("messageFontSize?: number") &&
    messageContentSource.includes("fontSize={messageFontSize}") &&
    settingsSource.includes("CHAT_MESSAGE_FONT_SIZE_OPTIONS") &&
    settingsSource.includes("settings.appearance.chatMessageFontSize"),
  { source, messageContentSource, settingsSource },
);
check(
  "uses the configured chat message font size for sender names",
  source.includes('className="font-semibold text-[var(--ink)]"') &&
    source.includes("style={{ fontSize: `${chatMessageFontSize}px` }}") &&
    source.includes('{msg.isUser ? t("you") : msg.sender}'),
  source,
);
check(
  "running pill uses the required copy and reused visual tokens",
  runStatusSource.includes("正在执行") &&
    runStatusSource.includes("Loader2") &&
    runStatusSource.includes("bg-[var(--primary-tint)]") &&
    runStatusSource.includes("text-[var(--primary)]"),
  runStatusSource,
);
check(
  "agent messages expose hover copy and quote actions",
  source.includes("handleCopyAgentMessage") &&
    source.includes("handleQuoteAgentMessage") &&
    source.includes("copiedMessageId === msg.id") &&
    source.includes("group-hover/message:opacity-100") &&
    source.includes('title={t("message.copy")}') &&
    source.includes('title={t("message.quote")}'),
  source,
);
check(
  "running agent messages expose a stop action wired to the backend",
  source.includes("sessionAgentsApi.stop(activeSessionId, sessionAgentId)") &&
    source.includes("handleStopAgentMessage") &&
    source.includes("markSessionAgentStopped(sessionAgentId)") &&
    source.indexOf("sessionAgentsApi.stop(activeSessionId, sessionAgentId)") <
      source.indexOf("markSessionAgentStopped(sessionAgentId)") &&
    source.includes("msg.isAgentRunning") &&
    source.includes("msg.sessionAgentId") &&
    source.includes('title={t("agent.stop")}') &&
    source.includes("stoppingSessionAgentIds"),
  source,
);
check(
  "running agent stop action remains visible without hovering",
  source.includes("absolute bottom-1 right-1 z-10") &&
    source.includes("group-hover/message:pointer-events-auto") &&
    source.includes('? "right-8"') &&
    source.indexOf('title={t("agent.stop")}') <
      source.indexOf("group-hover/message:pointer-events-auto"),
  source,
);
check(
  "quoted agent message summary is shown above the composer and jumps to its source",
  source.includes("quotedMessage") &&
    source.includes("message.quotePrefix") &&
    source.includes("message.dismissQuote") &&
    source.includes("summarizeMessage") &&
    source.includes("content: text") &&
    source.includes("sendMessage(messageText, {") &&
    source.includes("chatInputMode,") &&
    source.includes("...(quotedMessage ? { quotedMessage } : {})") &&
    source.includes("msg.quotedMessage") &&
    source.includes("handleJumpToMessage(msg.quotedMessage!.id)") &&
    !source.includes("> ${quotedMessage.sender}:"),
  source,
);
check(
  "agent replies show a compact source-agent message above the response",
  source.includes("msg.agentSourceMessage") &&
    source.includes("msg.agentSourceMessage.sender") &&
    source.includes("msg.agentSourceMessage.summary") &&
    source.includes('className="truncate"') &&
    source.includes("handleJumpToMessage(msg.agentSourceMessage!.id)") &&
    source.includes('getElementById(`chat-message-${messageId}`)') &&
    source.includes('scrollIntoView({ behavior: "smooth", block: "center" })'),
  source,
);
check(
  "composer supports text/image attachments and clipboard image paste",
  source.includes("CHAT_ATTACHMENT_ACCEPT") &&
    source.includes("allowedAttachmentExtensions") &&
    source.includes("getClipboardFiles(event.clipboardData)") &&
    source.includes("onPaste={handlePaste}") &&
    source.includes("fileInputRef") &&
    source.includes("attachedFiles") &&
    source.includes("ImageIcon") &&
    source.includes("FileText") &&
    source.includes("removeAttachedFile(index)") &&
    source.includes("attachedFiles.length > 0"),
  source,
);
check(
  "composer attachments render above the input with quote previews",
  composerQuoteIndex >= 0 &&
    composerAttachmentIndex > composerQuoteIndex &&
    composerAttachmentIndex < composerInputIndex,
  { composerQuoteIndex, composerAttachmentIndex, composerInputIndex },
);
check(
  "renders queued messages inline after the active agent message",
  source.includes("visibleQueueGroups") &&
    source.includes("const queuedQueueItems =") &&
    source.includes("queuedUserMessagesById") &&
    source.includes("...Object.entries(queuedUserMessagesById)") &&
    source.includes("messagesById.get(item.message.chat_message_id)") &&
    source.includes("queueGroupsBySessionAgentId") &&
    source.includes("queueAnchorMessageIds") &&
    source.includes("renderInlineQueueGroup") &&
    source.includes("queueAnchorMessageIds.get(msg.sessionAgentId) === msg.id") &&
    source.includes("queueGroupsBySessionAgentId.get(msg.sessionAgentId)") &&
    source.includes("<Trash2") &&
    source.includes("<Play") &&
    source.includes("queue.can_continue") &&
    source.includes("item.message.session_id === activeSessionId") &&
    source.includes('status === "queued"') &&
    !source.includes("visibleQueueItemStatuses") &&
    !source.includes("消息正在等待执行") &&
    !source.includes("member: members.find") &&
    source.includes("max-w-md") &&
    source.includes("max-h-24") &&
    source.includes("handleDeleteQueuedMessage") &&
    source.includes("handleContinueMemberQueue") &&
    source.indexOf("renderInlineQueueGroup(") < composerInputIndex &&
    !source.includes("{visibleQueueGroups.length > 0") &&
    !source.includes("false && visibleQueueGroups.length > 0"),
  { composerInputIndex, source },
);
check(
  "composer textarea auto-grows up to 2.5x the current input shell height",
  source.includes("const CHAT_INPUT_SHELL_MIN_HEIGHT = 95") &&
    source.includes("CHAT_INPUT_SHELL_MIN_HEIGHT * 2.5") &&
    source.includes("const resizeChatTextarea = (") &&
    source.includes("resizeChatTextarea(inputRef.current)") &&
    source.includes("resizeChatTextarea(event.target)") &&
    source.includes("maxHeight: CHAT_INPUT_MAX_HEIGHT"),
  source,
);
check(
  "composer mention picker opens on @ and captures keyboard selection",
  source.includes("activeMemberPickerIndex") &&
    source.includes("const handleInputChange = (") &&
    source.includes('nextValue[cursor - 1] === "@"') &&
    source.includes("setIsMemberPickerOpen(true)") &&
    source.includes('e.key === "ArrowDown"') &&
    source.includes('e.key === "ArrowUp"') &&
    source.includes('e.key === "Enter" && !e.shiftKey') &&
    source.includes("insertMemberMention(member)") &&
    source.includes("aria-selected={index === activeMemberPickerIndex}") &&
    source.includes("onChange={handleInputChange}") &&
    !source.includes("if (!isPlanMode && isMemberPickerOpen)") &&
    !source.includes("if (!isPlanMode && cursor") &&
    source.indexOf("insertMemberMention(member)") <
      source.indexOf("void handleSend()"),
  source,
);
check(
  "composer member picker closes when clicking outside",
  source.includes("const memberPickerRef = useRef<HTMLDivElement | null>(null)") &&
    source.includes('document.addEventListener("pointerdown", handlePointerDownOutside)') &&
    source.includes("!memberPickerRef.current?.contains(target)") &&
    source.includes('document.removeEventListener("pointerdown", handlePointerDownOutside)') &&
    source.includes("<div ref={memberPickerRef} className=\"relative\">") &&
    source.includes("setIsMemberPickerOpen(false)"),
  source,
);
check(
  "composer member picker trigger does not duplicate mentioned members",
  !source.includes("const mentionedMemberNames = new Set(") &&
    !source.includes("mentionedMembers.length") &&
    source.includes('<AtSign className="h-3.5 w-3.5') &&
    source.includes("insertMemberMention(member)"),
  source,
);
check(
  "user message rendering shows routed mention without mutating text",
  source.includes("sendMessage(messageText, {") &&
    source.includes("displayMentionForUserMessage(msg)") &&
    source.includes("message.mentions?.[0]") &&
    source.includes("implicit-route-mention") &&
    source.includes("renderMentionText(") &&
    source.includes("{formatMsgText(msg.text)}") &&
    !source.includes("`${planModeMainAgentName} ${trimmedInput}`"),
  source,
);
check(
  "user message rendering preserves input whitespace and markdown symbols",
  source.includes("const messageText = inputText") &&
    source.includes("content: trimmedInput ? messageText : undefined") &&
    source.includes("whitespace-pre-wrap break-words") &&
    source.includes(
      "Highlight @mentions while keeping user-entered markdown characters literal",
    ) &&
    source.includes("text.split(/(@[\\p{L}\\p{N}_-]+)/gu)") &&
    !source.includes("el.substring(1, el.length - 1)"),
  source,
);
check(
  "attachment send uses backend multipart upload with quote reference id",
  source.includes(
    "chatMessagesApi.uploadAttachment(activeSessionId, attachedFiles",
  ) &&
    source.includes("chatInputMode,") &&
    source.includes("ensureWorkflowRouteToMainAgent") &&
    source.includes('if (chatInputMode === "workflow")') &&
    source.includes("await ensureWorkflowRouteToMainAgent()") &&
    source.includes("const attachmentRouteMentions =") &&
    source.includes("content: trimmedInput ? messageText : undefined") &&
    source.includes("referenceMessageId: quotedMessage?.id") &&
    source.includes("mentions: attachmentRouteMentions") &&
    source.includes("await refreshMessages()") &&
    apiSource.includes('form.append("file", file, file.name)') &&
    apiSource.includes('form.append("content", options.content)') &&
    apiSource.includes(
      'form.append("reference_message_id", options.referenceMessageId)',
    ) &&
    apiSource.includes('form.append("chat_input_mode", "workflow")'),
  { source, apiSource },
);
check(
  "attachment send routes unmentioned free-mode uploads to the main agent",
  source.includes("const routeMentionsForText = (text: string): string[]") &&
    source.includes("/@([\\p{L}\\p{N}_-]+)/gu") &&
    source.includes("const explicitAttachmentMentions = routeMentionsForText(messageText)") &&
    source.includes("const mainAgentRouteMention = mainAgentName") &&
    source.includes('mainAgentName.trim().replace(/^@/, "")') &&
    !source.includes('normalizeMentionHandle(mainAgentName).replace(/^@/, "")') &&
    source.includes('chatInputMode !== "workflow" && mainAgentRouteMention') &&
    source.includes("mentions: attachmentRouteMentions") &&
    apiSource.includes('form.append("mentions", JSON.stringify(options.mentions))'),
  { source, apiSource },
);
check(
  "plan mode toggle highlights and locks the main agent mention",
  source.includes("handleTogglePlanMode") &&
    source.includes("setChatInputMode") &&
    source.includes("mainAgentName,") &&
    source.includes("const planModeMainAgentName = mainAgentHandle") &&
    source.includes("rounded-full border px-2 py-1 text-[10px]") &&
    source.includes('<GitBranch className="h-3 w-3" />') &&
    source.includes("planModePlaceholder") &&
    source.includes("plan-mode-toggle-active") &&
    source.includes("plan-mode-input-active") &&
    source.includes("fixedMainAgentMention") &&
    source.includes("border-[var(--hairline)] bg-[var(--surface-2)] px-2 py-1") &&
    source.includes('<span className="truncate">{planModeMainAgentName}</span>') &&
    source.includes("<Lock") &&
    !source.includes('<AtSign className="h-3.5 w-3.5 shrink-0" />'),
  source,
);
check(
  "renders backend file and image attachments from message meta",
  source.includes("msg.attachments && msg.attachments.length > 0") &&
    source.includes("chatMessagesApi.attachmentUrl(") &&
    source.includes("isImageChatAttachment(attachment)") &&
    source.includes("<img") &&
    source.includes("formatFileSize(attachment.size_bytes)") &&
    apiSource.includes("attachmentUrl: ("),
  { source, apiSource },
);
check(
  "linked work item status changes update only local work items and mark github sync pending",
  source.includes("handleLinkedWorkItemStatusChange") &&
    source.includes("projectWorkItemsApi.update(") &&
    source.includes(
      "markPendingIssueStatusSync(selectedProjectId, updated.id, updated.status)",
    ) &&
    source.includes("statusPending={updatingLinkedWorkItemIds.has(item.id)}") &&
    source.includes("onStatusChange={(nextItem, status) =>") &&
    !source.includes("projectGithubApi.updateIssueState"),
  source,
);
check(
  "linked work item status trigger does not show a redundant tooltip",
  !source.includes('"linkedWorkItems.changeStatusTitle"'),
  source,
);
check(
  "refreshes linked work items when a session link event arrives",
  source.includes("LINKED_WORK_ITEMS_CHANGED_EVENT") &&
    source.includes("LinkedWorkItemsChangedDetail") &&
    source.includes("linkedWorkItemsRequestIdRef") &&
    source.includes("const reloadLinkedWorkItems = useCallback") &&
    source.includes("detail.projectId !== selectedProjectId") &&
    source.includes("detail.sessionId !== activeSessionId") &&
    source.includes("window.addEventListener(") &&
    source.includes("reloadLinkedWorkItems();"),
  source,
);
check(
  "activity panel uses compact Codex-like line rows",
  activityPanelSource.includes("labels.cleaned") &&
    activityPanelSource.includes("formatAgentActivityLines") &&
    activityPanelSource.includes("renderSimpleBoldMarkdown") &&
    activityPanelSource.includes("<strong key={`bold-${partIndex}`}") &&
    messageContentSource.includes("translate={t}") &&
    activityPanelSource.includes("wf-log-task-row") &&
    activityPanelSource.includes("wf-log-task-content-text") &&
    activityPanelSource.includes('line_type === "tool"') &&
    activityPanelSource.includes("isToolRunning") &&
    activityPanelSource.includes('className="wf-log-task-disclosure"') &&
    activityPanelSource.includes("line.resultDetail") &&
    activityPanelSource.includes("agent-activity-scrollbar max-h-[480px] pr-1") &&
    !activityPanelSource.includes("border border"),
  activityPanelSource,
);
check(
  "activity panel auto-follows the latest thinking line with idle recovery",
  activityPanelSource.includes("AGENT_ACTIVITY_AUTO_SCROLL_IDLE_MS = 30000") &&
    activityPanelSource.includes("useAutoFollowScroll") &&
    activityPanelSource.includes("el.scrollTop = el.scrollHeight") &&
    activityPanelSource.includes("autoFollowRef.current = false") &&
    activityPanelSource.includes("onWheel: noteUserInteraction") &&
    activityPanelSource.includes("onScroll: handleScroll"),
  activityPanelSource,
);
check(
  "composer links to the latest unfinished workflow card",
  source.includes("unfinishedWorkflowCardMessageId") &&
    source.includes('projection.is_terminal ? null : messageId') &&
    source.includes('id={`chat-message-${msg.id}`}') &&
    source.includes("jumpToUnfinishedWorkflowCard") &&
    source.includes('className={`absolute top-2 z-20') &&
    source.includes('isRelatedFilesOpen ? "right-5" : "right-10"') &&
    source.includes('<GitBranch className="h-3.5 w-3.5" />') &&
    !source.includes("handleWorkflowReminderPointerMove") &&
    source.includes('scrollIntoView({ behavior: "smooth", block: "center" })') &&
    source.includes("setSelectedSidebarMemberId(null)"),
  source,
);
check(
  "localizes the active workflow shortcut",
  source.includes('t("workflow.activeWorkflow.label")') &&
    source.includes('t("workflow.activeWorkflow.jumpToUnfinished")') &&
    !source.includes(">Active Workflow<") &&
    !source.includes('title="Jump to unfinished workflow"'),
  source,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} FreeChatWorkspace assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll FreeChatWorkspace assertions passed.");
}
