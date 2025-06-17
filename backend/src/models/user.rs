use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String, // Hashed password
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateUser {
    pub email: String,
    pub password: String,
    pub is_admin: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateUser {
    pub email: Option<String>,
    pub password: Option<String>,
    pub is_admin: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct LoginResponse {
    pub user: UserResponse,
    pub token: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
#[ts(rename = "User")]
pub struct UserResponse {
    pub id: Uuid,
    pub email: String,
    pub is_admin: bool,
    #[ts(type = "Date")]
    pub created_at: DateTime<Utc>,
    #[ts(type = "Date")]
    pub updated_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            is_admin: user.is_admin,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}

impl User {
    pub async fn find_by_email(pool: &PgPool, email: &str) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            User,
            "SELECT id, email, password_hash, is_admin, created_at, updated_at FROM users WHERE email = $1",
            email
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn find_all(pool: &PgPool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            User,
            "SELECT id, email, password_hash, is_admin, created_at, updated_at FROM users ORDER BY created_at DESC"
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            User,
            "SELECT id, email, password_hash, is_admin, created_at, updated_at FROM users WHERE id = $1",
            id
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &PgPool,
        data: &CreateUser,
        password_hash: String,
        user_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        let is_admin = data.is_admin.unwrap_or(false);

        sqlx::query_as!(
            User,
            "INSERT INTO users (id, email, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, email, password_hash, is_admin, created_at, updated_at",
            user_id,
            data.email,
            password_hash,
            is_admin
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        email: String,
        password_hash: String,
        is_admin: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            User,
            "UPDATE users SET email = $2, password_hash = $3, is_admin = $4 WHERE id = $1 RETURNING id, email, password_hash, is_admin, created_at, updated_at",
            id,
            email,
            password_hash,
            is_admin
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM users WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn create_or_update_admin(
        pool: &PgPool,
        email: &str,
        password_hash: &str,
    ) -> Result<(), sqlx::Error> {
        use chrono::Utc;

        // Check if admin already exists
        let existing_admin = sqlx::query!(
            "SELECT id, password_hash FROM users WHERE email = $1",
            email
        )
        .fetch_optional(pool)
        .await?;

        if let Some(admin) = existing_admin {
            // Update existing admin password
            let now = Utc::now();
            sqlx::query!(
                "UPDATE users SET password_hash = $2, is_admin = $3, updated_at = $4 WHERE id = $1",
                admin.id,
                password_hash,
                true,
                now
            )
            .execute(pool)
            .await?;

            tracing::info!("Updated admin account");
        } else {
            // Create new admin account
            let id = Uuid::new_v4();
            sqlx::query!(
                "INSERT INTO users (id, email, password_hash, is_admin) VALUES ($1, $2, $3, $4)",
                id,
                email,
                password_hash,
                true
            )
            .execute(pool)
            .await?;

            tracing::info!("Created admin account: {}", email);
        }

        Ok(())
    }
}
