use axum::{Json, Router, extract::State, response::Json as ResponseJson, routing::post};
use db::models::workflow_transcript::WorkflowTranscript;
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::workflow::{
    workflow_iteration::UserIterationFeedbackDetail, workflow_orchestrator::WorkflowOrchestrator,
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UserReviewResponseRequest {
    pub review_id: String,
    pub action: String,
    pub feedback: Option<String>,
    #[serde(default)]
    pub expected_step_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct UserReviewResponseResponse {
    pub execution_id: Uuid,
    pub transcript_id: Uuid,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UserIterationFeedbackDetailRequest {
    pub what_wrong: String,
    pub expected: String,
    pub priority: String,
    pub additional_notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UserIterationFeedbackRequest {
    pub execution_id: Uuid,
    pub action: String,
    pub feedback: Option<UserIterationFeedbackDetailRequest>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct UserIterationFeedbackResponse {
    pub execution_id: Uuid,
    pub status: String,
    pub current_round: i32,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/workflow/review/respond", post(respond_to_review))
        .route(
            "/workflow/iteration/feedback",
            post(submit_iteration_feedback),
        )
}

pub async fn respond_to_review(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UserReviewResponseRequest>,
) -> Result<ResponseJson<ApiResponse<UserReviewResponseResponse>>, ApiError> {
    let transcript_id = Uuid::parse_str(payload.review_id.trim())
        .map_err(|_| ApiError::BadRequest("review_id must be a valid UUID.".to_string()))?;
    let transcript = WorkflowTranscript::find_by_id(&deployment.db().pool, transcript_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Review transcript not found.".to_string()))?;
    if let Some(expected_step_id) = payload.expected_step_id.as_deref() {
        let expected_step_id = Uuid::parse_str(expected_step_id.trim()).map_err(|_| {
            ApiError::BadRequest("expected_step_id must be a valid UUID.".to_string())
        })?;
        if transcript.step_id != Some(expected_step_id) {
            return Err(ApiError::BadRequest(
                "Review target does not match the selected workflow step.".to_string(),
            ));
        }
    }

    let normalized_action = normalize_review_action(&transcript.entry_type, &payload.action)?;
    let feedback = payload
        .feedback
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if normalized_action == "rejected" && feedback.is_none() {
        return Err(ApiError::BadRequest(
            "feedback is required when rejecting a review.".to_string(),
        ));
    }

    let resolved = WorkflowOrchestrator::resolve_transcript_action(
        &deployment.db().pool,
        deployment.chat_runner(),
        transcript_id,
        normalized_action,
        feedback,
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    if resolved.should_wake_scheduler {
        let deployment_clone = deployment.clone();
        let execution_id = resolved.execution.id;
        tokio::spawn(async move {
            if let Err(err) = WorkflowOrchestrator::wake_scheduler(
                deployment_clone.db(),
                deployment_clone.chat_runner(),
                execution_id,
            )
            .await
            {
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed after responding to review");
            }
        });
    }

    Ok(ResponseJson(ApiResponse::success(
        UserReviewResponseResponse {
            execution_id: resolved.execution.id,
            transcript_id: resolved.transcript.id,
            status: format!("{:?}", resolved.execution.status).to_lowercase(),
        },
    )))
}

pub async fn submit_iteration_feedback(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UserIterationFeedbackRequest>,
) -> Result<ResponseJson<ApiResponse<UserIterationFeedbackResponse>>, ApiError> {
    let normalized_action = payload.action.trim().to_ascii_lowercase();
    let feedback = match normalized_action.as_str() {
        "accept" | "accepted" => None,
        "reject" | "rejected" => {
            let feedback = payload.feedback.ok_or_else(|| {
                ApiError::BadRequest(
                    "feedback is required when rejecting an iteration result.".to_string(),
                )
            })?;
            Some(validate_iteration_feedback(feedback)?)
        }
        _ => {
            return Err(ApiError::BadRequest(format!(
                "unsupported iteration feedback action '{}'.",
                payload.action
            )));
        }
    };

    let outcome = WorkflowOrchestrator::handle_iteration_feedback(
        deployment.db(),
        deployment.chat_runner(),
        payload.execution_id,
        &normalized_action,
        feedback,
    )
    .await
    .map_err(|err| ApiError::BadRequest(err.to_string()))?;

    if outcome.should_wake_scheduler {
        let deployment_clone = deployment.clone();
        let execution_id = outcome.execution.id;
        tokio::spawn(async move {
            if let Err(err) = WorkflowOrchestrator::wake_scheduler(
                deployment_clone.db(),
                deployment_clone.chat_runner(),
                execution_id,
            )
            .await
            {
                tracing::error!(execution_id = %execution_id, error = %err, "workflow scheduler failed after submitting iteration feedback");
            }
        });
    }

    Ok(ResponseJson(ApiResponse::success(
        UserIterationFeedbackResponse {
            execution_id: outcome.execution.id,
            status: format!("{:?}", outcome.execution.status).to_lowercase(),
            current_round: outcome.execution.current_round,
        },
    )))
}

fn validate_iteration_feedback(
    feedback: UserIterationFeedbackDetailRequest,
) -> Result<UserIterationFeedbackDetail, ApiError> {
    let what_wrong = require_non_empty("feedback.what_wrong", feedback.what_wrong)?;
    let expected = require_non_empty("feedback.expected", feedback.expected)?;
    let priority = require_non_empty("feedback.priority", feedback.priority)?;
    let additional_notes = feedback
        .additional_notes
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok(UserIterationFeedbackDetail {
        what_wrong,
        expected,
        priority: Some(priority),
        additional_notes,
    })
}

fn require_non_empty(field: &str, value: String) -> Result<String, ApiError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} cannot be empty.")));
    }
    Ok(value)
}

fn normalize_review_action(entry_type: &str, action: &str) -> Result<&'static str, ApiError> {
    match (entry_type, action.trim().to_ascii_lowercase().as_str()) {
        ("step_review", "approve") | ("step_review", "approved") => Ok("approved"),
        ("step_review", "reject") | ("step_review", "rejected") => Ok("rejected"),
        ("loop_review", "approve") | ("loop_review", "approved") => Ok("approved"),
        ("loop_review", "reject") | ("loop_review", "rejected") => Ok("rejected"),
        ("final_review", _) => Err(ApiError::BadRequest(
            "final_review must be submitted through workflow iteration feedback.".to_string(),
        )),
        ("step_review" | "loop_review", _) => Err(ApiError::BadRequest(format!(
            "unsupported action '{}' for review type '{}'.",
            action, entry_type
        ))),
        _ => Err(ApiError::BadRequest(format!(
            "transcript '{}' is not a supported workflow review.",
            entry_type
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_review_action;

    #[test]
    fn normalize_step_review_actions() {
        assert_eq!(
            normalize_review_action("step_review", "approve").unwrap(),
            "approved"
        );
        assert_eq!(
            normalize_review_action("step_review", "reject").unwrap(),
            "rejected"
        );
        assert_eq!(
            normalize_review_action("loop_review", "approve").unwrap(),
            "approved"
        );
        assert_eq!(
            normalize_review_action("loop_review", "reject").unwrap(),
            "rejected"
        );
    }

    #[test]
    fn normalize_final_review_actions_are_rejected() {
        assert!(normalize_review_action("final_review", "approve").is_err());
        assert!(normalize_review_action("final_review", "reject").is_err());
    }

    #[test]
    fn reject_non_review_transcript_types() {
        assert!(normalize_review_action("approval_request", "approve").is_err());
    }
}
