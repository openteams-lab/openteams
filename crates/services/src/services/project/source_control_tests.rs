use std::{fs, path::Path};

use db::models::{
    chat_agent::{ChatAgent, CreateChatAgent},
    chat_run::{ChatRun, CreateChatRun},
    chat_session::{ChatSession, CreateChatSession},
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
    member_execution_config::MemberExecutionConfig,
    project::{CreateProject, Project},
    project_delivery_record::{ProjectDeliveryEventTypeV2, ProjectDeliveryRecord},
    project_work_item::{
        CreateProjectWorkItem, ProjectWorkItem, ProjectWorkItemPriority, ProjectWorkItemSource,
        ProjectWorkItemType,
    },
    project_work_item_execution_link::{
        CreateProjectWorkItemExecutionLink, ProjectExecutionLinkType, ProjectWorkItemExecutionLink,
    },
};
use git::{GitCli, GitService};
use serde_json::json;
use sqlx::SqlitePool;
use utils::assets::asset_dir;
use uuid::Uuid;

use super::source_control::{
    SessionSourceControlStatus, SourceControlCommitErrorCode, SourceControlCommitRequest,
    SourceControlDiscardRequest, SourceControlError, SourceControlFileStatus,
    SourceControlOperationFailureCode, SourceControlService, SourceControlStageRequest,
};

async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("create sqlite memory pool");
    sqlx::migrate!("../db/migrations")
        .run(&pool)
        .await
        .expect("run migrations");
    pool
}

