use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Row, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatAgent {
    pub id: Uuid,
    pub name: String,
    pub runner_type: String,
    pub system_prompt: String,
    #[ts(type = "JsonValue")]
    pub tools_enabled: sqlx::types::Json<serde_json::Value>,
    pub model_name: Option<String>,
    pub owner_project_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateChatAgent {
    pub name: String,
    pub runner_type: String,
    pub system_prompt: Option<String>,
    pub tools_enabled: Option<serde_json::Value>,
    pub model_name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub owner_project_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateChatAgent {
    pub name: Option<String>,
    pub runner_type: Option<String>,
    pub system_prompt: Option<String>,
    pub tools_enabled: Option<serde_json::Value>,
    pub model_name: Option<String>,
}

impl ChatAgent {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let owner_expr = owner_project_expr(pool).await?;
        sqlx::query_as::<_, ChatAgent>(&format!(
            r#"SELECT id,
                      name,
                      runner_type,
                      system_prompt,
                      tools_enabled,
                      model_name,
                      {owner_expr} AS owner_project_id,
                      created_at,
                      updated_at
               FROM chat_agents
               ORDER BY name ASC"#
        ))
        .fetch_all(pool)
        .await
    }

    pub async fn find_visible_for_project(
        pool: &SqlitePool,
        project_id: Option<Uuid>,
    ) -> Result<Vec<Self>, sqlx::Error> {
        let owner_expr = owner_project_expr(pool).await?;
        let Some(project_id) = project_id else {
            return Self::find_all(pool).await;
        };

        if owner_expr == "NULL" {
            return Self::find_all(pool).await;
        }

        sqlx::query_as::<_, ChatAgent>(&format!(
            r#"SELECT id,
                      name,
                      runner_type,
                      system_prompt,
                      tools_enabled,
                      model_name,
                      {owner_expr} AS owner_project_id,
                      created_at,
                      updated_at
               FROM chat_agents
               WHERE owner_project_id IS NULL
                  OR owner_project_id = ?1
               ORDER BY name ASC"#
        ))
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        let owner_expr = owner_project_expr(pool).await?;
        sqlx::query_as::<_, ChatAgent>(&format!(
            r#"SELECT id,
                      name,
                      runner_type,
                      system_prompt,
                      tools_enabled,
                      model_name,
                      {owner_expr} AS owner_project_id,
                      created_at,
                      updated_at
               FROM chat_agents
               WHERE id = ?1"#
        ))
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Self>, sqlx::Error> {
        let owner_expr = owner_project_expr(pool).await?;
        sqlx::query_as::<_, ChatAgent>(&format!(
            r#"SELECT id,
                      name,
                      runner_type,
                      system_prompt,
                      tools_enabled,
                      model_name,
                      {owner_expr} AS owner_project_id,
                      created_at,
                      updated_at
               FROM chat_agents
               WHERE lower(name) = lower(?1)"#
        ))
        .bind(name)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateChatAgent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let system_prompt = data.system_prompt.clone().unwrap_or_default();
        let tools_enabled = data
            .tools_enabled
            .clone()
            .unwrap_or_else(|| serde_json::json!({}));

        let tools_enabled_json = sqlx::types::Json(tools_enabled);

        if chat_agents_has_owner_project_id(pool).await? {
            return sqlx::query_as::<_, ChatAgent>(
                r#"INSERT INTO chat_agents (
                       id,
                       name,
                       runner_type,
                       system_prompt,
                       tools_enabled,
                       model_name,
                       owner_project_id
                   )
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                   RETURNING id,
                             name,
                             runner_type,
                             system_prompt,
                             tools_enabled,
                             model_name,
                             owner_project_id,
                             created_at,
                             updated_at"#,
            )
            .bind(id)
            .bind(data.name.clone())
            .bind(data.runner_type.clone())
            .bind(system_prompt)
            .bind(tools_enabled_json)
            .bind(data.model_name.clone())
            .bind(data.owner_project_id)
            .fetch_one(pool)
            .await;
        }

        sqlx::query_as::<_, ChatAgent>(
            r#"INSERT INTO chat_agents (id, name, runner_type, system_prompt, tools_enabled, model_name)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               RETURNING id,
                         name,
                         runner_type,
                         system_prompt,
                         tools_enabled,
                         model_name,
                         NULL AS owner_project_id,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(data.name.clone())
        .bind(data.runner_type.clone())
        .bind(system_prompt)
        .bind(tools_enabled_json)
        .bind(data.model_name.clone())
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateChatAgent,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let name = data.name.clone().unwrap_or(existing.name);
        let runner_type = data.runner_type.clone().unwrap_or(existing.runner_type);
        let system_prompt = data.system_prompt.clone().unwrap_or(existing.system_prompt);
        let tools_enabled = data
            .tools_enabled
            .clone()
            .unwrap_or(existing.tools_enabled.0);
        let model_name = if data.model_name.is_some() {
            data.model_name.clone()
        } else {
            existing.model_name
        };

        let tools_enabled_json = sqlx::types::Json(tools_enabled);

        let owner_expr = owner_project_expr(pool).await?;
        sqlx::query_as::<_, ChatAgent>(&format!(
            r#"UPDATE chat_agents
               SET name = ?2,
                   runner_type = ?3,
                   system_prompt = ?4,
                   tools_enabled = ?5,
                   model_name = ?6,
                   updated_at = datetime('now', 'subsec')
               WHERE id = ?1
               RETURNING id,
                         name,
                         runner_type,
                         system_prompt,
                         tools_enabled,
                         model_name,
                         {owner_expr} AS owner_project_id,
                         created_at,
                         updated_at"#
        ))
        .bind(id)
        .bind(name)
        .bind(runner_type)
        .bind(system_prompt)
        .bind(tools_enabled_json)
        .bind(model_name)
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM chat_agents WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

async fn chat_agents_has_owner_project_id(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    let rows = sqlx::query("PRAGMA table_info(chat_agents)")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .any(|name| name == "owner_project_id"))
}

async fn owner_project_expr(pool: &SqlitePool) -> Result<&'static str, sqlx::Error> {
    Ok(if chat_agents_has_owner_project_id(pool).await? {
        "owner_project_id"
    } else {
        "NULL"
    })
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{ChatAgent, CreateChatAgent};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_agents (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                runner_type TEXT NOT NULL,
                system_prompt TEXT NOT NULL DEFAULT '',
                tools_enabled TEXT NOT NULL DEFAULT '{}',
                model_name TEXT,
                owner_project_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_agents table");
        pool
    }

    async fn create_agent(
        pool: &SqlitePool,
        name: &str,
        owner_project_id: Option<Uuid>,
    ) -> ChatAgent {
        ChatAgent::create(
            pool,
            &CreateChatAgent {
                name: name.to_string(),
                runner_type: "codex".to_string(),
                system_prompt: None,
                tools_enabled: None,
                model_name: None,
                owner_project_id,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent")
    }

    #[tokio::test]
    async fn find_visible_for_project_returns_global_and_project_owned_agents() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let other_project_id = Uuid::new_v4();
        let global_agent = create_agent(&pool, "global", None).await;
        let project_agent = create_agent(&pool, "project", Some(project_id)).await;
        let other_agent = create_agent(&pool, "other", Some(other_project_id)).await;

        let visible = ChatAgent::find_visible_for_project(&pool, Some(project_id))
            .await
            .expect("list visible agents");
        let visible_ids = visible.iter().map(|agent| agent.id).collect::<Vec<_>>();

        assert!(visible_ids.contains(&global_agent.id));
        assert!(visible_ids.contains(&project_agent.id));
        assert!(!visible_ids.contains(&other_agent.id));
    }
}
