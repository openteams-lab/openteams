//! Skill Registry Service
//!
//! Provides functionality to fetch and install skills from a remote registry.
//! Also provides built-in skills from the awesome-claude-skills repository.

use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use db::models::chat_skill::{ChatSkill, CreateChatSkill};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

/// Default skill registry URL (can be configured)
/// Use local server for development: http://127.0.0.1:3101
/// Production: https://skills.agentschatgroup.com
pub const DEFAULT_REGISTRY_URL: &str = "http://127.0.0.1:3101";
const GLOBAL_SKILLS_DIR: &str = ".agents";

/// Built-in skills data loaded from JSON
static BUILTIN_SKILLS: Lazy<BuiltInSkillsData> = Lazy::new(|| {
    let json_data = include_str!("../../../db/seed/skills_registry.json");
    match serde_json::from_str(json_data) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to load built-in skills: {}", e);
            BuiltInSkillsData {
                _generated_at: String::new(),
                total_skills: 0,
                categories: Vec::new(),
                skills: Vec::new(),
            }
        }
    }
});

/// Skill index for fast lookup by ID
static SKILL_INDEX: Lazy<HashMap<String, usize>> = Lazy::new(|| {
    BUILTIN_SKILLS
        .skills
        .iter()
        .enumerate()
        .map(|(i, skill)| (skill.id.clone(), i))
        .collect()
});

/// Built-in skills data structure
#[derive(Debug, Clone, Deserialize)]
struct BuiltInSkillsData {
    #[serde(rename = "generated_at")]
    _generated_at: String,
    total_skills: usize,
    categories: Vec<String>,
    skills: Vec<RemoteSkillPackage>,
}

/// Skill metadata from remote registry
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteSkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub version: String,
    pub author: Option<String>,
    #[ts(type = "string[]")]
    pub tags: Vec<String>,
    #[ts(type = "string[]")]
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
}

/// Full skill package from remote registry
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RemoteSkillPackage {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub version: String,
    pub author: Option<String>,
    pub tags: Vec<String>,
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
    pub content: String,
}

/// Skill package without content (for listing)
impl From<RemoteSkillPackage> for RemoteSkillMeta {
    fn from(pkg: RemoteSkillPackage) -> Self {
        Self {
            id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            category: pkg.category,
            version: pkg.version,
            author: pkg.author,
            tags: pkg.tags,
            compatible_agents: pkg.compatible_agents,
            source_url: pkg.source_url,
        }
    }
}

impl RemoteSkillPackage {
    /// Get metadata without content
    pub fn to_meta(&self) -> RemoteSkillMeta {
        RemoteSkillMeta {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            category: self.category.clone(),
            version: self.version.clone(),
            author: self.author.clone(),
            tags: self.tags.clone(),
            compatible_agents: self.compatible_agents.clone(),
            source_url: self.source_url.clone(),
        }
    }
}

/// Skill registry category
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillCategory {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// Skill file info from download API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileInfo {
    pub path: String,
    pub download_url: String,
}

/// Skill download response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDownloadResponse {
    pub skill_id: String,
    pub files: Vec<SkillFileInfo>,
}

/// Error for skill file download/install
#[derive(Debug, Error)]
pub enum SkillInstallError {
    #[error("Failed to download skill files: {0}")]
    DownloadFailed(String),
    #[error("Failed to save skill file: {0}")]
    SaveFailed(String),
    #[error("Unable to locate user home directory")]
    HomeDirNotFound,
    #[error("Invalid skill file path: {0}")]
    InvalidPath(String),
    #[error("Failed to delete skill file or directory: {0}")]
    DeleteFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum SkillRegistryError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Skill not found: {0}")]
    SkillNotFound(String),
    #[error("Invalid skill data: {0}")]
    InvalidData(String),
}

/// Skill Registry client for fetching skills from a remote service
pub struct SkillRegistryClient {
    client: Client,
    base_url: String,
}

