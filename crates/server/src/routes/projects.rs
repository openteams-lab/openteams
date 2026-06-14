use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Json as ResponseJson,
    routing::{get, put},
};
use chrono::NaiveDate;
use db::models::{
    chat_agent::ChatAgent,
    chat_session::{ChatSession, CreateChatSession},
    member_execution_config::MemberExecutionConfig,
    project::{CreateProject, Project, ProjectError, UpdateProject},
    project_member::{ProjectMember, ProjectMemberType},
    project_path::ProjectPath,
    project_repo::CreateProjectRepo,
    project_stats::ProjectStats,
    repo::Repo,
};
use deployment::Deployment;
use executors::executors::BaseCodingAgent;
use serde::{Deserialize, Serialize};
use serde_with::rust::double_option;
use services::services::{
    agent_runtime::{AgentRuntimeReasoningCapability, reasoning_capability_for_runner_type},
    build_stats::project_stats::ProjectStatsService,
    chat::create_session_with_project_members,
    member_execution::parse_runner_type,
    project::{
        ProjectDetail,
        member::{ProjectMemberService, ProjectMemberUpdateInput},
    },
    workflow::workflow_analytics::{self, hash_user_id},
};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default)]
    pub repositories: Vec<CreateProjectRepo>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub default_workspace_path: Option<String>,
    pub active_repo_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
