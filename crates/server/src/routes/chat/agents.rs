use axum::{Extension, Json, extract::State, response::Json as ResponseJson};
use db::models::{
    chat_agent::{ChatAgent, CreateChatAgent, UpdateChatAgent},
    chat_session_agent::ChatSessionAgent,
};
use deployment::Deployment;
use serde_json::Value;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const EXECUTOR_PROFILE_VARIANT_KEY: &str = "executor_profile_variant";

fn extract_executor_profile_variant(tools_enabled: &Value) -> Option<&str> {
    tools_enabled
        .as_object()
        .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("DEFAULT"))
}

fn agent_execution_identity_changed(agent: &ChatAgent, payload: &UpdateChatAgent) -> bool {
    let runner_type_changed = payload
        .runner_type
        .as_ref()
        .is_some_and(|new_type| new_type != &agent.runner_type);
    let model_name_changed = payload
        .model_name
        .as_ref()
        .is_some_and(|new_model| agent.model_name.as_deref() != Some(new_model.as_str()));
    let variant_changed = payload.tools_enabled.as_ref().is_some_and(|tools_enabled| {
        extract_executor_profile_variant(tools_enabled)
            != extract_executor_profile_variant(&agent.tools_enabled.0)
    });

    runner_type_changed || model_name_changed || variant_changed
}

pub async fn get_agents(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatAgent>>>, ApiError> {
    let agents = ChatAgent::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(agents)))
}

pub async fn get_agent(
    Extension(agent): Extension<ChatAgent>,
) -> Result<ResponseJson<ApiResponse<ChatAgent>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(agent)))
}

pub async fn create_agent(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateChatAgent>,
) -> Result<ResponseJson<ApiResponse<ChatAgent>>, ApiError> {
    let agent = ChatAgent::create(&deployment.db().pool, &payload, Uuid::new_v4()).await?;
    Ok(ResponseJson(ApiResponse::success(agent)))
}

pub async fn update_agent(
    Extension(agent): Extension<ChatAgent>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateChatAgent>,
) -> Result<ResponseJson<ApiResponse<ChatAgent>>, ApiError> {
    let execution_identity_changed = agent_execution_identity_changed(&agent, &payload);

    let updated = ChatAgent::update(&deployment.db().pool, agent.id, &payload).await?;

    // If the executor identity changed, clear any persisted session pointers so
    // the next run starts a fresh upstream CLI session with the new config.
    if execution_identity_changed
        && let Err(err) =
            ChatSessionAgent::clear_session_ids_for_agent(&deployment.db().pool, agent.id).await
    {
        tracing::warn!(
            agent_id = %agent.id,
            error = %err,
            "Failed to clear session IDs after agent execution identity change"
        );
    }

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn delete_agent(
    Extension(agent): Extension<ChatAgent>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let rows_affected = ChatAgent::delete(&deployment.db().pool, agent.id).await?;
    if rows_affected == 0 {
        Err(ApiError::Database(sqlx::Error::RowNotFound))
    } else {
        Ok(ResponseJson(ApiResponse::success(())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    fn make_agent(tools_enabled: Value, model_name: Option<&str>) -> ChatAgent {
        ChatAgent {
            id: Uuid::new_v4(),
            name: "backend".to_string(),
            runner_type: "OPENTEAMS_CLI".to_string(),
            system_prompt: "system".to_string(),
            tools_enabled: sqlx::types::Json(tools_enabled),
            model_name: model_name.map(str::to_string),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn detects_runner_type_change() {
        let agent = make_agent(json!({}), None);
        let payload = UpdateChatAgent {
            name: None,
            runner_type: Some("CODEX".to_string()),
            system_prompt: None,
            tools_enabled: None,
            model_name: None,
        };

        assert!(agent_execution_identity_changed(&agent, &payload));
    }

    #[test]
    fn detects_variant_change() {
        let agent = make_agent(json!({ "executor_profile_variant": "DEFAULT" }), None);
        let payload = UpdateChatAgent {
            name: None,
            runner_type: None,
            system_prompt: None,
            tools_enabled: Some(json!({ "executor_profile_variant": "AUTO_MODEL_GPT_5_2" })),
            model_name: None,
        };

        assert!(agent_execution_identity_changed(&agent, &payload));
    }

    #[test]
    fn detects_model_name_change() {
        let agent = make_agent(json!({}), Some("openai/gpt-5.1"));
        let payload = UpdateChatAgent {
            name: None,
            runner_type: None,
            system_prompt: None,
            tools_enabled: None,
            model_name: Some("openai/gpt-5.2".to_string()),
        };

        assert!(agent_execution_identity_changed(&agent, &payload));
    }

    #[test]
    fn ignores_non_execution_changes() {
        let agent = make_agent(json!({ "executor_profile_variant": "AUTO_MODEL_GPT_5_2" }), None);
        let payload = UpdateChatAgent {
            name: Some("new-backend".to_string()),
            runner_type: None,
            system_prompt: Some("new prompt".to_string()),
            tools_enabled: Some(json!({ "executor_profile_variant": "AUTO_MODEL_GPT_5_2" })),
            model_name: None,
        };

        assert!(!agent_execution_identity_changed(&agent, &payload));
    }
}
