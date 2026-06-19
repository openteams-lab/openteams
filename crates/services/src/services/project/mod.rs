pub mod delivery;
pub mod member;
pub mod migration;
pub mod path;
pub mod source_control;
pub mod work_item;

#[cfg(test)]
mod source_control_tests;

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use db::models::{
    chat_session::ChatSession,
    project::{CreateProject, Project, ProjectError, SearchMatchType, SearchResult, UpdateProject},
    project_member::ProjectMember,
    project_path::ProjectPath,
    project_repo::{CreateProjectRepo, ProjectRepo},
    project_stats::ProjectStats,
    repo::Repo,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use self::member::ProjectMemberService;
use super::{
    file_search::{FileSearchCache, SearchQuery},
    repo::{RepoError, RepoService},
};

#[derive(Debug, Error)]
pub enum ProjectServiceError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Project(#[from] ProjectError),
    #[error("Path does not exist: {0}")]
    PathNotFound(PathBuf),
    #[error("Path is not a directory: {0}")]
    PathNotDirectory(PathBuf),
    #[error("Path is not a git repository: {0}")]
    NotGitRepository(PathBuf),
    #[error("Duplicate git repository path")]
    DuplicateGitRepoPath,
    #[error("Duplicate repository name in project")]
    DuplicateRepositoryName,
    #[error("Repository not found")]
    RepositoryNotFound,
    #[error("Git operation failed: {0}")]
    GitError(String),
    #[error("Project member initialization failed: {0}")]
    MemberInitializationFailed(String),
}

pub type Result<T> = std::result::Result<T, ProjectServiceError>;

impl From<RepoError> for ProjectServiceError {
    fn from(e: RepoError) -> Self {
        match e {
            RepoError::PathNotFound(p) => Self::PathNotFound(p),
            RepoError::PathNotDirectory(p) => Self::PathNotDirectory(p),
            RepoError::NotGitRepository(p) => Self::NotGitRepository(p),
            RepoError::Io(e) => Self::Io(e),
            RepoError::Database(e) => Self::Database(e),
            _ => Self::RepositoryNotFound,
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;
    use db::models::{
        chat_session::{ChatSession, CreateChatSession},
        member_execution_config::MemberExecutionConfig,
        project::{CreateProject, Project},
        project_member::{ProjectMember, ProjectMemberType},
        project_path::{ProjectPath, ProjectPathKind},
        project_repo::ProjectRepo,
        project_stats::ProjectStats,
    };
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::ProjectService;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");

        for statement in [
            r#"
            CREATE TABLE projects (
                id BLOB PRIMARY KEY,
                name TEXT NOT NULL,
                default_agent_working_dir TEXT,
                remote_project_id BLOB,
                description TEXT,
                status TEXT,
                default_workspace_path TEXT,
                active_repo_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_paths (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                path TEXT NOT NULL,
                label TEXT,
                kind TEXT CHECK (kind IN ('workspace', 'artifact', 'external')),
                is_default BOOLEAN DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_members (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                member_type TEXT CHECK (member_type IN ('human', 'agent')),
                user_id TEXT,
                agent_id BLOB,
                member_name TEXT,
                role TEXT,
                display_order INTEGER DEFAULT 0,
                default_workspace_path TEXT,
                allowed_skill_ids TEXT,
                execution_config TEXT NOT NULL DEFAULT '{}',
                is_default BOOLEAN DEFAULT false,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE chat_sessions (
                id BLOB PRIMARY KEY,
                title TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                lead_agent_id BLOB,
                summary_text TEXT,
                archive_ref TEXT,
                last_seen_diff_key TEXT,
                team_protocol TEXT,
                team_protocol_enabled BOOLEAN NOT NULL DEFAULT 0,
                default_workspace_path TEXT,
                chat_input_mode TEXT,
                project_id BLOB,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived_at TEXT
            )
            "#,
            r#"
            CREATE TABLE repos (
                id BLOB PRIMARY KEY,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL,
                setup_script TEXT,
                cleanup_script TEXT,
                archive_script TEXT,
                copy_files TEXT,
                parallel_setup_script BOOLEAN NOT NULL DEFAULT 0,
                dev_server_script TEXT,
                default_target_branch TEXT,
                default_working_dir TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE TABLE project_repos (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                repo_id BLOB NOT NULL
            )
            "#,
            r#"
            CREATE TABLE project_stats (
                id BLOB PRIMARY KEY,
                project_id BLOB,
                period_start DATE,
                period_end DATE,
                feature_count INTEGER DEFAULT 0,
                bugfix_count INTEGER DEFAULT 0,
                test_count INTEGER DEFAULT 0,
                input_tokens BIGINT DEFAULT 0,
                output_tokens BIGINT DEFAULT 0,
                cache_read_tokens BIGINT DEFAULT 0,
                reasoning_output_tokens BIGINT DEFAULT 0,
                total_tokens BIGINT DEFAULT 0,
                cost_total DECIMAL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )
            "#,
            r#"
            CREATE UNIQUE INDEX idx_project_stats_project_period
            ON project_stats(project_id, period_start, period_end)
            "#,
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create project detail test schema");
        }

        pool
    }

    #[tokio::test]
    async fn project_detail_aggregates_related_records() {
        let pool = setup_pool().await;
        let project_id = Uuid::new_v4();
        let repo_id = Uuid::new_v4();
        let period_start = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let period_end = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();

        Project::create(
            &pool,
            &CreateProject {
                name: "Project".to_string(),
                repositories: Vec::new(),
                description: Some("desc".to_string()),
                status: Some("active".to_string()),
                default_workspace_path: Some("/workspace".to_string()),
                active_repo_id: Some(repo_id),
            },
            project_id,
        )
        .await
        .expect("create project");
        ProjectPath::create(
            &pool,
            project_id,
            "/workspace".to_string(),
            Some("Workspace".to_string()),
            ProjectPathKind::Workspace,
            true,
        )
        .await
        .expect("create project path");
        ProjectMember::create(
            &pool,
            project_id,
            ProjectMemberType::Human,
            Some("user-1".to_string()),
            None,
            None,
            Some("owner".to_string()),
            0,
            None,
            Vec::new(),
            MemberExecutionConfig::default(),
            true,
        )
        .await
        .expect("create project member");
        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("Session".to_string()),
                workspace_path: None,
                project_id: Some(project_id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project session");
        sqlx::query(
            r#"
            INSERT INTO repos (id, path, name, display_name)
            VALUES (?1, '/repo', 'repo', 'Repo')
            "#,
        )
        .bind(repo_id)
        .execute(&pool)
        .await
        .expect("insert repo");
        ProjectRepo::create(&pool, project_id, repo_id)
            .await
            .expect("link repo to project");
        ProjectStats::upsert(
            &pool,
            project_id,
            period_start,
            period_end,
            1,
            2,
            3,
            10,
            20,
            0,
            0,
            30,
            Some(1.5),
        )
        .await
        .expect("insert project stats");

        let detail = ProjectService::new()
            .get_project_detail(&pool, project_id)
            .await
            .expect("get project detail");

        assert_eq!(detail.project.id, project_id);
        assert_eq!(detail.paths.len(), 1);
        assert_eq!(detail.members.len(), 1);
        assert_eq!(detail.sessions.len(), 1);
        assert_eq!(detail.repos.len(), 1);
        assert_eq!(detail.repos[0].id, repo_id);
        assert_eq!(detail.stats.len(), 1);
        assert_eq!(detail.stats[0].feature_count, 1);
    }
}

#[derive(Clone, Default)]
pub struct ProjectService;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ProjectDetail {
    pub project: Project,
    pub paths: Vec<ProjectPath>,
    pub members: Vec<ProjectMember>,
    pub sessions: Vec<ChatSession>,
    pub repos: Vec<Repo>,
    pub stats: Vec<ProjectStats>,
}

impl ProjectService {
    pub fn new() -> Self {
        Self
    }

    pub async fn list_projects(&self, pool: &SqlitePool) -> Result<Vec<Project>> {
        Ok(Project::find_all(pool).await?)
    }

    pub async fn get_project_detail(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<ProjectDetail> {
        let project = Project::find_by_id(pool, project_id)
            .await?
            .ok_or(ProjectServiceError::Project(ProjectError::ProjectNotFound))?;
        let paths = ProjectPath::find_by_project(pool, project_id).await?;
        let members = ProjectMember::find_by_project(pool, project_id).await?;
        let sessions = ChatSession::find_by_project(pool, project_id).await?;
        let repos = ProjectRepo::find_repos_for_project(pool, project_id).await?;
        let stats = ProjectStats::find_by_project(pool, project_id).await?;

        Ok(ProjectDetail {
            project,
            paths,
            members,
            sessions,
            repos,
            stats,
        })
    }

    pub async fn create_project(
        &self,
        pool: &SqlitePool,
        repo_service: &RepoService,
        payload: CreateProject,
        user_id: &str,
    ) -> Result<Project> {
        // Validate all repository paths and check for duplicates within the payload
        let mut seen_names = HashSet::new();
        let mut seen_paths = HashSet::new();
        let mut normalized_repos = Vec::new();

        for repo in &payload.repositories {
            let path = repo_service.normalize_path(&repo.git_repo_path)?;
            repo_service.validate_git_repo_path(&path)?;

            let normalized_path = path.to_string_lossy().to_string();

            if !seen_names.insert(repo.display_name.clone()) {
                return Err(ProjectServiceError::DuplicateRepositoryName);
            }

            if !seen_paths.insert(normalized_path.clone()) {
                return Err(ProjectServiceError::DuplicateGitRepoPath);
            }

            normalized_repos.push(CreateProjectRepo {
                display_name: repo.display_name.clone(),
                git_repo_path: normalized_path,
            });
        }

        let id = Uuid::new_v4();

        let project = Project::create(pool, &payload, id)
            .await
            .map_err(|e| ProjectServiceError::Project(ProjectError::CreateFailed(e.to_string())))?;

        for repo in &normalized_repos {
            let repo_entity =
                Repo::find_or_create(pool, Path::new(&repo.git_repo_path), &repo.display_name)
                    .await?;
            ProjectRepo::create(pool, project.id, repo_entity.id).await?;
        }

        ProjectMemberService::new()
            .initialize_default_members(pool, project.id, user_id)
            .await
            .map_err(|err| ProjectServiceError::MemberInitializationFailed(err.to_string()))?;

        Ok(project)
    }

    pub async fn update_project(
        &self,
        pool: &SqlitePool,
        id: Uuid,
        payload: UpdateProject,
    ) -> Result<Project> {
        let project = Project::update(pool, id, &payload).await?;

        Ok(project)
    }

    pub async fn add_repository(
        &self,
        pool: &SqlitePool,
        repo_service: &RepoService,
        project_id: Uuid,
        payload: &CreateProjectRepo,
    ) -> Result<Repo> {
        tracing::debug!(
            "Adding repository '{}' to project {} (path: {})",
            payload.display_name,
            project_id,
            payload.git_repo_path
        );

        let path = repo_service.normalize_path(&payload.git_repo_path)?;
        repo_service.validate_git_repo_path(&path)?;

        let repository = ProjectRepo::add_repo_to_project(
            pool,
            project_id,
            &path.to_string_lossy(),
            &payload.display_name,
        )
        .await
        .map_err(|e| match e {
            db::models::project_repo::ProjectRepoError::AlreadyExists => {
                ProjectServiceError::DuplicateGitRepoPath
            }
            db::models::project_repo::ProjectRepoError::Database(e) => {
                ProjectServiceError::Database(e)
            }
            _ => ProjectServiceError::RepositoryNotFound,
        })?;

        tracing::info!(
            "Added repository {} to project {} (path: {})",
            repository.id,
            project_id,
            repository.path.display()
        );

        Ok(repository)
    }

    pub async fn delete_repository(
        &self,
        pool: &SqlitePool,
        project_id: Uuid,
        repo_id: Uuid,
    ) -> Result<()> {
        tracing::debug!(
            "Removing repository {} from project {}",
            repo_id,
            project_id
        );

        ProjectRepo::remove_repo_from_project(pool, project_id, repo_id)
            .await
            .map_err(|e| match e {
                db::models::project_repo::ProjectRepoError::NotFound => {
                    ProjectServiceError::RepositoryNotFound
                }
                db::models::project_repo::ProjectRepoError::Database(e) => {
                    ProjectServiceError::Database(e)
                }
                _ => ProjectServiceError::RepositoryNotFound,
            })?;

        if let Err(e) = Repo::delete_orphaned(pool).await {
            tracing::error!("Failed to delete orphaned repos: {}", e);
        }

        tracing::info!("Removed repository {} from project {}", repo_id, project_id);

        Ok(())
    }

    pub async fn delete_project(&self, pool: &SqlitePool, project_id: Uuid) -> Result<u64> {
        let rows_affected = Project::delete(pool, project_id).await?;

        if let Err(e) = Repo::delete_orphaned(pool).await {
            tracing::error!("Failed to delete orphaned repos: {}", e);
        }

        Ok(rows_affected)
    }

    pub async fn get_repositories(&self, pool: &SqlitePool, project_id: Uuid) -> Result<Vec<Repo>> {
        let repos = ProjectRepo::find_repos_for_project(pool, project_id).await?;
        Ok(repos)
    }

    pub async fn search_files(
        &self,
        cache: &FileSearchCache,
        repositories: &[Repo],
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>> {
        let query_str = query.q.trim();
        if query_str.is_empty() || repositories.is_empty() {
            return Ok(vec![]);
        }

        // Search in parallel and prefix paths with repo name
        let search_futures: Vec<_> = repositories
            .iter()
            .map(|repo| {
                let repo_name = repo.name.clone();
                let repo_path = repo.path.clone();
                let mode = query.mode.clone();
                let query_str = query_str.to_string();
                async move {
                    let results = cache
                        .search_repo(&repo_path, &query_str, mode)
                        .await
                        .unwrap_or_else(|e| {
                            tracing::warn!("Search failed for repo {}: {}", repo_name, e);
                            vec![]
                        });
                    (repo_name, results)
                }
            })
            .collect();

        let repo_results = futures::future::join_all(search_futures).await;

        let mut all_results: Vec<SearchResult> = repo_results
            .into_iter()
            .flat_map(|(repo_name, results)| {
                results.into_iter().map(move |r| SearchResult {
                    path: format!("{}/{}", repo_name, r.path),
                    is_file: r.is_file,
                    match_type: r.match_type.clone(),
                    score: r.score,
                })
            })
            .collect();

        all_results.sort_by(|a, b| {
            let priority = |m: &SearchMatchType| match m {
                SearchMatchType::FileName => 0,
                SearchMatchType::DirectoryName => 1,
                SearchMatchType::FullPath => 2,
            };
            priority(&a.match_type)
                .cmp(&priority(&b.match_type))
                .then_with(|| b.score.cmp(&a.score)) // Higher scores first
        });

        all_results.truncate(10);
        Ok(all_results)
    }
}
