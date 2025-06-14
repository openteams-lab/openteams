use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid, // Foreign key to User
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateProject {
    pub name: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct UpdateProject {
    pub name: Option<String>,
}
