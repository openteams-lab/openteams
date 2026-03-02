use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ChatAgentSkill {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub skill_id: Uuid,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct AssignSkillToAgent {
    pub agent_id: Uuid,
    pub skill_id: Uuid,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateAgentSkill {
    pub enabled: Option<bool>,
}

impl ChatAgentSkill {
    pub async fn find_by_agent_id(
        pool: &SqlitePool,
        agent_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatAgentSkill,
            r#"SELECT id as "id!: Uuid",
                      agent_id as "agent_id!: Uuid",
                      skill_id as "skill_id!: Uuid",
                      enabled as "enabled!: bool",
                      created_at as "created_at!: DateTime<Utc>"
               FROM chat_agent_skills
               WHERE agent_id = $1
               ORDER BY created_at ASC"#,
            agent_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_skill_id(
        pool: &SqlitePool,
        skill_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ChatAgentSkill,
            r#"SELECT id as "id!: Uuid",
                      agent_id as "agent_id!: Uuid",
                      skill_id as "skill_id!: Uuid",
                      enabled as "enabled!: bool",
                      created_at as "created_at!: DateTime<Utc>"
               FROM chat_agent_skills
               WHERE skill_id = $1
               ORDER BY created_at ASC"#,
            skill_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn assign(
        pool: &SqlitePool,
        data: &AssignSkillToAgent,
        id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let enabled = data.enabled.unwrap_or(true);

        sqlx::query_as!(
            ChatAgentSkill,
            r#"INSERT INTO chat_agent_skills (id, agent_id, skill_id, enabled)
               VALUES ($1, $2, $3, $4)
               RETURNING id as "id!: Uuid",
                         agent_id as "agent_id!: Uuid",
                         skill_id as "skill_id!: Uuid",
                         enabled as "enabled!: bool",
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            data.agent_id,
            data.skill_id,
            enabled
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateAgentSkill,
    ) -> Result<Self, sqlx::Error> {
        let enabled = data.enabled.unwrap_or(true);

        sqlx::query_as!(
            ChatAgentSkill,
            r#"UPDATE chat_agent_skills
               SET enabled = $2
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         agent_id as "agent_id!: Uuid",
                         skill_id as "skill_id!: Uuid",
                         enabled as "enabled!: bool",
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            enabled
        )
        .fetch_one(pool)
        .await
    }

    pub async fn unassign(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM chat_agent_skills WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn unassign_by_agent_and_skill(
        pool: &SqlitePool,
        agent_id: Uuid,
        skill_id: Uuid,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!(
            "DELETE FROM chat_agent_skills WHERE agent_id = $1 AND skill_id = $2",
            agent_id,
            skill_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }
}
