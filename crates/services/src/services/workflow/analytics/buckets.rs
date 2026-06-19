/// Hash a user ID for privacy-safe analytics distinct_id.
pub fn hash_user_id(user_id: &str) -> String {
    use std::{
        collections::hash_map::DefaultHasher,
        hash::{Hash, Hasher},
    };

    let mut hasher = DefaultHasher::new();
    user_id.hash(&mut hasher);
    format!("wf_user_{:016x}", hasher.finish())
}

pub fn analytics_if_enabled(
    analytics: Option<&AnalyticsService>,
    capture_enabled: bool,
) -> Option<&AnalyticsService> {
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

/// Classify file size into a privacy-safe bucket.
pub fn size_bucket(bytes: u64) -> &'static str {
    match bytes {
        0 => "empty",
        1..=1024 => "tiny",
        1025..=102400 => "small",
        102401..=1048576 => "medium",
        1048577..=10485760 => "large",
        _ => "very_large",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
