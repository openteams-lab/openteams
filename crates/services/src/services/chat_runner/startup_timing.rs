use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::Utc;
use serde::Serialize;
use tokio::fs;
use uuid::Uuid;

pub(super) const STARTUP_TIMING_FILE_NAME: &str = "startup_timing.json";

#[derive(Debug, Clone)]
pub(super) struct RunStartupIdentity {
    pub(super) session_id: Uuid,
    pub(super) session_agent_id: Uuid,
    pub(super) agent_id: Uuid,
    pub(super) run_id: Uuid,
    pub(super) source_message_id: Uuid,
    pub(super) runner_type: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum StartupMilestoneName {
    RunScheduled,
    AgentStateRunningPersisted,
    AgentStateRunningEmitted,
    AgentRunStartedEmitted,
    WorkspaceResolved,
    WorkspaceDirectoryReady,
    GitignorePrepared,
    WorkspaceBaselineCaptured,
    RunRecordsDirectoryReady,
    RunDirectoryReady,
    ContextSnapshotBuilt,
    ReferenceContextBuilt,
    AttachmentContextBuilt,
    SessionAgentSummariesBuilt,
    AgentSkillsResolved,
    PromptBuilt,
    PromptInputWritten,
    ChatRunCreated,
    QueueBoundToRun,
    ExecutorConfigured,
    ExecutorSpawnStarted,
    ExecutorSpawnReturned,
    RawLogSpoolReady,
    LogForwardersStarted,
    LogNormalizationStarted,
    StreamBridgeScheduled,
    StreamBridgeStarted,
    ExitWatcherStarted,
    FirstRawStdout,
    FirstActivityLine,
    FirstAssistantDelta,
    ExecutorFinished,
    RunMetaWritten,
    ChatRunCompletionPersisted,
    StartupFailed,
}

#[derive(Debug, Clone, Serialize)]
struct StartupMilestone {
    name: StartupMilestoneName,
    elapsed_ms: u64,
    at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
struct StartupTimingSnapshot {
    schema_version: u8,
    session_id: Uuid,
    session_agent_id: Uuid,
    agent_id: Uuid,
    run_id: Uuid,
    source_message_id: Uuid,
    runner_type: String,
    started_at: String,
    last_updated_at: String,
    total_elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_path: Option<String>,
    milestones: Vec<StartupMilestone>,
}

#[derive(Debug)]
pub(super) struct RunStartupTiming {
    identity: RunStartupIdentity,
    started: Instant,
    started_at: String,
    last_marked: Mutex<Instant>,
    artifact_path: Mutex<Option<PathBuf>>,
    milestones: Mutex<Vec<StartupMilestone>>,
}

impl RunStartupTiming {
    pub(super) fn new(identity: RunStartupIdentity) -> Self {
        let started = Instant::now();
        Self {
            identity,
            started,
            started_at: Utc::now().to_rfc3339(),
            last_marked: Mutex::new(started),
            artifact_path: Mutex::new(None),
            milestones: Mutex::new(Vec::new()),
        }
    }

    pub(super) fn set_artifact_path(&self, path: PathBuf) {
        *self.lock_artifact_path() = Some(path);
    }

    pub(super) fn artifact_path_string(&self) -> Option<String> {
        self.lock_artifact_path()
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
    }

    pub(super) fn mark(&self, name: StartupMilestoneName, detail: Option<String>) {
        let now = Instant::now();
        let elapsed_ms = {
            let mut last_marked = self.lock_last_marked();
            let elapsed = elapsed_ms(now.duration_since(*last_marked));
            *last_marked = now;
            elapsed
        };
        let milestone = StartupMilestone {
            name,
            elapsed_ms,
            at: Utc::now().to_rfc3339(),
            detail,
        };
        tracing::info!(
            session_id = %self.identity.session_id,
            session_agent_id = %self.identity.session_agent_id,
            agent_id = %self.identity.agent_id,
            run_id = %self.identity.run_id,
            runner_type = %self.identity.runner_type,
            milestone = ?milestone.name,
            elapsed_ms = milestone.elapsed_ms,
            detail = milestone.detail.as_deref(),
            "[chat_runner] agent startup timing milestone"
        );
        self.lock_milestones().push(milestone);
    }

    pub(super) async fn mark_and_persist(
        &self,
        name: StartupMilestoneName,
        detail: Option<String>,
    ) {
        self.mark(name, detail);
        self.persist_or_warn().await;
    }

    pub(super) async fn persist_or_warn(&self) {
        let Some(path) = self.artifact_path_string().map(PathBuf::from) else {
            return;
        };
        let snapshot = self.snapshot();
        let content = match serde_json::to_vec_pretty(&snapshot) {
            Ok(content) => content,
            Err(err) => {
                tracing::warn!(
                    session_id = %self.identity.session_id,
                    run_id = %self.identity.run_id,
                    error = %err,
                    "failed to serialize agent startup timing"
                );
                return;
            }
        };

        if let Some(parent) = path.parent()
            && let Err(err) = fs::create_dir_all(parent).await
        {
            tracing::warn!(
                session_id = %self.identity.session_id,
                run_id = %self.identity.run_id,
                path = %parent.display(),
                error = %err,
                "failed to create startup timing artifact directory"
            );
            return;
        }

        if let Err(err) = fs::write(&path, content).await {
            tracing::warn!(
                session_id = %self.identity.session_id,
                run_id = %self.identity.run_id,
                path = %path.display(),
                error = %err,
                "failed to persist agent startup timing"
            );
        }
    }

    fn snapshot(&self) -> StartupTimingSnapshot {
        StartupTimingSnapshot {
            schema_version: 1,
            session_id: self.identity.session_id,
            session_agent_id: self.identity.session_agent_id,
            agent_id: self.identity.agent_id,
            run_id: self.identity.run_id,
            source_message_id: self.identity.source_message_id,
            runner_type: self.identity.runner_type.clone(),
            started_at: self.started_at.clone(),
            last_updated_at: Utc::now().to_rfc3339(),
            total_elapsed_ms: elapsed_ms(self.started.elapsed()),
            artifact_path: self.artifact_path_string(),
            milestones: self.lock_milestones().clone(),
        }
    }

    fn lock_artifact_path(&self) -> std::sync::MutexGuard<'_, Option<PathBuf>> {
        self.artifact_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_last_marked(&self) -> std::sync::MutexGuard<'_, Instant> {
        self.last_marked
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_milestones(&self) -> std::sync::MutexGuard<'_, Vec<StartupMilestone>> {
        self.milestones
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persists_startup_timing_snapshot() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(STARTUP_TIMING_FILE_NAME);
        let timing = RunStartupTiming::new(RunStartupIdentity {
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            source_message_id: Uuid::new_v4(),
            runner_type: "codex".to_string(),
        });

        timing.set_artifact_path(path.clone());
        timing
            .mark_and_persist(StartupMilestoneName::RunScheduled, None)
            .await;
        tokio::time::sleep(Duration::from_millis(5)).await;
        timing
            .mark_and_persist(StartupMilestoneName::PromptBuilt, None)
            .await;

        let content = fs::read_to_string(path).await.expect("read timing");
        assert!(content.contains("\"schema_version\": 1"));
        assert!(content.contains("\"run_scheduled\""));
        let value: serde_json::Value = serde_json::from_str(&content).expect("parse timing");
        assert!(
            value["milestones"][1]["elapsed_ms"]
                .as_u64()
                .expect("elapsed ms")
                >= 1
        );
    }
}
