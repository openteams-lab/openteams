//! Workflow Orchestrator 骨架
//!
//! 核心职责：
//! - command handler: 接收 bootstrap 命令并创建 execution 图
//! - scheduler loop: 协调 step 与 loop 的执行
//! - state reducer: 集中管理执行/步骤/agent session 状态迁移（见 `reducer`）
//! - event projector: 审计事件由 reducer 自动写入
//!
//! 其余功能（projection 刷新、retry/resume、step 输入处理、review 流程、
//! 计划/卡片创建、step executor 等）位于本目录下的同级子模块中。

#![allow(
    clippy::large_enum_variant,
    clippy::too_many_arguments,
    clippy::type_complexity
)]

pub mod reducer;

mod plan_control;
mod projection;
mod retry_resume;
mod review;
mod step_executor;
mod step_input;
mod transcript_actions;

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use db::{
    DBService,
    models::{
        chat_agent::ChatAgent,
        chat_session::ChatSession,
        chat_session_agent::ChatSessionAgent,
        workflow_agent_session::{CreateWorkflowAgentSession, WorkflowAgentSession},
        workflow_event::{CreateWorkflowEvent, WorkflowEvent},
        workflow_execution::{CreateWorkflowExecution, WorkflowExecution},
        workflow_loop::{CreateWorkflowLoop, WorkflowLoop},
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_round::{CreateWorkflowRound, WorkflowRound},
        workflow_step::{CreateWorkflowStep, WorkflowStep},
        workflow_step_edge::{CreateWorkflowStepEdge, WorkflowStepEdge},
        workflow_types::*,
    },
};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::{
    chat_runner::{ChatRunner, ChatRunnerError},
    workflow_analytics,
    workflow_compiler::WorkflowCompiler,
    workflow_loop_executor::{LoopExecutor, LoopOutcome},
    workflow_runtime::WorkflowRuntimeError,
};