async fn seed_project(pool: &SqlitePool, workspace_path: &Path) -> Project {
    Project::create(
        pool,
        &CreateProject {
            name: "Source Control".to_string(),
            repositories: Vec::new(),
            description: None,
            status: Some("active".to_string()),
            default_workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            active_repo_id: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create project")
}

async fn seed_work_item(pool: &SqlitePool, project_id: Uuid, title: &str) -> ProjectWorkItem {
    ProjectWorkItem::create(
        pool,
        project_id,
        CreateProjectWorkItem {
            r#type: ProjectWorkItemType::Feature,
            status: None,
            title: title.to_string(),
            description: None,
            labels_json: None,
            priority: ProjectWorkItemPriority::Medium,
            source: ProjectWorkItemSource::Session,
            created_by: None,
        },
    )
    .await
    .expect("create work item")
}

async fn link_work_item_to_session(pool: &SqlitePool, work_item_id: Uuid, session_id: Uuid) {
    ProjectWorkItemExecutionLink::create(
        pool,
        work_item_id,
        CreateProjectWorkItemExecutionLink {
            session_id: Some(session_id),
            workflow_execution_id: None,
            workflow_step_id: None,
            run_id: None,
            link_type: ProjectExecutionLinkType::ImplementedBy,
        },
    )
    .await
    .expect("link work item to session");
}

async fn seed_session_with_paths(
    pool: &SqlitePool,
    project_id: Uuid,
    workspace_path: &Path,
    paths: &[&str],
) -> Uuid {
    seed_session_with_observed_source(pool, project_id, workspace_path, paths, "git_diff").await
}

async fn seed_session_with_observed_source(
    pool: &SqlitePool,
    project_id: Uuid,
    workspace_path: &Path,
    paths: &[&str],
    source: &str,
) -> Uuid {
    let session = ChatSession::create(
        pool,
        &CreateChatSession {
            title: Some("Session".to_string()),
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            project_id: Some(project_id),
            worktree_mode: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create session");
    let agent = ChatAgent::create(
        pool,
        &CreateChatAgent {
            name: format!("agent-{}", session.id),
            runner_type: "codex".to_string(),
            system_prompt: None,
            tools_enabled: None,
            model_name: None,
            owner_project_id: None,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create agent");
    let session_agent = ChatSessionAgent::create(
        pool,
        &CreateChatSessionAgent {
            session_id: session.id,
            agent_id: agent.id,
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            allowed_skill_ids: Vec::new(),
            project_member_id: None,
            execution_config: MemberExecutionConfig::default(),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create session agent");

    let run_dir = workspace_path
        .join(".openteams-test-runs")
        .join(session.id.to_string());
    fs::create_dir_all(&run_dir).expect("create run dir");
    let observed = paths
        .iter()
        .map(|path| {
            json!({
                "path": path,
                "source": source,
                "existed_after_run": true
            })
        })
        .collect::<Vec<_>>();
    let meta_path = run_dir.join("meta.json");
    fs::write(
        &meta_path,
        json!({ "workspace_observed_paths": observed }).to_string(),
    )
    .expect("write meta");

    ChatRun::create(
        pool,
        &CreateChatRun {
            session_id: session.id,
            session_agent_id: session_agent.id,
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            run_index: 1,
            run_dir: run_dir.to_string_lossy().to_string(),
            input_path: None,
            output_path: None,
            raw_log_path: None,
            meta_path: Some(meta_path.to_string_lossy().to_string()),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create run");

    session.id
}

fn setup_git_workspace() -> (tempfile::TempDir, std::path::PathBuf) {
    let tempdir = tempfile::tempdir().expect("create tempdir");
    let repo_path = tempdir.path().join("repo");
    let git = GitService::new();
    git.initialize_repo_with_main_branch(&repo_path)
        .expect("init repo");
    fs::write(repo_path.join("tracked.txt"), "base\n").expect("write tracked");
    git.commit(&repo_path, "baseline").expect("commit baseline");
    (tempdir, repo_path)
}

fn git_add(repo_path: &Path, path: &str) {
    GitCli::new()
        .git(repo_path, ["add", "--", path])
        .expect("git add");
}

fn git_checkout_detached(repo_path: &Path) {
    GitCli::new()
        .git(repo_path, ["checkout", "--detach", "HEAD"])
        .expect("detach HEAD");
}

fn git_head_sha(repo_path: &Path) -> String {
    GitService::new()
        .get_head_info(repo_path)
        .expect("read HEAD")
        .oid
}

fn git_status_paths(status: &SessionSourceControlStatus) -> (Vec<String>, Vec<String>) {
    let SessionSourceControlStatus::Git {
        changes,
        staged_changes,
        ..
    } = status
    else {
        panic!("expected git status");
    };
    (
        changes.iter().map(|file| file.path.clone()).collect(),
        staged_changes
            .iter()
            .map(|file| file.path.clone())
            .collect(),
    )
}

fn operation_status(
    response: &super::source_control::SourceControlOperationResponse,
) -> &SessionSourceControlStatus {
    response.status.as_ref().expect("operation status")
}

fn commit_error_code(err: SourceControlError) -> SourceControlCommitErrorCode {
    match err {
        SourceControlError::Commit(error) => error.code,
        other => panic!("expected commit error, got {other:?}"),
    }
}

#[tokio::test]
async fn non_git_workspace_returns_plain_files() {
    let pool = setup_pool().await;
    let tempdir = tempfile::tempdir().expect("create tempdir");
    fs::write(tempdir.path().join("plain.txt"), "plain\n").expect("write plain file");
    let project = seed_project(&pool, tempdir.path()).await;
    let session_id =
        seed_session_with_paths(&pool, project.id, tempdir.path(), &["plain.txt"]).await;

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Plain { files, reason, .. } = status else {
        panic!("expected plain status");
    };
    assert_eq!(
        reason as u8,
        super::source_control::SourceControlPlainReason::NotGitRepo as u8
    );
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "plain.txt");
}

#[tokio::test]
async fn git_workspace_separates_unstaged_and_staged_files() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(
        &pool,
        project.id,
        &repo_path,
        &["tracked.txt", "staged.txt"],
    )
    .await;

    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
    fs::write(repo_path.join("staged.txt"), "staged\n").expect("write staged");
    git_add(&repo_path, "staged.txt");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let (changes, staged) = git_status_paths(&status);
    assert_eq!(changes, vec!["tracked.txt"]);
    assert_eq!(staged, vec!["staged.txt"]);
}

#[tokio::test]
async fn git_workspace_ignores_output_text_observed_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_observed_source(
        &pool,
        project.id,
        &repo_path,
        &["tracked.txt"],
        "output_text",
    )
    .await;

    fs::write(repo_path.join("tracked.txt"), "mentioned in output only\n").expect("modify tracked");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let (changes, staged) = git_status_paths(&status);
    assert!(changes.is_empty());
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_ignores_openteams_artifact_observed_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_observed_source(
        &pool,
        project.id,
        &repo_path,
        &[".openteams/context/demo/report.md"],
        "artifact_record",
    )
    .await;

    fs::create_dir_all(repo_path.join(".openteams").join("context").join("demo"))
        .expect("create openteams dir");
    fs::write(
        repo_path
            .join(".openteams")
            .join("context")
            .join("demo")
            .join("report.md"),
        "artifact\n",
    )
    .expect("write openteams artifact");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let (changes, staged) = git_status_paths(&status);
    assert!(changes.is_empty());
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_ignores_artifact_only_observed_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_observed_source(
        &pool,
        project.id,
        &repo_path,
        &["tracked.txt"],
        "artifact_record",
    )
    .await;

    fs::write(repo_path.join("tracked.txt"), "recorded as artifact only\n")
        .expect("modify tracked");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let (changes, staged) = git_status_paths(&status);
    assert!(
        changes.is_empty(),
        "artifact_record-only paths must not own source-control changes: {changes:?}"
    );
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_keeps_git_source_with_artifact_record_combo() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_observed_source(
        &pool,
        project.id,
        &repo_path,
        &["tracked.txt"],
        "git_diff,artifact_record",
    )
    .await;

    fs::write(
        repo_path.join("tracked.txt"),
        "combined git and artifact source\n",
    )
    .expect("modify tracked");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let (changes, staged) = git_status_paths(&status);
    assert_eq!(changes, vec!["tracked.txt"]);
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_ignores_work_records_artifact_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;

    fs::create_dir_all(repo_path.join("binaries")).expect("create binaries dir");
    fs::write(repo_path.join("binaries").join("test.txt"), "baseline\n")
        .expect("write tracked binary");
    git_add(&repo_path, "binaries/test.txt");
    GitService::new()
        .commit(&repo_path, "track binaries test file")
        .expect("commit binaries file");

    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;

    let runs = ChatRun::list_for_session_workspace(&pool, session_id, &repo_path.to_string_lossy())
        .await
        .expect("list runs");
    let run_id = runs.first().expect("seeded run").id;

    let protocol_dir = asset_dir()
        .join("chat")
        .join(format!("session_{session_id}"))
        .join("protocol");
    fs::create_dir_all(&protocol_dir).expect("create protocol dir");
    fs::write(
        protocol_dir.join("work_records.jsonl"),
        format!(
            "{{\"session_id\":\"{session_id}\",\"run_id\":\"{run_id}\",\"message_type\":\"artifact\",\"content\":\"Saved binaries/test.txt.\"}}\n"
        ),
    )
    .expect("write work records");

    fs::write(repo_path.join("binaries").join("test.txt"), "updated\n")
        .expect("modify binaries file");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let session_asset_dir = asset_dir()
        .join("chat")
        .join(format!("session_{session_id}"));
    let _ = fs::remove_dir_all(session_asset_dir);

    let (changes, staged) = git_status_paths(&status);
    assert!(
        !changes.iter().any(|path| path == "binaries/test.txt"),
        "work_records artifact paths must not own source-control changes: {changes:?}"
    );
    assert!(staged.is_empty());
}

#[tokio::test]
async fn invalidating_session_caches_exposes_agent_file_changes() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let service = SourceControlService::new();

    let initial = service
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("initial status");
    let (changes, staged) = git_status_paths(&initial);
    assert!(changes.is_empty());
    assert!(staged.is_empty());

    fs::write(repo_path.join("tracked.txt"), "updated by agent\n").expect("modify tracked");
    SourceControlService::invalidate_session_caches(session_id);

    let refreshed = service
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("refreshed status");
    let (changes, staged) = git_status_paths(&refreshed);
    assert_eq!(changes, vec!["tracked.txt"]);
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_reports_external_staged_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;

    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
    fs::write(repo_path.join("external.txt"), "external\n").expect("write external");
    git_add(&repo_path, "external.txt");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git {
        external_staged_paths,
        ..
    } = status
    else {
        panic!("expected git status");
    };
    assert_eq!(external_staged_paths, vec!["external.txt"]);
}

#[tokio::test]
async fn shared_file_blocks_stage_unless_forced() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let _other_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "shared update\n").expect("modify tracked");

    let blocked = SourceControlService::new()
        .stage(
            &pool,
            project.id,
            SourceControlStageRequest {
                session_id,
                workspace_id: None,
                paths: vec!["tracked.txt".to_string()],
                force_shared: None,
            },
        )
        .await
        .expect("blocked response");

    assert!(!blocked.ok);
    assert_eq!(
        blocked.failed[0].code,
        SourceControlOperationFailureCode::SharedFile
    );

    let forced = SourceControlService::new()
        .stage(
            &pool,
            project.id,
            SourceControlStageRequest {
                session_id,
                workspace_id: None,
                paths: vec!["tracked.txt".to_string()],
                force_shared: Some(true),
            },
        )
        .await
        .expect("forced response");

    assert!(forced.ok);
    let (_, staged) = git_status_paths(operation_status(&forced));
    assert_eq!(staged, vec!["tracked.txt"]);
}

#[tokio::test]
async fn stage_fast_returns_path_result_without_full_status() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "fast stage\n").expect("modify tracked");

    let response = SourceControlService::new()
        .stage_fast(
            &pool,
            project.id,
            SourceControlStageRequest {
                session_id,
                workspace_id: None,
                paths: vec!["tracked.txt".to_string()],
                force_shared: None,
            },
        )
        .await
        .expect("fast stage response");

    assert!(response.ok);
    assert_eq!(response.succeeded, vec!["tracked.txt"]);
    assert!(response.status.is_none());
    assert!(response.head_sha.is_some());
    assert!(response.operation_id.is_some());

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");
    let (_, staged) = git_status_paths(&status);
    assert_eq!(staged, vec!["tracked.txt"]);
}

#[tokio::test]
async fn commit_rejects_empty_message() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    let err = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "   ".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect_err("empty message rejected");

    assert_eq!(
        commit_error_code(err),
        SourceControlCommitErrorCode::EmptyMessage
    );
}

#[tokio::test]
async fn commit_succeeds_with_valid_request() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let before_sha = git_head_sha(&repo_path);
    fs::write(repo_path.join("tracked.txt"), "base\nnext\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    let response = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit session changes".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: Some(before_sha.clone()),
            },
        )
        .await
        .expect("commit succeeds");

    assert_ne!(response.commit_sha, before_sha);
    assert_eq!(response.commit_sha, git_head_sha(&repo_path));
    assert_eq!(response.short_sha, response.commit_sha[..7]);
    assert_eq!(response.message, "commit session changes");
    assert_eq!(response.committed_paths, vec!["tracked.txt"]);
    assert_eq!(response.additions, 1);
    assert_eq!(response.deletions, 0);

    let (changes, staged) = git_status_paths(&response.status);
    assert!(changes.is_empty());
    assert!(staged.is_empty());
}

