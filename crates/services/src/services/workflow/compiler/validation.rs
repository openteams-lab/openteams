fn normalize_workspace_key(path: &str) -> Option<String> {
    let mut normalized = path.trim().replace('\\', "/");
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    if normalized.is_empty() {
        return None;
    }
    #[cfg(windows)]
    {
        normalized = normalized.to_ascii_lowercase();
    }
    Some(normalized)
}
