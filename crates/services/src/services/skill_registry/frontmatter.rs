#[derive(Debug, Default)]
struct ParsedSkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
    version: Option<String>,
    author: Option<String>,
    tags: Vec<String>,
    category: Option<String>,
    compatible_agents: Vec<String>,
    source_url: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedSkillMarkdown {
    name: String,
    description: String,
    content: String,
    version: Option<String>,
    author: Option<String>,
    tags: Vec<String>,
    category: Option<String>,
    compatible_agents: Vec<String>,
    source_url: Option<String>,
}

fn parse_discovered_skill_markdown(dir_name: &str, raw: &str) -> ParsedSkillMarkdown {
    let normalized = raw.replace("\r\n", "\n");
    let (frontmatter, body) = split_skill_frontmatter(&normalized);
    let frontmatter = frontmatter
        .and_then(parse_skill_frontmatter)
        .unwrap_or_default();
    let (heading, description_from_body, body_content) = strip_skill_title_and_description(body);

    let name = frontmatter
        .name
        .unwrap_or_else(|| heading.unwrap_or_else(|| dir_name.to_string()));
    let description = frontmatter
        .description
        .unwrap_or_else(|| description_from_body.unwrap_or_default());
    let content = if body_content.trim().is_empty() {
        body.trim().to_string()
    } else {
        body_content
    };

    ParsedSkillMarkdown {
        name,
        description,
        content,
        version: frontmatter.version,
        author: frontmatter.author,
        tags: frontmatter.tags,
        category: frontmatter.category,
        compatible_agents: frontmatter.compatible_agents,
        source_url: frontmatter.source_url,
    }
}

fn split_skill_frontmatter(content: &str) -> (Option<&str>, &str) {
    if let Some(rest) = content.strip_prefix("---\n")
        && let Some((frontmatter, body)) = rest.split_once("\n---\n")
    {
        return (Some(frontmatter), body);
    }

    (None, content)
}

fn parse_skill_frontmatter(frontmatter: &str) -> Option<ParsedSkillFrontmatter> {
    let value = serde_yaml::from_str::<serde_yaml::Value>(frontmatter).ok()?;
    let mapping = value.as_mapping()?;

    Some(ParsedSkillFrontmatter {
        name: yaml_string(mapping, "name"),
        description: yaml_string(mapping, "description"),
        version: yaml_string(mapping, "version"),
        author: yaml_string(mapping, "author"),
        tags: yaml_string_list(mapping, "tags"),
        category: yaml_string(mapping, "category"),
        compatible_agents: yaml_string_list(mapping, "compatible_agents"),
        source_url: yaml_string(mapping, "source_url")
            .or_else(|| yaml_string(mapping, "source"))
            .filter(|value| value.contains("://") || value.starts_with("github.com/")),
    })
}

fn yaml_string(mapping: &serde_yaml::Mapping, key: &str) -> Option<String> {
    mapping.iter().find_map(|(candidate, value)| {
        let candidate = candidate.as_str()?;
        if !candidate.eq_ignore_ascii_case(key) {
            return None;
        }

        match value {
            serde_yaml::Value::String(value) => Some(clean_metadata_text(value)),
            serde_yaml::Value::Number(value) => Some(value.to_string()),
            serde_yaml::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        }
    })
}

fn yaml_string_list(mapping: &serde_yaml::Mapping, key: &str) -> Vec<String> {
    mapping
        .iter()
        .find_map(|(candidate, value)| {
            let candidate = candidate.as_str()?;
            if !candidate.eq_ignore_ascii_case(key) {
                return None;
            }
            Some(yaml_value_to_string_list(value))
        })
        .unwrap_or_default()
}

fn yaml_value_to_string_list(value: &serde_yaml::Value) -> Vec<String> {
    match value {
        serde_yaml::Value::Sequence(values) => values
            .iter()
            .filter_map(|entry| match entry {
                serde_yaml::Value::String(value) => Some(clean_metadata_text(value)),
                serde_yaml::Value::Number(value) => Some(value.to_string()),
                serde_yaml::Value::Bool(value) => Some(value.to_string()),
                _ => None,
            })
            .collect(),
        serde_yaml::Value::String(value) => split_metadata_list(value),
        _ => Vec::new(),
    }
}

fn strip_skill_title_and_description(content: &str) -> (Option<String>, Option<String>, String) {
    let mut lines = content.lines().peekable();

    while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
        lines.next();
    }

    let mut heading = None;
    if let Some(line) = lines.peek().copied()
        && let Some(title) = line.trim().strip_prefix("# ")
    {
        heading = Some(title.trim().to_string());
        lines.next();
        while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
            lines.next();
        }
    }

    let mut description_lines = Vec::new();
    while let Some(line) = lines.peek().copied() {
        let trimmed = line.trim();
        if !trimmed.starts_with('>') {
            break;
        }

        description_lines.push(trimmed.trim_start_matches('>').trim().to_string());
        lines.next();
    }

    if !description_lines.is_empty() {
        while matches!(lines.peek(), Some(line) if line.trim().is_empty()) {
            lines.next();
        }
    }

    let description = (!description_lines.is_empty()).then(|| description_lines.join(" "));
    let body = lines.collect::<Vec<_>>().join("\n").trim().to_string();

    (heading, description, body)
}

fn split_metadata_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(clean_metadata_text)
        .filter(|item| !item.is_empty())
        .collect()
}

fn clean_metadata_text(value: &str) -> String {
    let trimmed = value.trim();
    trimmed
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}
