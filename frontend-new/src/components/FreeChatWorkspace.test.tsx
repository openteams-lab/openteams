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
    !memberRailSource.includes('"..."') &&
    source.includes("selectedSidebarMemberId") &&
    source.includes("const selectedSidebarMember =") &&
    source.includes("const displayedMessages = selectedSidebarMember") &&
    source.includes("message.sender === selectedSidebarMember.name") &&
    source.includes("const extractMentionHandles = (text: string): string[]") &&
    source.includes("const memberMentionHandles = new Set(") &&
    source.includes("const matchedMemberMentions = extractMentionHandles(") &&
    source.includes("memberMentionHandles.has(mention)") &&
    source.includes(
      "return selectedSidebarMember.id === sidebarMembers[0]?.id",
    ) &&
    source.includes(
      "selectedSidebarMember.name.toLowerCase()",
    ) &&
    source.includes("{displayedMessages.map((msg) => (") &&
    source.includes("key={msg.clientMessageId ?? msg.id}") &&
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
    messageContentSource.includes("chatRunsApi") &&
    messageContentSource.includes(".getActivity") &&
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
  "hides empty thinking panel and filters final assistant activity lines",
  messageContentSource.includes('line.line_type !== "assistant"') &&
    messageContentSource.includes("hasVisibleActivityLines") &&
    messageContentSource.includes("hasActivityPanelState") &&
    activityPanelSource.includes("if (showEmpty) return null"),
  { messageContentSource, activityPanelSource },
);
check(
  "reloads historical activity when live stream lines are only partial",
  messageContentSource.includes('loadState === "loaded"') &&
    messageContentSource.includes("activityRequestIdRef") &&
    messageContentSource.includes("mountedRef") &&
    messageContentSource.includes("mountedRef.current = true") &&
    messageContentSource.includes("ACTIVITY_LOAD_TIMEOUT_MS") &&
    messageContentSource.includes(
      "Promise.race([activityRequest, timeoutRequest])",
    ) &&
    messageContentSource.includes("[expanded, isRunning, message.runId]") &&
    !messageContentSource.includes("if (activityLines ||"),
  messageContentSource,
);
check(
  "agent markdown renders leading mentions outside markdown content",
  markdownSource.includes("extractAgentMarkdownParts") &&
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
    source.includes("text-[0.95em]") &&
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
  "quoted agent message summary is shown above the composer",
  source.includes("quotedMessage") &&
    source.includes("message.quotePrefix") &&
    source.includes("message.dismissQuote") &&
    source.includes("summarizeMessage") &&
    source.includes("content: text") &&
    source.includes("sendMessage(trimmedInput, {") &&
    source.includes("chatInputMode,") &&
    source.includes("...(quotedMessage ? { quotedMessage } : {})") &&
    source.includes("msg.quotedMessage") &&
    !source.includes("> ${quotedMessage.sender}:"),
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
  "free-chat mention picker opens on @ and captures keyboard selection",
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
    source.indexOf("insertMemberMention(member)") <
      source.indexOf("void handleSend()"),
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
    source.includes("content: trimmedInput || undefined") &&
    source.includes("referenceMessageId: quotedMessage?.id") &&
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
  "plan mode toggle highlights and locks the main agent mention",
  source.includes("handleTogglePlanMode") &&
    source.includes("setChatInputMode") &&
    source.includes("mainAgentName,") &&
    source.includes('const planModeMainAgentName = mainAgentName ?? members[0]?.name ?? "@agent"') &&
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

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} FreeChatWorkspace assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll FreeChatWorkspace assertions passed.");
}
