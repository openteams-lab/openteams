pub fn analytics_if_enabled(
    analytics: Option<&crate::services::analytics::AnalyticsService>,
    capture_enabled: bool,
) -> Option<&crate::services::analytics::AnalyticsService> {
    if capture_enabled { analytics } else { None }
}

/// Classify message length into a privacy-safe bucket.
pub fn message_length_bucket(len: usize) -> &'static str {
    match len {
        0 => "empty",
        1..=50 => "short",
        51..=200 => "medium",
        201..=1000 => "long",
        _ => "very_long",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
