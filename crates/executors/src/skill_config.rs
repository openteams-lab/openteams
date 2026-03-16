use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use regex::Regex;
use serde_json::{Value, json};
use tokio::fs;

use crate::{
    executors::ExecutorError,
    mcp_config::{McpConfig, read_agent_config, write_agent_config},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSkillConfigBackend {
    Unsupported,
    Codex,
    Gemini,
    Opencode,
}

#[derive(Debug, Clone)]
pub struct NativeDiscoveredSkill {
    pub name: String,
    pub slug: String,
    pub path: PathBuf,
    pub enabled: bool,
    pub can_toggle: bool,
    pub config_path: Option<PathBuf>,
}

pub async fn list_native_skills(
    config_backend: NativeSkillConfigBackend,
    config_path: Option<PathBuf>,
    roots: Vec<PathBuf>,
) -> Result<Vec<NativeDiscoveredSkill>, ExecutorError> {
    let mut skills = discover_skill_files(&roots).await?;
    let Some(config_path_ref) = config_path.as_ref() else {
        for skill in &mut skills {
            skill.enabled = true;
            skill.can_toggle = false;
        }
        return Ok(skills);
    };

    let config = read_native_skill_config(config_backend, config_path_ref).await?;
    for skill in &mut skills {
        skill.enabled = match config_backend {
            NativeSkillConfigBackend::Unsupported => true,
            NativeSkillConfigBackend::Codex => codex_skill_enabled(&config, &skill.path),
            NativeSkillConfigBackend::Gemini => gemini_skill_enabled(&config, &skill.slug),
            NativeSkillConfigBackend::Opencode => opencode_skill_enabled(&config, &skill.slug),
        };
        skill.can_toggle = config_backend != NativeSkillConfigBackend::Unsupported;
        skill.config_path = Some(config_path_ref.clone());
    }

    Ok(skills)
}

pub async fn set_native_skill_enabled(
    config_backend: NativeSkillConfigBackend,
    config_path: Option<PathBuf>,
    skill_name: &str,
    skill_path: &Path,
    enabled: bool,
) -> Result<(), ExecutorError> {
    let Some(config_path) = config_path else {
        return Ok(());
    };

    if config_backend == NativeSkillConfigBackend::Unsupported {
        return Ok(());
    }

    let mut config = read_native_skill_config(config_backend, &config_path).await?;
    match config_backend {
        NativeSkillConfigBackend::Unsupported => {}
        NativeSkillConfigBackend::Codex => {
            upsert_codex_skill_entry(&mut config, skill_path, enabled);
        }
        NativeSkillConfigBackend::Gemini => {
            update_gemini_skill_entry(&mut config, skill_name, enabled);
        }
        NativeSkillConfigBackend::Opencode => {
            update_opencode_skill_entry(&mut config, skill_name, enabled);
        }
    }

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    write_native_skill_config(config_backend, &config_path, &config).await
}

fn skill_config_template(is_toml: bool) -> McpConfig {
    McpConfig::new(Vec::new(), json!({}), json!({}), is_toml)
}

async fn read_native_skill_config(
    backend: NativeSkillConfigBackend,
    config_path: &Path,
) -> Result<Value, ExecutorError> {
    let is_toml = matches!(backend, NativeSkillConfigBackend::Codex);
    read_agent_config(config_path, &skill_config_template(is_toml)).await
}

async fn write_native_skill_config(
    backend: NativeSkillConfigBackend,
    config_path: &Path,
    config: &Value,
) -> Result<(), ExecutorError> {
    let is_toml = matches!(backend, NativeSkillConfigBackend::Codex);
    write_agent_config(config_path, &skill_config_template(is_toml), config).await
}

async fn discover_skill_files(
    roots: &[PathBuf],
) -> Result<Vec<NativeDiscoveredSkill>, ExecutorError> {
    let mut discovered = HashMap::<String, NativeDiscoveredSkill>::new();

    for root in roots {
        let mut entries = match fs::read_dir(root).await {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(ExecutorError::Io(err)),
        };

        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            if !file_type.is_dir() {
                continue;
            }

            let skill_dir = entry.path();
            let skill_file = skill_dir.join("SKILL.md");
            let metadata = match fs::metadata(&skill_file).await {
                Ok(metadata) => metadata,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(err) => return Err(ExecutorError::Io(err)),
            };
            if !metadata.is_file() {
                continue;
            }

            let dir_name = entry.file_name().to_string_lossy().trim().to_string();
            if dir_name.is_empty() {
                continue;
            }

            let raw = fs::read_to_string(&skill_file).await?;
            let name = parse_skill_name(&dir_name, &raw);
            let slug = slugify_skill_name(&name);
            discovered
                .entry(slug.clone())
                .or_insert(NativeDiscoveredSkill {
                    name,
                    slug,
                    path: skill_file,
                    enabled: true,
                    can_toggle: false,
                    config_path: None,
                });
        }
    }

    let mut skills = discovered.into_values().collect::<Vec<_>>();
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

fn parse_skill_name(dir_name: &str, raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n");
    if let Some(frontmatter) = extract_frontmatter(&normalized)
        && let Some(name) = parse_frontmatter_name(frontmatter)
    {
        return name;
    }

    for line in normalized.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }

    dir_name.to_string()
}

fn extract_frontmatter(content: &str) -> Option<&str> {
    let rest = content.strip_prefix("---\n")?;
    let (frontmatter, _) = rest.split_once("\n---\n")?;
    Some(frontmatter)
}