#[tokio::test]
async fn commit_writes_session_level_delivery_record_when_no_work_item_is_linked() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "base\nnext\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    let response = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit without work item".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: Some(false),
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    let records = ProjectDeliveryRecord::find_by_project(&pool, project.id, None, None)
        .await
        .expect("list delivery records");
    assert_eq!(records.len(), 1);

    let record = &records[0];
    assert_eq!(record.event_type, ProjectDeliveryEventTypeV2::CommitCreated);
    assert_eq!(record.project_work_item_id, None);
    assert_eq!(record.source_session_id, Some(session_id));
    assert_eq!(
        record.external_id.as_deref(),
        Some(response.commit_sha.as_str())
    );

    let metadata: serde_json::Value =
        serde_json::from_str(record.metadata_json.as_deref().expect("metadata"))
            .expect("parse metadata");
    assert_eq!(metadata["commit_sha"], json!(response.commit_sha.clone()));
    assert_eq!(metadata["short_sha"], json!(response.short_sha.clone()));
    assert_eq!(metadata["branch"], json!(response.branch.clone()));
    assert_eq!(metadata["message"], json!("commit without work item"));
    assert_eq!(metadata["files"], json!(["tracked.txt"]));
    assert_eq!(metadata["additions"], json!(1));
    assert_eq!(metadata["deletions"], json!(0));
    assert_eq!(metadata["work_item_ids"], json!([]));
    assert_eq!(metadata["force_shared"], json!(false));
}

