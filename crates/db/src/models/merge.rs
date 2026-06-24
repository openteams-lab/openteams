use serde::{Deserialize, Serialize};
use sqlx::Type;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, Type)]
#[sqlx(type_name = "merge_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum MergeStatus {
    Open,
    Merged,
    Closed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PullRequestInfo {
    pub number: i64,
    pub url: String,
    pub status: MergeStatus,
    pub merged_at: Option<chrono::DateTime<chrono::Utc>>,
    pub merge_commit_sha: Option<String>,
}
