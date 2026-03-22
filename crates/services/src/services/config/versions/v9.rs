use std::collections::{HashMap, HashSet};

use anyhow::Error;
use executors::{executors::BaseCodingAgent, profile::ExecutorProfileId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::path::home_directory;
pub use v8::{
    EditorConfig, EditorType, GitHubConfig, NotificationConfig, SendMessageShortcut, ShowcaseState,
    SoundFile, ThemeMode, UiLanguage,
};

use crate::services::config::{preset_loader::PresetLoader, versions::v8};

fn default_git_branch_prefix() -> String {
    "vk".to_string()
}

fn default_pr_auto_description_enabled() -> bool {
    true
}

fn default_commit_reminder_enabled() -> bool {
    true
}

/// Chat Member Preset Template
#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ChatMemberPreset {
    /// Unique identifier for the preset
    pub id: String,
    /// Display name (also used as @mention handle)
    pub name: String,
    /// Description of the preset's purpose
    pub description: String,
    /// Optional runner type (null means use default)
    pub runner_type: Option<String>,
    /// Optional recommended model identifier for the selected runner
    #[serde(default)]
    pub recommended_model: Option<String>,
    /// System prompt defining the agent's behavior
    pub system_prompt: String,
    /// Optional default workspace path
    pub default_workspace_path: Option<String>,
    /// Skills preselected for members created from this preset
    #[serde(default)]
    pub selected_skill_ids: Vec<String>,
    /// Tools enabled for this preset
    #[serde(default)]
    pub tools_enabled: serde_json::Value,
    /// Whether this is a built-in preset (cannot be deleted)
    pub is_builtin: bool,
    /// Whether this preset is enabled (visible for import)
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// Chat Team Preset Template
#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ChatTeamPreset {
    /// Unique identifier for the preset
    pub id: String,
    /// Display name of the team
    pub name: String,
    /// Description of the team's purpose
    pub description: String,
    /// List of member preset IDs to include in this team
    pub member_ids: Vec<String>,
    /// Optional team protocol injected when importing this team preset
    #[serde(default)]
    pub team_protocol: String,
    /// Whether this is a built-in preset (cannot be deleted)
    pub is_builtin: bool,
    /// Whether this preset is enabled (visible for import)
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// Chat Presets Configuration
#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
pub struct ChatPresetsConfig {
    /// List of member preset templates
    pub members: Vec<ChatMemberPreset>,
    /// List of team preset templates
    pub teams: Vec<ChatTeamPreset>,
    /// Team collaboration protocol content; empty string disables injection
    #[serde(default)]
    pub team_protocol: Option<String>,
}

/// Chat Compression Configuration
#[derive(Clone, Debug, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub struct ChatCompressionConfig {
    /// Token threshold before compression kicks in (default: 5000000)
    #[serde(default = "default_token_threshold")]
    pub token_threshold: u32,
    /// Percentage of messages to compress (default: 25)
    #[serde(default = "default_compression_percentage")]
    pub compression_percentage: u8,
}

fn default_token_threshold() -> u32 {
    50000
}

fn default_compression_percentage() -> u8 {
    25
}

impl Default for ChatCompressionConfig {
    fn default() -> Self {
        Self {
            token_threshold: default_token_threshold(),
            compression_percentage: default_compression_percentage(),
        }
    }
}

fn default_chat_compression() -> ChatCompressionConfig {
    ChatCompressionConfig::default()
}

fn default_true() -> bool {
    true
}

