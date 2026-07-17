impl<'a> IterationManager<'a> {
    pub async fn start_iteration_from_feedback(
        &self,
        execution: &WorkflowExecution,
        plan: &WorkflowPlan,
        active_revision: &WorkflowPlanRevision,
        from_round: &WorkflowRound,
        feedback_text: &str,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let feedback_detail = UserIterationFeedbackDetail {
            what_wrong: feedback_text.trim().to_string(),
            expected: "Revise the workflow plan to satisfy the user feedback.".to_string(),
            priority: Some("high".to_string()),
            additional_notes: None,
        };
        let user_feedback = UserIterationFeedback {
            execution_id: execution.id.to_string(),
            round_id: from_round.id.to_string(),
            action: "reject".to_string(),
            feedback: Some(feedback_detail),
        };

        let feedback = self
            .collect_user_feedback(execution, from_round, &user_feedback)
            .await?;
        let new_plan_json = self
            .generate_new_plan(execution, plan, active_revision, from_round, &feedback)
            .await?;
        let result = self
            .create_new_round(
                execution,
                plan,
                active_revision,
                from_round,
                &feedback,
                &new_plan_json,
            )
            .await?;

        Ok(result.execution)
    }

    pub async fn collect_user_feedback(
        &self,
        execution: &WorkflowExecution,
        from_round: &WorkflowRound,
        user_feedback: &UserIterationFeedback,
    ) -> Result<WorkflowIterationFeedback, OrchestratorError> {
        let round_steps = WorkflowStep::find_by_execution(self.pool, execution.id)
            .await?
            .into_iter()
            .filter(|step| step.round_id == from_round.id)
            .collect::<Vec<_>>();
        let summary = summarize_round_results(from_round, &round_steps);
        let user_feedback_json = serde_json::to_string(user_feedback)?;

        let feedback = WorkflowIterationFeedback::create(
            self.pool,
            &CreateWorkflowIterationFeedback {
                execution_id: execution.id,
                from_round_id: from_round.id,
                to_round_id: None,
                user_feedback_json,
                current_status_summary: summary_text(&summary),
                new_plan_diff: None,
            },
            Uuid::new_v4(),
        )
        .await?;

        emit_iteration_event(
            self.pool,
            execution,
            from_round.id,
            WorkflowEventType::IterationFeedbackReceived,
            serde_json::json!({
                "feedback_id": feedback.id,
                "round_index": from_round.round_index,
            }),
        )
        .await?;

        Ok(feedback)
    }

    pub async fn generate_new_plan(
        &self,
        execution: &WorkflowExecution,
        plan: &WorkflowPlan,
        active_revision: &WorkflowPlanRevision,
        from_round: &WorkflowRound,
        feedback: &WorkflowIterationFeedback,
    ) -> Result<WorkflowPlanJson, OrchestratorError> {
        let workflow_sessions =
            WorkflowAgentSession::find_by_execution(self.pool, execution.id).await?;
        let (lead_workflow_session, lead_session_agent, lead_agent) = resolve_lead_targets(
            execution,
            &workflow_sessions,
            self.session_agents,
            self.agents,
        )?;
        let available_agents = self
            .session_agents
            .iter()
            .map(|session_agent| {
                let workflow_agent_session = workflow_sessions
                    .iter()
                    .find(|item| item.session_agent_id == session_agent.id);
                WorkflowCardAgent {
                    session_agent_id: session_agent.id.to_string(),
                    workflow_agent_session_id: workflow_agent_session
                        .map(|item| item.id.to_string()),
                    agent_id: workflow_plan_agent_id(session_agent),
                    name: session_agent.member_name.clone(),
                }
            })
            .collect::<Vec<_>>();
        let history = WorkflowIterationFeedback::find_by_execution(self.pool, execution.id).await?;
        let original_plan: WorkflowPlanJson = serde_json::from_str(&active_revision.plan_json)?;
        let ui_config = config::load_config_from_file(&config_path()).await;
        let response_language_instruction =
            resolve_workflow_response_language_instruction(&ui_config.language);
        let prompt = build_iteration_plan_prompt(
            &plan
                .summary_text
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| plan.title.clone()),
            &feedback.current_status_summary,
            &feedback.user_feedback_json,
            from_round.round_index,
            &history,
            &workflow_plan_agent_id(lead_session_agent),
            &available_agents,
            &original_plan,
            response_language_instruction,
        );

        tracing::debug!("Generated iteration plan prompt: {}", prompt);

        let raw_output = run_workflow_agent_prompt(
            self.db,
            self.session,
            lead_agent,
            lead_session_agent,
            Some(lead_workflow_session),
            &prompt,
            Uuid::new_v4(),
        )
        .await?;

        tracing::debug!(
            "Raw output from workflow agent for iteration plan generation: {}",
            raw_output
        );
        let payload = extract_json_payload(&raw_output).unwrap_or(raw_output);
        let plan_json: WorkflowPlanJson = serde_json::from_str(&payload)?;
        let valid_agent_ids = workflow_valid_agent_ids(self.session_agents);
        WorkflowCompiler::compile(&plan_json, &valid_agent_ids)?;

        Ok(plan_json)
    }

    pub async fn create_new_round(
        &self,
        execution: &WorkflowExecution,
        plan: &WorkflowPlan,
        active_revision: &WorkflowPlanRevision,
        from_round: &WorkflowRound,
        feedback: &WorkflowIterationFeedback,
        new_plan_json: &WorkflowPlanJson,
    ) -> Result<IterationRoundCreation, OrchestratorError> {
        let new_plan_string = serde_json::to_string(new_plan_json)?;
        let valid_agent_ids = workflow_valid_agent_ids(self.session_agents);
        let compiled = WorkflowCompiler::compile(new_plan_json, &valid_agent_ids)?;
        let latest_revision = WorkflowPlanRevision::find_latest_by_plan(self.pool, plan.id)
            .await?
            .unwrap_or_else(|| active_revision.clone());
        let revision = WorkflowPlanRevision::create(
            self.pool,
            &CreateWorkflowPlanRevision {
                plan_id: plan.id,
                revision_no: latest_revision.revision_no + 1,
                edited_by: WorkflowRevisionEditor::Lead,
                editor_session_agent_id: execution.lead_session_agent_id,
                reason: Some("iteration feedback rejected previous round".to_string()),
                plan_json: new_plan_string,
                plan_hash: WorkflowCompiler::compute_hash(new_plan_json),
                validation_status: WorkflowValidationStatus::Valid,
                validation_errors_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;

        WorkflowRound::update_status(self.pool, from_round.id, WorkflowRoundStatus::Rejected)
            .await?;
        let round = WorkflowRound::create(
            self.pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: execution.current_round + 1,
                source_revision_id: Some(revision.id),
            },
            Uuid::new_v4(),
        )
        .await?;

        let execution = WorkflowExecution::update_compiled_graph_hash(
            self.pool,
            execution.id,
            &compiled.compiled_graph_hash,
            revision.id,
        )
        .await?;
        let execution = WorkflowExecution::update_active_round(
            self.pool,
            execution.id,
            round.id,
            round.round_index,
        )
        .await?;

        let mut workflow_agent_sessions =
            WorkflowAgentSession::find_by_execution(self.pool, execution.id).await?;
        let mut workflow_session_by_session_agent_id = workflow_agent_sessions
            .iter()
            .map(|session| (session.session_agent_id, session.id))
            .collect::<HashMap<_, _>>();
        let agent_id_map = workflow_agent_id_map(self.session_agents);

        for compiled_step in &compiled.steps {
            let Some(agent_id) = compiled_step.assigned_agent_id.as_ref() else {
                continue;
            };
            let Some(session_agent_id) = agent_id_map.get(agent_id).copied() else {
                continue;
            };
            if workflow_session_by_session_agent_id.contains_key(&session_agent_id) {
                continue;
            }
            let role = if Some(session_agent_id) == execution.lead_session_agent_id {
                WorkflowAgentSessionRole::Lead
            } else {
                WorkflowAgentSessionRole::Worker
            };
            let workflow_session = WorkflowAgentSession::create(
                self.pool,
                &CreateWorkflowAgentSession {
                    workflow_execution_id: execution.id,
                    session_agent_id,
                    role,
                },
                Uuid::new_v4(),
            )
            .await?;
            workflow_session_by_session_agent_id.insert(session_agent_id, workflow_session.id);
            workflow_agent_sessions.push(workflow_session);
        }

        let lead_workflow_session_id =
            execution
                .lead_session_agent_id
                .and_then(|lead_session_agent_id| {
                    workflow_session_by_session_agent_id
                        .get(&lead_session_agent_id)
                        .copied()
                });

        let step_id_map = compiled
            .steps
            .iter()
            .map(|step| (step.step_key.clone(), Uuid::new_v4()))
            .collect::<HashMap<_, _>>();
        let mut created_steps = Vec::new();
        for compiled_step in &compiled.steps {
            let step_id = *step_id_map.get(&compiled_step.step_key).ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "step {} missing preallocated id",
                    compiled_step.step_key
                ))
            })?;
            let assigned_ws_id = compiled_step
                .assigned_agent_id
                .as_ref()
                .and_then(|agent_id| agent_id_map.get(agent_id))
                .and_then(|session_agent_id| {
                    workflow_session_by_session_agent_id.get(session_agent_id)
                })
                .copied()
                .or(lead_workflow_session_id);
            let (lead_review_required, user_review_required) =
                if compiled_step.step_type == WorkflowStepType::Review {
                    (Some(false), Some(false))
                } else {
                    (None, None)
                };
            let step = WorkflowStep::create(
                self.pool,
                &CreateWorkflowStep {
                    execution_id: execution.id,
                    round_id: round.id,
                    compiled_revision_id: Some(revision.id),
                    step_key: compiled_step.step_key.clone(),
                    step_type: compiled_step.step_type.clone(),
                    title: compiled_step.title.clone(),
                    instructions: compiled_step.instructions.clone(),
                    assigned_workflow_agent_session_id: assigned_ws_id,
                    max_retry: compiled_step.max_retry as i32,
                    round_index: round.round_index,
                    display_order: compiled_step.display_order,
                    loop_id: None,
                    lead_review_required,
                    user_review_required,
                    revision_context: None,
                },
                step_id,
            )
            .await?;
            created_steps.push(step);
        }

        let mut created_loops = Vec::new();
        if let Some(loop_defs) = compiled.loops.as_ref() {
            for loop_def in loop_defs {
                let review_step_id =
                    *step_id_map.get(&loop_def.review_step_key).ok_or_else(|| {
                        OrchestratorError::NotFound(format!(
                            "loop review step {} not found",
                            loop_def.review_step_key
                        ))
                    })?;
                let member_step_ids = loop_def
                    .member_step_keys
                    .iter()
                    .map(|step_key| {
                        step_id_map.get(step_key).copied().ok_or_else(|| {
                            OrchestratorError::NotFound(format!(
                                "loop member step {} not found",
                                step_key
                            ))
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let workflow_loop = WorkflowLoop::create(
                    self.pool,
                    &CreateWorkflowLoop {
                        execution_id: execution.id,
                        round_id: round.id,
                        loop_key: loop_def.loop_key.clone(),
                        review_step_id,
                        member_step_ids_json: serde_json::to_string(&member_step_ids)?,
                        max_retry: Some(loop_def.max_retry as i32),
                        user_review_required: Some(loop_def.user_review_required),
                        rejection_reason: None,
                    },
                    Uuid::new_v4(),
                )
                .await?;
                for step_id in member_step_ids
                    .into_iter()
                    .chain(std::iter::once(review_step_id))
                {
                    let updated_step =
                        WorkflowStep::update_loop_id(self.pool, step_id, Some(workflow_loop.id))
                            .await?;
                    if let Some(step) = created_steps.iter_mut().find(|step| step.id == step_id) {
                        *step = updated_step;
                    }
                }
                created_loops.push(workflow_loop);
            }
        }

        let mut created_edges = Vec::new();
        for compiled_edge in &compiled.edges {
            let from_id = step_id_map
                .get(&compiled_edge.from_step_key)
                .copied()
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "step {} not found",
                        compiled_edge.from_step_key
                    ))
                })?;
            let to_id = step_id_map
                .get(&compiled_edge.to_step_key)
                .copied()
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "step {} not found",
                        compiled_edge.to_step_key
                    ))
                })?;
            created_edges.push(
                WorkflowStepEdge::create(
                    self.pool,
                    &CreateWorkflowStepEdge {
                        execution_id: execution.id,
                        compiled_revision_id: Some(revision.id),
                        from_step_id: from_id,
                        to_step_id: to_id,
                        edge_kind: compiled_edge.edge_kind.clone(),
                    },
                    Uuid::new_v4(),
                )
                .await?,
            );
        }

        let loop_step_keys = compiled
            .loops
            .as_ref()
            .map(|loops| {
                loops
                    .iter()
                    .flat_map(|loop_def| {
                        loop_def
                            .member_step_keys
                            .iter()
                            .chain(std::iter::once(&loop_def.review_step_key))
                    })
                    .cloned()
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();
        for ready_key in &compiled.ready_step_keys {
            if loop_step_keys.contains(ready_key) {
                continue;
            }
            let Some(step_id) = step_id_map.get(ready_key).copied() else {
                continue;
            };
            if let Some(step) = created_steps
                .iter()
                .find(|step| step.id == step_id)
                .cloned()
            {
                let ready = reducer::transition_step(
                    self.pool,
                    &execution,
                    &step,
                    WorkflowStepStatus::Ready,
                )
                .await?
                .entity;
                if let Some(existing) = created_steps.iter_mut().find(|step| step.id == step_id) {
                    *existing = ready;
                }
            }
        }

        let feedback = WorkflowIterationFeedback::update_generated_plan(
            self.pool,
            feedback.id,
            round.id,
            Some(plan_diff_summary(active_revision, &revision)),
        )
        .await?;

        emit_iteration_event(
            self.pool,
            &execution,
            round.id,
            WorkflowEventType::IterationNewPlanGenerated,
            serde_json::json!({
                "feedback_id": feedback.id,
                "revision_id": revision.id,
                "round_id": round.id,
                "round_index": round.round_index,
            }),
        )
        .await?;

        let execution =
            WorkflowOrchestrator::synchronize_runtime_state(self.pool, execution.id, false).await?;
        WorkflowOrchestrator::refresh_execution_projection(
            self.pool,
            self.chat_runner,
            execution.id,
            None,
        )
        .await?;

        Ok(IterationRoundCreation {
            execution,
            revision,
            round,
            steps: created_steps,
            edges: created_edges,
            loops: created_loops,
            feedback,
        })
    }
}

