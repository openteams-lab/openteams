#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::workflow_types::WorkflowExecutionStatus;

    use super::*;

    fn sample_execution() -> WorkflowExecution {
        let now = Utc::now();
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: Some(Uuid::new_v4()),
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status: WorkflowExecutionStatus::Running,
            current_round: 1,
            title: "Loop execution".to_string(),
            compiled_graph_hash: None,
            started_at: Some(now),
            completed_at: None,
            cleaned_at: None,
            cleaned_reason: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_loop(loop_key: &str) -> WorkflowLoop {
        let now = Utc::now();
        WorkflowLoop {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            round_id: Uuid::new_v4(),
            loop_key: loop_key.to_string(),
            review_step_id: Uuid::new_v4(),
            member_step_ids_json: "[]".to_string(),
            status: WorkflowLoopStatus::Running,
            retry_count: 1,
            max_retry: 1,
            user_review_required: false,
            rejection_reason: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_loop_step(workflow_loop: &WorkflowLoop, step_key: &str) -> WorkflowStep {
        let now = Utc::now();
        WorkflowStep {
            id: Uuid::new_v4(),
            execution_id: workflow_loop.execution_id,
            round_id: workflow_loop.round_id,
            compiled_revision_id: None,
            step_key: step_key.to_string(),
            step_type: db::models::workflow_types::WorkflowStepType::Task,
            title: step_key.to_string(),
            instructions: String::new(),
            assigned_workflow_agent_session_id: None,
            status: WorkflowStepStatus::Completed,
            retry_count: 0,
            max_retry: 1,
            round_index: 1,
            display_order: 1,
            latest_run_id: None,
            summary_text: None,
            content: None,
            loop_id: Some(workflow_loop.id),
            lead_review_required: false,
            user_review_required: false,
            revision_context: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: Some(now),
        }
    }

    #[test]
    fn loop_lead_review_rejected_business_event_uses_review_node_rejected_context() {
        let execution = sample_execution();
        let step_id = Uuid::new_v4();

        let event = loop_lead_review_rejected_event(&execution, step_id);

        assert_eq!(event.session_id, execution.session_id);
        assert_eq!(event.execution_id, execution.id);
        assert_eq!(event.plan_id, execution.plan_id);
        assert_eq!(event.step_id, step_id);
        assert_eq!(event.reviewer_type, "lead");
    }

    #[test]
    fn loop_lead_review_rejected_runtime_path_sets_review_node_rejected_analytics() {
        let execution = sample_execution();
        let step_id = Uuid::new_v4();
        let session_id = execution.session_id.to_string();
        let execution_id = execution.id.to_string();
        let plan_id = execution.plan_id.to_string();
        let task_id = step_id.to_string();

        let (event, ctx, meta) = loop_lead_review_rejected_analytics_parts(&execution, step_id);

        assert_eq!(event.event_name(), "quality.review_decision_recorded");
        assert_eq!(ctx.session_id.as_deref(), Some(session_id.as_str()));
        assert_eq!(ctx.workflow_id.as_deref(), Some(execution_id.as_str()));
        assert_eq!(ctx.plan_id.as_deref(), Some(plan_id.as_str()));
        assert_eq!(ctx.task_id.as_deref(), Some(task_id.as_str()));
        assert_eq!(ctx.status.as_deref(), Some("review_node_rejected"));
        assert_eq!(meta["review_verdict"], serde_json::json!("rejected"));
        assert_eq!(meta["reviewer_type"], serde_json::json!("lead"));
        assert_eq!(
            meta["resolution"],
            serde_json::json!("review_node_rejected")
        );
    }

    #[test]
    fn pending_loop_feedback_is_independent_from_step_retry_count() {
        let workflow_loop = sample_loop("loop-a");
        let mut step = sample_loop_step(&workflow_loop, "member");
        step.retry_count = 5;
        step.revision_context = Some(
            serde_json::json!({
                "pending_feedback": {
                    "scope": "loop",
                    "loop_key": "loop-a",
                    "feedback": "revise",
                    "review_round": 1
                }
            })
            .to_string(),
        );

        assert!(has_pending_feedback_for_loop(&step, &workflow_loop));
    }

    #[test]
    fn pending_loop_feedback_ignores_other_loops() {
        let workflow_loop = sample_loop("loop-a");
        let mut step = sample_loop_step(&workflow_loop, "member");
        step.revision_context = Some(
            serde_json::json!({
                "pending_feedback": {
                    "scope": "loop",
                    "loop_key": "loop-b",
                    "feedback": "revise",
                    "review_round": 1
                }
            })
            .to_string(),
        );

        assert!(!has_pending_feedback_for_loop(&step, &workflow_loop));

        step.revision_context = Some(
            serde_json::json!({
                "pending_feedback": {
                    "scope": "step",
                    "loop_key": "loop-a",
                    "feedback": "revise",
                    "review_round": 1
                }
            })
            .to_string(),
        );
        assert!(!has_pending_feedback_for_loop(&step, &workflow_loop));
    }

    #[test]
    fn loop_feedback_targets_only_named_steps_when_specific_feedback_exists() {
        let workflow_loop = sample_loop("loop-a");
        let step_a = sample_loop_step(&workflow_loop, "a");
        let step_b = sample_loop_step(&workflow_loop, "b");
        let steps = vec![step_a.clone(), step_b.clone()];
        let member_ids = [step_a.id, step_b.id].into_iter().collect::<HashSet<_>>();
        let step_feedbacks =
            HashMap::from([("b".to_string(), "only b needs revision".to_string())]);

        let feedback_by_step_id =
            loop_feedback_by_step_id(&steps, &member_ids, &step_feedbacks, "whole loop issue");

        assert_eq!(feedback_by_step_id.len(), 1);
        assert!(!feedback_by_step_id.contains_key(&step_a.id));
        assert_eq!(
            feedback_by_step_id.get(&step_b.id).map(String::as_str),
            Some("only b needs revision")
        );
    }

    #[test]
    fn loop_feedback_targets_all_members_when_specific_feedback_is_empty() {
        let workflow_loop = sample_loop("loop-a");
        let step_a = sample_loop_step(&workflow_loop, "a");
        let step_b = sample_loop_step(&workflow_loop, "b");
        let steps = vec![step_a.clone(), step_b.clone()];
        let member_ids = [step_a.id, step_b.id].into_iter().collect::<HashSet<_>>();
        let step_feedbacks = HashMap::new();

        let feedback_by_step_id =
            loop_feedback_by_step_id(&steps, &member_ids, &step_feedbacks, "whole loop issue");

        assert_eq!(feedback_by_step_id.len(), 2);
        assert_eq!(
            feedback_by_step_id.get(&step_a.id).map(String::as_str),
            Some("whole loop issue")
        );
        assert_eq!(
            feedback_by_step_id.get(&step_b.id).map(String::as_str),
            Some("whole loop issue")
        );
    }
}
