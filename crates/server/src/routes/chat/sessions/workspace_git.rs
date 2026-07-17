#[derive(Debug, Deserialize, TS)]
pub struct ValidateWorkspacePathRequest {
    pub workspace_path: String,
}

#[derive(Debug, Serialize, TS)]
pub struct ValidateWorkspacePathResponse {
    pub valid: bool,
    pub is_git_repo: bool,
    pub error: Option<String>,
    pub error_code: Option<WorkspaceGitErrorCode>,
}

#[derive(Debug, Deserialize, TS)]
pub struct InitializeWorkspaceGitRequest {
    pub workspace_path: String,
    #[serde(default)]
    pub gitignore_template: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct InitializeWorkspaceGitResponse {
    pub initialized: bool,
    pub gitignore_template: Option<String>,
    pub status: ValidateWorkspacePathResponse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum WorkspaceGitErrorCode {
    WorkspacePathRequired,
    WorkspacePathInvalid,
    WorkspacePathNotFound,
    WorkspacePathNotDirectory,
    WorkspacePathNotAccessible,
    InvalidGitignoreTemplate,
    GitInitFailed,
    GitignoreWriteFailed,
    GitignoreCommitFailed,
}

impl WorkspaceGitErrorCode {
    fn message(self) -> &'static str {
        match self {
            Self::WorkspacePathRequired => "Workspace path is required.",
            Self::WorkspacePathInvalid => "Workspace path is invalid.",
            Self::WorkspacePathNotFound => "Workspace path does not exist.",
            Self::WorkspacePathNotDirectory => "Workspace path must be an existing directory.",
            Self::WorkspacePathNotAccessible => "Workspace path is not accessible.",
            Self::InvalidGitignoreTemplate => "Selected .gitignore template is not available.",
            Self::GitInitFailed => "Failed to initialize Git repository for this workspace.",
            Self::GitignoreWriteFailed => "Failed to write .gitignore for this workspace.",
            Self::GitignoreCommitFailed => {
                "Failed to commit the generated .gitignore for this workspace."
            }
        }
    }
}

impl std::fmt::Display for WorkspaceGitErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::WorkspacePathRequired => "workspace_path_required",
            Self::WorkspacePathInvalid => "workspace_path_invalid",
            Self::WorkspacePathNotFound => "workspace_path_not_found",
            Self::WorkspacePathNotDirectory => "workspace_path_not_directory",
            Self::WorkspacePathNotAccessible => "workspace_path_not_accessible",
            Self::InvalidGitignoreTemplate => "invalid_gitignore_template",
            Self::GitInitFailed => "git_init_failed",
            Self::GitignoreWriteFailed => "gitignore_write_failed",
            Self::GitignoreCommitFailed => "gitignore_commit_failed",
        };
        f.write_str(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkspaceGitErrorData {
    pub code: WorkspaceGitErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitignoreTemplateSummary {
    pub id: String,
    pub label: String,
    pub group: String,
    pub description: String,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GitignoreTemplatesResponse {
    pub templates: Vec<GitignoreTemplateSummary>,
}

type InitializeWorkspaceGitApiResponse =
    ApiResponse<InitializeWorkspaceGitResponse, WorkspaceGitErrorData>;

fn workspace_git_error(code: WorkspaceGitErrorCode) -> WorkspaceGitErrorData {
    WorkspaceGitErrorData {
        code,
        message: code.message().to_string(),
    }
}

fn workspace_git_bad_request(
    error: WorkspaceGitErrorData,
) -> (StatusCode, ResponseJson<InitializeWorkspaceGitApiResponse>) {
    (
        StatusCode::BAD_REQUEST,
        ResponseJson(ApiResponse::error_with_data(error)),
    )
}

fn workspace_git_success(
    data: InitializeWorkspaceGitResponse,
) -> (StatusCode, ResponseJson<InitializeWorkspaceGitApiResponse>) {
    (StatusCode::OK, ResponseJson(ApiResponse::success(data)))
}

mod gitignore_templates {
    use std::{collections::BTreeSet, path::Path, sync::LazyLock};

    use super::{
        GitignoreTemplateSummary, RustEmbed, WorkspaceGitErrorCode, WorkspaceGitErrorData,
        workspace_git_error,
    };

    #[derive(RustEmbed)]
    #[folder = "../../assets/gitignore-templates"]
    struct GitignoreTemplateAssets;

    const TEMPLATE_PREFIX: &str = "templates/";
    const TEMPLATE_SUFFIX: &str = ".gitignore";
    const OPENTEAMS_IGNORE_ENTRY: &str = ".openteams/";

    #[derive(Debug, Clone)]
    struct GitignoreTemplateRecord {
        summary: GitignoreTemplateSummary,
        asset_path: String,
    }

    static TEMPLATES: LazyLock<Vec<GitignoreTemplateRecord>> = LazyLock::new(load_templates);

    pub fn list_templates() -> Vec<GitignoreTemplateSummary> {
        TEMPLATES
            .iter()
            .map(|record| record.summary.clone())
            .collect()
    }

    pub fn read_template(id: &str) -> Option<String> {
        let record = find_record(id)?;
        let file = GitignoreTemplateAssets::get(&record.asset_path)?;
        Some(String::from_utf8_lossy(file.data.as_ref()).into_owned())
    }

    pub fn normalize_template_selection(
        value: Option<&str>,
    ) -> Result<Option<String>, WorkspaceGitErrorData> {
        let trimmed = value.unwrap_or("none").trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
            return Ok(None);
        }

        find_record(trimmed)
            .map(|record| Some(record.summary.id.clone()))
            .ok_or_else(|| workspace_git_error(WorkspaceGitErrorCode::InvalidGitignoreTemplate))
    }

    pub async fn write_template(
        workspace_path: &Path,
        id: &str,
    ) -> Result<bool, WorkspaceGitErrorData> {
        let body = read_template(id)
            .ok_or_else(|| workspace_git_error(WorkspaceGitErrorCode::InvalidGitignoreTemplate))?;
        let body = with_openteams_ignore_entry(body);

        let gitignore_path = workspace_path.join(".gitignore");
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&gitignore_path)
            .await
        {
            Ok(mut file) => {
                use tokio::io::AsyncWriteExt;
                file.write_all(body.as_bytes()).await.map_err(|_| {
                    workspace_git_error(WorkspaceGitErrorCode::GitignoreWriteFailed)
                })?;
                file.flush().await.map_err(|_| {
                    workspace_git_error(WorkspaceGitErrorCode::GitignoreWriteFailed)
                })?;
                Ok(true)
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
            Err(_) => Err(workspace_git_error(
                WorkspaceGitErrorCode::GitignoreWriteFailed,
            )),
        }
    }

    fn with_openteams_ignore_entry(mut body: String) -> String {
        if body
            .lines()
            .any(|line| line.trim() == OPENTEAMS_IGNORE_ENTRY)
        {
            return body;
        }

        if !body.is_empty() && !body.ends_with('\n') {
            body.push('\n');
        }
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str("# OpenTeams runtime files\n");
        body.push_str(OPENTEAMS_IGNORE_ENTRY);
        body.push('\n');
        body
    }

    fn find_record(id: &str) -> Option<&'static GitignoreTemplateRecord> {
        let normalized = normalize_id(id);
        TEMPLATES
            .iter()
            .find(|record| record.summary.id == normalized)
    }

    fn load_templates() -> Vec<GitignoreTemplateRecord> {
        let mut records = GitignoreTemplateAssets::iter()
            .filter_map(|path| {
                let asset_path = path.replace('\\', "/");
                let relative = asset_path
                    .strip_prefix(TEMPLATE_PREFIX)?
                    .strip_suffix(TEMPLATE_SUFFIX)?;
                let parts = relative.split('/').collect::<Vec<_>>();
                let file_stem = parts.last().copied()?;
                let id = template_id(&parts);
                if id.is_empty() {
                    return None;
                }

                let label = display_label(file_stem);
                let group = template_group(&parts);
                let aliases = template_aliases(&id, &label, &parts);
                let description = template_description(&label, &group);

                Some(GitignoreTemplateRecord {
                    summary: GitignoreTemplateSummary {
                        id,
                        label,
                        group,
                        description,
                        aliases,
                    },
                    asset_path,
                })
            })
            .collect::<Vec<_>>();

        records.sort_by(|left, right| {
            group_rank(&left.summary.group)
                .cmp(&group_rank(&right.summary.group))
                .then_with(|| left.summary.group.cmp(&right.summary.group))
                .then_with(|| {
                    left.summary
                        .label
                        .to_lowercase()
                        .cmp(&right.summary.label.to_lowercase())
                })
                .then_with(|| left.summary.id.cmp(&right.summary.id))
        });
        records
    }

    fn template_id(parts: &[&str]) -> String {
        if parts.len() == 1 {
            normalize_id(parts[0])
        } else {
            parts
                .iter()
                .map(|part| normalize_id(part))
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("-")
        }
    }

    fn template_group(parts: &[&str]) -> String {
        match parts {
            [_file] => "Languages and frameworks".to_string(),
            ["Global", ..] => "Global".to_string(),
            ["community", category, ..] => format!("Community: {}", display_label(category)),
            _ => "Community".to_string(),
        }
    }

    fn template_description(label: &str, group: &str) -> String {
        if group == "Global" {
            format!("Global ignore patterns for {label} local tooling and generated files.")
        } else if group.starts_with("Community:") {
            format!("Community-maintained ignore patterns for {label} projects.")
        } else {
            format!("Ignore patterns for {label} projects.")
        }
    }

    fn template_aliases(id: &str, label: &str, parts: &[&str]) -> Vec<String> {
        let mut aliases = BTreeSet::new();
        aliases.insert(id.to_string());
        aliases.insert(label.to_lowercase());
        for part in parts {
            aliases.insert(part.to_lowercase());
            aliases.insert(normalize_id(part));
        }

        match id {
            "node" => {
                aliases.extend(["nodejs", "javascript", "npm", "yarn", "pnpm"].map(String::from));
            }
            "python" => {
                aliases.extend(["py", "pip", "venv", "virtualenv"].map(String::from));
            }
            "go" => {
                aliases.extend(["golang", "go modules"].map(String::from));
            }
            "visualstudio" => {
                aliases.extend(["visual studio", "csharp", "dotnet"].map(String::from));
            }
            "rust" => {
                aliases.extend(["cargo", "rustlang"].map(String::from));
            }
            _ => {}
        }

        aliases
            .into_iter()
            .filter(|alias| !alias.is_empty())
            .collect()
    }

    fn display_label(value: &str) -> String {
        let mut label = String::new();
        let mut previous: Option<char> = None;

        for ch in value.chars() {
            if matches!(ch, '_' | '-' | '.') {
                push_space(&mut label);
                previous = Some(' ');
                continue;
            }

            if ch.is_uppercase()
                && previous
                    .map(|prev| prev.is_lowercase() || prev.is_ascii_digit())
                    .unwrap_or(false)
            {
                push_space(&mut label);
            }

            label.push(ch);
            previous = Some(ch);
        }

        if label.is_empty() {
            value.to_string()
        } else {
            label
        }
    }

    fn normalize_id(value: &str) -> String {
        let mut normalized = String::new();
        let mut last_was_separator = false;

        for ch in value.chars() {
            if ch.is_ascii_alphanumeric() {
                normalized.push(ch.to_ascii_lowercase());
                last_was_separator = false;
            } else {
                let token = match ch {
                    '+' => Some("plus"),
                    '#' => Some("sharp"),
                    _ => None,
                };

                if let Some(token) = token {
                    if !normalized.is_empty() && !last_was_separator {
                        normalized.push('-');
                    }
                    normalized.push_str(token);
                    last_was_separator = false;
                } else if !normalized.is_empty() && !last_was_separator {
                    normalized.push('-');
                    last_was_separator = true;
                }
            }
        }

        normalized.trim_matches('-').to_string()
    }

    fn push_space(value: &mut String) {
        if !value.ends_with(' ') && !value.is_empty() {
            value.push(' ');
        }
    }

    fn group_rank(group: &str) -> u8 {
        match group {
            "Languages and frameworks" => 0,
            "Global" => 1,
            _ => 2,
        }
    }
}

fn commit_generated_gitignore(workspace_path: &Path) -> Result<(), WorkspaceGitErrorData> {
    let error = || workspace_git_error(WorkspaceGitErrorCode::GitignoreCommitFailed);
    let repo = git2::Repository::open(workspace_path).map_err(|_| error())?;
    let mut index = repo.index().map_err(|_| error())?;
    index
        .add_path(Path::new(".gitignore"))
        .map_err(|_| error())?;
    index.write().map_err(|_| error())?;

    let tree_id = index.write_tree().map_err(|_| error())?;
    let tree = repo.find_tree(tree_id).map_err(|_| error())?;
    let signature = repo
        .signature()
        .or_else(|_| git2::Signature::now("openteams", "noreply@openteams.com"))
        .map_err(|_| error())?;

    let parents = match repo.head() {
        Ok(head) => head
            .target()
            .and_then(|oid| repo.find_commit(oid).ok())
            .map(|commit| vec![commit])
            .unwrap_or_default(),
        Err(err)
            if matches!(
                err.code(),
                git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
            ) =>
        {
            Vec::new()
        }
        Err(_) => return Err(error()),
    };
    let parent_refs = parents.iter().collect::<Vec<_>>();

    repo.commit(
        Some("HEAD"),
        &signature,
        &signature,
        "Add .gitignore",
        &tree,
        &parent_refs,
    )
    .map_err(|_| error())?;

    Ok(())
}

pub(crate) async fn validate_workspace_path_status(
    workspace_path: &str,
) -> ValidateWorkspacePathResponse {
    let trimmed = workspace_path.trim();

    if trimmed.is_empty() {
        let error = workspace_git_error(WorkspaceGitErrorCode::WorkspacePathRequired);
        return ValidateWorkspacePathResponse {
            valid: false,
            is_git_repo: false,
            error: Some(error.message),
            error_code: Some(error.code),
        };
    }

    if let Err(error) = validate_workspace_path_legality_data(trimmed) {
        return ValidateWorkspacePathResponse {
            valid: false,
            is_git_repo: false,
            error: Some(error.message),
            error_code: Some(error.code),
        };
    }

    let parsed_path = PathBuf::from(trimmed);
    match tokio::fs::metadata(&parsed_path).await {
        Ok(metadata) => {
            if metadata.is_dir() {
                ValidateWorkspacePathResponse {
                    valid: true,
                    is_git_repo: git2::Repository::open(&parsed_path).is_ok(),
                    error: None,
                    error_code: None,
                }
            } else {
                let error = workspace_git_error(WorkspaceGitErrorCode::WorkspacePathNotDirectory);
                ValidateWorkspacePathResponse {
                    valid: false,
                    is_git_repo: false,
                    error: Some(error.message),
                    error_code: Some(error.code),
                }
            }
        }
        Err(err) => {
            let error = workspace_path_metadata_error(err);
            ValidateWorkspacePathResponse {
                valid: false,
                is_git_repo: false,
                error: Some(error.message),
                error_code: Some(error.code),
            }
        }
    }
}

pub async fn validate_workspace_path_endpoint(
    Json(payload): Json<ValidateWorkspacePathRequest>,
) -> Result<ResponseJson<ApiResponse<ValidateWorkspacePathResponse>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(
        validate_workspace_path_status(&payload.workspace_path).await,
    )))
}

