/// Describes the business context of an agent prompt execution,
/// used to determine which builtin skills need to be pre-installed.
#[derive(Debug, Clone, Copy)]
pub enum AgentPromptContext {
    /// Workflow chat input (user conversing with agent)
    WorkflowChat,
    /// Free-form chat (user conversing with agent outside of workflow)
    FreeChat,
    /// Lead agent generating execution plan
    PlanGeneration,
    /// Step first execution
    StepExecution,
    /// Step revision (re-execution after user/lead feedback)
    StepRevision,
    /// Lead review evaluation
    LeadReview,
}

/// Returns the builtin skill names that must be installed and allowed
/// for the given prompt context.
pub fn required_builtin_skills(ctx: AgentPromptContext) -> &'static [&'static str] {
    match ctx {
        AgentPromptContext::WorkflowChat => &["brainstorming"],
        AgentPromptContext::FreeChat => &[],
        AgentPromptContext::PlanGeneration => &["writing-plans"],
        AgentPromptContext::StepExecution => &[],
        AgentPromptContext::StepRevision => &["pua"],
        AgentPromptContext::LeadReview => &["pua"],
    }
}

/// Format resolved skills into a prompt section string.
/// Returns `None` if the skill list is empty.
pub fn format_skills_prompt_section(skill_names: &[String]) -> Option<String> {
    if skill_names.is_empty() {
        return None;
    }
    let mut section = String::from("\n## Enabled Skills\n");
    section.push_str("- Enabled skills: ");
    section.push_str(&skill_names.join(", "));
    section.push('\n');
    Some(section)
}
