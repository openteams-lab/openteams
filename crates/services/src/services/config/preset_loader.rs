use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use utils::path::home_directory;

use crate::services::config::versions::v9::{ChatMemberPreset, ChatPresetsConfig};

const TEAM_PROTOCOL_MARKDOWN: &str =
    include_str!("presets/protocol/team_collaboration_protocol.md");

const ROLE_PRESET_MARKDOWN: &[(&str, &str)] = &[
    (
        "coordinator_pmo.md",
        include_str!("presets/roles/coordinator_pmo.md"),
    ),
    (
        "product_manager.md",
        include_str!("presets/roles/product_manager.md"),
    ),
    (
        "system_architect.md",
        include_str!("presets/roles/system_architect.md"),
    ),
    (
        "prompt_engineer.md",
        include_str!("presets/roles/prompt_engineer.md"),
    ),
    (
        "frontend_engineer.md",
        include_str!("presets/roles/frontend_engineer.md"),
    ),
    (
        "backend_engineer.md",
        include_str!("presets/roles/backend_engineer.md"),
    ),
    (
        "fullstack_engineer.md",
        include_str!("presets/roles/fullstack_engineer.md"),
    ),
    ("qa_tester.md", include_str!("presets/roles/qa_tester.md")),
    (
        "ux_ui_designer.md",
        include_str!("presets/roles/ux_ui_designer.md"),
    ),
    (
        "safety_policy_officer.md",
        include_str!("presets/roles/safety_policy_officer.md"),
    ),
    (
        "solution_manager.md",
        include_str!("presets/roles/solution_manager.md"),
    ),
    (
        "code_reviewer.md",
        include_str!("presets/roles/code_reviewer.md"),
    ),
    (
        "devops_engineer.md",
        include_str!("presets/roles/devops_engineer.md"),
    ),
    (
        "product_analyst.md",
        include_str!("presets/roles/product_analyst.md"),
    ),
    (
        "data_analyst.md",
        include_str!("presets/roles/data_analyst.md"),
    ),
    (
        "technical_writer.md",
        include_str!("presets/roles/technical_writer.md"),
    ),
    (
        "content_researcher.md",
        include_str!("presets/roles/content_researcher.md"),
    ),
    (
        "content_editor.md",
        include_str!("presets/roles/content_editor.md"),
    ),
    (
        "frontier_researcher.md",
        include_str!("presets/roles/frontier_researcher.md"),
    ),
    (
        "marketing_specialist.md",
        include_str!("presets/roles/marketing_specialist.md"),
    ),
    (
        "video_editor.md",
        include_str!("presets/roles/video_editor.md"),
    ),
    (
        "market_analyst.md",
        include_str!("presets/roles/market_analyst.md"),
    ),
];

const COMMON_ROLE_INPUTS: &[&str] = &[
    "Chat messages with task intent, constraints, and acceptance needs.",
    "Shared project context with CITE# references.",
    "Outputs from other roles received through @requests.",
];

const COMMON_ROLE_OUTPUTS: &[&str] = &[
    "Conclusion-first summary that directly answers the task.",
    "Structured deliverable section beginning with DELIVER:.",
    "Evidence and assumptions with explicit uncertainty markers.",
    "Boundary checks, risk notes, and escalation when needed.",
    "Next Actions (<=5).",
];

const COMMON_ROLE_WORKFLOW: &[&str] = &[
    "Restate objective and constraints before solving.",
    "Collect and cite context; mark uncertainty explicitly.",
    "Produce an actionable deliverable with clear acceptance points.",
    "Apply boundary checks and escalate risk to the right role.",
    "Finish with concise next steps and handoff guidance.",
];

const COMMON_ROLE_BOUNDARIES: &[&str] = &[
    "No scope creep beyond the explicit request.",
    "No implicit permission to expose private/sensitive data.",
    "Escalate security, privacy, or policy concerns to @Safety.",
];

#[derive(Debug, Deserialize)]
struct RolePresetFrontmatter {
    id: String,
    name: String,
    description: String,
    #[serde(default, alias = "default_workspace_path")]
    default_workspace: Option<String>,
    #[serde(default, alias = "allowed_skill_ids")]
    selected_skill_ids: Vec<String>,
    #[serde(default)]
    runner_type: Option<String>,
    #[serde(default)]
    tools_enabled: Option<serde_yaml::Value>,
}

#[derive(Debug, PartialEq, Eq)]
struct RolePresetMd {
    id: String,
    name: String,
    description: String,
    role_title: String,
    goal: String,
    role_focus: Vec<String>,
    definition_of_done: String,
    default_workspace_path: Option<String>,
    selected_skill_ids: Vec<String>,
    runner_type: Option<String>,
    tools_enabled: serde_json::Value,
}

pub struct PresetLoader;