/// Orchestrator 错误
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),
    #[error("编译错误: {0}")]
    Compile(#[from] super::workflow_compiler::CompileError),
    #[error("运行时错误: {0}")]
    Runtime(#[from] WorkflowRuntimeError),
    #[error("JSON 错误: {0}")]
    Json(#[from] serde_json::Error),
    #[error("聊天服务错误: {0}")]
    Chat(#[from] super::chat::ChatServiceError),
    #[error("聊天运行器错误: {0}")]
    ChatRunner(#[from] ChatRunnerError),
    #[error("状态迁移非法: {0}")]
    IllegalTransition(String),
    #[error("未找到资源: {0}")]
    NotFound(String),
}

impl From<reducer::TransitionError> for OrchestratorError {
    fn from(e: reducer::TransitionError) -> Self {
        OrchestratorError::IllegalTransition(e.to_string())
    }
}

/// Bootstrap 结果
#[derive(Debug)]
pub struct BootstrapResult {
    pub execution: WorkflowExecution,
    pub round: Option<WorkflowRound>,
    pub steps: Vec<WorkflowStep>,
    pub edges: Vec<WorkflowStepEdge>,
    pub agent_sessions: Vec<WorkflowAgentSession>,
    pub events: Vec<WorkflowEvent>,
    pub failed: bool,
    pub failure_reason: Option<String>,
}

#[derive(Debug)]
pub struct ResolvedTranscriptAction {
    pub transcript: db::models::workflow_transcript::WorkflowTranscript,
    pub execution: WorkflowExecution,
    pub should_wake_scheduler: bool,
}

#[derive(Debug)]
pub struct IterationFeedbackOutcome {
    pub execution: WorkflowExecution,
    pub should_wake_scheduler: bool,
}

/// Outcome of a single step execution within the scheduler.
/// Step-level state transitions are handled internally; execution-level
/// transitions are deferred to the caller.
pub(crate) enum StepOutcome {
    /// Step completed with a final result
    Completed,
    /// Step parked waiting for user action (approval/permission/continue/input)
    Parked,
    /// Step failed with the given error message
    Failed(String),
}

enum SchedulerWorkItem {
    Step(WorkflowStep),
    LoopReview {
        workflow_loop: WorkflowLoop,
        loop_def: CompiledLoopDef,
    },
}

struct SchedulerCandidate {
    session_id: Uuid,
    priority_order: i32,
    tie_order: i32,
    work_item: SchedulerWorkItem,
}

enum SchedulerWorkOutcome {
    Step {
        step: WorkflowStep,
        outcome: StepOutcome,
    },
    Loop(LoopOutcome),
}

/// Orchestrator 是 workflow mode 的核心调度组件
pub struct WorkflowOrchestrator;

impl WorkflowOrchestrator {
    // -----------------------------------------------------------------------
    // Command Handler: bootstrap
    // -----------------------------------------------------------------------

    /// 从一个已校验的 plan revision 创建 execution 并 bootstrap
    pub async fn bootstrap_execution(
        pool: &SqlitePool,
        plan: &WorkflowPlan,
        revision: &WorkflowPlanRevision,
        lead_session_agent_id: Option<Uuid>,
        valid_agent_ids: &[String],
        agent_id_map: &HashMap<String, Uuid>,
    ) -> Result<BootstrapResult, OrchestratorError> {
        let execution_id = Uuid::new_v4();

        // 1. 创建 execution (pending)
        let execution = WorkflowExecution::create(
            pool,
            &CreateWorkflowExecution {
                session_id: plan.session_id,
                plan_id: plan.id,
                active_revision_id: Some(revision.id),
                lead_session_agent_id,
                title: plan.title.clone(),
            },
            execution_id,
        )
        .await?;

        // 2. 编译 plan
        let compiled =
            match WorkflowCompiler::compile_from_json(&revision.plan_json, valid_agent_ids) {
                Ok(graph) => graph,
                Err(e) => {
                    let tr = reducer::transition_execution_with_context(
                        pool,
                        &execution,
                        WorkflowExecutionStatus::Failed,
                        None,
                        Some(&format!("编译失败: {}", e)),
                    )
                    .await?;

                    return Ok(BootstrapResult {
                        execution: tr.entity,
                        round: None,
                        steps: vec![],
                        edges: vec![],
                        agent_sessions: vec![],
                        events: vec![],
                        failed: true,
                        failure_reason: Some(format!("{}", e)),
                    });
                }
            };

        // 3. 更新 compiled graph hash（数据字段更新，非状态迁移）
        let execution = WorkflowExecution::update_compiled_graph_hash(
            pool,
            execution.id,
            &compiled.compiled_graph_hash,
            revision.id,
        )
        .await?;

        // 4. 创建 round
        let round_id = Uuid::new_v4();
        let round = WorkflowRound::create(
            pool,
            &CreateWorkflowRound {
                execution_id: execution.id,
                round_index: 1,
                source_revision_id: Some(revision.id),
            },
            round_id,
        )
        .await?;

        // 更新 execution 的 active round（数据字段更新，非状态迁移）
        let execution =
            WorkflowExecution::update_active_round(pool, execution.id, round.id, 1).await?;

        // 5. 创建 workflow agent sessions（去重：每个 agent 只创建一个 session）
        let mut agent_session_map: HashMap<String, Uuid> = HashMap::new();
        let mut created_agent_sessions = Vec::new();
        let mut lead_workflow_agent_session_id = None;

        if let Some(lead_session_agent_id) = lead_session_agent_id {
            let ws = WorkflowAgentSession::create(
                pool,
                &CreateWorkflowAgentSession {
                    workflow_execution_id: execution.id,
                    session_agent_id: lead_session_agent_id,
                    role: WorkflowAgentSessionRole::Lead,
                },
                Uuid::new_v4(),
            )
            .await?;
            lead_workflow_agent_session_id = Some(ws.id);
            created_agent_sessions.push(ws);
        }

        for compiled_step in &compiled.steps {
            if let Some(ref agent_id_str) = compiled_step.assigned_agent_id {
                if agent_session_map.contains_key(agent_id_str) {
                    continue;
                }
                if let Some(&session_agent_uuid) = agent_id_map.get(agent_id_str) {
                    if lead_session_agent_id == Some(session_agent_uuid) {
                        if let Some(lead_workflow_agent_session_id) = lead_workflow_agent_session_id
                        {
                            agent_session_map
                                .insert(agent_id_str.clone(), lead_workflow_agent_session_id);
                        }
                        continue;
                    }
                    let role = if lead_session_agent_id == Some(session_agent_uuid) {
                        WorkflowAgentSessionRole::Lead
                    } else {
                        WorkflowAgentSessionRole::Worker
                    };
                    let ws_id = Uuid::new_v4();
                    let ws = WorkflowAgentSession::create(
                        pool,
                        &CreateWorkflowAgentSession {
                            workflow_execution_id: execution.id,
                            session_agent_id: session_agent_uuid,
                            role,
                        },
                        ws_id,
                    )
                    .await?;
                    agent_session_map.insert(agent_id_str.clone(), ws.id);
                    created_agent_sessions.push(ws);
                }
            }
        }

        // 6. 创建 steps 并绑定 agent session
        let step_id_map: HashMap<String, Uuid> = compiled
            .steps
            .iter()
            .map(|step| (step.step_key.clone(), Uuid::new_v4()))
            .collect();
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
                .and_then(|aid| agent_session_map.get(aid))
                .copied()
                .or(lead_workflow_agent_session_id);

            let step = WorkflowStep::create(
                pool,
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
                    round_index: 1,
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

        let mut _created_loops = Vec::new();
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
                    pool,
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
                        WorkflowStep::update_loop_id(pool, step_id, Some(workflow_loop.id)).await?;
                    if let Some(step) = created_steps.iter_mut().find(|step| step.id == step_id) {
                        *step = updated_step;
                    }
                }

                _created_loops.push(workflow_loop);
            }
        }

        // 7. 创建 edges
        let mut created_edges = Vec::new();
        for compiled_edge in &compiled.edges {
            let from_id = step_id_map
                .get(&compiled_edge.from_step_key)
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "步骤 {} 未找到",
                        compiled_edge.from_step_key
                    ))
                })?;
            let to_id = step_id_map.get(&compiled_edge.to_step_key).ok_or_else(|| {
                OrchestratorError::NotFound(format!("步骤 {} 未找到", compiled_edge.to_step_key))
            })?;

            let edge = WorkflowStepEdge::create(
                pool,
                &CreateWorkflowStepEdge {
                    execution_id: execution.id,
                    compiled_revision_id: Some(revision.id),
                    from_step_id: *from_id,
                    to_step_id: *to_id,
                    edge_kind: compiled_edge.edge_kind.clone(),
                },
                Uuid::new_v4(),
            )
            .await?;

            created_edges.push(edge);
        }

        // 8. 将无前驱的 step 标记为 ready（通过 reducer，含组合约束校验 + 审计事件）
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
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        for ready_key in &compiled.ready_step_keys {
            if loop_step_keys.contains(ready_key) {
                continue;
            }
            if let Some(&step_id) = step_id_map.get(ready_key) {
                let step = created_steps.iter().find(|s| s.id == step_id);
                if let Some(step) = step {
                    let tr =
                        reducer::transition_step(pool, &execution, step, WorkflowStepStatus::Ready)
                            .await?;
                    if let Some(s) = created_steps.iter_mut().find(|s| s.id == step_id) {
                        *s = tr.entity;
                    }
                }
            }
        }

        // 9. 基于当前 step 状态同步 execution
        let execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;

        // 写入 round 启动事件（非状态迁移事件，由 orchestrator 直接写入）
        WorkflowEvent::create(
            pool,
            &CreateWorkflowEvent {
                execution_id: execution.id,
                round_id: Some(round.id),
                step_id: None,
                agent_session_id: None,
                event_type: WorkflowEventType::RoundStarted,
                status_before: None,
                status_after: Some(format!("{:?}", execution.status).to_lowercase()),
                detail_json: None,
            },
            Uuid::new_v4(),
        )
        .await?;

        let events = WorkflowEvent::find_by_execution(pool, execution.id).await?;

        Ok(BootstrapResult {
            execution,
            round: Some(round),
            steps: created_steps,
            edges: created_edges,
            agent_sessions: created_agent_sessions,
            events,
            failed: false,
            failure_reason: None,
        })
    }

    // -----------------------------------------------------------------------
    // workflow 核心调度循环
    // -----------------------------------------------------------------------
    pub async fn wake_scheduler(
        db: &DBService,
        chat_runner: &ChatRunner,
        execution_id: Uuid,
    ) -> Result<(), OrchestratorError> {
        let pool = &db.pool;
        let mut execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} 未找到", execution_id))
            })?;

        loop {
            let plan = WorkflowPlan::find_by_id(pool, execution.plan_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("plan {} 未找到", execution.plan_id))
                })?;
            let revision_id = execution.active_revision_id.ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "execution {} 缺少 active revision",
                    execution.id
                ))
            })?;
            let revision = WorkflowPlanRevision::find_by_id(pool, revision_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("revision {} 未找到", revision_id))
                })?;
            let session = ChatSession::find_by_id(pool, execution.session_id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("session {} 未找到", execution.session_id))
                })?;
            let session_agents = ChatSessionAgent::find_all_for_session(pool, session.id).await?;
            let mut workflow_agent_sessions =
                WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
            let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
            let mut edges = WorkflowStepEdge::find_by_execution(pool, execution.id).await?;
            let agents = load_agents_for_session(pool, &session_agents).await?;
            let mut workflow_loops = if let Some(round_id) = execution.active_round_id {
                WorkflowLoop::find_by_round(pool, round_id).await?
            } else {
                WorkflowLoop::find_by_execution(pool, execution.id).await?
            };
            let valid_agent_ids = agents
                .iter()
                .map(|agent| agent.id.to_string())
                .collect::<Vec<_>>();
            let compiled_graph =
                WorkflowCompiler::compile_from_json(&revision.plan_json, &valid_agent_ids)?;

            edges = Self::scheduler_step_edges_from_compiled(
                &execution,
                &steps,
                &edges,
                &compiled_graph,
            )?;

            let loop_def_by_key = compiled_graph
                .loops
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|loop_def| (loop_def.loop_key.clone(), loop_def))
                .collect::<HashMap<_, _>>();
            execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;

            let recovered_loops =
                Self::restore_recovered_failed_loops(pool, &execution, &steps, &mut workflow_loops)
                    .await?;
            if !recovered_loops.is_empty() {
                for workflow_loop in &recovered_loops {
                    LoopExecutor::emit_loop_event(
                        pool,
                        &execution,
                        workflow_loop,
                        WorkflowEventType::LoopRetrying,
                        Some(serde_json::json!({
                            "reason": "loop_recovered_without_failed_steps",
                        })),
                    )
                    .await?;
                }
            }

            if execution.status == WorkflowExecutionStatus::Completed {
                let workflow_agent_sessions =
                    WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
                execution = Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    execution.id,
                    None,
                    "execution_completed",
                    Vec::new(),
                )
                .await?;
                Self::persist_completion_work_items(
                    pool,
                    chat_runner,
                    &execution,
                    &steps,
                    &workflow_agent_sessions,
                    &session_agents,
                    &agents,
                )
                .await?;
                Self::refresh_workflow_card(
                    pool,
                    chat_runner,
                    &execution,
                    &plan,
                    &revision,
                    &session_agents,
                    &agents,
                    None,
                )
                .await?;
                return Ok(());
            }

            let mut current_steps = steps;
            let completed_loop_ids = workflow_loops
                .iter()
                .filter(|workflow_loop| {
                    matches!(
                        workflow_loop.status,
                        WorkflowLoopStatus::Completed | WorkflowLoopStatus::Passed
                    )
                })
                .map(|workflow_loop| workflow_loop.id)
                .collect::<std::collections::HashSet<_>>();

            let mut schedulable_loops = workflow_loops
                .iter()
                .filter(|workflow_loop| {
                    matches!(
                        workflow_loop.status,
                        WorkflowLoopStatus::Pending
                            | WorkflowLoopStatus::Running
                            | WorkflowLoopStatus::Rejected
                    ) && Self::is_loop_ready_for_execution(workflow_loop, &current_steps, &edges)
                })
                .cloned()
                .collect::<Vec<_>>();
            schedulable_loops.sort_by_key(|workflow_loop| {
                Self::loop_review_display_order(workflow_loop, &current_steps).unwrap_or(i32::MAX)
            });

            tracing::debug!(
                "调度循环: execution_id={}, schedulable_loops={:?}, completed_loop_ids={:?}",
                execution.id,
                schedulable_loops
                    .iter()
                    .map(|l| (l.id, &l.loop_key, &l.status))
                    .collect::<Vec<_>>(),
                completed_loop_ids
            );

            for workflow_loop in &mut schedulable_loops {
                let Some(_loop_def) = loop_def_by_key.get(&workflow_loop.loop_key) else {
                    continue;
                };

                if workflow_loop.status == WorkflowLoopStatus::Pending {
                    let started_loop = WorkflowLoop::update_status(
                        pool,
                        workflow_loop.id,
                        WorkflowLoopStatus::Running,
                        workflow_loop.rejection_reason.clone(),
                    )
                    .await?;
                    LoopExecutor::emit_loop_event(
                        pool,
                        &execution,
                        &started_loop,
                        WorkflowEventType::LoopStarted,
                        None,
                    )
                    .await?;
                    if let Some(existing_loop) = workflow_loops
                        .iter_mut()
                        .find(|item| item.id == started_loop.id)
                    {
                        *existing_loop = started_loop.clone();
                    }
                    *workflow_loop = started_loop;
                }

                let loop_executor = LoopExecutor {
                    db,
                    pool,
                    chat_runner,
                    execution: &execution,
                    workflow_agent_sessions: &workflow_agent_sessions,
                    session: &session,
                    session_agents: &session_agents,
                    agents: &agents,
                    plan: &plan,
                };
                for reset_step in loop_executor.reset_loop_steps(workflow_loop).await? {
                    if let Some(existing) = current_steps
                        .iter_mut()
                        .find(|step| step.id == reset_step.id)
                    {
                        *existing = reset_step;
                    }
                }
            }

            let workflow_loop_by_id = workflow_loops
                .iter()
                .map(|workflow_loop| (workflow_loop.id, workflow_loop))
                .collect::<HashMap<_, _>>();
            let mut ready_promotions = Vec::new();
            for step in &current_steps {
                if step.status != WorkflowStepStatus::Pending {
                    continue;
                }

                if let Some(loop_id) = step.loop_id {
                    let Some(workflow_loop) = workflow_loop_by_id.get(&loop_id) else {
                        continue;
                    };
                    if step.id == workflow_loop.review_step_id
                        || !matches!(
                            workflow_loop.status,
                            WorkflowLoopStatus::Running | WorkflowLoopStatus::Rejected
                        )
                        || !Self::is_loop_ready_for_execution(workflow_loop, &current_steps, &edges)
                    {
                        continue;
                    }
                }

                if Self::are_step_dependencies_completed(
                    step,
                    &current_steps,
                    &edges,
                    &completed_loop_ids,
                ) {
                    ready_promotions.push(step.id);
                }
            }

            for step_id in ready_promotions {
                if let Some(step) = current_steps
                    .iter()
                    .find(|step| step.id == step_id)
                    .cloned()
                {
                    let transitioned = reducer::transition_step(
                        pool,
                        &execution,
                        &step,
                        WorkflowStepStatus::Ready,
                    )
                    .await?;
                    if let Some(existing) = current_steps.iter_mut().find(|item| item.id == step_id)
                    {
                        *existing = transitioned.entity;
                    }
                }
            }
            execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;
            workflow_agent_sessions =
                WorkflowAgentSession::find_by_execution(pool, execution.id).await?;

            // Collect ready steps: one per workflow agent session for parallel execution.
            let mut candidates_by_session: HashMap<Uuid, SchedulerCandidate> = HashMap::new();

            // 优先调度无 loop 约束的 ready 步骤，后续再调度 loop review 步骤
            for step in current_steps
                .iter()
                .filter(|s| s.status == WorkflowStepStatus::Ready && s.loop_id.is_none())
            {
                if !Self::are_step_dependencies_completed(
                    step,
                    &current_steps,
                    &edges,
                    &completed_loop_ids,
                ) {
                    tracing::debug!("步骤 {} 依赖未完成，跳过调度", step.id);

                    continue;
                }

                let ws = resolve_step_workflow_session(&execution, &workflow_agent_sessions, step)?;
                if !Self::is_workflow_session_available(ws) {
                    continue;
                }

                Self::insert_scheduler_candidate(
                    &mut candidates_by_session,
                    SchedulerCandidate {
                        session_id: ws.id,
                        priority_order: step.display_order,
                        tie_order: step.display_order,
                        work_item: SchedulerWorkItem::Step(step.clone()),
                    },
                );
            }

            for step in current_steps
                .iter()
                .filter(|s| s.status == WorkflowStepStatus::Ready && s.loop_id.is_some())
            {
                let Some(loop_id) = step.loop_id else {
                    continue;
                };
                let Some(workflow_loop) = workflow_loop_by_id.get(&loop_id) else {
                    continue;
                };
                if step.id == workflow_loop.review_step_id
                    || !matches!(
                        workflow_loop.status,
                        WorkflowLoopStatus::Running | WorkflowLoopStatus::Rejected
                    )
                    || !Self::is_loop_ready_for_execution(workflow_loop, &current_steps, &edges)
                    || !Self::are_step_dependencies_completed(
                        step,
                        &current_steps,
                        &edges,
                        &completed_loop_ids,
                    )
                {
                    continue;
                }
                let ws = resolve_step_workflow_session(&execution, &workflow_agent_sessions, step)?;
                if !Self::is_workflow_session_available(ws) {
                    continue;
                }

                // let loop_order = Self::loop_review_display_order(workflow_loop, &current_steps)
                //     .unwrap_or(step.display_order);
                Self::insert_scheduler_candidate(
                    &mut candidates_by_session,
                    SchedulerCandidate {
                        session_id: ws.id,
                        priority_order: step.display_order,
                        tie_order: step.display_order,
                        work_item: SchedulerWorkItem::Step(step.clone()),
                    },
                );
            }

            for workflow_loop in schedulable_loops {
                let Some(loop_def) = loop_def_by_key.get(&workflow_loop.loop_key) else {
                    continue;
                };
                if !Self::loop_members_completed(&workflow_loop, &current_steps)? {
                    continue;
                }
                let Some(review_step) = current_steps
                    .iter()
                    .find(|step| step.id == workflow_loop.review_step_id)
                else {
                    continue;
                };
                if !Self::is_loop_review_step_runnable(review_step)
                    || !Self::are_step_dependencies_completed(
                        review_step,
                        &current_steps,
                        &edges,
                        &completed_loop_ids,
                    )
                {
                    continue;
                }
                let ws = resolve_step_workflow_session(
                    &execution,
                    &workflow_agent_sessions,
                    review_step,
                )?;
                if !Self::is_workflow_session_available(ws) {
                    continue;
                }

                Self::insert_scheduler_candidate(
                    &mut candidates_by_session,
                    SchedulerCandidate {
                        session_id: ws.id,
                        priority_order: review_step.display_order,
                        tie_order: review_step.display_order,
                        work_item: SchedulerWorkItem::LoopReview {
                            workflow_loop,
                            loop_def: loop_def.clone(),
                        },
                    },
                );
            }

            let parallel_work: Vec<SchedulerWorkItem> = candidates_by_session
                .into_values()
                .map(|candidate| candidate.work_item)
                .collect();

            if parallel_work.is_empty() {
                execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;
                Self::refresh_workflow_card(
                    pool,
                    chat_runner,
                    &execution,
                    &plan,
                    &revision,
                    &session_agents,
                    &agents,
                    None,
                )
                .await?;
                return Ok(());
            }

            if execution.status != WorkflowExecutionStatus::Running {
                execution = Self::transition_execution_and_sync(
                    pool,
                    chat_runner,
                    &execution,
                    WorkflowExecutionStatus::Running,
                    "execution_running",
                    None,
                )
                .await?;
            }

            // --- Parallel execution: run all selected steps concurrently ---
            let work_futures: Vec<
                std::pin::Pin<
                    Box<
                        dyn std::future::Future<
                                Output = Result<SchedulerWorkOutcome, OrchestratorError>,
                            > + Send,
                    >,
                >,
            > = parallel_work
                .iter()
                .map(|work_item| match work_item {
                    SchedulerWorkItem::Step(step) => {
                        let step_for_outcome = step.clone();
                        let execution_ref = &execution;
                        let workflow_agent_sessions_ref = &workflow_agent_sessions;
                        let session_ref = &session;
                        let session_agents_ref = &session_agents;
                        let agents_ref = &agents;
                        let plan_ref = &plan;
                        let current_steps_ref = &current_steps;
                        let edges_ref = &edges;
                        Box::pin(async move {
                            Self::prepare_and_run_step(
                                db,
                                pool,
                                chat_runner,
                                execution_ref,
                                step,
                                workflow_agent_sessions_ref,
                                session_ref,
                                session_agents_ref,
                                agents_ref,
                                plan_ref,
                                current_steps_ref,
                                edges_ref,
                            )
                            .await
                            .map(|outcome| {
                                SchedulerWorkOutcome::Step {
                                    step: step_for_outcome,
                                    outcome,
                                }
                            })
                        })
                            as std::pin::Pin<
                                Box<
                                    dyn std::future::Future<
                                            Output = Result<
                                                SchedulerWorkOutcome,
                                                OrchestratorError,
                                            >,
                                        > + Send,
                                >,
                            >
                    }
                    SchedulerWorkItem::LoopReview {
                        workflow_loop,
                        loop_def,
                    } => {
                        let execution_ref = &execution;
                        let workflow_agent_sessions_ref = &workflow_agent_sessions;
                        let session_ref = &session;
                        let session_agents_ref = &session_agents;
                        let agents_ref = &agents;
                        let plan_ref = &plan;
                        Box::pin(async move {
                            let loop_executor = LoopExecutor {
                                db,
                                pool,
                                chat_runner,
                                execution: execution_ref,
                                workflow_agent_sessions: workflow_agent_sessions_ref,
                                session: session_ref,
                                session_agents: session_agents_ref,
                                agents: agents_ref,
                                plan: plan_ref,
                            };
                            loop_executor
                                .execute_ready_review(workflow_loop, loop_def)
                                .await
                                .map(SchedulerWorkOutcome::Loop)
                        })
                            as std::pin::Pin<
                                Box<
                                    dyn std::future::Future<
                                            Output = Result<
                                                SchedulerWorkOutcome,
                                                OrchestratorError,
                                            >,
                                        > + Send,
                                >,
                            >
                    }
                })
                .collect();
            let outcomes = futures::future::join_all(work_futures).await;

            // Process outcomes: collect parked/failed results
            let mut any_parked = false;
            let mut first_failure: Option<String> = None;
            for outcome in outcomes {
                match outcome? {
                    SchedulerWorkOutcome::Step {
                        outcome: StepOutcome::Completed,
                        ..
                    }
                    | SchedulerWorkOutcome::Loop(LoopOutcome::Progressed)
                    | SchedulerWorkOutcome::Loop(LoopOutcome::Completed) => {}
                    SchedulerWorkOutcome::Step {
                        outcome: StepOutcome::Parked,
                        ..
                    }
                    | SchedulerWorkOutcome::Loop(LoopOutcome::Parked) => {
                        any_parked = true;
                    }
                    SchedulerWorkOutcome::Step {
                        step,
                        outcome: StepOutcome::Failed(reason),
                    } => {
                        if let Some(loop_id) = step.loop_id
                            && let Some(workflow_loop) = workflow_loop_by_id.get(&loop_id)
                        {
                            let failed_loop = WorkflowLoop::update_status(
                                pool,
                                workflow_loop.id,
                                WorkflowLoopStatus::Failed,
                                Some(reason.clone()),
                            )
                            .await?;
                            LoopExecutor::emit_loop_event(
                                pool,
                                &execution,
                                &failed_loop,
                                WorkflowEventType::LoopFailed,
                                Some(serde_json::json!({ "reason": reason.clone() })),
                            )
                            .await?;
                        }
                        if first_failure.is_none() {
                            first_failure = Some(reason);
                        }
                    }
                }
            }

            execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;

            // All steps completed → execution is now Waiting for user final review.
            if execution.status == WorkflowExecutionStatus::Waiting {
                let all_steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
                if Self::all_steps_completed_like(&all_steps) {
                    Self::park_for_final_review(pool, chat_runner, &execution).await?;
                    return Ok(());
                }
            }

            if execution.status == WorkflowExecutionStatus::Completed {
                let workflow_agent_sessions =
                    WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
                execution = Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    execution.id,
                    None,
                    "execution_completed",
                    Vec::new(),
                )
                .await?;
                Self::persist_completion_work_items(
                    pool,
                    chat_runner,
                    &execution,
                    &WorkflowStep::find_by_execution(pool, execution.id).await?,
                    &workflow_agent_sessions,
                    &session_agents,
                    &agents,
                )
                .await?;
                Self::refresh_workflow_card(
                    pool,
                    chat_runner,
                    &execution,
                    &plan,
                    &revision,
                    &session_agents,
                    &agents,
                    None,
                )
                .await?;
                return Ok(());
            }

            if any_parked || first_failure.is_some() {
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    execution.id,
                    first_failure.clone(),
                    if first_failure.is_some() {
                        "execution_failed"
                    } else {
                        "execution_waiting"
                    },
                    Vec::new(),
                )
                .await?;
                return Ok(());
            }

            // All steps in this batch completed — refresh card and continue loop
            Self::refresh_workflow_card(
                pool,
                chat_runner,
                &execution,
                &plan,
                &revision,
                &session_agents,
                &agents,
                None,
            )
            .await?;

            execution = WorkflowExecution::find_by_id(pool, execution.id)
                .await?
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!("execution {} 未找到", execution.id))
                })?;
        }
    }

    // -----------------------------------------------------------------------
    // 状态同步 / 状态迁移辅助
    // -----------------------------------------------------------------------

    pub(crate) async fn synchronize_runtime_state(
        pool: &SqlitePool,
        execution_id: Uuid,
        preserve_recompiling: bool,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let mut execution = WorkflowExecution::find_by_id(pool, execution_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} not found", execution_id))
            })?;

        let steps = WorkflowStep::find_by_execution(pool, execution.id).await?;
        let step_statuses = steps
            .iter()
            .map(|step| step.status.clone())
            .collect::<Vec<_>>();

        let derived_execution_status =
            if preserve_recompiling && execution.status == WorkflowExecutionStatus::Recompiling {
                WorkflowExecutionStatus::Recompiling
            } else {
                reducer::derive_execution_status(&execution.status, &step_statuses)
            };

        if derived_execution_status != execution.status {
            execution = reducer::transition_execution(pool, &execution, derived_execution_status)
                .await?
                .entity;
        }

        if execution.status == WorkflowExecutionStatus::Running && execution.started_at.is_none() {
            execution = WorkflowExecution::set_started(pool, execution.id).await?;
        }

        if matches!(
            execution.status,
            WorkflowExecutionStatus::Completed | WorkflowExecutionStatus::Failed
        ) && execution.completed_at.is_none()
        {
            execution = WorkflowExecution::set_completed(pool, execution.id).await?;
        }

        if execution.status == WorkflowExecutionStatus::Waiting
            && Self::all_steps_completed_like(&steps)
        {
            let _ = Self::ensure_unresolved_final_review(pool, execution.id).await?;
        }

        let workflow_sessions = WorkflowAgentSession::find_by_execution(pool, execution.id).await?;
        for workflow_session in workflow_sessions {
            if workflow_session.state == WorkflowAgentSessionState::Expired {
                continue;
            }

            let assigned_statuses = steps
                .iter()
                .filter(|step| step.assigned_workflow_agent_session_id == Some(workflow_session.id))
                .map(|step| step.status.clone())
                .collect::<Vec<_>>();

            let derived_session_state =
                reducer::derive_agent_session_state(&workflow_session.state, &assigned_statuses);
            if derived_session_state != workflow_session.state {
                let _ = reducer::transition_agent_session(
                    pool,
                    &execution,
                    &workflow_session,
                    derived_session_state,
                )
                .await?;
            }
        }

        WorkflowExecution::find_by_id(pool, execution.id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("execution {} not found", execution.id))
            })
    }

    pub(super) async fn transition_execution_and_sync(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        to: WorkflowExecutionStatus,
        projection_reason: &str,
        projection_error_message: Option<String>,
    ) -> Result<WorkflowExecution, OrchestratorError> {
        let from_status = to_workflow_wire_value(&execution.status);
        let to_status = to_workflow_wire_value(&to);
        let mut transitioned = reducer::transition_execution(pool, execution, to.clone())
            .await?
            .entity;
        if to == WorkflowExecutionStatus::Running && transitioned.started_at.is_none() {
            transitioned = WorkflowExecution::set_started(pool, transitioned.id).await?;
        }
        if matches!(
            to,
            WorkflowExecutionStatus::Completed
                | WorkflowExecutionStatus::Failed
                | WorkflowExecutionStatus::Cancelled
        ) && transitioned.completed_at.is_none()
        {
            transitioned = WorkflowExecution::set_completed(pool, transitioned.id).await?;
        }

        let duration_ms = transitioned.started_at.and_then(|started| {
            transitioned
                .completed_at
                .map(|completed| (completed - started).num_milliseconds())
        });
        workflow_analytics::track_execution_state_changed(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            execution.plan_id,
            &from_status,
            &to_status,
            duration_ms,
        );

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            transitioned.id,
            projection_error_message,
            projection_reason,
            Vec::new(),
        )
        .await
    }

    pub(crate) async fn transition_step_and_sync(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        to: WorkflowStepStatus,
        projection_reason: &str,
    ) -> Result<WorkflowStep, OrchestratorError> {
        let from_status = to_workflow_wire_value(&step.status);
        let to_status = to_workflow_wire_value(&to);

        let transitioned = reducer::transition_step(pool, execution, step, to)
            .await?
            .entity;
        let synced_execution = Self::synchronize_runtime_state(pool, execution.id, false).await?;
        let step_duration_ms = step_transition_duration_ms(&transitioned, &to_status);

        workflow_analytics::track_step_state_changed(
            chat_runner.analytics_service(),
            execution.session_id,
            execution.id,
            execution.plan_id,
            step.id,
            &step.step_key,
            &from_status,
            &to_status,
            None,
            step_duration_ms,
        );

        if synced_execution.status != execution.status {
            let duration_ms = synced_execution.started_at.and_then(|started| {
                synced_execution
                    .completed_at
                    .map(|completed| (completed - started).num_milliseconds())
            });
            workflow_analytics::track_execution_state_changed(
                chat_runner.analytics_service(),
                execution.session_id,
                execution.id,
                execution.plan_id,
                &to_workflow_wire_value(&execution.status),
                &to_workflow_wire_value(&synced_execution.status),
                duration_ms,
            );
        }

        Self::refresh_execution_projection_with_reason(
            pool,
            chat_runner,
            execution.id,
            None,
            projection_reason,
            vec![transitioned.id.to_string()],
        )
        .await?;
        Ok(transitioned)
    }

    /// Like `transition_step_and_sync` but uses a CAS guard at the DB level.
    /// Returns `Ok(None)` if the step was already claimed by another caller
    /// (stale transition), allowing the caller to skip without error.
    pub(crate) async fn guarded_transition_step_and_sync(
        pool: &SqlitePool,
        chat_runner: &ChatRunner,
        execution: &WorkflowExecution,
        step: &WorkflowStep,
        to: WorkflowStepStatus,
        projection_reason: &str,
    ) -> Result<Option<WorkflowStep>, OrchestratorError> {
        let from_status = to_workflow_wire_value(&step.status);
        let to_status = to_workflow_wire_value(&to);
        match reducer::guarded_transition_step(pool, execution, step, to).await {
            Ok(result) => {
                let transitioned = result.entity;
                let synced_execution =
                    Self::synchronize_runtime_state(pool, execution.id, false).await?;
                let step_duration_ms = step_transition_duration_ms(&transitioned, &to_status);
                workflow_analytics::track_step_state_changed(
                    chat_runner.analytics_service(),
                    execution.session_id,
                    execution.id,
                    execution.plan_id,
                    step.id,
                    &step.step_key,
                    &from_status,
                    &to_status,
                    None,
                    step_duration_ms,
                );
                if synced_execution.status != execution.status {
                    let duration_ms = synced_execution.started_at.and_then(|started| {
                        synced_execution
                            .completed_at
                            .map(|completed| (completed - started).num_milliseconds())
                    });
                    workflow_analytics::track_execution_state_changed(
                        chat_runner.analytics_service(),
                        execution.session_id,
                        execution.id,
                        execution.plan_id,
                        &to_workflow_wire_value(&execution.status),
                        &to_workflow_wire_value(&synced_execution.status),
                        duration_ms,
                    );
                }
                Self::refresh_execution_projection_with_reason(
                    pool,
                    chat_runner,
                    execution.id,
                    None,
                    projection_reason,
                    vec![transitioned.id.to_string()],
                )
                .await?;
                Ok(Some(transitioned))
            }
            Err(reducer::TransitionError::StaleTransition { .. }) => {
                tracing::info!(
                    step_id = %step.id,
                    "跳过已被占用的 step (CAS 失败)"
                );
                Ok(None)
            }
            Err(e) => Err(e.into()),
        }
    }

    // -----------------------------------------------------------------------
    // Scheduler helpers (used in `wake_scheduler`)
    // -----------------------------------------------------------------------

    fn is_loop_ready_for_execution(
        workflow_loop: &WorkflowLoop,
        steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
    ) -> bool {
        let Ok(mut loop_step_ids) =
            serde_json::from_str::<Vec<Uuid>>(&workflow_loop.member_step_ids_json)
        else {
            return false;
        };
        loop_step_ids.push(workflow_loop.review_step_id);
        let loop_step_ids = loop_step_ids
            .into_iter()
            .collect::<std::collections::HashSet<_>>();
        let step_by_id = steps
            .iter()
            .map(|step| (step.id, step))
            .collect::<HashMap<_, _>>();

        if loop_step_ids.iter().any(|step_id| {
            step_by_id
                .get(step_id)
                .map(|step| {
                    matches!(
                        step.status,
                        WorkflowStepStatus::Running
                            | WorkflowStepStatus::WaitingInput
                            | WorkflowStepStatus::WaitingReview
                            | WorkflowStepStatus::PreCompleted
                    )
                })
                .unwrap_or(true)
        }) {
            return false;
        }

        edges
            .iter()
            .filter(|edge| loop_step_ids.contains(&edge.to_step_id))
            .filter(|edge| !loop_step_ids.contains(&edge.from_step_id))
            .all(|edge| {
                step_by_id
                    .get(&edge.from_step_id)
                    .map(|step| step.status == WorkflowStepStatus::Completed)
                    .unwrap_or(false)
            })
    }

    fn are_step_dependencies_completed(
        step: &WorkflowStep,
        steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
        completed_loop_ids: &HashSet<Uuid>,
    ) -> bool {
        edges
            .iter()
            .filter(|edge| edge.to_step_id == step.id)
            .all(|edge| {
                steps
                    .iter()
                    .find(|candidate| candidate.id == edge.from_step_id)
                    .map(|candidate| {
                        let same_loop = step.loop_id.is_some() && candidate.loop_id == step.loop_id;
                        candidate.status == WorkflowStepStatus::Completed
                            && (same_loop
                                || candidate
                                    .loop_id
                                    .is_none_or(|loop_id| completed_loop_ids.contains(&loop_id)))
                    })
                    .unwrap_or(false)
            })
    }

    fn scheduler_step_edges_from_compiled(
        execution: &WorkflowExecution,
        steps: &[WorkflowStep],
        edges: &[WorkflowStepEdge],
        compiled_graph: &CompiledGraph,
    ) -> Result<Vec<WorkflowStepEdge>, OrchestratorError> {
        if compiled_graph.edges.is_empty() {
            return Ok(edges.to_vec());
        }

        let scoped_steps = if let Some(active_round_id) = execution.active_round_id {
            steps
                .iter()
                .filter(|step| step.round_id == active_round_id)
                .collect::<Vec<_>>()
        } else {
            steps.iter().collect::<Vec<_>>()
        };

        let step_id_by_key = scoped_steps
            .iter()
            .map(|step| (step.step_key.as_str(), step.id))
            .collect::<HashMap<_, _>>();

        let mut existing = edges
            .iter()
            .map(|edge| {
                (
                    edge.from_step_id,
                    edge.to_step_id,
                    to_workflow_wire_value(&edge.edge_kind),
                )
            })
            .collect::<HashSet<_>>();

        let mut repaired = edges.to_vec();
        for compiled_edge in &compiled_graph.edges {
            let from_step_id = *step_id_by_key
                .get(compiled_edge.from_step_key.as_str())
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "compiled edge source step {} not found for execution {}",
                        compiled_edge.from_step_key, execution.id
                    ))
                })?;
            let to_step_id = *step_id_by_key
                .get(compiled_edge.to_step_key.as_str())
                .ok_or_else(|| {
                    OrchestratorError::NotFound(format!(
                        "compiled edge target step {} not found for execution {}",
                        compiled_edge.to_step_key, execution.id
                    ))
                })?;
            let edge_kind = to_workflow_wire_value(&compiled_edge.edge_kind);
            let key = (from_step_id, to_step_id, edge_kind);
            if existing.contains(&key) {
                continue;
            }

            let edge = WorkflowStepEdge {
                id: Uuid::new_v4(),
                execution_id: execution.id,
                compiled_revision_id: execution.active_revision_id,
                from_step_id,
                to_step_id,
                edge_kind: compiled_edge.edge_kind.clone(),
                created_at: Utc::now(),
            };
            tracing::warn!(
                execution_id = %execution.id,
                from_step = %compiled_edge.from_step_key,
                to_step = %compiled_edge.to_step_key,
                "reconstructed missing workflow step edge in memory before scheduling"
            );
            existing.insert(key);
            repaired.push(edge);
        }

        if repaired.len() != edges.len() {
            tracing::warn!(
                execution_id = %execution.id,
                before = edges.len(),
                after = repaired.len(),
                "using reconstructed workflow step edges for scheduling"
            );
        }

        Ok(repaired)
    }

    pub(crate) fn is_workflow_session_available(workflow_session: &WorkflowAgentSession) -> bool {
        workflow_session.state == WorkflowAgentSessionState::Idle
    }

    fn insert_scheduler_candidate(
        candidates_by_session: &mut HashMap<Uuid, SchedulerCandidate>,
        candidate: SchedulerCandidate,
    ) {
        let should_replace = candidates_by_session
            .get(&candidate.session_id)
            .map(|existing| {
                (candidate.priority_order, candidate.tie_order)
                    < (existing.priority_order, existing.tie_order)
            })
            .unwrap_or(true);

        if should_replace {
            candidates_by_session.insert(candidate.session_id, candidate);
        }
    }

    fn loop_members_completed(
        workflow_loop: &WorkflowLoop,
        steps: &[WorkflowStep],
    ) -> Result<bool, OrchestratorError> {
        let member_ids = serde_json::from_str::<Vec<Uuid>>(&workflow_loop.member_step_ids_json)?;
        let step_by_id = steps
            .iter()
            .map(|step| (step.id, step))
            .collect::<HashMap<_, _>>();

        Ok(member_ids.iter().all(|step_id| {
            step_by_id
                .get(step_id)
                .map(|step| step.status == WorkflowStepStatus::Completed)
                .unwrap_or(false)
        }))
    }

    fn loop_review_display_order(
        workflow_loop: &WorkflowLoop,
        steps: &[WorkflowStep],
    ) -> Option<i32> {
        steps
            .iter()
            .find(|step| step.id == workflow_loop.review_step_id)
            .map(|step| step.display_order)
    }

    fn is_loop_review_step_runnable(step: &WorkflowStep) -> bool {
        matches!(
            step.status,
            WorkflowStepStatus::Pending
                | WorkflowStepStatus::Ready
                | WorkflowStepStatus::Completed
                | WorkflowStepStatus::Failed
                | WorkflowStepStatus::Interrupted
                | WorkflowStepStatus::Blocked
                | WorkflowStepStatus::Revising
        )
    }

    async fn restore_recovered_failed_loops(
        pool: &SqlitePool,
        execution: &WorkflowExecution,
        steps: &[WorkflowStep],
        workflow_loops: &mut [WorkflowLoop],
    ) -> Result<Vec<WorkflowLoop>, OrchestratorError> {
        let mut recovered_loops = Vec::new();
        for workflow_loop in workflow_loops.iter_mut().filter(|workflow_loop| {
            workflow_loop.execution_id == execution.id
                && workflow_loop.status == WorkflowLoopStatus::Failed
        }) {
            let loop_has_failed_step = steps.iter().any(|step| {
                step.loop_id == Some(workflow_loop.id) && step.status == WorkflowStepStatus::Failed
            });
            if loop_has_failed_step {
                continue;
            }

            let running_loop = WorkflowLoop::update_status(
                pool,
                workflow_loop.id,
                WorkflowLoopStatus::Running,
                None,
            )
            .await?;
            *workflow_loop = running_loop.clone();
            recovered_loops.push(running_loop);
        }

        Ok(recovered_loops)
    }
}