fn parse_frontmatter_name(frontmatter: &str) -> Option<String> {
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let (key, value) = trimmed.split_once(':')?;
        if !key.trim().eq_ignore_ascii_case("name") {
            continue;
        }

        let value = value.trim().trim_matches('"').trim_matches('\'');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }

    None
}

fn slugify_skill_name(name: &str) -> String {
    name.trim().to_lowercase().replace(' ', "-")
}

fn normalize_skill_path(path: &Path) -> String {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();

    #[cfg(windows)]
    {
        normalized.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        normalized
    }
}

fn codex_skill_enabled(config: &Value, skill_path: &Path) -> bool {
    let target = normalize_skill_path(skill_path);
    config
        .get("skills")
        .and_then(|skills| skills.get("config"))
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().rev().find_map(|entry| {
                let path = entry.get("path").and_then(Value::as_str)?;
                if normalize_skill_path(Path::new(path)) != target {
                    return None;
                }

                Some(
                    entry
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                )
            })
        })
        .unwrap_or(true)
}

fn gemini_skill_enabled(config: &Value, skill_slug: &str) -> bool {
    let Some(skills_config) = config.get("skills") else {
        return true;
    };

    if skills_config.get("enabled").and_then(Value::as_bool) == Some(false) {
        return false;
    }

    !skills_config
        .get("disabled")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().any(|item| {
                item.as_str()
                    .is_some_and(|value| value.eq_ignore_ascii_case(skill_slug))
            })
        })
        .unwrap_or(false)
}

fn opencode_skill_enabled(config: &Value, skill_slug: &str) -> bool {
    let Some(permission_skill) = config
        .get("permission")
        .and_then(|permission| permission.get("skill"))
        .and_then(Value::as_object)
    else {
        return true;
    };

    let mut best_match: Option<(usize, &str)> = None;
    for (pattern, action_value) in permission_skill {
        let Some(action) = action_value.as_str() else {
            continue;
        };
        if !wildcard_match(pattern, skill_slug) {
            continue;
        }

        let score = if pattern == skill_slug {
            usize::MAX
        } else {
            pattern.chars().filter(|ch| *ch != '*').count()
        };

        match best_match {
            Some((best_score, _)) if best_score >= score => {}
            _ => best_match = Some((score, action)),
        }
    }

    !matches!(best_match, Some((_, "deny")))
}

fn wildcard_match(pattern: &str, candidate: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern == candidate {
        return true;
    }

    let regex_pattern = format!("^{}$", regex::escape(pattern).replace("\\*", ".*"));
    Regex::new(&regex_pattern)
        .ok()
        .is_some_and(|regex| regex.is_match(candidate))
}

fn upsert_codex_skill_entry(config: &mut Value, skill_path: &Path, enabled: bool) {
    ensure_object(config);
    let Some(root) = config.as_object_mut() else {
        return;
    };
    let skills = root
        .entry("skills".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    ensure_object(skills);
    let Some(skills) = skills.as_object_mut() else {
        return;
    };
    let entries = skills
        .entry("config".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !entries.is_array() {
        *entries = Value::Array(Vec::new());
    }

    let normalized_target = normalize_skill_path(skill_path);
    let Some(entries) = entries.as_array_mut() else {
        return;
    };

    for entry in entries.iter_mut() {
        let matches_path = entry
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|value| normalize_skill_path(Path::new(value)) == normalized_target);
        if matches_path {
            *entry = json!({
                "path": skill_path.to_string_lossy().to_string(),
                "enabled": enabled,
            });
            return;
        }
    }

    entries.push(json!({
        "path": skill_path.to_string_lossy().to_string(),
        "enabled": enabled,
    }));
}

fn update_gemini_skill_entry(config: &mut Value, skill_name: &str, enabled: bool) {
    ensure_object(config);
    let Some(root) = config.as_object_mut() else {
        return;
    };
    let skills = root
        .entry("skills".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    ensure_object(skills);
    let Some(skills) = skills.as_object_mut() else {
        return;
    };

    skills.insert("enabled".to_string(), Value::Bool(true));

    let disabled_list = skills
        .entry("disabled".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !disabled_list.is_array() {
        *disabled_list = Value::Array(Vec::new());
    }

    let slug = slugify_skill_name(skill_name);
    let Some(items) = disabled_list.as_array_mut() else {
        return;
    };

    items.retain(|item| {
        item.as_str()
            .is_none_or(|value| !value.eq_ignore_ascii_case(&slug))
    });

    if !enabled {
        items.push(Value::String(slug));
    }
}

fn update_opencode_skill_entry(config: &mut Value, skill_name: &str, enabled: bool) {
    ensure_object(config);
    let Some(root) = config.as_object_mut() else {
        return;
    };
    let permission = root
        .entry("permission".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    ensure_object(permission);
    let Some(permission) = permission.as_object_mut() else {
        return;
    };
    let skill_permission = permission
        .entry("skill".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    ensure_object(skill_permission);
    let Some(skill_permission) = skill_permission.as_object_mut() else {
        return;
    };

    skill_permission.insert(
        slugify_skill_name(skill_name),
        Value::String(if enabled { "allow" } else { "deny" }.to_string()),
    );
}

fn ensure_object(value: &mut Value) {
    if !value.is_object() {
        *value = Value::Object(Default::default());
    }
}