pub async fn list_gitignore_templates_endpoint()
-> Result<ResponseJson<ApiResponse<GitignoreTemplatesResponse>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(
        GitignoreTemplatesResponse {
            templates: gitignore_templates::list_templates(),
        },
    )))
}

pub async fn initialize_workspace_git_endpoint(
    Json(payload): Json<InitializeWorkspaceGitRequest>,
) -> Result<(StatusCode, ResponseJson<InitializeWorkspaceGitApiResponse>), ApiError> {
    let trimmed = payload.workspace_path.trim();
    let parsed_path = match validate_workspace_path_legality_data(trimmed) {
        Ok(path) => path,
        Err(error) => return Ok(workspace_git_bad_request(error)),
    };
    let metadata = match tokio::fs::metadata(&parsed_path).await {
        Ok(metadata) => metadata,
        Err(err) => {
            return Ok(workspace_git_bad_request(workspace_path_metadata_error(
                err,
            )));
        }
    };
    if !metadata.is_dir() {
        return Ok(workspace_git_bad_request(workspace_git_error(
            WorkspaceGitErrorCode::WorkspacePathNotDirectory,
        )));
    }

    let template = match gitignore_templates::normalize_template_selection(
        payload.gitignore_template.as_deref(),
    ) {
        Ok(template) => template,
        Err(error) => return Ok(workspace_git_bad_request(error)),
    };

    let mut initialized = false;
    if git2::Repository::open(&parsed_path).is_err() {
        if git2::Repository::init(&parsed_path).is_err() {
            return Ok(workspace_git_bad_request(workspace_git_error(
                WorkspaceGitErrorCode::GitInitFailed,
            )));
        }
        initialized = true;
    }

    if let Some(template) = template.as_deref() {
        match gitignore_templates::write_template(&parsed_path, template).await {
            Ok(true) if initialized => {
                if let Err(error) = commit_generated_gitignore(&parsed_path) {
                    return Ok(workspace_git_bad_request(error));
                }
            }
            Ok(_) => {}
            Err(error) => return Ok(workspace_git_bad_request(error)),
        }
    }

    Ok(workspace_git_success(InitializeWorkspaceGitResponse {
        initialized,
        gitignore_template: template,
        status: validate_workspace_path_status(trimmed).await,
    }))
}

