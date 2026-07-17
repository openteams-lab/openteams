pub mod agent_activity_stream;
pub mod agent_runtime;
pub mod agent_skill_policy;
pub mod analytics;
pub mod analytics_events;
pub mod approvals;
pub mod auth;
pub mod build_stats;
pub mod chat;
pub mod chat_history_file;
pub mod chat_runner;
pub mod cli_config;
pub mod cli_manager;
pub mod config;
pub mod container;
pub mod events;
pub mod filesystem;
pub mod filesystem_watcher;
pub mod git_host;
pub mod github;
pub use github::{
    audit as github_audit, auth as github_auth, issue as github_issue,
    operation_approval as github_operation_approval, pr as github_pr,
    rest_client as github_rest_client, token_store as github_token_store,
};
pub mod image;
pub mod inbox;
pub mod member_execution;
pub use build_stats::{model_pricing_sync, project_stats, token_cost_stats};
pub mod native_skills;
pub mod notification;
pub mod oauth_credentials;
pub mod onboarding;
pub mod project;
pub use project::{
    delivery as project_delivery, member as project_member, migration as project_migration,
    path as project_path, source_control as project_source_control, work_item as project_work_item,
};
#[cfg(feature = "qa-mode")]
pub mod qa_repos;
pub mod queued_message;
pub mod remote_client;
pub mod repo;
pub mod repo_integration;
pub mod session_worktree;
pub mod skill_registry;
pub mod workflow;
pub use workflow::{
    workflow_analytics, workflow_compiler, workflow_iteration, workflow_loop_executor,
    workflow_orchestrator, workflow_review, workflow_runtime, workflow_validator,
};
pub mod workspace_change_capture;
pub mod worktree_manager;

pub(crate) const OPENTEAMS_PROMPT_SOURCE_MARKER: &str = "[OPENTEAMS_SOURCE=openteams]";

pub(crate) fn mark_openteams_prompt(prompt: &str) -> String {
    if prompt
        .trim_start()
        .starts_with(OPENTEAMS_PROMPT_SOURCE_MARKER)
    {
        prompt.to_string()
    } else {
        format!("{OPENTEAMS_PROMPT_SOURCE_MARKER}\n\n{prompt}")
    }
}
