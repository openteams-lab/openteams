import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function run() {
  const coreModule = await import('../src/lib/workflowEventCore.ts');
  const apiSource = await readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  const coreSource = await readFile(
    new URL('../src/lib/workflowEventCore.ts', import.meta.url),
    'utf8'
  );
  const workflowAnalyticsSource = await readFile(
    new URL('../src/lib/workflowAnalytics.ts', import.meta.url),
    'utf8'
  );
  const chatSessionsSource = await readFile(
    new URL('../src/pages/ui-new/ChatSessions.tsx', import.meta.url),
    'utf8'
  );
  const chatWorkflowCardSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/ChatWorkflowCard.tsx', import.meta.url),
    'utf8'
  );
  const workflowWindowSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/WorkflowWindow.tsx', import.meta.url),
    'utf8'
  );
  const workflowGraphBoardSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/WorkflowGraphBoard.tsx', import.meta.url),
    'utf8'
  );
  const workflowPendingReviewSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/WorkflowPendingReviewCard.tsx', import.meta.url),
    'utf8'
  );
  const workflowPendingInputSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/WorkflowPendingInputCard.tsx', import.meta.url),
    'utf8'
  );
  const workflowIterationFeedbackSource = await readFile(
    new URL('../src/pages/ui-new/chat/components/WorkflowIterationFeedbackCard.tsx', import.meta.url),
    'utf8'
  );
  const requestPolicySource = await readFile(
    new URL('../src/lib/workflowRequestPolicy.ts', import.meta.url),
    'utf8'
  );
  const legacyAnalyticsSource = await readFile(
    new URL('../src/lib/analytics.ts', import.meta.url),
    'utf8'
  );

  assert.match(apiSource, /trackWorkflowEvent:\s*async\s*\(/, 'api.ts 缺少埋点 API 封装');
  assert.match(
    apiSource,
    /makeRequest\('\/api\/analytics\/events'/,
    'api.ts 未使用当前埋点 endpoint /api/analytics/events'
  );
  assert.doesNotMatch(
    apiSource,
    /\/api\/chat\/analytics\/events/,
    'api.ts 仍包含旧 endpoint /api/chat/analytics/events'
  );
  assert.match(
    apiSource,
    /workflowAnalyticsCategory\(|event_category:\s*workflowAnalyticsCategory\(/,
    'api.ts 缺少埋点分类映射逻辑'
  );

  assert.match(
    coreSource,
    /FORBIDDEN_METADATA_KEYS[\s\S]*message_content[\s\S]*full_path/,
    'workflowEventCore.ts 缺少隐私字段过滤定义'
  );

  const payload = coreModule.buildWorkflowEventPayload(
    'engagement.message_sent',
    { session_id: 'session-1' },
    {
      metadata: {
        message_content: 'do-not-send',
        full_path: '/private/path.txt',
        mention_count: 2,
      },
    }
  );
  assert.equal(payload.event_source, 'frontend', 'event_source 不是 frontend');
  assert.equal(payload.metadata_version, 1, 'metadata_version 不是 1');
  assert.equal(payload.session_id, 'session-1', 'session_id 映射错误');
  assert.equal(payload.workflow_id, null, 'workflow_id 缺省值应为 null');
  assert.equal(payload.plan_id, null, 'plan_id 缺省值应为 null');
  assert.equal(
    payload.metadata?.message_content,
    undefined,
    '隐私字段 message_content 未被过滤'
  );
  assert.equal(
    payload.metadata?.full_path,
    undefined,
    '隐私字段 full_path 未被过滤'
  );
  assert.equal(payload.metadata?.mention_count, 2, '允许字段 mention_count 被错误过滤');

  const r4DecisionCases = [
    {
      resolution: 'user_accepted',
      expectedVerdict: 'accepted',
      expectedReviewerType: 'user',
      context: {
        session_id: 'session-r4',
        workflow_id: 'workflow-r4',
        plan_id: 'plan-r4',
      },
    },
    {
      resolution: 'user_rejected',
      expectedVerdict: 'rejected',
      expectedReviewerType: 'user',
      context: {
        session_id: 'session-r4',
        workflow_id: 'workflow-r4',
        plan_id: 'plan-r4',
      },
    },
    {
      resolution: 'plan_revision_created',
      expectedVerdict: 'plan_revision_created',
      expectedReviewerType: 'system',
      context: {
        session_id: 'session-r4',
        plan_id: 'plan-r4',
      },
    },
    {
      resolution: 'review_node_rejected',
      expectedVerdict: 'rejected',
      expectedReviewerType: 'lead',
      context: {
        session_id: 'session-r4',
        workflow_id: 'workflow-r4',
        plan_id: 'plan-r4',
        task_id: 'task-r4',
      },
    },
  ];

  for (const item of r4DecisionCases) {
    const decisionPayload = coreModule.buildWorkflowEventPayload(
      'quality.review_decision_recorded',
      item.context,
      coreModule.buildReviewDecisionRecordedOptions(item.resolution, {
        message_content: 'do-not-send',
      })
    );
    assert.equal(
      decisionPayload.status,
      item.resolution,
      `R4 decision status mismatch for ${item.resolution}`
    );
    assert.equal(
      decisionPayload.metadata?.resolution,
      item.resolution,
      `R4 decision resolution mismatch for ${item.resolution}`
    );
    assert.equal(
      decisionPayload.metadata?.review_verdict,
      item.expectedVerdict,
      `R4 review_verdict mismatch for ${item.resolution}`
    );
    assert.equal(
      decisionPayload.metadata?.reviewer_type,
      item.expectedReviewerType,
      `R4 reviewer_type mismatch for ${item.resolution}`
    );
    assert.equal(
      decisionPayload.metadata?.message_content,
      undefined,
      `R4 forbidden metadata was not filtered for ${item.resolution}`
    );
  }

  assert.match(
    workflowAnalyticsSource,
    /context\.workflow_id[\s\S]*context\.plan_id/,
    'workflowAnalytics.ts 去重键未包含 workflow_id/plan_id'
  );
  assert.match(
    workflowAnalyticsSource,
    /DEDUP_EVENT_NAMES[\s\S]*engagement\.workflow_card_opened[\s\S]*engagement\.transcript_opened[\s\S]*engagement\.diff_viewed/,
    'workflowAnalytics.ts 未将去重限制到打开详情类事件'
  );
  assert.doesNotMatch(
    workflowAnalyticsSource,
    /DEDUP_EVENT_NAMES[\s\S]*engagement\.message_sent/,
    'workflowAnalytics.ts 不应对 engagement.message_sent 去重'
  );
  assert.doesNotMatch(
    workflowAnalyticsSource,
    /DEDUP_EVENT_NAMES[\s\S]*engagement\.attachment_added/,
    'workflowAnalytics.ts 不应对 engagement.attachment_added 去重'
  );
  assert.doesNotMatch(
    workflowAnalyticsSource,
    /DEDUP_EVENT_NAMES[\s\S]*quality\.retry_triggered/,
    'workflowAnalytics.ts 不应对 quality.retry_triggered 去重'
  );
  assert.doesNotMatch(
    workflowAnalyticsSource,
    /DEDUP_EVENT_NAMES[\s\S]*risk\.api_failure/,
    'workflowAnalytics.ts 不应对 risk.api_failure 去重'
  );

  assert.match(
    chatSessionsSource,
    /\{ config, profiles, analyticsUserId, loginStatus, homeDirectory \} =\s*useUserSystem\(\);/,
    'ChatSessions.tsx 未从 useUserSystem 读取 analyticsUserId'
  );
  assert.match(
    chatSessionsSource,
    /createWorkflowEventRecorder\(\s*\(\) => analyticsUserIdRef\.current,\s*baseRecordWorkflowEvent\s*\)/,
    'ChatSessions.tsx 未使用统一事件记录器注入最新 user_id_hash'
  );
  assert.match(
    chatSessionsSource,
    /size_bucket:\s*fileSizeBucket\(/,
    '附件埋点缺少 size_bucket'
  );
  assert.match(
    chatSessionsSource,
    /attachment_type:\s*attachmentTypeBucket\(allowedFiles\)/,
    '附件埋点缺少 attachment_type 枚举'
  );
  assert.doesNotMatch(
    chatSessionsSource,
    /file_size_bucket/,
    '附件埋点仍使用 file_size_bucket，未对齐计划字段'
  );

  const recordedPayloads = [];
  let currentUserIdHash = 'user-hash-1';
  const recorder = coreModule.createWorkflowEventRecorder(
    () => currentUserIdHash,
    (eventName, context, options) => {
      recordedPayloads.push(
        coreModule.buildWorkflowEventPayload(eventName, context, options)
      );
    }
  );

  recorder('engagement.message_sent', { session_id: 'session-A' });
  currentUserIdHash = 'user-hash-2';
  recorder('engagement.message_sent', { session_id: 'session-B' });

  assert.equal(recordedPayloads.length, 2, '行为验证失败：埋点记录次数不正确');
  assert.equal(
    recordedPayloads[0].user_id_hash,
    'user-hash-1',
    '行为验证失败：初始 user_id_hash 未写入 payload'
  );
  assert.equal(
    recordedPayloads[1].user_id_hash,
    'user-hash-2',
    '行为验证失败：analyticsUserId 变更后 payload 未更新 user_id_hash'
  );
  assert.equal(
    recordedPayloads[1].session_id,
    'session-B',
    '行为验证失败：后续事件未使用最新 session_id'
  );

  assert.match(
    chatSessionsSource,
    /const analyticsUserIdRef = useRef<string \| null>\(analyticsUserId \?\? null\);/,
    'ChatSessions.tsx 缺少 analyticsUserIdRef，无法保证事件回调读取最新 user_id_hash'
  );
  assert.match(
    chatSessionsSource,
    /useEffect\(\(\) => \{[\s\S]*analyticsUserIdRef\.current = analyticsUserId \?\? null;[\s\S]*\}, \[analyticsUserId\]\);/,
    'ChatSessions.tsx 未在 analyticsUserId 变化时刷新 ref'
  );
  assert.match(
    chatSessionsSource,
    /const handleConfirmExecutePlan = useCallback\(/,
    'ChatSessions.tsx 缺少 handleConfirmExecutePlan'
  );
  assert.match(
    chatSessionsSource,
    /executePlanAsync,[\s\S]*recordWorkflowEvent,\s*\]/,
    'handleConfirmExecutePlan 依赖缺失，可能捕获旧上下文'
  );
  assert.match(
    chatSessionsSource,
    /\[activeSessionId, interruptStepMutation, recordWorkflowEvent\]/,
    'handleInterruptStep 依赖缺失，可能捕获旧上下文'
  );
  assert.match(
    chatSessionsSource,
    /\[archiveSession, recordWorkflowEvent\]/,
    'handleArchiveSession 依赖缺失，可能捕获旧上下文'
  );
  assert.match(
    chatSessionsSource,
    /\[recordWorkflowEvent, restoreSession\]/,
    'handleRestoreSession 依赖缺失，可能捕获旧上下文'
  );
  assert.match(
    chatSessionsSource,
    /\[[\s\S]*activeSessionId,[\s\S]*messages,[\s\S]*recordWorkflowEvent,[\s\S]*workflowCardProjectionByMessageId,[\s\S]*\]/,
    'handleOpenWorkflowWindow 依赖缺失，可能捕获旧上下文'
  );
  assert.match(
    chatSessionsSource,
    /\[activeSessionId, recordWorkflowEvent\]/,
    'handleStopAgent 依赖缺失，可能捕获旧上下文'
  );

  assert.doesNotMatch(
    chatWorkflowCardSource,
    /WorkflowReviewSettingsPanel|setIsExecuteReviewSettingsOpen|createWorkflowReviewSettingsDraft|buildWorkflowReviewSettingOverrides/,
    'ChatWorkflowCard.tsx 含有非埋点执行流程改动（review settings 执行面板）'
  );
  assert.doesNotMatch(
    workflowWindowSource,
    /WorkflowReviewSettingsPanel|setIsExecuteReviewSettingsOpen|windowSource|WorkflowExecutePlanPayload/,
    'WorkflowWindow.tsx 含有非埋点执行流程改动（review settings/payload/windowSource）'
  );
  assert.match(
    requestPolicySource,
    /WORKFLOW_CARD_REFETCH_INTERVAL_MS = 5_000[\s\S]*WORKFLOW_TRANSCRIPT_REFETCH_INTERVAL_MS = 5_000/,
    'workflowRequestPolicy.ts 轮询间隔应保持 5s'
  );
  assert.doesNotMatch(
    workflowGraphBoardSource,
    /analytics\.trackWorkflow/,
    'WorkflowGraphBoard.tsx 仍在走旧 analytics.trackWorkflow* 通道'
  );
  assert.doesNotMatch(
    workflowPendingReviewSource,
    /analytics\.trackWorkflow/,
    'WorkflowPendingReviewCard.tsx 仍在走旧 analytics.trackWorkflow* 通道'
  );
  assert.doesNotMatch(
    workflowPendingInputSource,
    /analytics\.trackWorkflow/,
    'WorkflowPendingInputCard.tsx 仍在走旧 analytics.trackWorkflow* 通道'
  );
  assert.doesNotMatch(
    workflowIterationFeedbackSource,
    /analytics\.trackWorkflow/,
    'WorkflowIterationFeedbackCard.tsx 仍在走旧 analytics.trackWorkflow* 通道'
  );
  assert.doesNotMatch(
    legacyAnalyticsSource,
    /workflow_graph_layout_failed/,
    'analytics.ts 不应包含额外 snake_case workflow_graph_layout_failed 事件'
  );
  assert.doesNotMatch(
    legacyAnalyticsSource,
    /error_message:\s*stringProperty\(|error_message:\s*errorMessage/,
    'analytics.ts 不应上报 error_message 原文'
  );

  assert.match(
    chatSessionsSource,
    /onSuccess:\s*\(_data, executionId\)[\s\S]*workflow\.execution_state_changed[\s\S]*status:\s*'paused'/,
    'pause 成功后埋点缺失或触发时机不正确'
  );
  assert.match(
    chatSessionsSource,
    /onSuccess:\s*\(_data, executionId\)[\s\S]*workflow\.execution_state_changed[\s\S]*status:\s*'running'/,
    'resume 成功后埋点缺失或触发时机不正确'
  );
  assert.match(
    chatSessionsSource,
    /await archiveSession\.mutateAsync\([\s\S]*engagement\.session_archived[\s\S]*status:\s*'archived'/,
    'archive 成功后埋点缺失或触发时机不正确'
  );
  assert.match(
    chatSessionsSource,
    /await restoreSession\.mutateAsync\([\s\S]*engagement\.session_archived[\s\S]*status:\s*'restored'/,
    'restore 成功后埋点缺失或触发时机不正确'
  );
  assert.match(
    chatSessionsSource,
    /throw new Error\('ATTACHMENT_UPLOAD_FAILED'\)/,
    '附件上传失败未向外抛出，可能导致误记 message_sent 成功事件'
  );
  assert.match(
    chatSessionsSource,
    /error\.message === 'ATTACHMENT_UPLOAD_FAILED'[\s\S]*return;[\s\S]*MESSAGE_SEND_FAILED/s,
    '附件上传失败后的发送失败兜底顺序不正确，可能误记成功事件'
  );

  assert.match(
    chatSessionsSource,
    /'workflow\.session_created'/,
    'ChatSessions.tsx 缺少 session_created 漏斗埋点'
  );
  assert.match(
    chatSessionsSource,
    /'workflow\.plan_executed'/,
    'ChatSessions.tsx 缺少 plan_executed 漏斗埋点'
  );
  assert.match(
    chatSessionsSource,
    /'workflow\.execution_state_changed'/,
    'ChatSessions.tsx 缺少 execution_state_changed 漏斗埋点'
  );
  assert.doesNotMatch(
    chatSessionsSource,
    /queryFn:\s*\(\)\s*=>\s*\{[\s\S]*recordWorkflowEvent\('engagement\.transcript_opened'[\s\S]*getWorkflowTranscripts\(/,
    'engagement.transcript_opened 不应在 transcript 轮询 queryFn 中触发'
  );
  assert.match(
    chatSessionsSource,
    /setWorkflowWindowOpen\(true\);[\s\S]*'engagement\.transcript_opened'[\s\S]*action_key/,
    'engagement.transcript_opened 应在用户打开窗口动作触发，并包含动作去重键'
  );
  assert.match(
    chatSessionsSource,
    /const retryWorkflowStepMutation = useMutation\([\s\S]*'quality\.retry_triggered'[\s\S]*workflow_id:[\s\S]*plan_id:/,
    'retryWorkflowStepMutation 埋点缺少 workflow_id/plan_id 上下文'
  );
  assert.match(
    chatSessionsSource,
    /const submitWorkflowStepInputMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'collaboration\.approval_resolved'/,
    'submitWorkflowStepInputMutation 成功后缺少 collaboration.approval_resolved 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const resolveActionMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'collaboration\.approval_resolved'/,
    'resolveActionMutation 成功后缺少 collaboration.approval_resolved 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const resolveActionMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'quality\.step_reviewed'/,
    'resolveActionMutation 成功后缺少 quality.step_reviewed 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const respondWorkflowReviewMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'collaboration\.approval_resolved'/,
    'respondWorkflowReviewMutation 成功后缺少 collaboration.approval_resolved 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const respondWorkflowReviewMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'quality\.step_reviewed'/,
    'respondWorkflowReviewMutation 成功后缺少 quality.step_reviewed 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const submitWorkflowIterationFeedbackMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'collaboration\.approval_resolved'/,
    'submitWorkflowIterationFeedbackMutation 成功后缺少 collaboration.approval_resolved 埋点'
  );
  assert.match(
    chatSessionsSource,
    /const submitWorkflowIterationFeedbackMutation = useMutation\([\s\S]*onSuccess:[\s\S]*'quality\.step_reviewed'/,
    'submitWorkflowIterationFeedbackMutation 成功后缺少 quality.step_reviewed 埋点'
  );
  assert.match(
    workflowAnalyticsSource,
    /buildReviewDecisionRecordedOptions/,
    'workflowAnalytics.ts 未导出 R4 decision event 封装'
  );
  assert.match(
    chatSessionsSource,
    /const submitWorkflowIterationFeedbackMutation = useMutation\([\s\S]*'quality\.review_decision_recorded'[\s\S]*buildReviewDecisionRecordedOptions\([\s\S]*user_accepted[\s\S]*user_rejected/,
    'submitWorkflowIterationFeedbackMutation 未按 R4 契约记录 user_accepted/user_rejected'
  );
  assert.match(
    coreSource,
    /WORKFLOW_REVIEW_DECISION_CONTRACTS[\s\S]*user_accepted[\s\S]*user_rejected[\s\S]*plan_revision_created[\s\S]*review_node_rejected/,
    'workflowEventCore.ts 缺少 R4 四类可消费 decision 语义'
  );
}

run()
  .then(() => {
    process.stdout.write('workflow instrumentation verification passed\n');
  })
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