impl PresetLoader {
    pub fn load_builtin_presets() -> ChatPresetsConfig {
        let team_protocol = Self::load_team_protocol();
        let default_workspace_path = home_directory().to_string_lossy().to_string();
        let members = ROLE_PRESET_MARKDOWN
            .iter()
            .map(|(path, raw)| {
                Self::parse_chat_member_preset(path, raw, &team_protocol, &default_workspace_path)
            })
            .collect::<Result<Vec<_>>>()
            .expect("built-in role preset markdown should be valid");

        ChatPresetsConfig {
            members,
            teams: Vec::new(),
            team_protocol: None,
        }
    }

    pub fn load_team_protocol() -> String {
        Self::try_load_team_protocol()
            .expect("built-in team collaboration protocol markdown should be valid")
    }

    fn try_load_team_protocol() -> Result<String> {
        let protocol = normalize_newlines(TEAM_PROTOCOL_MARKDOWN)
            .trim()
            .to_string();
        if protocol.is_empty() {
            bail!("built-in team collaboration protocol is empty");
        }

        Ok(protocol)
    }

    fn parse_chat_member_preset(
        path: &str,
        raw: &str,
        team_protocol: &str,
        default_workspace_path: &str,
    ) -> Result<ChatMemberPreset> {
        let preset = Self::parse_role_preset_markdown(path, raw)?;
        Ok(ChatMemberPreset {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            runner_type: preset.runner_type,
            system_prompt: build_role_prompt(
                &preset.role_title,
                &preset.goal,
                &preset.role_focus,
                &preset.definition_of_done,
                team_protocol,
            ),
            default_workspace_path: Some(default_workspace_path.to_string()),
            selected_skill_ids: preset.selected_skill_ids,
            tools_enabled: preset.tools_enabled,
            is_builtin: true,
            enabled: true,
        })
    }

    fn parse_role_preset_markdown(path: &str, raw: &str) -> Result<RolePresetMd> {
        let normalized = normalize_newlines(raw);
        let (frontmatter_raw, body) = split_frontmatter(&normalized)
            .ok_or_else(|| anyhow!("missing frontmatter delimiters in {path}"))?;
        let frontmatter: RolePresetFrontmatter = serde_yaml::from_str(frontmatter_raw)
            .with_context(|| format!("failed to parse frontmatter in {path}"))?;

        let role_title = parse_role_title(body)
            .with_context(|| format!("failed to parse role title in {path}"))?;
        let goal = parse_markdown_section(body, "Goal")
            .with_context(|| format!("failed to parse Goal section in {path}"))?;
        let role_focus = parse_markdown_list_section(body, "Role Focus")
            .with_context(|| format!("failed to parse Role Focus section in {path}"))?;
        let definition_of_done = parse_markdown_section(body, "Definition of Done")
            .with_context(|| format!("failed to parse Definition of Done section in {path}"))?;

        if frontmatter.id.trim().is_empty()
            || frontmatter.name.trim().is_empty()
            || frontmatter.description.trim().is_empty()
        {
            bail!("role preset frontmatter contains empty required fields in {path}");
        }

        let tools_enabled = match frontmatter.tools_enabled {
            Some(value) => serde_json::to_value(value)
                .with_context(|| format!("failed to convert tools_enabled in {path}"))?,
            None => serde_json::json!({}),
        };

        Ok(RolePresetMd {
            id: frontmatter.id,
            name: frontmatter.name,
            description: frontmatter.description,
            role_title,
            goal,
            role_focus,
            definition_of_done,
            default_workspace_path: frontmatter.default_workspace,
            selected_skill_ids: normalize_selected_skill_ids(frontmatter.selected_skill_ids),
            runner_type: frontmatter.runner_type,
            tools_enabled,
        })
    }
}

fn normalize_selected_skill_ids(skill_ids: Vec<String>) -> Vec<String> {
    let mut normalized = skill_ids
        .into_iter()
        .map(|skill_id| skill_id.trim().to_string())
        .filter(|skill_id| !skill_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalize_newlines(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn split_frontmatter(content: &str) -> Option<(&str, &str)> {
    if let Some(rest) = content.strip_prefix("---\n")
        && let Some((frontmatter, body)) = rest.split_once("\n---\n")
    {
        return Some((frontmatter, body));
    }

    None
}

fn parse_role_title(body: &str) -> Result<String> {
    let title = body
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .ok_or_else(|| anyhow!("missing level-1 title"))?;

    let role_title = title
        .strip_prefix("Role:")
        .map(str::trim)
        .unwrap_or(title)
        .trim();
    if role_title.is_empty() {
        bail!("role title is empty");
    }

    Ok(role_title.to_string())
}

fn parse_markdown_section(body: &str, heading: &str) -> Result<String> {
    let section = extract_section(body, heading).ok_or_else(|| anyhow!("missing section"))?;
    let content = section.trim();
    if content.is_empty() {
        bail!("section is empty");
    }

    Ok(content.to_string())
}

fn parse_markdown_list_section(body: &str, heading: &str) -> Result<Vec<String>> {
    let section = extract_section(body, heading).ok_or_else(|| anyhow!("missing section"))?;
    let items = section
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.strip_prefix("- ")
                .or_else(|| line.strip_prefix("* "))
                .ok_or_else(|| anyhow!("list item must start with `- ` or `* `"))
                .map(str::to_string)
        })
        .collect::<Result<Vec<_>>>()?;

    if items.is_empty() {
        bail!("section has no list items");
    }

    Ok(items)
}

fn extract_section<'a>(body: &'a str, heading: &str) -> Option<&'a str> {
    let marker = format!("## {heading}");
    let start = body.find(&marker)?;
    let rest = &body[start + marker.len()..];
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = rest.find("\n## ").unwrap_or(rest.len());
    Some(rest[..end].trim_matches('\n'))
}

