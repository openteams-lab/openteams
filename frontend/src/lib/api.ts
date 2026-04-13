// Import all necessary types from shared types

import {
  ApprovalStatus,
  ApiResponse,
  Config,
  EditorType,
  CreateTag,
  DirectoryListResponse,
  DirectoryEntry,
  Tag,
  TagSearchParams,
  UpdateTag,
  UserSystemInfo,
  McpServerQuery,
  UpdateMcpServersBody,
  GetMcpServerResponse,
  ImageResponse,
  JsonValue,
  ApprovalResponse,
  CheckEditorAvailabilityResponse,
  AvailabilityInfo,
  BaseCodingAgent,
  Scratch,
  ScratchType,
  CreateScratch,
  UpdateScratch,
  ChatSession,
  ChatSessionStatus,
  ChatMessage,
  TeamProtocolConfig,
  ChatAgent,
  ChatSenderType,
  ChatWorkItem,
  CreateChatAgent,
  CreateChatSession,
  UpdateChatSession,
  CreateChatMessageRequest,
  ChatSessionAgent,
  CreateChatSessionAgentRequest,
  UpdateChatSessionAgentRequest,
  SessionWorkspace,
  SessionWorkspacesResponse,
  WorkspaceChangesResponse,
  UpdateChatAgent,
  ChatSkill,
  CreateChatSkill,
  UpdateChatSkill,
  InstalledNativeSkill,
  UpdateNativeSkillRequest,
  ChatAgentSkill,
  AssignSkillToAgent,
  UpdateAgentSkill,
  RemoteSkillMeta,
  RemoteSkillPackage,
  SkillCategory,
  ChatRunRetentionInfo,
} from 'shared/types';
import type {
  CliConfig,
  CustomProviderEntry,
  CliModelInfo,
  CliProviderId,
  CliProviderInfo,
  RestartCliResponse,
  ValidateCliProviderRequest,
  ValidateCliProviderResponse,
  SyncToCliRequest,
  SyncToCliResponse,
} from '@/types/cliConfig';

export interface AgentInfo {
  id: string;
  name: string;
}

export interface VersionCheckInfo {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  deploy_mode: 'npx' | 'tauri' | 'unknown';
  release_url: string;
  release_notes: string | null;
  published_at: string | null;
}

export interface VersionUpdateResult {
  success: boolean;
  message: string;
}

export interface OpenInExplorerResponse {
  ok: boolean;
  error?: string | null;
}

export class ApiError<E = unknown> extends Error {
  public status?: number;
  public error_data?: E;

  constructor(
    message: string,
    public statusCode?: number,
    public response?: Response,
    error_data?: E
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = statusCode;
    this.error_data = error_data;
  }
}

const makeRequest = async (url: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
};

export type Ok<T> = { success: true; data: T };
export type Err<E> = { success: false; error: E | undefined; message?: string };

// Result type for endpoints that need typed errors
export type Result<T, E> = Ok<T> | Err<E>;

interface BuiltinSkillsStats {
  total_skills: number;
  categories: string[];
}

export const handleApiResponse = async <T, E = T>(
  response: Response
): Promise<T> => {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // Fallback to status text if JSON parsing fails
      errorMessage = response.statusText || errorMessage;
    }

    console.error('[API Error]', {
      message: errorMessage,
      status: response.status,
      response,
      endpoint: response.url,
      timestamp: new Date().toISOString(),
    });
    throw new ApiError<E>(errorMessage, response.status, response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const result: ApiResponse<T, E> = await response.json();

  if (!result.success) {
    // Check for error_data first (structured errors), then fall back to message
    if (result.error_data) {
      console.error('[API Error with data]', {
        error_data: result.error_data,
        message: result.message,
        status: response.status,
        response,
        endpoint: response.url,
        timestamp: new Date().toISOString(),
      });
      // Throw a properly typed error with the error data
      throw new ApiError<E>(
        result.message || 'API request failed',
        response.status,
        response,
        result.error_data
      );
    }

    console.error('[API Error]', {
      message: result.message || 'API request failed',
      status: response.status,
      response,
      endpoint: response.url,
      timestamp: new Date().toISOString(),
    });
    throw new ApiError<E>(
      result.message || 'API request failed',
      response.status,
      response
    );
  }

  return result.data as T;
};

