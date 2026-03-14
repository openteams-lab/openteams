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
/// Production: https://skills.openteams.com
pub const DEFAULT_REGISTRY_URL: &str = "http://127.0.0.1:3101";
const GLOBAL_SKILLS_DIR: &str = ".agents";

/// Built-in skills data loaded from JSON
static BUILTIN_SKILLS: Lazy<BuiltInSkillsData> = Lazy::new(|| {
    let json_data = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../skill-registry-server/seed/skills_registry.json"
    ));
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

static DISCOVERED_SKILL_SYNC_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

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
    #[serde(default)]
    #[ts(type = "string[]")]
    pub tags: Vec<String>,
    #[serde(default)]
    #[ts(type = "string[]")]
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
    /// Download count from skills.sh registry
    pub download_count: Option<i64>,
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
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub compatible_agents: Vec<String>,
    pub source_url: Option<String>,
    pub content: String,
    /// Download count from skills.sh registry
    pub download_count: Option<i64>,
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
            download_count: pkg.download_count,
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
            download_count: self.download_count,
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

#[derive(Clone, Copy)]
struct DiscoveryRoot {
    folder: &'static str,
    agent_hint: Option<&'static str>,
}

const DISCOVERY_ROOTS: [DiscoveryRoot; 8] = [
    DiscoveryRoot {
        folder: GLOBAL_SKILLS_DIR,
        agent_hint: None,
    },
    DiscoveryRoot {
        folder: ".claude",
        agent_hint: Some("claude"),
    },
    DiscoveryRoot {
        folder: ".github",
        agent_hint: Some("copilot"),
    },
    DiscoveryRoot {
        folder: ".cursor",
        agent_hint: Some("cursor"),
    },
    DiscoveryRoot {
        folder: ".qwen",
        agent_hint: Some("qwen"),
    },
    DiscoveryRoot {
        folder: ".opencode",
        agent_hint: Some("opencode"),
    },
    DiscoveryRoot {
        folder: ".gemini",
        agent_hint: Some("gemini"),
    },
    DiscoveryRoot {
        folder: ".factory",
        agent_hint: Some("droid"),
    },
];

#[derive(Debug, Default)]
struct ParsedSkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
    version: Option<String>,
    author: Option<String>,
    tags: Vec<String>,
    category: Option<String>,
    compatible_agents: Vec<String>,
    source_url: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedSkillMarkdown {
    name: String,
    description: String,
    content: String,
    version: Option<String>,
    author: Option<String>,
    tags: Vec<String>,
    category: Option<String>,
    compatible_agents: Vec<String>,
    source_url: Option<String>,
}

#[derive(Debug, Default)]
struct DiscoveredSkillDraft {
    name: String,
    description: String,
    content: String,
    version: Option<String>,
    author: Option<String>,
    tags: HashSet<String>,
    category: Option<String>,
    compatible_agents: HashSet<String>,
    source_url: Option<String>,
}

impl DiscoveredSkillDraft {
    fn from_parsed(parsed: ParsedSkillMarkdown) -> Self {
        Self {
            name: parsed.name,
            description: parsed.description,
            content: parsed.content,
            version: parsed.version,
            author: parsed.author,
            tags: parsed.tags.into_iter().collect(),
            category: parsed.category,
            compatible_agents: parsed.compatible_agents.into_iter().collect(),
            source_url: parsed.source_url,
        }
    }

    fn merge(&mut self, other: Self) {
        if self.name.is_empty() {
            self.name = other.name;
        }
        if self.description.is_empty() && !other.description.is_empty() {
            self.description = other.description;
        }
        if self.content.is_empty() && !other.content.is_empty() {
            self.content = other.content;
        }
        if self.version.is_none() {
            self.version = other.version;
        }
        if self.author.is_none() {
            self.author = other.author;
        }
        if self.category.is_none() {
            self.category = other.category;
        }
        if self.source_url.is_none() {
            self.source_url = other.source_url;
        }
        self.tags.extend(other.tags);
        self.compatible_agents.extend(other.compatible_agents);
    }

