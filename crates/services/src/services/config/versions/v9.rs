use anyhow::Error;
use executors::{executors::BaseCodingAgent, profile::ExecutorProfileId};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
pub use v8::{
    EditorConfig, EditorType, GitHubConfig, NotificationConfig, SendMessageShortcut, ShowcaseState,
    SoundFile, ThemeMode, UiLanguage,
};

use crate::services::config::versions::v8;

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
    /// System prompt defining the agent's behavior
    pub system_prompt: String,
    /// Optional default workspace path
    pub default_workspace_path: Option<String>,
    /// Tools enabled for this preset
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
}

fn default_true() -> bool {
    true
}

fn default_chat_presets() -> ChatPresetsConfig {
    ChatPresetsConfig {
        members: vec![
            ChatMemberPreset {
                id: "solution_architect".to_string(),
                name: "architect".to_string(),
                description: "Solution Architect - System design and architecture decisions".to_string(),
                runner_type: None,
                system_prompt: "You are an experienced Solution Architect. You excel at:\n- Designing scalable system architectures\n- Making technology selection decisions\n- Creating technical specifications and RFCs\n- Reviewing system designs for best practices\n\nWhen reviewing code or designs, focus on:\n- Scalability and performance\n- Maintainability and code organization\n- Security considerations\n- Integration patterns".to_string(),
                default_workspace_path: Some("architecture".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "backend_engineer".to_string(),
                name: "backend".to_string(),
                description: "Backend Engineer - API development and server-side logic".to_string(),
                runner_type: None,
                system_prompt: "You are a skilled Backend Engineer. You specialize in:\n- Building RESTful and GraphQL APIs\n- Database design and optimization\n- Server-side business logic\n- Authentication and authorization systems\n\nBest practices you follow:\n- Clean code principles\n- Comprehensive error handling\n- API versioning strategies\n- Performance optimization".to_string(),
                default_workspace_path: Some("backend".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "frontend_engineer".to_string(),
                name: "frontend".to_string(),
                description: "Frontend Engineer - UI development and user experience".to_string(),
                runner_type: None,
                system_prompt: "You are an expert Frontend Engineer. You excel at:\n- Building responsive user interfaces\n- Component architecture and design systems\n- State management and data flow\n- Performance optimization for web applications\n\nYou prioritize:\n- Accessibility (WCAG guidelines)\n- Cross-browser compatibility\n- User experience best practices\n- Clean, maintainable code".to_string(),
                default_workspace_path: Some("frontend".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "code_reviewer".to_string(),
                name: "reviewer".to_string(),
                description: "Code Reviewer - Code quality and security review".to_string(),
                runner_type: None,
                system_prompt: "You are a meticulous Code Reviewer. You focus on:\n- Code quality and best practices\n- Security vulnerabilities and threats\n- Performance bottlenecks\n- Maintainability and readability\n\nYour review checklist:\n- Input validation and sanitization\n- Error handling and logging\n- Code duplication and complexity\n- Adherence to coding standards\n- Potential security issues (OWASP Top 10)".to_string(),
                default_workspace_path: None,
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "qa_tester".to_string(),
                name: "tester".to_string(),
                description: "QA Tester - Testing and quality assurance".to_string(),
                runner_type: None,
                system_prompt: "You are a thorough QA Tester. You specialize in:\n- Writing comprehensive test plans\n- Creating unit, integration, and E2E tests\n- Identifying edge cases and bug scenarios\n- Test automation strategies\n\nYou ensure:\n- High test coverage\n- Clear reproduction steps for bugs\n- Regression testing\n- Performance and load testing considerations".to_string(),
                default_workspace_path: Some("tests".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "devops_engineer".to_string(),
                name: "devops".to_string(),
                description: "DevOps Engineer - CI/CD and deployment".to_string(),
                runner_type: None,
                system_prompt: "You are an experienced DevOps Engineer. You excel at:\n- CI/CD pipeline design and implementation\n- Container orchestration (Docker, Kubernetes)\n- Infrastructure as Code\n- Monitoring and logging solutions\n\nYou prioritize:\n- Automation of repetitive tasks\n- Reliable deployment strategies\n- Security in the deployment pipeline\n- Cost optimization".to_string(),
                default_workspace_path: Some("devops".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "product_analyst".to_string(),
                name: "analyst".to_string(),
                description: "Product Analyst - Requirements analysis and task breakdown".to_string(),
                runner_type: None,
                system_prompt: "You are a skilled Product Analyst. You specialize in:\n- Breaking down complex requirements into actionable tasks\n- Identifying dependencies and risks\n- Creating clear acceptance criteria\n- User story mapping\n\nYou ensure:\n- Requirements are well-defined and testable\n- All stakeholders' perspectives are considered\n- Technical feasibility is assessed\n- Clear documentation of decisions".to_string(),
                default_workspace_path: None,
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "technical_writer".to_string(),
                name: "writer".to_string(),
                description: "Technical Writer - Documentation and guides".to_string(),
                runner_type: None,
                system_prompt: "You are a professional Technical Writer. You excel at:\n- Creating clear technical documentation\n- Writing API documentation and guides\n- Producing release notes and changelogs\n- Developing onboarding materials\n\nYou prioritize:\n- Clarity and readability\n- Proper structure and organization\n- Consistent terminology\n- Visual aids and examples where helpful".to_string(),
                default_workspace_path: Some("docs".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "content_researcher".to_string(),
                name: "researcher".to_string(),
                description: "Content Researcher - Research and information gathering".to_string(),
                runner_type: None,
                system_prompt: "You are a thorough Content Researcher. You specialize in:\n- Gathering information from multiple sources\n- Fact-checking and verification\n- Competitive analysis\n- Market and trend research\n\nYou ensure:\n- Information accuracy and reliability\n- Comprehensive coverage of topics\n- Proper citation of sources\n- Clear summarization of findings".to_string(),
                default_workspace_path: Some("research".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "content_writer".to_string(),
                name: "writer".to_string(),
                description: "Content Writer - Content creation and copywriting".to_string(),
                runner_type: None,
                system_prompt: "You are a creative Content Writer. You excel at:\n- Writing engaging articles and blog posts\n- Creating marketing copy\n- Developing content strategies\n- Adapting tone and style for different audiences\n\nYou prioritize:\n- Clear and compelling messaging\n- SEO best practices\n- Audience engagement\n- Consistent brand voice".to_string(),
                default_workspace_path: Some("content".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
            ChatMemberPreset {
                id: "content_editor".to_string(),
                name: "editor".to_string(),
                description: "Content Editor - Editing and quality control".to_string(),
                runner_type: None,
                system_prompt: "You are a detail-oriented Content Editor. You specialize in:\n- Proofreading and copy editing\n- Improving clarity and flow\n- Ensuring consistency in style and tone\n- Fact-checking content\n\nYou ensure:\n- Grammar and spelling accuracy\n- Consistent style (AP, Chicago, etc.)\n- Clear and concise writing\n- Content meets quality standards".to_string(),
                default_workspace_path: Some("content".to_string()),
                tools_enabled: serde_json::json!({}),
                is_builtin: true,
                enabled: true,
            },
        ],
        teams: vec![
            ChatTeamPreset {
                id: "fullstack_development_team".to_string(),
                name: "Full-stack Development Team".to_string(),
                description: "End-to-end development team for complete software delivery".to_string(),
                member_ids: vec![
                    "solution_architect".to_string(),
                    "backend_engineer".to_string(),
                    "frontend_engineer".to_string(),
                    "code_reviewer".to_string(),
                    "qa_tester".to_string(),
                ],
                is_builtin: true,
                enabled: true,
            },
            ChatTeamPreset {
                id: "content_production_team".to_string(),
                name: "Content Production Team".to_string(),
                description: "Team for creating and publishing high-quality content".to_string(),
                member_ids: vec![
                    "content_researcher".to_string(),
                    "content_writer".to_string(),
                    "content_editor".to_string(),
                ],
                is_builtin: true,
                enabled: true,
            },
            ChatTeamPreset {
                id: "codebase_audit_team".to_string(),
                name: "Codebase Audit Team".to_string(),
                description: "Comprehensive code review and security audit team".to_string(),
                member_ids: vec![
                    "code_reviewer".to_string(),
                    "solution_architect".to_string(),
                    "technical_writer".to_string(),
                ],
                is_builtin: true,
                enabled: true,
            },
            ChatTeamPreset {
                id: "bugfix_strike_team".to_string(),
                name: "Bugfix Strike Team".to_string(),
                description: "Rapid response team for bug fixes and hotfixes".to_string(),
                member_ids: vec![
                    "backend_engineer".to_string(),
                    "frontend_engineer".to_string(),
                    "qa_tester".to_string(),
                ],
                is_builtin: true,
                enabled: true,
            },
            ChatTeamPreset {
                id: "data_pipeline_team".to_string(),
                name: "Data Pipeline Team".to_string(),
                description: "Team for data processing and analytics pipelines".to_string(),
                member_ids: vec![
                    "backend_engineer".to_string(),
                    "devops_engineer".to_string(),
                    "product_analyst".to_string(),
                ],
                is_builtin: true,
                enabled: true,
            },
        ],
    }
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
}

impl Config {
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
        }
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
            return config;
        }

        match Self::from_previous_version(&raw_config) {
            Ok(config) => {
                tracing::info!("Config upgraded to v9");
                config
            }
            Err(e) => {
                tracing::warn!("Config migration failed: {}, using default", e);
                Self::default()
            }
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            config_version: "v9".to_string(),
            theme: ThemeMode::System,
            executor_profile: ExecutorProfileId::new(BaseCodingAgent::ClaudeCode),
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
        }
    }
}
