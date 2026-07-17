    #[tokio::test]
    async fn validate_workspace_path_reports_git_repository_state() {
        let git_dir = tempfile::tempdir().expect("create git dir");
        git2::Repository::init(git_dir.path()).expect("init git repo");
        let ResponseJson(response) =
            validate_workspace_path_endpoint(Json(ValidateWorkspacePathRequest {
                workspace_path: git_dir.path().to_string_lossy().to_string(),
            }))
            .await
            .expect("validate git workspace");
        let data = response.into_data().expect("git validation data");
        assert!(data.valid);
        assert!(data.is_git_repo);
        assert!(data.error.is_none());
        assert!(data.error_code.is_none());

        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let ResponseJson(response) =
            validate_workspace_path_endpoint(Json(ValidateWorkspacePathRequest {
                workspace_path: plain_dir.path().to_string_lossy().to_string(),
            }))
            .await
            .expect("validate plain workspace");
        let data = response.into_data().expect("plain validation data");
        assert!(data.valid);
        assert!(!data.is_git_repo);
        assert!(data.error.is_none());
        assert!(data.error_code.is_none());
    }

    #[tokio::test]
    async fn validate_workspace_path_reports_stable_error_codes() {
        let required = validate_workspace_path_status("  ").await;
        assert_eq!(
            required.error_code,
            Some(WorkspaceGitErrorCode::WorkspacePathRequired)
        );

        let invalid = validate_workspace_path_status("relative/path").await;
        assert_eq!(
            invalid.error_code,
            Some(WorkspaceGitErrorCode::WorkspacePathInvalid)
        );

        let tempdir = tempfile::tempdir().expect("create tempdir");
        let missing =
            validate_workspace_path_status(&tempdir.path().join("missing").to_string_lossy()).await;
        assert_eq!(
            missing.error_code,
            Some(WorkspaceGitErrorCode::WorkspacePathNotFound)
        );

        let file_path = tempdir.path().join("file.txt");
        fs::write(&file_path, "content").expect("write file");
        let file = validate_workspace_path_status(&file_path.to_string_lossy()).await;
        assert_eq!(
            file.error_code,
            Some(WorkspaceGitErrorCode::WorkspacePathNotDirectory)
        );

        let inaccessible = workspace_path_metadata_error(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        ));
        assert_eq!(
            inaccessible.code,
            WorkspaceGitErrorCode::WorkspacePathNotAccessible
        );
    }

    #[tokio::test]
    async fn gitignore_template_catalog_lists_expected_templates() {
        let ResponseJson(response) = list_gitignore_templates_endpoint()
            .await
            .expect("list gitignore templates");
        let data = response.into_data().expect("template response data");
        let ids = data
            .templates
            .iter()
            .map(|template| template.id.as_str())
            .collect::<Vec<_>>();

        assert!(data.templates.len() > 100);
        assert!(ids.contains(&"node"));
        assert!(ids.contains(&"python"));
        assert!(ids.contains(&"go"));
        assert!(
            data.templates
                .iter()
                .all(|template| !template.label.is_empty()
                    && !template.group.is_empty()
                    && !template.description.is_empty())
        );
    }

    #[test]
    fn gitignore_template_catalog_reads_common_templates() {
        let node = gitignore_templates::read_template("node").expect("read node template");
        assert!(node.contains("node_modules/"));

        let python = gitignore_templates::read_template("python").expect("read python template");
        assert!(python.contains("__pycache__/"));

        let go = gitignore_templates::read_template("go").expect("read go template");
        assert!(go.contains("*.test"));
    }

    #[tokio::test]
    async fn initialize_workspace_git_creates_repo_and_gitignore_template() {
        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let (status, ResponseJson(response)) =
            initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                workspace_path: plain_dir.path().to_string_lossy().to_string(),
                gitignore_template: Some("Node".to_string()),
            }))
            .await
            .expect("initialize git workspace");
        assert_eq!(status, StatusCode::OK);
        let data = response.into_data().expect("git init response data");

        assert!(data.initialized);
        assert_eq!(data.gitignore_template.as_deref(), Some("node"));
        assert!(data.status.valid);
        assert!(data.status.is_git_repo);
        let repo = git2::Repository::open(plain_dir.path()).expect("open initialized repo");

        let gitignore = fs::read_to_string(plain_dir.path().join(".gitignore"))
            .expect("read generated .gitignore");
        assert!(gitignore.contains("node_modules/"));
        assert!(gitignore.contains(".openteams/"));

        let commit = repo
            .head()
            .expect("repo has head after gitignore commit")
            .peel_to_commit()
            .expect("head points to gitignore commit");
        assert_eq!(commit.message(), Some("Add .gitignore"));
        assert!(
            commit
                .tree()
                .expect("read commit tree")
                .get_path(Path::new(".gitignore"))
                .is_ok()
        );
        let committed_gitignore = commit
            .tree()
            .expect("read commit tree")
            .get_path(Path::new(".gitignore"))
            .expect("gitignore is committed")
            .to_object(&repo)
            .expect("read gitignore object")
            .peel_to_blob()
            .expect("gitignore is a blob");
        assert!(
            std::str::from_utf8(committed_gitignore.content())
                .expect("gitignore is utf-8")
                .contains(".openteams/")
        );
        assert!(
            repo.statuses(None)
                .expect("read repo status after gitignore commit")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn initialize_workspace_git_commits_only_generated_gitignore() {
        let plain_dir = tempfile::tempdir().expect("create plain dir");
        fs::write(
            plain_dir.path().join("app.js"),
            "console.log('left untracked');\n",
        )
        .expect("write existing project file");

        let (_, ResponseJson(response)) =
            initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                workspace_path: plain_dir.path().to_string_lossy().to_string(),
                gitignore_template: Some("Node".to_string()),
            }))
            .await
            .expect("initialize git workspace");
        response.into_data().expect("git init response data");

        let repo = git2::Repository::open(plain_dir.path()).expect("open initialized repo");
        let commit = repo
            .head()
            .expect("repo has head after gitignore commit")
            .peel_to_commit()
            .expect("head points to gitignore commit");
        let tree = commit.tree().expect("read commit tree");
        assert!(tree.get_path(Path::new(".gitignore")).is_ok());
        assert!(tree.get_path(Path::new("app.js")).is_err());
        assert!(
            repo.status_file(Path::new("app.js"))
                .expect("read app.js status")
                .contains(git2::Status::WT_NEW)
        );
    }

    #[tokio::test]
    async fn initialize_workspace_git_rejects_unknown_gitignore_template() {
        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let (status, ResponseJson(response)) =
            initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                workspace_path: plain_dir.path().to_string_lossy().to_string(),
                gitignore_template: Some("missing-template".to_string()),
            }))
            .await
            .expect("initialize git workspace");

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_error_code(response, WorkspaceGitErrorCode::InvalidGitignoreTemplate);
        assert!(!plain_dir.path().join(".git").exists());
    }

    #[tokio::test]
    async fn initialize_workspace_git_skips_template_for_none_null_or_empty() {
        for template in [None, Some(String::new()), Some("none".to_string())] {
            let plain_dir = tempfile::tempdir().expect("create plain dir");
            let (status, ResponseJson(response)) =
                initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                    workspace_path: plain_dir.path().to_string_lossy().to_string(),
                    gitignore_template: template,
                }))
                .await
                .expect("initialize git workspace");
            let data = response.into_data().expect("git init response data");

            assert_eq!(status, StatusCode::OK);
            assert!(data.initialized);
            assert!(data.gitignore_template.is_none());
            assert!(git2::Repository::open(plain_dir.path()).is_ok());
            assert!(!plain_dir.path().join(".gitignore").exists());
        }
    }

    #[tokio::test]
    async fn initialize_workspace_git_preserves_existing_gitignore() {
        let plain_dir = tempfile::tempdir().expect("create plain dir");
        let gitignore_path = plain_dir.path().join(".gitignore");
        fs::write(&gitignore_path, "custom\n").expect("write existing gitignore");

        let (status, ResponseJson(response)) =
            initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                workspace_path: plain_dir.path().to_string_lossy().to_string(),
                gitignore_template: Some("python".to_string()),
            }))
            .await
            .expect("initialize git workspace");
        let data = response.into_data().expect("git init response data");

        assert_eq!(status, StatusCode::OK);
        assert!(data.initialized);
        assert_eq!(data.gitignore_template.as_deref(), Some("python"));
        assert_eq!(
            fs::read_to_string(&gitignore_path).expect("read existing gitignore"),
            "custom\n"
        );
        assert!(
            git2::Repository::open(plain_dir.path())
                .expect("open initialized repo")
                .head()
                .is_err()
        );
    }

    #[tokio::test]
    async fn initialize_workspace_git_does_not_reinitialize_existing_repo() {
        let git_dir = tempfile::tempdir().expect("create git dir");
        git2::Repository::init(git_dir.path()).expect("init existing repo");

        let (status, ResponseJson(response)) =
            initialize_workspace_git_endpoint(Json(InitializeWorkspaceGitRequest {
                workspace_path: git_dir.path().to_string_lossy().to_string(),
                gitignore_template: Some("go".to_string()),
            }))
            .await
            .expect("initialize git workspace");
        let data = response.into_data().expect("git init response data");

        assert_eq!(status, StatusCode::OK);
        assert!(!data.initialized);
        assert_eq!(data.gitignore_template.as_deref(), Some("go"));
        assert!(data.status.is_git_repo);

        let gitignore = fs::read_to_string(git_dir.path().join(".gitignore"))
            .expect("read generated .gitignore");
        assert!(gitignore.contains("*.test"));
    }

    fn assert_error_code(
        response: InitializeWorkspaceGitApiResponse,
        expected: WorkspaceGitErrorCode,
    ) {
        assert!(!response.is_success());
        let value = serde_json::to_value(response).expect("serialize API response");
        let actual: WorkspaceGitErrorCode =
            serde_json::from_value(value["error_data"]["code"].clone())
                .expect("deserialize error code");
        assert_eq!(actual, expected);
    }

    async fn setup_workspace_history_pool() -> (SqlitePool, Uuid, Uuid) {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        sqlx::query(
            r#"CREATE TABLE chat_agents (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_agents");
        sqlx::query(
            r#"CREATE TABLE chat_session_agents (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                agent_id BLOB NOT NULL,
                workspace_path TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_session_agents");
        sqlx::query(
            r#"CREATE TABLE chat_runs (
                id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL,
                session_agent_id BLOB NOT NULL,
                workspace_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_runs");

        let session_id = Uuid::new_v4();
        let agent_id = Uuid::new_v4();
        let session_agent_id = Uuid::new_v4();
        sqlx::query("INSERT INTO chat_agents (id, name) VALUES (?1, ?2)")
            .bind(agent_id)
            .bind("historian")
            .execute(&pool)
            .await
            .expect("insert chat_agent");
        sqlx::query(
            "INSERT INTO chat_session_agents (id, session_id, agent_id, workspace_path) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(session_agent_id)
        .bind(session_id)
        .bind(agent_id)
        .bind("/workspace/current")
        .execute(&pool)
        .await
        .expect("insert session agent");
        sqlx::query(
            "INSERT INTO chat_runs (id, session_id, session_agent_id, workspace_path) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(Uuid::new_v4())
        .bind(session_id)
        .bind(session_agent_id)
        .bind("/workspace/old")
        .execute(&pool)
        .await
        .expect("insert chat run");

        (pool, session_id, agent_id)
    }

    fn test_session(default_workspace_path: Option<&str>) -> ChatSession {
        ChatSession {
            id: Uuid::new_v4(),
            title: Some("Test Session".to_string()),
            status: ChatSessionStatus::Active,
            lead_agent_id: None,
            lead_session_agent_id: None,
            summary_text: None,
            archive_ref: None,
            last_seen_diff_key: None,
            default_workspace_path: default_workspace_path.map(str::to_string),
            chat_input_mode: None,
            project_id: None,
            pinned_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            archived_at: None,
            worktree_mode: Default::default(),
        }
    }

    fn test_worktree(
        session_id: Uuid,
        status: SessionWorktreeStatus,
        base_workspace: &str,
        worktree_workspace: &str,
    ) -> SessionWorktree {
        let now = Utc::now();
        SessionWorktree {
            id: Uuid::new_v4(),
            session_id,
            project_id: None,
            base_workspace_path: base_workspace.to_string(),
            repo_path: base_workspace.to_string(),
            base_branch: "main".to_string(),
            base_commit: None,
            branch_name: "openteams/session/test".to_string(),
            worktree_path: worktree_workspace.to_string(),
            mode: SessionWorktreeMode::Session,
            status,
            has_unmerged_commits: false,
            merge_target_branch: None,
            merge_operation: None,
            conflict_files_json: "[]".to_string(),
            operation_started_at: None,
            cleanup_error: None,
            last_used_at: None,
            merged_at: None,
            archived_at: None,
            created_at: now,
            updated_at: now,
        }
    }

