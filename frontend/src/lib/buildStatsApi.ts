// =============================================================================
// Build Statistics API client
// -----------------------------------------------------------------------------
// Thin wrappers over the build-stats backend endpoints. Follows the same
// conventions as the main api.ts module (makeRequest + handleApiResponse).
// =============================================================================

import type {
  ActivityResponse,
  DailyTokensResponse,
  ModelPriceRow,
  ModelPricingResponse,
  SessionTokensResponse,
  UpdateModelPricingRequest,
  WorkflowStepTokensResponse,
} from "@/types";
import { handleApiResponse, makeRequest, qs } from "./apiCore";

// -----------------------------------------------------------------------------
// Build Statistics
// -----------------------------------------------------------------------------

export const buildStatsApi = {
  getDailyTokens: async (
    projectId: string,
    period: "7d" | "30d" | "90d",
  ): Promise<DailyTokensResponse> => {
    const r = await makeRequest(
      `/api/build-stats/daily-tokens${qs({ project_id: projectId, period })}`,
    );
    return handleApiResponse<DailyTokensResponse>(r);
  },

  getSessionTokens: async (
    projectId: string,
  ): Promise<SessionTokensResponse> => {
    const r = await makeRequest(
      `/api/build-stats/session-tokens${qs({ project_id: projectId })}`,
    );
    return handleApiResponse<SessionTokensResponse>(r);
  },

  getSessionWorkflowStepTokens: async (
    projectId: string,
    sessionId: string,
  ): Promise<WorkflowStepTokensResponse> => {
    const r = await makeRequest(
      `/api/build-stats/session-workflow-step-tokens${qs({
        project_id: projectId,
        session_id: sessionId,
      })}`,
    );
    return handleApiResponse<WorkflowStepTokensResponse>(r);
  },

  getActivity: async (
    projectId: string,
    period: "7d" | "30d" | "90d",
  ): Promise<ActivityResponse> => {
    const r = await makeRequest(
      `/api/build-stats/activity${qs({ project_id: projectId, period })}`,
    );
    return handleApiResponse<ActivityResponse>(r);
  },

  getModelPricing: async (
    projectId: string,
    period?: "7d" | "30d" | "90d",
    date?: string,
  ): Promise<ModelPricingResponse> => {
    const r = await makeRequest(
      `/api/build-stats/model-pricing${qs({
        project_id: projectId,
        period,
        date,
      })}`,
    );
    return handleApiResponse<ModelPricingResponse>(r);
  },

  updateModelPricing: async (
    projectId: string,
    modelId: string,
    data: UpdateModelPricingRequest,
  ): Promise<ModelPriceRow> => {
    const r = await makeRequest(
      `/api/build-stats/model-pricing/${encodeURIComponent(modelId)}${qs({
        project_id: projectId,
      })}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return handleApiResponse<ModelPriceRow>(r);
  },

  resetModelPricing: async (
    projectId: string,
    modelId: string,
  ): Promise<ModelPriceRow> => {
    const r = await makeRequest(
      `/api/build-stats/model-pricing/${encodeURIComponent(modelId)}/custom${qs(
        { project_id: projectId },
      )}`,
      { method: "DELETE" },
    );
    return handleApiResponse<ModelPriceRow>(r);
  },
};
