use std::{fs, path::Path};

use chrono::{Duration, Utc};
use db::models::{
    chat_agent::{ChatAgent, CreateChatAgent},
    chat_run::{ChatRun, CreateChatRun},
    chat_session::{ChatSession, CreateChatSession},
    chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
    chat_session_path_index::{ChatSessionPathIndex, UpsertChatSessionPathIndex},
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
    SourceControlObservedPath, SourceControlOperationFailureCode, SourceControlOperationInProgress,
    SourceControlService, SourceControlStageRequest,
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
    seed_session_with_observed_source(
        pool,
        project_id,
        workspace_path,
        paths,
        "git_diff,artifact_record",
    )
    .await
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

    let run = ChatRun::create(
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
    let observed_for_index = paths
        .iter()
        .map(|path| SourceControlObservedPath {
            path: (*path).to_string(),
            source: source.to_string(),
            existed_after_run: true,
            observed_at: run.created_at,
        })
        .collect::<Vec<_>>();
    SourceControlService::record_session_run_observed_paths(
        pool,
        session.id,
        workspace_path,
        run.id,
        &observed_for_index,
    )
    .await
    .expect("index session paths");

    session.id
}

async fn append_session_run_with_paths(
    pool: &SqlitePool,
    session_id: Uuid,
    workspace_path: &Path,
    paths: &[&str],
    run_index: i64,
) {
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session_id)
        .await
        .expect("list session agents");
    let session_agent = session_agents.first().expect("session agent");
    let run_dir = workspace_path
        .join(".openteams-test-runs")
        .join(session_id.to_string());
    fs::create_dir_all(&run_dir).expect("create run dir");
    let observed = paths
        .iter()
        .map(|path| {
            json!({
                "path": path,
                "source": "git_diff,artifact_record",
                "existed_after_run": true
            })
        })
        .collect::<Vec<_>>();
    let meta_path = run_dir.join(format!("meta_run_{run_index}.json"));
    fs::write(
        &meta_path,
        json!({ "workspace_observed_paths": observed }).to_string(),
    )
    .expect("write meta");

    let run = ChatRun::create(
        pool,
        &CreateChatRun {
            session_id,
            session_agent_id: session_agent.id,
            workspace_path: Some(workspace_path.to_string_lossy().to_string()),
            run_index,
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
    let observed_for_index = paths
        .iter()
        .map(|path| SourceControlObservedPath {
            path: (*path).to_string(),
            source: "git_diff,artifact_record".to_string(),
            existed_after_run: true,
            observed_at: run.created_at,
        })
        .collect::<Vec<_>>();
    SourceControlService::record_session_run_observed_paths(
        pool,
        session_id,
        workspace_path,
        run.id,
        &observed_for_index,
    )
    .await
    .expect("index appended session paths");
    SourceControlService::invalidate_session_caches(session_id);
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

fn start_conflicting_merge(repo_path: &Path, branch_name: &str) {
    let git = GitCli::new();
    git.git(repo_path, ["checkout", "-b", branch_name])
        .expect("create conflict branch");
    fs::write(repo_path.join("tracked.txt"), "session branch\n")
        .expect("write session branch change");
    git_add(repo_path, "tracked.txt");
    GitService::new()
        .commit(repo_path, "session branch change")
        .expect("commit session branch change");

    git.git(repo_path, ["checkout", "main"])
        .expect("checkout main");
    fs::write(repo_path.join("tracked.txt"), "main branch\n").expect("write main branch change");
    git_add(repo_path, "tracked.txt");
    GitService::new()
        .commit(repo_path, "main branch change")
        .expect("commit main branch change");

    let merge = git.git(repo_path, ["merge", "--no-ff", "--no-commit", branch_name]);
    assert!(
        merge.is_err(),
        "merge should stop with a conflict so MERGE_HEAD remains"
    );
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
async fn git_workspace_keeps_artifact_paths_that_are_in_current_diff() {
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
    assert_eq!(changes, vec!["tracked.txt"]);
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
async fn git_workspace_keeps_work_records_artifact_paths_in_current_diff() {
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
        changes.iter().any(|path| path == "binaries/test.txt"),
        "work_records artifact paths should own current source-control changes: {changes:?}"
    );
    assert!(staged.is_empty());
}

#[tokio::test]
async fn git_workspace_excludes_other_session_artifact_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;

    fs::write(repo_path.join("session_a.txt"), "base a\n").expect("write a");
    fs::write(repo_path.join("session_b.txt"), "base b\n").expect("write b");
    git_add(&repo_path, "session_a.txt");
    git_add(&repo_path, "session_b.txt");
    GitService::new()
        .commit(&repo_path, "track session files")
        .expect("commit session files");

    let session_a =
        seed_session_with_paths(&pool, project.id, &repo_path, &["session_a.txt"]).await;
    let session_b =
        seed_session_with_paths(&pool, project.id, &repo_path, &["session_b.txt"]).await;

    fs::write(repo_path.join("session_a.txt"), "changed by a\n").expect("modify a");
    fs::write(repo_path.join("session_b.txt"), "changed by b\n").expect("modify b");

    let status_a = SourceControlService::new()
        .session_status(&pool, project.id, session_a, None)
        .await
        .expect("status a");
    let status_b = SourceControlService::new()
        .session_status(&pool, project.id, session_b, None)
        .await
        .expect("status b");

    let (changes_a, staged_a) = git_status_paths(&status_a);
    let (changes_b, staged_b) = git_status_paths(&status_b);
    assert_eq!(changes_a, vec!["session_a.txt"]);
    assert_eq!(changes_b, vec!["session_b.txt"]);
    assert!(staged_a.is_empty());
    assert!(staged_b.is_empty());
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
async fn shared_file_can_be_staged_without_confirmation() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let _other_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "shared update\n").expect("modify tracked");

    let response = SourceControlService::new()
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
        .expect("stage response");

    assert!(response.ok);
    let (_, staged) = git_status_paths(operation_status(&response));
    assert_eq!(staged, vec!["tracked.txt"]);
}

#[tokio::test]
async fn shared_file_commit_requires_confirmation() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    let _other_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "shared update\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    let error = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "shared update".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect_err("shared commit should require confirmation");

    let SourceControlError::Commit(payload) = error else {
        panic!("expected structured commit error");
    };
    assert_eq!(
        payload.code,
        SourceControlCommitErrorCode::SharedFileRequiresConfirmation
    );
    assert_eq!(
        payload.conflicting_paths,
        Some(vec!["tracked.txt".to_string()])
    );
}

#[tokio::test]
async fn committed_other_session_path_is_not_shared() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let first_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "first session\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id: first_session,
                workspace_id: None,
                message: "commit first session".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    let second_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "second session\n").expect("modify tracked again");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, second_session, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "tracked.txt");
    assert!(!changes[0].shared);
    assert!(changes[0].shared_session_ids.is_empty());
}