impl SkillRegistryClient {
    pub fn new(base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string()),
        }
    }

    /// List all available skills from the registry
    pub async fn list_skills(&self) -> Result<Vec<RemoteSkillMeta>, SkillRegistryError> {
        let url = format!("{}/api/skills", self.base_url);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to fetch skills: status {}",
                response.status()
            )));
        }

        let skills = response.json::<Vec<RemoteSkillMeta>>().await?;
        Ok(skills)
    }

    /// Get a specific skill by ID
    pub async fn get_skill(&self, id: &str) -> Result<RemoteSkillPackage, SkillRegistryError> {
        let url = format!("{}/api/skills/{}", self.base_url, id);
        let response = self.client.get(&url).send().await?;

        if response.status() == 404 {
            return Err(SkillRegistryError::SkillNotFound(id.to_string()));
        }

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to fetch skill: status {}",
                response.status()
            )));
        }

        let skill = response.json::<RemoteSkillPackage>().await?;
        Ok(skill)
    }

    /// List available categories
    pub async fn list_categories(&self) -> Result<Vec<SkillCategory>, SkillRegistryError> {
        let url = format!("{}/api/categories", self.base_url);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to fetch categories: status {}",
                response.status()
            )));
        }

        let categories = response.json::<Vec<SkillCategory>>().await?;
        Ok(categories)
    }

    /// Search skills by query
    pub async fn search_skills(
        &self,
        query: &str,
    ) -> Result<Vec<RemoteSkillMeta>, SkillRegistryError> {
        let url = format!("{}/api/skills?search={}", self.base_url, query);
        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to search skills: status {}",
                response.status()
            )));
        }

        let skills = response.json::<Vec<RemoteSkillMeta>>().await?;
        Ok(skills)
    }

    /// Get skill files list (download info) from the registry
    pub async fn get_skill_files(
        &self,
        id: &str,
    ) -> Result<SkillDownloadResponse, SkillRegistryError> {
        let url = format!("{}/api/download/{}/files", self.base_url, id);
        let response = self.client.get(&url).send().await?;

        if response.status() == 404 {
            return Err(SkillRegistryError::SkillNotFound(id.to_string()));
        }

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to fetch skill files: status {}",
                response.status()
            )));
        }

        let mut files = response.json::<SkillDownloadResponse>().await?;
        for file in &mut files.files {
            file.download_url = self.resolve_download_url(&file.download_url);
        }
        Ok(files)
    }

    /// Download a single file from the registry
    pub async fn download_file(&self, url: &str) -> Result<Vec<u8>, SkillRegistryError> {
        let response = self.client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to download file: status {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await?.to_vec();
        Ok(bytes)
    }

    fn resolve_download_url(&self, download_url: &str) -> String {
        if download_url.starts_with("http://") || download_url.starts_with("https://") {
            return download_url.to_string();
        }

        let base = self.base_url.trim_end_matches('/');
        if download_url.starts_with('/') {
            format!("{base}{download_url}")
        } else {
            format!("{base}/{download_url}")
        }
    }
}

/// Install a remote skill to the local database
pub async fn install_skill_from_registry(
    pool: &SqlitePool,
    skill: &RemoteSkillPackage,
) -> Result<ChatSkill, SkillRegistryError> {
    let create_data = CreateChatSkill {
        name: skill.name.clone(),
        description: Some(skill.description.clone()),
        content: skill.content.clone(),
        trigger_type: Some("always".to_string()),
        trigger_keywords: None,
        enabled: Some(true),
        source: Some("registry".to_string()),
        source_url: skill.source_url.clone(),
        version: Some(skill.version.clone()),
        author: skill.author.clone(),
        tags: Some(skill.tags.clone()),
        category: skill.category.clone(),
        compatible_agents: Some(skill.compatible_agents.clone()),
    };

    let installed = ChatSkill::create(pool, &create_data, Uuid::new_v4()).await?;
    Ok(installed)
}

