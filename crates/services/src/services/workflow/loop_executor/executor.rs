impl<'a> LoopExecutor<'a> {
    pub(crate) async fn execute_ready_review(
        &self,
        workflow_loop: &WorkflowLoop,
        loop_def: &CompiledLoopDef,
    ) -> Result<LoopOutcome, OrchestratorError> {
        let active_loop = if workflow_loop.status == WorkflowLoopStatus::Running {
            workflow_loop.clone()
        } else {
            WorkflowLoop::update_status(
                self.pool,
                workflow_loop.id,
                WorkflowLoopStatus::Running,
                workflow_loop.rejection_reason.clone(),
            )
            .await?
        };

        match self.execute_loop_review(&active_loop, loop_def).await? {
            LoopReviewDecision::Passed => {
                if active_loop.user_review_required {
                    self.park_for_loop_user_review(&active_loop).await?;
                    return Ok(LoopOutcome::Parked);
                }

                let completed_loop = WorkflowLoop::update_status(
                    self.pool,
                    active_loop.id,
                    WorkflowLoopStatus::Completed,
                    None,
                )
                .await?;
                Self::emit_loop_event(
                    self.pool,
                    self.execution,
                    &completed_loop,
                    WorkflowEventType::LoopPassed,
                    None,
                )
                .await?;
                self.refresh_loop_projection(&completed_loop, "loop_passed")
                    .await?;
                Ok(LoopOutcome::Completed)
            }
            LoopReviewDecision::Rejected {
                feedback,
                step_feedbacks,
            } => {
                self.inject_feedback_to_steps(
                    &active_loop,
                    WorkflowRevisionFeedbackSource::Lead,
                    &feedback,
                    &step_feedbacks,
                )
                .await?;
                let retry_loop = WorkflowLoop::increment_retry(
                    self.pool,
                    active_loop.id,
                    WorkflowLoopStatus::Running,
                    Some(feedback.clone()),
                )
                .await?;
                Self::emit_loop_event(
                    self.pool,
                    self.execution,
                    &retry_loop,
                    WorkflowEventType::LoopRetrying,
                    Some(serde_json::json!({
                        "feedback": feedback,
                        "retry_count": retry_loop.retry_count,
                    })),
                )
                .await?;
                self.refresh_loop_projection(&retry_loop, "loop_retrying")
                    .await?;
                Ok(LoopOutcome::Progressed)
            }
        }
    }

    async fn refresh_loop_projection(
        &self,
        workflow_loop: &WorkflowLoop,
        reason: &str,
    ) -> Result<(), OrchestratorError> {
        WorkflowOrchestrator::refresh_execution_projection_with_reason(
            self.pool,
            self.chat_runner,
            self.execution.id,
            None,
            reason,
            vec![workflow_loop.review_step_id.to_string()],
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn reset_loop_steps(
        &self,
        workflow_loop: &WorkflowLoop,
    ) -> Result<Vec<WorkflowStep>, OrchestratorError> {
        let member_ids = parse_member_step_ids(&workflow_loop.member_step_ids_json)?;
        let mut reset_steps = Vec::new();
        let mut has_pending_loop_feedback = false;
        for step_id in member_ids {
            let step = WorkflowStep::find_by_id(self.pool, step_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("step {} not found", step_id))
                })?;
            let pending_loop_feedback = has_pending_feedback_for_loop(&step, workflow_loop);
            has_pending_loop_feedback |= pending_loop_feedback;
            let prepared_for_retry = pending_loop_feedback
                && matches!(
                    step.status,
                    WorkflowStepStatus::Completed
                        | WorkflowStepStatus::Failed
                        | WorkflowStepStatus::Interrupted
                        | WorkflowStepStatus::Blocked
                        | WorkflowStepStatus::Revising
                );
            let mut step = if prepared_for_retry {
                WorkflowStep::prepare_retry(self.pool, step.id).await?
            } else {
                step
            };

            if prepared_for_retry && step.status != WorkflowStepStatus::Pending {
                step = WorkflowStep::update_status(self.pool, step.id, WorkflowStepStatus::Pending)
                    .await?;
            }

            reset_steps.push(step);
        }

        let review_step = WorkflowStep::find_by_id(self.pool, workflow_loop.review_step_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "loop review step {} not found",
                    workflow_loop.review_step_id
                ))
            })?;
        if has_pending_loop_feedback && review_step.status != WorkflowStepStatus::Pending {
            let mut review_step = if matches!(
                review_step.status,
                WorkflowStepStatus::Completed
                    | WorkflowStepStatus::Failed
                    | WorkflowStepStatus::Interrupted
                    | WorkflowStepStatus::Blocked
                    | WorkflowStepStatus::Revising
            ) {
                WorkflowStep::prepare_retry(self.pool, review_step.id).await?
            } else {
                review_step
            };
            review_step =
                WorkflowStep::update_status(self.pool, review_step.id, WorkflowStepStatus::Pending)
                    .await?;
            reset_steps.push(review_step);
        }

        Ok(reset_steps)
    }

    pub(crate) async fn inject_feedback_to_steps(
        &self,
        workflow_loop: &WorkflowLoop,
        source: WorkflowRevisionFeedbackSource,
        loop_feedback: &str,
        step_feedbacks: &HashMap<String, String>,
    ) -> Result<(), OrchestratorError> {
        inject_feedback_to_steps(
            self.pool,
            workflow_loop,
            source,
            loop_feedback,
            step_feedbacks,
        )
        .await
    }

    pub(crate) async fn inject_user_feedback_to_steps(
        pool: &SqlitePool,
        workflow_loop: &WorkflowLoop,
        feedback: &str,
    ) -> Result<(), OrchestratorError> {
        inject_feedback_to_steps(
            pool,
            workflow_loop,
            WorkflowRevisionFeedbackSource::User,
            feedback,
            &HashMap::new(),
        )
        .await
    }

    pub(crate) async fn emit_loop_event(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        workflow_loop: &WorkflowLoop,
        event_type: WorkflowEventType,
        detail_json: Option<serde_json::Value>,
    ) -> Result<WorkflowEvent, OrchestratorError> {
        WorkflowEvent::create(
            pool,
            &CreateWorkflowEvent {
                execution_id: execution.id,
                round_id: Some(workflow_loop.round_id),
                step_id: Some(workflow_loop.review_step_id),
                agent_session_id: None,
                event_type,
                status_before: None,
                status_after: Some(to_workflow_wire_value(&workflow_loop.status)),
                detail_json: detail_json.map(|value| value.to_string()),
            },
            Uuid::new_v4(),
        )
        .await
        .map_err(OrchestratorError::Database)
    }

    async fn execute_loop_review(
        &self,
        workflow_loop: &WorkflowLoop,
        loop_def: &CompiledLoopDef,
    ) -> Result<LoopReviewDecision, OrchestratorError> {
        let review_step = WorkflowStep::find_by_id(self.pool, workflow_loop.review_step_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "loop review step {} not found",
                    workflow_loop.review_step_id
                ))
            })?;
        let review_step = if review_step.status == WorkflowStepStatus::Ready {
            review_step
        } else {
            WorkflowOrchestrator::transition_step_and_sync(
                self.pool,
                self.chat_runner,
                self.execution,
                &review_step,
                WorkflowStepStatus::Ready,
                "loop_review_ready",
            )
            .await?
        };
        let running_review_step = WorkflowOrchestrator::guarded_transition_step_and_sync(
            self.pool,
            self.chat_runner,
            self.execution,
            &review_step,
            WorkflowStepStatus::Running,
            "loop_review_started",
        )
        .await?
        .ok_or_else(|| {
            OrchestratorError::IllegalTransition(format!(
                "loop review step {} was already claimed",
                review_step.id
            ))
        })?;

        let workflow_session = resolve_step_workflow_session(
            self.execution,
            self.workflow_agent_sessions,
            &running_review_step,
        )?;
        let session_agent = self
            .session_agents
            .iter()
            .find(|item| item.id == workflow_session.session_agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "session agent {} not found",
                    workflow_session.session_agent_id
                ))
            })?;
        let agent = self
            .agents
            .iter()
            .find(|item| item.id == session_agent.agent_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("agent {} not found", session_agent.agent_id))
            })?;

        let workflow_goal = self
            .plan
            .summary_text
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| self.plan.title.clone());
        let review_inputs = self.review_prompt_inputs(loop_def).await?;
        let ui_config = config::load_config_from_file(&config_path()).await;
        let response_language_instruction =
            resolve_workflow_response_language_instruction(&ui_config.language);
        let prompt = build_loop_review_prompt(
            &workflow_goal,
            loop_def,
            self.execution.id,
            workflow_loop.retry_count + 1,
            &review_inputs,
            response_language_instruction,
        );
        let allowed_step_keys = review_inputs
            .iter()
            .map(|input| input.step_key.clone())
            .collect::<Vec<_>>();
        let (review_message, raw_output) = self
            .run_loop_review_protocol_with_retry(
                agent,
                session_agent,
                workflow_session,
                workflow_loop,
                &running_review_step,
                &prompt,
                &allowed_step_keys,
            )
            .await?;
        let LoopReviewProtocolMessage::LoopReviewResult {
            verdict,
            feedback,
            step_feedbacks,
            ..
        } = review_message;

        let result_summary = SummaryPayload {
            summary: feedback.clone(),
            content: Some(raw_output),
            outputs: Vec::new(),
        };
        let recorded_review_step = WorkflowStep::record_execution_result(
            self.pool,
            running_review_step.id,
            Uuid::new_v4(),
            Some(serde_json::to_string(&result_summary)?),
            Some(feedback.clone()),
        )
        .await?;
        WorkflowOrchestrator::save_step_review(
            self.pool,
            &recorded_review_step,
            ReviewerType::Lead,
            Some(agent.id.to_string()),
            verdict.clone(),
            &feedback,
        )
        .await?;

        match verdict {
            ReviewVerdict::Approved => {
                if !workflow_loop.user_review_required {
                    WorkflowOrchestrator::transition_step_and_sync(
                        self.pool,
                        self.chat_runner,
                        self.execution,
                        &recorded_review_step,
                        WorkflowStepStatus::Completed,
                        "loop_review_completed",
                    )
                    .await?;
                }
                WorkflowLoop::update_status(
                    self.pool,
                    workflow_loop.id,
                    WorkflowLoopStatus::Passed,
                    None,
                )
                .await?;
                Ok(LoopReviewDecision::Passed)
            }
            ReviewVerdict::Rejected => {
                let (event, ctx, meta) = loop_lead_review_rejected_analytics_parts(
                    self.execution,
                    recorded_review_step.id,
                );
                workflow_analytics::record_workflow_analytics_event(
                    self.chat_runner.analytics_service(),
                    event,
                    &ctx,
                    meta,
                );
                let _ = WorkflowOrchestrator::transition_step_and_sync(
                    self.pool,
                    self.chat_runner,
                    self.execution,
                    &recorded_review_step,
                    WorkflowStepStatus::Completed,
                    "loop_review_rejected",
                )
                .await?;
                WorkflowLoop::update_status(
                    self.pool,
                    workflow_loop.id,
                    WorkflowLoopStatus::Rejected,
                    Some(feedback.clone()),
                )
                .await?;
                Ok(LoopReviewDecision::Rejected {
                    feedback,
                    step_feedbacks: step_feedbacks
                        .into_iter()
                        .map(|item| (item.step_key, item.feedback))
                        .collect(),
                })
            }
        }
    }

    async fn park_for_loop_user_review(
        &self,
        workflow_loop: &WorkflowLoop,
    ) -> Result<(), OrchestratorError> {
        let review_step = WorkflowStep::find_by_id(self.pool, workflow_loop.review_step_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "loop review step {} not found",
                    workflow_loop.review_step_id
                ))
            })?;
        let waiting_step = if review_step.status == WorkflowStepStatus::WaitingInput {
            review_step
        } else {
            WorkflowOrchestrator::transition_step_and_sync(
                self.pool,
                self.chat_runner,
                self.execution,
                &review_step,
                WorkflowStepStatus::WaitingInput,
                "loop_waiting_user_review",
            )
            .await?
        };
        let workflow_session = resolve_step_workflow_session(
            self.execution,
            self.workflow_agent_sessions,
            &waiting_step,
        )?;
        let waiting_loop = WorkflowLoop::update_status(
            self.pool,
            workflow_loop.id,
            WorkflowLoopStatus::WaitingUser,
            None,
        )
        .await?;
        WorkflowOrchestrator::write_transcript(
            self.pool,
            self.execution.id,
            Some(waiting_step.round_id),
            Some(workflow_session.id),
            Some(waiting_step.id),
            "control",
            "loop_review",
            &format!("Please review loop \"{}\".", waiting_loop.loop_key),
            Some(
                &serde_json::json!({
                    "resolved": false,
                    "review_kind": "loop_user_review",
                    "loop_id": waiting_loop.id,
                    "loop_key": waiting_loop.loop_key,
                    "summary": waiting_loop.rejection_reason,
                })
                .to_string(),
            ),
        )
        .await?;
        WorkflowOrchestrator::synchronize_runtime_state(self.pool, self.execution.id, false)
            .await?;
        WorkflowOrchestrator::refresh_execution_projection(
            self.pool,
            self.chat_runner,
            self.execution.id,
            None,
        )
        .await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_loop_review_protocol_with_retry(
        &self,
        agent: &ChatAgent,
        session_agent: &ChatSessionAgent,
        workflow_session: &WorkflowAgentSession,
        workflow_loop: &WorkflowLoop,
        review_step: &WorkflowStep,
        prompt: &str,
        allowed_step_keys: &[String],
    ) -> Result<(LoopReviewProtocolMessage, String), OrchestratorError> {
        let mut attempt = 0;
        let mut run_as_follow_up = false;
        let mut prompt_to_send = prompt.to_string();

        loop {
            let active_workflow_session = if run_as_follow_up {
                WorkflowAgentSession::find_by_id(self.pool, workflow_session.id)
                    .await?
                    .ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "workflow session {} not found",
                            workflow_session.id
                        ))
                    })?
            } else {
                workflow_session.clone()
            };

            let agent_output = if run_as_follow_up {
                run_workflow_step_agent_follow_up(
                    self.db,
                    self.chat_runner,
                    self.session,
                    agent,
                    session_agent,
                    &active_workflow_session,
                    &prompt_to_send,
                    review_step,
                )
                .await?
            } else {
                run_workflow_step_agent_prompt(
                    self.db,
                    self.chat_runner,
                    self.session,
                    agent,
                    session_agent,
                    Some(&active_workflow_session),
                    &prompt_to_send,
                    review_step,
                )
                .await?
            };
            let raw_output = agent_output.output;

            match parse_loop_review_output(self.execution.id, &workflow_loop.loop_key, &raw_output)
            {
                Ok(message) => return Ok((message, raw_output)),
                Err(err)
                    if attempt < WORKFLOW_PROTOCOL_PARSE_MAX_RETRIES
                        && should_retry_workflow_protocol_parse_failure(&raw_output) =>
                {
                    tracing::warn!(
                        loop_id = %workflow_loop.id,
                        loop_key = %workflow_loop.loop_key,
                        attempt,
                        error = %err,
                        "workflow loop review protocol parse failed; retrying"
                    );
                    let schema = loop_review_protocol_json_schema(
                        self.execution.id,
                        &workflow_loop.loop_key,
                        allowed_step_keys,
                    );
                    prompt_to_send = build_workflow_protocol_retry_prompt(
                        "loop review output",
                        &schema,
                        &err.to_string(),
                        prompt,
                        &raw_output,
                    );
                    attempt += 1;
                    run_as_follow_up = true;
                }
                Err(err) => return Err(err.into()),
            }
        }
    }

    async fn review_prompt_inputs(
        &self,
        loop_def: &CompiledLoopDef,
    ) -> Result<Vec<LoopReviewPromptStepInput>, OrchestratorError> {
        let steps = WorkflowStep::find_by_execution(self.pool, self.execution.id).await?;
        let step_by_key = steps
            .iter()
            .map(|step| (step.step_key.as_str(), step))
            .collect::<HashMap<_, _>>();
        let plan_json: db::models::workflow_types::WorkflowPlanJson =
            serde_json::from_str(&self.plan.plan_json)?;

        let acceptance_by_key = plan_json
            .nodes
            .iter()
            .map(|node| {
                (
                    node.id.as_str(),
                    node.data.acceptance.clone().unwrap_or_default(),
                )
            })
            .collect::<HashMap<_, _>>();

        loop_def
            .review_scope_step_keys
            .iter()
            .map(|step_key| {
                let step = step_by_key.get(step_key.as_str()).ok_or_else(|| {
                    OrchestratorError::NotFound(format!("review scope step {} not found", step_key))
                })?;
                let payload =
                    parse_summary_payload(step.summary_text.as_deref()).unwrap_or(SummaryPayload {
                        summary: step.summary_text.clone().unwrap_or_default(),
                        content: step.content.clone(),
                        outputs: Vec::new(),
                    });
                Ok(LoopReviewPromptStepInput {
                    step_key: step.step_key.clone(),
                    title: step.title.clone(),
                    instructions: step.instructions.clone(),
                    acceptance: acceptance_by_key
                        .get(step.step_key.as_str())
                        .cloned()
                        .unwrap_or_default(),
                    summary: payload.summary,
                    content: payload
                        .content
                        .or_else(|| step.content.clone())
                        .unwrap_or_default(),
                    outputs: payload.outputs,
                })
            })
            .collect()
    }
}

