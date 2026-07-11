CREATE TABLE IF NOT EXISTS project_team_protocols (
    project_id BLOB NOT NULL PRIMARY KEY,
    content    TEXT NOT NULL DEFAULT '',
    enabled    BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Preserve the most recently active session protocol for existing projects.
INSERT OR IGNORE INTO project_team_protocols (project_id, content, enabled)
SELECT p.id,
       COALESCE((
           SELECT cs.team_protocol
           FROM chat_sessions cs
           WHERE cs.project_id = p.id
             AND cs.team_protocol_enabled = 1
             AND TRIM(COALESCE(cs.team_protocol, '')) <> ''
           ORDER BY cs.updated_at DESC
           LIMIT 1
       ), ''),
       CASE WHEN EXISTS (
           SELECT 1
           FROM chat_sessions cs
           WHERE cs.project_id = p.id
             AND cs.team_protocol_enabled = 1
             AND TRIM(COALESCE(cs.team_protocol, '')) <> ''
       ) THEN 1 ELSE 0 END
FROM projects p;
