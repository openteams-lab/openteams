use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "chat_run_log_state", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatRunLogState {
    Live,
    Tail,
    Pruned,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, Eq, TS)]
#[sqlx(type_name = "chat_run_artifact_state", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ChatRunArtifactState {
    Full,
    Stub,
    Pruned,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ChatRunRetentionSummary {
    pub kind: Option<String>,
    pub finished_at: Option<String>,
    pub error_summary: Option<String>,
    pub error_type: Option<String>,
    pub assistant_excerpt: Option<String>,
    pub total_tokens: Option<u32>,
    pub log_bytes_total: Option<u64>,
    pub log_bytes_persisted: Option<u64>,
    pub live_bytes_dropped: Option<u64>,
    pub log_truncated: Option<bool>,
    pub log_capture_degraded: Option<bool>,
    pub pruned_at: Option<String>,
    pub prune_reason: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatRun {
    pub id: Uuid,
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub run_index: i64,
    pub run_dir: String,
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub raw_log_path: Option<String>,
    pub meta_path: Option<String>,
    pub log_state: ChatRunLogState,
    pub artifact_state: ChatRunArtifactState,
    pub log_truncated: bool,
    pub log_capture_degraded: bool,
    pub pruned_at: Option<DateTime<Utc>>,
    pub prune_reason: Option<String>,
    pub retention_summary_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChatRun {
    pub session_id: Uuid,
    pub session_agent_id: Uuid,
    pub run_index: i64,
    pub run_dir: String,
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub raw_log_path: Option<String>,
    pub meta_path: Option<String>,
}

#[derive(Debug)]
pub struct MarkArtifactStubbedUpdate {
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub meta_path: Option<String>,
    pub pruned_at: DateTime<Utc>,
    pub prune_reason: Option<String>,
    pub retention_summary_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ChatRunRetentionInfo {
    pub run_id: Uuid,
    pub session_agent_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub log_state: ChatRunLogState,
    pub artifact_state: ChatRunArtifactState,
    pub log_truncated: bool,
    pub log_capture_degraded: bool,
    pub pruned_at: Option<DateTime<Utc>>,
    pub prune_reason: Option<String>,
    pub retention_summary: Option<ChatRunRetentionSummary>,
}

#[derive(Debug, FromRow)]
struct ChatRunRetentionRow {
    run_id: Uuid,
    session_agent_id: Uuid,
    created_at: DateTime<Utc>,
    log_state: ChatRunLogState,
    artifact_state: ChatRunArtifactState,
    log_truncated: bool,
    log_capture_degraded: bool,
    pruned_at: Option<DateTime<Utc>>,
    prune_reason: Option<String>,
    retention_summary_json: Option<String>,
}

impl TryFrom<ChatRunRetentionRow> for ChatRunRetentionInfo {
    type Error = serde_json::Error;

    fn try_from(value: ChatRunRetentionRow) -> Result<Self, Self::Error> {
        let retention_summary = match value.retention_summary_json {
            Some(raw) => Some(serde_json::from_str(&raw)?),
            None => None,
        };

        Ok(Self {
            run_id: value.run_id,
            session_agent_id: value.session_agent_id,
            created_at: value.created_at,
            log_state: value.log_state,
            artifact_state: value.artifact_state,
            log_truncated: value.log_truncated,
            log_capture_degraded: value.log_capture_degraded,
            pruned_at: value.pruned_at,
            prune_reason: value.prune_reason,
            retention_summary,
        })
    }
}

impl ChatRun {
    pub async fn list_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatRun,
            r#"SELECT id as "id!: Uuid",
                      session_id as "session_id!: Uuid",
                      session_agent_id as "session_agent_id!: Uuid",
                      run_index,
                      run_dir,
                      input_path,
                      output_path,
                      raw_log_path,
                      meta_path,
                      log_state as "log_state!: ChatRunLogState",
                      artifact_state as "artifact_state!: ChatRunArtifactState",
                      log_truncated as "log_truncated!: bool",
                      log_capture_degraded as "log_capture_degraded!: bool",
                      pruned_at as "pruned_at: DateTime<Utc>",
                      prune_reason,
                      retention_summary_json,
                      created_at as "created_at!: DateTime<Utc>"
               FROM chat_runs
               ORDER BY created_at ASC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatRun,
            r#"SELECT id as "id!: Uuid",
                      session_id as "session_id!: Uuid",
                      session_agent_id as "session_agent_id!: Uuid",
                      run_index,
                      run_dir,
                      input_path,
                      output_path,
                      raw_log_path,
                      meta_path,
                      log_state as "log_state!: ChatRunLogState",
                      artifact_state as "artifact_state!: ChatRunArtifactState",
                      log_truncated as "log_truncated!: bool",
                      log_capture_degraded as "log_capture_degraded!: bool",
                      pruned_at as "pruned_at: DateTime<Utc>",
                      prune_reason,
                      retention_summary_json,
                      created_at as "created_at!: DateTime<Utc>"
               FROM chat_runs
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_latest_for_session_agent(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatRun,
            r#"SELECT id as "id!: Uuid",
                      session_id as "session_id!: Uuid",
                      session_agent_id as "session_agent_id!: Uuid",
                      run_index,
                      run_dir,
                      input_path,
                      output_path,
                      raw_log_path,
                      meta_path,
                      log_state as "log_state!: ChatRunLogState",
                      artifact_state as "artifact_state!: ChatRunArtifactState",
                      log_truncated as "log_truncated!: bool",
                      log_capture_degraded as "log_capture_degraded!: bool",
                      pruned_at as "pruned_at: DateTime<Utc>",
                      prune_reason,
                      retention_summary_json,
                      created_at as "created_at!: DateTime<Utc>"
               FROM chat_runs
               WHERE session_agent_id = $1
               ORDER BY run_index DESC
               LIMIT 1"#,
            session_agent_id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn next_run_index(
        pool: &SqlitePool,
        session_agent_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let row = sqlx::query!(
            r#"SELECT COALESCE(MAX(run_index), 0) as "max_index!: i64"
               FROM chat_runs
               WHERE session_agent_id = $1"#,
            session_agent_id
        )
        .fetch_one(pool)
        .await?;

        Ok(row.max_index.saturating_add(1))
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatRun,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            ChatRun,
            r#"INSERT INTO chat_runs
               (id, session_id, session_agent_id, run_index, run_dir, input_path, output_path, raw_log_path, meta_path)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id as "id!: Uuid",
                         session_id as "session_id!: Uuid",
                         session_agent_id as "session_agent_id!: Uuid",
                         run_index,
                         run_dir,
                         input_path,
                         output_path,
                         raw_log_path,
                         meta_path,
                         log_state as "log_state!: ChatRunLogState",
                         artifact_state as "artifact_state!: ChatRunArtifactState",
                         log_truncated as "log_truncated!: bool",
                         log_capture_degraded as "log_capture_degraded!: bool",
                         pruned_at as "pruned_at: DateTime<Utc>",
                         prune_reason,
                         retention_summary_json,
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            data.session_id,
            data.session_agent_id,
            data.run_index,
            data.run_dir,
            data.input_path,
            data.output_path,
            data.raw_log_path,
            data.meta_path
        )
        .fetch_one(pool)
        .await
    }

    pub async fn list_retention_for_session(
        pool: &SqlitePool,
        session_id: Uuid,
        run_ids: Option<&[Uuid]>,
        limit: u32,
    ) -> Result<Vec<ChatRunRetentionInfo>, sqlx::Error> {
        if matches!(run_ids, Some(ids) if ids.is_empty()) {
            return Ok(Vec::new());
        }

        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id as run_id, session_agent_id, created_at, log_state, artifact_state, \
             log_truncated, log_capture_degraded, pruned_at, prune_reason, retention_summary_json \
             FROM chat_runs WHERE session_id = ",
        );
        builder.push_bind(session_id);

        if let Some(run_ids) = run_ids {
            builder.push(" AND id IN (");
            let mut separated = builder.separated(", ");
            for run_id in run_ids {
                separated.push_bind(run_id);
            }
            separated.push_unseparated(")");
        }

        builder.push(" ORDER BY created_at DESC LIMIT ");
        builder.push_bind(i64::from(limit));

        let rows = builder
            .build_query_as::<ChatRunRetentionRow>()
            .fetch_all(pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                ChatRunRetentionInfo::try_from(row).map_err(|err| {
                    sqlx::Error::Decode(Box::new(err) as Box<dyn std::error::Error + Send + Sync>)
                })
            })
            .collect()
    }

    pub async fn update_after_run_completion(
        pool: &SqlitePool,
        id: Uuid,
        raw_log_path: Option<String>,
        log_state: ChatRunLogState,
        log_truncated: bool,
        log_capture_degraded: bool,
        retention_summary_json: Option<String>,
    ) -> Result<(), sqlx::Error> {
        let log_state_db = match log_state {
            ChatRunLogState::Live => "live",
            ChatRunLogState::Tail => "tail",
            ChatRunLogState::Pruned => "pruned",
        };
        sqlx::query!(
            r#"UPDATE chat_runs
               SET raw_log_path = $2,
                   log_state = $3,
                   log_truncated = $4,
                   log_capture_degraded = $5,
                   retention_summary_json = COALESCE($6, retention_summary_json)
               WHERE id = $1"#,
            id,
            raw_log_path,
            log_state_db,
            log_truncated,
            log_capture_degraded,
            retention_summary_json,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn update_live_retention_flags(
        pool: &SqlitePool,
        id: Uuid,
        log_truncated: bool,
        log_capture_degraded: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE chat_runs
               SET log_truncated = $2,
                   log_capture_degraded = $3
               WHERE id = $1"#,
            id,
            log_truncated,
            log_capture_degraded,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn update_retention_summary(
        pool: &SqlitePool,
        id: Uuid,
        retention_summary_json: Option<String>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE chat_runs
               SET retention_summary_json = $2
               WHERE id = $1"#,
            id,
            retention_summary_json,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn mark_log_pruned(
        pool: &SqlitePool,
        id: Uuid,
        pruned_at: DateTime<Utc>,
        prune_reason: Option<String>,
        retention_summary_json: Option<String>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE chat_runs
               SET raw_log_path = NULL,
                   log_state = 'pruned',
                   pruned_at = $2,
                   prune_reason = $3,
                   retention_summary_json = COALESCE($4, retention_summary_json)
               WHERE id = $1"#,
            id,
            pruned_at,
            prune_reason,
            retention_summary_json,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn mark_artifact_stubbed(
        pool: &SqlitePool,
        id: Uuid,
        update: MarkArtifactStubbedUpdate,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE chat_runs
               SET input_path = $2,
                   output_path = $3,
                   meta_path = $4,
                   artifact_state = 'stub',
                   pruned_at = $5,
                   prune_reason = $6,
                   retention_summary_json = COALESCE($7, retention_summary_json)
               WHERE id = $1"#,
            id,
            update.input_path,
            update.output_path,
            update.meta_path,
            update.pruned_at,
            update.prune_reason,
            update.retention_summary_json,
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn mark_run_dir_pruned(
        pool: &SqlitePool,
        id: Uuid,
        pruned_at: DateTime<Utc>,
        prune_reason: Option<String>,
        retention_summary_json: Option<String>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE chat_runs
               SET input_path = NULL,
                   output_path = NULL,
                   raw_log_path = NULL,
                   meta_path = NULL,
                   log_state = 'pruned',
                   artifact_state = 'pruned',
                   pruned_at = $2,
                   prune_reason = $3,
                   retention_summary_json = COALESCE($4, retention_summary_json)
               WHERE id = $1"#,
            id,
            pruned_at,
            prune_reason,
            retention_summary_json,
        )
        .execute(pool)
        .await?;

        Ok(())
    }
}
