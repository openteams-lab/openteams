pub fn parse_mentions(content: &str) -> Vec<String> {
    let chars: Vec<char> = content.chars().collect();
    let mut mentions = Vec::new();
    let mut seen = HashSet::new();

    for i in 0..chars.len() {
        if chars[i] != '@' {
            continue;
        }

        if i > 0 {
            let prev = chars[i - 1];
            if prev.is_alphanumeric() || prev == '_' || prev == '-' || prev == '.' {
                continue;
            }
        }

        let mut name = String::new();
        let mut j = i + 1;
        while j < chars.len() {
            let c = chars[j];
            if c.is_alphanumeric() || c == '_' || c == '-' {
                name.push(c);
                j += 1;
            } else {
                break;
            }
        }

        if !name.is_empty() && seen.insert(name.clone()) {
            mentions.push(name);
        }
    }

    mentions
}

fn normalize_mention(value: &str) -> Option<String> {
    let normalized = value.trim().trim_start_matches('@').trim();
    if normalized.is_empty() {
        return None;
    }

    if normalized
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        Some(normalized.to_string())
    } else {
        None
    }
}

pub fn parse_user_message_mentions(content: &str, meta: &Value) -> Vec<String> {
    let content_mentions = parse_mentions(content);
    if !content_mentions.is_empty() {
        return content_mentions;
    }

    let mut seen = HashSet::new();
    meta.get("mentions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(normalize_mention)
        .filter(|mention| seen.insert(mention.to_ascii_lowercase()))
        .collect()
}

fn normalize_protocol_send_target(target: &str) -> Option<String> {
    let normalized = normalize_mention(target)?;

    let normalized = if normalized.eq_ignore_ascii_case("user") {
        "you"
    } else {
        normalized.as_str()
    };
    Some(normalized.to_string())
}

fn is_routable_agent_send_intent(intent: Option<&str>) -> bool {
    matches!(
        intent.map(|value| value.trim().to_ascii_lowercase()),
        Some(intent) if matches!(intent.as_str(), "reply" | "request" | "notify")
    )
}

pub fn parse_agent_send_mentions(meta: &Value) -> Vec<String> {
    let Some(protocol) = meta.get("protocol").and_then(Value::as_object) else {
        return Vec::new();
    };

    if protocol.get("type").and_then(Value::as_str) != Some("send") {
        return Vec::new();
    }

    if !is_routable_agent_send_intent(protocol.get("intent").and_then(Value::as_str)) {
        return Vec::new();
    }

    protocol
        .get("to")
        .and_then(Value::as_str)
        .and_then(normalize_protocol_send_target)
        .into_iter()
        .collect()
}

pub fn is_workflow_chat_input_mode(meta: &Value) -> bool {
    meta.get("chat_input_mode")
        .and_then(Value::as_str)
        .is_some_and(|mode| mode.trim() == "workflow")
}
