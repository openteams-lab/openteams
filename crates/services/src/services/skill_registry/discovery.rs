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

    fn sorted_compatible_agents(&self) -> Vec<String> {
        let mut compatible_agents = self.compatible_agents.iter().cloned().collect::<Vec<_>>();
        compatible_agents.sort();
        compatible_agents
    }
}

fn discovered_skill_needs_refresh(skill: &ChatSkill, discovered: &DiscoveredSkillDraft) -> bool {
    skill.compatible_agents.0 != discovered.sorted_compatible_agents()
}

fn discovered_skill_refresh_update(discovered: &DiscoveredSkillDraft) -> UpdateChatSkill {
    UpdateChatSkill {
        name: None,
        description: None,
        content: None,
        trigger_type: None,
        trigger_keywords: None,
        enabled: None,
        source: None,
        source_url: None,
        version: None,
        author: None,
        tags: None,
        category: None,
        compatible_agents: Some(discovered.sorted_compatible_agents()),
        download_count: None,
    }
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

    sync_discovered_global_skills_at_home_dir(pool, &home_dir).await
}

async fn sync_discovered_global_skills_at_home_dir(
    pool: &SqlitePool,
    home_dir: &Path,
) -> Result<usize, SkillRegistryError> {
    let existing_skills = ChatSkill::find_all(pool).await?;
    let discovered = discover_global_skills(home_dir).await;
    let discovered_slugs = discovered.keys().cloned().collect::<HashSet<_>>();
    let stale_skill_ids = existing_skills
        .iter()
        .filter(|skill| should_prune_missing_discovered_skill(skill, &discovered_slugs))
        .map(|skill| skill.id)
        .collect::<Vec<_>>();
    let stale_skill_ids_set = stale_skill_ids.iter().copied().collect::<HashSet<_>>();

    let mut existing_by_slug = existing_skills
        .into_iter()
        .filter(|skill| !stale_skill_ids_set.contains(&skill.id))
        .map(|skill| (slugify_skill_name(&skill.name), skill))
        .collect::<HashMap<_, _>>();
    let mut synced_count = 0;

    for skill_id in stale_skill_ids {
        synced_count += ChatSkill::delete(pool, skill_id).await? as usize;
    }

    prune_stale_session_agent_skill_ids(pool, &stale_skill_ids_set).await?;

    for (_, skill) in discovered {
        let slug = slugify_skill_name(&skill.name);
        if let Some(existing) = existing_by_slug.get_mut(&slug) {
            if discovered_skill_needs_refresh(existing, &skill) {
                let updated =
                    ChatSkill::update(pool, existing.id, &discovered_skill_refresh_update(&skill))
                        .await?;
                *existing = updated;
                synced_count += 1;
            }
            continue;
        }

        let created = ChatSkill::create(pool, &skill.into_create_data(), Uuid::new_v4()).await?;
        existing_by_slug.insert(slug, created);
        synced_count += 1;
    }

    Ok(synced_count)
}

fn should_prune_missing_discovered_skill(
    skill: &ChatSkill,
    discovered_slugs: &HashSet<String>,
) -> bool {
    if discovered_slugs.contains(&slugify_skill_name(&skill.name)) {
        return false;
    }

    matches!(
        skill.source.as_str(),
        "local" | "registry" | "github" | "url"
    )
}

async fn prune_stale_session_agent_skill_ids(
    pool: &SqlitePool,
    stale_skill_ids: &HashSet<Uuid>,
) -> Result<(), SkillRegistryError> {
    if stale_skill_ids.is_empty() {
        return Ok(());
    }

    let stale_skill_id_strings = stale_skill_ids
        .iter()
        .map(Uuid::to_string)
        .collect::<HashSet<_>>();
    let session_agents = sqlx::query_as::<_, ChatSessionAgent>(
        r#"SELECT id,
                  session_id,
                  agent_id,
                  state,
                  workspace_path,
                  pty_session_key,
                  agent_session_id,
                  agent_message_id,
                  allowed_skill_ids,
                  created_at,
                  updated_at
           FROM chat_session_agents
           WHERE allowed_skill_ids IS NOT NULL
             AND allowed_skill_ids != '[]'"#,
    )
    .fetch_all(pool)
    .await?;

    for session_agent in session_agents {
        let next_allowed_skill_ids = session_agent
            .allowed_skill_ids
            .0
            .iter()
            .filter(|skill_id| !stale_skill_id_strings.contains(skill_id.trim()))
            .cloned()
            .collect::<Vec<_>>();

        if next_allowed_skill_ids != session_agent.allowed_skill_ids.0 {
            ChatSessionAgent::update_allowed_skill_ids(
                pool,
                session_agent.id,
                next_allowed_skill_ids,
            )
            .await?;
        }
    }

    Ok(())
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

fn discovery_root_paths(home_dir: &Path) -> Vec<DiscoveryRootPath> {
    DISCOVERY_ROOTS
        .iter()
        .map(|root| DiscoveryRootPath {
            path: home_dir.join(root.folder).join("skills"),
            agent_hint: root.agent_hint,
        })
        .collect()
}
