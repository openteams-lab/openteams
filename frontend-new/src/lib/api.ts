// =============================================================================
// API adapter
// -----------------------------------------------------------------------------
// Thin wrappers over the openteams backend (`/api/*`). All endpoints in scope
// for the new frontend (backend_contract_audit §2.3, 2.4, 2.8, 2.16-2.25) are
// covered. Gap-marked fields (weeklySaved, earlyBirdLeft, subscription,
// routing-strategy enum, provider last-used / key-mask presentation) are NOT
// represented here — they have no backend protocol; the UI must derive them
// locally or fall back to mock data.
//
// CLI provider/model/key config lives in `./cliConfigApi` (kept separate to
// stay within the 800-line-per-file guideline). It is re-exported here.
// =============================================================================

import type {
  BackendChatAgent,
  BackendChatMessage,
  BackendChatSession,
  BackendChatSessionAgent,
  BackendChatSkill,
  AgentRuntimeDiagnostics,
  AgentRuntimeListResponse,
  AgentRuntimeRefreshResponse,
  AgentRuntimeStatus,
  BaseCodingAgent,
  ChatAgentSkillAssignment,
  ChatRunActivityResponse,
  ChatRunRetentionListResponse,
  ChatSessionStatus,
  Config,
  CreateChatAgent,
  CreateChatMessageRequest,
  CreateChatSession,
  CreateChatSessionAgentRequest,
  CreateChatSkill,
  DirectoryEntry,
  DirectoryListResponse,
  ExecutePlanRequest,
  ExecutePlanResponse,
  GeneratePlanAndRunResponse,
  GitHubAccount,
  GitHubCreatePrResponse,
  GitHubDeviceFlowPollResponse,
  GitHubDeviceFlowStartResponse,
  GitHubErrorData,
  GitHubIssueDetail,
  GitHubIssueSummary,
  GitHubOAuthStartResponse,
  GitHubOAuthStatusResponse,
  GitHubOperationAudit,
  GitHubOperationResult,
  GitHubPrPreview,
  GitHubRepositorySummary,
  InstalledNativeSkill,
  InterruptStepResponse,
  JsonValue,
  McpConfig,
  OpenInExplorerResponse,
  PauseAllResponse,
  ProjectDeliveryRecord,
  ProjectDeliveryStatsSummary,
  ProjectExecutionLinkType,
  ProjectIssueIntegrationsResponse,
  ProjectRepoIntegration,
  ProjectWorkItem,
  ProjectWorkItemDetailResponse,
  ProjectWorkItemExecutionLink,
  ProfilesContent,
  ResolveActionResponse,
  ResumeExecutionResponse,
  RetryWorkflowPlanGenerationResponse,
  SessionWorkspacesResponse,
  SessionSourceControlStatus,
  SourceControlCommitError,
  SourceControlCommitRequest,
  SourceControlCommitResponse,
  SourceControlDiffRequest,
  SourceControlDiffResponse,
  SourceControlDiscardRequest,
  SourceControlOperationResponse,
  SourceControlStageRequest,
  SourceControlUnstageRequest,
  UpdateAgentRuntimeConfig,
  UpdateAgentSkill,
  UpdateChatAgent,
  UpdateChatSession,
  UpdateChatSessionAgentRequest,
  UpdateChatSkill,
  UpdateNativeSkillRequest,
  UserIterationFeedbackRequest,
  UserIterationFeedbackResponse,
  UserReviewResponseRequest,
  UserReviewResponseResponse,
  UserSystemInfo,
  WorkflowCardLoop,
  WorkflowCardProjection,
  WorkflowIterationSummaryData,
  WorkflowPendingInputData,
  WorkflowPendingReviewData,
  WorkflowStepTokenUsageResponse,
  WorkflowTranscriptEntry,
  WorkspaceChangesResponse,
} from "@/types";
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  CreateProjectSessionRequest,
  Project,
  ProjectDetail,
  ProjectMemberWithRuntime,
  ProjectStats,
  ProjectStatsQuery,
  Repo,
  UpdateProject,
  UpdateProjectMemberRequest,
} from "../../../shared/types";
import {
  ApiError,
  handleApiResponse,
  jsonBody,
  makeRequest,
  qs,
} from "./apiCore";
import { buildStatsApi } from "./buildStatsApi";
import { cliConfigApi } from "./cliConfigApi";

export { ApiError } from "./apiCore";
export { buildStatsApi } from "./buildStatsApi";
export { cliConfigApi } from "./cliConfigApi";

export type WorkflowCardData = WorkflowCardProjection;
export type WorkflowCardLoopData = WorkflowCardLoop;
export type {
  WorkflowIterationSummaryData,
  WorkflowPendingInputData,
  WorkflowPendingReviewData,
};

// -----------------------------------------------------------------------------
// System info / Config
// -----------------------------------------------------------------------------

