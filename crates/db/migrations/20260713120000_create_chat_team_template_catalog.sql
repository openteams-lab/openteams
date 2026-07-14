CREATE TABLE chat_team_template_catalog (
    template_id TEXT NOT NULL PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('builtin', 'custom')),
    tier TEXT NOT NULL CHECK (tier IN ('standard', 'advanced')),
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    content_checksum TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_chat_team_template_catalog_lookup
    ON chat_team_template_catalog(enabled, tier, sort_order);
