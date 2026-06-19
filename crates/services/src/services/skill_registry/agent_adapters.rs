#[derive(Clone, Copy)]
struct DiscoveryRoot {
    folder: &'static str,
    agent_hint: Option<&'static str>,
}

/// Agent info for API response
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
}

/// Get list of supported agents for skill installation
pub fn list_supported_agents() -> Vec<AgentInfo> {
    SUPPORTED_AGENT_DIRS
        .iter()
        .map(|(id, name)| AgentInfo {
            id: id.to_string(),
            name: name.to_string(),
        })
        .collect()
}

/// Map agent id to discovery root folder name
fn agent_id_to_folder(agent_id: &str) -> Option<&'static str> {
    match agent_id {
        "agents" => Some(GLOBAL_SKILLS_DIR),
        "claude" => Some(".claude"),
        "copilot" => Some(".github"),
        "cursor" => Some(".cursor"),
        "qwen" => Some(".qwen"),
        "opencode" => Some(".opencode"),
        "gemini" => Some(".gemini"),
        "kimi" => Some(".kimi"),
        "droid" => Some(".factory"),
        _ => None,
    }
}

/// Filter skill installation roots by selected agents
/// If target_agents is None or empty, installs to all agents
/// If target_agents contains "agents", installs to universal .agents directory only
fn filter_skill_roots_by_agents(
    home_dir: &Path,
    skill_name: &str,
    target_agents: Option<&[String]>,
) -> Vec<PathBuf> {
    let install_dir_name = slugify_skill_name(skill_name);

    // If no agents specified or empty, install to all
    let agents: &[String] = match target_agents {
        Some(agents) if !agents.is_empty() => agents,
        _ => {
            // Install to all agent directories
            return global_skill_roots(home_dir, skill_name);
        }
    };

    // Check if "agents" (universal) is selected
    let has_universal = agents.iter().any(|a| a == "agents");

    let mut roots = Vec::new();

    // Add universal .agents directory if selected
    if has_universal {
        roots.push(
            home_dir
                .join(GLOBAL_SKILLS_DIR)
                .join("skills")
                .join(&install_dir_name),
        );
    }

    // Add specific agent directories
    for agent_id in agents {
        if agent_id == "agents" {
            continue; // Already handled above
        }
        if let Some(folder) = agent_id_to_folder(agent_id) {
            roots.push(home_dir.join(folder).join("skills").join(&install_dir_name));
        }
    }

    // If no valid agents found, fall back to universal
    if roots.is_empty() {
        roots.push(
            home_dir
                .join(GLOBAL_SKILLS_DIR)
                .join("skills")
                .join(&install_dir_name),
        );
    }

    roots
}

struct DiscoveryRootPath {
    path: PathBuf,
    agent_hint: Option<&'static str>,
}