export const systemApi = {
  getInfo: async (): Promise<UserSystemInfo> => {
    const r = await makeRequest("/api/info", { cache: "no-store" });
    return handleApiResponse<UserSystemInfo>(r);
  },
  saveConfig: async (config: Config): Promise<Config> => {
    const r = await makeRequest("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    return handleApiResponse<Config>(r);
  },
};

export const agentRuntimeApi = {
  list: async (): Promise<AgentRuntimeListResponse> => {
    const r = await makeRequest("/api/agents/runtime", { cache: "no-store" });
    return handleApiResponse<AgentRuntimeListResponse>(r);
  },
  refresh: async (): Promise<AgentRuntimeRefreshResponse> => {
    const r = await makeRequest("/api/agents/runtime/refresh", {
      method: "POST",
    });
    return handleApiResponse<AgentRuntimeRefreshResponse>(r);
  },
  updateConfig: async (
    runner: BaseCodingAgent,
    data: UpdateAgentRuntimeConfig,
  ): Promise<AgentRuntimeStatus> => {
    const r = await makeRequest(
      `/api/agents/runtime/${encodeURIComponent(runner)}`,
      { method: "PATCH", body: jsonBody(data) },
    );
    return handleApiResponse<AgentRuntimeStatus>(r);
  },
  addModel: async (
    runner: BaseCodingAgent,
    modelName: string,
  ): Promise<AgentRuntimeStatus> => {
    const r = await makeRequest(
      `/api/agents/runtime/${encodeURIComponent(runner)}/models`,
      { method: "POST", body: jsonBody({ model_name: modelName }) },
    );
    return handleApiResponse<AgentRuntimeStatus>(r);
  },
  renameModel: async (
    runner: BaseCodingAgent,
    oldModelName: string,
    newModelName: string,
  ): Promise<AgentRuntimeStatus> => {
    const r = await makeRequest(
      `/api/agents/runtime/${encodeURIComponent(runner)}/models`,
      {
        method: "PUT",
        body: jsonBody({
          old_model_name: oldModelName,
          new_model_name: newModelName,
        }),
      },
    );
    return handleApiResponse<AgentRuntimeStatus>(r);
  },
  getDiagnostics: async (
    runner: BaseCodingAgent,
  ): Promise<AgentRuntimeDiagnostics> => {
    const r = await makeRequest(
      `/api/agents/runtime/${encodeURIComponent(runner)}/diagnostics`,
      { cache: "no-store" },
    );
    return handleApiResponse<AgentRuntimeDiagnostics>(r);
  },
};

export interface McpConfigResponse {
  mcp_config: McpConfig;
  config_path: string;
}

export interface UpdateMcpServersBody {
  servers: Record<string, JsonValue>;
}

export const mcpServersApi = {
  load: async (runner: BaseCodingAgent): Promise<McpConfigResponse> => {
    const r = await makeRequest(
      `/api/mcp-config${qs({ executor: runner })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<McpConfigResponse>(r);
  },
  save: async (
    runner: BaseCodingAgent,
    data: UpdateMcpServersBody,
  ): Promise<string> => {
    const r = await makeRequest(
      `/api/mcp-config${qs({ executor: runner })}`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<string>(r);
  },
};

export const profilesApi = {
  load: async (): Promise<ProfilesContent> => {
    const r = await makeRequest("/api/profiles", { cache: "no-store" });
    return handleApiResponse<ProfilesContent>(r);
  },
  save: async (content: string): Promise<string> => {
    const r = await makeRequest("/api/profiles", {
      method: "PUT",
      body: content,
    });
    return handleApiResponse<string>(r);
  },
};

// -----------------------------------------------------------------------------
// Filesystem
// -----------------------------------------------------------------------------

export const filesystemApi = {
  listRoots: async (): Promise<DirectoryEntry[]> => {
    const r = await makeRequest("/api/filesystem/roots");
    return handleApiResponse<DirectoryEntry[]>(r);
  },
  listDirectory: async (path?: string): Promise<DirectoryListResponse> => {
    const r = await makeRequest(`/api/filesystem/directory${qs({ path })}`);
    return handleApiResponse<DirectoryListResponse>(r);
  },
  listGitRepos: async (path?: string): Promise<DirectoryEntry[]> => {
    const r = await makeRequest(`/api/filesystem/git-repos${qs({ path })}`);
    return handleApiResponse<DirectoryEntry[]>(r);
  },
  openInExplorer: async (
    path: string,
    workspacePath?: string,
  ): Promise<OpenInExplorerResponse> => {
    const r = await makeRequest("/api/filesystem/open-in-explorer", {
      method: "POST",
      body: JSON.stringify({ path, workspace_path: workspacePath ?? null }),
    });
    if (!r.ok) {
      throw new ApiError(
        r.statusText || "Failed to open path in explorer",
        r.status,
      );
    }
    // Endpoint returns non-envelope JSON.
    return r.json() as Promise<OpenInExplorerResponse>;
  },
};

// -----------------------------------------------------------------------------
// Chat sessions
// -----------------------------------------------------------------------------

export const chatSessionsApi = {
  list: async (
    status?: ChatSessionStatus,
    projectId?: string,
  ): Promise<BackendChatSession[]> => {
    const r = await makeRequest(
      `/api/chat/sessions${qs({ status, project_id: projectId })}`,
    );
    return handleApiResponse<BackendChatSession[]>(r);
  },
  get: async (sessionId: string): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  create: async (data: CreateChatSession): Promise<BackendChatSession> => {
    const r = await makeRequest("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<BackendChatSession>(r);
  },
  update: async (
    sessionId: string,
    data: UpdateChatSession,
  ): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  delete: async (sessionId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      },
    );
    await handleApiResponse<void>(r);
  },
  archive: async (sessionId: string): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/archive`,
      { method: "POST" },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  restore: async (sessionId: string): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/restore`,
      { method: "POST" },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  getWorkspaces: async (
    sessionId: string,
  ): Promise<SessionWorkspacesResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workspaces`,
    );
    return handleApiResponse<SessionWorkspacesResponse>(r);
  },
  getWorkspaceChanges: async (
    sessionId: string,
    path: string,
    includeDiff?: boolean,
  ): Promise<WorkspaceChangesResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workspaces/changes${qs(
        {
          path,
          include_diff: includeDiff,
        },
      )}`,
    );
    return handleApiResponse<WorkspaceChangesResponse>(r);
  },
  /**
   * Stream endpoint URL. Caller is responsible for opening the WebSocket /
   * EventSource — the adapter does not subscribe automatically.
   */
  streamUrl: (sessionId: string): string =>
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/stream`,
};

// -----------------------------------------------------------------------------
// Chat messages
// -----------------------------------------------------------------------------

export const chatMessagesApi = {
  list: async (
    sessionId: string,
    limit?: number,
  ): Promise<BackendChatMessage[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${qs({ limit })}`,
    );
    return handleApiResponse<BackendChatMessage[]>(r);
  },
  send: async (
    sessionId: string,
    data: CreateChatMessageRequest,
  ): Promise<BackendChatMessage> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify(data) },
    );
    return handleApiResponse<BackendChatMessage>(r);
  },
  get: async (messageId: string): Promise<BackendChatMessage> => {
    const r = await makeRequest(
      `/api/chat/messages/${encodeURIComponent(messageId)}`,
    );
    return handleApiResponse<BackendChatMessage>(r);
  },
  delete: async (messageId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
      },
    );
    await handleApiResponse<void>(r);
  },
  batchDelete: async (
    sessionId: string,
    messageIds: string[],
  ): Promise<number> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/batch-delete`,
      { method: "POST", body: JSON.stringify({ message_ids: messageIds }) },
    );
    return handleApiResponse<number>(r);
  },
  resend: async (sessionId: string, messageId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
        messageId,
      )}/resend`,
      { method: "POST" },
    );
    await handleApiResponse<void>(r);
  },
  uploadAttachment: async (
    sessionId: string,
    files: File | File[],
    options?: {
      chatInputMode?: "free" | "workflow";
      content?: string;
      referenceMessageId?: string;
    },
  ): Promise<BackendChatMessage> => {
    const form = new FormData();
    for (const file of Array.isArray(files) ? files : [files]) {
      form.append("file", file, file.name);
    }
    if (options?.content) {
      form.append("content", options.content);
    }
    if (options?.referenceMessageId) {
      form.append("reference_message_id", options.referenceMessageId);
    }
    if (options?.chatInputMode === "workflow") {
      form.append("chat_input_mode", "workflow");
    }
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/upload`,
      { method: "POST", body: form },
    );
    return handleApiResponse<BackendChatMessage>(r);
  },
  attachmentUrl: (
    sessionId: string,
    messageId: string,
    attachmentId: string,
  ): string =>
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(
      messageId,
    )}/attachments/${encodeURIComponent(attachmentId)}`,
  getWorkflowCard: async (
    messageId: string,
    detail?: "summary" | "full",
  ): Promise<WorkflowCardProjection> => {
    const r = await makeRequest(
      `/api/chat/messages/${encodeURIComponent(messageId)}/workflow-card${qs({
        detail,
      })}`,
    );
    return handleApiResponse<WorkflowCardProjection>(r);
  },
};

// -----------------------------------------------------------------------------
// Chat runs
// -----------------------------------------------------------------------------

export const chatRunsApi = {
  listSessionRetention: async (
    sessionId: string,
    opts?: { runIds?: string[]; limit?: number },
  ): Promise<ChatRunRetentionListResponse> => {
    const runIds =
      opts?.runIds && opts.runIds.length > 0
        ? opts.runIds.join(",")
        : undefined;
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/runs/retention${qs({
        run_ids: runIds,
        limit: opts?.limit,
      })}`,
    );
    return handleApiResponse<ChatRunRetentionListResponse>(r);
  },
  getActivity: async (
    runId: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<ChatRunActivityResponse> => {
    const r = await makeRequest(
      `/api/chat/runs/${encodeURIComponent(runId)}/activity${qs({
        offset: opts?.offset,
        limit: opts?.limit,
      })}`,
    );
    return handleApiResponse<ChatRunActivityResponse>(r);
  },
};

