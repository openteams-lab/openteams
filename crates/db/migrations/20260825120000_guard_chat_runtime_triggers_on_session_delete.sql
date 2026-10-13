-- A session deletion cascades into delivery deletion and may also clear run_id
-- through chat_runs' ON DELETE SET NULL. The parent session is already gone
-- when those triggers run, so do not recreate runtime rows referencing it.
-- Mutations within a surviving session must still advance its runtime revision
-- and retain the member identity in the outbox.
DROP TRIGGER chat_message_queue_runtime_revision_after_update;
DROP TRIGGER chat_message_queue_runtime_revision_after_delete;

CREATE TRIGGER chat_message_queue_runtime_revision_after_update
AFTER UPDATE ON chat_message_queue
WHEN EXISTS (SELECT 1 FROM chat_sessions WHERE id = NEW.session_id)
BEGIN
    INSERT INTO chat_session_runtime_revisions (session_id, revision, updated_at)
    VALUES (NEW.session_id, 1, datetime('now', 'subsec'))
    ON CONFLICT(session_id) DO UPDATE SET
        revision = revision + 1,
        updated_at = excluded.updated_at;

    INSERT INTO chat_runtime_outbox (
        session_id,
        revision,
        delivery_id,
        delivery_revision,
        event_type,
        session_agent_id,
        agent_id
    )
    SELECT
        NEW.session_id,
        revision,
        NEW.id,
        NEW.revision,
        'delivery_updated',
        NEW.session_agent_id,
        NEW.agent_id
    FROM chat_session_runtime_revisions
    WHERE session_id = NEW.session_id;
END;

CREATE TRIGGER chat_message_queue_runtime_revision_after_delete
AFTER DELETE ON chat_message_queue
WHEN EXISTS (SELECT 1 FROM chat_sessions WHERE id = OLD.session_id)
BEGIN
    INSERT INTO chat_session_runtime_revisions (session_id, revision, updated_at)
    VALUES (OLD.session_id, 1, datetime('now', 'subsec'))
    ON CONFLICT(session_id) DO UPDATE SET
        revision = revision + 1,
        updated_at = excluded.updated_at;

    INSERT INTO chat_runtime_outbox (
        session_id,
        revision,
        delivery_id,
        delivery_revision,
        event_type,
        session_agent_id,
        agent_id
    )
    SELECT
        OLD.session_id,
        revision,
        OLD.id,
        OLD.revision,
        'delivery_deleted',
        OLD.session_agent_id,
        OLD.agent_id
    FROM chat_session_runtime_revisions
    WHERE session_id = OLD.session_id;
END;