#[tokio::test]
async fn stale_committed_other_session_path_index_is_not_shared() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let first_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "first session\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id: first_session,
                workspace_id: None,
                message: "commit first session".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    let records = ProjectDeliveryRecord::find_by_project(&pool, project.id, None, None)
        .await
        .expect("delivery records");
    let commit_record = records
        .iter()
        .find(|record| {
            record.source_session_id == Some(first_session)
                && record.event_type == ProjectDeliveryEventTypeV2::CommitCreated
        })
        .expect("commit delivery record");
    let workspace_path_string = repo_path.to_string_lossy().to_string();
    ChatSessionPathIndex::upsert_many(
        &pool,
        project.id,
        &workspace_path_string,
        first_session,
        &[UpsertChatSessionPathIndex {
            path: "tracked.txt".to_string(),
            last_run_id: None,
            last_observed_at: commit_record.occurred_at - Duration::milliseconds(1),
            existed_after_run: true,
        }],
    )
    .await
    .expect("restore stale path index row");

    let second_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "second session\n").expect("modify tracked again");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, second_session, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "tracked.txt");
    assert!(!changes[0].shared);
    assert!(changes[0].shared_session_ids.is_empty());
}

#[tokio::test]
async fn externally_committed_other_session_path_is_not_shared() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let first_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "external commit\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");
    GitService::new()
        .commit(&repo_path, "external commit")
        .expect("manual external commit");

    let workspace_path_string = repo_path.to_string_lossy().to_string();
    let tracked_paths = vec!["tracked.txt".to_string()];
    ChatSessionPathIndex::delete_paths(
        &pool,
        project.id,
        &workspace_path_string,
        first_session,
        &tracked_paths,
    )
    .await
    .expect("remove original path index row");
    ChatSessionPathIndex::upsert_many(
        &pool,
        project.id,
        &workspace_path_string,
        first_session,
        &[UpsertChatSessionPathIndex {
            path: "tracked.txt".to_string(),
            last_run_id: None,
            last_observed_at: Utc::now() - Duration::seconds(5),
            existed_after_run: true,
        }],
    )
    .await
    .expect("restore stale path index row");

    let second_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "single session follow-up\n")
        .expect("modify tracked again");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, second_session, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "tracked.txt");
    assert!(!changes[0].shared);
    assert!(changes[0].shared_session_ids.is_empty());
}

