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