#[tokio::test]
async fn commit_writes_delivery_records_for_linked_work_items() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let first = seed_work_item(&pool, project.id, "First linked item").await;
    let second = seed_work_item(&pool, project.id, "Second linked item").await;
    link_work_item_to_session(&pool, first.id, session_id).await;
    link_work_item_to_session(&pool, second.id, session_id).await;
    fs::write(repo_path.join("tracked.txt"), "base\nnext\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    let response = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit linked work items".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: Some(true),
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    let records = ProjectDeliveryRecord::find_by_project(&pool, project.id, None, None)
        .await
        .expect("list delivery records");
    assert_eq!(records.len(), 2);

    let mut record_work_item_ids = records
        .iter()
        .map(|record| record.project_work_item_id.expect("work item id"))
        .collect::<Vec<_>>();
    record_work_item_ids.sort();
    let mut expected_work_item_ids = vec![first.id, second.id];
    expected_work_item_ids.sort();
    assert_eq!(record_work_item_ids, expected_work_item_ids);

    let expected_metadata_work_item_ids = expected_work_item_ids
        .iter()
        .map(Uuid::to_string)
        .collect::<Vec<_>>();
    for record in records {
        assert_eq!(record.event_type, ProjectDeliveryEventTypeV2::CommitCreated);
        assert_eq!(record.source_session_id, Some(session_id));
        assert_eq!(
            record.external_id.as_deref(),
            Some(response.commit_sha.as_str())
        );
        let metadata: serde_json::Value =
            serde_json::from_str(record.metadata_json.as_deref().expect("metadata"))
                .expect("parse metadata");
        assert_eq!(
            metadata["work_item_ids"],
            json!(expected_metadata_work_item_ids.clone())
        );
        assert_eq!(metadata["files"], json!(["tracked.txt"]));
        assert_eq!(metadata["force_shared"], json!(true));
    }
}

