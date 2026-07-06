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
  ChatMemberQueueResponse,
  ChatQueueListResponse,
  ChatRunActivityResponse,
  ChatRunRetentionListResponse,
  ChatSessionRuntimeSnapshot,
  ChatSessionStatus,
  ChatSessionWorktreeMode,
  Config,
  ConflictFileContent,
  ConflictFileInfo,
  ContinueQueuedMessageResponse,
  CreateChatAgent,
  CreateChatMessageRequest,
  CreateChatSession,
  CreateChatSessionAgentRequest,
  CreateChatSkill,
  DeleteQueuedMessageResponse,
  DirectoryEntry,
  DirectoryListResponse,
  ExecutePlanRequest,
  ExecutePlanResponse,
  GeneratePlanAndRunResponse,
  GitignoreTemplatesResponse,
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
  ProjectWorkItemComment,
  ProjectWorkItemDetailResponse,
  ProjectWorkItemExecutionLink,
  ProfilesContent,
  ResolveActionResponse,
  ResumeExecutionResponse,
  RetryWorkflowPlanGenerationResponse,
  SessionWorkspacesResponse,
  SessionSourceControlStatus,
  SessionWorktree,
  SessionWorktreeMergeResult,
  SourceControlCommitError,
  SourceControlCommitRequest,
  SourceControlCommitResponse,
  SourceControlDiffArea,
  SourceControlDiffRequest,
  SourceControlDiffResponse,
  SourceControlDiscardRequest,
  SourceControlFile,
  SourceControlOperationResponse,
  SourceControlStageRequest,
  SourceControlUnstageRequest,
  TeamProtocolConfig,
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
  WorkflowSessionStatusResponse,
  WorkflowStepTokenUsageResponse,
  WorkflowTranscriptEntry,
  ValidateWorkspacePathResponse,
  WorkspaceGitErrorData,
  WorkspaceChangesResponse,
} from "@/types";

export interface ChatMessageMutationResponse {
  message: BackendChatMessage;
  runtime: ChatSessionRuntimeSnapshot;
}

export interface VersionCheckResponse {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  deploy_mode: string;
  release_url: string;
  release_notes: string | null;
  published_at: string | null;
}

export interface UpdateNpxResponse {
  success: boolean;
  message: string;
}

