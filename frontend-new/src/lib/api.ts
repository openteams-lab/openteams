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
  InstalledNativeSkill,
  InterruptStepResponse,
  OpenInExplorerResponse,
  PauseAllResponse,
  ProfilesContent,
  ResolveActionResponse,
  ResumeExecutionResponse,
  SessionWorkspacesResponse,
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
  WorkflowCardProjection,
  WorkflowTranscriptEntry,
  WorkspaceChangesResponse,
} from "@/types";
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  CreateProjectSessionRequest,
  Project,
  ProjectDetail,
  ProjectMember,
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
    options?: { content?: string; referenceMessageId?: string },
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
  list: async (): Promise<BackendChatAgent[]> => {
    const r = await makeRequest("/api/chat/agents");
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
      { method: "POST" },
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
      { method: "POST" },
    );
    return handleApiResponse<WorkflowTranscriptEntry[]>(r);
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
  listMembers: async (projectId: string): Promise<ProjectMember[]> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members`,
    );
    return handleApiResponse<ProjectMember[]>(r);
  },
  addMember: async (
    projectId: string,
    data: AddProjectMemberRequest,
  ): Promise<ProjectMember> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members`,
      { method: "POST", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectMember>(r);
  },
  updateMember: async (
    projectId: string,
    memberId: string,
    data: UpdateProjectMemberRequest,
  ): Promise<ProjectMember> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(
        memberId,
      )}`,
      { method: "PUT", body: jsonBody(data) },
    );
    return handleApiResponse<ProjectMember>(r);
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

// -----------------------------------------------------------------------------
// Aggregate export (convenience for consumers)
// -----------------------------------------------------------------------------

export const api = {
  system: systemApi,
  agentRuntime: agentRuntimeApi,
  filesystem: filesystemApi,
  chatSessions: chatSessionsApi,
  chatMessages: chatMessagesApi,
  chatRuns: chatRunsApi,
  chatAgents: chatAgentsApi,
  sessionAgents: sessionAgentsApi,
  skills: skillsApi,
  projects: projectApi,
  workflow: workflowApi,
  cliConfig: cliConfigApi,
  buildStats: buildStatsApi,
  profiles: profilesApi,
};
