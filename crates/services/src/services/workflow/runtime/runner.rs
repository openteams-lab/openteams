/// Cancel the running agent process for the given step, if any.
/// Called from the orchestrator's `interrupt_step` to truly stop execution.
pub fn cancel_running_step(step_id: Uuid) {
    STEP_CANCEL_REQUESTS.insert(step_id);
    if let Some((_, token)) = RUNNING_STEPS.remove(&step_id) {
        token.cancel();
    }
}

fn register_running_step(step_id: Uuid, token: CancellationToken) {
    if STEP_CANCEL_REQUESTS.contains(&step_id) {
        token.cancel();
    }
    RUNNING_STEPS.insert(step_id, token);
}

fn clear_running_step(step_id: Uuid) {
    RUNNING_STEPS.remove(&step_id);
    STEP_CANCEL_REQUESTS.remove(&step_id);
}

struct WorkflowRuntimeRunRecord {
    run_id: Uuid,
    run_index: i64,
    run_dir: PathBuf,
    output_path: PathBuf,
    meta_path: PathBuf,
    baseline: WorkspaceChangeBaseline,
    execution_id: Uuid,
    workflow_agent_session_id: Option<Uuid>,
    step_id: Uuid,
    step_key: String,
}

async fn start_workflow_runtime_run_record(
    db: &DBService,
    session: &ChatSession,
    session_agent: &ChatSessionAgent,
    workspace_path: &PathBuf,
    prompt: &str,
    stream_context: Option<&WorkflowRuntimeStreamContext>,
) -> Result<Option<WorkflowRuntimeRunRecord>, WorkflowRuntimeError> {
    let Some(context) = stream_context else {
        return Ok(None);
    };

    let run_id = Uuid::new_v4();
    let run_index = ChatRun::next_run_index(&db.pool, session_agent.id).await?;
    let run_records_dir = workspace_run_records_dir(workspace_path, session.id);
    fs::create_dir_all(&run_records_dir).await?;
    let run_dir = run_records_dir.join(run_records_prefix(session_agent.id, run_index));
    fs::create_dir_all(&run_dir).await?;

    let input_path = run_dir.join("input.md");
    let output_path = run_dir.join("output.md");
    let meta_path = run_dir.join("meta.json");
    fs::write(&input_path, prompt).await?;

    let baseline = capture_workspace_change_baseline(workspace_path).await;

    ChatRun::create(
        &db.pool,
        &CreateChatRun {
            session_id: session.id,
            session_agent_id: session_agent.id,
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            run_index,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: Some(input_path.to_string_lossy().to_string()),
            output_path: Some(output_path.to_string_lossy().to_string()),
            raw_log_path: None,
            meta_path: Some(meta_path.to_string_lossy().to_string()),
        },
        run_id,
    )
    .await?;

    Ok(Some(WorkflowRuntimeRunRecord {
        run_id,
        run_index,
        run_dir,
        output_path,
        meta_path,
        baseline,
        execution_id: context.execution_id,
        workflow_agent_session_id: context.workflow_agent_session_id,
        step_id: context.step_id,
        step_key: context.step_key.clone(),
    }))
}

async fn finish_workflow_runtime_run_record(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workspace_path: &PathBuf,
    record: Option<&WorkflowRuntimeRunRecord>,
    assistant_output: &str,
    token_usage: Option<&TokenUsageInfo>,
    error_summary: Option<&str>,
) -> Result<(), WorkflowRuntimeError> {
    let Some(record) = record else {
        return Ok(());
    };

    fs::write(&record.output_path, assistant_output).await?;

    let delta = capture_workspace_change_delta(
        workspace_path,
        &record.run_dir,
        session_agent.id,
        record.run_index,
        &record.baseline,
    )
    .await;
    let workspace_observed_paths =
        build_git_observed_path_records(workspace_path, &delta.diff_paths, &delta.untracked_files);
    let finished_at = Utc::now();
    let mut meta = serde_json::json!({
        "run_id": record.run_id,
        "session_id": session.id,
        "session_agent_id": session_agent.id,
        "agent_id": agent.id,
        "finished_at": finished_at.to_rfc3339(),
        "workflow_execution_id": record.execution_id,
        "workflow_agent_session_id": record.workflow_agent_session_id,
        "workflow_step_id": record.step_id,
        "workflow_step_key": record.step_key.clone(),
        "workspace_observed_paths": workspace_observed_paths,
    });

    if let Some(error_summary) = error_summary {
        meta["error"] = serde_json::json!({
            "summary": error_summary,
        });
    }
    if let Some(token_usage) = token_usage {
        meta["token_usage"] = serde_json::to_value(token_usage)?;
    }

    fs::write(&record.meta_path, serde_json::to_string_pretty(&meta)?).await?;

    let retention_summary = ChatRunRetentionSummary {
        kind: Some("workflow_stub".to_string()),
        finished_at: Some(finished_at.to_rfc3339()),
        error_summary: error_summary.map(str::to_string),
        error_type: error_summary.map(|_| "workflow_runtime_error".to_string()),
        assistant_excerpt: (!assistant_output.is_empty())
            .then(|| assistant_output.chars().take(2048).collect()),
        total_tokens: token_usage.map(|usage| usage.total_tokens),
        token_usage: token_usage.cloned(),
        workflow_execution_id: Some(record.execution_id),
        workflow_agent_session_id: record.workflow_agent_session_id,
        workflow_step_id: Some(record.step_id),
        workflow_step_key: Some(record.step_key.clone()),
        log_bytes_total: None,
        log_bytes_persisted: None,
        live_bytes_dropped: None,
        log_truncated: Some(false),
        log_capture_degraded: Some(false),
        pruned_at: None,
        prune_reason: None,
    };
    ChatRun::update_after_run_completion(
        &db.pool,
        record.run_id,
        None,
        ChatRunLogState::Tail,
        false,
        false,
        serde_json::to_string(&retention_summary).ok(),
    )
    .await?;

    Ok(())
}

