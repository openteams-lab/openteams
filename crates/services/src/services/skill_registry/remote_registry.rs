/// Default skill registry URL (can be configured via SKILL_REGISTRY_URL env var)
/// Use local server for development: http://127.0.0.1:3101
/// Production: https://skills.openteams.com
pub fn default_registry_url() -> &'static str {
    static DEFAULT_URL: Lazy<String> = Lazy::new(|| {
        std::env::var("SKILL_REGISTRY_URL").unwrap_or_else(|_| "http://127.0.0.1:3101".to_string())
    });
    DEFAULT_URL.as_str()
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
            base_url: base_url.unwrap_or_else(|| default_registry_url().to_string()),
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
