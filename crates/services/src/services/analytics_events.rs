use db::models::analytics::{AnalyticsEvent, AnalyticsEventCategory, CreateAnalyticsEvent};
use executors::profile::canonical_variant_key;
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;

use super::analytics::{AnalyticsService, forward_analytics_record_to_posthog};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillInstallSource {
    Builtin,
    Registry,
}

impl SkillInstallSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Registry => "registry",
        }
    }

    fn ingest_path(self) -> &'static str {
        match self {
            Self::Builtin => "/chat/skills/builtin/{skill_id}/install",
            Self::Registry => "/chat/skills/registry/{skill_id}/install",
        }
    }
}

#[derive(Debug, Clone)]
pub enum DomainEvent {
    MessageSent {
        session_id: Uuid,
        actor_user_id: String,
        message_length: usize,
        mentions: Vec<String>,
        has_attachment: bool,
        attachment_count: usize,
    },
    SessionCreated {
        session_id: Uuid,
        actor_user_id: String,
        title_length: usize,
    },
    SessionArchived {
        session_id: Uuid,
        actor_user_id: String,
        duration_seconds: i64,
        message_count: i64,
        agent_count: i64,
    },
    SessionRestored {
        session_id: Uuid,
        actor_user_id: String,
    },
    SessionDeleted {
        session_id: Uuid,
        actor_user_id: String,
        had_messages: bool,
    },
    AgentAdded {
        session_id: Uuid,
        actor_user_id: String,
        agent_id: Uuid,
        agent_name: String,
        runner_type: String,
        executor_profile_variant: Option<String>,
        has_workspace: bool,
    },
    SkillAssigned {
        actor_user_id: String,
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillEnabled {
        actor_user_id: String,
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillDisabled {
        actor_user_id: String,
        skill_id: Uuid,
        agent_id: Uuid,
    },
    SkillInstalled {
        actor_user_id: String,
        skill_id: Uuid,
        skill_name: String,
        source: SkillInstallSource,
    },
    PresetSnapshotCreated {
        session_id: Uuid,
        actor_user_id: String,
        team_preset_id: String,
        member_count: usize,
        overwritten: bool,
        overwrite_strategy: String,
    },
    AgentRunStarted {
        session_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        executor_profile: Option<String>,
    },
    AgentRunCompleted {
        session_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        duration_ms: i64,
        success: bool,
    },
    AgentRunErrored {
        session_id: Uuid,
        agent_id: Uuid,
        run_id: Uuid,
        error_type: String,
        error_message: String,
    },
}

impl DomainEvent {
    fn name(&self) -> &'static str {
        match self {
            Self::MessageSent { .. } => "message_sent",
            Self::SessionCreated { .. } => "session_created",
            Self::SessionArchived { .. } => "session_archived",
            Self::SessionRestored { .. } => "session_restored",
            Self::SessionDeleted { .. } => "session_deleted",
            Self::AgentAdded { .. } => "agent_added",
            Self::SkillAssigned { .. } => "skill_assigned",
            Self::SkillEnabled { .. } => "skill_enabled",
            Self::SkillDisabled { .. } => "skill_disabled",
            Self::SkillInstalled { .. } => "skill_installed",
            Self::PresetSnapshotCreated { .. } => "preset_snapshot_created",
            Self::AgentRunStarted { .. } => "agent_run_started",
            Self::AgentRunCompleted { .. } => "agent_run_completed",
            Self::AgentRunErrored { .. } => "agent_run_errored",
        }
    }

    fn into_projection(self) -> AnalyticsProjection {
        match self {
            Self::MessageSent {
                session_id,
                actor_user_id,
                message_length,
                mentions,
                has_attachment,
                attachment_count,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}/messages",
                event_type: "message_send",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "message_length": message_length,
                    "mentions": mentions,
                    "has_attachment": has_attachment,
                    "attachment_count": attachment_count
                }),
            },
            Self::SessionCreated {
                session_id,
                actor_user_id,
                title_length,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions",
                event_type: "session_create",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "title_length": title_length
                }),
            },
            Self::SessionArchived {
                session_id,
                actor_user_id,
                duration_seconds,
                message_count,
                agent_count,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}/archive",
                event_type: "session_archive",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "duration_seconds": duration_seconds,
                    "message_count": message_count,
                    "agent_count": agent_count
                }),
            },
            Self::SessionRestored {
                session_id,
                actor_user_id,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}/restore",
                event_type: "session_restore",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({}),
            },
            Self::SessionDeleted {
                session_id,
                actor_user_id,
                had_messages,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}",
                event_type: "session_delete",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "had_messages": had_messages
                }),
            },
            Self::AgentAdded {
                session_id,
                actor_user_id,
                agent_id,
                agent_name,
                runner_type,
                executor_profile_variant,
                has_workspace,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}/agents",
                event_type: "agent_add",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "agent_id": agent_id.to_string(),
                    "agent_name": agent_name,
                    "runner_type": runner_type,
                    "executor_profile_variant": executor_profile_variant,
                    "has_workspace": has_workspace
                }),
            },
            Self::SkillAssigned {
                actor_user_id,
                skill_id,
                agent_id,
            } => AnalyticsProjection {
                ingest_path: "/chat/skills/assignments",
                event_type: "skill_assign",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: None,
                properties: json!({
                    "skill_id": skill_id.to_string(),
                    "agent_id": agent_id.to_string()
                }),
            },
            Self::SkillEnabled {
                actor_user_id,
                skill_id,
                agent_id,
            } => AnalyticsProjection {
                ingest_path: "/chat/skills/assignments/{assignment_id}",
                event_type: "skill_enable",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: None,
                properties: json!({
                    "skill_id": skill_id.to_string(),
                    "agent_id": agent_id.to_string()
                }),
            },
            Self::SkillDisabled {
                actor_user_id,
                skill_id,
                agent_id,
            } => AnalyticsProjection {
                ingest_path: "/chat/skills/assignments/{assignment_id}",
                event_type: "skill_disable",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: None,
                properties: json!({
                    "skill_id": skill_id.to_string(),
                    "agent_id": agent_id.to_string()
                }),
            },
            Self::SkillInstalled {
                actor_user_id,
                skill_id,
                skill_name,
                source,
            } => AnalyticsProjection {
                ingest_path: source.ingest_path(),
                event_type: "skill_install",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: None,
                properties: json!({
                    "skill_id": skill_id.to_string(),
                    "skill_name": skill_name,
                    "source": source.as_str()
                }),
            },
            Self::PresetSnapshotCreated {
                session_id,
                actor_user_id,
                team_preset_id,
                member_count,
                overwritten,
                overwrite_strategy,
            } => AnalyticsProjection {
                ingest_path: "/chat/sessions/{session_id}/presets/snapshot",
                event_type: "preset_snapshot_create",
                event_category: AnalyticsEventCategory::UserAction,
                user_id: Some(actor_user_id),
                session_id: Some(session_id),
                properties: json!({
                    "team_preset_id": team_preset_id,
                    "member_count": member_count,
                    "overwritten": overwritten,
                    "overwrite_strategy": overwrite_strategy
                }),
            },
            Self::AgentRunStarted {
                session_id,
                agent_id,
                run_id,
                executor_profile,
            } => AnalyticsProjection {
                ingest_path: "/chat/runs/{run_id}/start",
                event_type: "agent_run_start",
                event_category: AnalyticsEventCategory::System,
                user_id: None,
                session_id: Some(session_id),
                properties: json!({
                    "agent_id": agent_id.to_string(),
                    "run_id": run_id.to_string(),
                    "executor_profile": executor_profile
                }),
            },
            Self::AgentRunCompleted {
                session_id,
                agent_id,
                run_id,
                duration_ms,
                success,
            } => AnalyticsProjection {
                ingest_path: "/chat/runs/{run_id}/complete",
                event_type: "agent_run_complete",
                event_category: AnalyticsEventCategory::System,
                user_id: None,
                session_id: Some(session_id),
                properties: json!({
                    "agent_id": agent_id.to_string(),
                    "run_id": run_id.to_string(),
                    "duration_ms": duration_ms,
                    "success": success
                }),
            },
            Self::AgentRunErrored {
                session_id,
                agent_id,
                run_id,
                error_type,
                error_message,
            } => AnalyticsProjection {
                ingest_path: "/chat/runs/{run_id}/error",
                event_type: "agent_run_error",
                event_category: AnalyticsEventCategory::System,
                user_id: None,
                session_id: Some(session_id),
                properties: json!({
                    "agent_id": agent_id.to_string(),
                    "run_id": run_id.to_string(),
                    "error_type": error_type,
                    "error_message": error_message
                }),
            },
        }
    }
}