// -----------------------------------------------------------------------------
// Chat agents (global) + session agents
// -----------------------------------------------------------------------------

export const chatAgentsApi = {
  list: async (opts?: { projectId?: string }): Promise<BackendChatAgent[]> => {
    const r = await makeRequest(
      `/api/chat/agents${qs({ project_id: opts?.projectId })}`,
    );
    return handleApiResponse<BackendChatAgent[]>(r);
  },
  get: async (agentId: string): Promise<BackendChatAgent> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}`,
    );
    return handleApiResponse<BackendChatAgent>(r);
  },
  create: async (data: CreateChatAgent): Promise<BackendChatAgent> => {
    const r = await makeRequest("/api/chat/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<BackendChatAgent>(r);
  },
  update: async (
    agentId: string,
    data: UpdateChatAgent,
  ): Promise<BackendChatAgent> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return handleApiResponse<BackendChatAgent>(r);
  },
  delete: async (agentId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}`,
      {
        method: "DELETE",
      },
    );
    await handleApiResponse<void>(r);
  },
};

export const sessionAgentsApi = {
  list: async (sessionId: string): Promise<BackendChatSessionAgent[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents`,
    );
    return handleApiResponse<BackendChatSessionAgent[]>(r);
  },
  add: async (
    sessionId: string,
    data: CreateChatSessionAgentRequest,
  ): Promise<BackendChatSessionAgent> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents`,
      { method: "POST", body: JSON.stringify(data) },
    );
    return handleApiResponse<BackendChatSessionAgent>(r);
  },
  update: async (
    sessionId: string,
    sessionAgentId: string,
    data: UpdateChatSessionAgentRequest,
  ): Promise<BackendChatSessionAgent> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(
        sessionAgentId,
      )}`,
      { method: "PUT", body: JSON.stringify(data) },
    );
    return handleApiResponse<BackendChatSessionAgent>(r);
  },
  remove: async (sessionId: string, sessionAgentId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(
        sessionAgentId,
      )}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void>(r);
  },
  stop: async (sessionId: string, sessionAgentId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(
        sessionAgentId,
      )}/stop`,
      { method: "POST" },
    );
    await handleApiResponse<void>(r);
  },
};