pub async fn run_workflow_agent_prompt(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
) -> Result<String, WorkflowRuntimeError> {
    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step_id,
        None,
        None,
        None,
    )
    .await
    .map(|run| run.output)
}

pub async fn run_workflow_step_agent_prompt(
    db: &DBService,
    chat_runner: &ChatRunner,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step: &WorkflowStep,
) -> Result<WorkflowAgentRunOutput, WorkflowRuntimeError> {
    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step.id,
        None,
        None,
        Some(WorkflowRuntimeStreamContext {
            pool: db.pool.clone(),
            chat_runner: chat_runner.clone(),
            session_id: session.id,
            execution_id: step.execution_id,
            workflow_agent_session_id: workflow_session.map(|item| item.id),
            step_id: step.id,
            step_key: step.step_key.clone(),
            agent_id: agent.id,
            agent_name: agent.name.clone(),
        }),
    )
    .await
}

pub async fn run_workflow_agent_follow_up(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: &WorkflowAgentSession,
    prompt: &str,
    step_id: Uuid,
) -> Result<String, WorkflowRuntimeError> {
    let resume_session_id = workflow_session
        .agent_session_id
        .as_deref()
        .or(session_agent.agent_session_id.as_deref())
        .ok_or_else(|| {
            WorkflowRuntimeError::Validation(format!(
                "workflow session {} missing persisted agent session id",
                workflow_session.id
            ))
        })?;

    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        Some(workflow_session),
        prompt,
        step_id,
        Some(resume_session_id),
        workflow_session.agent_message_id.as_deref(),
        None,
    )
    .await
    .map(|run| run.output)
}

pub async fn run_workflow_step_agent_follow_up(
    db: &DBService,
    chat_runner: &ChatRunner,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: &WorkflowAgentSession,
    prompt: &str,
    step: &WorkflowStep,
) -> Result<WorkflowAgentRunOutput, WorkflowRuntimeError> {
    let resume_session_id = workflow_session
        .agent_session_id
        .as_deref()
        .or(session_agent.agent_session_id.as_deref())
        .ok_or_else(|| {
            WorkflowRuntimeError::Validation(format!(
                "workflow session {} missing persisted agent session id",
                workflow_session.id
            ))
        })?;

    run_workflow_agent_prompt_inner(
        db,
        session,
        agent,
        session_agent,
        Some(workflow_session),
        prompt,
        step.id,
        Some(resume_session_id),
        workflow_session.agent_message_id.as_deref(),
        Some(WorkflowRuntimeStreamContext {
            pool: db.pool.clone(),
            chat_runner: chat_runner.clone(),
            session_id: session.id,
            execution_id: step.execution_id,
            workflow_agent_session_id: Some(workflow_session.id),
            step_id: step.id,
            step_key: step.step_key.clone(),
            agent_id: agent.id,
            agent_name: agent.name.clone(),
        }),
    )
    .await
}