pub fn extract_executor_profile_variant(tools_enabled: &serde_json::Value) -> Option<String> {
    let variant = tools_enabled
        .as_object()
        .and_then(|value| value.get("executor_profile_variant"))
        .and_then(serde_json::Value::as_str)?
        .trim();
    if variant.is_empty() || variant.eq_ignore_ascii_case("DEFAULT") {
        return None;
    }
    Some(canonical_variant_key(variant))
}

#[derive(Debug)]
struct AnalyticsProjection {
    ingest_path: &'static str,
    event_type: &'static str,
    event_category: AnalyticsEventCategory,
    user_id: Option<String>,
    session_id: Option<Uuid>,
    properties: serde_json::Value,
}

impl AnalyticsProjection {
    fn into_create_event(self) -> CreateAnalyticsEvent {
        CreateAnalyticsEvent {
            event_type: self.event_type.to_string(),
            event_category: self.event_category,
            user_id: self.user_id,
            session_id: self.session_id,
            properties: self.properties,
            platform: None,
            app_version: None,
            os: None,
            device_id: None,
        }
    }
}

pub struct AnalyticsProjector<'a> {
    pool: &'a SqlitePool,
    analytics: Option<&'a AnalyticsService>,
    capture_enabled: bool,
}

impl<'a> AnalyticsProjector<'a> {
    pub fn new(
        pool: &'a SqlitePool,
        analytics: Option<&'a AnalyticsService>,
        capture_enabled: bool,
    ) -> Self {
        Self {
            pool,
            analytics,
            capture_enabled,
        }
    }