// -----------------------------------------------------------------------------
// Skills
// -----------------------------------------------------------------------------

export const skillsApi = {
  list: async (): Promise<BackendChatSkill[]> => {
    const r = await makeRequest("/api/chat/skills");
    return handleApiResponse<BackendChatSkill[]>(r);
  },
  get: async (skillId: string): Promise<BackendChatSkill> => {
    const r = await makeRequest(
      `/api/chat/skills/${encodeURIComponent(skillId)}`,
    );
    return handleApiResponse<BackendChatSkill>(r);
  },
  create: async (data: CreateChatSkill): Promise<BackendChatSkill> => {
    const r = await makeRequest("/api/chat/skills", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<BackendChatSkill>(r);
  },
  update: async (
    skillId: string,
    data: UpdateChatSkill,
  ): Promise<BackendChatSkill> => {
    const r = await makeRequest(
      `/api/chat/skills/${encodeURIComponent(skillId)}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return handleApiResponse<BackendChatSkill>(r);
  },
  delete: async (skillId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/skills/${encodeURIComponent(skillId)}`,
      {
        method: "DELETE",
      },
    );
    await handleApiResponse<void>(r);
  },
  listNative: async (runnerType: string): Promise<InstalledNativeSkill[]> => {
    const r = await makeRequest(
      `/api/chat/skills/native/${encodeURIComponent(runnerType)}`,
    );
    return handleApiResponse<InstalledNativeSkill[]>(r);
  },
  updateNative: async (
    runnerType: string,
    skillId: string,
    data: UpdateNativeSkillRequest,
  ): Promise<InstalledNativeSkill> => {
    const r = await makeRequest(
      `/api/chat/skills/native/${encodeURIComponent(runnerType)}/${encodeURIComponent(
        skillId,
      )}`,
      { method: "PUT", body: JSON.stringify(data) },
    );
    return handleApiResponse<InstalledNativeSkill>(r);
  },
  listAgentAssignments: async (
    agentId: string,
  ): Promise<ChatAgentSkillAssignment[]> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}/skills`,
    );
    return handleApiResponse<ChatAgentSkillAssignment[]>(r);
  },
  assignToAgent: async (
    agentId: string,
    skillId: string,
    enabled?: boolean,
  ): Promise<ChatAgentSkillAssignment> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}/skills`,
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId,
          skill_id: skillId,
          enabled: enabled ?? null,
        }),
      },
    );
    return handleApiResponse<ChatAgentSkillAssignment>(r);
  },
  updateAgentSkill: async (
    agentId: string,
    assignmentId: string,
    data: UpdateAgentSkill,
  ): Promise<ChatAgentSkillAssignment> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(
        assignmentId,
      )}`,
      { method: "PUT", body: JSON.stringify(data) },
    );
    return handleApiResponse<ChatAgentSkillAssignment>(r);
  },
  unassignFromAgent: async (
    agentId: string,
    assignmentId: string,
  ): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(
        assignmentId,
      )}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void>(r);
  },
};

// -----------------------------------------------------------------------------
// Workflow (session-scoped + global review/iteration)
// -----------------------------------------------------------------------------

export const workflowApi = {
  generatePlanAndRun: async (
    sessionId: string,
    userGoal?: string,
  ): Promise<GeneratePlanAndRunResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/generate-plan-and-run`,
      { method: "POST", body: JSON.stringify({ user_goal: userGoal ?? null }) },
    );
    return handleApiResponse<GeneratePlanAndRunResponse>(r);
  },
  executePlan: async (
    sessionId: string,
    planId: string,
    data?: ExecutePlanRequest,
  ): Promise<ExecutePlanResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/plans/${encodeURIComponent(
        planId,
      )}/execute`,
      { method: "POST", body: JSON.stringify(data ?? {}) },
    );
    return handleApiResponse<ExecutePlanResponse>(r);
  },
  updateReviewSettings: async (
    sessionId: string,
    executionId: string,
    data: Pick<ExecutePlanRequest, "stepReviewOverrides">,
  ): Promise<WorkflowCardProjection> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/executions/${encodeURIComponent(
        executionId,
      )}/review-settings`,
      { method: "POST", body: JSON.stringify(data) },
    );
    return handleApiResponse<WorkflowCardProjection>(r);
  },
  resumeExecution: async (
    sessionId: string,
    executionId: string,
  ): Promise<ResumeExecutionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/executions/${encodeURIComponent(
        executionId,
      )}/resume`,
      { method: "POST" },
    );
    return handleApiResponse<ResumeExecutionResponse>(r);
  },
  retryPlanGeneration: async (
    sessionId: string,
    messageId: string,
  ): Promise<RetryWorkflowPlanGenerationResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/plan-generations/${encodeURIComponent(
        messageId,
      )}/retry`,
      { method: "POST" },
    );
    return handleApiResponse<RetryWorkflowPlanGenerationResponse>(r);
  },
  getExecutionTranscripts: async (
    sessionId: string,
    executionId: string,
    opts?: {
      stepId?: string;
      stepKey?: string;
      workflowAgentSessionId?: string;
    },
  ): Promise<WorkflowTranscriptEntry[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/executions/${encodeURIComponent(
        executionId,
      )}/transcripts${qs({
        step_id: opts?.stepId,
        step_key: opts?.stepKey,
        workflow_agent_session_id: opts?.workflowAgentSessionId,
      })}`,
      { method: "GET" },
    );
    return handleApiResponse<WorkflowTranscriptEntry[]>(r);
  },
  pauseAll: async (
    sessionId: string,
    executionId: string,
  ): Promise<PauseAllResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/pause-all`,
      { method: "POST", body: JSON.stringify({ execution_id: executionId }) },
    );
    return handleApiResponse<PauseAllResponse>(r);
  },
  interruptStep: async (
    sessionId: string,
    executionId: string,
    stepId: string,
  ): Promise<InterruptStepResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/interrupt-step`,
      {
        method: "POST",
        body: JSON.stringify({ execution_id: executionId, step_id: stepId }),
      },
    );
    return handleApiResponse<InterruptStepResponse>(r);
  },
  resolveAction: async (
    sessionId: string,
    payload: {
      executionId: string;
      transcriptId: string;
      action: string;
      inputText?: string;
    },
  ): Promise<ResolveActionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/resolve-action`,
      {
        method: "POST",
        body: JSON.stringify({
          execution_id: payload.executionId,
          transcript_id: payload.transcriptId,
          action: payload.action,
          input_text: payload.inputText ?? null,
        }),
      },
    );
    return handleApiResponse<ResolveActionResponse>(r);
  },
  getStepTranscripts: async (
    sessionId: string,
    stepId: string,
    opts?: { stepKey?: string; workflowAgentSessionId?: string },
  ): Promise<WorkflowTranscriptEntry[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/transcripts${qs({
        step_key: opts?.stepKey,
        workflow_agent_session_id: opts?.workflowAgentSessionId,
      })}`,
      { method: "GET" },
    );
    return handleApiResponse<WorkflowTranscriptEntry[]>(r);
  },
  getStepTokenUsage: async (
    sessionId: string,
    stepId: string,
  ): Promise<WorkflowStepTokenUsageResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/token-usage`,
      { method: "GET" },
    );
    return handleApiResponse<WorkflowStepTokenUsageResponse>(r);
  },
  submitStepInput: async (
    sessionId: string,
    stepId: string,
    inputText: string,
  ): Promise<ResolveActionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/input`,
      { method: "POST", body: JSON.stringify({ input_text: inputText }) },
    );
    return handleApiResponse<ResolveActionResponse>(r);
  },
  interruptStepById: async (
    sessionId: string,
    stepId: string,
  ): Promise<InterruptStepResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/interrupt`,
      { method: "POST" },
    );
    return handleApiResponse<InterruptStepResponse>(r);
  },
  stopStep: async (
    sessionId: string,
    stepId: string,
  ): Promise<InterruptStepResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/stop`,
      { method: "POST" },
    );
    return handleApiResponse<InterruptStepResponse>(r);
  },
  retryStep: async (
    sessionId: string,
    stepId: string,
    retryTarget?: "task" | "review",
  ): Promise<ResolveActionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/retry${qs({ retry_target: retryTarget })}`,
      { method: "POST" },
    );
    return handleApiResponse<ResolveActionResponse>(r);
  },
  approveStep: async (
    sessionId: string,
    stepId: string,
    payload: { transcriptId: string; action: string; inputText?: string },
  ): Promise<ResolveActionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          transcript_id: payload.transcriptId,
          action: payload.action,
          input_text: payload.inputText ?? null,
        }),
      },
    );
    return handleApiResponse<ResolveActionResponse>(r);
  },
  resolveStepPermission: async (
    sessionId: string,
    stepId: string,
    payload: { transcriptId: string; action: string },
  ): Promise<ResolveActionResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow-steps/${encodeURIComponent(
        stepId,
      )}/resolve-permission`,
      {
        method: "POST",
        body: JSON.stringify({
          transcript_id: payload.transcriptId,
          action: payload.action,
        }),
      },
    );
    return handleApiResponse<ResolveActionResponse>(r);
  },
  respondToReview: async (
    data: UserReviewResponseRequest,
  ): Promise<UserReviewResponseResponse> => {
    const r = await makeRequest("/api/workflow/review/respond", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<UserReviewResponseResponse>(r);
  },
  submitIterationFeedback: async (
    data: UserIterationFeedbackRequest,
  ): Promise<UserIterationFeedbackResponse> => {
    const r = await makeRequest("/api/workflow/iteration/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<UserIterationFeedbackResponse>(r);
  },
};

const workflowTranscriptForOldUi = (entry: WorkflowTranscriptEntry) => ({
  ...entry,
  message_type:
    entry.sender_type === "agent" ||
    entry.sender_type === "user" ||
    entry.sender_type === "system"
      ? entry.sender_type
      : "control",
});

export const chatApi = {
  getWorkflowCard: chatMessagesApi.getWorkflowCard,
  executePlan: workflowApi.executePlan,
  updateWorkflowReviewSettings: workflowApi.updateReviewSettings,
  resumeExecution: workflowApi.resumeExecution,
  retryWorkflowPlanGeneration: workflowApi.retryPlanGeneration,
  getWorkflowStepTranscripts: async (
    sessionId: string,
    stepId: string,
    filters?: { stepKey?: string; workflowAgentSessionId?: string },
  ) => {
    const entries = await workflowApi.getStepTranscripts(
      sessionId,
      stepId,
      filters,
    );
    return entries.map(workflowTranscriptForOldUi);
  },
  getWorkflowStepTokenUsage: workflowApi.getStepTokenUsage,
  submitWorkflowStepInput: workflowApi.submitStepInput,
  interruptWorkflowStep: workflowApi.interruptStepById,
  stopWorkflowStep: workflowApi.stopStep,
  retryWorkflowStep: workflowApi.retryStep,
  approveWorkflowStep: workflowApi.approveStep,
  resolveWorkflowStepPermission: workflowApi.resolveStepPermission,
  getWorkflowTranscripts: async (sessionId: string, executionId: string) => {
    const entries = await workflowApi.getExecutionTranscripts(
      sessionId,
      executionId,
    );
    return entries.map(workflowTranscriptForOldUi);
  },
  resolveWorkflowAction: workflowApi.resolveAction,
  respondToWorkflowReview: workflowApi.respondToReview,
  submitWorkflowIterationFeedback: workflowApi.submitIterationFeedback,
};

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------

export const projectApi = {
  listProjects: async (): Promise<Project[]> => {
    const r = await makeRequest("/api/projects");
    return handleApiResponse<Project[]>(r);
  },
  createProject: async (data: CreateProjectRequest): Promise<Project> => {
    const r = await makeRequest("/api/projects", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<Project>(r);
  },
  getProject: async (id: string): Promise<ProjectDetail> => {
    const r = await makeRequest(`/api/projects/${encodeURIComponent(id)}`);
    return handleApiResponse<ProjectDetail>(r);
  },
  getProjectDetailSessions: async (
    id: string,
  ): Promise<ProjectDetail["sessions"]> => {
    const data = await projectApi.getProject(id);
    return data.sessions;
  },
  updateProject: async (id: string, data: UpdateProject): Promise<Project> => {
    const r = await makeRequest(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: jsonBody(data),
    });
    return handleApiResponse<Project>(r);
  },
  deleteProject: async (id: string): Promise<void> => {
    const r = await makeRequest(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return handleApiResponse<void>(r);
  },
  listMembers: async (projectId: string): Promise<ProjectMemberWithRuntime[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members`,
    );
    return handleApiResponse<ProjectMemberWithRuntime[]>(r);
  },
  addMember: async (
    projectId: string,
    data: AddProjectMemberRequest,
  ): Promise<ProjectMemberWithRuntime> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectMemberWithRuntime>(r);
  },
  updateMember: async (
    projectId: string,
    memberId: string,
    data: UpdateProjectMemberRequest,
  ): Promise<ProjectMemberWithRuntime> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
        memberId,
      )}`,
      { method: "PUT", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectMemberWithRuntime>(r);
  },
  removeMember: async (projectId: string, memberId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
        memberId,
      )}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void>(r);
  },
  listSessions: async (projectId: string): Promise<BackendChatSession[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/sessions`,
    );
    return handleApiResponse<BackendChatSession[]>(r);
  },
  createSession: async (
    projectId: string,
    data: CreateProjectSessionRequest,
  ): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/sessions`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  listRepos: async (projectId: string): Promise<Repo[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/repos`,
    );
    return handleApiResponse<Repo[]>(r);
  },
  getStats: async (
    projectId: string,
    params?: ProjectStatsQuery,
  ): Promise<ProjectStats[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/stats${qs({
        period_start: params?.period_start,
        period_end: params?.period_end,
      })}`,
    );
    return handleApiResponse<ProjectStats[]>(r);
  },
};

type SourceControlWriteOptions = {
  response?: "full" | "fast";
};

const sourceControlWriteQuery = (
  options?: SourceControlWriteOptions,
): string => (options?.response === "fast" ? qs({ response: "fast" }) : "");

export const projectSourceControlApi = {
  getSessionStatus: async (
    projectId: string,
    sessionId: string,
  ): Promise<SessionSourceControlStatus> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/source-control/session-status${qs({ session_id: sessionId })}`,
    );
    return handleApiResponse<SessionSourceControlStatus>(r);
  },
  getDiff: async (
    projectId: string,
    params: SourceControlDiffRequest,
  ): Promise<SourceControlDiffResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/source-control/diff${qs({
        session_id: params.session_id,
        workspace_id: params.workspace_id,
        path: params.path,
        area: params.area,
      })}`,
    );
    return handleApiResponse<SourceControlDiffResponse>(r);
  },
  stage: async (
    projectId: string,
    request: SourceControlStageRequest,
    options?: SourceControlWriteOptions,
  ): Promise<SourceControlOperationResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/source-control/stage${sourceControlWriteQuery(options)}`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SourceControlOperationResponse>(r);
  },
  unstage: async (
    projectId: string,
    request: SourceControlUnstageRequest,
    options?: SourceControlWriteOptions,
  ): Promise<SourceControlOperationResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/source-control/unstage${sourceControlWriteQuery(options)}`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SourceControlOperationResponse>(r);
  },
  discard: async (
    projectId: string,
    request: SourceControlDiscardRequest,
    options?: SourceControlWriteOptions,
  ): Promise<SourceControlOperationResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/source-control/discard${sourceControlWriteQuery(options)}`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SourceControlOperationResponse>(r);
  },
  commit: async (
    projectId: string,
    request: SourceControlCommitRequest,
  ): Promise<SourceControlCommitResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/source-control/commit`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<
      SourceControlCommitResponse,
      SourceControlCommitError
    >(r);
  },
};

// -----------------------------------------------------------------------------
// GitHub integration (local backend API only)
// -----------------------------------------------------------------------------

export const githubAuthApi = {
  startOAuthFlow: async (): Promise<GitHubOAuthStartResponse> => {
    const r = await makeRequest("/api/github/auth/oauth/start", {
      method: "POST",
    });
    return handleApiResponse<GitHubOAuthStartResponse, GitHubErrorData>(r);
  },
  getOAuthStatus: async (
    flowId: string,
  ): Promise<GitHubOAuthStatusResponse> => {
    const r = await makeRequest(
      `/api/github/auth/oauth/status${qs({ flow_id: flowId })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<GitHubOAuthStatusResponse, GitHubErrorData>(r);
  },
  startDeviceFlow: async (): Promise<GitHubDeviceFlowStartResponse> => {
    const r = await makeRequest("/api/github/auth/device/start", {
      method: "POST",
    });
    return handleApiResponse<GitHubDeviceFlowStartResponse, GitHubErrorData>(r);
  },
  pollDeviceFlow: async (
    deviceCode: string,
  ): Promise<GitHubDeviceFlowPollResponse> => {
    const r = await makeRequest("/api/github/auth/device/poll", {
      method: "POST",
      body: jsonBody({ device_code: deviceCode }),
    });
    return handleApiResponse<GitHubDeviceFlowPollResponse, GitHubErrorData>(r);
  },
  getAccount: async (): Promise<GitHubAccount | null> => {
    const r = await makeRequest("/api/github/auth/account", {
      cache: "no-store",
    });
    return handleApiResponse<GitHubAccount | null, GitHubErrorData>(r);
  },
  listRepos: async (): Promise<GitHubRepositorySummary[]> => {
    const r = await makeRequest("/api/github/repos", { cache: "no-store" });
    return handleApiResponse<GitHubRepositorySummary[], GitHubErrorData>(r);
  },
  disconnect: async (): Promise<void> => {
    const r = await makeRequest("/api/github/auth/disconnect", {
      method: "POST",
    });
    return handleApiResponse<void, GitHubErrorData>(r);
  },
};