// File System APIs
export const fileSystemApi = {
  listRoots: async (): Promise<DirectoryEntry[]> => {
    const response = await makeRequest('/api/filesystem/roots');
    return handleApiResponse<DirectoryEntry[]>(response);
  },

  list: async (path?: string): Promise<DirectoryListResponse> => {
    const queryParam = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await makeRequest(
      `/api/filesystem/directory${queryParam}`
    );
    return handleApiResponse<DirectoryListResponse>(response);
  },

  listGitRepos: async (path?: string): Promise<DirectoryEntry[]> => {
    const queryParam = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await makeRequest(
      `/api/filesystem/git-repos${queryParam}`
    );
    return handleApiResponse<DirectoryEntry[]>(response);
  },

  openInExplorer: async (path: string): Promise<OpenInExplorerResponse> => {
    const response = await makeRequest('/api/filesystem/open-in-explorer', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new ApiError(
        response.statusText || 'Failed to open path in explorer',
        response.status,
        response
      );
    }

    return response.json() as Promise<OpenInExplorerResponse>;
  },
};

// Config APIs (backwards compatible)
export const configApi = {
  getConfig: async (): Promise<UserSystemInfo> => {
    const response = await makeRequest('/api/info', { cache: 'no-store' });
    return handleApiResponse<UserSystemInfo>(response);
  },
  saveConfig: async (config: Config): Promise<Config> => {
    const response = await makeRequest('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    return handleApiResponse<Config>(response);
  },
  checkEditorAvailability: async (
    editorType: EditorType
  ): Promise<CheckEditorAvailabilityResponse> => {
    const response = await makeRequest(
      `/api/editors/check-availability?editor_type=${encodeURIComponent(editorType)}`
    );
    return handleApiResponse<CheckEditorAvailabilityResponse>(response);
  },
  checkAgentAvailability: async (
    agent: BaseCodingAgent
  ): Promise<AvailabilityInfo> => {
    const response = await makeRequest(
      `/api/agents/check-availability?executor=${encodeURIComponent(agent)}`
    );
    return handleApiResponse<AvailabilityInfo>(response);
  },
};

// Task Tags APIs (all tags are global)
export const tagsApi = {
  list: async (params?: TagSearchParams): Promise<Tag[]> => {
    const queryParam = params?.search
      ? `?search=${encodeURIComponent(params.search)}`
      : '';
    const response = await makeRequest(`/api/tags${queryParam}`);
    return handleApiResponse<Tag[]>(response);
  },

  create: async (data: CreateTag): Promise<Tag> => {
    const response = await makeRequest('/api/tags', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Tag>(response);
  },

  update: async (tagId: string, data: UpdateTag): Promise<Tag> => {
    const response = await makeRequest(`/api/tags/${tagId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Tag>(response);
  },

  delete: async (tagId: string): Promise<void> => {
    const response = await makeRequest(`/api/tags/${tagId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },
};

// MCP Servers APIs
export const mcpServersApi = {
  load: async (query: McpServerQuery): Promise<GetMcpServerResponse> => {
    const params = new URLSearchParams(query);
    const response = await makeRequest(`/api/mcp-config?${params.toString()}`);
    return handleApiResponse<GetMcpServerResponse>(response);
  },
  save: async (
    query: McpServerQuery,
    data: UpdateMcpServersBody
  ): Promise<void> => {
    const params = new URLSearchParams(query);
    // params.set('profile', profile);
    const response = await makeRequest(`/api/mcp-config?${params.toString()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[API Error] Failed to save MCP servers', {
        message: errorData.message,
        status: response.status,
        response,
        timestamp: new Date().toISOString(),
      });
      throw new ApiError(
        errorData.message || 'Failed to save MCP servers',
        response.status,
        response
      );
    }
  },
};

export const cliConfigApi = {
  getConfig: async (): Promise<CliConfig> => {
    const response = await makeRequest('/api/config/cli');
    return handleApiResponse<CliConfig>(response);
  },

  updateConfig: async (data: CliConfig): Promise<CliConfig> => {
    const response = await makeRequest('/api/config/cli', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<CliConfig>(response);
  },

  listProviders: async (): Promise<CliProviderInfo[]> => {
    const response = await makeRequest('/api/config/cli/providers');
    return handleApiResponse<CliProviderInfo[]>(response);
  },

  listProviderModels: async (
    provider: CliProviderId
  ): Promise<CliModelInfo[]> => {
    const response = await makeRequest(
      `/api/config/cli/providers/${encodeURIComponent(provider)}/models`
    );
    return handleApiResponse<CliModelInfo[]>(response);
  },

  validateProvider: async (
    provider: CliProviderId,
    data: ValidateCliProviderRequest
  ): Promise<ValidateCliProviderResponse> => {
    const response = await makeRequest(
      `/api/config/cli/providers/${encodeURIComponent(provider)}/validate`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ValidateCliProviderResponse>(response);
  },

  syncToCli: async (data?: SyncToCliRequest): Promise<SyncToCliResponse> => {
    const response = await makeRequest('/api/config/cli/sync-to-cli', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
    return handleApiResponse<SyncToCliResponse>(response);
  },

  restartCliService: async (): Promise<RestartCliResponse> => {
    const response = await makeRequest('/api/config/cli/restart-service', {
      method: 'POST',
    });
    return handleApiResponse<RestartCliResponse>(response);
  },

  listCustomProviders: async (): Promise<CustomProviderEntry[]> => {
    const response = await makeRequest('/api/config/cli/custom-providers');
    return handleApiResponse<CustomProviderEntry[]>(response);
  },

  createCustomProvider: async (
    provider: CustomProviderEntry
  ): Promise<CustomProviderEntry> => {
    const response = await makeRequest('/api/config/cli/custom-providers', {
      method: 'POST',
      body: JSON.stringify(provider),
    });
    return handleApiResponse<CustomProviderEntry>(response);
  },

  updateCustomProvider: async (
    id: string,
    provider: CustomProviderEntry
  ): Promise<CustomProviderEntry> => {
    const response = await makeRequest(
      `/api/config/cli/custom-providers/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(provider),
      }
    );
    return handleApiResponse<CustomProviderEntry>(response);
  },

  deleteCustomProvider: async (id: string): Promise<void> => {
    const response = await makeRequest(
      `/api/config/cli/custom-providers/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    await handleApiResponse<void>(response);
  },
};

// Profiles API
export const profilesApi = {
  load: async (): Promise<{ content: string; path: string }> => {
    const response = await makeRequest('/api/profiles');
    return handleApiResponse<{ content: string; path: string }>(response);
  },
  save: async (content: string): Promise<string> => {
    const response = await makeRequest('/api/profiles', {
      method: 'PUT',
      body: content,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return handleApiResponse<string>(response);
  },
};

// Images API
export const imagesApi = {
  upload: async (file: File): Promise<ImageResponse> => {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('/api/images/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Failed to upload image: ${errorText}`,
        response.status,
        response
      );
    }

    return handleApiResponse<ImageResponse>(response);
  },

  uploadForTask: async (taskId: string, file: File): Promise<ImageResponse> => {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`/api/images/task/${taskId}/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Failed to upload image: ${errorText}`,
        response.status,
        response
      );
    }

    return handleApiResponse<ImageResponse>(response);
  },

  delete: async (imageId: string): Promise<void> => {
    const response = await makeRequest(`/api/images/${imageId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  getTaskImages: async (taskId: string): Promise<ImageResponse[]> => {
    const response = await makeRequest(`/api/images/task/${taskId}`);
    return handleApiResponse<ImageResponse[]>(response);
  },

  getImageUrl: (imageId: string): string => {
    return `/api/images/${imageId}/file`;
  },
};

// Approval API
export const approvalsApi = {
  respond: async (
    approvalId: string,
    payload: ApprovalResponse,
    signal?: AbortSignal
  ): Promise<ApprovalStatus> => {
    const res = await makeRequest(`/api/approvals/${approvalId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    return handleApiResponse<ApprovalStatus>(res);
  },
};
// Scratch API
export const scratchApi = {
  create: async (
    scratchType: ScratchType,
    id: string,
    data: CreateScratch
  ): Promise<Scratch> => {
    const response = await makeRequest(`/api/scratch/${scratchType}/${id}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Scratch>(response);
  },

  get: async (scratchType: ScratchType, id: string): Promise<Scratch> => {
    const response = await makeRequest(`/api/scratch/${scratchType}/${id}`);
    return handleApiResponse<Scratch>(response);
  },

  update: async (
    scratchType: ScratchType,
    id: string,
    data: UpdateScratch
  ): Promise<void> => {
    const response = await makeRequest(`/api/scratch/${scratchType}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<void>(response);
  },

  delete: async (scratchType: ScratchType, id: string): Promise<void> => {
    const response = await makeRequest(`/api/scratch/${scratchType}/${id}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  getStreamUrl: (scratchType: ScratchType, id: string): string =>
    `/api/scratch/${scratchType}/${id}/stream/ws`,
};

// Agents API
export const agentsApi = {
  getSlashCommandsStreamUrl: (
    agent: BaseCodingAgent,
    opts?: { workspaceId?: string; repoId?: string }
  ): string => {
    const params = new URLSearchParams();
    params.set('executor', agent);
    if (opts?.workspaceId) params.set('workspace_id', opts.workspaceId);
    if (opts?.repoId) params.set('repo_id', opts.repoId);

    return `/api/agents/slash-commands/ws?${params.toString()}`;
  },
};

// Migration API
export const versionApi = {
  check: async (): Promise<VersionCheckInfo> => {
    const response = await makeRequest('/api/version/check');
    return handleApiResponse<VersionCheckInfo>(response);
  },

  updateNpx: async (): Promise<VersionUpdateResult> => {
    const response = await makeRequest('/api/version/update-npx', {
      method: 'POST',
    });
    return handleApiResponse<VersionUpdateResult>(response);
  },

  restart: async (): Promise<VersionUpdateResult> => {
    const response = await makeRequest('/api/version/restart', {
      method: 'POST',
    });
    return handleApiResponse<VersionUpdateResult>(response);
  },
};

// Chat APIs
export const chatApi = {
  listSessions: async (status?: ChatSessionStatus): Promise<ChatSession[]> => {
    const queryParam = status ? `?status=${encodeURIComponent(status)}` : '';
    const response = await makeRequest(`/api/chat/sessions${queryParam}`);
    return handleApiResponse<ChatSession[]>(response);
  },

  getSession: async (sessionId: string): Promise<ChatSession> => {
    const response = await makeRequest(`/api/chat/sessions/${sessionId}`);
    return handleApiResponse<ChatSession>(response);
  },

  createSession: async (data: CreateChatSession): Promise<ChatSession> => {
    const response = await makeRequest('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatSession>(response);
  },

  updateSession: async (
    sessionId: string,
    data: UpdateChatSession
  ): Promise<ChatSession> => {
    const response = await makeRequest(`/api/chat/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatSession>(response);
  },

  markDiffSeen: async (
    sessionId: string,
    diffKey: string
  ): Promise<ChatSession> => {
    const response = await makeRequest(`/api/chat/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: null,
        status: null,
        summary_text: null,
        archive_ref: null,
        last_seen_diff_key: diffKey,
        team_protocol: null,
        team_protocol_enabled: null,
        default_workspace_path: null,
      }),
    });
    return handleApiResponse<ChatSession>(response);
  },

  archiveSession: async (sessionId: string): Promise<ChatSession> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/archive`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<ChatSession>(response);
  },

  restoreSession: async (sessionId: string): Promise<ChatSession> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/restore`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<ChatSession>(response);
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    const response = await makeRequest(`/api/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  uploadChatAttachments: async (
    sessionId: string,
    files: File[],
    options?: {
      senderHandle?: string;
      content?: string;
      referenceMessageId?: string;
      appLanguage?: string;
    }
  ): Promise<ChatMessage> => {
    const form = new FormData();
    files.forEach((file) => {
      form.append('file', file, file.name);
    });
    if (options?.senderHandle) {
      form.append('sender_handle', options.senderHandle);
    }
    if (options?.content) {
      form.append('content', options.content);
    }
    if (options?.referenceMessageId) {
      form.append('reference_message_id', options.referenceMessageId);
    }
    if (options?.appLanguage) {
      form.append('app_language', options.appLanguage);
    }

    const response = await fetch(
      `/api/chat/sessions/${sessionId}/messages/upload`,
      {
        method: 'POST',
        body: form,
      }
    );
    return handleApiResponse<ChatMessage>(response);
  },

  getChatAttachmentUrl: (
    sessionId: string,
    messageId: string,
    attachmentId: string
  ): string =>
    `/api/chat/sessions/${sessionId}/messages/${messageId}/attachments/${attachmentId}`,

  listMessages: async (
    sessionId: string,
    limit?: number
  ): Promise<ChatMessage[]> => {
    const queryParam = limit ? `?limit=${limit}` : '';
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/messages${queryParam}`
    );
    return handleApiResponse<ChatMessage[]>(response);
  },

  listWorkItems: async (
    sessionId: string,
    limit?: number
  ): Promise<ChatWorkItem[]> => {
    const queryParam = limit ? `?limit=${limit}` : '';
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/work-items${queryParam}`
    );
    return handleApiResponse<ChatWorkItem[]>(response);
  },

  createMessage: async (
    sessionId: string,
    data: CreateChatMessageRequest
  ): Promise<ChatMessage> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ChatMessage>(response);
  },

  deleteMessage: async (messageId: string): Promise<void> => {
    const response = await makeRequest(`/api/chat/messages/${messageId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  resendMessage: async (
    sessionId: string,
    messageId: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/messages/${messageId}/resend`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },

  getTeamProtocol: async (sessionId: string): Promise<TeamProtocolConfig> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/team-protocol`
    );
    return handleApiResponse<TeamProtocolConfig>(response);
  },

  updateTeamProtocol: async (
    sessionId: string,
    data: TeamProtocolConfig
  ): Promise<TeamProtocolConfig> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/team-protocol`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<TeamProtocolConfig>(response);
  },

  deleteMessagesBatch: async (
    sessionId: string,
    messageIds: string[]
  ): Promise<number> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/messages/batch-delete`,
      {
        method: 'POST',
        body: JSON.stringify({ message_ids: messageIds }),
      }
    );
    return handleApiResponse<number>(response);
  },

  listAgents: async (): Promise<ChatAgent[]> => {
    const response = await makeRequest('/api/chat/agents');
    return handleApiResponse<ChatAgent[]>(response);
  },

  createAgent: async (data: CreateChatAgent): Promise<ChatAgent> => {
    const response = await makeRequest('/api/chat/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatAgent>(response);
  },

  updateAgent: async (
    agentId: string,
    data: UpdateChatAgent
  ): Promise<ChatAgent> => {
    const response = await makeRequest(`/api/chat/agents/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatAgent>(response);
  },

  listSessionAgents: async (sessionId: string): Promise<ChatSessionAgent[]> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/agents`
    );
    return handleApiResponse<ChatSessionAgent[]>(response);
  },

  createSessionAgent: async (
    sessionId: string,
    data: CreateChatSessionAgentRequest
  ): Promise<ChatSessionAgent> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/agents`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ChatSessionAgent>(response);
  },

  updateSessionAgent: async (
    sessionId: string,
    sessionAgentId: string,
    data: UpdateChatSessionAgentRequest
  ): Promise<ChatSessionAgent> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/agents/${sessionAgentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ChatSessionAgent>(response);
  },

  deleteSessionAgent: async (
    sessionId: string,
    sessionAgentId: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/agents/${sessionAgentId}`,
      {
        method: 'DELETE',
      }
    );
    return handleApiResponse<void>(response);
  },

  getSessionWorkspaces: async (
    sessionId: string
  ): Promise<SessionWorkspace[]> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/workspaces`
    );
    const data = await handleApiResponse<SessionWorkspacesResponse>(response);
    return data?.workspaces ?? [];
  },

  getSessionWorkspaceChanges: async (
    sessionId: string,
    workspacePath: string,
    options?: { includeDiff?: boolean }
  ): Promise<WorkspaceChangesResponse> => {
    const params = new URLSearchParams({
      path: workspacePath,
    });
    if (options?.includeDiff !== undefined) {
      params.set('include_diff', String(options.includeDiff));
    }
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/workspaces/changes?${params.toString()}`
    );
    return handleApiResponse<WorkspaceChangesResponse>(response);
  },

  getStreamUrl: (sessionId: string): string =>
    `/api/chat/sessions/${sessionId}/stream`,

  getRunDiffUrl: (runId: string): string => `/api/chat/runs/${runId}/diff`,

  getRunDiff: async (runId: string): Promise<string> => {
    const response = await makeRequest(`/api/chat/runs/${runId}/diff`);
    if (!response.ok) {
      throw new ApiError(
        response.statusText || 'Failed to fetch run diff',
        response.status,
        response
      );
    }
    return response.text();
  },

  getRunUntrackedFile: async (runId: string, path: string): Promise<string> => {
    const response = await makeRequest(
      `/api/chat/runs/${runId}/untracked?path=${encodeURIComponent(path)}`
    );
    if (!response.ok) {
      throw new ApiError(
        response.statusText || 'Failed to fetch untracked file',
        response.status,
        response
      );
    }
    return response.text();
  },

  getSessionRunsRetention: async (
    sessionId: string,
    runIds?: string[]
  ): Promise<ChatRunRetentionInfo[]> => {
    const params = new URLSearchParams();
    if (runIds && runIds.length > 0) {
      params.set('run_ids', runIds.join(','));
    }
    const query = params.toString();
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/runs/retention${query ? `?${query}` : ''}`
    );
    const data = await handleApiResponse<{ runs: ChatRunRetentionInfo[] }>(
      response
    );
    return data?.runs ?? [];
  },

  getRunLog: async (
    runId: string,
    options?: { offset?: number; limit?: number; tail?: boolean }
  ): Promise<string> => {
    const params = new URLSearchParams();
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.tail !== undefined) {
      params.set('tail', String(options.tail));
    }
    if (!params.has('limit')) {
      params.set('limit', '262144');
    }
    if (!params.has('tail') && !params.has('offset')) {
      params.set('tail', 'true');
    }
    const query = params.toString();
    const response = await makeRequest(
      `/api/chat/runs/${runId}/log${query ? `?${query}` : ''}`
    );
    if (!response.ok) {
      let errorMessage = response.statusText || 'Failed to fetch run log';
      try {
        const errorData = await response.clone().json();
        if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // keep statusText fallback
      }
      throw new ApiError(errorMessage, response.status, response);
    }
    return response.text();
  },

  stopSessionAgent: async (
    sessionId: string,
    sessionAgentId: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/chat/sessions/${sessionId}/agents/${sessionAgentId}/stop`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },

  buildCreateMessageRequest: (
    content: string,
    meta?: JsonValue | null
  ): CreateChatMessageRequest => ({
    sender_type: ChatSenderType.user,
    sender_id: null,
    content,
    meta: meta ?? null,
  }),

  // ─── Skills ───

  listSkills: async (): Promise<ChatSkill[]> => {
    const response = await makeRequest('/api/chat/skills');
    return handleApiResponse<ChatSkill[]>(response);
  },

  listNativeSkills: async (
    runnerType: string
  ): Promise<InstalledNativeSkill[]> => {
    const response = await makeRequest(
      `/api/chat/skills/native/${encodeURIComponent(runnerType)}`
    );
    return handleApiResponse<InstalledNativeSkill[]>(response);
  },

  updateNativeSkill: async (
    runnerType: string,
    skillId: string,
    enabled: boolean
  ): Promise<InstalledNativeSkill> => {
    const payload: UpdateNativeSkillRequest = { enabled };
    const response = await makeRequest(
      `/api/chat/skills/native/${encodeURIComponent(runnerType)}/${skillId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
    return handleApiResponse<InstalledNativeSkill>(response);
  },

  getSkill: async (skillId: string): Promise<ChatSkill> => {
    const response = await makeRequest(`/api/chat/skills/${skillId}`);
    return handleApiResponse<ChatSkill>(response);
  },

  createSkill: async (data: CreateChatSkill): Promise<ChatSkill> => {
    const response = await makeRequest('/api/chat/skills', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatSkill>(response);
  },

  updateSkill: async (
    skillId: string,
    data: UpdateChatSkill
  ): Promise<ChatSkill> => {
    const response = await makeRequest(`/api/chat/skills/${skillId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<ChatSkill>(response);
  },

  deleteSkill: async (skillId: string): Promise<void> => {
    const response = await makeRequest(`/api/chat/skills/${skillId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  // ─── Agent-Skill Assignments ───

  listAgentSkills: async (agentId: string): Promise<ChatAgentSkill[]> => {
    const response = await makeRequest(`/api/chat/agents/${agentId}/skills`);
    return handleApiResponse<ChatAgentSkill[]>(response);
  },

  assignSkillToAgent: async (
    data: AssignSkillToAgent
  ): Promise<ChatAgentSkill> => {
    const response = await makeRequest(
      `/api/chat/agents/${data.agent_id}/skills`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ChatAgentSkill>(response);
  },

  updateAgentSkill: async (
    agentId: string,
    assignmentId: string,
    data: UpdateAgentSkill
  ): Promise<ChatAgentSkill> => {
    const response = await makeRequest(
      `/api/chat/agents/${agentId}/skills/${assignmentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<ChatAgentSkill>(response);
  },

  unassignSkillFromAgent: async (
    agentId: string,
    assignmentId: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/chat/agents/${agentId}/skills/${assignmentId}`,
      {
        method: 'DELETE',
      }
    );
    return handleApiResponse<void>(response);
  },

  // ─── Remote Skill Registry ───

  listRegistrySkills: async (
    registryUrl?: string
  ): Promise<RemoteSkillMeta[]> => {
    const url = registryUrl
      ? `/api/chat/registry/skills?registry_url=${encodeURIComponent(registryUrl)}`
      : '/api/chat/registry/skills';
    const response = await makeRequest(url);
    return handleApiResponse<RemoteSkillMeta[]>(response);
  },

  getRegistrySkill: async (
    skillId: string,
    registryUrl?: string
  ): Promise<RemoteSkillPackage> => {
    const url = registryUrl
      ? `/api/chat/registry/skills/${skillId}?registry_url=${encodeURIComponent(registryUrl)}`
      : `/api/chat/registry/skills/${skillId}`;
    const response = await makeRequest(url);
    return handleApiResponse<RemoteSkillPackage>(response);
  },

  listRegistryCategories: async (
    registryUrl?: string
  ): Promise<SkillCategory[]> => {
    const url = registryUrl
      ? `/api/chat/registry/categories?registry_url=${encodeURIComponent(registryUrl)}`
      : '/api/chat/registry/categories';
    const response = await makeRequest(url);
    return handleApiResponse<SkillCategory[]>(response);
  },

  installRegistrySkill: async (
    skillId: string,
    registryUrl?: string,
    agents?: string[]
  ): Promise<ChatSkill> => {
    const params = new URLSearchParams();
    if (registryUrl) {
      params.append('registry_url', registryUrl);
    }
    const paramStr = params.toString();
    const url = `/api/chat/registry/skills/${skillId}/install${paramStr ? '?' + paramStr : ''}`;
    const response = await makeRequest(url, {
      method: 'POST',
      body: JSON.stringify({ agents }),
    });
    return handleApiResponse<ChatSkill>(response);
  },

  listBuiltinSkills: async (params?: {
    category?: string;
    agent?: string;
    search?: string;
  }): Promise<RemoteSkillMeta[]> => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.agent) query.set('agent', params.agent);
    if (params?.search) query.set('search', params.search);
    const response = await makeRequest(
      `/api/chat/builtin/skills${query.toString() ? `?${query.toString()}` : ''}`
    );
    return handleApiResponse<RemoteSkillMeta[]>(response);
  },

  getBuiltinSkill: async (skillId: string): Promise<RemoteSkillPackage> => {
    const response = await makeRequest(`/api/chat/builtin/skills/${skillId}`);
    return handleApiResponse<RemoteSkillPackage>(response);
  },

  installBuiltinSkill: async (
    skillId: string,
    agents?: string[]
  ): Promise<ChatSkill> => {
    const response = await makeRequest(
      `/api/chat/builtin/skills/${skillId}/install`,
      {
        method: 'POST',
        body: JSON.stringify({ agents }),
      }
    );
    return handleApiResponse<ChatSkill>(response);
  },

  getBuiltinSkillsStats: async (): Promise<BuiltinSkillsStats> => {
    const response = await makeRequest('/api/chat/builtin/skills/stats');
    return handleApiResponse<BuiltinSkillsStats>(response);
  },

  listSupportedAgents: async (): Promise<AgentInfo[]> => {
    const response = await makeRequest('/api/chat/skills/agents');
    return handleApiResponse<AgentInfo[]>(response);
  },

  validateWorkspacePath: async (
    workspacePath: string
  ): Promise<{ valid: boolean; error?: string }> => {
    const response = await makeRequest('/api/chat/validate-workspace-path', {
      method: 'POST',
      body: JSON.stringify({ workspace_path: workspacePath }),
    });
    return handleApiResponse<{ valid: boolean; error?: string }>(response);
  },
};
