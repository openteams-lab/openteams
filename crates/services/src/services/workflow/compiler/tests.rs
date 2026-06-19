#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan_json() -> &'static str {
        r#"{
            "version": 1,
            "title": "测试计划",
            "goal": "测试编译",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                {
                    "id": "task_1", "type": "workflowStep",
                    "position": { "x": 0, "y": 0 },
                    "data": { "stepType": "task", "agentId": "agent-1", "title": "任务1", "instructions": "做事1" }
                },
                {
                    "id": "task_2", "type": "workflowStep",
                    "position": { "x": 240, "y": 0 },
                    "data": { "stepType": "task", "agentId": "agent-2", "title": "任务2", "instructions": "做事2" }
                },
                {
                    "id": "result", "type": "workflowStep",
                    "position": { "x": 120, "y": 140 },
                    "data": { "stepType": "result", "title": "最终结果", "instructions": "汇总" }
                }
            ],
            "edges": [
                { "id": "task_1->result", "source": "task_1", "target": "result" },
                { "id": "task_2->result", "source": "task_2", "target": "result" }
            ]
        }"#
    }

    fn agents() -> Vec<String> {
        vec!["lead-agent".into(), "agent-1".into(), "agent-2".into()]
    }

    fn loop_plan_json() -> String {
        serde_json::json!({
            "version": 1,
            "title": "回路测试计划",
            "goal": "验证回路编译",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                {
                    "id": "draft", "type": "workflowStep",
                    "position": { "x": 0, "y": 0 },
                    "data": { "stepType": "task", "agentId": "agent-1", "title": "起草", "instructions": "产出初稿" }
                },
                {
                    "id": "revise", "type": "workflowStep",
                    "position": { "x": 200, "y": 0 },
                    "data": { "stepType": "task", "agentId": "agent-2", "title": "修订", "instructions": "补充细节" }
                },
                {
                    "id": "review", "type": "workflowStep",
                    "position": { "x": 400, "y": 0 },
                    "data": { "stepType": "review", "title": "审核", "instructions": "审核回路结果", "reviewScope": ["draft", "revise"], "maxRetry": 2 }
                },
                {
                    "id": "result", "type": "workflowStep",
                    "position": { "x": 600, "y": 0 },
                    "data": { "stepType": "result", "title": "最终结果", "instructions": "汇总" }
                }
            ],
            "edges": [
                { "id": "draft->revise", "source": "draft", "target": "revise" },
                { "id": "revise->review", "source": "revise", "target": "review" },
                { "id": "draft->review", "source": "draft", "target": "review" },
                { "id": "review->result", "source": "review", "target": "result" }
            ]
        })
        .to_string()
    }
    #[test]
    fn test_compile_success() {
        let graph = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        assert_eq!(graph.steps.len(), 3);
        assert_eq!(graph.edges.len(), 2);
        assert!(!graph.plan_hash.is_empty());
        assert!(!graph.compiled_graph_hash.is_empty());
    }

    #[test]
    fn test_ready_steps() {
        let graph = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        // task_1 and task_2 have no incoming edges
        assert!(graph.ready_step_keys.contains(&"task_1".to_string()));
        assert!(graph.ready_step_keys.contains(&"task_2".to_string()));
        assert!(!graph.ready_step_keys.contains(&"result".to_string()));
    }

    #[test]
    fn detects_parallel_task_members_sharing_workspace_before_run() {
        let graph = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        let workspaces = HashMap::from([
            ("agent-1".to_string(), "/workspace/project".to_string()),
            ("agent-2".to_string(), "/workspace/project/".to_string()),
        ]);

        let conflicts = WorkflowCompiler::find_parallel_workspace_conflicts(&graph, &workspaces);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].wave_index, 0);
        assert_eq!(conflicts[0].workspace_path, "/workspace/project");
        assert_eq!(
            conflicts[0].members,
            vec![
                ParallelWorkspaceMember {
                    agent_id: "agent-1".to_string(),
                    step_keys: vec!["task_1".to_string()],
                },
                ParallelWorkspaceMember {
                    agent_id: "agent-2".to_string(),
                    step_keys: vec!["task_2".to_string()],
                },
            ]
        );
    }

    #[test]
    fn ignores_same_workspace_members_when_tasks_are_serial() {
        let plan = serde_json::json!({
            "version": 1,
            "title": "Serial task test",
            "goal": "Serial task members share workspace but cannot run together",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                { "id": "a", "type": "workflowStep", "position": { "x": 0, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-1", "title": "A", "instructions": "A" } },
                { "id": "b", "type": "workflowStep", "position": { "x": 200, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-2", "title": "B", "instructions": "B" } },
                { "id": "result", "type": "workflowStep", "position": { "x": 400, "y": 0 }, "data": { "stepType": "result", "title": "Result", "instructions": "Result" } }
            ],
            "edges": [
                { "id": "a->b", "source": "a", "target": "b" },
                { "id": "b->result", "source": "b", "target": "result" }
            ]
        })
        .to_string();
        let graph = WorkflowCompiler::compile_from_json(&plan, &agents()).unwrap();
        let workspaces = HashMap::from([
            ("agent-1".to_string(), "/workspace/project".to_string()),
            ("agent-2".to_string(), "/workspace/project".to_string()),
        ]);

        let conflicts = WorkflowCompiler::find_parallel_workspace_conflicts(&graph, &workspaces);

        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_deterministic_hash() {
        let graph1 = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        let graph2 = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        assert_eq!(graph1.plan_hash, graph2.plan_hash);
        assert_eq!(graph1.compiled_graph_hash, graph2.compiled_graph_hash);
    }

    #[test]
    fn test_compile_invalid_json() {
        let result = WorkflowCompiler::compile_from_json("not json", &agents());
        assert!(result.is_err());
    }

    #[test]
    fn test_compile_invalid_plan() {
        let json = r#"{ "version": 1, "title": "", "goal": "test", "agents": {"lead": "x", "available": []}, "nodes": [], "edges": [] }"#;
        let result = WorkflowCompiler::compile_from_json(json, &["x".into()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_topological_order() {
        let graph = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        // result must come after task_1 and task_2
        let result_pos = graph
            .steps
            .iter()
            .position(|s| s.step_key == "result")
            .unwrap();
        let task1_pos = graph
            .steps
            .iter()
            .position(|s| s.step_key == "task_1")
            .unwrap();
        let task2_pos = graph
            .steps
            .iter()
            .position(|s| s.step_key == "task_2")
            .unwrap();
        assert!(result_pos > task1_pos);
        assert!(result_pos > task2_pos);
    }

    #[test]
    fn test_compile_loops_from_review_scope() {
        let graph = WorkflowCompiler::compile_from_json(&loop_plan_json(), &agents()).unwrap();
        let loops = graph.loops.expect("explicit review scope loops");

        assert_eq!(loops.len(), 1);
        assert_eq!(loops[0].loop_key, "loop-review");
        let mut member_keys = loops[0].member_step_keys.clone();
        member_keys.sort();
        assert_eq!(member_keys, vec!["draft", "revise"]);
        assert_eq!(loops[0].review_step_key, "review");
        assert_eq!(loops[0].review_scope_step_keys, vec!["draft", "revise"]);
        assert_eq!(loops[0].max_retry, 2);
        assert!(loops[0].user_review_required);

        for step in &graph.steps {
            if step.step_key == "draft" || step.step_key == "revise" || step.step_key == "review" {
                assert_eq!(step.loop_key, Some("loop-review".to_string()));
            } else {
                assert_eq!(step.loop_key, None);
            }
        }
    }

    #[test]
    fn test_compile_rejects_non_predecessor_review_scope() {
        let mut invalid: serde_json::Value = serde_json::from_str(&loop_plan_json()).unwrap();
        // "result" is not a predecessor task of review node
        invalid["nodes"][2]["data"]["reviewScope"] = serde_json::json!(["result"]);
        let result = WorkflowCompiler::compile_from_json(&invalid.to_string(), &agents());

        assert!(
            matches!(result, Err(CompileError::CompileError(message)) if message.contains("reviewScope"))
        );
    }

    #[test]
    fn test_compile_rejects_shared_scope_across_loops() {
        let invalid = serde_json::json!({
            "version": 1,
            "title": "共享前置节点",
            "goal": "验证节点不能属于多个回路",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                { "id": "a1", "type": "workflowStep", "position": { "x": 0, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-1", "title": "A1", "instructions": "A1" } },
                { "id": "a_review", "type": "workflowStep", "position": { "x": 0, "y": 100 }, "data": { "stepType": "review", "title": "A Review", "instructions": "review", "reviewScope": ["a1"] } },
                { "id": "b_review", "type": "workflowStep", "position": { "x": 200, "y": 100 }, "data": { "stepType": "review", "title": "B Review", "instructions": "review", "reviewScope": ["a1"] } },
                { "id": "result", "type": "workflowStep", "position": { "x": 400, "y": 50 }, "data": { "stepType": "result", "title": "Result", "instructions": "汇总" } }
            ],
            "edges": [
                { "id": "a1->a_review", "source": "a1", "target": "a_review" },
                { "id": "a1->b_review", "source": "a1", "target": "b_review" },
                { "id": "a_review->result", "source": "a_review", "target": "result" },
                { "id": "b_review->result", "source": "b_review", "target": "result" }
            ]
        })
        .to_string();
        let result = WorkflowCompiler::compile_from_json(&invalid, &agents());

        assert!(
            matches!(result, Err(CompileError::CompileError(message)) if message.contains("declared by both"))
        );
    }

    #[test]
    fn test_review_without_scope_does_not_create_loop() {
        let plan = serde_json::json!({
            "version": 1,
            "title": "Plain review test",
            "goal": "Review without scope is not a loop",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                { "id": "a", "type": "workflowStep", "position": { "x": 0, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-1", "title": "A", "instructions": "A" } },
                { "id": "b", "type": "workflowStep", "position": { "x": 200, "y": 0 }, "data": { "stepType": "review", "title": "B", "instructions": "review" } },
                { "id": "result", "type": "workflowStep", "position": { "x": 400, "y": 0 }, "data": { "stepType": "result", "title": "Result", "instructions": "result" } }
            ],
            "edges": [
                { "id": "a->b", "source": "a", "target": "b" },
                { "id": "b->result", "source": "b", "target": "result" }
            ]
        })
        .to_string();

        let graph = WorkflowCompiler::compile_from_json(&plan, &agents()).unwrap();
        assert!(graph.loops.is_none());
    }

    #[test]
    fn test_compile_rejects_missing_intermediate_scope_task() {
        let mut invalid: serde_json::Value = serde_json::from_str(&loop_plan_json()).unwrap();
        invalid["nodes"][2]["data"]["reviewScope"] = serde_json::json!(["draft"]);
        let result = WorkflowCompiler::compile_from_json(&invalid.to_string(), &agents());

        assert!(
            matches!(result, Err(CompileError::CompileError(message)) if message.contains("revise"))
        );
    }

    #[test]
    fn test_compile_reports_all_review_scope_errors() {
        let invalid = serde_json::json!({
            "version": 1,
            "title": "Invalid review scope",
            "goal": "Collect all review scope errors",
            "agents": { "lead": "lead-agent", "available": ["agent-1", "agent-2"] },
            "nodes": [
                { "id": "draft", "type": "workflowStep", "position": { "x": 0, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-1", "title": "Draft", "instructions": "Draft" } },
                { "id": "revise", "type": "workflowStep", "position": { "x": 200, "y": 0 }, "data": { "stepType": "task", "agentId": "agent-2", "title": "Revise", "instructions": "Revise" } },
                { "id": "side", "type": "workflowStep", "position": { "x": 200, "y": 100 }, "data": { "stepType": "task", "agentId": "agent-2", "title": "Side", "instructions": "Side" } },
                { "id": "review", "type": "workflowStep", "position": { "x": 400, "y": 0 }, "data": { "stepType": "review", "title": "Review", "instructions": "Review", "reviewScope": ["draft", "draft", "missing", "review", "side"] } },
                { "id": "result", "type": "workflowStep", "position": { "x": 600, "y": 0 }, "data": { "stepType": "result", "title": "Result", "instructions": "Result" } }
            ],
            "edges": [
                { "id": "draft->revise", "source": "draft", "target": "revise" },
                { "id": "revise->review", "source": "revise", "target": "review" },
                { "id": "review->result", "source": "review", "target": "result" },
                { "id": "side->result", "source": "side", "target": "result" }
            ]
        })
        .to_string();
        let result = WorkflowCompiler::compile_from_json(&invalid, &agents());

        let Err(CompileError::CompileError(message)) = result else {
            panic!("expected aggregated reviewScope errors");
        };
        assert!(message.contains("more than once"));
        assert!(message.contains("missing"));
        assert!(message.contains("type 'review'"));
        assert!(message.contains("not a predecessor"));
        assert!(message.contains("revise"));
    }

    #[test]
    fn test_no_loops_without_review_nodes() {
        // Plans without review nodes should have no loops
        let graph = WorkflowCompiler::compile_from_json(sample_plan_json(), &agents()).unwrap();
        assert!(graph.loops.is_none());
    }
}
