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

pub fn find_builtin_skill_by_name(name: &str) -> Option<&'static RemoteSkillPackage> {
    BUILTIN_SKILLS
        .skills
        .iter()
        .find(|skill| skill.name == name && has_embedded_skill_files(&skill.name))
}