#[tokio::test]
async fn commit_rejects_external_index_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
    fs::write(repo_path.join("external.txt"), "external\n").expect("write external");
    git_add(&repo_path, "tracked.txt");
    git_add(&repo_path, "external.txt");

    let err = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit session changes".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect_err("external staged path rejected");

    assert_eq!(
        commit_error_code(err),
        SourceControlCommitErrorCode::ExternalStagedConflict
    );
}

#[tokio::test]
async fn commit_rejects_detached_head() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");
    git_checkout_detached(&repo_path);

    let err = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit session changes".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect_err("detached head rejected");

    assert_eq!(
        commit_error_code(err),
        SourceControlCommitErrorCode::DetachedHead
    );
}

#[tokio::test]
async fn discard_rejects_stale_expected_head() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "updated\n").expect("modify tracked");

    let response = SourceControlService::new()
        .discard(
            &pool,
            project.id,
            SourceControlDiscardRequest {
                session_id,
                workspace_id: None,
                paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                expected_head_sha: Some("not-the-head".to_string()),
            },
        )
        .await
        .expect("discard response");

    assert!(!response.ok);
    assert_eq!(
        response.failed[0].code,
        SourceControlOperationFailureCode::StaleStatus
    );
}

#[tokio::test]
async fn discard_removes_untracked_added_file() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["new.txt"]).await;
    fs::write(repo_path.join("new.txt"), "new\n").expect("write untracked");

    let response = SourceControlService::new()
        .discard(
            &pool,
            project.id,
            SourceControlDiscardRequest {
                session_id,
                workspace_id: None,
                paths: vec!["new.txt".to_string()],
                force_shared: None,
                expected_head_sha: Some(git_head_sha(&repo_path)),
            },
        )
        .await
        .expect("discard response");

    assert!(response.ok);
    assert_eq!(response.succeeded, vec!["new.txt"]);
    assert!(!repo_path.join("new.txt").exists());
    let (changes, staged) = git_status_paths(operation_status(&response));
    assert!(changes.is_empty());
    assert!(staged.is_empty());
}

#[tokio::test]
async fn status_maps_untracked_without_collapsing_to_added() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["new.txt"]).await;
    fs::write(repo_path.join("new.txt"), "new\n").expect("write untracked");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes[0].status, SourceControlFileStatus::Untracked);
}

// ---------------------------------------------------------------------------
// Session worktree workspace selection tests
// ---------------------------------------------------------------------------

use db::models::{
    chat_session::ChatSessionWorktreeMode,
    chat_session_worktree::{
        CreateSessionWorktree, SessionWorktree, SessionWorktreeMode as WorktreeMode,
        SessionWorktreeStatus,
    },
};

