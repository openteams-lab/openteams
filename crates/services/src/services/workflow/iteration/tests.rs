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
