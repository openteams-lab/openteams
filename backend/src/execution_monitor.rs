use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use uuid::Uuid;

use crate::models::{
    task::{Task, TaskStatus},
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

        // Check for orphaned task attempts with latest activity status = ExecutorRunning but no running execution
        let executor_running_attempt_ids =
            match TaskAttemptActivity::find_attempts_with_latest_executor_running_status(
                &app_state.db_pool,
            )
            .await
            {
                Ok(attempts) => attempts,
                Err(e) => {
                    tracing::error!("Failed to query executor running attempts: {}", e);
                    continue;
                }
            };

        for attempt_id in executor_running_attempt_ids {
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
                    status: Some(TaskAttemptStatus::ExecutorFailed),
                    note: Some("Execution lost (server restart or crash)".to_string()),
                };

                if let Err(e) = TaskAttemptActivity::create(
                    &app_state.db_pool,
                    &create_activity,
                    activity_id,
                    TaskAttemptStatus::ExecutorFailed,
                )
                .await
                {
                    tracing::error!(
                        "Failed to create paused activity for orphaned attempt: {}",
                        e
                    );
                } else {
                    tracing::info!("Marked orphaned task attempt {} as paused", attempt_id);

                    // Get task attempt and task to access task_id and project_id for status update
                    if let Ok(Some(task_attempt)) =
                        TaskAttempt::find_by_id(&app_state.db_pool, attempt_id).await
                    {
                        if let Ok(Some(task)) =
                            Task::find_by_id(&app_state.db_pool, task_attempt.task_id).await
                        {
                            // Update task status to InReview
                            if let Err(e) = Task::update_status(
                                &app_state.db_pool,
                                task.id,
                                task.project_id,
                                TaskStatus::InReview,
                            )
                            .await
                            {
                                tracing::error!("Failed to update task status to InReview for orphaned attempt: {}", e);
                            }
                        }
                    }
                }
            }
        }

        // Note: Execution starting logic moved to create_task_attempt endpoint

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

            // Create task attempt activity with appropriate completion status
            let activity_id = Uuid::new_v4();
            let status = if success {
                TaskAttemptStatus::ExecutorComplete
            } else {
                TaskAttemptStatus::ExecutorFailed
            };
            let create_activity = CreateTaskAttemptActivity {
                task_attempt_id,
                status: Some(status.clone()),
                note: Some(format!("Execution completed{}", exit_text)),
            };

            if let Err(e) = TaskAttemptActivity::create(
                &app_state.db_pool,
                &create_activity,
                activity_id,
                status,
            )
            .await
            {
                tracing::error!("Failed to create paused activity: {}", e);
            } else {
                tracing::info!(
                    "Task attempt {} set to paused after execution completion",
                    task_attempt_id
                );

                // Get task attempt and task to access task_id and project_id for status update
                if let Ok(Some(task_attempt)) =
                    TaskAttempt::find_by_id(&app_state.db_pool, task_attempt_id).await
                {
                    if let Ok(Some(task)) =
                        Task::find_by_id(&app_state.db_pool, task_attempt.task_id).await
                    {
                        // Update task status to InReview
                        if let Err(e) = Task::update_status(
                            &app_state.db_pool,
                            task.id,
                            task.project_id,
                            TaskStatus::InReview,
                        )
                        .await
                        {
                            tracing::error!("Failed to update task status to InReview for completed attempt: {}", e);
                        }
                    }
                }
            }
        }
    }
}