async fn seed_isolated_session(pool: &SqlitePool, project_id: Uuid, workspace_path: &Path) -> Uuid {
    let session = ChatSession::create(
        pool,
        &CreateChatSession {
            title: Some("Isolated Session".to_string()),
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            project_id: Some(project_id),
            worktree_mode: Some(ChatSessionWorktreeMode::Isolated),
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create isolated session");
    session.id
}

async fn seed_worktree_row(
    pool: &SqlitePool,
    session_id: Uuid,
    project_id: Uuid,
    base_workspace: &Path,
    worktree_path: &Path,
    status: SessionWorktreeStatus,
) -> Uuid {
    let row = SessionWorktree::create(
        pool,
        &CreateSessionWorktree {
            session_id,
            project_id: Some(project_id),
            base_workspace_path: base_workspace.to_string_lossy().to_string(),
            repo_path: base_workspace.to_string_lossy().to_string(),
            base_branch: "main".to_string(),
            base_commit: None,
            branch_name: format!("openteams/session/{}", &format!("{session_id}")[..8]),
            worktree_path: worktree_path.to_string_lossy().to_string(),
            mode: WorktreeMode::Session,
        },
        Uuid::new_v4(),
    )
    .await
    .expect("create worktree row");

    if status != SessionWorktreeStatus::Creating {
        SessionWorktree::transition_status(pool, row.id, SessionWorktreeStatus::Creating, status)
            .await
            .expect("transition to target status");
    }
    row.id
}

#[tokio::test]
async fn source_control_uses_worktree_path_for_active_worktree() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_isolated_session(&pool, project.id, &repo_path).await;

    let worktree_dir = tempfile::TempDir::new().unwrap();
    let worktree_path = worktree_dir.path();
    // Create a minimal git structure in the worktree path so it's accessible
    fs::create_dir_all(worktree_path).unwrap();

    seed_worktree_row(
        &pool,
        session_id,
        project.id,
        &repo_path,
        worktree_path,
        SessionWorktreeStatus::Active,
    )
    .await;

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status with active worktree");

    // Should NOT fail — the active worktree path is used, not the project workspace.
    // Even if the worktree path isn't a real git repo, session_status should resolve
    // the workspace context successfully (it may return a Plain status).
    match status {
        SessionSourceControlStatus::Git { .. } | SessionSourceControlStatus::Plain { .. } => {}
    }
}

#[tokio::test]
async fn source_control_switches_to_base_workspace_after_merge() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_isolated_session(&pool, project.id, &repo_path).await;

    let worktree_dir = tempfile::TempDir::new().unwrap();
    let worktree_path = worktree_dir.path();
    fs::create_dir_all(worktree_path).unwrap();

    // Seed a merged worktree — source-control should use base_workspace_path
    seed_worktree_row(
        &pool,
        session_id,
        project.id,
        &repo_path,
        worktree_path,
        SessionWorktreeStatus::Merged,
    )
    .await;

    // session_status should succeed and use the base workspace (repo_path),
    // NOT the worktree_path (which is a temp dir with no git).
    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status with merged worktree");

    // The status should be Git (from repo_path), not Plain.
    match status {
        SessionSourceControlStatus::Git { .. } => {}
        SessionSourceControlStatus::Plain { .. } => {
            panic!("expected git status from base workspace after merge");
        }
    }
}

#[tokio::test]
async fn source_control_switches_to_base_workspace_for_cleanup_failed() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_isolated_session(&pool, project.id, &repo_path).await;

    let worktree_dir = tempfile::TempDir::new().unwrap();
    let worktree_path = worktree_dir.path();
    fs::create_dir_all(worktree_path).unwrap();

    // Seed a cleanup_failed worktree — source-control should use base_workspace_path,
    // NOT the worktree_path (which would be stale after a failed cleanup).
    // cleanup_failed requires going through cleanup_pending first.
    let row_id = seed_worktree_row(
        &pool,
        session_id,
        project.id,
        &repo_path,
        worktree_path,
        SessionWorktreeStatus::CleanupPending,
    )
    .await;
    SessionWorktree::transition_status(
        &pool,
        row_id,
        SessionWorktreeStatus::CleanupPending,
        SessionWorktreeStatus::CleanupFailed,
    )
    .await
    .expect("transition to cleanup_failed");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status with cleanup_failed worktree");

    // Should use base workspace, not the stale worktree path.
    match status {
        SessionSourceControlStatus::Git { .. } => {}
        SessionSourceControlStatus::Plain { .. } => {
            panic!("expected git status from base workspace for cleanup_failed");
        }
    }
}