// -----------------------------------------------------------------------
// Free helper functions used across submodules
// -----------------------------------------------------------------------

fn step_transition_duration_ms(step: &WorkflowStep, to_status: &str) -> Option<i64> {
    if !matches!(to_status, "completed" | "failed" | "cancelled" | "skipped") {
        return None;
    }

    step.started_at.map(|started| {
        step.completed_at
            .unwrap_or(step.updated_at)
            .signed_duration_since(started)
            .num_milliseconds()
            .max(0)
    })
}

pub(crate) fn resolve_step_workflow_session<'a>(
    execution: &WorkflowExecution,
    workflow_sessions: &'a [WorkflowAgentSession],
    step: &WorkflowStep,
) -> Result<&'a WorkflowAgentSession, OrchestratorError> {
    if let Some(workflow_session_id) = step.assigned_workflow_agent_session_id {
        return workflow_sessions
            .iter()
            .find(|session| session.id == workflow_session_id)
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!(
                    "workflow agent session {} 未找到",
                    workflow_session_id
                ))
            });
    }

    let lead_session_agent_id = execution.lead_session_agent_id.ok_or_else(|| {
        OrchestratorError::NotFound(format!(
            "execution {} 缺少 lead session agent",
            execution.id
        ))
    })?;

    workflow_sessions
        .iter()
        .find(|session| session.session_agent_id == lead_session_agent_id)
        .ok_or_else(|| {
            OrchestratorError::NotFound(format!(
                "execution {} 的 lead workflow session 未找到",
                execution.id
            ))
        })
}

pub(crate) async fn load_agents_for_session(
    pool: &SqlitePool,
    session_agents: &[ChatSessionAgent],
) -> Result<Vec<ChatAgent>, OrchestratorError> {
    let mut agents = Vec::new();
    for session_agent in session_agents {
        let agent = ChatAgent::find_by_id(pool, session_agent.agent_id)
            .await?
            .ok_or_else(|| {
                OrchestratorError::NotFound(format!("agent {} 未找到", session_agent.agent_id))
            })?;
        agents.push(agent);
    }
    Ok(agents)
}
