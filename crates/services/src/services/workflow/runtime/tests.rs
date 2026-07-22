#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use chrono::Utc;
    use db::models::{
        chat_agent::ChatAgent,
        chat_session::{ChatSession, ChatSessionStatus, ChatSessionWorktreeMode},
        chat_session_agent::{ChatSessionAgent, ChatSessionAgentState},
        member_execution_config::MemberExecutionConfig,
        workflow_plan::WorkflowPlan,
        workflow_plan_revision::WorkflowPlanRevision,
        workflow_step_edge::WorkflowStepEdge,
        workflow_types::{
            WorkflowAgentSessionRole, WorkflowAgentSessionState, WorkflowEdgeKind,
            WorkflowPlanStatus, WorkflowRevisionEditor, WorkflowValidationStatus,
            to_workflow_wire_value,
        },
    };
    use executors::logs::{FileChange, ToolResult};
    use sqlx::{SqlitePool, types::Json};

    use super::*;

    async fn setup_runtime_worktree_db() -> DBService {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(
            r#"
            CREATE TABLE chat_session_worktrees (
                id                    BLOB    NOT NULL PRIMARY KEY,
                session_id            BLOB    NOT NULL,
                project_id            BLOB,
                base_workspace_path   TEXT    NOT NULL,
                repo_path             TEXT    NOT NULL,
                base_branch           TEXT    NOT NULL,
                base_commit           TEXT,
                branch_name           TEXT    NOT NULL,
                worktree_path         TEXT    NOT NULL,
                mode                  TEXT    NOT NULL DEFAULT 'session'
                                            CHECK (mode IN ('session')),
                status                TEXT    NOT NULL DEFAULT 'creating'
                                            CHECK (status IN (
                                                'creating', 'active', 'dirty', 'merging',
                                                'needs_conflict_resolution', 'merged',
                                                'archived', 'cleanup_pending', 'cleanup_failed'
                                            )),
                merge_target_branch   TEXT,
                merge_operation       TEXT
                                            CHECK (merge_operation IS NULL
                                                   OR merge_operation IN (
                                                       'merge', 'squash_merge', 'cherry_pick', 'rebase'
                                                   )),
                conflict_files_json   TEXT    NOT NULL DEFAULT '[]',
                operation_started_at  TEXT,
                cleanup_error         TEXT,
                last_used_at          TEXT,
                merged_at             TEXT,
                archived_at           TEXT,
                created_at            TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at            TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            );

            CREATE UNIQUE INDEX idx_chat_session_worktrees_active_session
                ON chat_session_worktrees(session_id)
                WHERE status IN ('creating', 'active', 'dirty', 'merging',
                                 'needs_conflict_resolution', 'merged', 'cleanup_pending');

            CREATE TABLE chat_session_agents (
                id                  BLOB    NOT NULL PRIMARY KEY,
                session_id          BLOB    NOT NULL,
                agent_id            BLOB    NOT NULL,
                state               TEXT    NOT NULL DEFAULT 'idle',
                workspace_path      TEXT,
                pty_session_key     TEXT,
                agent_session_id    TEXT,
                agent_message_id    BLOB,
                project_member_id   BLOB,
                execution_config    TEXT    NOT NULL DEFAULT '{}',
                allowed_skill_ids   TEXT    NOT NULL DEFAULT '[]',
                created_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at          TEXT    NOT NULL DEFAULT (datetime('now', 'subsec'))
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create chat_session_worktrees test schema");
        DBService { pool }
    }

    fn sample_chat_session(
        worktree_mode: ChatSessionWorktreeMode,
        default_workspace_path: Option<String>,
    ) -> ChatSession {
        let now = Utc::now();
        ChatSession {
            id: Uuid::new_v4(),
            title: Some("workflow runtime test".to_string()),
            status: ChatSessionStatus::Active,
            lead_agent_id: None,
            lead_session_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            default_workspace_path,
            chat_input_mode: None,
            project_id: None,
            worktree_mode,
            pinned_at: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout={}\nstderr={}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_git_repo(repo: &Path) {
        std::fs::create_dir_all(repo).expect("create repo dir");
        let output = Command::new("git")
            .arg("init")
            .arg("-b")
            .arg("main")
            .arg(repo)
            .output()
            .expect("git init");
        assert!(
            output.status.success(),
            "git init failed\nstdout={}\nstderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        git(repo, &["config", "user.email", "workflow@example.test"]);
        git(repo, &["config", "user.name", "Workflow Runtime"]);
        std::fs::write(repo.join("README.md"), "base\n").expect("write seed file");
        git(repo, &["add", "."]);
        git(repo, &["commit", "-m", "initial"]);
    }

    fn sample_plan_json() -> String {
        serde_json::json!({
            "version": "1",
            "title": "Projection Contract",
            "goal": "Verify projection statuses",
            "agents": {
                "lead": "agent-1",
                "available": ["agent-1"]
            },
            "nodes": [
                {
                    "id": "step-1",
                    "type": "workflowStep",
                    "position": { "x": 0.0, "y": 0.0 },
                    "data": {
                        "stepType": "task",
                        "agentId": "agent-1",
                        "title": "Step 1",
                        "instructions": "Run step 1"
                    }
                }
            ],
            "edges": []
        })
        .to_string()
    }

    #[test]
    fn workflow_prompt_debug_kind_covers_iteration_and_reviews() {
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "# Workflow Plan Generation\n\n## Iteration Context\nfeedback",
                false,
            ),
            "iteration_feedback_plan_generation"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "You are reviewing a worker's step task output.\n\n## Step Under Review",
                false,
            ),
            "lead_review"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "You are revising a step in an workflow based on review feedback.\n\n## User Revision Required",
                true,
            ),
            "step_revision_user_feedback"
        );
        assert_eq!(
            infer_workflow_prompt_debug_kind(
                "Your previous workflow loop review output response did not match the required JSON protocol.",
                true,
            ),
            "protocol_retry_loop_review_output"
        );
    }

    #[test]
    fn workflow_prompt_debug_step_key_can_be_extracted_from_prompt() {
        assert_eq!(
            extract_workflow_prompt_step_key(
                "Return one JSON object. Fill `step_key` with `build_ui`, `execution_id` with `abc`."
            ),
            Some("build_ui".to_string())
        );
        assert_eq!(
            extract_workflow_prompt_step_key("Rules:\n- step_key: qa_review\n- execution_id: abc"),
            Some("qa_review".to_string())
        );
    }

    fn sample_execution(status: WorkflowExecutionStatus) -> WorkflowExecution {
        let now = Utc::now();
        WorkflowExecution {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            plan_id: Uuid::new_v4(),
            active_revision_id: Some(Uuid::new_v4()),
            active_round_id: Some(Uuid::new_v4()),
            workflow_card_message_id: None,
            lead_session_agent_id: None,
            status,
            current_round: 1,
            title: "Projection Contract".to_string(),
            compiled_graph_hash: Some("hash".to_string()),
            started_at: None,
            completed_at: None,
            cleaned_at: None,
            cleaned_reason: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_plan(plan_id: Uuid) -> WorkflowPlan {
        let now = Utc::now();
        WorkflowPlan {
            id: plan_id,
            session_id: Uuid::new_v4(),
            source_message_id: None,
            created_by_session_agent_id: None,
            status: WorkflowPlanStatus::Ready,
            title: "Projection Contract".to_string(),
            summary_text: Some("Verify projection statuses".to_string()),
            plan_json: sample_plan_json(),
            plan_schema_version: 1,
            plan_hash: "hash".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
            workflow_card_message_id: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn sample_revision(plan_id: Uuid, plan_json: String) -> WorkflowPlanRevision {
        WorkflowPlanRevision {
            id: Uuid::new_v4(),
            plan_id,
            revision_no: 1,
            edited_by: WorkflowRevisionEditor::Lead,
            editor_session_agent_id: None,
            reason: None,
            plan_json,
            plan_hash: "hash".to_string(),
            validation_status: WorkflowValidationStatus::Valid,
            validation_errors_json: None,
            created_at: Utc::now(),
        }
    }

    fn sample_step(status: WorkflowStepStatus) -> WorkflowStep {
        let now = Utc::now();
        WorkflowStep {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            round_id: Uuid::new_v4(),
            compiled_revision_id: None,
            step_key: "step-1".to_string(),
            step_type: WorkflowStepType::Task,
            title: "Step 1".to_string(),
            instructions: "Run step 1".to_string(),
            assigned_workflow_agent_session_id: None,
            status,
            retry_count: 0,
            max_retry: 1,
            round_index: 1,
            display_order: 0,
            latest_run_id: None,
            summary_text: None,
            content: None,
            loop_id: None,
            lead_review_required: true,
            user_review_required: false,
            revision_context: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: None,
        }
    }

    fn sample_edge(from_step_id: Uuid, to_step_id: Uuid) -> WorkflowStepEdge {
        WorkflowStepEdge {
            id: Uuid::new_v4(),
            execution_id: Uuid::new_v4(),
            compiled_revision_id: None,
            from_step_id,
            to_step_id,
            edge_kind: WorkflowEdgeKind::Hard,
            created_at: Utc::now(),
        }
    }

    fn sample_agent_views() -> (Vec<ChatSessionAgent>, Vec<ChatAgent>) {
        let now = Utc::now();
        let agent_id = Uuid::new_v4();
        let session_agent = ChatSessionAgent {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            agent_id,
            state: ChatSessionAgentState::Idle,
            workspace_path: None,
            pty_session_key: None,
            agent_session_id: None,
            agent_message_id: None,
            project_member_id: None,
            member_name: "member".to_string(),
            execution_config: Json(MemberExecutionConfig::default()),
            allowed_skill_ids: Json(Vec::new()),
            created_at: now,
            updated_at: now,
        };
        let agent = ChatAgent {
            id: agent_id,
            name: "Agent 1".to_string(),
            runner_type: "codex".to_string(),
            system_prompt: String::new(),
            tools_enabled: Json(serde_json::json!({})),
            model_name: None,
            owner_project_id: None,
            created_at: now,
            updated_at: now,
        };

        (vec![session_agent], vec![agent])
    }

    #[test]
    fn lead_resolution_prefers_session_member_id_for_shared_backing_agent() {
        let (mut session_agents, mut agents) = sample_agent_views();
        let mut second_member = session_agents[0].clone();
        second_member.id = Uuid::new_v4();
        second_member.member_name = "reviewer".to_string();
        let mut second_agent_view = agents[0].clone();
        second_agent_view.name = second_member.member_name.clone();
        session_agents.push(second_member.clone());
        agents.push(second_agent_view);

        let mut session = sample_chat_session(ChatSessionWorktreeMode::Inherit, None);
        session.id = second_member.session_id;
        session.lead_agent_id = Some(second_member.agent_id);
        session.lead_session_agent_id = Some(second_member.id);

        let (lead_agent, lead_member) =
            resolve_lead_agent(&session, &session_agents, &agents).expect("resolve lead member");
        assert_eq!(lead_member.id, second_member.id);
        assert_eq!(lead_agent.name, "reviewer");
    }

    #[test]
    fn changed_execution_config_forces_workflow_follow_up_to_spawn_fresh() {
        let (session_agents, _) = sample_agent_views();
        let session_agent = &session_agents[0];
        let workflow_session = WorkflowAgentSession {
            id: Uuid::new_v4(),
            workflow_execution_id: Uuid::new_v4(),
            session_agent_id: session_agent.id,
            role: WorkflowAgentSessionRole::Worker,
            agent_session_id: None,
            agent_message_id: None,
            state: WorkflowAgentSessionState::Running,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let (resume_session_id, reset_to_message_id) =
            resolve_workflow_resume(true, true, Some(&workflow_session), session_agent)
                .expect("changed config should not require an old runtime session");

        assert_eq!(resume_session_id, None);
        assert_eq!(reset_to_message_id, None);
    }

    #[test]
    fn unchanged_execution_config_preserves_workflow_follow_up_session() {
        let (mut session_agents, _) = sample_agent_views();
        let session_agent = &mut session_agents[0];
        session_agent.agent_session_id = Some("session-agent-fallback".to_string());
        let workflow_session = WorkflowAgentSession {
            id: Uuid::new_v4(),
            workflow_execution_id: Uuid::new_v4(),
            session_agent_id: session_agent.id,
            role: WorkflowAgentSessionRole::Worker,
            agent_session_id: Some("workflow-session".to_string()),
            agent_message_id: Some("workflow-message".to_string()),
            state: WorkflowAgentSessionState::Running,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let (resume_session_id, reset_to_message_id) =
            resolve_workflow_resume(true, false, Some(&workflow_session), session_agent)
                .expect("unchanged config should preserve follow-up session");

        assert_eq!(resume_session_id, Some("workflow-session"));
        assert_eq!(reset_to_message_id, Some("workflow-message"));
    }

    #[tokio::test]
    async fn workflow_resolve_workspace_path_lazy_creates_worktree_for_first_isolated_run() {
        let db = setup_runtime_worktree_db().await;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let base = tmp.path().join("base");
        init_git_repo(&base);
        let base_workspace = base.to_string_lossy().to_string();
        let session = sample_chat_session(
            ChatSessionWorktreeMode::Isolated,
            Some(base_workspace.clone()),
        );
        let (session_agents, agents) = sample_agent_views();
        let mut session_agent = session_agents[0].clone();
        session_agent.session_id = session.id;
        session_agent.workspace_path = Some(base_workspace.clone());
        let agent = &agents[0];

        let resolved = resolve_workspace_path(&db, &session, agent, &session_agent)
            .await
            .expect("resolve isolated workflow workspace");

        assert_ne!(resolved, base);
        assert!(resolved.exists());

        let active_worktree_path: String = sqlx::query_scalar(
            "SELECT worktree_path FROM chat_session_worktrees WHERE session_id = ?1 AND status = 'active'",
        )
        .bind(session.id)
        .fetch_one(&db.pool)
        .await
        .expect("active worktree row");
        assert_eq!(resolved.to_string_lossy(), active_worktree_path);

        SessionWorktreeService::new(db.pool.clone())
            .discard_worktree(session.id)
            .await
            .expect("discard test worktree");

        let after_discard = resolve_workspace_path(&db, &session, agent, &session_agent)
            .await
            .expect("resolve after discard");
        assert_eq!(after_discard, base);
    }

    #[tokio::test]
    async fn workflow_resolve_workspace_path_uses_existing_active_worktree() {
        let db = setup_runtime_worktree_db().await;
        let base_workspace = "E:/workspace/base";
        let worktree_workspace = "E:/workspace/.openteams/worktrees/session";
        let session = sample_chat_session(
            ChatSessionWorktreeMode::Isolated,
            Some(base_workspace.to_string()),
        );
        let (session_agents, agents) = sample_agent_views();
        let session_agent = &session_agents[0];
        let agent = &agents[0];

        sqlx::query(
            r#"
            INSERT INTO chat_session_worktrees (
                id, session_id, base_workspace_path, repo_path, base_branch,
                branch_name, worktree_path, mode, status
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'active')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session.id)
        .bind(base_workspace)
        .bind(base_workspace)
        .bind("main")
        .bind("openteams/session/test")
        .bind(worktree_workspace)
        .execute(&db.pool)
        .await
        .expect("insert active worktree");

        let resolved = resolve_workspace_path(&db, &session, agent, session_agent)
            .await
            .expect("resolve active worktree");

        assert_eq!(resolved, PathBuf::from(worktree_workspace));
    }

    #[tokio::test]
    async fn workflow_resolve_workspace_path_returns_base_after_terminal_worktree() {
        let db = setup_runtime_worktree_db().await;
        let base_workspace = "E:/workspace/base";
        let worktree_workspace = "E:/workspace/.openteams/worktrees/session";
        let session = sample_chat_session(
            ChatSessionWorktreeMode::Isolated,
            Some(base_workspace.to_string()),
        );
        let (session_agents, agents) = sample_agent_views();
        let session_agent = &session_agents[0];
        let agent = &agents[0];

        sqlx::query(
            r#"
            INSERT INTO chat_session_worktrees (
                id, session_id, base_workspace_path, repo_path, base_branch,
                branch_name, worktree_path, mode, status, archived_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'archived', datetime('now', 'subsec'))
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session.id)
        .bind(base_workspace)
        .bind(base_workspace)
        .bind("main")
        .bind("openteams/session/test")
        .bind(worktree_workspace)
        .execute(&db.pool)
        .await
        .expect("insert archived worktree");

        let resolved = resolve_workspace_path(&db, &session, agent, session_agent)
            .await
            .expect("resolve archived worktree");

        assert_eq!(resolved, PathBuf::from(base_workspace));
    }

    fn sample_step_review(step: &WorkflowStep) -> WorkflowStepReview {
        WorkflowStepReview {
            id: Uuid::new_v4(),
            step_id: step.id,
            execution_id: step.execution_id,
            reviewer_type: db::models::workflow_types::ReviewerType::Lead,
            reviewer_id: Some(Uuid::new_v4().to_string()),
            verdict: ReviewVerdict::Approved,
            feedback: "Looks good".to_string(),
            review_round: 1,
            created_at: Utc::now(),
        }
    }

    fn sample_step_review_transcript(step: &WorkflowStep) -> WorkflowTranscript {
        WorkflowTranscript {
            id: Uuid::new_v4(),
            execution_id: step.execution_id,
            round_id: Some(step.round_id),
            workflow_agent_session_id: Some(Uuid::new_v4()),
            step_id: Some(step.id),
            sender_type: "control".to_string(),
            entry_type: "step_review".to_string(),
            content: format!("请审核步骤「{}」的执行结果", step.title),
            meta_json: Some(
                serde_json::json!({
                    "summary": "Need user confirmation",
                    "resolved": false,
                })
                .to_string(),
            ),
            created_at: Utc::now().to_rfc3339(),
        }
    }

    fn sample_step_run_result() -> WorkflowStepRunResult {
        WorkflowStepRunResult {
            run_id: Uuid::new_v4(),
            summary: "Implemented the requested fix".to_string(),
            content: "Updated the handler and added validation.".to_string(),
            outputs: vec!["src/handler.rs".to_string(), "tests/handler.rs".to_string()],
        }
    }

    #[test]
    fn build_plan_generation_prompt_includes_previous_failure_reason() {
        let prompt = build_plan_generation_prompt(
            "Ship the confirmed implementation plan.",
            "lead-agent-id",
            &[],
            Some("Missing result node in the previous workflow JSON."),
            None,
            "You MUST write human-readable JSON string values in Simplified Chinese.",
            None,
        );

        assert!(prompt.starts_with("# Workflow Plan Generation"));
        assert!(prompt.contains("## Stable Output Contract"));
        assert!(prompt.contains("## Dynamic Inputs"));
        assert!(prompt.contains("Missing result node in the previous workflow JSON."));
        assert!(prompt.contains("Do not repeat the same failure."));
        assert!(prompt.contains("Ship the confirmed implementation plan."));
        assert!(
            prompt.contains(
                "You MUST write human-readable JSON string values in Simplified Chinese."
            )
        );
        assert!(!prompt.contains("\"userReview\": \"optional boolean"));
        assert!(!prompt.contains("\"leadReview\": \"optional boolean"));
        assert!(prompt.contains("Do not output or infer `leadReview` or `userReview`."));
        assert!(
            prompt
                .find("## WorkflowPlanJson Schema Reference")
                .expect("schema section")
                < prompt
                    .find("## Dynamic Inputs")
                    .expect("dynamic inputs section")
        );
    }

    #[test]
    fn build_plan_generation_prompt_includes_previous_plan_json() {
        let previous_plan_json = r#"{"version":"1","title":"Existing Plan","goal":"Original goal","agents":{"lead":"lead-agent-id","available":["lead-agent-id"]},"nodes":[],"edges":[]}"#;
        let prompt = build_plan_generation_prompt(
            "Add regression coverage to the existing plan.",
            "lead-agent-id",
            &[],
            None,
            Some(previous_plan_json),
            "You MUST write human-readable JSON string values in English.",
            None,
        );

        assert!(prompt.contains("Existing workflow plan JSON"));
        assert!(prompt.contains(previous_plan_json));
        assert!(prompt.contains("Use this existing plan as the baseline."));
        assert!(prompt.contains("return the complete revised workflow plan JSON"));
    }

    #[test]
    fn workflow_response_language_instruction_follows_ui_language() {
        assert_eq!(
            resolve_workflow_response_language_instruction(&UiLanguage::ZhHans),
            "You MUST write human-readable JSON string values in Simplified Chinese."
        );
        assert_eq!(
            resolve_workflow_response_language_instruction(&UiLanguage::En),
            "You MUST write human-readable JSON string values in English."
        );
    }

    #[test]
    fn predecessor_summaries_for_task_include_dependency_node_details() {
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "build-api".to_string();
        source.title = "Build API".to_string();
        source.instructions = "Implement the API".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "API is implemented",
                "content": "Implemented the endpoint and tests.",
                "outputs": ["crates/server/src/routes/api.rs"]
            })
            .to_string(),
        );
        let mut target = sample_step(WorkflowStepStatus::Ready);
        target.step_key = "wire-ui".to_string();
        let edge = sample_edge(source.id, target.id);

        let contexts = predecessor_summaries(&target, &[source, target.clone()], &[edge], None);

        assert_eq!(contexts.len(), 1);
        assert!(contexts[0].contains("## Dependency Node: Build API"));
        assert!(contexts[0].contains("- Step key: build-api"));
        assert!(contexts[0].contains("- Type: task"));
        assert!(contexts[0].contains("Implement the API"));
        assert!(contexts[0].contains("Implemented the endpoint and tests."));
        assert!(contexts[0].contains("crates/server/src/routes/api.rs"));
    }

    #[test]
    fn predecessor_summaries_for_review_include_reviewed_loop_nodes() {
        let loop_id = Uuid::new_v4();
        let mut reviewed = sample_step(WorkflowStepStatus::Completed);
        reviewed.step_key = "draft".to_string();
        reviewed.title = "Draft Feature".to_string();
        reviewed.instructions = "Draft the feature".to_string();
        reviewed.loop_id = Some(loop_id);
        reviewed.summary_text = Some(
            serde_json::json!({
                "summary": "Draft complete",
                "content": "Feature draft is ready for review.",
                "outputs": ["frontend/src/feature.tsx"]
            })
            .to_string(),
        );
        let mut review = sample_step(WorkflowStepStatus::Ready);
        review.step_key = "review".to_string();
        review.title = "Review Feature".to_string();
        review.step_type = WorkflowStepType::Review;
        review.loop_id = Some(loop_id);

        let contexts = predecessor_summaries(&review, &[review.clone(), reviewed], &[], None);

        assert_eq!(contexts.len(), 1);
        assert!(contexts[0].contains("## Reviewed Loop Node: Draft Feature"));
        assert!(contexts[0].contains("- Step key: draft"));
        assert!(contexts[0].contains("- Type: task"));
        assert!(contexts[0].contains("Feature draft is ready for review."));
    }

    #[test]
    fn predecessor_summaries_for_result_include_formal_results_and_plan_json() {
        let plan = sample_plan(Uuid::new_v4());
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "step-1".to_string();
        source.title = "Workflow Node Result".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "Step complete",
                "content": "Done.",
                "outputs": []
            })
            .to_string(),
        );
        let mut result = sample_step(WorkflowStepStatus::Ready);
        result.step_key = "result".to_string();
        result.title = "Result".to_string();
        result.step_type = WorkflowStepType::Result;
        let edge = sample_edge(source.id, result.id);

        let contexts =
            predecessor_summaries(&result, &[source, result.clone()], &[edge], Some(&plan));

        assert!(contexts[0].contains("Formal Predecessor Results"));
        assert!(contexts[0].contains("## Formal Predecessor Result: Workflow Node Result"));
        assert!(contexts[0].contains("Step complete"));
        assert!(contexts[0].contains("Done."));
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Workflow Node Result"))
        );
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Full Workflow Plan JSON"))
        );
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("\"title\": \"Projection Contract\""))
        );
    }

    #[test]
    fn predecessor_summaries_for_result_include_reviewer_conclusions() {
        let mut source = sample_step(WorkflowStepStatus::Completed);
        source.step_key = "step-1".to_string();
        source.title = "Build Feature".to_string();
        source.summary_text = Some(
            serde_json::json!({
                "summary": "Feature completed",
                "content": "Implemented and tested.",
                "outputs": []
            })
            .to_string(),
        );
        let mut result = sample_step(WorkflowStepStatus::Ready);
        result.step_key = "result".to_string();
        result.step_type = WorkflowStepType::Result;
        let edge = sample_edge(source.id, result.id);
        let review = sample_step_review(&source);

        let contexts = predecessor_summaries_with_reviews(
            &result,
            &[source, result.clone()],
            &[edge],
            None,
            &[review],
        );

        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Reviewer Conclusions"))
        );
        assert!(contexts.iter().any(|context| context.contains("approved")));
        assert!(
            contexts
                .iter()
                .any(|context| context.contains("Looks good"))
        );
    }

    #[test]
    fn build_lead_review_prompt_includes_required_sections() {
        let step = sample_step(WorkflowStepStatus::Running);
        let result = sample_step_run_result();

        let prompt = build_lead_review_prompt(
            "Ship a stable workflow review loop.",
            &step,
            &result,
            &[
                "Dependency A done".to_string(),
                "Dependency B done".to_string(),
            ],
            &[
                "Must pass tests".to_string(),
                "Must preserve API contract".to_string(),
            ],
            2,
        );

        assert!(prompt.contains("You are reviewing a worker's step task output."));
        assert!(prompt.contains("Ship a stable workflow review loop."));
        assert!(prompt.contains(&step.title));
        assert!(prompt.contains(&step.instructions));
        assert!(prompt.contains("Must pass tests"));
        assert!(prompt.contains("Must preserve API contract"));
        assert!(prompt.contains(&result.summary));
        assert!(prompt.contains(&result.content));
        assert!(prompt.contains("src/handler.rs"));
        assert!(prompt.contains("Dependency A done"));
        assert!(prompt.contains("\"type\": \"review_result\""));
        assert!(prompt.contains(&step.step_key));
        assert!(prompt.contains(&step.execution_id.to_string()));
        assert!(prompt.contains("Language Requirement"));
        assert!(prompt.contains("Review attempt: 2 of at most 5"));
        assert!(prompt.contains("report every issue you can identify in this single response"));
    }

    #[test]
    fn workflow_review_attempt_limit_is_five() {
        assert!(!workflow_review_attempt_limit_reached(4));
        assert!(workflow_review_attempt_limit_reached(5));
        assert!(workflow_review_attempt_limit_reached(6));
    }

    #[test]
    fn build_step_execution_prompt_requires_code_guidelines_for_task_steps() {
        let execution = sample_execution(WorkflowExecutionStatus::Running);
        let step = sample_step(WorkflowStepStatus::Running);

        let prompt =
            build_step_execution_prompt(&execution, "Update API validation", &step, &[], None);

        assert!(prompt.contains("Coding Task Skill Requirement"));
        assert!(prompt.contains("`code-guidelines` skill"));
        assert!(prompt.contains("before editing code"));
    }

    #[test]
    fn build_step_execution_prompt_does_not_add_code_guidelines_to_review_steps() {
        let execution = sample_execution(WorkflowExecutionStatus::Running);
        let mut step = sample_step(WorkflowStepStatus::Running);
        step.step_type = WorkflowStepType::Review;

        let prompt =
            build_step_execution_prompt(&execution, "Review implementation", &step, &[], None);

        assert!(!prompt.contains("Coding Task Skill Requirement"));
        assert!(!prompt.contains("`code-guidelines` skill"));
        assert!(prompt.contains("Workflow review is capped at five attempts"));
        assert!(prompt.contains("cite every issue you can identify in this single response"));
    }

    #[test]
    fn build_workspace_scoped_workflow_prompt_declares_active_workspace_as_project_repo() {
        let workspace_path = Path::new(
            r"C:\Users\Admin\AppData\Local\Temp\openteams-dev\worktrees\sessions\34a8ed29",
        );

        let prompt =
            build_workspace_scoped_workflow_prompt("Run the workflow step.", workspace_path);

        assert!(prompt.starts_with("[OPENTEAMS_SOURCE=openteams]\n\n"));
        assert_eq!(prompt.matches("[OPENTEAMS_SOURCE=openteams]").count(), 1);
        assert!(prompt.contains("## Workspace"));
        assert!(prompt.contains("Active workspace path"));
        assert!(prompt.contains("Treat this active workspace path as the project repository"));
        assert!(prompt.contains(
            r"C:\Users\Admin\AppData\Local\Temp\openteams-dev\worktrees\sessions\34a8ed29"
        ));
        assert!(prompt.ends_with("Run the workflow step."));
    }

    #[tokio::test]
    async fn workflow_prompt_after_worktree_discard_declares_base_workspace() {
        let db = setup_runtime_worktree_db().await;
        let base_workspace = "E:/workspace/base";
        let worktree_workspace = "E:/workspace/.openteams/worktrees/session";
        let session = sample_chat_session(
            ChatSessionWorktreeMode::Isolated,
            Some(base_workspace.to_string()),
        );
        let (session_agents, agents) = sample_agent_views();
        let mut session_agent = session_agents[0].clone();
        session_agent.session_id = session.id;
        session_agent.workspace_path = Some(worktree_workspace.to_string());
        let agent = &agents[0];

        sqlx::query(
            r#"
            INSERT INTO chat_session_agents (
                id, session_id, agent_id, state, workspace_path
            )
            VALUES (?1, ?2, ?3, 'idle', ?4)
            "#,
        )
        .bind(session_agent.id)
        .bind(session.id)
        .bind(agent.id)
        .bind(worktree_workspace)
        .execute(&db.pool)
        .await
        .expect("insert workflow session agent");

        sqlx::query(
            r#"
            INSERT INTO chat_session_worktrees (
                id, session_id, base_workspace_path, repo_path, base_branch,
                branch_name, worktree_path, mode, status, merged_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'session', 'merged', datetime('now', 'subsec'))
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(session.id)
        .bind(base_workspace)
        .bind(base_workspace)
        .bind("main")
        .bind("openteams/session/test")
        .bind(worktree_workspace)
        .execute(&db.pool)
        .await
        .expect("insert merged worktree");

        SessionWorktreeService::new(db.pool.clone())
            .discard_worktree(session.id)
            .await
            .expect("discard worktree");

        let resolved = resolve_workspace_path(&db, &session, agent, &session_agent)
            .await
            .expect("resolve workflow workspace");
        assert_eq!(resolved, PathBuf::from(base_workspace));

        let prompt = build_workspace_scoped_workflow_prompt("Run the workflow step.", &resolved);

        assert!(prompt.contains("Active workspace path: `E:/workspace/base`"));
        assert!(!prompt.contains(worktree_workspace));
    }

    #[test]
    fn build_step_revision_prompt_supports_lead_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::Lead,
            "补充错误处理和日志记录。",
            "已经完成主流程，但漏掉异常分支。",
            Some("Full previous lead result"),
            2,
        );

        assert!(prompt.contains("## Revision Required (attempt #2)"));
        assert!(prompt.contains("did not pass review"));
        assert!(prompt.contains("补充错误处理和日志记录。"));
        assert!(prompt.contains("已经完成主流程，但漏掉异常分支。"));
        assert!(prompt.contains(&step.title));
        assert!(prompt.contains(&step.instructions));
        // retry_count == 2, PUA should NOT be active
        assert!(!prompt.contains("Performance Improvement Plan"));
    }

    #[test]
    fn build_step_revision_prompt_supports_user_feedback_template() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::User,
            "请把输出改成中文，并补一份测试说明。",
            "上次结果结构正确，但文案不符合预期。",
            None,
            1,
        );

        assert!(prompt.contains("## User Revision Required (attempt #1)"));
        assert!(prompt.contains("did not pass user review"));
        assert!(prompt.contains("请把输出改成中文，并补一份测试说明。"));
        assert!(prompt.contains("上次结果结构正确，但文案不符合预期。"));
        assert!(prompt.contains("highest priority"));
        assert!(prompt.contains(&step.title));
    }

    #[test]
    fn build_step_revision_prompt_forces_pua_on_high_retry() {
        let step = sample_step(WorkflowStepStatus::Revising);
        let prompt = build_step_revision_prompt(
            &step,
            WorkflowRevisionFeedbackSource::Lead,
            "Still missing error handling.",
            "Previous attempt incomplete.",
            None,
            3,
        );

        assert!(prompt.contains("Skill Activation: `pua` (MANDATORY)"));
        assert!(prompt.contains("Performance Improvement Plan"));
        assert!(prompt.contains("attempt #3"));
        assert!(prompt.contains("Non-Negotiable One"));
        assert!(prompt.contains("Non-Negotiable Two"));
        assert!(prompt.contains("Non-Negotiable Three"));
        assert!(prompt.contains("fundamentally different"));
        assert!(prompt.contains("Bias for Action"));
        assert!(prompt.contains("Dive Deep"));
        assert!(prompt.contains("Ownership"));
    }

    #[test]
    fn parse_review_protocol_output_accepts_approved_review() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "结果满足验收标准。"
}}"#,
            step.step_key, step.execution_id
        );

        let message = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect("parse");

        assert_eq!(
            message,
            WorkflowReviewProtocolMessage::ReviewResult {
                step_key: step.step_key,
                execution_id: step.execution_id.to_string(),
                verdict: ReviewVerdict::Approved,
                feedback: "结果满足验收标准。".to_string(),
            }
        );
    }

    #[test]
    fn parse_review_protocol_output_accepts_rejected_review() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "rejected",
  "feedback": "还缺少回归测试。"
}}"#,
            step.step_key, step.execution_id
        );

        let message = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect("parse");

        assert_eq!(
            message,
            WorkflowReviewProtocolMessage::ReviewResult {
                step_key: step.step_key,
                execution_id: step.execution_id.to_string(),
                verdict: ReviewVerdict::Rejected,
                feedback: "还缺少回归测试。".to_string(),
            }
        );
    }

    #[test]
    fn parse_review_protocol_output_rejects_invalid_review_payload() {
        let step = sample_step(WorkflowStepStatus::WaitingReview);
        let raw_output = format!(
            r#"{{
  "type": "review_result",
  "step_key": "{}",
  "execution_id": "{}",
  "verdict": "approved",
  "feedback": "   "
}}"#,
            step.step_key, step.execution_id
        );

        let err = parse_review_protocol_output(step.execution_id, &step.step_key, &raw_output)
            .expect_err("invalid");

        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }

    #[test]
    fn parse_step_protocol_output_accepts_approval_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "approval_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "title": "Need approval",
  "description": "Please confirm the patch."
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ApprovalRequest {
                title, description, ..
            } => {
                assert_eq!(title, "Need approval");
                assert_eq!(description.as_deref(), Some("Please confirm the patch."));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_continue_confirmation() {
        let execution_id = Uuid::new_v4();
        let step_key = "review";
        let raw_output = format!(
            r#"{{
  "type": "continue_confirmation",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "message": "Continue with deployment?"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::ContinueConfirmation { message, .. } => {
                assert_eq!(message, "Continue with deployment?");
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_accepts_input_request() {
        let execution_id = Uuid::new_v4();
        let step_key = "clarify";
        let raw_output = format!(
            r#"{{
  "type": "input_request",
  "step_key": "{step_key}",
  "execution_id": "{execution_id}",
  "prompt": "Please provide the release tag",
  "placeholder": "v1.2.3"
}}"#
        );

        let message =
            parse_step_protocol_output(execution_id, step_key, &raw_output).expect("parse");

        match message {
            WorkflowStepProtocolMessage::InputRequest {
                prompt,
                placeholder,
                ..
            } => {
                assert_eq!(prompt, "Please provide the release tag");
                assert_eq!(placeholder.as_deref(), Some("v1.2.3"));
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn parse_step_protocol_output_rejects_wrong_execution_id() {
        let execution_id = Uuid::new_v4();
        let raw_output = format!(
            r#"{{
  "type": "permission_request",
  "step_key": "review",
  "execution_id": "{}",
  "title": "Need permission"
}}"#,
            Uuid::new_v4()
        );

        let err =
            parse_step_protocol_output(execution_id, "review", &raw_output).expect_err("invalid");

        assert!(matches!(err, WorkflowRuntimeError::Validation(_)));
    }

    #[test]
    fn workflow_runtime_line_keeps_assistant_for_final_protocol_only() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::AssistantMessage,
            content: r#"{"type":"final_result","summary":"done"}"#.to_string(),
            metadata: None,
        };

        assert!(workflow_runtime_line_for_entry(&entry).is_none());
    }

    #[test]
    fn workflow_executor_failure_prefers_error_lines_from_stderr() {
        let history = vec![
            LogMsg::Stdout("normal progress\nmore normal progress\n".to_string()),
            LogMsg::Stderr(
                "debug detail that should not be surfaced\nERROR: model overloaded\n".to_string(),
            ),
        ];

        let message = workflow_executor_failure_message("codex", "workflow failed", &history);

        assert!(message.contains("Executor error:"));
        assert!(message.contains("ERROR: model overloaded"));
        assert!(!message.contains("debug detail that should not be surfaced"));
    }

    #[test]
    fn workflow_executor_failure_extracts_structured_json_error() {
        let history = vec![LogMsg::Stdout(
            serde_json::json!({
                "type": "error",
                "error": {
                    "message": "Gemini API key is invalid",
                    "debug": "large payload omitted"
                }
            })
            .to_string(),
        )];

        let message = workflow_executor_failure_message("gemini", "workflow failed", &history);

        assert!(message.contains("Gemini API key is invalid"));
        assert!(!message.contains("large payload omitted"));
    }

    #[test]
    fn cancel_running_step_cancels_late_registered_executor_token() {
        let step_id = Uuid::new_v4();
        clear_running_step(step_id);

        cancel_running_step(step_id);

        let token = executors::executors::CancellationToken::new();
        register_running_step(step_id, token.clone());
        assert!(token.is_cancelled());

        clear_running_step(step_id);
        let next_token = executors::executors::CancellationToken::new();
        register_running_step(step_id, next_token.clone());
        assert!(!next_token.is_cancelled());
        clear_running_step(step_id);
    }

    #[test]
    fn workflow_runtime_line_maps_reasoning_to_thinking() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::Thinking,
            content: "Checking the workflow state machine".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("thinking line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert_eq!(line.content, "Checking the workflow state machine");
        assert!(!line.immediate);
    }

    #[test]
    fn workflow_runtime_line_maps_file_edit_activity_to_thinking() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "edit".to_string(),
                action_type: ActionType::FileEdit {
                    path: "frontend/src/pages/ui-new/chat/components/WorkflowWindow.tsx"
                        .to_string(),
                    changes: vec![FileChange::Edit {
                        unified_diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
                        has_line_numbers: true,
                    }],
                },
                status: ToolStatus::Created,
            },
            content: "WorkflowWindow.tsx".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("file edit line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert!(line.immediate);
        assert!(line.content.contains("Started file edit"));
        assert!(line.content.contains("WorkflowWindow.tsx"));
        assert!(line.content.contains("1 edit"));
    }

    #[test]
    fn workflow_runtime_line_maps_mcp_progress_to_thinking_preview() {
        let entry = NormalizedEntry {
            timestamp: None,
            entry_type: NormalizedEntryType::ToolUse {
                tool_name: "mcp:github:search_issues".to_string(),
                action_type: ActionType::Tool {
                    tool_name: "github.search_issues".to_string(),
                    arguments: None,
                    result: Some(ToolResult::markdown(
                        "Fetched 3 matching issues\nmore detail",
                    )),
                },
                status: ToolStatus::Created,
            },
            content: "search_issues".to_string(),
            metadata: None,
        };

        let line = workflow_runtime_line_for_entry(&entry).expect("mcp progress line");

        assert!(matches!(line.stream_type, ChatStreamDeltaType::Thinking));
        assert!(line.immediate);
        assert_eq!(
            line.content,
            "Started MCP tool: github.search_issues: Fetched 3 matching issues"
        );
    }

    #[test]
    fn workflow_projection_uses_canonical_wire_statuses() {
        let plan_json = sample_plan_json();
        let mut expected_step_statuses = [
            WorkflowStepStatus::Pending,
            WorkflowStepStatus::Ready,
            WorkflowStepStatus::Running,
            WorkflowStepStatus::InterruptRequested,
            WorkflowStepStatus::Interrupted,
            WorkflowStepStatus::WaitingInput,
            WorkflowStepStatus::WaitingReview,
            WorkflowStepStatus::Blocked,
            WorkflowStepStatus::Completed,
            WorkflowStepStatus::Failed,
            WorkflowStepStatus::Skipped,
        ]
        .into_iter()
        .map(|status| {
            let execution = sample_execution(WorkflowExecutionStatus::Running);
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json.clone());
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
                &[sample_step(status.clone())],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                false,
                None,
            )
            .expect("build projection");

            let expected_status = to_workflow_wire_value(&status);
            assert_eq!(projection.steps[0].status, expected_status);
            assert_eq!(
                projection.plan.nodes[0].data.status.as_deref(),
                Some(expected_status.as_str())
            );

            projection.steps[0].status.clone()
        })
        .collect::<Vec<_>>();
        expected_step_statuses.sort();

        assert!(expected_step_statuses.contains(&"waiting_input".to_string()));
        assert!(expected_step_statuses.contains(&"waiting_review".to_string()));
        assert!(expected_step_statuses.contains(&"interrupt_requested".to_string()));

        for status in [
            WorkflowExecutionStatus::Pending,
            WorkflowExecutionStatus::Running,
            WorkflowExecutionStatus::Failed,
            WorkflowExecutionStatus::Paused,
            WorkflowExecutionStatus::Recompiling,
            WorkflowExecutionStatus::Completed,
            WorkflowExecutionStatus::Waiting,
        ] {
            let execution = sample_execution(status.clone());
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json.clone());
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
                &[sample_step(WorkflowStepStatus::Completed)],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                false,
                None,
            )
            .expect("build projection");

            assert_eq!(projection.execution_status, to_workflow_wire_value(&status));
            if matches!(status, WorkflowExecutionStatus::Recompiling) {
                assert!(matches!(projection.state, WorkflowCardState::Running));
            }
        }
    }

    #[test]
    fn workflow_projection_includes_pending_review_and_latest_review_fields() {
        let execution = sample_execution(WorkflowExecutionStatus::Waiting);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let mut step = sample_step(WorkflowStepStatus::WaitingInput);
        step.execution_id = execution.id;
        step.user_review_required = true;
        step.retry_count = 1;
        step.max_retry = 3;
        step.summary_text = Some(
            serde_json::json!({
                "summary": "Need user confirmation",
                "content": "Draft ready",
                "outputs": ["src/handler.rs"]
            })
            .to_string(),
        );
        let review = sample_step_review(&step);
        let transcript = sample_step_review_transcript(&step);

        let projection = build_workflow_card_projection(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            &[step.clone()],
            &[],
            &[],
            &[],
            &[],
            &[review],
            std::slice::from_ref(&transcript),
            &[],
            &session_agents,
            &agents,
            false,
            None,
        )
        .expect("build projection");

        assert_eq!(
            projection.steps[0].review_phase.as_deref(),
            Some("user_review")
        );
        assert_eq!(projection.steps[0].retry_count, 1);
        assert_eq!(projection.steps[0].max_retry, 3);
        assert_eq!(
            projection.steps[0]
                .latest_review
                .as_ref()
                .map(|item| item.verdict.as_str()),
            Some("approved")
        );
        assert_eq!(
            projection
                .pending_review
                .as_ref()
                .map(|item| item.review_type.as_str()),
            Some("step_user_review")
        );
        assert_eq!(
            projection
                .pending_review
                .as_ref()
                .map(|item| item.target_id.as_str()),
            Some(projection.steps[0].id.as_str())
        );
        assert_eq!(projection.pending_reviews.len(), 1);
        assert_eq!(
            projection.pending_reviews[0].review_id,
            transcript.id.to_string()
        );
    }

    #[test]
    fn workflow_projection_includes_all_pending_step_reviews() {
        let execution = sample_execution(WorkflowExecutionStatus::Waiting);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let mut first_step = sample_step(WorkflowStepStatus::WaitingInput);
        first_step.execution_id = execution.id;
        first_step.title = "First step".to_string();
        let mut second_step = sample_step(WorkflowStepStatus::WaitingInput);
        second_step.execution_id = execution.id;
        second_step.title = "Second step".to_string();
        let first_transcript = sample_step_review_transcript(&first_step);
        let second_transcript = sample_step_review_transcript(&second_step);

        let projection = build_workflow_card_projection(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            &[first_step.clone(), second_step.clone()],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[first_transcript.clone(), second_transcript.clone()],
            &[],
            &session_agents,
            &agents,
            false,
            None,
        )
        .expect("build projection");

        assert_eq!(projection.pending_reviews.len(), 2);
        assert_eq!(
            projection
                .pending_review
                .as_ref()
                .map(|review| review.review_id.clone()),
            Some(first_transcript.id.to_string())
        );
        assert_eq!(
            projection
                .pending_reviews
                .iter()
                .map(|review| review.target_id.clone())
                .collect::<Vec<_>>(),
            vec![first_step.id.to_string(), second_step.id.to_string()]
        );
    }

    #[test]
    fn lightweight_projection_excludes_step_content() {
        let execution = sample_execution(WorkflowExecutionStatus::Completed);
        let plan_json = sample_plan_json();
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, plan_json);
        let (session_agents, agents) = sample_agent_views();
        let mut step = sample_step(WorkflowStepStatus::Completed);
        step.execution_id = execution.id;
        step.content = Some("Detailed implementation content".to_string());
        step.summary_text = Some(r#"{"summary":"Fixed the bug","outputs":[]}"#.to_string());

        let projection = build_workflow_card_projection_lightweight(
            &execution,
            &plan,
            &revision,
            std::slice::from_ref(&revision),
            &[step.clone()],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &session_agents,
            &agents,
            Some(42i64),
            false,
            None,
        )
        .expect("build lightweight projection");
        assert_eq!(projection.has_transcripts, Some(true));
        assert_eq!(projection.round_graphs.len(), 1);
        assert!(projection.round_graphs[0].steps[0].content.is_none());
        assert!(projection.steps[0].content.is_none());
        assert_eq!(
            projection.steps[0].summary_text.as_deref(),
            Some("Fixed the bug")
        );
    }

    #[test]
    fn is_terminal_true_for_completed_and_failed() {
        for (status, expected_terminal) in [
            (WorkflowExecutionStatus::Completed, true),
            (WorkflowExecutionStatus::Failed, true),
            (WorkflowExecutionStatus::Running, false),
            (WorkflowExecutionStatus::Pending, false),
            (WorkflowExecutionStatus::Paused, false),
            (WorkflowExecutionStatus::Waiting, false),
        ] {
            let execution = sample_execution(status);
            let plan_json = sample_plan_json();
            let plan = sample_plan(execution.plan_id);
            let revision = sample_revision(plan.id, plan_json);
            let (session_agents, agents) = sample_agent_views();
            let projection = build_workflow_card_projection_lightweight(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
                &[sample_step(WorkflowStepStatus::Completed)],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                None,
                false,
                None,
            )
            .expect("build lightweight projection");
            assert_eq!(
                projection.is_terminal, expected_terminal,
                "is_terminal mismatch for status {:?}",
                execution.status
            );
        }
    }

    #[test]
    fn workflow_projection_separates_user_stop_marker_from_error() {
        let execution = sample_execution(WorkflowExecutionStatus::Failed);
        let plan = sample_plan(execution.plan_id);
        let revision = sample_revision(plan.id, sample_plan_json());
        let steps = vec![sample_step(WorkflowStepStatus::Completed)];
        let (session_agents, agents) = sample_agent_views();

        for (stopped_by_user, error_message) in [
            (false, Some("ordinary failure".to_string())),
            (true, None),
        ] {
            let full = build_workflow_card_projection(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
                &steps,
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                stopped_by_user,
                error_message.clone(),
            )
            .expect("build full projection");
            let lightweight = build_workflow_card_projection_lightweight(
                &execution,
                &plan,
                &revision,
                std::slice::from_ref(&revision),
                &steps,
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &[],
                &session_agents,
                &agents,
                Some(0),
                stopped_by_user,
                error_message.clone(),
            )
            .expect("build lightweight projection");

            for projection in [&full, &lightweight] {
                assert_eq!(projection.stopped_by_user, stopped_by_user);
                assert_eq!(projection.error_message, error_message);
                let json = serde_json::to_string(projection).expect("serialize projection");
                assert!(!json.contains("\"error_message\":\"stopped_by_user\""));
            }
        }
    }
}
