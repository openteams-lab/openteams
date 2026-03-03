use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

/// Source type for a skill
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum ChatSkillSource {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "registry")]
    Registry,
    #[serde(rename = "github")]
    GitHub,
    #[serde(rename = "url")]
    Url,
}

impl std::fmt::Display for ChatSkillSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "local"),
            Self::Registry => write!(f, "registry"),
            Self::GitHub => write!(f, "github"),
            Self::Url => write!(f, "url"),
        }
    }
}

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
    // Registry fields
    pub source: String,
    pub source_url: Option<String>,
    pub version: String,
    pub author: Option<String>,
    #[ts(type = "string[]")]
    pub tags: sqlx::types::Json<Vec<String>>,
    pub category: Option<String>,
    #[ts(type = "string[]")]
    pub compatible_agents: sqlx::types::Json<Vec<String>>,
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
    // Registry fields
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub compatible_agents: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatSkill {
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub trigger_type: Option<String>,
    pub trigger_keywords: Option<Vec<String>>,
    pub enabled: Option<bool>,
    // Registry fields
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub compatible_agents: Option<Vec<String>>,
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
                      source,
                      source_url,
                      version,
                      author,
                      tags as "tags!: sqlx::types::Json<Vec<String>>",
                      category,
                      compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
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
                      source,
                      source_url,
                      version,
                      author,
                      tags as "tags!: sqlx::types::Json<Vec<String>>",
                      category,
                      compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
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
                      source,
                      source_url,
                      version,
                      author,
                      tags as "tags!: sqlx::types::Json<Vec<String>>",
                      category,
                      compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
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
                      s.source,
                      s.source_url,
                      s.version,
                      s.author,
                      s.tags as "tags!: sqlx::types::Json<Vec<String>>",
                      s.category,
                      s.compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
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

    /// Find skills by source type
    pub async fn find_by_source(pool: &SqlitePool, source: &str) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT id as "id!: Uuid",
                      name,
                      description,
                      content,
                      trigger_type,
                      trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      enabled as "enabled!: bool",
                      source,
                      source_url,
                      version,
                      author,
                      tags as "tags!: sqlx::types::Json<Vec<String>>",
                      category,
                      compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills
               WHERE source = $1
               ORDER BY name ASC"#,
            source
        )
        .fetch_all(pool)
        .await
    }

    /// Find skills by category
    pub async fn find_by_category(
        pool: &SqlitePool,
        category: &str,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatSkill,
            r#"SELECT id as "id!: Uuid",
                      name,
                      description,
                      content,
                      trigger_type,
                      trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                      enabled as "enabled!: bool",
                      source,
                      source_url,
                      version,
                      author,
                      tags as "tags!: sqlx::types::Json<Vec<String>>",
                      category,
                      compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
                      created_at as "created_at!: DateTime<Utc>",
                      updated_at as "updated_at!: DateTime<Utc>"
               FROM chat_skills
               WHERE category = $1
               ORDER BY name ASC"#,
            category
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
        let trigger_keywords = sqlx::types::Json(data.trigger_keywords.clone().unwrap_or_default());
        let enabled = data.enabled.unwrap_or(true);
        let source = data.source.clone().unwrap_or_else(|| "local".to_string());
        let version = data.version.clone().unwrap_or_else(|| "1.0.0".to_string());
        let tags = sqlx::types::Json(data.tags.clone().unwrap_or_default());
        let compatible_agents =
            sqlx::types::Json(data.compatible_agents.clone().unwrap_or_default());

        sqlx::query_as!(
            ChatSkill,
            r#"INSERT INTO chat_skills (id, name, description, content, trigger_type, trigger_keywords, enabled, source, source_url, version, author, tags, category, compatible_agents)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               RETURNING id as "id!: Uuid",
                         name,
                         description,
                         content,
                         trigger_type,
                         trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                         enabled as "enabled!: bool",
                         source,
                         source_url,
                         version,
                         author,
                         tags as "tags!: sqlx::types::Json<Vec<String>>",
                         category,
                         compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            data.name,
            description,
            data.content,
            trigger_type,
            trigger_keywords,
            enabled,
            source,
            data.source_url,
            version,
            data.author,
            tags,
            data.category,
            compatible_agents
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
        let trigger_type = data.trigger_type.clone().unwrap_or(existing.trigger_type);
        let trigger_keywords = sqlx::types::Json(
            data.trigger_keywords
                .clone()
                .unwrap_or(existing.trigger_keywords.0),
        );
        let enabled = data.enabled.unwrap_or(existing.enabled);
        let source = data.source.clone().unwrap_or(existing.source);
        let source_url = data.source_url.clone().or(existing.source_url);
        let version = data.version.clone().unwrap_or(existing.version);
        let author = data.author.clone().or(existing.author);
        let tags = sqlx::types::Json(data.tags.clone().unwrap_or(existing.tags.0));
        let category = data.category.clone().or(existing.category);
        let compatible_agents = sqlx::types::Json(
            data.compatible_agents
                .clone()
                .unwrap_or(existing.compatible_agents.0),
        );

        sqlx::query_as!(
            ChatSkill,
            r#"UPDATE chat_skills
               SET name = $2,
                   description = $3,
                   content = $4,
                   trigger_type = $5,
                   trigger_keywords = $6,
                   enabled = $7,
                   source = $8,
                   source_url = $9,
                   version = $10,
                   author = $11,
                   tags = $12,
                   category = $13,
                   compatible_agents = $14,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         name,
                         description,
                         content,
                         trigger_type,
                         trigger_keywords as "trigger_keywords!: sqlx::types::Json<Vec<String>>",
                         enabled as "enabled!: bool",
                         source,
                         source_url,
                         version,
                         author,
                         tags as "tags!: sqlx::types::Json<Vec<String>>",
                         category,
                         compatible_agents as "compatible_agents!: sqlx::types::Json<Vec<String>>",
                         created_at as "created_at!: DateTime<Utc>",
                         updated_at as "updated_at!: DateTime<Utc>""#,
            id,
            name,
            description,
            content,
            trigger_type,
            trigger_keywords,
            enabled,
            source,
            source_url,
            version,
            author,
            tags,
            category,
            compatible_agents
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
