    #[test]
    fn build_workspace_changes_keeps_untracked_diff_payloads() {
        let changes = build_workspace_changes(
            vec![
                Diff {
                    change: DiffChangeKind::Modified,
                    old_path: Some("src/main.ts".to_string()),
                    new_path: Some("src/main.ts".to_string()),
                    old_content: Some("old\n".to_string()),
                    new_content: Some("new\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(1),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Added,
                    old_path: None,
                    new_path: Some("src/staged.ts".to_string()),
                    old_content: None,
                    new_content: Some("added\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(0),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Added,
                    old_path: None,
                    new_path: Some("tmp/debug.log".to_string()),
                    old_content: None,
                    new_content: Some("debug\n".to_string()),
                    content_omitted: false,
                    additions: Some(1),
                    deletions: Some(0),
                    repo_id: None,
                },
                Diff {
                    change: DiffChangeKind::Deleted,
                    old_path: Some("src/old.ts".to_string()),
                    new_path: None,
                    old_content: Some("gone\n".to_string()),
                    new_content: None,
                    content_omitted: false,
                    additions: Some(0),
                    deletions: Some(1),
                    repo_id: None,
                },
            ],
            &HashSet::from(["tmp/debug.log".to_string()]),
            true,
        );

        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].path, "src/main.ts");
        assert!(changes.modified[0].unified_diff.is_some());
        assert_eq!(changes.added.len(), 1);
        assert_eq!(changes.added[0].path, "src/staged.ts");
        assert!(changes.added[0].unified_diff.is_some());
        assert_eq!(changes.deleted.len(), 1);
        assert_eq!(changes.deleted[0].path, "src/old.ts");
        assert_eq!(changes.deleted[0].deletions, 1);
        assert!(changes.deleted[0].has_diff);
        assert!(changes.deleted[0].unified_diff.is_some());
        assert_eq!(changes.untracked.len(), 1);
        assert_eq!(changes.untracked[0].path, "tmp/debug.log");
        assert_eq!(changes.untracked[0].additions, 1);
        assert_eq!(changes.untracked[0].deletions, 0);
        assert!(changes.untracked[0].has_diff);
        assert!(
            changes.untracked[0]
                .unified_diff
                .as_deref()
                .unwrap_or_default()
                .contains("+debug")
        );
    }

    #[test]
    fn build_workspace_changes_omits_diff_when_disabled() {
        let changes = build_workspace_changes(
            vec![Diff {
                change: DiffChangeKind::Modified,
                old_path: Some("src/main.ts".to_string()),
                new_path: Some("src/main.ts".to_string()),
                old_content: Some("old\n".to_string()),
                new_content: Some("new\n".to_string()),
                content_omitted: false,
                additions: Some(1),
                deletions: Some(1),
                repo_id: None,
            }],
            &HashSet::new(),
            false,
        );

        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].unified_diff, None);
    }

    #[test]
    fn collect_workspace_changes_returns_session_scoped_git_and_untracked_sections() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
        fs::write(repo_path.join("outside.txt"), "outside\n").expect("write unrelated change");
        fs::write(repo_path.join("untracked.txt"), "untracked\n").expect("write untracked");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(run_dir.join("untracked")).expect("create untracked dir");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n",
        )
        .expect("write diff patch");
        fs::write(
            run_dir.join("untracked").join("untracked.txt"),
            "snapshot\n",
        )
        .expect("write untracked snapshot");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"tracked.txt","source":"artifact_record","existed_after_run":true},{"path":"untracked.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(session_id, session_agent_id, 1, &run_dir, Utc::now());

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), true, vec![run]);

        assert!(response.is_git_repo);
        assert!(response.error.is_none());
        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .any(|entry| entry.path == "tracked.txt")
        );
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.path != "outside.txt")
        );
        assert_eq!(changes.untracked.len(), 1);
        assert_eq!(changes.untracked[0].path, "untracked.txt");
        assert_eq!(changes.untracked[0].additions, 1);
        assert!(changes.untracked[0].has_diff);
        assert!(
            changes.untracked[0]
                .unified_diff
                .as_deref()
                .unwrap_or_default()
                .contains("+untracked")
        );
    }

    #[test]
    fn collect_workspace_changes_handles_large_session_path_union() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        fs::write(repo_path.join("outside.txt"), "base\n").expect("write outside");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
        fs::write(repo_path.join("outside.txt"), "outside\n").expect("modify outside");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        let mut patch = String::new();
        patch.push_str(
            "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n",
        );
        for i in 0..5_000 {
            patch.push_str(&format!(
                "diff --git a/very/long/nonmatching/path/{i:04}/placeholder.txt b/very/long/nonmatching/path/{i:04}/placeholder.txt\n",
            ));
        }
        fs::write(run_dir.join("diff.patch"), patch).expect("write diff patch");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"tracked.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(session_id, session_agent_id, 1, &run_dir, Utc::now());

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), false, vec![run]);

        assert!(response.error.is_none(), "{:?}", response.error);
        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .any(|entry| entry.path == "tracked.txt")
        );
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.path != "outside.txt")
        );
    }

    #[test]
    fn collect_workspace_changes_can_skip_diff_payload_for_session_scoped_git() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");
        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("diff.patch"),
            "diff --git a/tracked.txt b/tracked.txt\n--- a/tracked.txt\n+++ b/tracked.txt\n",
        )
        .expect("write diff patch");
        let run = test_run(session_id, session_agent_id, 1, &run_dir, Utc::now());

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), false, vec![run]);

        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .all(|entry| entry.unified_diff.is_none())
        );
    }

    #[test]
    fn collect_workspace_changes_keeps_plain_artifact_manifest_entries() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let workspace_path = tempdir.path();
        fs::write(workspace_path.join("plain.txt"), "plain\n").expect("write plain file");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"plain.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response = collect_workspace_changes(
            session_id,
            &workspace_path.to_string_lossy(),
            true,
            vec![run],
        );

        assert!(!response.is_git_repo);
        let changes = response.changes.expect("plain changes present");
        assert_eq!(changes.modified.len(), 1);
        assert_eq!(changes.modified[0].path, "plain.txt");
        assert!(changes.added.is_empty());
        assert!(changes.deleted.is_empty());
        assert!(changes.untracked.is_empty());
        assert!(response.error.is_none());
    }

    #[test]
    fn collect_workspace_changes_keeps_git_source_with_artifact_record_combo() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");
        fs::write(
            repo_path.join("tracked.txt"),
            "combined git and artifact source\n",
        )
        .expect("modify tracked");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"tracked.txt","source":"git_diff,artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), true, vec![run]);

        assert!(response.is_git_repo);
        assert!(response.error.is_none());
        let changes = response.changes.expect("changes present");
        assert!(
            changes
                .modified
                .iter()
                .any(|entry| entry.path == "tracked.txt"),
            "real Git diff must still surface when combined with artifact_record: {:?}",
            changes.modified
        );
    }

    #[test]
    fn collect_workspace_changes_excludes_other_session_artifact_paths() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("session_a.txt"), "base a\n").expect("write a");
        fs::write(repo_path.join("session_b.txt"), "base b\n").expect("write b");
        git.commit(&repo_path, "baseline").expect("commit baseline");
        fs::write(repo_path.join("session_a.txt"), "changed a\n").expect("modify a");
        fs::write(repo_path.join("session_b.txt"), "changed b\n").expect("modify b");

        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();
        let run_dir_a = tempdir.path().join("run-a");
        let run_dir_b = tempdir.path().join("run-b");
        fs::create_dir_all(&run_dir_a).expect("create run a");
        fs::create_dir_all(&run_dir_b).expect("create run b");
        fs::write(
            run_dir_a.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"session_a.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta a");
        fs::write(
            run_dir_b.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"session_b.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta b");

        let run_a = test_run(session_a, Uuid::new_v4(), 1, &run_dir_a, Utc::now());
        let run_b = test_run(session_b, Uuid::new_v4(), 1, &run_dir_b, Utc::now());

        let changes_a =
            collect_workspace_changes(session_a, &repo_path.to_string_lossy(), true, vec![run_a])
                .changes
                .expect("changes a");
        let changes_b =
            collect_workspace_changes(session_b, &repo_path.to_string_lossy(), true, vec![run_b])
                .changes
                .expect("changes b");

        let paths_a = changes_a
            .modified
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        let paths_b = changes_b
            .modified
            .iter()
            .map(|entry| entry.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(paths_a, vec!["session_a.txt"]);
        assert_eq!(paths_b, vec!["session_b.txt"]);
    }

    #[test]
    fn collect_workspace_changes_ignores_output_text_manifest_entries() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let workspace_path = tempdir.path();
        fs::write(workspace_path.join("plain.txt"), "plain\n").expect("write plain file");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"plain.txt","source":"output_text","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response = collect_workspace_changes(
            session_id,
            &workspace_path.to_string_lossy(),
            true,
            vec![run],
        );

        assert!(!response.is_git_repo);
        let changes = response.changes.expect("plain changes present");
        assert!(changes.modified.is_empty());
        assert!(changes.added.is_empty());
        assert!(changes.deleted.is_empty());
        assert!(changes.untracked.is_empty());
        assert!(response.error.is_none());
    }

    #[test]
    fn collect_workspace_changes_keeps_deleted_plain_artifact_entries() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"deleted.txt","source":"artifact_record","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let response = collect_workspace_changes(
            session_id,
            &tempdir.path().to_string_lossy(),
            true,
            vec![run],
        );

        assert!(!response.is_git_repo);
        let changes = response.changes.expect("plain changes present");
        assert_eq!(changes.deleted.len(), 1);
        assert_eq!(changes.deleted[0].path, "deleted.txt");
        assert!(changes.modified.is_empty());
        assert!(changes.added.is_empty());
        assert!(changes.untracked.is_empty());
    }

    #[test]
    fn normalize_workspace_relative_path_allows_user_openteams_files_but_filters_runtime_artifacts()
    {
        let tempdir = tempfile::tempdir().expect("create tempdir");

        assert_eq!(
            normalize_workspace_relative_path(".openteams/test.txt", tempdir.path()),
            Some(".openteams/test.txt".to_string())
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/messages.jsonl",
                tempdir.path()
            ),
            None
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/independent-mode-discussion-proposal.md",
                tempdir.path()
            ),
            Some(".openteams/context/demo/independent-mode-discussion-proposal.md".to_string())
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/context/demo/attachments/message-1/input.txt",
                tempdir.path()
            ),
            None
        );
        assert_eq!(
            normalize_workspace_relative_path(
                ".openteams/runs/demo/run_records/output.txt",
                tempdir.path()
            ),
            None
        );
    }

    #[test]
    fn collect_workspace_changes_keeps_work_records_artifacts_in_current_diff() {
        let tempdir = tempfile::tempdir().expect("create tempdir");
        let repo_path = tempdir.path().join("repo");
        let git = GitService::new();
        git.initialize_repo_with_main_branch(&repo_path)
            .expect("init repo");

        fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
        git.commit(&repo_path, "baseline").expect("commit baseline");

        fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
        fs::create_dir_all(repo_path.join("binaries")).expect("create binaries dir");
        fs::write(repo_path.join("binaries").join("test.txt"), "binary\n")
            .expect("write binaries file");
        fs::create_dir_all(repo_path.join(".openteams").join("context").join("demo"))
            .expect("create runtime dir");
        fs::write(repo_path.join(".openteams").join("test.txt"), "user\n")
            .expect("write user openteams file");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("messages.jsonl"),
            "runtime\n",
        )
        .expect("write runtime artifact");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("independent-mode-discussion-proposal.md"),
            "proposal\n",
        )
        .expect("write proposal artifact");
        fs::create_dir_all(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("attachments")
                .join("message-1"),
        )
        .expect("create attachment dir");
        fs::write(
            repo_path
                .join(".openteams")
                .join("context")
                .join("demo")
                .join("attachments")
                .join("message-1")
                .join("input.txt"),
            "attachment\n",
        )
        .expect("write attachment artifact");

        let session_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        let run_dir = tempdir.path().join("run-record");
        fs::create_dir_all(&run_dir).expect("create run dir");
        fs::write(
            run_dir.join("meta.json"),
            r#"{"workspace_observed_paths":[{"path":"tracked.txt","source":"git_diff","existed_after_run":true}]}"#,
        )
        .expect("write meta");
        let run = test_run(
            session_id,
            session_agent_id,
            1,
            &run_dir,
            Utc::now() - chrono::Duration::minutes(1),
        );

        let protocol_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("protocol");
        fs::create_dir_all(&protocol_dir).expect("create protocol dir");
        fs::write(
            protocol_dir.join("work_records.jsonl"),
            format!(
                concat!(
                    "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `binaries/test.txt`.\"}}\n",
                    "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved `.openteams/test.txt`, `.openteams/context/demo/messages.jsonl`, `.openteams/context/demo/attachments/message-1/input.txt`, and `.openteams/context/demo/independent-mode-discussion-proposal.md`.\"}}\n"
                ),
                session_id = session_id,
                run_id = run.id
            ),
        )
        .expect("write work records");

        let response =
            collect_workspace_changes(session_id, &repo_path.to_string_lossy(), true, vec![run]);

        let session_asset_dir = asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"));
        let _ = fs::remove_dir_all(session_asset_dir);

        assert!(response.is_git_repo);
        assert!(response.error.is_none());
        let changes = response.changes.expect("changes present");
        let all_paths = changes
            .modified
            .iter()
            .map(|entry| entry.path.as_str())
            .chain(changes.added.iter().map(|entry| entry.path.as_str()))
            .chain(changes.deleted.iter().map(|entry| entry.path.as_str()))
            .chain(changes.untracked.iter().map(|entry| entry.path.as_str()))
            .collect::<Vec<_>>();

        assert!(!all_paths.contains(&"tracked.txt"));
        assert!(
            all_paths.contains(&"binaries/test.txt"),
            "work_records artifact paths should own current file changes: {all_paths:?}"
        );
        assert!(!all_paths.contains(&".openteams/test.txt"));
        assert!(
            !all_paths.contains(&".openteams/context/demo/independent-mode-discussion-proposal.md")
        );
        assert!(!all_paths.contains(&".openteams/context/demo/messages.jsonl"));
        assert!(!all_paths.contains(&".openteams/context/demo/attachments/message-1/input.txt"));
    }

    #[tokio::test]
    async fn normalize_or_inherit_workspace_path_uses_session_default_when_missing() {
        let session = test_session(Some("/tmp/openteams-default"));

        let resolved = normalize_or_inherit_workspace_path(&session, None)
            .await
            .expect("resolve workspace path");

        assert_eq!(resolved.as_deref(), Some("/tmp/openteams-default"));
    }

    #[tokio::test]
    async fn normalize_or_inherit_workspace_path_prefers_explicit_request_value() {
        let session = test_session(Some("/tmp/openteams-default"));
        let tempdir = tempfile::tempdir().expect("create temp directory");
        let explicit_path = tempdir.path().to_string_lossy().to_string();

        let resolved = normalize_or_inherit_workspace_path(&session, Some(explicit_path.clone()))
            .await
            .expect("resolve explicit workspace path");

        assert_eq!(resolved.as_deref(), Some(explicit_path.as_str()));
    }