async fn run_workflow_agent_prompt_inner(
    db: &DBService,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
    resume_session_id: Option<&str>,
    reset_to_message_id: Option<&str>,
    stream_context: Option<WorkflowRuntimeStreamContext>,
) -> Result<WorkflowAgentRunOutput, WorkflowRuntimeError> {
    let workspace_path = resolve_workspace_path(session, agent, session_agent);
    fs::create_dir_all(&workspace_path).await?;
    save_debug_workflow_prompt(
        &workspace_path,
        session,
        agent,
        session_agent,
        workflow_session,
        prompt,
        step_id,
        resume_session_id.is_some(),
        stream_context.as_ref(),
    )
    .await?;

    let runtime_run_record = start_workflow_runtime_run_record(
        db,
        session,
        session_agent,
        &workspace_path,
        prompt,
        stream_context.as_ref(),
    )
    .await?;

    let repo_context = RepoContext::new(workspace_path.clone(), Vec::new());
    let mut env = ExecutionEnv::new(repo_context, false, String::new());
    env.insert("VK_WORKFLOW_SESSION_ID", session.id.to_string());
    env.insert("VK_WORKFLOW_AGENT_ID", agent.id.to_string());
    env.insert("VK_WORKFLOW_SESSION_AGENT_ID", session_agent.id.to_string());
    if let Some(record) = runtime_run_record.as_ref() {
        env.insert("VK_CHAT_RUN_ID", record.run_id.to_string());
        env.insert("VK_WORKFLOW_RUN_ID", record.run_id.to_string());
    }
    let (_effective_execution, mut executor) =
        build_effective_member_executor(agent, session_agent, &mut env)
            .map_err(|err| WorkflowRuntimeError::Io(std::io::Error::other(err.to_string())))?;
    executor.use_approvals(Arc::new(NoopExecutorApprovalService));

    let mut spawned = match resume_session_id {
        Some(session_id) => {
            executor
                .spawn_follow_up(
                    workspace_path.as_path(),
                    prompt,
                    session_id,
                    reset_to_message_id,
                    &env,
                )
                .await?
        }
        None => {
            executor
                .spawn(workspace_path.as_path(), prompt, &env)
                .await?
        }
    };

    // Register the cancel token so interrupt_step can terminate this process.
    if let Some(cancel) = spawned.cancel.clone() {
        register_running_step(step_id, cancel);
    }

    let msg_store = Arc::new(MsgStore::new());
    spawn_log_forwarders(&mut spawned.child, msg_store.clone())?;
    executor.normalize_logs(msg_store.clone(), workspace_path.as_path());
    let mut session_id_task = Some(spawn_workflow_runtime_session_id_persistor(
        db.pool.clone(),
        session_agent.id,
        workflow_session.map(|item| item.id),
        msg_store.clone(),
    ));
    let mut workflow_stream_task = stream_context.as_ref().map(|context| {
        spawn_workflow_runtime_stream(
            context.pool.clone(),
            context.chat_runner.clone(),
            context.session_id,
            context.execution_id,
            context.workflow_agent_session_id,
            context.step_id,
            context.step_key.clone(),
            context.agent_id,
            context.agent_name.clone(),
            msg_store.clone(),
        )
    });

    let mut failed_by_signal = false;
    let mut interrupted = false;
    let mut status = None;

    if let Some(exit_signal) = spawned.exit_signal.take() {
        match wait_for_executor_exit_or_cancel(exit_signal, spawned.cancel.clone()).await {
            Ok(ExecutorWaitEvent::Exit(Ok(ExecutorExitResult::Success))) => {}
            Ok(ExecutorWaitEvent::Exit(Ok(ExecutorExitResult::Failure))) => {
                // Check if this failure was caused by an interrupt cancellation.
                if STEP_CANCEL_REQUESTS.contains(&step_id)
                    || spawned.cancel.as_ref().is_some_and(|c| c.is_cancelled())
                    || !RUNNING_STEPS.contains_key(&step_id)
                {
                    interrupted = true;
                } else {
                    failed_by_signal = true;
                }
            }
            Ok(ExecutorWaitEvent::Exit(Ok(ExecutorExitResult::FailureWithError(_)))) => {
                failed_by_signal = true
            }
            Ok(ExecutorWaitEvent::Exit(Err(_))) => {
                status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
            }
            Ok(ExecutorWaitEvent::CancelRequested) => {
                interrupted = true;
                terminate_child(&mut spawned).await;
            }
            Err(_) => {
                terminate_child(&mut spawned).await;
                clear_running_step(step_id);
                finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
                finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;
                let history = msg_store.get_history();
                let message =
                    workflow_executor_failure_message(&agent.name, "workflow 执行超时", &history);
                let latest_assistant =
                    extract_latest_assistant_from_history(&history).unwrap_or_default();
                finish_workflow_runtime_run_record(
                    db,
                    session,
                    agent,
                    session_agent,
                    &workspace_path,
                    runtime_run_record.as_ref(),
                    &latest_assistant,
                    None,
                    Some(&message),
                )
                .await?;
                return Err(WorkflowRuntimeError::Validation(message));
            }
        }

        if status.is_none() && !interrupted {
            match time::timeout(WORKFLOW_REAP_TIMEOUT, spawned.child.wait()).await {
                Ok(Ok(exit_status)) => status = Some(exit_status),
                Ok(Err(err)) => {
                    clear_running_step(step_id);
                    finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
                    finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;
                    let history = msg_store.get_history();
                    let latest_assistant =
                        extract_latest_assistant_from_history(&history).unwrap_or_default();
                    let message = err.to_string();
                    finish_workflow_runtime_run_record(
                        db,
                        session,
                        agent,
                        session_agent,
                        &workspace_path,
                        runtime_run_record.as_ref(),
                        &latest_assistant,
                        None,
                        Some(&message),
                    )
                    .await?;
                    return Err(WorkflowRuntimeError::Io(err));
                }
                Err(_) => terminate_child(&mut spawned).await,
            }
        }
    } else {
        status = Some(wait_for_process_exit(&mut spawned, &agent.name).await?);
    }

    // Unregister from the running steps map.
    clear_running_step(step_id);
    finish_workflow_runtime_stream(&msg_store, &mut workflow_stream_task).await;
    finish_workflow_runtime_session_id_persistor(&mut session_id_task).await;

    if interrupted {
        // Ensure the child is cleaned up.
        terminate_child(&mut spawned).await;
        let history = msg_store.get_history();
        let latest_assistant = extract_latest_assistant_from_history(&history).unwrap_or_default();
        let message = format!(
            "workflow step 被中断：{}",
            agent.name
        );
        finish_workflow_runtime_run_record(
            db,
            session,
            agent,
            session_agent,
            &workspace_path,
            runtime_run_record.as_ref(),
            &latest_assistant,
            None,
            Some(&message),
        )
        .await?;
        return Err(WorkflowRuntimeError::Interrupted(message));
    }

    if failed_by_signal {
        let history = msg_store.get_history();
        let message =
            workflow_executor_failure_message(&agent.name, "workflow 执行失败", &history);
        let latest_assistant = extract_latest_assistant_from_history(&history).unwrap_or_default();
        finish_workflow_runtime_run_record(
            db,
            session,
            agent,
            session_agent,
            &workspace_path,
            runtime_run_record.as_ref(),
            &latest_assistant,
            None,
            Some(&message),
        )
        .await?;
        return Err(WorkflowRuntimeError::Validation(message));
    }

    if let Some(exit_status) = status
        && !exit_status.success()
    {
        // Check if the non-zero exit was caused by interrupt.
        if spawned.cancel.as_ref().is_some_and(|c| c.is_cancelled()) {
            let history = msg_store.get_history();
            let latest_assistant =
                extract_latest_assistant_from_history(&history).unwrap_or_default();
            let message = format!(
                "workflow step 被中断：{}",
                agent.name
            );
            finish_workflow_runtime_run_record(
                db,
                session,
                agent,
                session_agent,
                &workspace_path,
                runtime_run_record.as_ref(),
                &latest_assistant,
                None,
                Some(&message),
            )
            .await?;
            return Err(WorkflowRuntimeError::Interrupted(message));
        }
        let history = msg_store.get_history();
        let message =
            workflow_executor_failure_message(&agent.name, "workflow 执行失败", &history);
        let latest_assistant = extract_latest_assistant_from_history(&history).unwrap_or_default();
        finish_workflow_runtime_run_record(
            db,
            session,
            agent,
            session_agent,
            &workspace_path,
            runtime_run_record.as_ref(),
            &latest_assistant,
            None,
            Some(&message),
        )
        .await?;
        return Err(WorkflowRuntimeError::Validation(message));
    }

    let history = msg_store.get_history();
    persist_workflow_runtime_session_ids(&db.pool, session_agent.id, workflow_session, &history)
        .await?;
    if let Some(context) = stream_context.as_ref() {
        persist_missing_workflow_runtime_thinking_transcripts(
            &context.pool,
            context.execution_id,
            context.workflow_agent_session_id,
            context.step_id,
            &history,
        )
        .await?;
    }
    let Some(latest_assistant) = extract_latest_assistant_from_history(&history) else {
        let message = workflow_executor_failure_message(
            &agent.name,
            "workflow agent 没有返回 assistant 输出",
            &history,
        );
        finish_workflow_runtime_run_record(
            db,
            session,
            agent,
            session_agent,
            &workspace_path,
            runtime_run_record.as_ref(),
            "",
            None,
            Some(&message),
        )
        .await?;
        return Err(WorkflowRuntimeError::Validation(message));
    };
    let token_usage = extract_latest_token_usage_from_history(&history);
    finish_workflow_runtime_run_record(
        db,
        session,
        agent,
        session_agent,
        &workspace_path,
        runtime_run_record.as_ref(),
        &latest_assistant,
        token_usage.as_ref(),
        None,
    )
    .await?;
    Ok(WorkflowAgentRunOutput {
        output: latest_assistant,
        run_id: runtime_run_record.as_ref().map(|record| record.run_id),
        token_usage,
    })
}