fn normalize_selected_skill_ids(skill_ids: &[String]) -> Vec<String> {
    let mut normalized = skill_ids
        .iter()
        .map(|skill_id| skill_id.trim().to_string())
        .filter(|skill_id| !skill_id.is_empty())
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn complete_chat_presets_with_builtins(chat_presets: &mut ChatPresetsConfig) {
    let defaults = default_chat_presets();
    let legacy_default_team_protocol = PresetLoader::load_team_protocol();
    let default_workspace_path = Some(home_directory().to_string_lossy().to_string());
    let default_builtin_selected_skill_ids: HashMap<String, Vec<String>> = defaults
        .members
        .iter()
        .map(|preset| {
            (
                preset.id.clone(),
                normalize_selected_skill_ids(&preset.selected_skill_ids),
            )
        })
        .collect();

    let builtin_member_ids: HashSet<&str> = defaults
        .members
        .iter()
        .map(|preset| preset.id.as_str())
        .collect();
    let builtin_team_ids: HashSet<&str> = defaults
        .teams
        .iter()
        .map(|preset| preset.id.as_str())
        .collect();

    // Keep custom presets untouched; remove only legacy built-in entries
    // that are no longer part of the current built-in catalog.
    chat_presets
        .members
        .retain(|preset| !preset.is_builtin || builtin_member_ids.contains(preset.id.as_str()));
    chat_presets
        .teams
        .retain(|preset| !preset.is_builtin || builtin_team_ids.contains(preset.id.as_str()));

    for preset in &mut chat_presets.members {
        preset.selected_skill_ids = normalize_selected_skill_ids(&preset.selected_skill_ids);
        preset.default_workspace_path = default_workspace_path.clone();
        if preset.is_builtin
            && let Some(default_selected_skill_ids) =
                default_builtin_selected_skill_ids.get(&preset.id)
        {
            preset.selected_skill_ids = default_selected_skill_ids.clone();
        }
    }

    let mut existing_member_ids: HashSet<String> = chat_presets
        .members
        .iter()
        .map(|preset| preset.id.clone())
        .collect();
    for preset in defaults.members {
        if existing_member_ids.insert(preset.id.clone()) {
            chat_presets.members.push(preset);
        }
    }

    let mut existing_team_ids: HashSet<String> = chat_presets
        .teams
        .iter()
        .map(|preset| preset.id.clone())
        .collect();
    for preset in defaults.teams {
        if existing_team_ids.insert(preset.id.clone()) {
            chat_presets.teams.push(preset);
        }
    }

    if matches!(
        chat_presets.team_protocol.as_deref(),
        Some(protocol) if protocol == legacy_default_team_protocol.as_str()
    ) {
        chat_presets.team_protocol = Some(String::new());
    } else if chat_presets.team_protocol.is_none() {
        chat_presets.team_protocol = defaults.team_protocol;
    }
}

fn default_chat_presets() -> ChatPresetsConfig {
    let mut chat_presets = PresetLoader::load_builtin_presets();
    chat_presets.team_protocol = Some(String::new());
    chat_presets
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub struct Config {
    pub config_version: String,
    pub theme: ThemeMode,
    pub executor_profile: ExecutorProfileId,
    pub disclaimer_acknowledged: bool,
    pub onboarding_acknowledged: bool,
    pub notifications: NotificationConfig,
    pub editor: EditorConfig,
    pub github: GitHubConfig,
    pub analytics_enabled: bool,
    pub workspace_dir: Option<String>,
    pub last_app_version: Option<String>,
    pub show_release_notes: bool,
    #[serde(default)]
    pub language: UiLanguage,
    #[serde(default = "default_git_branch_prefix")]
    pub git_branch_prefix: String,
    #[serde(default)]
    pub showcases: ShowcaseState,
    #[serde(default = "default_pr_auto_description_enabled")]
    pub pr_auto_description_enabled: bool,
    #[serde(default)]
    pub pr_auto_description_prompt: Option<String>,
    #[serde(default)]
    pub beta_workspaces: bool,
    #[serde(default)]
    pub beta_workspaces_invitation_sent: bool,
    #[serde(default = "default_commit_reminder_enabled")]
    pub commit_reminder_enabled: bool,
    #[serde(default)]
    pub commit_reminder_prompt: Option<String>,
    #[serde(default)]
    pub send_message_shortcut: SendMessageShortcut,
    /// Chat presets configuration (member and team templates)
    #[serde(default = "default_chat_presets")]
    pub chat_presets: ChatPresetsConfig,
    /// Chat compression configuration
    #[serde(default = "default_chat_compression")]
    pub chat_compression: ChatCompressionConfig,
}

impl Config {
    fn with_completed_chat_presets(mut self) -> Self {
        complete_chat_presets_with_builtins(&mut self.chat_presets);
        self
    }

    fn from_v8_config(old_config: v8::Config) -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: old_config.theme,
            executor_profile: old_config.executor_profile,
            disclaimer_acknowledged: old_config.disclaimer_acknowledged,
            onboarding_acknowledged: old_config.onboarding_acknowledged,
            notifications: old_config.notifications,
            editor: old_config.editor,
            github: old_config.github,
            analytics_enabled: old_config.analytics_enabled,
            workspace_dir: old_config.workspace_dir,
            last_app_version: old_config.last_app_version,
            show_release_notes: old_config.show_release_notes,
            language: old_config.language,
            git_branch_prefix: old_config.git_branch_prefix,
            showcases: old_config.showcases,
            pr_auto_description_enabled: old_config.pr_auto_description_enabled,
            pr_auto_description_prompt: old_config.pr_auto_description_prompt,
            beta_workspaces: old_config.beta_workspaces,
            beta_workspaces_invitation_sent: old_config.beta_workspaces_invitation_sent,
            commit_reminder_enabled: old_config.commit_reminder_enabled,
            commit_reminder_prompt: old_config.commit_reminder_prompt,
            send_message_shortcut: old_config.send_message_shortcut,
            chat_presets: default_chat_presets(),
            chat_compression: ChatCompressionConfig::default(),
        }
        .with_completed_chat_presets()
    }

    pub fn from_previous_version(raw_config: &str) -> Result<Self, Error> {
        let old_config = v8::Config::from(raw_config.to_string());
        Ok(Self::from_v8_config(old_config))
    }
}

