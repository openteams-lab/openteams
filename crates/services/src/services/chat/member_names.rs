pub fn normalized_member_name(value: Option<&str>) -> Option<String> {
    let normalized = utils::text::sanitize_member_handle(value?);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

pub fn effective_agent_name(agent: &ChatAgent, member_name: Option<&str>) -> String {
    normalized_member_name(member_name)
        .or_else(|| normalized_member_name(Some(&agent.name)))
        .unwrap_or_else(|| agent.name.clone())
}

pub async fn member_name_overrides_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    let session_agents = ChatSessionAgent::find_all_for_session(pool, session_id).await?;
    if session_agents.is_empty() {
        return Ok(HashMap::new());
    }

    let mut overrides = HashMap::new();
    for session_agent in session_agents {
        if let Some(name) = normalized_member_name(Some(&session_agent.member_name)) {
            overrides.insert(session_agent.id, name);
        }
    }

    Ok(overrides)
}

/// Compatibility map for legacy messages that have only `sender_id`.
/// A backing agent maps to a member name only when it identifies exactly one
/// session member; shared execution profiles deliberately have no fallback.
pub async fn unambiguous_member_names_by_agent_for_session(
    pool: &SqlitePool,
    session_id: Uuid,
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    let mut grouped = HashMap::<Uuid, Vec<String>>::new();
    for session_agent in ChatSessionAgent::find_all_for_session(pool, session_id).await? {
        if let Some(name) = normalized_member_name(Some(&session_agent.member_name)) {
            grouped.entry(session_agent.agent_id).or_default().push(name);
        }
    }
    Ok(grouped
        .into_iter()
        .filter_map(|(agent_id, names)| (names.len() == 1).then(|| (agent_id, names[0].clone())))
        .collect())
}

pub async fn resolve_sender_member_name(
    pool: &SqlitePool,
    session_id: Uuid,
    sender_session_agent_id: Option<Uuid>,
    sender_agent_id: Option<Uuid>,
) -> Result<Option<String>, sqlx::Error> {
    if let Some(session_agent_id) = sender_session_agent_id
        && let Some(member) = ChatSessionAgent::find_by_id(pool, session_agent_id).await?
        && member.session_id == session_id
    {
        return Ok(Some(member.member_name));
    }
    let Some(agent_id) = sender_agent_id else {
        return Ok(None);
    };
    Ok(unambiguous_member_names_by_agent_for_session(pool, session_id)
        .await?
        .remove(&agent_id))
}