#[allow(clippy::too_many_arguments)]
async fn save_debug_workflow_prompt(
    workspace_path: &std::path::Path,
    session: &ChatSession,
    agent: &ChatAgent,
    session_agent: &ChatSessionAgent,
    workflow_session: Option<&WorkflowAgentSession>,
    prompt: &str,
    step_id: Uuid,
    is_follow_up: bool,
    stream_context: Option<&WorkflowRuntimeStreamContext>,
) -> Result<(), WorkflowRuntimeError> {
    if !std::env::var("DEBUG_WORKFLOW_PROMPT")
        .map(|value| value.eq_ignore_ascii_case("TRUE"))
        .unwrap_or(false)
    {
        return Ok(());
    }

    let prompt_dir = workspace_path
        .join(".openteams")
        .join("debug")
        .join("workflow_prompts")
        .join(session.id.to_string());
    fs::create_dir_all(&prompt_dir).await?;

    let run_kind = if is_follow_up { "follow_up" } else { "initial" };
    let prompt_kind = infer_workflow_prompt_debug_kind(prompt, is_follow_up);
    let agent_name = sanitize_debug_prompt_filename_component(&agent.name);
    let step_feature = stream_context
        .map(|context| format!("step_{}", context.step_key.as_str()))
        .or_else(|| extract_workflow_prompt_step_key(prompt).map(|key| format!("step_{key}")))
        .unwrap_or_else(|| {
            if step_id == Uuid::nil() {
                "workflow".to_string()
            } else {
                format!("step_{step_id}")
            }
        });
    let timestamp_ms = Utc::now().timestamp_millis();
    let filename = format!(
        "{}_{}_{}_{}_{}.md",
        timestamp_ms,
        sanitize_debug_prompt_filename_component(&prompt_kind),
        sanitize_debug_prompt_filename_component(&step_feature),
        agent_name,
        Uuid::new_v4()
    );
    let path = prompt_dir.join(filename);
    let workflow_session_id = workflow_session
        .map(|item| item.id.to_string())
        .unwrap_or_else(|| "none".to_string());
    let content = format!(
        "---\nsession_id: {}\nagent_id: {}\nagent_name: {}\nsession_agent_id: {}\nworkflow_agent_session_id: {}\nstep_id: {}\nstep_key: {}\nkind: {}\nprompt_kind: {}\ncreated_at: {}\n---\n\n{}",
        session.id,
        agent.id,
        agent.name,
        session_agent.id,
        workflow_session_id,
        step_id,
        stream_context
            .map(|context| context.step_key.as_str())
            .unwrap_or("none"),
        run_kind,
        prompt_kind,
        Utc::now().to_rfc3339(),
        prompt
    );
    fs::write(path, content).await?;
    Ok(())
}

