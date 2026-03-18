use std::collections::HashSet;

use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use utils::path::home_directory;

use crate::services::config::versions::v9::{ChatMemberPreset, ChatPresetsConfig, ChatTeamPreset};

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
    // New agents (144 total) - alphabetically sorted
    (
        "accessibility-auditor.md",
        include_str!("presets/roles/accessibility-auditor.md"),
    ),
    (
        "account-strategist.md",
        include_str!("presets/roles/account-strategist.md"),
    ),
    (
        "accounts-payable-agent.md",
        include_str!("presets/roles/accounts-payable-agent.md"),
    ),
    (
        "ad-creative-strategist.md",
        include_str!("presets/roles/ad-creative-strategist.md"),
    ),
    (
        "agentic-identity-trust-architect.md",
        include_str!("presets/roles/agentic-identity-trust-architect.md"),
    ),
    (
        "agents-orchestrator.md",
        include_str!("presets/roles/agents-orchestrator.md"),
    ),
    (
        "ai-data-remediation-engineer.md",
        include_str!("presets/roles/ai-data-remediation-engineer.md"),
    ),
    (
        "ai-engineer.md",
        include_str!("presets/roles/ai-engineer.md"),
    ),
    (
        "analytics-reporter.md",
        include_str!("presets/roles/analytics-reporter.md"),
    ),
    ("api-tester.md", include_str!("presets/roles/api-tester.md")),
    (
        "app-store-optimizer.md",
        include_str!("presets/roles/app-store-optimizer.md"),
    ),
    (
        "automation-governance-architect.md",
        include_str!("presets/roles/automation-governance-architect.md"),
    ),
    (
        "autonomous-optimization-architect.md",
        include_str!("presets/roles/autonomous-optimization-architect.md"),
    ),
    (
        "backend-architect.md",
        include_str!("presets/roles/backend-architect.md"),
    ),
    (
        "baidu-seo-specialist.md",
        include_str!("presets/roles/baidu-seo-specialist.md"),
    ),
    (
        "behavioral-nudge-engine.md",
        include_str!("presets/roles/behavioral-nudge-engine.md"),
    ),
    (
        "bilibili-content-strategist.md",
        include_str!("presets/roles/bilibili-content-strategist.md"),
    ),
    (
        "blockchain-security-auditor.md",
        include_str!("presets/roles/blockchain-security-auditor.md"),
    ),
    (
        "book-co-author.md",
        include_str!("presets/roles/book-co-author.md"),
    ),
    (
        "brand-guardian.md",
        include_str!("presets/roles/brand-guardian.md"),
    ),
    (
        "carousel-growth-engine.md",
        include_str!("presets/roles/carousel-growth-engine.md"),
    ),
    (
        "china-e-commerce-operator.md",
        include_str!("presets/roles/china-e-commerce-operator.md"),
    ),
    (
        "code-reviewer.md",
        include_str!("presets/roles/code-reviewer.md"),
    ),
    (
        "compliance-auditor.md",
        include_str!("presets/roles/compliance-auditor.md"),
    ),
    (
        "content-creator.md",
        include_str!("presets/roles/content-creator.md"),
    ),
    (
        "corporate-training-designer.md",
        include_str!("presets/roles/corporate-training-designer.md"),
    ),
    (
        "cross-border-e-commerce-specialist.md",
        include_str!("presets/roles/cross-border-e-commerce-specialist.md"),
    ),
    (
        "cultural-intelligence-strategist.md",
        include_str!("presets/roles/cultural-intelligence-strategist.md"),
    ),
    (
        "data-consolidation-agent.md",
        include_str!("presets/roles/data-consolidation-agent.md"),
    ),
    (
        "data-engineer.md",
        include_str!("presets/roles/data-engineer.md"),
    ),
    (
        "database-optimizer.md",
        include_str!("presets/roles/database-optimizer.md"),
    ),
    (
        "deal-strategist.md",
        include_str!("presets/roles/deal-strategist.md"),
    ),
    (
        "developer-advocate.md",
        include_str!("presets/roles/developer-advocate.md"),
    ),
    (
        "devops-automator.md",
        include_str!("presets/roles/devops-automator.md"),
    ),
    (
        "discovery-coach.md",
        include_str!("presets/roles/discovery-coach.md"),
    ),
    (
        "document-generator.md",
        include_str!("presets/roles/document-generator.md"),
    ),
    (
        "douyin-strategist.md",
        include_str!("presets/roles/douyin-strategist.md"),
    ),
    (
        "embedded-firmware-engineer.md",
        include_str!("presets/roles/embedded-firmware-engineer.md"),
    ),
    (
        "evidence-collector.md",
        include_str!("presets/roles/evidence-collector.md"),
    ),
    (
        "executive-summary-generator.md",
        include_str!("presets/roles/executive-summary-generator.md"),
    ),
    (
        "experiment-tracker.md",
        include_str!("presets/roles/experiment-tracker.md"),
    ),
    (
        "feedback-synthesizer.md",
        include_str!("presets/roles/feedback-synthesizer.md"),
    ),
    (
        "feishu-integration-developer.md",
        include_str!("presets/roles/feishu-integration-developer.md"),
    ),
    (
        "finance-tracker.md",
        include_str!("presets/roles/finance-tracker.md"),
    ),
    (
        "frontend-developer.md",
        include_str!("presets/roles/frontend-developer.md"),
    ),
    (
        "game-audio-engineer.md",
        include_str!("presets/roles/game-audio-engineer.md"),
    ),
    (
        "game-designer.md",
        include_str!("presets/roles/game-designer.md"),
    ),
    (
        "git-workflow-master.md",
        include_str!("presets/roles/git-workflow-master.md"),
    ),
    (
        "godot-gameplay-scripter.md",
        include_str!("presets/roles/godot-gameplay-scripter.md"),
    ),
    (
        "godot-multiplayer-engineer.md",
        include_str!("presets/roles/godot-multiplayer-engineer.md"),
    ),
    (
        "godot-shader-developer.md",
        include_str!("presets/roles/godot-shader-developer.md"),
    ),
    (
        "government-digital-presales-consultant.md",
        include_str!("presets/roles/government-digital-presales-consultant.md"),
    ),
    (
        "growth-hacker.md",
        include_str!("presets/roles/growth-hacker.md"),
    ),
    (
        "healthcare-marketing-compliance-specialist.md",
        include_str!("presets/roles/healthcare-marketing-compliance-specialist.md"),
    ),
    (
        "identity-graph-operator.md",
        include_str!("presets/roles/identity-graph-operator.md"),
    ),
    (
        "image-prompt-engineer.md",
        include_str!("presets/roles/image-prompt-engineer.md"),
    ),
    (
        "incident-response-commander.md",
        include_str!("presets/roles/incident-response-commander.md"),
    ),
    (
        "inclusive-visuals-specialist.md",
        include_str!("presets/roles/inclusive-visuals-specialist.md"),
    ),
    (
        "infrastructure-maintainer.md",
        include_str!("presets/roles/infrastructure-maintainer.md"),
    ),
    (
        "instagram-curator.md",
        include_str!("presets/roles/instagram-curator.md"),
    ),
    (
        "jira-workflow-steward.md",
        include_str!("presets/roles/jira-workflow-steward.md"),
    ),
    (
        "kuaishou-strategist.md",
        include_str!("presets/roles/kuaishou-strategist.md"),
    ),
    (
        "legal-compliance-checker.md",
        include_str!("presets/roles/legal-compliance-checker.md"),
    ),
    (
        "level-designer.md",
        include_str!("presets/roles/level-designer.md"),
    ),
    (
        "linkedin-content-creator.md",
        include_str!("presets/roles/linkedin-content-creator.md"),
    ),
    (
        "livestream-commerce-coach.md",
        include_str!("presets/roles/livestream-commerce-coach.md"),
    ),
    (
        "lsp-index-engineer.md",
        include_str!("presets/roles/lsp-index-engineer.md"),
    ),
    (
        "macos-spatial-metal-engineer.md",
        include_str!("presets/roles/macos-spatial-metal-engineer.md"),
    ),
    (
        "mcp-builder.md",
        include_str!("presets/roles/mcp-builder.md"),
    ),
    (
        "mobile-app-builder.md",
        include_str!("presets/roles/mobile-app-builder.md"),
    ),
    (
        "model-qa-specialist.md",
        include_str!("presets/roles/model-qa-specialist.md"),
    ),
    (
        "narrative-designer.md",
        include_str!("presets/roles/narrative-designer.md"),
    ),
    (
        "outbound-strategist.md",
        include_str!("presets/roles/outbound-strategist.md"),
    ),
    (
        "paid-media-auditor.md",
        include_str!("presets/roles/paid-media-auditor.md"),
    ),
    (
        "paid-social-strategist.md",
        include_str!("presets/roles/paid-social-strategist.md"),
    ),
    (
        "performance-benchmarker.md",
        include_str!("presets/roles/performance-benchmarker.md"),
    ),
    (
        "pipeline-analyst.md",
        include_str!("presets/roles/pipeline-analyst.md"),
    ),
    (
        "podcast-strategist.md",
        include_str!("presets/roles/podcast-strategist.md"),
    ),
    (
        "ppc-campaign-strategist.md",
        include_str!("presets/roles/ppc-campaign-strategist.md"),
    ),
    (
        "private-domain-operator.md",
        include_str!("presets/roles/private-domain-operator.md"),
    ),
    (
        "programmatic-display-buyer.md",
        include_str!("presets/roles/programmatic-display-buyer.md"),
    ),
    (
        "project-shepherd.md",
        include_str!("presets/roles/project-shepherd.md"),
    ),
    (
        "proposal-strategist.md",
        include_str!("presets/roles/proposal-strategist.md"),
    ),
    (
        "rapid-prototyper.md",
        include_str!("presets/roles/rapid-prototyper.md"),
    ),
    (
        "reality-checker.md",
        include_str!("presets/roles/reality-checker.md"),
    ),
    (
        "recruitment-specialist.md",
        include_str!("presets/roles/recruitment-specialist.md"),
    ),
    (
        "reddit-community-builder.md",
        include_str!("presets/roles/reddit-community-builder.md"),
    ),
    (
        "report-distribution-agent.md",
        include_str!("presets/roles/report-distribution-agent.md"),
    ),
    (
        "roblox-avatar-creator.md",
        include_str!("presets/roles/roblox-avatar-creator.md"),
    ),
    (
        "roblox-experience-designer.md",
        include_str!("presets/roles/roblox-experience-designer.md"),
    ),
    (
        "roblox-systems-scripter.md",
        include_str!("presets/roles/roblox-systems-scripter.md"),
    ),
    (
        "sales-coach.md",
        include_str!("presets/roles/sales-coach.md"),
    ),
    (
        "sales-data-extraction-agent.md",
        include_str!("presets/roles/sales-data-extraction-agent.md"),
    ),
    (
        "sales-engineer.md",
        include_str!("presets/roles/sales-engineer.md"),
    ),
    (
        "search-query-analyst.md",
        include_str!("presets/roles/search-query-analyst.md"),
    ),
    (
        "security-engineer.md",
        include_str!("presets/roles/security-engineer.md"),
    ),
    (
        "senior-developer.md",
        include_str!("presets/roles/senior-developer.md"),
    ),
    (
        "senior-project-manager.md",
        include_str!("presets/roles/senior-project-manager.md"),
    ),
    (
        "seo-specialist.md",
        include_str!("presets/roles/seo-specialist.md"),
    ),
    (
        "short-video-editing-coach.md",
        include_str!("presets/roles/short-video-editing-coach.md"),
    ),
    (
        "social-media-strategist.md",
        include_str!("presets/roles/social-media-strategist.md"),
    ),
    (
        "software-architect.md",
        include_str!("presets/roles/software-architect.md"),
    ),
    (
        "solidity-smart-contract-engineer.md",
        include_str!("presets/roles/solidity-smart-contract-engineer.md"),
    ),
    (
        "sprint-prioritizer.md",
        include_str!("presets/roles/sprint-prioritizer.md"),
    ),
    (
        "sre-site-reliability-engineer.md",
        include_str!("presets/roles/sre-site-reliability-engineer.md"),
    ),
    (
        "studio-operations.md",
        include_str!("presets/roles/studio-operations.md"),
    ),
    (
        "studio-producer.md",
        include_str!("presets/roles/studio-producer.md"),
    ),
    (
        "study-abroad-advisor.md",
        include_str!("presets/roles/study-abroad-advisor.md"),
    ),
    (
        "supply-chain-strategist.md",
        include_str!("presets/roles/supply-chain-strategist.md"),
    ),
    (
        "support-responder.md",
        include_str!("presets/roles/support-responder.md"),
    ),
    (
        "technical-artist.md",
        include_str!("presets/roles/technical-artist.md"),
    ),
    (
        "technical-writer.md",
        include_str!("presets/roles/technical-writer.md"),
    ),
    (
        "terminal-integration-specialist.md",
        include_str!("presets/roles/terminal-integration-specialist.md"),
    ),
    (
        "test-results-analyzer.md",
        include_str!("presets/roles/test-results-analyzer.md"),
    ),
    (
        "threat-detection-engineer.md",
        include_str!("presets/roles/threat-detection-engineer.md"),
    ),
    (
        "tiktok-strategist.md",
        include_str!("presets/roles/tiktok-strategist.md"),
    ),
    (
        "tool-evaluator.md",
        include_str!("presets/roles/tool-evaluator.md"),
    ),
    (
        "tracking-measurement-specialist.md",
        include_str!("presets/roles/tracking-measurement-specialist.md"),
    ),
    (
        "trend-researcher.md",
        include_str!("presets/roles/trend-researcher.md"),
    ),
    (
        "twitter-engager.md",
        include_str!("presets/roles/twitter-engager.md"),
    ),
    (
        "ui-designer.md",
        include_str!("presets/roles/ui-designer.md"),
    ),
    (
        "unity-architect.md",
        include_str!("presets/roles/unity-architect.md"),
    ),
    (
        "unity-editor-tool-developer.md",
        include_str!("presets/roles/unity-editor-tool-developer.md"),
    ),
    (
        "unity-multiplayer-engineer.md",
        include_str!("presets/roles/unity-multiplayer-engineer.md"),
    ),
    (
        "unity-shader-graph-artist.md",
        include_str!("presets/roles/unity-shader-graph-artist.md"),
    ),
    (
        "unreal-multiplayer-architect.md",
        include_str!("presets/roles/unreal-multiplayer-architect.md"),
    ),
    (
        "unreal-systems-engineer.md",
        include_str!("presets/roles/unreal-systems-engineer.md"),
    ),
    (
        "unreal-technical-artist.md",
        include_str!("presets/roles/unreal-technical-artist.md"),
    ),
    (
        "unreal-world-builder.md",
        include_str!("presets/roles/unreal-world-builder.md"),
    ),
    (
        "ux-architect.md",
        include_str!("presets/roles/ux-architect.md"),
    ),
    (
        "ux-researcher.md",
        include_str!("presets/roles/ux-researcher.md"),
    ),
    (
        "visionos-spatial-engineer.md",
        include_str!("presets/roles/visionos-spatial-engineer.md"),
    ),
    (
        "visual-storyteller.md",
        include_str!("presets/roles/visual-storyteller.md"),
    ),
    (
        "wechat-mini-program-developer.md",
        include_str!("presets/roles/wechat-mini-program-developer.md"),
    ),
    (
        "wechat-official-account-manager.md",
        include_str!("presets/roles/wechat-official-account-manager.md"),
    ),
    (
        "weibo-strategist.md",
        include_str!("presets/roles/weibo-strategist.md"),
    ),
    (
        "whimsy-injector.md",
        include_str!("presets/roles/whimsy-injector.md"),
    ),
    (
        "workflow-optimizer.md",
        include_str!("presets/roles/workflow-optimizer.md"),
    ),
    (
        "xiaohongshu-specialist.md",
        include_str!("presets/roles/xiaohongshu-specialist.md"),
    ),
    (
        "xr-cockpit-interaction-specialist.md",
        include_str!("presets/roles/xr-cockpit-interaction-specialist.md"),
    ),
    (
        "xr-immersive-developer.md",
        include_str!("presets/roles/xr-immersive-developer.md"),
    ),
    (
        "xr-interface-architect.md",
        include_str!("presets/roles/xr-interface-architect.md"),
    ),
    (
        "zhihu-strategist.md",
        include_str!("presets/roles/zhihu-strategist.md"),
    ),
    ("zk-steward.md", include_str!("presets/roles/zk-steward.md")),
];

