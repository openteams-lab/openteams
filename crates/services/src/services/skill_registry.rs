//! Skill Registry Service
//!
//! Provides functionality to fetch and install skills from a remote registry.
//! Also provides built-in skills from the awesome-claude-skills repository.

use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;
use tokio;
use ts_rs::TS;
use uuid::Uuid;

use db::models::chat_skill::{ChatSkill, CreateChatSkill};

/// Default skill registry URL (can be configured)
/// Use local server for development: http://127.0.0.1:3101
/// Production: https://skills.agentschatgroup.com
pub const DEFAULT_REGISTRY_URL: &str = "http://127.0.0.1:3101";

/// Built-in skills data loaded from JSON
static BUILTIN_SKILLS: Lazy<BuiltInSkillsData> = Lazy::new(|| {
    let json_data = include_str!("../../../db/seed/skills_registry.json");
    match serde_json::from_str(json_data) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to load built-in skills: {}", e);
            BuiltInSkillsData {
                generated_at: String::new(),
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
    generated_at: String,
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
    pub async fn search_skills(&self, query: &str) -> Result<Vec<RemoteSkillMeta>, SkillRegistryError> {
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
    pub async fn get_skill_files(&self, id: &str) -> Result<SkillDownloadResponse, SkillRegistryError> {
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

        let files = response.json::<SkillDownloadResponse>().await?;
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

/// Install skill files to local directories (.agents/skills and .claude/skills)
/// Returns the number of files downloaded
pub async fn install_skill_files_to_directory(
    workspace_path: &Path,
    skill_id: &str,
    registry_url: Option<&str>,
) -> Result<usize, SkillInstallError> {
    let client = SkillRegistryClient::new(registry_url.map(String::from));

    // Get file list from registry
    let download_response = client.get_skill_files(skill_id).await
        .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;

    let mut files_downloaded = 0;

    // Create target directories
    let agents_skills_dir = workspace_path.join(".agents").join("skills").join(skill_id);
    let claude_skills_dir = workspace_path.join(".claude").join("skills").join(skill_id);

    tokio::fs::create_dir_all(&agents_skills_dir).await?;
    tokio::fs::create_dir_all(&claude_skills_dir).await?;

    // Download each file
    for file_info in &download_response.files {
        // Download the file
        let content = client.download_file(&file_info.download_url).await
            .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;

        // Save to .agents/skills/{skill_id}/
        let agents_file_path = agents_skills_dir.join(&file_info.path);
        if let Some(parent) = agents_file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&agents_file_path, &content).await
            .map_err(|e| SkillInstallError::SaveFailed(e.to_string()))?;

        // Save to .claude/skills/{skill_id}/
        let claude_file_path = claude_skills_dir.join(&file_info.path);
        if let Some(parent) = claude_file_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&claude_file_path, &content).await
            .map_err(|e| SkillInstallError::SaveFailed(e.to_string()))?;

        files_downloaded += 1;
    }

    Ok(files_downloaded)
}

/// Check if a skill from registry is already installed locally
pub async fn is_skill_installed(pool: &SqlitePool, registry_id: &str) -> Result<bool, SkillRegistryError> {
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
                || skill.tags.iter().any(|tag| tag.to_lowercase().contains(&query_lower))
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
            skill.category
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