    fn into_create_data(self) -> CreateChatSkill {
        let mut tags = self.tags.into_iter().collect::<Vec<_>>();
        tags.sort();
        let mut compatible_agents = self.compatible_agents.into_iter().collect::<Vec<_>>();
        compatible_agents.sort();

        CreateChatSkill {
            name: self.name,
            description: (!self.description.is_empty()).then_some(self.description),
            content: self.content,
            trigger_type: Some("always".to_string()),
            trigger_keywords: None,
            enabled: Some(false),
            source: Some("local".to_string()),
            source_url: self.source_url,
            version: self.version,
            author: self.author,
            tags: Some(tags),
            category: self.category,
            compatible_agents: Some(compatible_agents),
            download_count: Some(0),
        }
    }
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
        download_count: skill.download_count,
    };

    let installed = ChatSkill::create(pool, &create_data, Uuid::new_v4()).await?;
    Ok(installed)
}

/// Discover skills already present under agent home directories and add any missing
/// entries to `chat_skills`. Discovered skills are synced as disabled by default.
pub async fn sync_discovered_global_skills(pool: &SqlitePool) -> Result<usize, SkillRegistryError> {
    let _guard = DISCOVERED_SKILL_SYNC_LOCK.lock().await;
    let home_dir = match resolve_home_dir() {
        Ok(path) => path,
        Err(SkillInstallError::HomeDirNotFound) => return Ok(0),
        Err(err) => {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to resolve home directory: {}",
                err
            )));
        }
    };

    let existing_skills = ChatSkill::find_all(pool).await?;
    let mut existing_by_slug = existing_skills
        .iter()
        .map(|skill| (slugify_skill_name(&skill.name), skill.id))
        .collect::<HashMap<_, _>>();

    let discovered = discover_global_skills(&home_dir).await;
    let mut synced_count = 0;

    for (_, skill) in discovered {
        let slug = slugify_skill_name(&skill.name);
        if existing_by_slug.contains_key(&slug) {
            continue;
        }

        let created = ChatSkill::create(pool, &skill.into_create_data(), Uuid::new_v4()).await?;
        existing_by_slug.insert(slug, created.id);
        synced_count += 1;
    }

    Ok(synced_count)
}

async fn discover_global_skills(home_dir: &Path) -> HashMap<String, DiscoveredSkillDraft> {
    let mut discovered: HashMap<String, DiscoveredSkillDraft> = HashMap::new();

    for root in discovery_root_paths(home_dir) {
        let mut entries = match tokio::fs::read_dir(&root.path).await {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                tracing::warn!(
                    path = %root.path.display(),
                    error = %err,
                    "Failed to scan skill discovery root"
                );
                continue;
            }
        };

        loop {
            match entries.next_entry().await {
                Ok(Some(entry)) => {
                    let file_type = match entry.file_type().await {
                        Ok(file_type) => file_type,
                        Err(err) => {
                            tracing::warn!(
                                path = %entry.path().display(),
                                error = %err,
                                "Failed to inspect discovered skill entry"
                            );
                            continue;
                        }
                    };

                    if !file_type.is_dir() {
                        continue;
                    }

                    let dir_name = entry.file_name().to_string_lossy().trim().to_string();
                    if dir_name.is_empty() {
                        continue;
                    }

                    let skill_dir = entry.path();
                    let parsed =
                        match load_discovered_skill(&skill_dir, &dir_name, root.agent_hint).await {
                            Ok(Some(parsed)) => parsed,
                            Ok(None) => continue,
                            Err(err) => {
                                tracing::warn!(
                                    path = %skill_dir.display(),
                                    error = %err,
                                    "Failed to parse discovered skill directory"
                                );
                                continue;
                            }
                        };

                    let key = slugify_skill_name(&parsed.name);
                    if let Some(existing) = discovered.get_mut(&key) {
                        existing.merge(parsed);
                    } else {
                        discovered.insert(key, parsed);
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    tracing::warn!(
                        path = %root.path.display(),
                        error = %err,
                        "Failed while iterating discovered skill root"
                    );
                    break;
                }
            }
        }
    }

    discovered.retain(|_, skill| !skill.name.trim().is_empty());
    discovered
}