fn infer_workflow_prompt_debug_kind(prompt: &str, is_follow_up: bool) -> String {
    let trimmed = prompt.trim_start();

    if let Some(rest) = trimmed.strip_prefix("Your previous workflow ") {
        if let Some((protocol_name, _)) = rest.split_once(" response") {
            return format!("protocol_retry_{}", protocol_name.trim().replace(' ', "_"));
        }
        return "protocol_retry".to_string();
    }

    if trimmed.starts_with("# Workflow Plan Generation") {
        if trimmed.contains("## Iteration Context")
            || trimmed.contains("Iteration request: user rejected")
        {
            return "iteration_feedback_plan_generation".to_string();
        }
        if trimmed.contains("Previous generation failed.") {
            return "plan_generation_retry".to_string();
        }
        if trimmed.contains("Existing workflow plan JSON:") {
            return "plan_regeneration".to_string();
        }
        return "plan_generation".to_string();
    }

    if trimmed.starts_with("You are reviewing a worker's step task output.") {
        return "lead_review".to_string();
    }

    if trimmed.contains("loop_review_result") {
        return "loop_review".to_string();
    }

    if trimmed.starts_with("You are revising a step in an workflow") {
        if trimmed.contains("## User Revision Required") {
            return "step_revision_user_feedback".to_string();
        }
        return "step_revision_review_feedback".to_string();
    }

    if trimmed.starts_with("The user has replied while workflow step") {
        return "step_follow_up_user_input".to_string();
    }

    if trimmed.starts_with("The previous attempt for workflow step") {
        return "step_follow_up_failed_restart".to_string();
    }

    if trimmed.starts_with("You are implementing a task in an workflow step.") {
        return "step_execution_task".to_string();
    }

    if trimmed.starts_with("You are reviewing the output of the workers' implementation.") {
        return "step_execution_review".to_string();
    }

    if trimmed.starts_with("You are reviewing the results of the current workflow execution.") {
        return "step_execution_result".to_string();
    }

    if is_follow_up {
        "workflow_follow_up".to_string()
    } else {
        "workflow_prompt".to_string()
    }
}

