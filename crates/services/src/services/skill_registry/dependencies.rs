const GLOBAL_SKILLS_DIR: &str = ".agents";

/// Built-in skills data loaded from JSON
static BUILTIN_SKILLS: Lazy<BuiltInSkillsData> = Lazy::new(|| {
    let json_data = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/skills/skills_registry.json"
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

const DISCOVERY_ROOTS: [DiscoveryRoot; 9] = [
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
        folder: ".kimi",
        agent_hint: Some("kimi"),
    },
    DiscoveryRoot {
        folder: ".factory",
        agent_hint: Some("droid"),
    },
];

/// Supported agent directories for skill installation
/// Each tuple contains (agent_id, display_name)
pub const SUPPORTED_AGENT_DIRS: &[(&str, &str)] = &[
    ("agents", "All Agents"),
    ("claude", "Claude Code"),
    ("copilot", "GitHub Copilot"),
    ("cursor", "Cursor"),
    ("qwen", "Qwen Code"),
    ("opencode", "Opencode"),
    ("gemini", "Gemini CLI"),
    ("kimi", "Kimi Code"),
    ("droid", "Droid"),
];