async fn load_discovered_skill(
    skill_dir: &Path,
    dir_name: &str,
    agent_hint: Option<&'static str>,
) -> Result<Option<DiscoveredSkillDraft>, SkillRegistryError> {
    let skill_file = skill_dir.join("SKILL.md");
    let metadata = match tokio::fs::metadata(&skill_file).await {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => {
            return Err(SkillRegistryError::InvalidData(format!(
                "Failed to stat {}: {}",
                skill_file.display(),
                err
            )));
        }
    };

    if !metadata.is_file() {
        return Ok(None);
    }

    let raw = tokio::fs::read_to_string(&skill_file)
        .await
        .map_err(|err| {
            SkillRegistryError::InvalidData(format!(
                "Failed to read {}: {}",
                skill_file.display(),
                err
            ))
        })?;
    let parsed = parse_discovered_skill_markdown(dir_name, &raw);
    let mut draft = DiscoveredSkillDraft::from_parsed(parsed);
    if let Some(agent) = agent_hint {
        draft.compatible_agents.insert(agent.to_string());
    }

    Ok(Some(draft))
}

/// Install skill files from registry into global user directories:
/// - ~/.agents/skills/{skill_name}
/// - ~/.claude/skills/{skill_name}
/// - ~/.github/skills/{skill_name}
/// - ~/.cursor/skills/{skill_name}
/// - ~/.qwen/skills/{skill_name}
/// - ~/.opencode/skills/{skill_name}
/// - ~/.gemini/skills/{skill_name}
/// - ~/.factory/skills/{skill_name}
///
/// Returns the number of downloaded source files.
pub async fn install_skill_files_to_global_directory(
    skill: &RemoteSkillPackage,
    registry_url: Option<&str>,
) -> Result<usize, SkillInstallError> {
    let client = SkillRegistryClient::new(registry_url.map(String::from));

    // Get file list from registry
    let download_response = client
        .get_skill_files(&skill.id)
        .await
        .map_err(|e| SkillInstallError::DownloadFailed(e.to_string()))?;
    if download_response.files.is_empty() {
        return Err(SkillInstallError::DownloadFailed(format!(
            "Registry returned zero files for skill: {}",
            skill.id
        )));
    }

    let home_dir = resolve_home_dir()?;
    let target_roots = global_skill_roots(&home_dir, &skill.name);

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

fn global_skill_roots(home_dir: &Path, skill_name: &str) -> Vec<PathBuf> {
    let install_dir_name = slugify_skill_name(skill_name);
    global_skill_base_roots(home_dir)
        .into_iter()
        .map(|root| root.join(&install_dir_name))
        .collect()
}

fn global_skill_base_roots(home_dir: &Path) -> Vec<PathBuf> {
    discovery_root_paths(home_dir)
        .into_iter()
        .map(|root| root.path)
        .collect()
}

fn slugify_skill_name(name: &str) -> String {
    name.to_lowercase().replace(' ', "-")
}

struct DiscoveryRootPath {
    path: PathBuf,
    agent_hint: Option<&'static str>,
}

fn discovery_root_paths(home_dir: &Path) -> Vec<DiscoveryRootPath> {
    DISCOVERY_ROOTS
        .iter()
        .map(|root| DiscoveryRootPath {
            path: home_dir.join(root.folder).join("skills"),
            agent_hint: root.agent_hint,
        })
        .collect()
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

fn parse_discovered_skill_markdown(dir_name: &str, raw: &str) -> ParsedSkillMarkdown {
    let normalized = raw.replace("\r\n", "\n");
    let (frontmatter, body) = split_skill_frontmatter(&normalized);
    let frontmatter = frontmatter
        .and_then(parse_skill_frontmatter)
        .unwrap_or_default();
    let (heading, description_from_body, body_content) = strip_skill_title_and_description(body);

    let name = frontmatter
        .name
        .unwrap_or_else(|| heading.unwrap_or_else(|| dir_name.to_string()));
    let description = frontmatter
        .description
        .unwrap_or_else(|| description_from_body.unwrap_or_default());
    let content = if body_content.trim().is_empty() {
        body.trim().to_string()
    } else {
        body_content
    };

    ParsedSkillMarkdown {
        name,
        description,
        content,
        version: frontmatter.version,
        author: frontmatter.author,
        tags: frontmatter.tags,
        category: frontmatter.category,
        compatible_agents: frontmatter.compatible_agents,
        source_url: frontmatter.source_url,
    }
}

fn split_skill_frontmatter(content: &str) -> (Option<&str>, &str) {
    if let Some(rest) = content.strip_prefix("---\n")
        && let Some((frontmatter, body)) = rest.split_once("\n---\n")
    {
        return (Some(frontmatter), body);
    }

    (None, content)
}

fn parse_skill_frontmatter(frontmatter: &str) -> Option<ParsedSkillFrontmatter> {
    let value = serde_yaml::from_str::<serde_yaml::Value>(frontmatter).ok()?;
    let mapping = value.as_mapping()?;

    Some(ParsedSkillFrontmatter {
        name: yaml_string(mapping, "name"),
        description: yaml_string(mapping, "description"),
        version: yaml_string(mapping, "version"),
        author: yaml_string(mapping, "author"),
        tags: yaml_string_list(mapping, "tags"),
        category: yaml_string(mapping, "category"),
        compatible_agents: yaml_string_list(mapping, "compatible_agents"),
        source_url: yaml_string(mapping, "source_url")
            .or_else(|| yaml_string(mapping, "source"))
            .filter(|value| value.contains("://") || value.starts_with("github.com/")),
    })
}

fn yaml_string(mapping: &serde_yaml::Mapping, key: &str) -> Option<String> {
    mapping.iter().find_map(|(candidate, value)| {
        let candidate = candidate.as_str()?;
        if !candidate.eq_ignore_ascii_case(key) {
            return None;
        }

        match value {
            serde_yaml::Value::String(value) => Some(clean_metadata_text(value)),
            serde_yaml::Value::Number(value) => Some(value.to_string()),
            serde_yaml::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        }
    })
}

fn yaml_string_list(mapping: &serde_yaml::Mapping, key: &str) -> Vec<String> {
    mapping
        .iter()
        .find_map(|(candidate, value)| {
            let candidate = candidate.as_str()?;
            if !candidate.eq_ignore_ascii_case(key) {
                return None;
            }
            Some(yaml_value_to_string_list(value))
        })
        .unwrap_or_default()
}

fn yaml_value_to_string_list(value: &serde_yaml::Value) -> Vec<String> {
    match value {
        serde_yaml::Value::Sequence(values) => values
            .iter()
            .filter_map(|entry| match entry {
                serde_yaml::Value::String(value) => Some(clean_metadata_text(value)),
                serde_yaml::Value::Number(value) => Some(value.to_string()),
                serde_yaml::Value::Bool(value) => Some(value.to_string()),
                _ => None,
            })
            .collect(),
        serde_yaml::Value::String(value) => split_metadata_list(value),
        _ => Vec::new(),
    }
}

fn strip_skill_title_and_description(content: &str) -> (Option<String>, Option<String>, String) {
    let mut lines = content.lines().peekable();

    while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
        lines.next();
    }

    let mut heading = None;
    if let Some(line) = lines.peek().copied()
        && let Some(title) = line.trim().strip_prefix("# ")
    {
        heading = Some(title.trim().to_string());
        lines.next();
        while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
            lines.next();
        }
    }

    let mut description_lines = Vec::new();
    while let Some(line) = lines.peek().copied() {
        let trimmed = line.trim();
        if !trimmed.starts_with('>') {
            break;
        }

        description_lines.push(trimmed.trim_start_matches('>').trim().to_string());
        lines.next();
    }

    if !description_lines.is_empty() {
        while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
            lines.next();
        }
    }

    let description = (!description_lines.is_empty()).then(|| description_lines.join(" "));
    let body = lines.collect::<Vec<_>>().join("\n").trim().to_string();

    (heading, description, body)
}

