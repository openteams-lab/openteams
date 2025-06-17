use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use uuid::Uuid;

use crate::models::{
    task_attempt::{TaskAttempt, TaskAttemptStatus},
    task_attempt_activity::{CreateTaskAttemptActivity, TaskAttemptActivity},
};

#[derive(Debug)]
pub struct RunningExecution {
    pub task_attempt_id: Uuid,
    pub child: tokio::process::Child,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub running_executions: Arc<Mutex<HashMap<Uuid, RunningExecution>>>,
    pub db_pool: sqlx::SqlitePool,
}

pub async fn execution_monitor(app_state: AppState) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

    loop {
        interval.tick().await;

        // Check for orphaned task attempts with latest activity status = InProgress but no running execution
        let inprogress_attempt_ids =
            match TaskAttemptActivity::find_attempts_with_latest_inprogress_status(
                &app_state.db_pool,
            )
            .await
            {
                Ok(attempts) => attempts,
                Err(e) => {
                    tracing::error!("Failed to query inprogress attempts: {}", e);
                    continue;
                }
            };

        for attempt_id in inprogress_attempt_ids {
            // Check if this attempt has a running execution
            let has_running_execution = {
                let executions = app_state.running_executions.lock().await;
                executions
                    .values()
                    .any(|exec| exec.task_attempt_id == attempt_id)
            };

            if !has_running_execution {
                // This is an orphaned task attempt - mark it as paused
                let activity_id = Uuid::new_v4();
                let create_activity = CreateTaskAttemptActivity {
                    task_attempt_id: attempt_id,
                    status: Some(TaskAttemptStatus::Paused),
                    note: Some("Execution lost (server restart or crash)".to_string()),
                };

                if let Err(e) = TaskAttemptActivity::create(
                    &app_state.db_pool,
                    &create_activity,
                    activity_id,
                    TaskAttemptStatus::Paused,
                )
                .await
                {
                    tracing::error!(
                        "Failed to create paused activity for orphaned attempt: {}",
                        e
                    );
                } else {
                    tracing::info!("Marked orphaned task attempt {} as paused", attempt_id);
                }
            }
        }

        // Check for task attempts with latest activity status = Init
        let init_attempt_ids =
            match TaskAttemptActivity::find_attempts_with_latest_init_status(&app_state.db_pool)
                .await
            {
                Ok(attempts) => attempts,
                Err(e) => {
                    tracing::error!("Failed to query init attempts: {}", e);
                    continue;
                }
            };

        for attempt_id in init_attempt_ids {
            // Check if we already have a running execution for this attempt
            {
                let executions = app_state.running_executions.lock().await;
                if executions
                    .values()
                    .any(|exec| exec.task_attempt_id == attempt_id)
                {
                    continue;
                }
            }

            // Get the task attempt to access the executor
            let task_attempt = match TaskAttempt::find_by_id(&app_state.db_pool, attempt_id).await {
                Ok(Some(attempt)) => attempt,
                Ok(None) => {
                    tracing::error!("Task attempt {} not found", attempt_id);
                    continue;
                }
                Err(e) => {
                    tracing::error!("Failed to fetch task attempt {}: {}", attempt_id, e);
                    continue;
                }
            };

            // Get the executor and start streaming execution
            let executor = task_attempt.get_executor();
            let child = match executor
                .execute_streaming(
                    &app_state.db_pool,
                    task_attempt.task_id,
                    attempt_id,
                    &task_attempt.worktree_path,
                )
                .await
            {
                Ok(child) => child,
                Err(e) => {
                    tracing::error!(
                        "Failed to start streaming execution for task attempt {}: {}",
                        attempt_id,
                        e
                    );
                    continue;
                }
            };

            // Add to running executions
            let execution_id = Uuid::new_v4();
            {
                let mut executions = app_state.running_executions.lock().await;
                executions.insert(
                    execution_id,
                    RunningExecution {
                        task_attempt_id: attempt_id,
                        child,
                        started_at: Utc::now(),
                    },
                );
            }

            // Update task attempt activity to InProgress
            let activity_id = Uuid::new_v4();
            let create_activity = CreateTaskAttemptActivity {
                task_attempt_id: attempt_id,
                status: Some(TaskAttemptStatus::InProgress),
                note: Some("Started execution".to_string()),
            };

            if let Err(e) = TaskAttemptActivity::create(
                &app_state.db_pool,
                &create_activity,
                activity_id,
                TaskAttemptStatus::InProgress,
            )
            .await
            {
                tracing::error!("Failed to create in-progress activity: {}", e);
            }

            tracing::info!(
                "Started execution {} for task attempt {}",
                execution_id,
                attempt_id
            );
        }

        // Check for completed processes
        let mut completed_executions = Vec::new();
        {
            let mut executions = app_state.running_executions.lock().await;
            for (execution_id, running_exec) in executions.iter_mut() {
                match running_exec.child.try_wait() {
                    Ok(Some(status)) => {
                        let success = status.success();
                        let exit_code = status.code();
                        completed_executions.push((
                            *execution_id,
                            running_exec.task_attempt_id,
                            success,
                            exit_code,
                        ));
                    }
                    Ok(None) => {
                        // Still running
                    }
                    Err(e) => {
                        tracing::error!("Error checking process status: {}", e);
                        completed_executions.push((
                            *execution_id,
                            running_exec.task_attempt_id,
                            false,
                            None,
                        ));
                    }
                }
            }

            // Remove completed executions from the map
            for (execution_id, _, _, _) in &completed_executions {
                executions.remove(execution_id);
            }
        }

        // Handle completed executions
        for (execution_id, task_attempt_id, success, exit_code) in completed_executions {
            let status_text = if success {
                "completed successfully"
            } else {
                "failed"
            };
            let exit_text = if let Some(code) = exit_code {
                format!(" with exit code {}", code)
            } else {
                String::new()
            };

            tracing::info!("Execution {} {}{}", execution_id, status_text, exit_text);

            // Create task attempt activity with Paused status
            let activity_id = Uuid::new_v4();
            let create_activity = CreateTaskAttemptActivity {
                task_attempt_id,
                status: Some(TaskAttemptStatus::Paused),
                note: Some(format!("Execution completed{}", exit_text)),
            };

            if let Err(e) = TaskAttemptActivity::create(
                &app_state.db_pool,
                &create_activity,
                activity_id,
                TaskAttemptStatus::Paused,
            )
            .await
            {
                tracing::error!("Failed to create paused activity: {}", e);
            } else {
                tracing::info!(
                    "Task attempt {} set to paused after execution completion",
                    task_attempt_id
                );
            }
        }
    }
}
