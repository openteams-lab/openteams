use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use ts_rs::TS;
use uuid::Uuid;

use super::task_attempt::TaskAttemptStatus;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskAttemptActivity {
    pub id: Uuid,
    pub task_attempt_id: Uuid, // Foreign key to TaskAttempt
    pub status: TaskAttemptStatus,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export)]
pub struct CreateTaskAttemptActivity {
    pub task_attempt_id: Uuid,
    pub status: Option<TaskAttemptStatus>, // Default to Init if not provided
    pub note: Option<String>,
}