fn split_metadata_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(clean_metadata_text)
        .filter(|item| !item.is_empty())
        .collect()
}

fn clean_metadata_text(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{discover_global_skills, global_skill_roots, parse_discovered_skill_markdown};

    #[test]
    fn global_skill_roots_use_slugified_skill_name() {
        let home_dir = Path::new("/tmp/test-home");
        let roots = global_skill_roots(home_dir, "Apify Automation");

        assert!(roots.iter().all(|root| root.ends_with("apify-automation")));
    }

    #[test]
    fn parse_discovered_skill_markdown_extracts_frontmatter_and_body() {
        let markdown = r#"---
name: Apify Automation
description: "Automate Apify tasks."
author: Acme
version: 2.1.0
tags:
  - integration
  - automation
compatible_agents:
  - claude
  - cursor
---
# Apify Automation

> Automate Apify tasks.

Use this skill to automate Apify workflows.
"#;

        let parsed = parse_discovered_skill_markdown("apify-automation", markdown);

        assert_eq!(parsed.name, "Apify Automation");
        assert_eq!(parsed.description, "Automate Apify tasks.");
        assert_eq!(parsed.author.as_deref(), Some("Acme"));
        assert_eq!(parsed.version.as_deref(), Some("2.1.0"));
        assert_eq!(parsed.tags, vec!["integration", "automation"]);
        assert_eq!(parsed.compatible_agents, vec!["claude", "cursor"]);
        assert_eq!(
            parsed.content,
            "Use this skill to automate Apify workflows."
        );
    }

    #[test]
    fn parse_discovered_skill_markdown_falls_back_to_heading_and_quote() {
        let markdown = r#"# Browser Automation

> Drive browser tasks safely.

Open the page and inspect it carefully.
"#;

        let parsed = parse_discovered_skill_markdown("browser-automation", markdown);

        assert_eq!(parsed.name, "Browser Automation");
        assert_eq!(parsed.description, "Drive browser tasks safely.");
        assert_eq!(parsed.content, "Open the page and inspect it carefully.");
    }

    #[tokio::test]
    async fn discover_global_skills_reads_agent_skill_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let skill_dir = temp_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("browser-automation");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "# Browser Automation\n\n> Drive browser tasks safely.\n\nOpen the page.\n",
        )
        .expect("write skill file");

        let discovered = discover_global_skills(temp_dir.path()).await;
        let skill = discovered
            .get("browser-automation")
            .expect("discovered skill");

        assert_eq!(skill.name, "Browser Automation");
        assert!(skill.compatible_agents.contains("claude"));
    }
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

