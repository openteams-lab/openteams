    #[test]
    fn worktree_workspace_request_uses_active_worktree_for_base_request() {
        let mut session = test_session(Some("E:/workspace/base"));
        session.worktree_mode = ChatSessionWorktreeMode::Isolated;
        let worktree = test_worktree(
            session.id,
            SessionWorktreeStatus::Active,
            "E:/workspace/base",
            "E:/workspace/base/.openteams/worktrees/session",
        );

        let resolved = worktree_workspace_for_request(&session, &worktree, "E:/workspace/base");

        assert_eq!(
            resolved.as_deref(),
            Some("E:/workspace/base/.openteams/worktrees/session")
        );
    }

    #[test]
    fn worktree_workspace_request_returns_base_for_archived_worktree() {
        let mut session = test_session(Some("E:/workspace/base"));
        session.worktree_mode = ChatSessionWorktreeMode::Isolated;
        let worktree = test_worktree(
            session.id,
            SessionWorktreeStatus::Archived,
            "E:/workspace/base",
            "E:/workspace/base/.openteams/worktrees/session",
        );

        let resolved = worktree_workspace_for_request(
            &session,
            &worktree,
            "E:/workspace/base/.openteams/worktrees/session",
        );

        assert_eq!(resolved.as_deref(), Some("E:/workspace/base"));
    }

    fn test_run(
        session_id: Uuid,
        session_agent_id: Uuid,
        run_index: i64,
        run_dir: &Path,
        created_at: chrono::DateTime<Utc>,
    ) -> ChatRun {
        ChatRun {
            id: Uuid::new_v4(),
            session_id,
            session_agent_id,
            workspace_path: None,
            run_index,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: Some(run_dir.join("meta.json").to_string_lossy().to_string()),
            log_state: ChatRunLogState::Tail,
            artifact_state: ChatRunArtifactState::Full,
            log_truncated: false,
            log_capture_degraded: false,
            pruned_at: None,
            prune_reason: None,
            retention_summary_json: None,
            created_at,
        }
    }

    #[test]
    fn parse_run_diff_blocks_classifies_status_and_counts_changes() {
        let patch = "\
diff --git a/src/modified.rs b/src/modified.rs
index 1111111..2222222 100644
--- a/src/modified.rs
+++ b/src/modified.rs
@@ -1,3 +1,4 @@
 context
-old
+new
+added
 context
diff --git a/src/added.txt b/src/added.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/added.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/src/gone.rs b/src/gone.rs
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.rs
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
";

        let blocks = parse_run_diff_blocks(patch);
        assert_eq!(blocks.len(), 3);

        assert_eq!(blocks[0].path, "src/modified.rs");
        assert_eq!(blocks[0].status, DiffFileStatus::Modified);
        assert_eq!(blocks[0].additions, 2);
        assert_eq!(blocks[0].deletions, 1);

        assert_eq!(blocks[1].path, "src/added.txt");
        assert_eq!(blocks[1].status, DiffFileStatus::Added);
        assert_eq!(blocks[1].additions, 2);
        assert_eq!(blocks[1].deletions, 0);

        assert_eq!(blocks[2].path, "src/gone.rs");
        assert_eq!(blocks[2].status, DiffFileStatus::Deleted);
        assert_eq!(blocks[2].additions, 0);
        assert_eq!(blocks[2].deletions, 2);
    }

    #[test]
    fn count_diff_block_changes_ignores_file_headers() {
        let block = "\
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1,1 +1,1 @@
-a
+b
";
        let (additions, deletions) = count_diff_block_changes(block);
        assert_eq!(additions, 1);
        assert_eq!(deletions, 1);
    }

    #[test]
    fn normalize_diff_path_rejects_parent_dirs_and_runtime_artifacts() {
        let root = Path::new("/workspace");
        assert_eq!(
            normalize_diff_path("src/lib/foo.rs", root).as_deref(),
            Some("src/lib/foo.rs")
        );
        assert_eq!(normalize_diff_path("../escape.rs", root), None);
        assert_eq!(
            normalize_diff_path(".openteams/runs/x/secret.txt", root),
            None
        );
        assert_eq!(normalize_diff_path("", root), None);
    }

    #[test]
    fn collect_run_files_reads_artifact_scoped_patch_and_untracked_snapshot() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        let workspace = tempdir.path().join("workspace");
        let session_agent_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let prefix = format!("session_agent_{session_agent_id}_run_0002");
        fs::create_dir_all(run_dir.join(format!("{prefix}_untracked/src/new")))
            .expect("create untracked snapshot dir");
        fs::create_dir_all(&workspace).expect("create workspace");
        // Run-scoped patch covering a modified + added file.
        let patch = "\
diff --git a/src/modified.rs b/src/modified.rs
index 1111111..2222222 100644
--- a/src/modified.rs
+++ b/src/modified.rs
@@ -1,2 +1,2 @@
-keep
+changed
diff --git a/src/created.txt b/src/created.txt
new file mode 100644
--- /dev/null
+++ b/src/created.txt
@@ -0,0 +1,3 @@
+a
+b
+c
";
        fs::write(run_dir.join(format!("{prefix}_diff.patch")), patch).expect("write patch");

        // Untracked snapshot for a brand-new file not present in the patch.
        fs::create_dir_all(workspace.join("src/new")).expect("create workspace untracked dir");
        fs::write(
            workspace.join("src/new/file.ts"),
            "export const x = 1;\nexport const y = 2;\n",
        )
        .expect("write workspace untracked file");
        fs::write(
            run_dir
                .join(format!("{prefix}_untracked"))
                .join("src/new/file.ts"),
            "export const x = 1;\nexport const y = 2;\n",
        )
        .expect("write untracked snapshot");

        // meta.json marks all visible files as artifacts. Diff-only paths are
        // suppressed by collect_run_files.
        fs::write(
            run_dir.join("meta.json"),
            "{\"workspace_observed_paths\":[{\"path\":\"src/modified.rs\",\"source\":\"git_diff,artifact_record\",\"existed_after_run\":true},{\"path\":\"src/created.txt\",\"source\":\"git_diff,artifact_record\",\"existed_after_run\":true},{\"path\":\"src/new/file.ts\",\"source\":\"git_untracked,artifact_record\",\"existed_after_run\":true}]}",
        )
        .expect("write meta");

        let run = ChatRun {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            session_agent_id,
            workspace_path: Some(workspace.to_string_lossy().to_string()),
            run_index: 2,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: Some(run_dir.join("meta.json").to_string_lossy().to_string()),
            log_state: ChatRunLogState::Tail,
            artifact_state: ChatRunArtifactState::Full,
            log_truncated: false,
            log_capture_degraded: false,
            pruned_at: None,
            prune_reason: None,
            retention_summary_json: None,
            created_at: Utc::now(),
        };

        let changes = collect_run_files(&run, false);

        let modified_paths: Vec<_> = changes.modified.iter().map(|f| f.path.as_str()).collect();
        let added_paths: Vec<_> = changes.added.iter().map(|f| f.path.as_str()).collect();
        let untracked_paths: Vec<_> = changes.untracked.iter().map(|f| f.path.as_str()).collect();

        assert_eq!(modified_paths, vec!["src/modified.rs"]);
        assert_eq!(changes.modified[0].additions, 1);
        assert_eq!(changes.modified[0].deletions, 1);
        assert_eq!(added_paths, vec!["src/created.txt"]);
        assert_eq!(changes.added[0].additions, 3);
        assert_eq!(untracked_paths, vec!["src/new/file.ts"]);
        assert_eq!(changes.untracked[0].additions, 2);
        assert!(changes.untracked[0].has_diff);
    }

    #[test]
    fn collect_run_files_suppresses_diff_paths_without_artifacts() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        let workspace = tempdir.path().join("workspace");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/src/polluted.rs b/src/polluted.rs\n--- a/src/polluted.rs\n+++ b/src/polluted.rs\n@@ -1 +1 @@\n-old\n+new\n",
        )
        .expect("write diff");
        fs::write(
            run_dir.join("meta.json"),
            "{\"workspace_observed_paths\":[{\"path\":\"src/polluted.rs\",\"source\":\"git_diff\",\"existed_after_run\":true}]}",
        )
        .expect("write meta");

        let mut run = test_run(Uuid::new_v4(), Uuid::new_v4(), 1, &run_dir, Utc::now());
        run.workspace_path = Some(workspace.to_string_lossy().to_string());

        let changes = collect_run_files(&run, true);

        assert!(changes.modified.is_empty());
        assert!(changes.added.is_empty());
        assert!(changes.deleted.is_empty());
        assert!(changes.untracked.is_empty());
    }

    #[test]
    fn collect_run_files_reads_artifact_work_records_after_meta_capture() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[]}"#,
        )
        .expect("write meta");

        let session_id = Uuid::new_v4();
        let other_session_id = Uuid::new_v4();
        let workspace = tempdir.path().join("workspace");
        fs::create_dir_all(workspace.join(".openteams/context/demo"))
            .expect("create openteams artifact dir");
        fs::create_dir_all(workspace.join("docs")).expect("create docs dir");
        fs::write(
            workspace.join(".openteams/context/demo/report.md"),
            "artifact report\n",
        )
        .expect("write openteams artifact");
        fs::write(workspace.join("docs/report.md"), "docs report\n").expect("write docs artifact");
        let mut run = test_run(session_id, Uuid::new_v4(), 1, &run_dir, Utc::now());
        run.workspace_path = Some(workspace.to_string_lossy().to_string());
        let protocol_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("protocol");
        fs::create_dir_all(&protocol_dir).expect("create protocol dir");
        fs::write(
            protocol_dir.join("work_records.jsonl"),
            format!(
                concat!(
                    "{{\"session_id\":\"{other_session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `docs/other-session.md`.\"}}\n",
                    "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `.openteams/context/demo/report.md` and `docs/report.md`.\"}}\n"
                ),
                other_session_id = other_session_id,
                session_id = session_id,
                run_id = run.id
            ),
        )
        .expect("write work records");

        let changes = collect_run_files(&run, false);

        let session_asset_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"));
        let _ = fs::remove_dir_all(session_asset_dir);

        let untracked_paths: Vec<_> = changes.untracked.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            untracked_paths,
            vec![".openteams/context/demo/report.md", "docs/report.md"]
        );
        assert!(changes.untracked.iter().all(|entry| !entry.has_diff));
        assert!(changes.untracked.iter().all(|entry| entry.additions == 0));
    }

    #[test]
    fn collect_run_files_filters_missing_artifacts_and_dedupes_diff_paths() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        let workspace = tempdir.path().join("workspace");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::create_dir_all(workspace.join("docs")).expect("create docs dir");
        fs::write(workspace.join("docs/report.md"), "updated report\n").expect("write report");
        fs::write(workspace.join("docs/other.md"), "other\n").expect("write other");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/docs/report.md b/docs/report.md\n--- a/docs/report.md\n+++ b/docs/report.md\n@@ -1 +1 @@\n-old\n+updated report\ndiff --git a/docs/other.md b/docs/other.md\n--- a/docs/other.md\n+++ b/docs/other.md\n@@ -1 +1 @@\n-old\n+other\n",
        )
        .expect("write diff");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[]}"#,
        )
        .expect("write meta");

        let session_id = Uuid::new_v4();
        let mut run = test_run(session_id, Uuid::new_v4(), 1, &run_dir, Utc::now());
        run.workspace_path = Some(workspace.to_string_lossy().to_string());
        let protocol_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("protocol");
        fs::create_dir_all(&protocol_dir).expect("create protocol dir");
        fs::write(
            protocol_dir.join("work_records.jsonl"),
            format!(
                "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"[\\\"docs/report.md\\\",\\\"docs/missing.md\\\"]\"}}\n",
                run_id = run.id
            ),
        )
        .expect("write work records");

        let changes = collect_run_files(&run, true);

        let session_asset_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"));
        let _ = fs::remove_dir_all(session_asset_dir);

        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].path, "docs/report.md");
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.path != "docs/other.md")
        );
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.path != "docs/missing.md")
        );
        assert!(changes.untracked.is_empty());
    }

    #[test]
    fn collect_run_files_keeps_deleted_artifact_when_it_is_in_scoped_diff() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        let workspace = tempdir.path().join("workspace");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/docs/deleted.md b/docs/deleted.md\ndeleted file mode 100644\n--- a/docs/deleted.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
        )
        .expect("write diff");

        let session_id = Uuid::new_v4();
        let mut run = test_run(session_id, Uuid::new_v4(), 1, &run_dir, Utc::now());
        run.workspace_path = Some(workspace.to_string_lossy().to_string());
        let protocol_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("protocol");
        fs::create_dir_all(&protocol_dir).expect("create protocol dir");
        fs::write(
            protocol_dir.join("work_records.jsonl"),
            format!(
                "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"[\\\"docs/deleted.md\\\"]\"}}\n",
                run_id = run.id
            ),
        )
        .expect("write work records");

        let changes = collect_run_files(&run, true);

        let session_asset_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"));
        let _ = fs::remove_dir_all(session_asset_dir);

        assert_eq!(changes.deleted.len(), 1);
        assert_eq!(changes.deleted[0].path, "docs/deleted.md");
        assert_eq!(changes.deleted[0].deletions, 1);
        assert!(changes.deleted[0].has_diff);
        assert!(
            changes.deleted[0]
                .unified_diff
                .as_deref()
                .unwrap_or_default()
                .contains("deleted file mode")
        );
        assert!(changes.modified.is_empty());
        assert!(changes.added.is_empty());
        assert!(changes.untracked.is_empty());
    }

    #[test]
    fn collect_run_files_returns_empty_when_no_patch() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        let run = ChatRun {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            workspace_path: None,
            run_index: 1,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: None,
            log_state: ChatRunLogState::Tail,
            artifact_state: ChatRunArtifactState::Full,
            log_truncated: false,
            log_capture_degraded: false,
            pruned_at: None,
            prune_reason: None,
            retention_summary_json: None,
            created_at: Utc::now(),
        };

        let changes = collect_run_files(&run, true);
        assert!(changes.modified.is_empty());
        assert!(changes.added.is_empty());
        assert!(changes.deleted.is_empty());
        assert!(changes.untracked.is_empty());
    }

    #[test]
    fn build_session_workspaces_deduplicates_paths_and_detects_git_repos() {
        let git_dir = tempfile::tempdir().expect("create git dir");
        git2::Repository::init(git_dir.path()).expect("init git repo");

        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let git_path = git_dir.path().to_string_lossy().to_string();
        let plain_path = plain_dir.path().to_string_lossy().to_string();
        let agent_a = Uuid::new_v4();
        let agent_b = Uuid::new_v4();
        let agent_c = Uuid::new_v4();

        let workspaces = build_session_workspaces(vec![
            SessionWorkspaceRow {
                workspace_path: plain_path.clone(),
                agent_id: agent_c,
                agent_name: "agent-c".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_b,
                agent_name: "agent-b".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_a,
                agent_name: "agent-a".to_string(),
            },
            SessionWorkspaceRow {
                workspace_path: git_path.clone(),
                agent_id: agent_a,
                agent_name: "agent-a".to_string(),
            },
        ]);

        assert_eq!(workspaces.len(), 2);

        let git_workspace = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == git_path)
            .expect("git workspace present");
        assert_eq!(git_workspace.agent_ids, vec![agent_b, agent_a]);
        assert_eq!(git_workspace.agent_names, vec!["agent-b", "agent-a"]);
        assert!(git_workspace.is_git_repo);

        let plain_workspace = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == plain_path)
            .expect("plain workspace present");
        assert_eq!(plain_workspace.agent_ids, vec![agent_c]);
        assert_eq!(plain_workspace.agent_names, vec!["agent-c"]);
        assert!(!plain_workspace.is_git_repo);
    }

    #[tokio::test]
    async fn list_session_workspace_rows_includes_current_and_historical_workspaces() {
        let (pool, session_id, agent_id) = setup_workspace_history_pool().await;

        let rows = list_session_workspace_rows(&pool, session_id)
            .await
            .expect("list session workspace rows");
        let workspaces = build_session_workspaces(rows);

        assert_eq!(workspaces.len(), 2);
        let current = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == "/workspace/current")
            .expect("current workspace present");
        assert_eq!(current.agent_ids, vec![agent_id]);
        let historical = workspaces
            .iter()
            .find(|workspace| workspace.workspace_path == "/workspace/old")
            .expect("historical workspace present");
        assert_eq!(historical.agent_ids, vec![agent_id]);
    }

    #[tokio::test]
    async fn session_has_workspace_path_accepts_historical_run_workspace() {
        let (pool, session_id, _) = setup_workspace_history_pool().await;

        assert!(
            session_has_workspace_path(&pool, session_id, "/workspace/current")
                .await
                .expect("check current workspace")
        );
        assert!(
            session_has_workspace_path(&pool, session_id, "/workspace/old")
                .await
                .expect("check historical workspace")
        );
        assert!(
            !session_has_workspace_path(&pool, session_id, "/workspace/missing")
                .await
                .expect("check missing workspace")
        );
    }