fn extract_workflow_prompt_step_key(prompt: &str) -> Option<String> {
    for marker in [
        "Fill `step_key` with `",
        "- step_key: ",
        "\"step_key\": \"",
        "step_key must stay exactly \"",
    ] {
        if let Some(value) = extract_after_marker(prompt, marker) {
            return Some(value);
        }
    }
    None
}

fn extract_after_marker(prompt: &str, marker: &str) -> Option<String> {
    let remainder = prompt.split_once(marker)?.1;
    let value = remainder
        .split(['`', '"', '\n', '\r'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(value.to_string())
}

fn sanitize_debug_prompt_filename_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "agent".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn workflow_executor_failure_message(agent_name: &str, reason: &str, history: &[LogMsg]) -> String {
    let base = format!("{reason}：{agent_name}");
    let Some(excerpt) = workflow_executor_log_excerpt(history) else {
        return base;
    };

    format!("{base}\n\nExecutor error:\n{excerpt}")
}

fn workflow_executor_log_excerpt(history: &[LogMsg]) -> Option<String> {
    if let Some(error_excerpt) = workflow_executor_error_excerpt(history) {
        return Some(error_excerpt);
    }

    let stderr = history
        .iter()
        .filter_map(|msg| match msg {
            LogMsg::Stderr(value) => Some(value.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    let stdout = history
        .iter()
        .filter_map(|msg| match msg {
            LogMsg::Stdout(value) => Some(value.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    let output = if !stderr.trim().is_empty() {
        stderr
    } else {
        stdout
    };
    let output = output.trim();
    if output.is_empty() {
        return None;
    }

    Some(tail_chars(output, WORKFLOW_EXECUTOR_ERROR_MAX_CHARS))
}

fn workflow_executor_error_excerpt(history: &[LogMsg]) -> Option<String> {
    let mut lines = Vec::new();
    let mut stream_state = WorkflowRuntimeStreamState::default();

    for msg in history {
        match msg {
            LogMsg::JsonPatch(patch) => {
                if let Some((_index, entry)) = extract_normalized_entry_from_patch(patch) {
                    collect_workflow_error_lines_from_entry(&entry, &mut lines);
                }
                for (stream_type, line) in stream_state.drain_patch_lines(patch) {
                    if matches!(stream_type, ChatStreamDeltaType::Error)
                        || workflow_executor_line_has_error_signal(&line)
                    {
                        push_workflow_error_line(&mut lines, &line);
                    }
                }
            }
            LogMsg::Stderr(value) => collect_workflow_error_lines_from_text(value, &mut lines),
            LogMsg::Stdout(value) => collect_workflow_error_lines_from_text(value, &mut lines),
            _ => {}
        }
    }

    for (stream_type, line) in stream_state.flush_pending_lines() {
        if matches!(stream_type, ChatStreamDeltaType::Error)
            || workflow_executor_line_has_error_signal(&line)
        {
            push_workflow_error_line(&mut lines, &line);
        }
    }

    if lines.is_empty() {
        return None;
    }

    let selected = lines
        .into_iter()
        .rev()
        .take(WORKFLOW_EXECUTOR_ERROR_MAX_LINES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    Some(tail_chars(&selected, WORKFLOW_EXECUTOR_ERROR_MAX_CHARS))
}

fn collect_workflow_error_lines_from_entry(entry: &NormalizedEntry, lines: &mut Vec<String>) {
    match &entry.entry_type {
        NormalizedEntryType::ErrorMessage { .. } => {
            push_workflow_error_line(lines, &entry.content);
        }
        NormalizedEntryType::ToolUse {
            tool_name,
            action_type,
            status,
        } if matches!(
            status,
            ToolStatus::Failed | ToolStatus::TimedOut | ToolStatus::Denied { .. }
        ) =>
        {
            if let Some(content) =
                workflow_tool_activity_content(tool_name, action_type, status, &entry.content)
            {
                push_workflow_error_line(lines, &content);
            }
        }
        _ => {}
    }
}

fn collect_workflow_error_lines_from_text(text: &str, lines: &mut Vec<String>) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        collect_workflow_error_lines_from_json(&value, lines);
        return;
    }

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            collect_workflow_error_lines_from_json(&value, lines);
            continue;
        }
        if workflow_executor_line_has_error_signal(line) {
            push_workflow_error_line(lines, line);
        }
    }
}

fn collect_workflow_error_lines_from_json(value: &serde_json::Value, lines: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let key_lower = key.to_ascii_lowercase();
                let is_error_key = key_lower.contains("error")
                    || key_lower == "message"
                    || key_lower == "detail"
                    || key_lower == "details"
                    || key_lower == "stderr";
                match value {
                    serde_json::Value::String(text) if is_error_key => {
                        push_workflow_error_line(lines, text);
                    }
                    serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                        collect_workflow_error_lines_from_json(value, lines);
                    }
                    _ => {}
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_workflow_error_lines_from_json(item, lines);
            }
        }
        _ => {}
    }
}

fn workflow_executor_line_has_error_signal(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    [
        "error",
        "failed",
        "failure",
        "exception",
        "traceback",
        "panic",
        "fatal",
        "denied",
        "permission",
        "timed out",
        "timeout",
        "rate limit",
        "quota",
        "unauthorized",
        "forbidden",
        "api key",
        "context length",
        "overloaded",
        "unavailable",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn push_workflow_error_line(lines: &mut Vec<String>, line: &str) {
    let normalized = line.trim();
    if normalized.is_empty() {
        return;
    }
    for line in normalized
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let line = truncate_workflow_runtime_line(line);
        if lines.last().is_some_and(|existing| existing == &line) {
            continue;
        }
        lines.push(line);
    }
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars().rev().take(max_chars).collect::<Vec<_>>();
    chars.reverse();
    let mut tail = chars.into_iter().collect::<String>();
    if value.chars().count() > max_chars {
        tail.insert_str(0, "...");
    }
    tail
}

fn latest_agent_runtime_ids(history: &[LogMsg]) -> (Option<String>, Option<String>) {
    let mut agent_session_id = None;
    let mut agent_message_id = None;

    for entry in history {
        match entry {
            LogMsg::SessionId(value) => agent_session_id = Some(value.clone()),
            LogMsg::MessageId(value) => agent_message_id = Some(value.clone()),
            _ => {}
        }
    }

    (agent_session_id, agent_message_id)
}

async fn persist_workflow_runtime_session_ids(
    pool: &SqlitePool,
    session_agent_id: Uuid,
    workflow_session: Option<&WorkflowAgentSession>,
    history: &[LogMsg],
) -> Result<(), WorkflowRuntimeError> {
    let (agent_session_id, agent_message_id) = latest_agent_runtime_ids(history);

    if let Some(agent_session_id) = agent_session_id {
        ChatSessionAgent::update_agent_session_id(
            pool,
            session_agent_id,
            Some(agent_session_id.clone()),
        )
        .await?;
        if let Some(workflow_session) = workflow_session {
            WorkflowAgentSession::update_agent_session_id(
                pool,
                workflow_session.id,
                Some(agent_session_id),
            )
            .await?;
        }
    }

    if let Some(agent_message_id) = agent_message_id {
        ChatSessionAgent::update_agent_message_id(
            pool,
            session_agent_id,
            Some(agent_message_id.clone()),
        )
        .await?;
        if let Some(workflow_session) = workflow_session {
            WorkflowAgentSession::update_agent_message_id(
                pool,
                workflow_session.id,
                Some(agent_message_id),
            )
            .await?;
        }
    }

    Ok(())
}

fn spawn_log_forwarders(
    child: &mut command_group::AsyncGroupChild,
    msg_store: Arc<MsgStore>,
) -> Result<(), WorkflowRuntimeError> {
    let stdout = child.inner().stdout.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stdout".to_string())
    })?;
    let stderr = child.inner().stderr.take().ok_or_else(|| {
        WorkflowRuntimeError::Validation("workflow child 缺少 stderr".to_string())
    })?;

    let stdout_store = msg_store.clone();
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stdout);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stdout_store.push(LogMsg::Stdout(text));
                    }
                }
                Err(err) => stdout_store.push(LogMsg::Stderr(format!("stdout error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stdout_store.push(LogMsg::Stdout(tail));
        }
    });

    let stderr_store = msg_store;
    tokio::spawn(async move {
        let mut stream = ReaderStream::new(stderr);
        let mut decoder = Utf8LossyDecoder::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = decoder.decode_chunk(&bytes);
                    if !text.is_empty() {
                        stderr_store.push(LogMsg::Stderr(text));
                    }
                }
                Err(err) => stderr_store.push(LogMsg::Stderr(format!("stderr error: {err}"))),
            }
        }

        let tail = decoder.finish();
        if !tail.is_empty() {
            stderr_store.push(LogMsg::Stderr(tail));
        }
    });

    Ok(())
}