    pub async fn project(&self, event: DomainEvent) -> Result<Option<AnalyticsEvent>, sqlx::Error> {
        if !self.capture_enabled {
            return Ok(None);
        }

        let projection = event.into_projection();
        let ingest_path = projection.ingest_path;
        let analytics_event =
            AnalyticsEvent::create(self.pool, &projection.into_create_event(), Uuid::new_v4())
                .await?;

        forward_analytics_record_to_posthog(self.analytics, &analytics_event, ingest_path);
        Ok(Some(analytics_event))
    }

    pub async fn project_or_warn(&self, event: DomainEvent) {
        let domain_event = event.name();
        if let Err(err) = self.project(event).await {
            tracing::warn!(
                error = %err,
                domain_event,
                "Failed to project analytics domain event"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_created_maps_to_session_create_projection() {
        let session_id = Uuid::nil();
        let projection = DomainEvent::SessionCreated {
            session_id,
            actor_user_id: "user-1".to_string(),
            title_length: 12,
        }
        .into_projection();

        assert_eq!(projection.ingest_path, "/chat/sessions");
        assert_eq!(projection.event_type, "session_create");
        assert_eq!(
            projection.event_category,
            AnalyticsEventCategory::UserAction
        );
        assert_eq!(projection.user_id.as_deref(), Some("user-1"));
        assert_eq!(projection.session_id, Some(session_id));
        assert_eq!(projection.properties["title_length"], json!(12));
    }

    #[test]
    fn skill_install_projection_uses_source_specific_ingest_path() {
        let skill_id = Uuid::nil();
        let projection = DomainEvent::SkillInstalled {
            actor_user_id: "user-1".to_string(),
            skill_id,
            skill_name: "My Skill".to_string(),
            source: SkillInstallSource::Builtin,
        }
        .into_projection();

        assert_eq!(
            projection.ingest_path,
            "/chat/skills/builtin/{skill_id}/install"
        );
        assert_eq!(projection.event_type, "skill_install");
        assert_eq!(
            projection.properties["skill_id"],
            json!(skill_id.to_string())
        );
        assert_eq!(projection.properties["skill_name"], json!("My Skill"));
        assert_eq!(projection.properties["source"], json!("builtin"));
    }

    #[test]
    fn agent_run_error_maps_to_system_event_projection() {
        let session_id = Uuid::nil();
        let agent_id = Uuid::from_u128(1);
        let run_id = Uuid::from_u128(2);
        let projection = DomainEvent::AgentRunErrored {
            session_id,
            agent_id,
            run_id,
            error_type: "rate_limit_exceeded".to_string(),
            error_message: "429 from provider".to_string(),
        }
        .into_projection();

        assert_eq!(projection.ingest_path, "/chat/runs/{run_id}/error");
        assert_eq!(projection.event_type, "agent_run_error");
        assert_eq!(projection.event_category, AnalyticsEventCategory::System);
        assert_eq!(projection.session_id, Some(session_id));
        assert_eq!(
            projection.properties["agent_id"],
            json!(agent_id.to_string())
        );
        assert_eq!(projection.properties["run_id"], json!(run_id.to_string()));
        assert_eq!(
            projection.properties["error_type"],
            json!("rate_limit_exceeded")
        );
    }

    #[test]
    fn extract_executor_profile_variant_normalizes_non_default_values() {
        assert_eq!(
            extract_executor_profile_variant(&json!({
                "executor_profile_variant": "auto model gpt 5 2"
            })),
            Some("AUTO_MODEL_GPT_5_2".to_string())
        );
        assert_eq!(
            extract_executor_profile_variant(&json!({
                "executor_profile_variant": "DEFAULT"
            })),
            None
        );
    }
}
