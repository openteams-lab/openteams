use regex::Regex;
use uuid::Uuid;

pub fn git_branch_id(input: &str) -> String {
    // 1. lowercase
    let lower = input.to_lowercase();

    // 2. replace non-alphanumerics with hyphens
    let re = Regex::new(r"[^a-z0-9]+").unwrap();
    let slug = re.replace_all(&lower, "-");

    // 3. trim extra hyphens
    let trimmed = slug.trim_matches('-');

    // 4. take up to 16 chars, then trim trailing hyphens again
    let cut: String = trimmed.chars().take(16).collect();
    cut.trim_end_matches('-').to_string()
}

pub fn short_uuid(u: &Uuid) -> String {
    // to_simple() gives you a 32-char hex string with no hyphens
    let full = u.simple().to_string();
    full.chars().take(4).collect() // grab the first 4 chars
}

pub fn strip_whitespace(content: &str) -> String {
    content.chars().filter(|ch| !ch.is_whitespace()).collect()
}

pub fn sanitize_member_handle(content: &str) -> String {
    content
        .chars()
        .filter(|ch| ch.is_alphanumeric() || *ch == '_' || *ch == '-')
        .collect()
}

pub fn truncate_to_char_boundary(content: &str, max_len: usize) -> &str {
    if content.len() <= max_len {
        return content;
    }

    let cutoff = content
        .char_indices()
        .map(|(idx, _)| idx)
        .chain(std::iter::once(content.len()))
        .take_while(|&idx| idx <= max_len)
        .last()
        .unwrap_or(0);

    debug_assert!(content.is_char_boundary(cutoff));
    &content[..cutoff]
}

#[cfg(test)]
mod tests {

    #[test]
    fn strip_whitespace_removes_ascii_and_unicode_spaces() {
        use super::strip_whitespace;

        assert_eq!(strip_whitespace(" Codex Agent "), "CodexAgent");
        assert_eq!(strip_whitespace("前端　成员\t1"), "前端成员1");
    }

    #[test]
    fn sanitize_member_handle_keeps_only_routable_characters() {
        use super::sanitize_member_handle;

        assert_eq!(
            sanitize_member_handle(" @Agentic Identity & Trust Architect "),
            "AgenticIdentityTrustArchitect"
        );
        assert_eq!(sanitize_member_handle("前端-成员_1"), "前端-成员_1");
    }

    #[test]
    fn test_truncate_to_char_boundary() {
        use super::truncate_to_char_boundary;

        let input = "a".repeat(10);
        assert_eq!(truncate_to_char_boundary(&input, 7), "a".repeat(7));

        let input = "hello world";
        assert_eq!(truncate_to_char_boundary(input, input.len()), input);

        let input = "🔥🔥🔥"; // each fire emoji is 4 bytes
        assert_eq!(truncate_to_char_boundary(input, 5), "🔥");
        assert_eq!(truncate_to_char_boundary(input, 3), "");
    }
}