impl From<String> for Config {
    fn from(raw_config: String) -> Self {
        if let Ok(config) = serde_json::from_str::<Config>(&raw_config)
            && config.config_version == "v9"
        {
            return config.with_completed_chat_presets();
        }

        match Self::from_previous_version(&raw_config) {
            Ok(config) => {
                tracing::info!("Config upgraded to v9");
                config.with_completed_chat_presets()
            }
            Err(e) => {
                tracing::warn!("Config migration failed: {}, using default", e);
                Self::default().with_completed_chat_presets()
            }
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: ThemeMode::Light,
            executor_profile: ExecutorProfileId::new(BaseCodingAgent::OpenTeamsCli),
            disclaimer_acknowledged: false,
            onboarding_acknowledged: false,
            notifications: NotificationConfig::default(),
            editor: EditorConfig::default(),
            github: GitHubConfig::default(),
            analytics_enabled: true,
            workspace_dir: None,
            last_app_version: None,
            show_release_notes: false,
            language: UiLanguage::default(),
            git_branch_prefix: default_git_branch_prefix(),
            showcases: ShowcaseState::default(),
            pr_auto_description_enabled: true,
            pr_auto_description_prompt: None,
            beta_workspaces: false,
            beta_workspaces_invitation_sent: false,
            commit_reminder_enabled: true,
            commit_reminder_prompt: None,
            send_message_shortcut: SendMessageShortcut::default(),
            chat_presets: default_chat_presets(),
            chat_compression: ChatCompressionConfig::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use utils::path::home_directory;

    use super::*;

    #[test]
    fn complete_chat_presets_clears_legacy_default_team_protocol() {
        let mut chat_presets = default_chat_presets();
        chat_presets.team_protocol = Some(PresetLoader::load_team_protocol());

        complete_chat_presets_with_builtins(&mut chat_presets);

        assert_eq!(chat_presets.team_protocol.as_deref(), Some(""));
    }

    #[test]
    fn complete_chat_presets_refreshes_builtin_workspace_path() {
        let mut chat_presets = default_chat_presets();
        let expected_workspace = home_directory().to_string_lossy().to_string();

        let builtin = chat_presets
            .members
            .iter_mut()
            .find(|preset| preset.id == "backend_engineer")
            .expect("backend preset should exist");
        builtin.default_workspace_path = Some("backend".to_string());
        builtin.selected_skill_ids = vec![" skill_b ".to_string(), "skill_a".to_string()];

        complete_chat_presets_with_builtins(&mut chat_presets);

        let builtin = chat_presets
            .members
            .iter()
            .find(|preset| preset.id == "backend_engineer")
            .expect("backend preset should exist");
        assert_eq!(
            builtin.default_workspace_path.as_deref(),
            Some(expected_workspace.as_str())
        );
        assert!(builtin.selected_skill_ids.is_empty());
    }

    #[test]
    fn complete_chat_presets_refreshes_custom_workspace_path() {
        let mut chat_presets = default_chat_presets();
        let expected_workspace = home_directory().to_string_lossy().to_string();

        chat_presets.members.push(ChatMemberPreset {
            id: "custom_member".to_string(),
            name: "custom_member".to_string(),
            description: "Custom member".to_string(),
            runner_type: None,
            recommended_model: None,
            system_prompt: "Prompt".to_string(),
            default_workspace_path: Some("E:/workspace/custom".to_string()),
            selected_skill_ids: vec![],
            tools_enabled: serde_json::json!({}),
            is_builtin: false,
            enabled: true,
        });

        complete_chat_presets_with_builtins(&mut chat_presets);

        let custom = chat_presets
            .members
            .iter()
            .find(|preset| preset.id == "custom_member")
            .expect("custom preset should exist");
        assert_eq!(
            custom.default_workspace_path.as_deref(),
            Some(expected_workspace.as_str())
        );
    }

    #[test]
    fn team_preset_deserializes_missing_team_protocol() {
        let preset: ChatTeamPreset = serde_json::from_value(json!({
            "id": "custom_team",
            "name": "Custom Team",
            "description": "Custom description",
            "member_ids": ["backend_engineer"],
            "is_builtin": false,
            "enabled": true
        }))
        .expect("team preset should deserialize");

        assert_eq!(preset.team_protocol, "");
    }

    #[test]
    fn default_chat_presets_loads_builtin_team_metadata_from_markdown() {
        let chat_presets = default_chat_presets();

        let planner = chat_presets
            .members
            .iter()
            .find(|preset| preset.id == "coordinator_pmo")
            .expect("planner preset should exist");
        assert_eq!(planner.runner_type.as_deref(), Some("OPENCODE"));
        assert_eq!(planner.recommended_model.as_deref(), Some("glm-5"));

        let fullstack = chat_presets
            .teams
            .iter()
            .find(|preset| preset.id == "fullstack_delivery_team")
            .expect("fullstack team should exist");

        assert_eq!(fullstack.name, "Full-stack Delivery Team");
        assert_eq!(
            fullstack.description,
            "Planner-led web delivery across design, frontend, backend, QA, and review."
        );
        assert_eq!(
            fullstack.member_ids,
            vec![
                "coordinator_pmo".to_string(),
                "ux_ui_designer".to_string(),
                "backend_engineer".to_string(),
                "frontend_engineer".to_string(),
                "qa_tester".to_string(),
                "code_reviewer".to_string(),
            ]
        );
        assert!(!fullstack.team_protocol.trim().is_empty());
        assert!(
            fullstack
                .team_protocol
                .contains("Only the Planner (Coordinator / PMO) and the UI Designer (UX/UI Designer) may directly `@` the user.")
        );
    }

    #[test]
    fn complete_chat_presets_preserves_customized_builtin_team_protocol() {
        let mut chat_presets = default_chat_presets();
        let team = chat_presets
            .teams
            .iter_mut()
            .find(|preset| preset.id == "rapid_bugfix_team")
            .expect("rapid bugfix team should exist");
        team.team_protocol = "Custom rapid response protocol".to_string();

        complete_chat_presets_with_builtins(&mut chat_presets);

        let team = chat_presets
            .teams
            .iter()
            .find(|preset| preset.id == "rapid_bugfix_team")
            .expect("rapid bugfix team should exist");
        assert_eq!(team.team_protocol, "Custom rapid response protocol");
    }
}