pub(crate) fn parse_member_step_ids(raw: &str) -> Result<Vec<Uuid>, OrchestratorError> {
    serde_json::from_str::<Vec<Uuid>>(raw).map_err(OrchestratorError::Json)
}

fn has_pending_feedback_for_loop(step: &WorkflowStep, workflow_loop: &WorkflowLoop) -> bool {
    step.revision_context
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|context| context.get("pending_feedback").cloned())
        .is_some_and(|pending| {
            pending.get("scope").and_then(|value| value.as_str()) == Some("loop")
                && pending.get("loop_key").and_then(|value| value.as_str())
                    == Some(workflow_loop.loop_key.as_str())
        })
}

async fn inject_feedback_to_steps(
    pool: &SqlitePool,
    workflow_loop: &WorkflowLoop,
    source: WorkflowRevisionFeedbackSource,
    loop_feedback: &str,
    step_feedbacks: &HashMap<String, String>,
) -> Result<(), OrchestratorError> {
    let member_ids = parse_member_step_ids(&workflow_loop.member_step_ids_json)?;
    let member_id_set = member_ids.iter().copied().collect::<HashSet<_>>();
    let all_steps = WorkflowStep::find_by_execution(pool, workflow_loop.execution_id).await?;
    let feedback_by_step_id =
        loop_feedback_by_step_id(&all_steps, &member_id_set, step_feedbacks, loop_feedback);

    for step in all_steps
        .iter()
        .filter(|step| member_id_set.contains(&step.id))
        .filter(|step| feedback_by_step_id.contains_key(&step.id))
    {
        let previous_payload =
            parse_summary_payload(step.summary_text.as_deref()).unwrap_or(SummaryPayload {
                summary: step.title.clone(),
                content: None,
                outputs: Vec::new(),
            });
        let feedback = feedback_by_step_id
            .get(&step.id)
            .cloned()
            .unwrap_or_else(|| loop_feedback.to_string());
        let context = merge_loop_revision_context(
            step.revision_context.as_deref(),
            source,
            &feedback,
            &previous_payload.summary,
            &previous_payload.outputs,
            workflow_loop.retry_count + 1,
            &workflow_loop.loop_key,
        );
        WorkflowStep::update_revision_context(pool, step.id, Some(context)).await?;
    }

    Ok(())
}