/// Install skill files from registry into global user directories:
/// - ~/.agents/skills/{skill_id}
/// - ~/.claude/skills/{skill_id}
/// - ~/.github/skills/{skill_id}
/// - ~/.cursor/skills/{skill_id}
/// - ~/.qwen/skills/{skill_id}
/// - ~/.opencode/skills/{skill_id}
/// - ~/.gemini/skills/{skill_id}
/// - ~/.factory/skills/{skill_id}
///
/// Returns the number of downloaded source files.
pub async fn install_skill_files_to_global_directory(
    skill_id: &str,
    registry_url: Option<&str>,
) -> Result<usize, SkillInstallError> {
    let client = SkillRegistryClient::new(registry_url.map(String::from));

    // Get file list from registry
    let download_response = client
        .get_skill_files(skill_id)
        .await
        .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;
    if download_response.files.is_empty() {
        return Err(SkillInstallError::DownloadFailed(format!(
            "Registry returned zero files for skill: {skill_id}"
        )));
    }

    let home_dir = resolve_home_dir()?;
    let target_roots = global_skill_roots(&home_dir, skill_id);

    for root in &target_roots {
        tokio::fs::create_dir_all(root).await?;
    }

    let mut files_downloaded = 0;
    // Download each file
    for file_info in &download_response.files {
        let relative_path = sanitize_skill_relative_path(&file_info.path)?;

        // Download the file
        let content = client
            .download_file(&file_info.download_url)
            .await
            .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;

        for root in &target_roots {
            let file_path = root.join(&relative_path);
            if let Some(parent) = file_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&file_path, &content)
                .await
                .map_err(|e| SkillInstallError::SaveFailed(e.to_string()))?;
        }

        files_downloaded += 1;
    }

    Ok(files_downloaded)
}

/// Remove installed skill files from global user directories.
/// Missing paths are ignored.
pub async fn uninstall_skill_files_from_global_directory(
    skill: &ChatSkill,
) -> Result<(), SkillInstallError> {
    let home_dir = resolve_home_dir()?;
    let base_roots = global_skill_base_roots(&home_dir);
    let mut target_dirs = HashSet::new();

    for identifier in skill_uninstall_identifiers(skill) {
        let relative = sanitize_skill_relative_path(&identifier)?;
        for root in &base_roots {
            target_dirs.insert(root.join(&relative));
        }
    }

    for dir in target_dirs {
        match tokio::fs::remove_dir_all(&dir).await {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                return Err(SkillInstallError::DeleteFailed(format!(
                    "{} ({})",
                    dir.display(),
                    err
                )));
            }
        }
    }

    // Claude slash-command file generated by native installer.
    let command_file = home_dir
        .join(".claude")
        .join("commands")
        .join(format!("{}.md", slugify_skill_name(&skill.name)));
    match tokio::fs::remove_file(&command_file).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(SkillInstallError::DeleteFailed(format!(
                "{} ({})",
                command_file.display(),
                err
            )));
        }
    }

    Ok(())
}

fn resolve_home_dir() -> Result<PathBuf, SkillInstallError> {
    dirs::home_dir().ok_or(SkillInstallError::HomeDirNotFound)
}

fn global_skill_roots(home_dir: &Path, skill_id: &str) -> Vec<PathBuf> {
    global_skill_base_roots(home_dir)
        .into_iter()
        .map(|root| root.join(skill_id))
        .collect()
}

fn global_skill_base_roots(home_dir: &Path) -> Vec<PathBuf> {
    let mut roots = vec![home_dir.join(GLOBAL_SKILLS_DIR).join("skills")];
    for companion in [
        ".claude",
        ".github",
        ".cursor",
        ".qwen",
        ".opencode",
        ".gemini",
        ".factory",
    ] {
        roots.push(home_dir.join(companion).join("skills"));
    }
    roots
}

fn slugify_skill_name(name: &str) -> String {
    name.to_lowercase().replace(' ', "-")
}