fn build_role_prompt(
    role: &str,
    goal: &str,
    role_focus: &[String],
    definition_of_done: &str,
    team_protocol: &str,
) -> String {
    format!(
        "You are the \"{role}\". {goal}\n\n\
(Embedded: Team Collaboration Protocol)\n\
{team_protocol}\n\n\
Inputs:\n\
{}\n\n\
Output format:\n\
{}\n\n\
Workflow:\n\
{}\n\n\
Boundaries / Escalation:\n\
{}\n\n\
Role focus:\n\
{}\n\n\
Definition of Done:\n\
- {definition_of_done}",
        format_bullets(COMMON_ROLE_INPUTS),
        format_bullets(COMMON_ROLE_OUTPUTS),
        format_steps(COMMON_ROLE_WORKFLOW),
        format_bullets(COMMON_ROLE_BOUNDARIES),
        format_dynamic_bullets(role_focus),
    )
}

fn format_bullets(items: &[&str]) -> String {
    items
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_dynamic_bullets(items: &[String]) -> String {
    items
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_steps(items: &[&str]) -> String {
    items
        .iter()
        .enumerate()
        .map(|(index, item)| format!("{}. {item}", index + 1))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use utils::path::home_directory;

    use super::PresetLoader;

    #[test]
    fn load_builtin_presets_reads_all_role_markdown_files() {
        let presets = PresetLoader::load_builtin_presets();

        assert_eq!(presets.members.len(), 22);
        assert!(presets.teams.is_empty());

        let fullstack = presets
            .members
            .iter()
            .find(|preset| preset.id == "fullstack_engineer")
            .expect("fullstack preset should exist");
        assert_eq!(fullstack.name, "fullstack");
        let expected_workspace = home_directory().to_string_lossy().to_string();
        assert_eq!(
            fullstack.default_workspace_path.as_deref(),
            Some(expected_workspace.as_str())
        );
        assert!(fullstack.selected_skill_ids.is_empty());
        assert!(
            fullstack
                .system_prompt
                .contains("(Embedded: Team Collaboration Protocol)")
        );
        assert!(
            fullstack
                .system_prompt
                .contains("API-to-UI contract alignment and schema evolution control.")
        );
    }

    #[test]
    fn load_team_protocol_returns_embedded_markdown_content() {
        let protocol = PresetLoader::load_team_protocol();

        assert!(protocol.starts_with("[Team Collaboration Protocol]"));
        assert!(protocol.contains("Quality bar"));
    }

    #[test]
    fn parse_role_preset_markdown_extracts_frontmatter_and_sections() {
        let markdown = r#"---
id: sample_role
name: sample
description: Sample role
default_workspace: samples
selected_skill_ids:
  - skill_b
  - skill_a
  - skill_b
runner_type: codex
tools_enabled:
  shell: true
---

# Role: Sample Role

## Goal
Ship a sample workflow.

## Role Focus
- Keep the contract explicit.
- Provide reproducible evidence.

## Definition of Done
The sample is shippable.
"#;

        let parsed = PresetLoader::parse_role_preset_markdown("sample.md", markdown).unwrap();

        assert_eq!(parsed.id, "sample_role");
        assert_eq!(parsed.name, "sample");
        assert_eq!(parsed.description, "Sample role");
        assert_eq!(parsed.role_title, "Sample Role");
        assert_eq!(parsed.goal, "Ship a sample workflow.");
        assert_eq!(
            parsed.role_focus,
            vec![
                "Keep the contract explicit.".to_string(),
                "Provide reproducible evidence.".to_string()
            ]
        );
        assert_eq!(parsed.definition_of_done, "The sample is shippable.");
        assert_eq!(parsed.default_workspace_path.as_deref(), Some("samples"));
        assert_eq!(
            parsed.selected_skill_ids,
            vec!["skill_a".to_string(), "skill_b".to_string()]
        );
        assert_eq!(parsed.runner_type.as_deref(), Some("codex"));
        assert_eq!(parsed.tools_enabled, serde_json::json!({ "shell": true }));
    }
}