fn loop_feedback_by_step_id(
    all_steps: &[WorkflowStep],
    member_id_set: &HashSet<Uuid>,
    step_feedbacks: &HashMap<String, String>,
    loop_feedback: &str,
) -> HashMap<Uuid, String> {
    all_steps
        .iter()
        .filter(|step| member_id_set.contains(&step.id))
        .filter_map(|step| {
            if step_feedbacks.is_empty() {
                return Some((step.id, loop_feedback.to_string()));
            }

            step_feedbacks
                .get(&step.step_key)
                .map(|feedback| (step.id, feedback.clone()))
        })
        .collect()
}

fn merge_loop_revision_context(
    existing_revision_context: Option<&str>,
    source: WorkflowRevisionFeedbackSource,
    feedback: &str,
    previous_summary: &str,
    previous_outputs: &[String],
    review_round: i32,
    loop_key: &str,
) -> String {
    let mut context = existing_revision_context
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !context.is_object() {
        context = serde_json::json!({});
    }
    let source = match source {
        WorkflowRevisionFeedbackSource::Lead => "lead",
        WorkflowRevisionFeedbackSource::User => "user",
    };
    let entry = serde_json::json!({
        "round": review_round,
        "source": source,
        "scope": "loop",
        "loop_key": loop_key,
        "feedback": feedback.trim(),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let object = context.as_object_mut().expect("revision context object");
    let history = object
        .entry("feedback_history")
        .or_insert_with(|| serde_json::json!([]));
    if !history.is_array() {
        *history = serde_json::json!([]);
    }
    history
        .as_array_mut()
        .expect("feedback history array")
        .push(entry);
    object.insert(
        "previous_summary".to_string(),
        serde_json::json!(previous_summary.trim()),
    );
    object.insert(
        "previous_outputs".to_string(),
        serde_json::json!(previous_outputs),
    );
    object.insert(
        "pending_feedback".to_string(),
        serde_json::json!({
            "source": source,
            "feedback": feedback.trim(),
            "previous_summary": previous_summary.trim(),
            "previous_outputs": previous_outputs,
            "review_round": review_round,
            "scope": "loop",
            "loop_key": loop_key,
        }),
    );
    context.to_string()
}
