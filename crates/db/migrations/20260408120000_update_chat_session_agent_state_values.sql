PRAGMA foreign_keys = OFF;

CREATE TABLE chat_session_agents_new (
    id                BLOB PRIMARY KEY,
    session_id        BLOB NOT NULL,
    agent_id          BLOB NOT NULL,
    state             TEXT NOT NULL DEFAULT 'idle'
                         CHECK (state IN ('idle','running','stopping','waitingapproval','dead')),
    workspace_path    TEXT,
    pty_session_key   TEXT,
    agent_session_id  TEXT,
    agent_message_id  TEXT,
    allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES chat_agents(id) ON DELETE CASCADE
);

INSERT INTO chat_session_agents_new (
    id,
    session_id,
    agent_id,
    state,
    workspace_path,
    pty_session_key,
    agent_session_id,
    agent_message_id,
    allowed_skill_ids,
    created_at,
    updated_at
)
SELECT
    id,
    session_id,
    agent_id,
    CASE
        WHEN state = 'waiting_approval' THEN 'waitingapproval'
        ELSE state
    END,
    workspace_path,
    pty_session_key,
    agent_session_id,
    agent_message_id,
    COALESCE(allowed_skill_ids, '[]'),
    created_at,
    updated_at
FROM chat_session_agents;

DROP TABLE chat_session_agents;

ALTER TABLE chat_session_agents_new RENAME TO chat_session_agents;

CREATE UNIQUE INDEX idx_chat_session_agents_unique
    ON chat_session_agents(session_id, agent_id);
CREATE INDEX idx_chat_session_agents_session_id
    ON chat_session_agents(session_id);
CREATE INDEX idx_chat_session_agents_agent_id
    ON chat_session_agents(agent_id);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