export const projectGithubApi = {
  getIssueIntegrations: async (
    projectId: string,
  ): Promise<ProjectIssueIntegrationsResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/issue-integrations`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectIssueIntegrationsResponse, GitHubErrorData>(
      r,
    );
  },
  listRepos: async (projectId: string): Promise<ProjectRepoIntegration[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/repos`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectRepoIntegration[], GitHubErrorData>(r);
  },
  createRepo: async (
    projectId: string,
    data: {
      repo_id?: string | null;
      provider?: string;
      owner?: string | null;
      name?: string | null;
      full_name?: string | null;
      html_url?: string | null;
      clone_url?: string | null;
      ssh_url?: string | null;
      remote_url?: string | null;
      default_branch?: string | null;
      external_id?: string | null;
      github_account_id?: string | null;
      sync_status?: "connected" | "disconnected" | "error";
      repo_grant_json?: JsonValue | null;
      role?: "primary" | "auxiliary" | null;
    },
  ): Promise<ProjectRepoIntegration> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/repos`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectRepoIntegration, GitHubErrorData>(r);
  },
  updateRepo: async (
    projectId: string,
    repoIntegrationId: string,
    data: {
      default_branch?: string | null;
      repo_grant_json?: JsonValue | null;
      primary?: boolean | null;
    },
  ): Promise<ProjectRepoIntegration> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/repos/${encodeURIComponent(
        repoIntegrationId,
      )}`,
      { method: "PUT", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectRepoIntegration, GitHubErrorData>(r);
  },
  disconnectRepo: async (
    projectId: string,
    repoIntegrationId: string,
  ): Promise<ProjectRepoIntegration> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/repos/${encodeURIComponent(
        repoIntegrationId,
      )}/disconnect`,
      { method: "POST" },
    );
    return handleApiResponse<ProjectRepoIntegration, GitHubErrorData>(r);
  },
  refreshRepo: async (
    projectId: string,
    repoIntegrationId: string,
  ): Promise<ProjectRepoIntegration> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/repos/${encodeURIComponent(
        repoIntegrationId,
      )}/refresh`,
      { method: "POST" },
    );
    return handleApiResponse<ProjectRepoIntegration, GitHubErrorData>(r);
  },
  listIssues: async (
    projectId: string,
    params?: { repoIntegrationId?: string; state?: string; query?: string },
  ): Promise<GitHubIssueSummary[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues${qs({
        repo_integration_id: params?.repoIntegrationId,
        state: params?.state,
        q: params?.query,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<GitHubIssueSummary[], GitHubErrorData>(r);
  },
  getIssue: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
  ): Promise<GitHubIssueDetail> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}`,
      { cache: "no-store" },
    );
    return handleApiResponse<GitHubIssueDetail, GitHubErrorData>(r);
  },
  importIssue: async (
    projectId: string,
    data: {
      repo_integration_id: string;
      number: number;
    },
  ): Promise<ProjectWorkItemDetailResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/import`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectWorkItemDetailResponse, GitHubErrorData>(r);
  },
  refreshIssue: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
  ): Promise<GitHubIssueDetail> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/refresh`,
      { method: "POST" },
    );
    return handleApiResponse<GitHubIssueDetail, GitHubErrorData>(r);
  },
  commentIssue: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
    body: string,
  ): Promise<GitHubOperationResult> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/comments`,
      { method: "POST", body: jsonBody({ body }) },
    );
    return handleApiResponse<GitHubOperationResult, GitHubErrorData>(r);
  },
  updateIssueBody: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
    body: string,
  ): Promise<GitHubIssueSummary> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/body`,
      { method: "PUT", body: jsonBody({ body }) },
    );
    return handleApiResponse<GitHubIssueSummary, GitHubErrorData>(r);
  },
  updateIssueState: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
    state: "open" | "closed",
  ): Promise<GitHubIssueSummary> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/state`,
      { method: "PUT", body: jsonBody({ state }) },
    );
    return handleApiResponse<GitHubIssueSummary, GitHubErrorData>(r);
  },
  updateIssueLabels: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
    labels: string[],
  ): Promise<string[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/labels`,
      { method: "PUT", body: jsonBody({ labels }) },
    );
    return handleApiResponse<string[], GitHubErrorData>(r);
  },
  updateIssueAssignees: async (
    projectId: string,
    repoIntegrationId: string,
    number: number,
    assignees: string[],
  ): Promise<GitHubIssueSummary> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/issues/${encodeURIComponent(
        repoIntegrationId,
      )}/${number}/assignees`,
      { method: "PUT", body: jsonBody({ assignees }) },
    );
    return handleApiResponse<GitHubIssueSummary, GitHubErrorData>(r);
  },
  listBranches: async (
    projectId: string,
    repoIntegrationId: string,
  ): Promise<string[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/branches${qs({
        repo_integration_id: repoIntegrationId,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<string[], GitHubErrorData>(r);
  },
  previewPr: async (
    projectId: string,
    data: {
      repo_integration_id: string;
      base_branch: string;
      head_branch: string;
    },
  ): Promise<GitHubPrPreview> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/pr/preview`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<GitHubPrPreview, GitHubErrorData>(r);
  },
  pushPrHead: async (
    projectId: string,
    data: {
      repo_integration_id: string;
      head_branch: string;
      base_branch?: string | null;
      title?: string | null;
      body?: string | null;
      work_item_id?: string | null;
      operation_source?: "user_ui" | "agent";
    },
  ): Promise<void> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/pr/push`,
      {
        method: "POST",
        body: jsonBody({
          ...data,
          operation_source: data.operation_source ?? "user_ui",
        }),
      },
    );
    await handleApiResponse<null, GitHubErrorData>(r);
  },
  createPr: async (
    projectId: string,
    data: {
      repo_integration_id: string;
      base_branch: string;
      head_branch: string;
      title: string;
      body?: string | null;
      work_item_id?: string | null;
      operation_source?: "user_ui" | "agent";
    },
  ): Promise<GitHubCreatePrResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/pr/create`,
      {
        method: "POST",
        body: jsonBody({
          ...data,
          body: data.body ?? null,
          work_item_id: data.work_item_id ?? null,
          operation_source: data.operation_source ?? "user_ui",
        }),
      },
    );
    return handleApiResponse<GitHubCreatePrResponse, GitHubErrorData>(r);
  },
  retryPr: async (
    projectId: string,
    data: {
      pending_pr_id: string;
      operation_source?: "user_ui" | "agent";
    },
  ): Promise<GitHubCreatePrResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/pr/retry`,
      {
        method: "POST",
        body: jsonBody({
          pending_pr_id: data.pending_pr_id,
          operation_source: data.operation_source ?? "user_ui",
        }),
      },
    );
    return handleApiResponse<GitHubCreatePrResponse, GitHubErrorData>(r);
  },
  listAudits: async (
    projectId: string,
    params?: { repoId?: string; workItemId?: string },
  ): Promise<GitHubOperationAudit[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/github/audits${qs({
        repo_id: params?.repoId,
        work_item_id: params?.workItemId,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<GitHubOperationAudit[], GitHubErrorData>(r);
  },
};

export const projectWorkItemsApi = {
  list: async (projectId: string): Promise<ProjectWorkItem[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectWorkItem[], GitHubErrorData>(r);
  },
  listBySession: async (
    projectId: string,
    sessionId: string,
  ): Promise<ProjectWorkItem[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/by-session/${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectWorkItem[], GitHubErrorData>(r);
  },
  get: async (
    projectId: string,
    workItemId: string,
    options?: { includeGithubDetail?: boolean },
  ): Promise<ProjectWorkItemDetailResponse> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}${qs({
        include_github_detail: options?.includeGithubDetail,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectWorkItemDetailResponse, GitHubErrorData>(r);
  },
  create: async (
    projectId: string,
    data: Partial<ProjectWorkItem> & { title: string },
  ): Promise<ProjectWorkItem> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectWorkItem, GitHubErrorData>(r);
  },
  update: async (
    projectId: string,
    workItemId: string,
    data: Partial<ProjectWorkItem>,
  ): Promise<ProjectWorkItem> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}`,
      { method: "PUT", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectWorkItem, GitHubErrorData>(r);
  },
  delete: async (projectId: string, workItemId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void, GitHubErrorData>(r);
  },
  linkExecution: async (
    projectId: string,
    workItemId: string,
    data: {
      session_id: string | null;
      workflow_execution_id: string | null;
      workflow_step_id: string | null;
      run_id: string | null;
      link_type: ProjectExecutionLinkType;
    },
  ): Promise<ProjectWorkItemExecutionLink> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}/execution-links`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectWorkItemExecutionLink, GitHubErrorData>(r);
  },
  unlinkExecution: async (
    projectId: string,
    workItemId: string,
    linkId: string,
  ): Promise<void> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}/execution-links/${encodeURIComponent(linkId)}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void, GitHubErrorData>(r);
  },
};