const TEAM_PRESET_MARKDOWN: &[(&str, &str)] = &[
    (
        "fullstack_delivery_team.md",
        include_str!("presets/protocol/fullstack_delivery_team.md"),
    ),
    (
        "ai_prompt_quality_team.md",
        include_str!("presets/protocol/ai_prompt_quality_team.md"),
    ),
    (
        "architecture_governance_team.md",
        include_str!("presets/protocol/architecture_governance_team.md"),
    ),
    (
        "product_discovery_team.md",
        include_str!("presets/protocol/product_discovery_team.md"),
    ),
    (
        "content_studio_team.md",
        include_str!("presets/protocol/content_studio_team.md"),
    ),
    (
        "growth_marketing_team.md",
        include_str!("presets/protocol/growth_marketing_team.md"),
    ),
    (
        "research_innovation_team.md",
        include_str!("presets/protocol/research_innovation_team.md"),
    ),
    (
        "rapid_bugfix_team.md",
        include_str!("presets/protocol/rapid_bugfix_team.md"),
    ),
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
    recommended_model: Option<String>,
    #[serde(default)]
    tools_enabled: Option<serde_yaml::Value>,
}

#[derive(Debug, PartialEq, Eq)]
struct RolePresetMd {
    id: String,
    name: String,
    description: String,
    role_definition: String,
    default_workspace_path: Option<String>,
    selected_skill_ids: Vec<String>,
    runner_type: Option<String>,
    recommended_model: Option<String>,
    tools_enabled: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct TeamPresetFrontmatter {
    id: String,
    name: String,
    description: String,
    member_ids: Vec<String>,
}

pub struct PresetLoader;

impl PresetLoader {
    pub fn load_builtin_presets() -> ChatPresetsConfig {
        let default_workspace_path = home_directory().to_string_lossy().to_string();
        let members = ROLE_PRESET_MARKDOWN
            .iter()
            .map(|(path, raw)| Self::parse_chat_member_preset(path, raw, &default_workspace_path))
            .collect::<Result<Vec<_>>>()
            .expect("built-in role preset markdown should be valid");
        let teams = TEAM_PRESET_MARKDOWN
            .iter()
            .map(|(path, raw)| Self::parse_team_preset_markdown(path, raw))
            .collect::<Result<Vec<_>>>()
            .expect("built-in team preset markdown should be valid");

        ChatPresetsConfig {
            members,
            teams,
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
        default_workspace_path: &str,
    ) -> Result<ChatMemberPreset> {
        let preset = Self::parse_role_preset_markdown(path, raw)?;
        Ok(ChatMemberPreset {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            runner_type: preset.runner_type,
            recommended_model: preset.recommended_model,
            system_prompt: preset.role_definition,
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
        let role_definition = body.trim().to_string();

        if frontmatter.id.trim().is_empty()
            || frontmatter.name.trim().is_empty()
            || frontmatter.description.trim().is_empty()
        {
            bail!("role preset frontmatter contains empty required fields in {path}");
        }
        if role_definition.is_empty() {
            bail!("role preset body is empty in {path}");
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
            role_definition,
            default_workspace_path: frontmatter.default_workspace,
            selected_skill_ids: normalize_selected_skill_ids(frontmatter.selected_skill_ids),
            runner_type: frontmatter.runner_type,
            recommended_model: frontmatter.recommended_model,
            tools_enabled,
        })
    }

    fn parse_team_preset_markdown(path: &str, raw: &str) -> Result<ChatTeamPreset> {
        let normalized = normalize_newlines(raw);
        let (frontmatter_raw, body) = split_frontmatter(&normalized)
            .ok_or_else(|| anyhow!("missing frontmatter delimiters in {path}"))?;
        let frontmatter: TeamPresetFrontmatter = serde_yaml::from_str(frontmatter_raw)
            .with_context(|| format!("failed to parse frontmatter in {path}"))?;

        if frontmatter.id.trim().is_empty()
            || frontmatter.name.trim().is_empty()
            || frontmatter.description.trim().is_empty()
        {
            bail!("team preset frontmatter contains empty required fields in {path}");
        }

        let member_ids = normalize_member_ids(frontmatter.member_ids);
        if member_ids.is_empty() {
            bail!("team preset contains no member_ids in {path}");
        }

        Ok(ChatTeamPreset {
            id: frontmatter.id,
            name: frontmatter.name,
            description: frontmatter.description,
            member_ids,
            team_protocol: body.trim().to_string(),
            is_builtin: true,
            enabled: true,
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

fn normalize_member_ids(member_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    member_ids
        .into_iter()
        .map(|member_id| member_id.trim().to_string())
        .filter(|member_id| !member_id.is_empty())
        .filter(|member_id| seen.insert(member_id.clone()))
        .collect()
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

#[cfg(test)]
mod tests {
    use utils::path::home_directory;

    use super::PresetLoader;

    #[test]
    fn load_builtin_presets_reads_all_builtin_preset_markdown_files() {
        let presets = PresetLoader::load_builtin_presets();

        assert_eq!(presets.members.len(), 166); // 22 original + 144 new
        assert_eq!(presets.teams.len(), 8);

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
            !fullstack
                .system_prompt
                .contains("Team Collaboration Protocol")
        );
        assert!(
            fullstack
                .system_prompt
                .contains("API-to-UI contract alignment and schema evolution control.")
        );

        let planner = presets
            .members
            .iter()
            .find(|preset| preset.id == "coordinator_pmo")
            .expect("planner preset should exist");
        assert_eq!(planner.runner_type.as_deref(), Some("OPENCODE"));
        assert_eq!(planner.recommended_model.as_deref(), Some("glm-5"));

        let designer = presets
            .members
            .iter()
            .find(|preset| preset.id == "ux_ui_designer")
            .expect("designer preset should exist");
        assert_eq!(designer.runner_type.as_deref(), Some("GEMINI"));
        assert_eq!(
            designer.recommended_model.as_deref(),
            Some("gemini-3-pro-preview")
        );

        let team = presets
            .teams
            .iter()
            .find(|preset| preset.id == "fullstack_delivery_team")
            .expect("fullstack team preset should exist");
        assert_eq!(team.name, "Full-stack Delivery Team");
        assert_eq!(
            team.description,
            "Planner-led web delivery across design, frontend, backend, QA, and review."
        );
        assert_eq!(
            team.member_ids,
            vec![
                "coordinator_pmo".to_string(),
                "ux_ui_designer".to_string(),
                "backend_engineer".to_string(),
                "frontend_engineer".to_string(),
                "qa_tester".to_string(),
                "code_reviewer".to_string(),
            ]
        );
        assert!(
            team.team_protocol
                .contains("Only the Planner (Coordinator / PMO) and the UI Designer (UX/UI Designer) may directly `@` the user.")
        );
    }

    #[test]
    fn load_team_protocol_returns_embedded_markdown_content() {
        let protocol = PresetLoader::load_team_protocol();

        assert_eq!(protocol, "no team collaboration protocol");
    }

    #[test]
    fn parse_role_preset_markdown_extracts_frontmatter_and_role_definition() {
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
recommended_model: gpt-5.3-codex
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

## Collaboration Notes
Coordinate with design before shipping.
"#;

        let parsed = PresetLoader::parse_role_preset_markdown("sample.md", markdown).unwrap();

        assert_eq!(parsed.id, "sample_role");
        assert_eq!(parsed.name, "sample");
        assert_eq!(parsed.description, "Sample role");
        assert_eq!(
            parsed.role_definition,
            r#"# Role: Sample Role

## Goal
Ship a sample workflow.

## Role Focus
- Keep the contract explicit.
- Provide reproducible evidence.

## Definition of Done
The sample is shippable.

## Collaboration Notes
Coordinate with design before shipping."#
        );
        assert_eq!(parsed.default_workspace_path.as_deref(), Some("samples"));
        assert_eq!(
            parsed.selected_skill_ids,
            vec!["skill_a".to_string(), "skill_b".to_string()]
        );
        assert_eq!(parsed.runner_type.as_deref(), Some("codex"));
        assert_eq!(parsed.recommended_model.as_deref(), Some("gpt-5.3-codex"));
        assert_eq!(parsed.tools_enabled, serde_json::json!({ "shell": true }));
    }

    #[test]
    fn parse_team_preset_markdown_extracts_frontmatter_members_and_protocol() {
        let markdown = r#"---
id: sample_team
name: Sample Team
description: Team description
member_ids:
  - backend_engineer
  - frontend_engineer
  - backend_engineer
---

Coordinate tightly and document every handoff.
- Backend owns API behavior.
- Frontend owns UX delivery.
"#;

        let parsed = PresetLoader::parse_team_preset_markdown("sample_team.md", markdown).unwrap();

        assert_eq!(parsed.id, "sample_team");
        assert_eq!(parsed.name, "Sample Team");
        assert_eq!(parsed.description, "Team description");
        assert_eq!(
            parsed.member_ids,
            vec![
                "backend_engineer".to_string(),
                "frontend_engineer".to_string()
            ]
        );
        assert_eq!(
            parsed.team_protocol,
            "Coordinate tightly and document every handoff.\n- Backend owns API behavior.\n- Frontend owns UX delivery."
        );
        assert!(parsed.is_builtin);
        assert!(parsed.enabled);
    }

    #[test]
    fn preset_ids_are_unique() {
        let presets = PresetLoader::load_builtin_presets();
        let mut seen = std::collections::HashSet::new();

        for preset in &presets.members {
            assert!(
                seen.insert(&preset.id),
                "Duplicate preset ID found: {}",
                preset.id
            );
        }

        assert_eq!(seen.len(), 166);
    }

    #[test]
    fn all_presets_have_required_fields() {
        let presets = PresetLoader::load_builtin_presets();

        for preset in &presets.members {
            assert!(!preset.id.is_empty(), "Preset has empty ID");
            assert!(
                !preset.name.is_empty(),
                "Preset {} has empty name",
                preset.id
            );
            assert!(
                !preset.description.is_empty(),
                "Preset {} has empty description",
                preset.id
            );
            assert!(
                !preset.system_prompt.is_empty(),
                "Preset {} has empty system_prompt",
                preset.id
            );
        }
    }

    #[test]
    fn original_22_presets_still_exist() {
        let presets = PresetLoader::load_builtin_presets();
        let original_ids = vec![
            "coordinator_pmo",
            "product_manager",
            "system_architect",
            "prompt_engineer",
            "frontend_engineer",
            "backend_engineer",
            "fullstack_engineer",
            "qa_tester",
            "ux_ui_designer",
            "safety_policy_officer",
            "solution_manager",
            "code_reviewer",
            "devops_engineer",
            "product_analyst",
            "data_analyst",
            "technical_writer",
            "content_researcher",
            "content_editor",
            "frontier_researcher",
            "marketing_specialist",
            "video_editor",
            "market_analyst",
        ];

        for id in original_ids {
            assert!(
                presets.members.iter().any(|p| p.id == id),
                "Original preset {} is missing",
                id
            );
        }
    }

    #[test]
    fn new_presets_have_metadata() {
        let presets = PresetLoader::load_builtin_presets();

        // Count presets with metadata
        let mut with_metadata = 0;

        for preset in &presets.members {
            if let Some(metadata) = preset.tools_enabled.get("metadata") {
                // Verify metadata structure
                if let Some(category) = metadata.get("category") {
                    assert!(
                        category.is_string(),
                        "Preset {} has non-string category",
                        preset.id
                    );
                    with_metadata += 1;
                }
            }
        }

        // At least the 144 new presets should have metadata
        assert!(
            with_metadata >= 144,
            "Expected at least 144 presets with metadata, found {}",
            with_metadata
        );
    }
}
