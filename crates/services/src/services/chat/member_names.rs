pub fn normalized_member_name(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn effective_agent_name(agent: &ChatAgent, member_name: Option<&str>) -> String {
    normalized_member_name(member_name).unwrap_or_else(|| agent.name.clone())
}

pub fn apply_effective_agent_name(agent: &mut ChatAgent, member_names: &HashMap<Uuid, String>) {
    agent.name = effective_agent_name(agent, member_names.get(&agent.id).map(String::as_str));
}

pub async fn member_name_overrides_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    let session = ChatSession::find_by_id(pool, session_id).await?;
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session_id).await?;
    if session_agents.is_empty() {
        return Ok(HashMap::new());
    }

    let mut overrides = HashMap::new();
    let project_members = if let Some(project_id) = session.and_then(|item| item.project_id) {
        ProjectMember::find_by_project(pool, project_id).await?
    } else {
        Vec::new()
    };

    let member_by_id: HashMap<Uuid, &ProjectMember> =
        project_members.iter().map(|member| (member.id, member)).collect();
    let mut member_by_agent_id: HashMap<Uuid, &ProjectMember> = HashMap::new();
    for member in &project_members {
        if member.member_type == ProjectMemberType::Agent
            && let Some(agent_id) = member.agent_id
        {
            member_by_agent_id.entry(agent_id).or_insert(member);
        }
    }

    for session_agent in session_agents {
        let member = session_agent
            .project_member_id
            .and_then(|id| member_by_id.get(&id).copied())
            .or_else(|| member_by_agent_id.get(&session_agent.agent_id).copied());
        if let Some(name) = normalized_member_name(member.and_then(|item| item.member_name.as_deref()))
        {
            overrides.insert(session_agent.agent_id, name);
        }
    }

    Ok(overrides)
}
