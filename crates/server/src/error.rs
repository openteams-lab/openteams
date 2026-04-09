use axum::{
    Json,
    extract::multipart::MultipartError,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use db::models::{
    project::ProjectError, project_repo::ProjectRepoError, repo::RepoError, scratch::ScratchError,
};
use deployment::DeploymentError;
use executors::{command::CommandBuildError, executors::ExecutorError};
use git::GitServiceError;
use git2::Error as Git2Error;
use services::services::{
    chat::ChatServiceError,
    chat_runner::ChatRunnerError,
    config::{ConfigError, EditorOpenError},
    container::ContainerError,
    git_host::GitHostError,
    image::ImageError,
    project::ProjectServiceError,
    repo::RepoError as RepoServiceError,
    worktree_manager::WorktreeError,
};
use thiserror::Error;
use utils::response::ApiResponse;

#[derive(Debug, Error, ts_rs::TS)]
#[ts(type = "string")]
pub enum ApiError {
    #[error(transparent)]
    Project(#[from] ProjectError),
    #[error(transparent)]
    Repo(#[from] RepoError),
    #[error(transparent)]
    ScratchError(#[from] ScratchError),
    #[error(transparent)]
    GitService(#[from] GitServiceError),
    #[error(transparent)]
    GitHost(#[from] GitHostError),
    #[error(transparent)]
    Deployment(#[from] DeploymentError),
    #[error(transparent)]
    Container(#[from] ContainerError),
    #[error(transparent)]
    Executor(#[from] ExecutorError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Worktree(#[from] WorktreeError),
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Chat(#[from] ChatServiceError),
    #[error(transparent)]
    ChatRunner(#[from] ChatRunnerError),
    #[error(transparent)]
    Image(#[from] ImageError),
    #[error("Multipart error: {0}")]
    Multipart(#[from] MultipartError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    EditorOpen(#[from] EditorOpenError),
    #[error("Unauthorized")]
    Unauthorized,
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error(transparent)]
    CommandBuilder(#[from] CommandBuildError),
}

impl From<&'static str> for ApiError {
    fn from(msg: &'static str) -> Self {
        ApiError::BadRequest(msg.to_string())
    }
}

impl From<Git2Error> for ApiError {
    fn from(err: Git2Error) -> Self {
        ApiError::GitService(GitServiceError::from(err))
    }
}

struct ErrorInfo {
    status: StatusCode,
    error_type: &'static str,
    message: Option<String>,
}

impl ErrorInfo {
    fn internal(error_type: &'static str) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            error_type,
            message: Some("An internal error occurred. Please try again.".into()),
        }
    }

    fn not_found(error_type: &'static str, msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            error_type,
            message: Some(msg.into()),
        }
    }

    fn bad_request(error_type: &'static str, msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            error_type,
            message: Some(msg.into()),
        }
    }

    fn conflict(error_type: &'static str, msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            error_type,
            message: Some(msg.into()),
        }
    }

    fn with_status(status: StatusCode, error_type: &'static str, msg: impl Into<String>) -> Self {
        Self {
            status,
            error_type,
            message: Some(msg.into()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let info = match &self {
            ApiError::Project(ProjectError::Database(_)) => ErrorInfo::internal("ProjectError"),
            ApiError::Project(ProjectError::ProjectNotFound) => {
                ErrorInfo::not_found("ProjectError", "Project not found.")
            }
            ApiError::Project(ProjectError::CreateFailed(_)) => ErrorInfo::internal("ProjectError"),

            ApiError::Repo(RepoError::Database(_)) => ErrorInfo::internal("RepoError"),
            ApiError::Repo(RepoError::NotFound) => {
                ErrorInfo::not_found("RepoError", "Repository not found.")
            }

            ApiError::ScratchError(ScratchError::Database(_)) => {
                ErrorInfo::internal("ScratchError")
            }
            ApiError::ScratchError(ScratchError::Serde(_)) => {
                ErrorInfo::bad_request("ScratchError", "Invalid scratch data format.")
            }
            ApiError::ScratchError(ScratchError::TypeMismatch { expected, actual }) => {
                ErrorInfo::bad_request(
                    "ScratchError",
                    format!(
                        "Scratch type mismatch: expected '{}' but got '{}'.",
                        expected, actual
                    ),
                )
            }

            ApiError::GitService(git::GitServiceError::MergeConflicts { message, .. }) => {
                ErrorInfo::conflict("GitServiceError", message.clone())
            }
            ApiError::GitService(git::GitServiceError::RebaseInProgress) => ErrorInfo::conflict(
                "GitServiceError",
                "A rebase is already in progress. Resolve conflicts or abort the rebase, then retry.",
            ),
            ApiError::GitService(_) => ErrorInfo::internal("GitServiceError"),
            ApiError::GitHost(_) => ErrorInfo::internal("GitHostError"),

            ApiError::Image(ImageError::InvalidFormat) => ErrorInfo::bad_request(
                "InvalidImageFormat",
                "This file type is not supported. Please upload an image file (PNG, JPG, GIF, WebP, or BMP).",
            ),
            ApiError::Image(ImageError::TooLarge(size, max)) => ErrorInfo::with_status(
                StatusCode::PAYLOAD_TOO_LARGE,
                "ImageTooLarge",
                format!(
                    "This image is too large ({:.1} MB). Maximum file size is {:.1} MB.",
                    *size as f64 / 1_048_576.0,
                    *max as f64 / 1_048_576.0
                ),
            ),
            ApiError::Image(ImageError::NotFound) => {
                ErrorInfo::not_found("ImageNotFound", "Image not found.")
            }
            ApiError::Image(_) => ErrorInfo {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                error_type: "ImageError",
                message: Some("Failed to process image. Please try again.".into()),
            },

            ApiError::EditorOpen(EditorOpenError::LaunchFailed { .. }) => {
                ErrorInfo::internal("EditorLaunchError")
            }
            ApiError::EditorOpen(_) => {
                ErrorInfo::bad_request("EditorOpenError", format!("{}", self))
            }

            ApiError::Unauthorized => ErrorInfo::with_status(
                StatusCode::UNAUTHORIZED,
                "Unauthorized",
                "Unauthorized. Please sign in again.",
            ),
            ApiError::BadRequest(msg) => ErrorInfo::bad_request("BadRequest", msg.clone()),
            ApiError::Conflict(msg) => ErrorInfo::conflict("ConflictError", msg.clone()),
            ApiError::Forbidden(msg) => {
                ErrorInfo::with_status(StatusCode::FORBIDDEN, "ForbiddenError", msg.clone())
            }
            ApiError::Multipart(_) => ErrorInfo::bad_request(
                "MultipartError",
                "Failed to upload file. Please ensure the file is valid and try again.",
            ),

            ApiError::Deployment(_) => ErrorInfo::internal("DeploymentError"),
            ApiError::Container(_) => ErrorInfo::internal("ContainerError"),
            ApiError::Executor(_) => ErrorInfo::internal("ExecutorError"),
            ApiError::CommandBuilder(_) => ErrorInfo::internal("CommandBuildError"),
            ApiError::Database(_) => ErrorInfo::internal("DatabaseError"),
            ApiError::Worktree(_) => ErrorInfo::internal("WorktreeError"),
            ApiError::Config(_) => ErrorInfo::internal("ConfigError"),
            ApiError::Chat(ChatServiceError::Database(_)) => {
                ErrorInfo::internal("ChatServiceError")
            }
            ApiError::Chat(ChatServiceError::SessionNotFound) => {
                ErrorInfo::not_found("ChatServiceError", "Chat session not found.")
            }
            ApiError::Chat(ChatServiceError::SessionArchived) => {
                ErrorInfo::conflict("ChatServiceError", "Chat session is archived.")
            }
            ApiError::Chat(ChatServiceError::Validation(msg)) => {
                ErrorInfo::bad_request("ChatServiceError", msg.clone())
            }
            ApiError::Chat(ChatServiceError::Io(_)) => ErrorInfo::internal("ChatServiceError"),
            ApiError::ChatRunner(ChatRunnerError::AgentNotFound(_)) => {
                ErrorInfo::not_found("ChatRunnerError", "Chat agent not found.")
            }
            ApiError::ChatRunner(ChatRunnerError::UnknownRunnerType(_)) => {
                ErrorInfo::bad_request("ChatRunnerError", "Unknown runner type.")
            }
            ApiError::ChatRunner(_) => ErrorInfo::internal("ChatRunnerError"),
            ApiError::Io(_) => ErrorInfo::internal("IoError"),
        };

        let message = info
            .message
            .unwrap_or_else(|| format!("{}: {}", info.error_type, self));
        let response = ApiResponse::<()>::error(&message);
        (info.status, Json(response)).into_response()
    }
}

impl From<ProjectServiceError> for ApiError {
    fn from(err: ProjectServiceError) -> Self {
        match err {
            ProjectServiceError::Database(db_err) => ApiError::Database(db_err),
            ProjectServiceError::Io(io_err) => ApiError::Io(io_err),
            ProjectServiceError::Project(proj_err) => ApiError::Project(proj_err),
            ProjectServiceError::PathNotFound(path) => {
                ApiError::BadRequest(format!("Path does not exist: {}", path.display()))
            }
            ProjectServiceError::PathNotDirectory(path) => {
                ApiError::BadRequest(format!("Path is not a directory: {}", path.display()))
            }
            ProjectServiceError::NotGitRepository(path) => {
                ApiError::BadRequest(format!("Path is not a git repository: {}", path.display()))
            }
            ProjectServiceError::DuplicateGitRepoPath => ApiError::Conflict(
                "A project with this git repository path already exists".to_string(),
            ),
            ProjectServiceError::DuplicateRepositoryName => ApiError::Conflict(
                "A repository with this name already exists in the project".to_string(),
            ),
            ProjectServiceError::RepositoryNotFound => {
                ApiError::BadRequest("Repository not found".to_string())
            }
            ProjectServiceError::GitError(msg) => {
                ApiError::BadRequest(format!("Git operation failed: {}", msg))
            }
        }
    }
}

impl From<RepoServiceError> for ApiError {
    fn from(err: RepoServiceError) -> Self {
        match err {
            RepoServiceError::Database(db_err) => ApiError::Database(db_err),
            RepoServiceError::Io(io_err) => ApiError::Io(io_err),
            RepoServiceError::PathNotFound(path) => {
                ApiError::BadRequest(format!("Path does not exist: {}", path.display()))
            }
            RepoServiceError::PathNotDirectory(path) => {
                ApiError::BadRequest(format!("Path is not a directory: {}", path.display()))
            }
            RepoServiceError::NotGitRepository(path) => {
                ApiError::BadRequest(format!("Path is not a git repository: {}", path.display()))
            }
            RepoServiceError::NotFound => ApiError::BadRequest("Repository not found".to_string()),
            RepoServiceError::DirectoryAlreadyExists(path) => {
                ApiError::BadRequest(format!("Directory already exists: {}", path.display()))
            }
            RepoServiceError::Git(git_err) => {
                ApiError::BadRequest(format!("Git error: {}", git_err))
            }
            RepoServiceError::InvalidFolderName(name) => {
                ApiError::BadRequest(format!("Invalid folder name: {}", name))
            }
        }
    }
}

impl From<ProjectRepoError> for ApiError {
    fn from(err: ProjectRepoError) -> Self {
        match err {
            ProjectRepoError::Database(db_err) => ApiError::Database(db_err),
            ProjectRepoError::NotFound => {
                ApiError::BadRequest("Repository not found in project".to_string())
            }
            ProjectRepoError::AlreadyExists => {
                ApiError::Conflict("Repository already exists in project".to_string())
            }
        }
    }
}