pub struct AddProjectMemberRequest {
    pub member_type: ProjectMemberType,
    pub user_id: Option<String>,
    pub agent_id: Option<Uuid>,
    pub member_name: Option<String>,
    pub role: Option<String>,
    #[serde(default)]
    pub display_order: i64,
    pub default_workspace_path: Option<String>,
    #[serde(default)]
    pub allowed_skill_ids: Vec<String>,
    #[serde(default)]
    pub execution_config: MemberExecutionConfig,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateProjectMemberRequest {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    #[ts(optional, type = "string | null")]
    pub member_name: Option<Option<String>>,
    pub role: Option<String>,
    pub display_order: Option<i64>,
    pub default_workspace_path: Option<String>,
    pub is_default: Option<bool>,
    pub allowed_skill_ids: Option<Vec<String>>,
    pub execution_config: Option<MemberExecutionConfig>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateProjectSessionRequest {
    pub title: Option<String>,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
pub struct ProjectStatsQuery {
    #[ts(type = "string | null")]
    pub period_start: Option<NaiveDate>,
    #[ts(type = "string | null")]
    pub period_end: Option<NaiveDate>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectListResponse {
    pub projects: Vec<Project>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectResponse {
    pub project: Project,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectDetailResponse {
    pub project: Project,
    pub paths: Vec<ProjectPath>,
    pub members: Vec<ProjectMember>,
    pub sessions: Vec<ChatSession>,
    pub repos: Vec<Repo>,
    pub stats: Vec<ProjectStats>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectMemberWithRuntime {
    #[serde(flatten)]
    #[ts(flatten)]
    pub member: ProjectMember,
    pub reasoning_capability: Option<AgentRuntimeReasoningCapability>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectMembersResponse {
    pub members: Vec<ProjectMemberWithRuntime>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectMemberResponse {
    pub member: ProjectMemberWithRuntime,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectSessionsResponse {
    pub sessions: Vec<ChatSession>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectSessionResponse {
    pub session: ChatSession,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectReposResponse {
    pub repos: Vec<Repo>,
}

#[derive(Debug, Serialize, TS)]
pub struct ProjectStatsResponse {
    pub stats: Vec<ProjectStats>,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/projects", get(list_projects).post(create_project))
        .route(
            "/projects/{project_id}",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route(
            "/projects/{project_id}/members",
            get(list_project_members).post(add_project_member),
        )
        .route(
            "/projects/{project_id}/members/{member_id}",
            put(update_project_member).delete(delete_project_member),
        )
        .route(
            "/projects/{project_id}/sessions",
            get(list_project_sessions).post(create_project_session),
        )
        .route("/projects/{project_id}/repos", get(list_project_repos))
        .route("/projects/{project_id}/stats", get(get_project_stats))
}

async fn ensure_project_exists(
    deployment: &DeploymentImpl,
    project_id: Uuid,
) -> Result<(), ApiError> {
    if Project::find_by_id(&deployment.db().pool, project_id)
        .await?
        .is_none()
    {
        return Err(ApiError::Project(ProjectError::ProjectNotFound));
    }

    Ok(())
}

async fn ensure_member_belongs_to_project(
    deployment: &DeploymentImpl,
    project_id: Uuid,
    member_id: Uuid,
) -> Result<(), ApiError> {
    let members = ProjectMemberService::new()
        .list_members(&deployment.db().pool, project_id)
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project member lookup failed: {err}")))?;

    if members.iter().any(|member| member.id == member_id) {
        Ok(())
    } else {
        Err(ApiError::BadRequest("Project member not found".to_string()))
    }
}

async fn project_member_views(
    deployment: &DeploymentImpl,
    members: Vec<ProjectMember>,
) -> Result<Vec<ProjectMemberWithRuntime>, ApiError> {
    let mut views = Vec::with_capacity(members.len());
    for member in members {
        views.push(project_member_view(deployment, member).await?);
    }
    Ok(views)
}

async fn project_member_view(
    deployment: &DeploymentImpl,
    member: ProjectMember,
) -> Result<ProjectMemberWithRuntime, ApiError> {
    let runner = effective_member_runner(deployment, &member).await?;
    let reasoning_capability = runner.and_then(reasoning_capability_for_runner_type);
    Ok(ProjectMemberWithRuntime {
        member,
        reasoning_capability,
    })
}

async fn effective_member_runner(
    deployment: &DeploymentImpl,
    member: &ProjectMember,
) -> Result<Option<BaseCodingAgent>, ApiError> {
    if let Some(runner) = member.execution_config.0.runner_type {
        return Ok(Some(runner));
    }

    let Some(agent_id) = member.agent_id else {
        return Ok(None);
    };
    let Some(agent) = ChatAgent::find_by_id(&deployment.db().pool, agent_id).await? else {
        return Ok(None);
    };

    match parse_runner_type(&agent.runner_type) {
        Ok(runner) => Ok(Some(runner)),
        Err(err) => {
            tracing::warn!(
                agent_id = %agent.id,
                runner_type = %agent.runner_type,
                error = %err,
                "Unable to resolve project member runner type"
            );
            Ok(None)
        }
    }
}

fn create_project_payload(payload: CreateProjectRequest) -> CreateProject {
    CreateProject {
        name: payload.name,
        repositories: payload.repositories,
        description: payload.description,
        status: payload.status,
        default_workspace_path: payload.default_workspace_path,
        active_repo_id: payload.active_repo_id,
    }
}

fn create_project_session_payload(
    project_id: Uuid,
    payload: CreateProjectSessionRequest,
) -> CreateChatSession {
    CreateChatSession {
        title: payload.title,
        workspace_path: payload.workspace_path,
        project_id: Some(project_id),
    }
}

fn stats_period(query: ProjectStatsQuery) -> Result<Option<(NaiveDate, NaiveDate)>, ApiError> {
    match (query.period_start, query.period_end) {
        (Some(start), Some(end)) => Ok(Some((start, end))),
        (None, None) => Ok(None),
        _ => Err(ApiError::BadRequest(
            "period_start and period_end must be provided together".to_string(),
        )),
    }
}

pub async fn list_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let projects = deployment
        .project()
        .list_projects(&deployment.db().pool)
        .await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

pub async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateProjectRequest>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let project = deployment
        .project()
        .create_project(
            &deployment.db().pool,
            deployment.repo(),
            create_project_payload(payload),
            deployment.user_id(),
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(project)))
}

pub async fn get_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<ProjectDetail>>, ApiError> {
    let detail = deployment
        .project()
        .get_project_detail(&deployment.db().pool, project_id)
        .await?;
    Ok(ResponseJson(ApiResponse::success(detail)))
}

pub async fn update_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<UpdateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let project = deployment
        .project()
        .update_project(&deployment.db().pool, project_id, payload)
        .await?;
    Ok(ResponseJson(ApiResponse::success(project)))
}

pub async fn delete_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let rows_affected = deployment
        .project()
        .delete_project(&deployment.db().pool, project_id)
        .await?;

    if rows_affected == 0 {
        return Err(ApiError::Project(ProjectError::ProjectNotFound));
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn list_project_members(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ProjectMemberWithRuntime>>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let members = ProjectMemberService::new()
        .list_members(&deployment.db().pool, project_id)
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project member lookup failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(
        project_member_views(&deployment, members).await?,
    )))
}

pub async fn add_project_member(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<AddProjectMemberRequest>,
) -> Result<ResponseJson<ApiResponse<ProjectMemberWithRuntime>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let member = ProjectMemberService::new()
        .add_member(
            &deployment.db().pool,
            project_id,
            payload.member_type,
            payload.user_id,
            payload.agent_id,
            payload.member_name,
            payload.role,
            payload.display_order,
            payload.default_workspace_path,
            payload.allowed_skill_ids,
            payload.is_default,
            payload.execution_config,
        )
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project member creation failed: {err}")))?;

    Ok(ResponseJson(ApiResponse::success(
        project_member_view(&deployment, member).await?,
    )))
}

pub async fn update_project_member(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, member_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateProjectMemberRequest>,
) -> Result<ResponseJson<ApiResponse<ProjectMemberWithRuntime>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    ensure_member_belongs_to_project(&deployment, project_id, member_id).await?;

    let member = ProjectMemberService::new()
        .update_member(
            &deployment.db().pool,
            member_id,
            ProjectMemberUpdateInput {
                member_name: payload.member_name,
                role: payload.role,
                display_order: payload.display_order,
                default_workspace_path: payload.default_workspace_path,
                is_default: payload.is_default,
                allowed_skill_ids: payload.allowed_skill_ids,
                execution_config: payload.execution_config,
            },
        )
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project member update failed: {err}")))?;

    Ok(ResponseJson(ApiResponse::success(
        project_member_view(&deployment, member).await?,
    )))
}

pub async fn delete_project_member(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, member_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    ensure_member_belongs_to_project(&deployment, project_id, member_id).await?;

    let rows_affected = ProjectMemberService::new()
        .remove_member(&deployment.db().pool, member_id)
        .await
        .map_err(|err| ApiError::BadRequest(format!("Project member delete failed: {err}")))?;

    if rows_affected == 0 {
        return Err(ApiError::BadRequest("Project member not found".to_string()));
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn list_project_sessions(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<ChatSession>>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let sessions = ChatSession::find_by_project(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(sessions)))
}

pub async fn create_project_session(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<CreateProjectSessionRequest>,
) -> Result<ResponseJson<ApiResponse<ChatSession>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;

    let session = create_session_with_project_members(
        &deployment.db().pool,
        &create_project_session_payload(project_id, payload),
        Uuid::new_v4(),
    )
    .await?;

    let user_id_hash = hash_user_id(deployment.user_id());
    workflow_analytics::track_session_created(
        workflow_analytics::analytics_if_enabled(
            deployment.analytics().as_ref(),
            deployment.analytics_enabled(),
        ),
        session.id,
        Some(&user_id_hash),
    );

    let _ = db::models::analytics::AnalyticsSessionStats::upsert(
        &deployment.db().pool,
        session.id,
        None,
    )
    .await;

    Ok(ResponseJson(ApiResponse::success(session)))
}

pub async fn list_project_repos(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<Repo>>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let repos = deployment
        .project()
        .get_repositories(&deployment.db().pool, project_id)
        .await?;
    Ok(ResponseJson(ApiResponse::success(repos)))
}

pub async fn get_project_stats(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Query(query): Query<ProjectStatsQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<ProjectStats>>>, ApiError> {
    ensure_project_exists(&deployment, project_id).await?;
    let service = ProjectStatsService::new();
    let stats = match stats_period(query)? {
        Some((period_start, period_end)) => vec![
            service
                .refresh_stats(&deployment.db().pool, project_id, period_start, period_end)
                .await
                .map_err(|err| {
                    ApiError::BadRequest(format!("Project stats refresh failed: {err}"))
                })?,
        ],
        None => service
            .get_stats(&deployment.db().pool, project_id)
            .await
            .map_err(|err| ApiError::BadRequest(format!("Project stats lookup failed: {err}")))?,
    };

    Ok(ResponseJson(ApiResponse::success(stats)))
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode},
    };
    use chrono::NaiveDate;
    use db::{
        DBService,
        models::{
            chat_agent::{ChatAgent, CreateChatAgent},
            chat_session::{ChatSession, CreateChatSession},
            project::{CreateProject, Project},
            project_path::{ProjectPath, ProjectPathKind},
            project_repo::ProjectRepo,
            project_stats::ProjectStats,
        },
    };
    use serde_json::{Value, json};
    use sqlx::SqlitePool;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::{
        CreateProjectRequest, CreateProjectSessionRequest, ProjectStatsQuery,
        create_project_payload, create_project_session_payload, stats_period,
    };
    use crate::routes::chat;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations for HTTP tests");
        pool
    }

    async fn setup_app() -> (Router, SqlitePool) {
        let pool = setup_pool().await;
        let deployment =
            local_deployment::LocalDeployment::new_for_test_pool(DBService { pool: pool.clone() })
                .await
                .expect("create test deployment");
        let api = Router::new()
            .merge(super::router())
            .merge(chat::router(&deployment));
        let app = Router::new().nest("/api", api).with_state(deployment);
        (app, pool)
    }

    async fn request_json(
        app: &Router,
        method: Method,
        uri: String,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        let request_body = if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            Body::from(serde_json::to_vec(&body).expect("serialize request body"))
        } else {
            Body::empty()
        };
        let response = app
            .clone()
            .oneshot(builder.body(request_body).expect("build request"))
            .await
            .expect("execute request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({}));
        (status, value)
    }

    async fn api_get(app: &Router, uri: impl Into<String>) -> Value {
        let (status, body) = request_json(app, Method::GET, uri.into(), None).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        body
    }

    async fn api_json(app: &Router, method: Method, uri: impl Into<String>, body: Value) -> Value {
        let (status, body) = request_json(app, method, uri.into(), Some(body)).await;
        assert_eq!(status, StatusCode::OK, "response body: {body}");
        body
    }

    fn response_data(body: &Value) -> &Value {
        assert_eq!(body["success"], true, "response body: {body}");
        body.get("data").expect("response data")
    }

    async fn create_project(pool: &SqlitePool, name: &str) -> Project {
        Project::create(
            pool,
            &CreateProject {
                name: name.to_string(),
                repositories: Vec::new(),
                description: None,
                status: Some("active".to_string()),
                default_workspace_path: Some(format!("/{name}/workspace")),
                active_repo_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create project")
    }

    async fn create_agent(pool: &SqlitePool, name: &str) -> ChatAgent {
        ChatAgent::create(
            pool,
            &CreateChatAgent {
                name: name.to_string(),
                runner_type: "codex".to_string(),
                system_prompt: None,
                tools_enabled: None,
                model_name: None,
                owner_project_id: None,
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create chat agent")
    }

    async fn seed_repo(pool: &SqlitePool, project_id: Uuid) -> Uuid {
        let repo_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO repos (id, path, name, display_name)
            VALUES (?1, '/repo', 'repo', 'Repo')
            "#,
        )
        .bind(repo_id)
        .execute(pool)
        .await
        .expect("insert repo");
        ProjectRepo::create(pool, project_id, repo_id)
            .await
            .expect("link repo to project");
        repo_id
    }

    #[test]
    fn create_project_request_defaults_repositories_to_empty() {
        let payload = create_project_payload(CreateProjectRequest {
            name: "Project".to_string(),
            repositories: Vec::new(),
            description: Some("desc".to_string()),
            status: None,
            default_workspace_path: Some("E:/workspace".to_string()),
            active_repo_id: None,
        });

        assert_eq!(payload.name, "Project");
        assert!(payload.repositories.is_empty());
        assert_eq!(
            payload.default_workspace_path.as_deref(),
            Some("E:/workspace")
        );
    }

    #[test]
    fn project_session_request_uses_path_project_id() {
        let project_id = Uuid::new_v4();
        let payload = create_project_session_payload(
            project_id,
            CreateProjectSessionRequest {
                title: Some("Session".to_string()),
                workspace_path: Some("E:/workspace".to_string()),
            },
        );

        assert_eq!(payload.project_id, Some(project_id));
        assert_eq!(payload.title.as_deref(), Some("Session"));
    }

    #[test]
    fn stats_period_requires_start_and_end_together() {
        let start = NaiveDate::from_ymd_opt(2026, 5, 1).expect("valid start date");
        let end = NaiveDate::from_ymd_opt(2026, 5, 31).expect("valid end date");

        assert!(
            stats_period(ProjectStatsQuery {
                period_start: Some(start),
                period_end: Some(end),
            })
            .expect("period is valid")
            .is_some()
        );

        assert!(
            stats_period(ProjectStatsQuery {
                period_start: Some(start),
                period_end: None,
            })
            .is_err()
        );
    }

    #[tokio::test]
    async fn http_project_detail_members_session_and_stats_flow() {
        let (app, pool) = setup_app().await;
        let project = create_project(&pool, "project-a").await;
        let other_project = create_project(&pool, "project-b").await;
        let agent = create_agent(&pool, "Codex").await;
        let repo_id = seed_repo(&pool, project.id).await;
        let period_start = NaiveDate::from_ymd_opt(2026, 5, 1).unwrap();
        let period_end = NaiveDate::from_ymd_opt(2026, 5, 31).unwrap();

        ProjectPath::create(
            &pool,
            project.id,
            "/project-a/workspace".to_string(),
            Some("Workspace".to_string()),
            ProjectPathKind::Workspace,
            true,
        )
        .await
        .expect("create project path");
        ProjectStats::upsert(
            &pool,
            project.id,
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
        .expect("create project stats");

        let add_member_body = api_json(
            &app,
            Method::POST,
            format!("/api/projects/{}/members", project.id),
            json!({
                "member_type": "agent",
                "agent_id": agent.id,
                "role": "agent",
                "display_order": 1,
                "default_workspace_path": "/agent/workspace",
                "allowed_skill_ids": ["shell"],
                "is_default": true
            }),
        )
        .await;
        let member_id = response_data(&add_member_body)["id"]
            .as_str()
            .expect("member id")
            .to_string();

        let members_body = api_get(&app, format!("/api/projects/{}/members", project.id)).await;
        let members = response_data(&members_body)
            .as_array()
            .expect("members array");
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["agent_id"], agent.id.to_string());

        let update_member_body = api_json(
            &app,
            Method::PUT,
            format!("/api/projects/{}/members/{}", project.id, member_id),
            json!({
                "role": "reviewer",
                "display_order": 7,
                "default_workspace_path": "/agent/reviewer",
                "is_default": true,
                "allowed_skill_ids": ["read"]
            }),
        )
        .await;
        let updated_member = response_data(&update_member_body);
        assert_eq!(updated_member["role"], "reviewer");
        assert_eq!(updated_member["display_order"], 7);
        assert_eq!(updated_member["allowed_skill_ids"], json!(["read"]));

        let create_session_body = api_json(
            &app,
            Method::POST,
            format!("/api/projects/{}/sessions", project.id),
            json!({
                "title": "Project session",
                "workspace_path": "/session/workspace"
            }),
        )
        .await;
        let session_id = response_data(&create_session_body)["id"]
            .as_str()
            .expect("session id")
            .to_string();
        assert_eq!(
            response_data(&create_session_body)["project_id"],
            project.id.to_string()
        );

        let session_agent_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chat_session_agents WHERE session_id = ?1 AND agent_id = ?2",
        )
        .bind(Uuid::parse_str(&session_id).expect("parse session id"))
        .bind(agent.id)
        .fetch_one(&pool)
        .await
        .expect("count session agents");
        assert_eq!(session_agent_count, 1);

        ChatSession::create(
            &pool,
            &CreateChatSession {
                title: Some("Other project session".to_string()),
                workspace_path: None,
                project_id: Some(other_project.id),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create other project session");
        let filtered_sessions_body = api_get(
            &app,
            format!("/api/chat/sessions?project_id={}", project.id),
        )
        .await;
        let filtered_sessions = response_data(&filtered_sessions_body)
            .as_array()
            .expect("filtered sessions array");
        assert_eq!(filtered_sessions.len(), 1);
        assert_eq!(filtered_sessions[0]["id"], session_id);
        assert_eq!(filtered_sessions[0]["project_id"], project.id.to_string());

        let detail_body = api_get(&app, format!("/api/projects/{}", project.id)).await;
        let detail = response_data(&detail_body);
        assert_eq!(detail["project"]["id"], project.id.to_string());
        assert_eq!(detail["paths"].as_array().expect("paths").len(), 1);
        assert_eq!(detail["members"].as_array().expect("members").len(), 1);
        assert_eq!(detail["sessions"].as_array().expect("sessions").len(), 1);
        assert_eq!(detail["repos"].as_array().expect("repos").len(), 1);
        assert_eq!(detail["repos"][0]["id"], repo_id.to_string());
        assert_eq!(detail["stats"].as_array().expect("stats").len(), 1);
        assert_eq!(detail["stats"][0]["feature_count"], 1);

        let delete_body = api_json(
            &app,
            Method::DELETE,
            format!("/api/projects/{}/members/{}", project.id, member_id),
            json!({}),
        )
        .await;
        assert_eq!(delete_body["success"], true);
        let members_after_delete =
            api_get(&app, format!("/api/projects/{}/members", project.id)).await;
        assert!(
            response_data(&members_after_delete)
                .as_array()
                .expect("members after delete")
                .is_empty()
        );

        let delete_project_body = api_json(
            &app,
            Method::DELETE,
            format!("/api/projects/{}", project.id),
            json!({}),
        )
        .await;
        assert_eq!(delete_project_body["success"], true);
        let deleted_project = Project::find_by_id(&pool, project.id)
            .await
            .expect("find deleted project");
        assert!(deleted_project.is_none());
    }

    #[tokio::test]
    async fn http_empty_project_stats_returns_zero_row() {
        let (app, pool) = setup_app().await;
        let project = create_project(&pool, "empty-project").await;

        let body = api_get(
            &app,
            format!(
                "/api/projects/{}/stats?period_start=2026-05-01&period_end=2026-05-31",
                project.id
            ),
        )
        .await;
        let stats = response_data(&body).as_array().expect("stats array");

        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0]["feature_count"], 0);
        assert_eq!(stats[0]["bugfix_count"], 0);
        assert_eq!(stats[0]["test_count"], 0);
        assert_eq!(stats[0]["total_tokens"], 0);
        assert_eq!(stats[0]["cost_total"], 0.0);
    }
}