export const deliveryApi = {
  listRecords: async (
    projectId: string,
    params?: { workItemId?: string; repoId?: string },
  ): Promise<ProjectDeliveryRecord[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/delivery-records${qs({
        work_item_id: params?.workItemId,
        repo_id: params?.repoId,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectDeliveryRecord[], GitHubErrorData>(r);
  },
  getStats: async (
    projectId: string,
    params?: { periodStart?: string; periodEnd?: string },
  ): Promise<ProjectDeliveryStatsSummary> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/delivery-stats${qs({
        period_start: params?.periodStart,
        period_end: params?.periodEnd,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ProjectDeliveryStatsSummary, GitHubErrorData>(r);
  },
};

// -----------------------------------------------------------------------------
// Aggregate export (convenience for consumers)
// -----------------------------------------------------------------------------

export const api = {
  system: systemApi,
  agentRuntime: agentRuntimeApi,
  mcpServers: mcpServersApi,
  filesystem: filesystemApi,
  chatSessions: chatSessionsApi,
  chatMessages: chatMessagesApi,
  chatRuns: chatRunsApi,
  chatAgents: chatAgentsApi,
  sessionAgents: sessionAgentsApi,
  skills: skillsApi,
  projects: projectApi,
  projectSourceControl: projectSourceControlApi,
  workflow: workflowApi,
  cliConfig: cliConfigApi,
  buildStats: buildStatsApi,
  profiles: profilesApi,
  githubAuth: githubAuthApi,
  projectGithub: projectGithubApi,
  projectWorkItems: projectWorkItemsApi,
  delivery: deliveryApi,
};
