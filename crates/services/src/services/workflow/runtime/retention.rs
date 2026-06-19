const WORKFLOW_CLEANUP_RETENTION_DAYS: i64 = 5;

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkflowCleanupResult {
    pub execution_id: Uuid,
    pub transcripts_removed: u64,
    pub events_removed: u64,
    pub steps_cleared: u64,
}
