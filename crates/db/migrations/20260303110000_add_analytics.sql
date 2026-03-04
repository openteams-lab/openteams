-- Analytics events table for tracking user behavior, system performance, and conversions
CREATE TABLE analytics_events (
    id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    event_category TEXT NOT NULL CHECK (event_category IN ('user_action', 'system', 'conversion')),
    user_id TEXT,
    session_id TEXT,
    properties TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    platform TEXT,
    app_version TEXT,
    os TEXT,
    device_id TEXT
);

-- Indexes for common query patterns
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_timestamp ON analytics_events(timestamp);
CREATE INDEX idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX idx_analytics_events_category ON analytics_events(event_category);

-- User profiles for aggregated analytics
CREATE TABLE analytics_user_profiles (
    user_id TEXT PRIMARY KEY NOT NULL,
    first_seen_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    total_sessions INTEGER DEFAULT 0 NOT NULL,
    total_messages INTEGER DEFAULT 0 NOT NULL,
    total_agents_used INTEGER DEFAULT 0 NOT NULL,
    preferred_runner_type TEXT,
    onboarding_completed BOOLEAN DEFAULT FALSE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Session stats for aggregated analytics
CREATE TABLE analytics_session_stats (
    session_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME,
    duration_seconds INTEGER,
    message_count INTEGER DEFAULT 0 NOT NULL,
    agent_count INTEGER DEFAULT 0 NOT NULL,
    unique_agents_used INTEGER DEFAULT 0 NOT NULL,
    mention_count INTEGER DEFAULT 0 NOT NULL,
    skill_count INTEGER DEFAULT 0 NOT NULL,
    has_attachments BOOLEAN DEFAULT FALSE NOT NULL
);

-- Index for finding user's sessions
CREATE INDEX idx_analytics_session_stats_user ON analytics_session_stats(user_id);
CREATE INDEX idx_analytics_session_stats_archived ON analytics_session_stats(archived_at);