fn skill_uninstall_identifiers(skill: &ChatSkill) -> Vec<String> {
    let mut ids = vec![slugify_skill_name(&skill.name)];

    if skill.source.eq_ignore_ascii_case("registry")
        && let Some(url) = skill.source_url.as_deref()
    {
        let candidate = url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or_default();
        if !candidate.is_empty() && !candidate.contains('/') && !candidate.contains('\\') {
            ids.push(candidate.to_string());
        }
    }

    ids.sort();
    ids.dedup();
    ids
}

fn sanitize_skill_relative_path(path: &str) -> Result<PathBuf, SkillInstallError> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(SkillInstallError::InvalidPath(path.to_string()));
    }

    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => continue,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(SkillInstallError::InvalidPath(path.to_string()));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(SkillInstallError::InvalidPath(path.to_string()));
    }

    Ok(clean)
}

/// Check if a skill from registry is already installed locally
pub async fn is_skill_installed(
    pool: &SqlitePool,
    registry_id: &str,
) -> Result<bool, SkillRegistryError> {
    let skills = ChatSkill::find_by_source(pool, "registry").await?;

    // Check if any skill has a source_url matching this registry_id
    Ok(skills.iter().any(|s| {
        s.source_url
            .as_ref()
            .map(|url| url.ends_with(&format!("/{}", registry_id)))
            .unwrap_or(false)
    }))
}

// ============================================================
// Built-in Skills Functions (from awesome-claude-skills)
// ============================================================

/// List all built-in skills (without full content)
pub fn list_builtin_skills() -> Vec<RemoteSkillMeta> {
    BUILTIN_SKILLS.skills.iter().map(|s| s.to_meta()).collect()
}

/// Get total count of built-in skills
pub fn builtin_skills_count() -> usize {
    BUILTIN_SKILLS.total_skills
}

/// Get a specific built-in skill by ID (with full content)
pub fn get_builtin_skill(id: &str) -> Option<RemoteSkillPackage> {
    SKILL_INDEX
        .get(id)
        .and_then(|&idx| BUILTIN_SKILLS.skills.get(idx).cloned())
}

/// Search built-in skills by name or description
pub fn search_builtin_skills(query: &str) -> Vec<RemoteSkillMeta> {
    let query_lower = query.to_lowercase();
    BUILTIN_SKILLS
        .skills
        .iter()
        .filter(|skill| {
            skill.name.to_lowercase().contains(&query_lower)
                || skill.description.to_lowercase().contains(&query_lower)
                || skill
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase().contains(&query_lower))
        })
        .map(|s| s.to_meta())
        .collect()
}

/// Filter built-in skills by category
pub fn filter_builtin_skills_by_category(category: &str) -> Vec<RemoteSkillMeta> {
    BUILTIN_SKILLS
        .skills
        .iter()
        .filter(|skill| {
            skill
                .category
                .as_ref()
                .map(|c| c.eq_ignore_ascii_case(category))
                .unwrap_or(false)
        })
        .map(|s| s.to_meta())
        .collect()
}

/// Filter built-in skills by compatible agent
pub fn filter_builtin_skills_by_agent(agent: &str) -> Vec<RemoteSkillMeta> {
    BUILTIN_SKILLS
        .skills
        .iter()
        .filter(|skill| {
            skill
                .compatible_agents
                .iter()
                .any(|a| a.eq_ignore_ascii_case(agent))
        })
        .map(|s| s.to_meta())
        .collect()
}

/// Get all available categories
pub fn get_builtin_categories() -> Vec<String> {
    BUILTIN_SKILLS.categories.clone()
}

/// Install a built-in skill by ID to the local database
pub async fn install_builtin_skill(
    pool: &SqlitePool,
    skill_id: &str,
) -> Result<ChatSkill, SkillRegistryError> {
    let skill = get_builtin_skill(skill_id)
        .ok_or_else(|| SkillRegistryError::SkillNotFound(skill_id.to_string()))?;

    install_skill_from_registry(pool, &skill).await
}
