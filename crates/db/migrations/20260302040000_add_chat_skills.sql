-- Skill definitions: reusable capabilities that can be assigned to agents
CREATE TABLE chat_skills (
    id          BLOB PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- The prompt/instructions injected into agent context when skill is active
    content     TEXT NOT NULL DEFAULT '',
    -- Trigger condition: 'always' (auto-inject), 'keyword' (match keywords), 'manual' (user invokes)
    trigger_type TEXT NOT NULL DEFAULT 'always'
                   CHECK (trigger_type IN ('always', 'keyword', 'manual')),
    -- JSON array of trigger keywords (used when trigger_type = 'keyword')
    trigger_keywords TEXT NOT NULL DEFAULT '[]',
    -- Whether the skill is enabled globally
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_chat_skills_name ON chat_skills(name);
CREATE INDEX idx_chat_skills_enabled ON chat_skills(enabled);

-- Join table linking skills to agents (many-to-many)
CREATE TABLE chat_agent_skills (
    id         BLOB PRIMARY KEY,
    agent_id   BLOB NOT NULL,
    skill_id   BLOB NOT NULL,
    -- Per-agent skill override: enabled/disabled
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (agent_id) REFERENCES chat_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES chat_skills(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_chat_agent_skills_unique ON chat_agent_skills(agent_id, skill_id);
CREATE INDEX idx_chat_agent_skills_agent_id ON chat_agent_skills(agent_id);
CREATE INDEX idx_chat_agent_skills_skill_id ON chat_agent_skills(skill_id);
