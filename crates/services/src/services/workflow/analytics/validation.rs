pub fn validate_event_source(source: &str) -> bool {
    VALID_EVENT_SOURCES.contains(&source)
}

pub fn validate_agent_role(role: &str) -> bool {
    VALID_AGENT_ROLES.contains(&role)
}

// ---------------------------------------------------------------------------
// Privacy filtering
// ---------------------------------------------------------------------------

/// Strip forbidden fields AND unallowed fields from metadata. Returns violations found.
pub fn sanitize_metadata(metadata: &mut serde_json::Map<String, Value>) -> Vec<PrivacyViolation> {
    let mut violations = Vec::new();
    let forbidden: HashSet<&str> = FORBIDDEN_METADATA_KEYS.iter().copied().collect();
    let allowed: HashSet<&str> = ALLOWED_METADATA_KEYS.iter().copied().collect();
    let context_fields: HashSet<&str> = CONTEXT_FIELD_NAMES.iter().copied().collect();

    let keys_to_remove: Vec<String> = metadata
        .keys()
        .filter(|k| {
            let key = k.as_str();
            if forbidden.contains(key) {
                return true;
            }
            // Allow context fields and whitelisted metadata
            if allowed.contains(key) || context_fields.contains(key) {
                return false;
            }
            // Reject anything not in the whitelist
            true
        })
        .cloned()
        .collect();

    for key in keys_to_remove {
        metadata.remove(&key);
        if forbidden.contains(key.as_str()) {
            violations.push(PrivacyViolation::ForbiddenField(key));
        } else {
            violations.push(PrivacyViolation::UnallowedField(key));
        }
    }

    violations
}

/// Validate that a context has all required fields populated correctly.
pub fn validate_context(ctx: &WorkflowEventContext) -> Vec<String> {
    let mut errors = Vec::new();

    if ctx.timestamp.is_empty() {
        errors.push("timestamp is required".to_string());
    }

    if ctx.event_source.is_empty() {
        errors.push("event_source is required".to_string());
    } else if !validate_event_source(&ctx.event_source) {
        errors.push(format!("invalid event_source: {}", ctx.event_source));
    }

    if ctx.metadata_version < 1 {
        errors.push("metadata_version must be >= 1".to_string());
    }

    if let Some(ref role) = ctx.agent_role
        && !validate_agent_role(role)
    {
        errors.push(format!("invalid agent_role: {}", role));
    }

    errors
}

// ---------------------------------------------------------------------------
// Workflow event names (all 5 categories)
// ---------------------------------------------------------------------------