fn resolve_lead_targets<'a>(
    execution: &WorkflowExecution,
    workflow_sessions: &'a [WorkflowAgentSession],
    session_agents: &'a [ChatSessionAgent],
    agents: &'a [ChatAgent],
) -> Result<
    (
        &'a WorkflowAgentSession,
        &'a ChatSessionAgent,
        &'a ChatAgent,
    ),
    OrchestratorError,
> {
    let lead_session_agent_id = execution.lead_session_agent_id.ok_or_else(|| {
        OrchestratorError::NotFound(format!(
            "execution {} missing lead session agent",
            execution.id
        ))
    })?;
    let workflow_session = workflow_sessions
        .iter()
        .find(|session| session.session_agent_id == lead_session_agent_id)
        .ok_or_else(|| {
            OrchestratorError::NotFound(format!(
                "execution {} missing lead workflow session",
                execution.id
            ))
        })?;
    let session_agent = session_agents
        .iter()
        .find(|item| item.id == workflow_session.session_agent_id)
        .ok_or_else(|| {
            OrchestratorError::NotFound(format!(
                "lead session agent {} not found",
                workflow_session.session_agent_id
            ))
        })?;
    let agent = agents
        .iter()
        .find(|item| item.id == session_agent.agent_id)
        .ok_or_else(|| {
            OrchestratorError::NotFound(format!("agent {} not found", session_agent.agent_id))
        })?;
    Ok((workflow_session, session_agent, agent))
}

async fn emit_iteration_event(
    pool: &SqlitePool,
    execution: &WorkflowExecution,
    round_id: Uuid,
    event_type: WorkflowEventType,
    detail_json: serde_json::Value,
) -> Result<WorkflowEvent, OrchestratorError> {
    WorkflowEvent::create(
        pool,
        &CreateWorkflowEvent {
            execution_id: execution.id,
            round_id: Some(round_id),
            step_id: None,
            agent_session_id: None,
            event_type,
            status_before: None,
            status_after: Some(format!("{:?}", execution.status).to_lowercase()),
            detail_json: Some(detail_json.to_string()),
        },
        Uuid::new_v4(),
    )
    .await
    .map_err(OrchestratorError::Database)
}