enum ExecutorWaitEvent {
    Exit(Result<ExecutorExitResult, tokio::sync::oneshot::error::RecvError>),
    CancelRequested,
}

async fn wait_for_executor_exit_or_cancel(
    exit_signal: ExecutorExitSignal,
    cancel: Option<CancellationToken>,
) -> Result<ExecutorWaitEvent, tokio::time::error::Elapsed> {
    time::timeout(WORKFLOW_EXECUTION_TIMEOUT, async move {
        if let Some(cancel) = cancel {
            tokio::select! {
                result = exit_signal => ExecutorWaitEvent::Exit(result),
                _ = cancel.cancelled() => ExecutorWaitEvent::CancelRequested,
            }
        } else {
            ExecutorWaitEvent::Exit(exit_signal.await)
        }
    })
    .await
}

async fn wait_for_process_exit(
    spawned: &mut SpawnedChild,
    agent_name: &str,
) -> Result<std::process::ExitStatus, WorkflowRuntimeError> {
    match time::timeout(WORKFLOW_EXECUTION_TIMEOUT, spawned.child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(err)) => Err(WorkflowRuntimeError::Io(err)),
        Err(_) => {
            terminate_child(spawned).await;
            Err(WorkflowRuntimeError::Validation(format!(
                "workflow agent '{}' 执行超时",
                agent_name
            )))
        }
    }
}

