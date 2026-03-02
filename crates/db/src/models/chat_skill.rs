use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum ChatSkillTriggerType {
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "keyword")]
    Keyword,
    #[serde(rename = "manual")]
    Manual,
}

impl std::fmt::Display for ChatSkillTriggerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Always => write!(f, "always"),
            Self::Keyword => write!(f, "keyword"),
            Self::Manual => write!(f, "manual"),
        }
    }
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatSkill {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub content: String,
    pub trigger_type: String,
    #[ts(type = "string[]")]
    pub trigger_keywords: sqlx::types::Json<Vec<String>>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatSkill {
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub trigger_type: Option<String>,
    pub trigger_keywords: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSkill {
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub trigger_type: Option<String>,
    pub trigger_keywords: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

impl ChatSkill {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT id as "id!: Uuid",
                      name,
                      description,
                      content,
                      trigger_type,
                      trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      enabled as "enabled!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills
               ORDER BY name ASC"#
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT id as "id!: Uuid",
                      name,
                      description,
                      content,
                      trigger_type,
                      trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      enabled as "enabled!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_enabled(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT id as "id!: Uuid",
                      name,
                      description,
                      content,
                      trigger_type,
                      trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      enabled as "enabled!: bool",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills
               WHERE enabled = 1
               ORDER BY name ASC"#
        )
        .fetch_all(pool)
        .await
    }

    /// Find all skills assigned to a specific agent (enabled at both skill and assignment level)
    pub async fn find_by_agent_id(
        pool: &SqlitePool,
        agent_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT s.id as "id!: Uuid",
                      s.name,
                      s.description,
                      s.content,
                      s.trigger_type,
                      s.trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      s.enabled as "enabled!: bool",
                      s.created_at as "created_at!: DateTime<Utc>",
                      s.updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills s
               INNER JOIN chat_agent_skills ags ON s.id = ags.skill_id
               WHERE ags.agent_id = $1
                 AND s.enabled = 1
                 AND ags.enabled = 1
               ORDER BY s.name ASC"#,
            agent_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatSkill,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let description = data.description.clone().unwrap_or_default();
        let trigger_type = data
            .trigger_type
            .clone()
            .unwrap_or_else(|| "always".to_string());
        let trigger_keywords = sqlx::types::Json(
            data.trigger_keywords.clone().unwrap_or_default(),
        );
        let enabled = data.enabled.unwrap_or(true);

        sqlx::query_as!(
            ChatSkill,
            r#"INSERT INTO chat_skills (id, name, description, content, trigger_type, trigger_keywords, enabled)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id as "id!: Uuid",
                         name,
                         description,
                         content,
                         trigger_type,
                         trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                         enabled as "enabled!: bool",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            data.name,
            description,
            data.content,
            trigger_type,
            trigger_keywords,
            enabled
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateChatSkill,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let name = data.name.clone().unwrap_or(existing.name);
        let description = data.description.clone().unwrap_or(existing.description);
        let content = data.content.clone().unwrap_or(existing.content);
        let trigger_type = data
            .trigger_type
            .clone()
            .unwrap_or(existing.trigger_type);
        let trigger_keywords = sqlx::types::Json(
            data.trigger_keywords
                .clone()
                .unwrap_or(existing.trigger_keywords.0),
        );
        let enabled = data.enabled.unwrap_or(existing.enabled);

        sqlx::query_as!(
            ChatSkill,
            r#"UPDATE chat_skills
               SET name = $2,
                   description = $3,
                   content = $4,
                   trigger_type = $5,
                   trigger_keywords = $6,
                   enabled = $7,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         name,
                         description,
                         content,
                         trigger_type,
                         trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                         enabled as "enabled!: bool",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            name,
            description,
            content,
            trigger_type,
            trigger_keywords,
            enabled
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM chat_skills WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