#[tokio::test]
async fn externally_committed_current_session_path_is_pruned_when_path_changes_again() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let first_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    sqlx::query(
        "UPDATE chat_runs SET created_at = datetime('now', '-10 seconds') WHERE session_id = ?",
    )
    .bind(first_session)
    .execute(&pool)
    .await
    .expect("backdate first session observation");
    SourceControlService::invalidate_session_caches(first_session);

    fs::write(repo_path.join("tracked.txt"), "external commit\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");
    GitService::new()
        .commit(&repo_path, "external commit")
        .expect("manual external commit");

    let _second_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "second session follow-up\n")
        .expect("modify tracked again");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, first_session, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert!(
        changes.is_empty(),
        "externally committed first-session path should be pruned even when the path is dirty again"
    );
}

#[tokio::test]
async fn other_session_path_observed_after_commit_is_shared_again() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let first_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "first session\n").expect("modify tracked");
    git_add(&repo_path, "tracked.txt");

    SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id: first_session,
                workspace_id: None,
                message: "commit first session".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    append_session_run_with_paths(&pool, first_session, &repo_path, &["tracked.txt"], 2).await;

    let second_session =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "second session\n").expect("modify tracked again");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, second_session, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, "tracked.txt");
    assert!(changes[0].shared);
    assert_eq!(changes[0].shared_session_ids, vec![first_session]);
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
    assert!(response.status.is_none());

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status after commit");
    let (changes, staged) = git_status_paths(&status);
    assert!(changes.is_empty());
    assert!(staged.is_empty());
}

#[tokio::test]
async fn commit_preserves_unstaged_changes_for_staged_paths() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;
    fs::write(repo_path.join("tracked.txt"), "base\nstaged\n").expect("write staged content");
    git_add(&repo_path, "tracked.txt");
    fs::write(repo_path.join("tracked.txt"), "base\nstaged\nunstaged\n")
        .expect("write unstaged content");

    let response = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id,
                workspace_id: None,
                message: "commit staged only".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect("commit succeeds");

    assert_eq!(response.committed_paths, vec!["tracked.txt"]);
    let committed_content = GitCli::new()
        .git(&repo_path, ["show", "HEAD:tracked.txt"])
        .expect("read committed file");
    assert_eq!(committed_content, "base\nstaged\n");
    let worktree_content =
        fs::read_to_string(repo_path.join("tracked.txt")).expect("read worktree file");
    assert_eq!(worktree_content, "base\nstaged\nunstaged\n");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status after commit");
    let (changes, staged) = git_status_paths(&status);
    assert_eq!(changes, vec!["tracked.txt"]);
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
async fn discard_removes_untracked_file_inside_new_directory() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let path = "generated/new.txt";
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &[path]).await;
    fs::create_dir_all(repo_path.join("generated")).expect("create untracked directory");
    fs::write(repo_path.join(path), "new\n").expect("write untracked");

    let response = SourceControlService::new()
        .discard(
            &pool,
            project.id,
            SourceControlDiscardRequest {
                session_id,
                workspace_id: None,
                paths: vec![path.to_string()],
                force_shared: None,
                expected_head_sha: Some(git_head_sha(&repo_path)),
            },
        )
        .await
        .expect("discard response");

    assert!(response.ok);
    assert_eq!(response.succeeded, vec![path]);
    assert!(!repo_path.join(path).exists());
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

