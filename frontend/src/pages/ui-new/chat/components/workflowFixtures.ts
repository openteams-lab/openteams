import type { WorkflowCardData, WorkflowTranscriptEntry } from '@/lib/api';

const workflowAgents = [
  {
    session_agent_id: 'session-agent-lead',
    workflow_agent_session_id: 'workflow-agent-lead',
    agent_id: 'agent-lead',
    name: 'Lead',
  },
  {
    session_agent_id: 'session-agent-reviewer',
    workflow_agent_session_id: 'workflow-agent-reviewer',
    agent_id: 'agent-reviewer',
    name: 'Reviewer',
  },
] satisfies NonNullable<WorkflowCardData['agents']>;

const workflowPlan = {
  nodes: [
    {
      id: 'collect_context',
      position: { x: 0, y: 0 },
      data: {
        stepType: 'task',
        title: 'Collect context',
        instructions: 'Review the latest workflow state before editing UI.',
        agentId: 'workflow-agent-lead',
        status: 'completed',
      },
    },
    {
      id: 'update_controls',
      position: { x: 1, y: 0 },
      data: {
        stepType: 'task',
        title: 'Update workflow controls',
        instructions: 'Align retry, pause, and resume actions with projection.',
        agentId: 'workflow-agent-lead',
        status: 'ready',
      },
    },
    {
      id: 'final_review',
      position: { x: 2, y: 0 },
      data: {
        stepType: 'final_review',
        title: 'Final review',
        instructions: 'Approve or reject the completed workflow delivery.',
        agentId: 'workflow-agent-reviewer',
        status: 'waiting_review',
      },
    },
  ],
  edges: [
    {
      id: 'edge-collect-context-update-controls',
      source: 'collect_context',
      target: 'update_controls',
    },
    {
      id: 'edge-update-controls-final-review',
      source: 'update_controls',
      target: 'final_review',
    },
  ],
  viewport: {
    x: 0,
    y: 0,
    zoom: 1,
  },
} satisfies WorkflowCardData['plan'];

type WorkflowStepFixture = WorkflowCardData['steps'][number];

function createStep(
  step: Omit<
    WorkflowStepFixture,
    | 'review_phase'
    | 'lead_review_required'
    | 'user_review_required'
    | 'retry_count'
    | 'max_retry'
    | 'loop_key'
    | 'latest_review'
  > &
    Partial<
      Pick<
        WorkflowStepFixture,
        | 'review_phase'
        | 'lead_review_required'
        | 'user_review_required'
        | 'retry_count'
        | 'max_retry'
        | 'loop_key'
        | 'latest_review'
      >
    >
): WorkflowStepFixture {
  return {
    review_phase: null,
    lead_review_required: true,
    user_review_required: true,
    retry_count: 0,
    max_retry: 0,
    loop_key: null,
    latest_review: null,
    ...step,
  };
}

function createProjection(
  overrides: Partial<WorkflowCardData> & {
    state: WorkflowCardData['state'];
    execution_status: WorkflowCardData['execution_status'];
    steps: WorkflowCardData['steps'];
  }
): WorkflowCardData {
  const { state, execution_status, steps, ...rest } = overrides;

  return {
    execution_id: 'execution-fixture',
    plan_id: 'plan-fixture',
    revision_id: 'revision-fixture',
    title: 'Workflow controls contract fixture',
    goal: 'Validate workflow UI controls against backend projection states.',
    state,
    execution_status,
    error_message: null,
    completed_step_count: 1,
    total_step_count: 3,
    result_summary: null,
    outputs: [],
    current_round: 1,
    loops: [],
    iteration_history: [],
    steps,
    agents: workflowAgents,
    plan: workflowPlan,
    pending_review: null,
    validation_errors: null,
    ...rest,
  };
}