import type {
  AddProjectMemberRequest,
  ChatTeamPreset,
  ChatSearchQuery,
  ChatSearchResponse,
  CreateProjectRequest,
  CreateTeamPresetRequest,
  InitializeWorkspaceGitRequest,
  InitializeWorkspaceGitResponse,
  Project,
  ProjectDetail,
  ProjectMemberWithRuntime,
  ProjectStats,
  ProjectStatsQuery,
  Repo,
  TeamPresetListResponse,
  UpdateProject,
  UpdateProjectMemberRequest,
  UpdateTeamPresetRequest,
  ChatRunFilesResponse,
  InboxItem,
  InboxItemResponse,
  InboxItemsArchivedResponse,
  InboxItemsMarkedReadResponse,
  InboxItemsQuery,
  InboxItemsResponse,
  InboxSummary,
  InboxSummaryQuery,
  MarkUpgradeReadRequest,
  MarkAllInboxItemsReadRequest,
  MarkInboxItemsReadRequest,
  OnboardingState,
  UpdateOnboardingStateRequest,
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
import { getTauriInvoke } from "./tauriBridge";

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

export const teamPresetsApi = {
  list: async (): Promise<TeamPresetListResponse> => {
    const r = await makeRequest("/api/team-presets", { cache: "no-store" });
    return handleApiResponse<TeamPresetListResponse>(r);
  },
  get: async (teamPresetId: string): Promise<ChatTeamPreset> => {
    const r = await makeRequest(
      `/api/team-presets/${encodeURIComponent(teamPresetId)}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ChatTeamPreset>(r);
  },
  create: async (
    data: CreateTeamPresetRequest,
  ): Promise<ChatTeamPreset> => {
    const r = await makeRequest("/api/team-presets", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<ChatTeamPreset>(r);
  },
  update: async (
    teamPresetId: string,
    data: UpdateTeamPresetRequest,
  ): Promise<ChatTeamPreset> => {
    const r = await makeRequest(
      `/api/team-presets/${encodeURIComponent(teamPresetId)}`,
      { method: "PUT", body: jsonBody(data) },
    );
    return handleApiResponse<ChatTeamPreset>(r);
  },
  delete: async (teamPresetId: string): Promise<void> => {
    const r = await makeRequest(
      `/api/team-presets/${encodeURIComponent(teamPresetId)}`,
      { method: "DELETE" },
    );
    await handleApiResponse<void>(r);
  },
};

// -----------------------------------------------------------------------------
// Onboarding
// -----------------------------------------------------------------------------

export const onboardingApi = {
  getState: async (): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/state", {
      cache: "no-store",
    });
    return handleApiResponse<OnboardingState>(r);
  },
  updateState: async (
    data: UpdateOnboardingStateRequest,
  ): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/state", {
      method: "PUT",
      body: jsonBody(data),
    });
    return handleApiResponse<OnboardingState>(r);
  },
  complete: async (
    data?: UpdateOnboardingStateRequest,
  ): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/complete", {
      method: "POST",
      ...(data ? { body: jsonBody(data) } : {}),
    });
    return handleApiResponse<OnboardingState>(r);
  },
  reset: async (): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/reset", { method: "POST" });
    return handleApiResponse<OnboardingState>(r);
  },
  markUpgradeRead: async (
    data: MarkUpgradeReadRequest,
  ): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/upgrade/read", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<OnboardingState>(r);
  },
  resetUpgradeRead: async (): Promise<OnboardingState> => {
    const r = await makeRequest("/api/onboarding/upgrade/reset", {
      method: "POST",
    });
    return handleApiResponse<OnboardingState>(r);
  },
};

// -----------------------------------------------------------------------------
// Version updates
// -----------------------------------------------------------------------------

export const versionApi = {
  check: async (): Promise<VersionCheckResponse> => {
    const r = await makeRequest("/api/version/check", { cache: "no-store" });
    return handleApiResponse<VersionCheckResponse>(r);
  },
  updateNpx: async (): Promise<UpdateNpxResponse> => {
    const r = await makeRequest("/api/version/update-npx", { method: "POST" });
    return handleApiResponse<UpdateNpxResponse>(r);
  },
  restart: async (): Promise<UpdateNpxResponse> => {
    const r = await makeRequest("/api/version/restart", { method: "POST" });
    return handleApiResponse<UpdateNpxResponse>(r);
  },
};

// -----------------------------------------------------------------------------
// Inbox notifications
// -----------------------------------------------------------------------------

export const inboxApi = {
  getSummary: async (
    query: Partial<InboxSummaryQuery> = {},
  ): Promise<InboxSummary> => {
    const r = await makeRequest(
      `/api/inbox/summary${qs({
        project_id: query.project_id,
        session_id: query.session_id,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<InboxSummary>(r);
  },
  listItems: async (
    query: Partial<InboxItemsQuery> = {},
  ): Promise<InboxItemsResponse> => {
    const r = await makeRequest(
      `/api/inbox/items${qs({
        project_id: query.project_id,
        session_id: query.session_id,
        unread: query.unread,
        archived: query.archived,
        limit: query.limit,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<InboxItemsResponse>(r);
  },
  markRead: async (itemId: string): Promise<InboxItem> => {
    const r = await makeRequest(
      `/api/inbox/items/${encodeURIComponent(itemId)}/mark-read`,
      { method: "POST" },
    );
    const response = await handleApiResponse<InboxItemResponse>(r);
    return response.item;
  },
  markManyRead: async (
    data: MarkInboxItemsReadRequest,
  ): Promise<InboxItemsMarkedReadResponse> => {
    const r = await makeRequest("/api/inbox/items/mark-read", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<InboxItemsMarkedReadResponse>(r);
  },
  markAllRead: async (
    data: MarkAllInboxItemsReadRequest,
  ): Promise<InboxItemsMarkedReadResponse> => {
    const r = await makeRequest("/api/inbox/items/mark-all-read", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<InboxItemsMarkedReadResponse>(r);
  },
  archive: async (itemId: string): Promise<InboxItemsArchivedResponse> => {
    const r = await makeRequest(
      `/api/inbox/items/${encodeURIComponent(itemId)}/archive`,
      { method: "POST" },
    );
    return handleApiResponse<InboxItemsArchivedResponse>(r);
  },
};

// -----------------------------------------------------------------------------
// Filesystem
// -----------------------------------------------------------------------------

export interface SelectDirectoryRequest {
  title?: string;
  initial_directory?: string;
}

export interface SelectDirectoryResponse {
  path: string | null;
  cancelled: boolean;
}

const isSelectDirectoryResponse = (
  value: unknown,
): value is SelectDirectoryResponse => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SelectDirectoryResponse>;
  return (
    typeof candidate.cancelled === "boolean" &&
    (candidate.path === null || typeof candidate.path === "string")
  );
};

const selectDirectoryViaTauri = async (
  data: SelectDirectoryRequest,
): Promise<SelectDirectoryResponse | null> => {
  const invoke = getTauriInvoke();
  if (!invoke) return null;

  const response = await invoke("select_directory_dialog", { payload: data });
  if (!isSelectDirectoryResponse(response)) {
    throw new ApiError("Invalid directory picker response");
  }
  return response;
};

export interface CreateDirectoryRequest {
  parent_path: string;
  name?: string | null;
}

export interface RenameDirectoryRequest {
  path: string;
  name: string;
}

export const filesystemApi = {
  listRoots: async (): Promise<DirectoryEntry[]> => {
    const r = await makeRequest("/api/filesystem/roots");
    return handleApiResponse<DirectoryEntry[]>(r);
  },
  listDirectory: async (path?: string): Promise<DirectoryListResponse> => {
    const r = await makeRequest(`/api/filesystem/directory${qs({ path })}`);
    return handleApiResponse<DirectoryListResponse>(r);
  },
  createDirectory: async (
    data: CreateDirectoryRequest,
  ): Promise<DirectoryEntry> => {
    const r = await makeRequest("/api/filesystem/directory", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<DirectoryEntry>(r);
  },
  renameDirectory: async (
    data: RenameDirectoryRequest,
  ): Promise<DirectoryEntry> => {
    const r = await makeRequest("/api/filesystem/directory", {
      method: "PUT",
      body: jsonBody(data),
    });
    return handleApiResponse<DirectoryEntry>(r);
  },
  listGitRepos: async (path?: string): Promise<DirectoryEntry[]> => {
    const r = await makeRequest(`/api/filesystem/git-repos${qs({ path })}`);
    return handleApiResponse<DirectoryEntry[]>(r);
  },
  selectDirectory: async (
    data: SelectDirectoryRequest = {},
  ): Promise<SelectDirectoryResponse> => {
    const nativeResponse = await selectDirectoryViaTauri(data);
    if (nativeResponse) return nativeResponse;

    const r = await makeRequest("/api/filesystem/select-directory", {
      method: "POST",
      body: jsonBody(data),
    });
    return handleApiResponse<SelectDirectoryResponse>(r);
  },
  openInExplorer: async (
    path: string,
    workspacePath?: string,
    sessionId?: string,
  ): Promise<OpenInExplorerResponse> => {
    const r = await makeRequest("/api/filesystem/open-in-explorer", {
      method: "POST",
      body: JSON.stringify({
        path,
        workspace_path: workspacePath?.trim() ? workspacePath : null,
        session_id: sessionId?.trim() ? sessionId : null,
      }),
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
  validateWorkspacePath: async (
    workspacePath: string,
  ): Promise<ValidateWorkspacePathResponse> => {
    const r = await makeRequest("/api/chat/validate-workspace-path", {
      method: "POST",
      body: JSON.stringify({ workspace_path: workspacePath }),
    });
    return handleApiResponse<ValidateWorkspacePathResponse>(r);
  },
  listGitignoreTemplates: async (): Promise<GitignoreTemplatesResponse> => {
    const r = await makeRequest("/api/chat/gitignore-templates", {
      cache: "no-store",
    });
    return handleApiResponse<GitignoreTemplatesResponse>(r);
  },
  initializeWorkspaceGit: async (
    data: InitializeWorkspaceGitRequest,
  ): Promise<InitializeWorkspaceGitResponse> => {
    const r = await makeRequest("/api/chat/initialize-workspace-git", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return handleApiResponse<
      InitializeWorkspaceGitResponse,
      WorkspaceGitErrorData
    >(r);
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
  pin: async (sessionId: string): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pin`,
      { method: "POST" },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  unpin: async (sessionId: string): Promise<BackendChatSession> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/unpin`,
      { method: "POST" },
    );
    return handleApiResponse<BackendChatSession>(r);
  },
  getTeamProtocol: async (sessionId: string): Promise<TeamProtocolConfig> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/team-protocol`,
    );
    return handleApiResponse<TeamProtocolConfig>(r);
  },
  updateTeamProtocol: async (
    sessionId: string,
    data: TeamProtocolConfig,
  ): Promise<TeamProtocolConfig> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/team-protocol`,
      {
        method: "POST",
        body: jsonBody(data),
      },
    );
    return handleApiResponse<TeamProtocolConfig>(r);
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

export const chatSearchApi = {
  search: async (
    params: ChatSearchQuery = {},
  ): Promise<ChatSearchResponse> => {
    const r = await makeRequest(
      `/api/chat/search${qs({
        project_id: params.project_id,
        q: params.q,
        mode: params.mode,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ChatSearchResponse>(r);
  },
};

export const chatQueuesApi = {
  listSession: async (sessionId: string): Promise<ChatQueueListResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/queue`,
      { cache: "no-store" },
    );
    return handleApiResponse<ChatQueueListResponse>(r);
  },
  listMember: async (
    sessionId: string,
    sessionAgentId: string,
  ): Promise<ChatMemberQueueResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(
        sessionAgentId,
      )}/queue`,
      { cache: "no-store" },
    );
    return handleApiResponse<ChatMemberQueueResponse>(r);
  },
  deleteQueued: async (
    sessionId: string,
    queueId: string,
  ): Promise<DeleteQueuedMessageResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(
        queueId,
      )}`,
      { method: "DELETE" },
    );
    return handleApiResponse<DeleteQueuedMessageResponse>(r);
  },
  continueMember: async (
    sessionId: string,
    sessionAgentId: string,
  ): Promise<ContinueQueuedMessageResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(
        sessionAgentId,
      )}/queue/continue`,
      { method: "POST" },
    );
    return handleApiResponse<ContinueQueuedMessageResponse>(r);
  },
};

export const chatRuntimeApi = {
  getSnapshot: async (
    sessionId: string,
    options?: { includeMessages?: boolean },
  ): Promise<ChatSessionRuntimeSnapshot> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/runtime${qs({
        include_messages: options?.includeMessages,
      })}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ChatSessionRuntimeSnapshot>(r);
  },
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
  ): Promise<ChatMessageMutationResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: JSON.stringify(data) },
    );
    return handleApiResponse<ChatMessageMutationResponse>(r);
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
      appLanguage?: string;
      referenceMessageId?: string;
      mentions?: string[];
    },
  ): Promise<ChatMessageMutationResponse> => {
    const form = new FormData();
    for (const file of Array.isArray(files) ? files : [files]) {
      form.append("file", file, file.name);
    }
    if (options?.content) {
      form.append("content", options.content);
    }
    if (options?.appLanguage) {
      form.append("app_language", options.appLanguage);
    }
    if (options?.referenceMessageId) {
      form.append("reference_message_id", options.referenceMessageId);
    }
    if (options?.mentions && options.mentions.length > 0) {
      form.append("mentions", JSON.stringify(options.mentions));
    }
    if (options?.chatInputMode === "workflow") {
      form.append("chat_input_mode", "workflow");
    }
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/upload`,
      { method: "POST", body: form },
    );
    return handleApiResponse<ChatMessageMutationResponse>(r);
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
  /**
   * Structured per-run changed-file list (modified / added / deleted /
   * untracked) with `+`/`-` counts. The per-run counterpart of the
   * session-level workspace-changes endpoint. Pass `includeDiff: true` to also
   * receive inline unified-diff text for each file.
   */
  getFiles: async (
    runId: string,
    opts?: { includeDiff?: boolean },
  ): Promise<ChatRunFilesResponse> => {
    const r = await makeRequest(
      `/api/chat/runs/${encodeURIComponent(runId)}/files${qs({
        include_diff: opts?.includeDiff,
      })}`,
    );
    return handleApiResponse<ChatRunFilesResponse>(r);
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
  getSessionStatus: async (
    sessionId: string,
  ): Promise<WorkflowSessionStatusResponse> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/status`,
      { method: "GET" },
    );
    return handleApiResponse<WorkflowSessionStatusResponse>(r);
  },
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
      entryType?: string;
      unresolved?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<WorkflowTranscriptEntry[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/workflow/executions/${encodeURIComponent(
        executionId,
      )}/transcripts${qs({
        step_id: opts?.stepId,
        step_key: opts?.stepKey,
        workflow_agent_session_id: opts?.workflowAgentSessionId,
        entry_type: opts?.entryType,
        unresolved: opts?.unresolved,
        limit: opts?.limit,
        offset: opts?.offset,
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

// Local request type for creating a project-scoped session. Uses the frontend
// `ChatSessionWorktreeMode` string union (not the shared enum) so callers that
// import from `@/types` can pass `worktree_mode` without a cast.
export type CreateProjectSessionRequest = {
  title: string | null;
  workspace_path: string | null;
  worktree_mode?: ChatSessionWorktreeMode;
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
      { cache: "no-store" },
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
// Session worktree isolation
// -----------------------------------------------------------------------------
// Wraps `/api/chat/sessions/{session_id}/worktree/*`. The backend is the only
// legal writer of `chat_session_worktrees.status`; these helpers are thin
// pass-throughs so the UI stays in lock-step with the reducer's accepted
// state transitions. See docs/session-worktree-isolation-design.md.

export interface PrepareSessionWorktreeRequest {
  base_workspace_path?: string | null;
}

export interface MergeSessionWorktreeRequest {
  commit_message?: string | null;
  target_branch?: string | null;
}

export interface ResolveSessionWorktreeConflictRequest {
  path: string;
  content?: string | null;
  use_stage?: 'current' | 'session' | null;
  delete_file?: boolean;
}

export interface ContinueSessionWorktreeMergeRequest {
  commit_message?: string | null;
}

export const chatSessionWorktreeApi = {
  getStatus: async (
    sessionId: string,
  ): Promise<SessionWorktree | null> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree`,
      { cache: "no-store" },
    );
    return handleApiResponse<SessionWorktree | null>(r);
  },
  prepare: async (
    sessionId: string,
    request: PrepareSessionWorktreeRequest = {},
  ): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  merge: async (
    sessionId: string,
    request: MergeSessionWorktreeRequest = {},
  ): Promise<SessionWorktreeMergeResult> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree/merge`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SessionWorktreeMergeResult>(r);
  },
  discard: async (sessionId: string): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree/discard`,
      { method: "POST" },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  cleanup: async (sessionId: string): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree/cleanup`,
      { method: "POST" },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  retryCleanup: async (sessionId: string): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(
        sessionId,
      )}/worktree/retry-cleanup`,
      { method: "POST" },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  forceRemove: async (sessionId: string): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(
        sessionId,
      )}/worktree/force-remove`,
      { method: "POST" },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  listMergeConflicts: async (
    sessionId: string,
  ): Promise<ConflictFileInfo[]> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(
        sessionId,
      )}/worktree/merge-conflicts`,
      { cache: "no-store" },
    );
    return handleApiResponse<ConflictFileInfo[]>(r);
  },
  getMergeConflictDetail: async (
    sessionId: string,
    filePath: string,
  ): Promise<ConflictFileContent> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(
        sessionId,
      )}/worktree/merge-conflicts/${encodeConflictPath(filePath)}`,
      { cache: "no-store" },
    );
    return handleApiResponse<ConflictFileContent>(r);
  },
  resolveMergeConflict: async (
    sessionId: string,
    request: ResolveSessionWorktreeConflictRequest,
  ): Promise<void> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(
        sessionId,
      )}/worktree/merge-conflicts/resolve`,
      { method: "POST", body: jsonBody(request) },
    );
    await handleApiResponse<void>(r);
  },
  continueMerge: async (
    sessionId: string,
    request: ContinueSessionWorktreeMergeRequest = {},
  ): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree/merge/continue`,
      { method: "POST", body: jsonBody(request) },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
  abortMerge: async (sessionId: string): Promise<SessionWorktree> => {
    const r = await makeRequest(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/worktree/merge/abort`,
      { method: "POST" },
    );
    return handleApiResponse<SessionWorktree>(r);
  },
};

// `merge-conflicts/{*file_path}` is a catch-all on the backend, so encode each
// path segment while preserving the `/` separators for nested files such as
// `src/main.rs`. Empty paths fall back to `/` so the request shape stays valid.
const encodeConflictPath = (filePath: string): string =>
  filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/") || "/";

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
  comment: async (
    projectId: string,
    workItemId: string,
    body: string,
  ): Promise<ProjectWorkItemComment> => {
    const r = await makeRequest(
      `/api/projects/${encodeURIComponent(projectId)}/work-items/${encodeURIComponent(
        workItemId,
      )}/comments`,
      { method: "POST", body: jsonBody({ body }) },
    );
    return handleApiResponse<ProjectWorkItemComment, GitHubErrorData>(r);
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
  chatQueues: chatQueuesApi,
  chatRuntime: chatRuntimeApi,
  chatMessages: chatMessagesApi,
  chatSearch: chatSearchApi,
  chatRuns: chatRunsApi,
  chatAgents: chatAgentsApi,
  sessionAgents: sessionAgentsApi,
  skills: skillsApi,
  projects: projectApi,
  projectSourceControl: projectSourceControlApi,
  chatSessionWorktree: chatSessionWorktreeApi,
  workflow: workflowApi,
  cliConfig: cliConfigApi,
  buildStats: buildStatsApi,
  onboarding: onboardingApi,
  version: versionApi,
  inbox: inboxApi,
  profiles: profilesApi,
  teamPresets: teamPresetsApi,
  githubAuth: githubAuthApi,
  projectGithub: projectGithubApi,
  projectWorkItems: projectWorkItemsApi,
  delivery: deliveryApi,
};
