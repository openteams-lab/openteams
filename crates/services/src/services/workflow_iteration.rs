#![allow(clippy::too_many_arguments)]

use std::collections::{HashMap, HashSet};

use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::{CreateWorkflowAgentSession, WorkflowAgentSession},
        workflow_event::{CreateWorkflowEvent, WorkflowEvent},
        workflow_execution::WorkflowExecution,
        workflow_iteration_feedback::{CreateWorkflowIterationFeedback, WorkflowIterationFeedback},
        workflow_loop::{CreateWorkflowLoop, WorkflowLoop},
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::{CreateWorkflowPlanRevision, WorkflowPlanRevision},
        workflow_round::{CreateWorkflowRound, WorkflowRound},
        workflow_step::{CreateWorkflowStep, WorkflowStep},
        workflow_step_edge::{CreateWorkflowStepEdge, WorkflowStepEdge},
        workflow_types::{
            WorkflowAgentSessionRole, WorkflowEventType, WorkflowPlanJson, WorkflowRevisionEditor,
            WorkflowRoundStatus, WorkflowStepStatus, WorkflowValidationStatus,
        },
    },
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;
use utils::assets::config_path;
use uuid::Uuid;

use super::{
    chat_runner::ChatRunner,
    config,
    workflow_compiler::WorkflowCompiler,
    workflow_orchestrator::{OrchestratorError, WorkflowOrchestrator, reducer},
    workflow_runtime::{
        SummaryPayload, WorkflowCardAgent, extract_json_payload, parse_summary_payload,
        resolve_workflow_response_language_instruction, run_workflow_agent_prompt,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserIterationFeedbackDetail {
    pub what_wrong: String,
    pub expected: String,
    pub priority: Option<String>,
    pub additional_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UserIterationFeedback {
    pub execution_id: String,
    pub round_id: String,
    pub action: String,
    pub feedback: Option<UserIterationFeedbackDetail>,
}

#[derive(Debug, Clone)]
pub struct IterationRoundSummary {
    pub round_index: i32,
    pub status: String,
    pub result_summary: Option<String>,
    pub outputs: Vec<String>,
    pub step_summaries: Vec<String>,
}

pub struct IterationManager<'a> {
    pub db: &'a DBService,
    pub pool: &'a SqlitePool,
    pub chat_runner: &'a ChatRunner,
    pub session: &'a ChatSession,
    pub session_agents: &'a [ChatSessionAgent],
    pub agents: &'a [ChatAgent],
}

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
            .filter_map(|session_agent| {
                let agent = self
                    .agents
                    .iter()
                    .find(|agent| agent.id == session_agent.agent_id)?;
                let workflow_agent_session = workflow_sessions
                    .iter()
                    .find(|item| item.session_agent_id == session_agent.id);
                Some(WorkflowCardAgent {
                    session_agent_id: session_agent.id.to_string(),
                    workflow_agent_session_id: workflow_agent_session
                        .map(|item| item.id.to_string()),
                    agent_id: agent.id.to_string(),
                    name: agent.name.clone(),
                })
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
            &lead_agent.id.to_string(),
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
        let valid_agent_ids = self
            .agents
            .iter()
            .map(|agent| agent.id.to_string())
            .collect::<Vec<_>>();
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
        let valid_agent_ids = self
            .agents
            .iter()
            .map(|agent| agent.id.to_string())
            .collect::<Vec<_>>();
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
        let agent_id_map = self
            .session_agents
            .iter()
            .map(|session_agent| (session_agent.agent_id.to_string(), session_agent.id))
            .collect::<HashMap<_, _>>();

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
                    lead_review_required: None,
                    user_review_required: None,
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

#[derive(Debug, Clone)]
pub struct IterationRoundCreation {
    pub execution: WorkflowExecution,
    pub revision: WorkflowPlanRevision,
    pub round: WorkflowRound,
    pub steps: Vec<WorkflowStep>,
    pub edges: Vec<WorkflowStepEdge>,
    pub loops: Vec<WorkflowLoop>,
    pub feedback: WorkflowIterationFeedback,
}

pub fn summarize_round_results(
    round: &WorkflowRound,
    steps: &[WorkflowStep],
) -> IterationRoundSummary {
    let mut outputs = Vec::new();
    let mut step_summaries = Vec::new();
    let mut result_summary = None;

    for step in steps.iter().filter(|step| step.round_id == round.id) {
        let payload =
            parse_summary_payload(step.summary_text.as_deref()).unwrap_or(SummaryPayload {
                summary: step
                    .summary_text
                    .clone()
                    .unwrap_or_else(|| step.title.clone()),
                content: step.content.clone(),
                outputs: Vec::new(),
            });
        outputs.extend(payload.outputs.clone());
        if step.step_type == db::models::workflow_types::WorkflowStepType::Result {
            result_summary = Some(payload.summary.clone());
        }
        step_summaries.push(format!(
            "- [{}] {}: {:?} - {}",
            step.step_key, step.title, step.status, payload.summary
        ));
    }

    IterationRoundSummary {
        round_index: round.round_index,
        status: format!("{:?}", round.status).to_lowercase(),
        result_summary,
        outputs,
        step_summaries,
    }
}

pub fn build_iteration_plan_prompt(
    original_goal: &str,
    current_state_summary: &str,
    user_feedback_json: &str,
    iteration_round: i32,
    history: &[WorkflowIterationFeedback],
    lead_agent_id: &str,
    available_agents: &[WorkflowCardAgent],
    _previous_plan: &WorkflowPlanJson,
    response_language_instruction: &str,
) -> String {
    let history_text = if history.is_empty() {
        "None".to_string()
    } else {
        history
            .iter()
            .map(|item| {
                format!(
                    "- feedback_id={} from_round={} to_round={:?}: {}",
                    item.id, item.from_round_id, item.to_round_id, item.user_feedback_json
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let available_agents_json =
        serde_json::to_string_pretty(available_agents).unwrap_or_else(|_| "[]".to_string());
    let feedback_text = format_iteration_feedback(user_feedback_json);

    let plan_schema_definition = r#"{
  "version": "1",
  "title": "string",
  "goal": "string",
  "agents": {
    "lead": "string",
    "available": ["string"]
  },
  "globals": {
    "interrupt_mode": "cooperative",
    "default_retry": 1,
    "global_pause_supported": true
  },
  "nodes": [
    {
      "id": "unique_step_key",
      "type": "workflowStep",
      "data": {
        "stepType": "task | review | result",
        "agentId": "optional string",
        "title": "string",
        "instructions": "string",
        "acceptance": ["optional string"],
        "outputs": ["optional string"],
        "interruptible": true,
        "status": "optional string",
        "reviewScope": ["optional node_id list, review nodes only"]
      }
    }
  ],
  "edges": [
    {
      "id": "unique_edge_id",
      "source": "node_id",
      "target": "node_id",
      "type": "optional string",
      "data": {
        "kind": "hard | soft"
      }
    }
  ],
  "policies": {
    "approval_required_on": ["optional string"],
    "permission_required_on": ["optional string"],
    "on_failure": "optional string",
    "allow_plan_revision": true
  }
}"#;

    let next_round = iteration_round + 1;

    let mut prompt = String::new();
    prompt.push_str(&format!(
        r#"# Workflow Plan Generation

You are generating an executable workflow plan from a confirmed implementation brief.
This generation is for workflow iteration round {next_round}: the previous workflow round completed but the user rejected the result.
The output source of truth is React Flow compatible workflow JSON. Do not output Markdown, YAML, comments, explanations, or prose outside the JSON object.

## Stable Output Contract

Return exactly one workflow plan JSON object.

Hard requirements:
1. Top-level structure must match the WorkflowPlanJson schema and include at least `version`, `title`, `goal`, `agents`, `nodes`, and `edges`.
2. `version` must be the string `"1"`.
3. Every `nodes[].type` must be `"workflowStep"`.
4. `nodes[].data.stepType` may only be `"task"`, `"review"`, or `"result"`.
5. There must be exactly one `result` node, and that result node must have no outgoing edges.
6. All node ids, edge ids, and step keys must be unique.
7. The graph must be a directed acyclic graph. Dependencies must be represented only through `edges`.
8. `agents.lead`, `agents.available`, and `nodes[].data.agentId` may only use the provided agent ids.
9. Leave `nodes[].data.agentId` empty or omit it only when a step does not need a specific agent. Never invent agent ids.
10. Node `title` and `instructions` must be concrete, actionable, and specific enough for an agent to execute.
11. Prefer the smallest executable closed loop that can satisfy the goal. Avoid unnecessary step expansion.
12. Use `stepType: "review"` when execution-review-revision iteration is needed.
13. A review node with a non-empty `reviewScope` creates a retry loop. `reviewScope` is the list of **task** node ids to re-run on rejection. All listed tasks must be upstream predecessors; include any intermediate tasks between a scoped task and the review. Each task may appear in at most one `reviewScope`. Never include result/review/unknown ids or downstream nodes.
14. Do not output or infer `leadReview` or `userReview`. The system writes those fields from frontend card selections.
15. Retry counts are not controlled by the plan JSON.
16. Your output is validated, compiled, and may start execution directly. Schema errors, cyclic dependencies, invalid agent references, invalid `agents.available`, or missing result nodes will fail this generation.

## WorkflowPlanJson Schema Reference

"#
    ));
    prompt.push_str(plan_schema_definition);
    prompt.push_str(
        r#"

## Additional Static Constraints

- `version` must be string `"1"`.
- `agents.available` and `nodes[].data.agentId` may only use the provided `agent_id` values.
- `globals`, `policies`, and optional node/edge fields may be omitted when unnecessary.
- `reviewScope` rules: task-only ids, upstream predecessors only, include intermediates, each task in at most one scope, no result/review/unknown/downstream ids. If two loops need similar work, split into separate tasks or keep shared setup outside `reviewScope`.

## Recommended Skills
- For tasks that include coding, please ensure you utilize the `writing-plans` skill.
- For general non-coding tasks, use the planning-mode skill.
- In case of any discrepancy with the skill's format, the specified JSON schema shall prevail.
- Store the generated plan details in the nodes[].data.instructions field of the workflow plan JSON, using Markdown format.

## Dynamic Inputs

"#,
    );

    prompt.push_str("Response language requirement:\n");
    prompt.push_str(response_language_instruction.trim());
    prompt.push_str("\n\nPlan goal brief:\n");
    prompt.push_str(original_goal.trim());
    prompt.push_str("\n\nLead agent id:\n");
    prompt.push_str(lead_agent_id);
    prompt.push_str("\n\nAvailable agents JSON:\n");
    prompt.push_str(&available_agents_json);

    prompt.push_str("\n\n## Iteration Context\n\n");
    prompt.push_str(&format!(
        "Iteration request: user rejected the previous round and requested a revised plan for round {next_round}. Preserve correct work; change only what the feedback requires.\n"
    ));
    prompt.push_str("\n### Previous Round State\n");
    prompt.push_str(current_state_summary.trim());
    prompt.push_str("\n\n### User Feedback (reason for rejection)\n");
    prompt.push_str(&feedback_text);
    prompt.push_str("\n\n### Iteration History\n");
    prompt.push_str(&history_text);

    prompt.push_str("\n\nFinal instruction: return the workflow plan JSON object only.");
    prompt
}

fn format_iteration_feedback(user_feedback_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(user_feedback_json) else {
        return user_feedback_json.trim().to_string();
    };
    let Some(feedback) = value.get("feedback").and_then(|item| item.as_object()) else {
        return serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| user_feedback_json.trim().to_string());
    };

    let mut lines = Vec::new();
    for key in ["what_wrong", "expected", "priority", "additional_notes"] {
        if let Some(text) = feedback.get(key).and_then(|item| item.as_str())
            && !text.trim().is_empty()
        {
            lines.push(format!("- {key}: {}", text.trim()));
        }
    }

    if lines.is_empty() {
        serde_json::to_string_pretty(&value)
            .unwrap_or_else(|_| user_feedback_json.trim().to_string())
    } else {
        lines.join("\n")
    }
}

fn summary_text(summary: &IterationRoundSummary) -> String {
    format!(
        "Round {} status: {}\nResult: {}\nSteps:\n{}\nOutputs: {}",
        summary.round_index,
        summary.status,
        summary
            .result_summary
            .clone()
            .unwrap_or_else(|| "None".to_string()),
        summary.step_summaries.join("\n"),
        if summary.outputs.is_empty() {
            "None".to_string()
        } else {
            summary.outputs.join(", ")
        }
    )
}

fn plan_diff_summary(previous: &WorkflowPlanRevision, next: &WorkflowPlanRevision) -> String {
    format!(
        "revision {} -> {}; hash {} -> {}",
        previous.revision_no, next.revision_no, previous.plan_hash, next.plan_hash
    )
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

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::workflow_types::{
        WorkflowPlanAgents, WorkflowPlanJson, WorkflowRoundStatus, WorkflowStepType,
    };

    use super::*;

    fn sample_round() -> WorkflowRound {
        let now = Utc::now();
        WorkflowRound {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            round_index: 1,
            source_revision_id: Some(Uuid::new_v4()),
            status: WorkflowRoundStatus::Rejected,
            result_step_id: None,
            user_decision_summary: None,
            started_at: Some(now),
            completed_at: None,
            archived_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_step(
        round: &WorkflowRound,
        step_key: &str,
        step_type: WorkflowStepType,
    ) -> WorkflowStep {
        let now = Utc::now();
        WorkflowStep {
            id: Uuid::new_v4(),
            execution_id: round.execution_id,
            round_id: round.id,
            compiled_revision_id: round.source_revision_id,
            step_key: step_key.to_string(),
            step_type,
            title: format!("Step {step_key}"),
            instructions: "Do the work".to_string(),
            assigned_workflow_agent_session_id: None,
            status: WorkflowStepStatus::Completed,
            retry_count: 0,
            max_retry: 1,
            round_index: round.round_index,
            display_order: 0,
            latest_run_id: Some(Uuid::new_v4()),
            summary_text: Some(
                serde_json::json!({
                    "summary": format!("{step_key} summary"),
                    "content": format!("{step_key} content"),
                    "outputs": [format!("out/{step_key}.md")]
                })
                .to_string(),
            ),
            content: Some(format!("{step_key} content")),
            loop_id: None,
            lead_review_required: true,
            user_review_required: false,
            revision_context: None,
            created_at: now,
            updated_at: now,
            started_at: Some(now),
            completed_at: Some(now),
        }
    }

    fn sample_plan() -> WorkflowPlanJson {
        WorkflowPlanJson {
            version: "1".to_string(),
            title: "Iteration Plan".to_string(),
            goal: "Ship the improved result".to_string(),
            agents: WorkflowPlanAgents {
                lead: "lead-agent".to_string(),
                available: vec!["lead-agent".to_string(), "worker-agent".to_string()],
            },
            globals: None,
            viewport: None,
            nodes: Vec::new(),
            edges: Vec::new(),
            loops: None,
            policies: None,
        }
    }

    fn sample_card_agents() -> Vec<WorkflowCardAgent> {
        vec![
            WorkflowCardAgent {
                session_agent_id: "lead-session-agent".to_string(),
                workflow_agent_session_id: Some("lead-workflow-session".to_string()),
                agent_id: "lead-agent".to_string(),
                name: "Lead".to_string(),
            },
            WorkflowCardAgent {
                session_agent_id: "worker-session-agent".to_string(),
                workflow_agent_session_id: Some("worker-workflow-session".to_string()),
                agent_id: "worker-agent".to_string(),
                name: "Worker".to_string(),
            },
        ]
    }

    #[test]
    fn summarize_round_results_collects_steps_result_and_outputs() {
        let round = sample_round();
        let steps = vec![
            sample_step(&round, "draft", WorkflowStepType::Task),
            sample_step(&round, "result", WorkflowStepType::Result),
        ];

        let summary = summarize_round_results(&round, &steps);

        assert_eq!(summary.round_index, 1);
        assert_eq!(summary.result_summary.as_deref(), Some("result summary"));
        assert!(
            summary
                .step_summaries
                .iter()
                .any(|line| line.contains("[draft]"))
        );
        assert!(summary.outputs.contains(&"out/draft.md".to_string()));
        assert!(summary.outputs.contains(&"out/result.md".to_string()));
    }

    #[test]
    fn build_iteration_plan_prompt_includes_feedback_history_and_agents() {
        let round = sample_round();
        let feedback = WorkflowIterationFeedback {
            id: Uuid::new_v4(),
            execution_id: round.execution_id,
            from_round_id: round.id,
            to_round_id: None,
            user_feedback_json: serde_json::json!({
                "action": "reject",
                "feedback": {
                    "what_wrong": "Missing tests",
                    "expected": "Add regression coverage",
                    "priority": "high"
                }
            })
            .to_string(),
            current_status_summary: "Round 1 completed without tests".to_string(),
            new_plan_diff: None,
            created_at: Utc::now(),
        };

        let prompt = build_iteration_plan_prompt(
            "Ship a stable workflow",
            &feedback.current_status_summary,
            &feedback.user_feedback_json,
            1,
            std::slice::from_ref(&feedback),
            "lead-agent",
            &sample_card_agents(),
            &sample_plan(),
            "You MUST write human-readable JSON string values in English.",
        );

        assert!(prompt.contains("Workflow Plan Generation"));
        assert!(prompt.contains("workflow iteration round 2"));
        assert!(prompt.contains("Iteration request: user rejected the previous round"));
        assert!(prompt.contains("requested a revised plan for round 2"));
        assert!(prompt.contains("Ship a stable workflow"));
        assert!(prompt.contains("Round 1 completed without tests"));
        assert!(prompt.contains("- what_wrong: Missing tests"));
        assert!(prompt.contains("- expected: Add regression coverage"));
        assert!(prompt.contains("Available agents JSON"));
        assert!(prompt.contains("lead-agent"));
        assert!(prompt.contains("worker-agent"));
        assert!(prompt.contains("Return exactly one workflow plan JSON object"));
        assert!(prompt.contains("Final instruction: return the workflow plan JSON object only."));
    }
}