export const workflowProjectionFixtures = {
  waitingInput: createProjection({
    state: 'waiting',
    execution_status: 'waiting',
    completed_step_count: 1,
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Contract review completed.',
        content: 'Input is now required before continuing.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'waiting_input',
        agent_name: 'Lead',
        summary_text: 'Awaiting user clarification.',
        content: null,
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'blocked',
        agent_name: 'Reviewer',
        summary_text: null,
        content: null,
      }),
    ],
  }),
  paused: createProjection({
    state: 'paused',
    execution_status: 'paused',
    completed_step_count: 1,
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Reviewed the workflow contract changes.',
        content: 'State contract reviewed and ready for the UI pass.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'ready',
        agent_name: 'Lead',
        summary_text: 'Ready to continue after pause.',
        content: null,
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'blocked',
        agent_name: 'Reviewer',
        summary_text: null,
        content: null,
      }),
    ],
  }),
  recompiling: createProjection({
    state: 'running',
    execution_status: 'recompiling',
    completed_step_count: 1,
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Current workflow contract captured.',
        content: 'Projection values refreshed from backend.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'ready',
        agent_name: 'Lead',
        summary_text: 'Waiting for recompilation output.',
        content: null,
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'blocked',
        agent_name: 'Reviewer',
        summary_text: null,
        content: null,
      }),
    ],
  }),
  interruptedRetry: createProjection({
    state: 'failed',
    execution_status: 'failed',
    error_message:
      'A running step was interrupted and needs an explicit retry.',
    completed_step_count: 1,
    loops: [
      {
        id: 'loop-main',
        loop_key: 'main_revision_loop',
        status: 'rejected',
        retry_count: 1,
        max_retry: 2,
        user_review_required: true,
        rejection_reason:
          'Lead reviewer requested another pass to tighten the empty-state copy.',
        member_step_ids: ['step-update-controls'],
        review_step_id: 'step-final-review',
      },
    ],
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Context collection finished.',
        content: 'The prerequisite context is ready.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'interrupted',
        loop_key: 'main_revision_loop',
        agent_name: 'Lead',
        summary_text: 'Interrupted while applying UI fixes.',
        content: null,
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'blocked',
        loop_key: 'main_revision_loop',
        agent_name: 'Reviewer',
        summary_text: null,
        content: null,
      }),
    ],
  }),
  waitingFinalReview: createProjection({
    state: 'waiting',
    execution_status: 'waiting',
    completed_step_count: 3,
    result_summary: 'All workflow edits are complete and awaiting acceptance.',
    outputs: ['frontend/src/pages/ui-new/chat/components/WorkflowWindow.tsx'],
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Backend projection contract confirmed.',
        content: 'Controls now match backend transition rules.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Card, window, and graph controls updated.',
        content: 'Pause and resume buttons follow execution_status.',
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'completed',
        agent_name: 'Reviewer',
        summary_text: 'Ready for approval.',
        content: 'Awaiting accept or reject in final review.',
      }),
    ],
  }),
  completed: createProjection({
    state: 'completed',
    execution_status: 'completed',
    completed_step_count: 3,
    result_summary:
      'Workflow UI controls now align with backend projection rules.',
    outputs: [
      'frontend/src/pages/ui-new/chat/components/ChatWorkflowCard.tsx',
      'frontend/src/pages/ui-new/chat/components/WorkflowGraphBoard.tsx',
      'frontend/src/pages/ui-new/chat/components/WorkflowWindow.tsx',
    ],
    steps: [
      createStep({
        id: 'step-collect-context',
        step_key: 'collect_context',
        title: 'Collect context',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'Context captured.',
        content: 'Backend projection semantics documented.',
      }),
      createStep({
        id: 'step-update-controls',
        step_key: 'update_controls',
        title: 'Update workflow controls',
        step_type: 'task',
        status: 'completed',
        agent_name: 'Lead',
        summary_text: 'UI controls updated.',
        content: 'Retry, pause, and resume affordances are in sync.',
      }),
      createStep({
        id: 'step-final-review',
        step_key: 'final_review',
        title: 'Final review',
        step_type: 'final_review',
        status: 'completed',
        agent_name: 'Reviewer',
        summary_text: 'Accepted.',
        content: 'Delivery approved and closed out.',
      }),
    ],
  }),
};

export const workflowTranscriptFixtures = {
  waitingInput: [
    {
      id: 'transcript-input-request',
      execution_id: 'execution-fixture',
      round_id: null,
      workflow_agent_session_id: 'workflow-agent-lead',
      step_id: 'step-update-controls',
      step_key: 'update_controls',
      sender_type: 'system',
      entry_type: 'input_request',
      content:
        'Please confirm whether resume should stay hidden during recompiling.',
      meta_json: JSON.stringify({
        description:
          'This transcript should keep the workflow window composer enabled.',
        placeholder: 'Describe the expected recompiling behavior',
      }),
      created_at: '2026-04-27T10:00:00.000Z',
      agent_name: 'Lead',
    },
  ] satisfies WorkflowTranscriptEntry[],
  finalReview: [
    {
      id: 'transcript-final-review',
      execution_id: 'execution-fixture',
      round_id: null,
      workflow_agent_session_id: null,
      step_id: null,
      step_key: null,
      sender_type: 'system',
      entry_type: 'final_review',
      content: 'Review the workflow delivery and decide whether to accept it.',
      meta_json: JSON.stringify({
        description:
          'Final review must remain actionable when execution_status is waiting.',
      }),
      created_at: '2026-04-27T10:05:00.000Z',
      agent_name: null,
    },
  ] satisfies WorkflowTranscriptEntry[],
};

export const workflowRetryCountFixtures = {
  failedFirstRetry: {
    step_key: 'update_controls',
    status: 'failed',
    retry_count: 0,
    max_retry: 2,
    retry_available: true,
  },
  interruptedRetryExhausted: {
    step_key: 'update_controls',
    status: 'interrupted',
    retry_count: 2,
    max_retry: 2,
    retry_available: false,
  },
};