async fn terminate_child(spawned: &mut SpawnedChild) {
    if let Some(cancel) = spawned.cancel.take() {
        cancel.cancel();
    }
    let _ = spawned.child.kill().await;
    let _ = time::timeout(WORKFLOW_KILL_WAIT_TIMEOUT, spawned.child.wait()).await;
}

fn extract_latest_assistant_from_history(history: &[LogMsg]) -> Option<String> {
    let mut assistant_entries: HashMap<usize, String> = HashMap::new();

    for message in history {
        let LogMsg::JsonPatch(patch) = message else {
            continue;
        };

        let Some((index, entry)) = extract_normalized_entry_from_patch(patch) else {
            continue;
        };

        if matches!(entry.entry_type, NormalizedEntryType::AssistantMessage) {
            assistant_entries.insert(index, entry.content);
        }
    }

    assistant_entries
        .into_iter()
        .max_by_key(|(index, _)| *index)
        .map(|(_, content)| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

fn extract_latest_token_usage_from_history(history: &[LogMsg]) -> Option<TokenUsageInfo> {
    let mut last_token_usage: Option<TokenUsageInfo> = None;
    let mut stdout_line_buffer = String::new();

    for message in history {
        match message {
            LogMsg::Stdout(chunk) => ChatRunner::update_token_usage_from_stdout_chunk(
                &mut stdout_line_buffer,
                &mut last_token_usage,
                chunk,
            ),
            LogMsg::JsonPatch(patch) => {
                if let Some((_, entry)) = extract_normalized_entry_from_patch(patch)
                    && let NormalizedEntryType::TokenUsageInfo(usage) = entry.entry_type
                {
                    last_token_usage = Some(usage);
                }
            }
            _ => {}
        }
    }
    ChatRunner::flush_token_usage_buffer(&mut stdout_line_buffer, &mut last_token_usage);
    last_token_usage.filter(|usage| !usage.is_estimated)
}

pub async fn run_workflow_retention_janitor(
    pool: &SqlitePool,
) -> Result<Vec<WorkflowCleanupResult>, WorkflowRuntimeError> {
    let cutoff = Utc::now() - chrono::Duration::days(WORKFLOW_CLEANUP_RETENTION_DAYS);
    let executions =
        db::models::workflow_execution::WorkflowExecution::find_completed_before(pool, &cutoff)
            .await?;

    if executions.is_empty() {
        return Ok(Vec::new());
    }

    tracing::info!(
        execution_count = executions.len(),
        "Running workflow retention janitor for completed executions older than {} days",
        WORKFLOW_CLEANUP_RETENTION_DAYS
    );

    let mut results = Vec::new();
    for execution in executions {
        let transcripts_removed =
            db::models::workflow_transcript::WorkflowTranscript::delete_non_essential_by_execution(
                pool,
                execution.id,
            )
            .await?;

        let events_removed =
            db::models::workflow_event::WorkflowEvent::delete_by_execution(pool, execution.id)
                .await?;

        let steps_cleared = db::models::workflow_step::WorkflowStep::clear_content_for_execution(
            pool,
            execution.id,
        )
        .await?;

        db::models::workflow_execution::WorkflowExecution::mark_cleaned(
            pool,
            execution.id,
            "retention_janitor",
        )
        .await?;

        tracing::info!(
            execution_id = %execution.id,
            transcripts_removed,
            events_removed,
            steps_cleared,
            "Cleaned up completed workflow execution"
        );

        results.push(WorkflowCleanupResult {
            execution_id: execution.id,
            transcripts_removed,
            events_removed,
            steps_cleared,
        });
    }

    Ok(results)
}