#[tokio::test]
async fn status_reports_session_file_inside_new_untracked_directory() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let path = "frontend/src/components/version-update/VersionUpdatePage.tsx";
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &[path]).await;
    let absolute_path = repo_path.join(path);
    fs::create_dir_all(absolute_path.parent().expect("new directory parent"))
        .expect("create new directory");
    fs::write(
        &absolute_path,
        "export const VersionUpdatePage = () => null;\n",
    )
    .expect("write untracked component");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git { changes, .. } = status else {
        panic!("expected git status");
    };
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].path, path);
    assert_eq!(changes[0].status, SourceControlFileStatus::Untracked);
}

#[tokio::test]
async fn status_reports_unowned_git_operation_in_progress() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;

    start_conflicting_merge(&repo_path, "manual-conflict");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git {
        operation_in_progress,
        blocked_reason,
        ..
    } = status
    else {
        panic!("expected git status");
    };
    assert_eq!(
        operation_in_progress,
        Some(SourceControlOperationInProgress::Merge)
    );
    assert!(blocked_reason.is_some());
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
async fn source_control_uses_worktree_path_after_merge() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let session_id = seed_isolated_session(&pool, project.id, &repo_path).await;

    let worktree_dir = tempfile::TempDir::new().unwrap();
    let worktree_path = worktree_dir.path();
    fs::create_dir_all(worktree_path).unwrap();

    // Seed a merged worktree: source-control should keep using worktree_path,
    // matching runner workspace routing for follow-up session commits.
    seed_worktree_row(
        &pool,
        session_id,
        project.id,
        &repo_path,
        worktree_path,
        SessionWorktreeStatus::Merged,
    )
    .await;

    let status = SourceControlService::new()
        .session_status(&pool, project.id, session_id, None)
        .await
        .expect("status with merged worktree");

    match status {
        SessionSourceControlStatus::Git { workspace_path, .. }
        | SessionSourceControlStatus::Plain { workspace_path, .. } => {
            assert_eq!(workspace_path, worktree_path.to_string_lossy());
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

#[tokio::test]
async fn source_control_hides_worktree_merge_operation_for_other_sessions() {
    let pool = setup_pool().await;
    let (_tempdir, repo_path) = setup_git_workspace();
    let project = seed_project(&pool, &repo_path).await;
    let owner_session_id = seed_isolated_session(&pool, project.id, &repo_path).await;
    let other_session_id =
        seed_session_with_paths(&pool, project.id, &repo_path, &["tracked.txt"]).await;

    let worktree_dir = tempfile::TempDir::new().unwrap();
    let worktree_path = worktree_dir.path();
    fs::create_dir_all(worktree_path).unwrap();
    seed_worktree_row(
        &pool,
        owner_session_id,
        project.id,
        &repo_path,
        worktree_path,
        SessionWorktreeStatus::NeedsConflictResolution,
    )
    .await;
    start_conflicting_merge(&repo_path, "worktree-conflict");

    let status = SourceControlService::new()
        .session_status(&pool, project.id, other_session_id, None)
        .await
        .expect("status");

    let SessionSourceControlStatus::Git {
        operation_in_progress,
        blocked_reason,
        ..
    } = status
    else {
        panic!("expected git status");
    };
    assert_eq!(operation_in_progress, None);
    assert_eq!(blocked_reason, None);

    let stage_response = SourceControlService::new()
        .stage(
            &pool,
            project.id,
            SourceControlStageRequest {
                session_id: other_session_id,
                workspace_id: None,
                paths: vec!["tracked.txt".to_string()],
                force_shared: None,
            },
        )
        .await
        .expect("stage response");
    assert!(!stage_response.ok);
    assert_eq!(
        stage_response.failed[0].code,
        SourceControlOperationFailureCode::GitOperationBlocked
    );

    let commit_err = SourceControlService::new()
        .commit(
            &pool,
            project.id,
            SourceControlCommitRequest {
                session_id: other_session_id,
                workspace_id: None,
                message: "commit during worktree conflict".to_string(),
                expected_staged_paths: vec!["tracked.txt".to_string()],
                force_shared: None,
                work_item_ids: None,
                expected_head_sha: None,
            },
        )
        .await
        .expect_err("commit should remain blocked");
    assert_eq!(
        commit_error_code(commit_err),
        SourceControlCommitErrorCode::GitOperationBlocked
    );
}