// ============================================================
// Dual-Source Functions (Go server with BUILTIN fallback)
// ============================================================

/// List skills from registry with fallback to built-in skills
/// This provides a dual-source architecture: Go server first, BUILTIN_SKILLS as backup
pub async fn list_skills_with_fallback(registry_url: Option<String>) -> Vec<RemoteSkillMeta> {
    let client = SkillRegistryClient::new(registry_url);

    match client.list_skills().await {
        Ok(skills) => {
            tracing::debug!("Fetched {} skills from registry", skills.len());
            skills
        }
        Err(e) => {
            tracing::warn!("Failed to fetch from registry, using builtin: {}", e);
            list_builtin_skills()
        }
    }
}

/// Get a specific skill with fallback to built-in skills
pub async fn get_skill_with_fallback(
    registry_url: Option<String>,
    skill_id: &str,
) -> Option<RemoteSkillPackage> {
    let client = SkillRegistryClient::new(registry_url);

    match client.get_skill(skill_id).await {
        Ok(skill) => Some(skill),
        Err(e) => {
            tracing::warn!(
                "Failed to fetch skill '{}' from registry, trying builtin: {}",
                skill_id,
                e
            );
            get_builtin_skill(skill_id)
        }
    }
}

/// Search skills with fallback to built-in skills
pub async fn search_skills_with_fallback(
    registry_url: Option<String>,
    query: &str,
) -> Vec<RemoteSkillMeta> {
    let client = SkillRegistryClient::new(registry_url);

    match client.search_skills(query).await {
        Ok(skills) => skills,
        Err(e) => {
            tracing::warn!("Failed to search registry, using builtin: {}", e);
            search_builtin_skills(query)
        }
    }
}

/// List categories with fallback to built-in categories
pub async fn list_categories_with_fallback(registry_url: Option<String>) -> Vec<SkillCategory> {
    let client = SkillRegistryClient::new(registry_url);

    match client.list_categories().await {
        Ok(categories) => categories,
        Err(e) => {
            tracing::warn!(
                "Failed to fetch categories from registry, using builtin: {}",
                e
            );
            get_builtin_categories()
                .into_iter()
                .map(|name| SkillCategory {
                    id: name.to_lowercase(),
                    name,
                    description: None,
                })
                .collect()
        }
    }
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
