// Source-level end-to-end coverage for the two primary inbox notification paths.
//
// Run with:
//     pnpm exec tsx src/lib/inboxEndToEndFlows.test.ts

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

console.log("Inbox end-to-end flows");

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const workspaceContextSource = readFileSync(
  new URL("../context/WorkspaceContext.tsx", import.meta.url),
  "utf8",
);
const workflowCardSource = readFileSync(
  new URL("../components/workflow/WorkflowCard.tsx", import.meta.url),
  "utf8",
);
const inboxNavigationSource = readFileSync(
  new URL("./inboxNavigation.ts", import.meta.url),
  "utf8",
);
const chatProtocolSource = readFileSync(
  new URL(
    "../../../crates/services/src/services/chat_runner/protocol.rs",
    import.meta.url,
  ),
  "utf8",
);
const workflowLoopExecutorSource = readFileSync(
  new URL(
    "../../../crates/services/src/services/workflow/loop_executor/executor.rs",
    import.meta.url,
  ),
  "utf8",
);
const inboxServiceSource = readFileSync(
  new URL("../../../crates/services/src/services/inbox.rs", import.meta.url),
  "utf8",
);

const agentMessageCreateIndex = chatProtocolSource.indexOf(
  "ChatSenderType::Agent",
);
const agentMessageNotifyIndex = chatProtocolSource.indexOf(
  "notify_chat_agent_message",
  agentMessageCreateIndex,
);
const autoReadFunctionStart = workspaceContextSource.indexOf(
  "const isAutoReadableInboxItem",
);
const autoReadFunctionEnd = workspaceContextSource.indexOf(
  "const isThemePreference",
  autoReadFunctionStart,
);
const autoReadFunction =
  autoReadFunctionStart >= 0 && autoReadFunctionEnd > autoReadFunctionStart
    ? workspaceContextSource.slice(autoReadFunctionStart, autoReadFunctionEnd)
    : "";
const autoReadEffectStart = workspaceContextSource.indexOf(
  "useEffect(() => {\n    if (!activeSessionId) return;",
);
const autoReadEffectEnd = workspaceContextSource.indexOf(
  "useEffect(() => {\n    void refreshInbox();",
  autoReadEffectStart,
);
const autoReadEffect =
  autoReadEffectStart >= 0 && autoReadEffectEnd > autoReadEffectStart
    ? workspaceContextSource.slice(autoReadEffectStart, autoReadEffectEnd)
    : "";

check(
  "new Agent final messages enter the backend inbox and active-session chat messages auto-read",
  agentMessageCreateIndex >= 0 &&
    agentMessageNotifyIndex > agentMessageCreateIndex &&
    inboxServiceSource.includes("kind: \"chat_message\".to_string()") &&
    inboxServiceSource.includes("dedupe_key: format!(\"message:{}\", message.id)") &&
    autoReadFunction.includes("item.kind === 'chat_message'") &&
    autoReadFunction.includes("item.source_type === 'chat_message'") &&
    !autoReadFunction.includes("workflow_") &&
    autoReadEffect.includes("item.session_id === activeSessionId") &&
    autoReadEffect.includes("void markInboxItemsRead(ids).catch"),
  {
    chatProtocolSource,
    inboxServiceSource,
    autoReadFunction,
    autoReadEffect,
  },
);

const workflowReviewMappingIndex = inboxServiceSource.indexOf(
  '"step_review" | "loop_review"',
);
const workflowLoopReviewWriteIndex = workflowLoopExecutorSource.indexOf(
  '"loop_review"',
);
const workflowLoopReviewNotifyIndex = workflowLoopExecutorSource.indexOf(
  "notify_workflow_user_action",
  workflowLoopReviewWriteIndex,
);
const openHandlerStart = appSource.indexOf("const handleInboxItemOpen");
const openHandlerEnd = appSource.indexOf(
  "const closeWorktreeConflictTab",
  openHandlerStart,
);
const openHandlerSource =
  openHandlerStart >= 0 && openHandlerEnd > openHandlerStart
    ? appSource.slice(openHandlerStart, openHandlerEnd)
    : "";

check(
  "workflow review notifications enter the inbox, route to review focus, and mark read after opening",
  workflowReviewMappingIndex >= 0 &&
    inboxServiceSource.includes('kind: "workflow_review"') &&
    inboxServiceSource.includes('source_type: "workflow_review"') &&
    workflowLoopReviewWriteIndex >= 0 &&
    workflowLoopReviewNotifyIndex > workflowLoopReviewWriteIndex &&
    openHandlerSource.includes("notifyInboxWorkflowFocus") &&
    openHandlerSource.includes("let openedTarget = false") &&
    openHandlerSource.includes("openedTarget = true") &&
    openHandlerSource.includes("if (openedTarget)") &&
    openHandlerSource.includes("void markInboxItemRead(item.id).catch") &&
    workflowCardSource.includes("sourceId && workflowInboxActionIds.has(sourceId)") &&
    inboxNavigationSource.includes("pendingWorkflowFocusTarget = target"),
  {
    inboxServiceSource,
    workflowLoopExecutorSource,
    openHandlerSource,
    workflowCardSource,
    inboxNavigationSource,
  },
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} inbox end-to-end assertion(s) failed.`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll inbox end-to-end flow assertions passed.");
}
