PRAGMA foreign_keys = ON;

-- Member-level persistent message queue.
-- Each row references an existing chat_messages row (the user message source) and
-- belongs to a single session member (session_agent_id). The in-memory per-session
-- single-message queue is replaced by these durable, per-member rows so the queue can
-- be recovered after a service restart or a frontend refresh.
CREATE TABLE chat_message_queue (
    id                    BLOB PRIMARY KEY,
    session_id            BLOB NOT NULL,
    session_agent_id      BLOB NOT NULL,
    agent_id              BLOB NOT NULL,
    chat_message_id       BLOB NOT NULL,
    status                TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','processing','running','failed','skipped','completed')),
    processing_started_at TEXT,
    run_id                BLOB,
    failure_reason        TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (session_agent_id) REFERENCES chat_session_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES chat_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (chat_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES chat_runs(id) ON DELETE SET NULL
);

-- Drives claim_next: cheapest "earliest queued row for this member" lookup.
CREATE INDEX idx_chat_message_queue_member_created_at
    ON chat_message_queue(session_agent_id, created_at);
CREATE INDEX idx_chat_message_queue_session_id
    ON chat_message_queue(session_id);
CREATE INDEX idx_chat_message_queue_member_status
    ON chat_message_queue(session_agent_id, status);
CREATE INDEX idx_chat_message_queue_chat_message_id
    ON chat_message_queue(chat_message_id);

-- A member can have at most one in-flight (processing/running) entry. This backstops
-- the claim_next CAS and keeps the member queue's blocked/paused derivation unambiguous.
CREATE UNIQUE INDEX idx_chat_message_queue_one_active
    ON chat_message_queue(session_agent_id)
    WHERE status IN ('processing', 'running');
