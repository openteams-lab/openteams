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
            WorkflowRoundStatus, WorkflowStepStatus, WorkflowStepType, WorkflowValidationStatus,
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

include!("types.rs");
include!("control.rs");
include!("aggregation.rs");
include!("prompts.rs");
include!("tests.rs");
