ALTER TABLE chat_session_agents
ADD COLUMN member_name TEXT NOT NULL DEFAULT '';

WITH RECURSIVE member_name_candidates AS (
    SELECT csa.id,
           csa.session_id,
           COALESCE(
               NULLIF(TRIM(pm.member_name), ''),
               (
                   SELECT NULLIF(TRIM(fallback_pm.member_name), '')
                   FROM project_members fallback_pm
                   WHERE fallback_pm.project_id = cs.project_id
                     AND fallback_pm.agent_id = csa.agent_id
                     AND fallback_pm.member_type = 'agent'
                   ORDER BY fallback_pm.display_order ASC,
                            fallback_pm.created_at ASC,
                            fallback_pm.id ASC
                   LIMIT 1
               ),
               NULLIF(TRIM(ca.name), ''),
               'member_' || LOWER(SUBSTR(HEX(csa.id), 1, 8))
           ) AS base_name
    FROM chat_session_agents csa
    JOIN chat_agents ca ON ca.id = csa.agent_id
    LEFT JOIN project_members pm ON pm.id = csa.project_member_id
    LEFT JOIN chat_sessions cs ON cs.id = csa.session_id
), ranked_member_names AS (
    SELECT id,
           session_id,
           base_name,
           ROW_NUMBER() OVER (
               PARTITION BY session_id, LOWER(base_name)
               ORDER BY id
           ) AS duplicate_index
    FROM member_name_candidates
), suffix_numbers(number) AS (
    SELECT 2
    UNION ALL
    SELECT number + 1
    FROM suffix_numbers
    WHERE number <= (SELECT COUNT(*) + 1 FROM ranked_member_names)
), available_suffixes AS (
    SELECT ranked.id,
           ranked.duplicate_index,
           ranked.base_name,
           suffix_numbers.number,
           ROW_NUMBER() OVER (
               PARTITION BY ranked.id
               ORDER BY suffix_numbers.number
           ) AS available_index
    FROM ranked_member_names ranked
    CROSS JOIN suffix_numbers
    WHERE ranked.duplicate_index > 1
      AND NOT EXISTS (
          SELECT 1
          FROM ranked_member_names reserved
          WHERE reserved.session_id = ranked.session_id
            AND LOWER(reserved.base_name) =
                LOWER(ranked.base_name || '_' || suffix_numbers.number)
      )
)
UPDATE chat_session_agents
SET member_name = (
    SELECT CASE
        WHEN ranked.duplicate_index = 1 THEN ranked.base_name
        ELSE (
            SELECT available.base_name || '_' || available.number
            FROM available_suffixes available
            WHERE available.id = ranked.id
              AND available.available_index = ranked.duplicate_index - 1
        )
    END
    FROM ranked_member_names ranked
    WHERE ranked.id = chat_session_agents.id
);

DROP INDEX IF EXISTS idx_chat_session_agents_unique;

CREATE UNIQUE INDEX idx_chat_session_agents_unique_member_name
    ON chat_session_agents(session_id, LOWER(member_name));

CREATE UNIQUE INDEX idx_chat_session_agents_unique_project_member
    ON chat_session_agents(session_id, project_member_id)
    WHERE project_member_id IS NOT NULL;

ALTER TABLE chat_sessions
ADD COLUMN lead_session_agent_id BLOB REFERENCES chat_session_agents(id) ON DELETE SET NULL;

UPDATE chat_sessions
SET lead_session_agent_id = (
    SELECT csa.id
    FROM chat_session_agents csa
    WHERE csa.session_id = chat_sessions.id
      AND csa.agent_id = chat_sessions.lead_agent_id
    ORDER BY csa.created_at ASC, csa.id ASC
    LIMIT 1
)
WHERE lead_agent_id IS NOT NULL;

ALTER TABLE chat_messages
ADD COLUMN sender_session_agent_id BLOB REFERENCES chat_session_agents(id) ON DELETE SET NULL;

UPDATE chat_messages
SET sender_session_agent_id = (
    SELECT csa.id
    FROM chat_session_agents csa
    WHERE csa.session_id = chat_messages.session_id
      AND csa.agent_id = chat_messages.sender_id
    ORDER BY csa.created_at ASC, csa.id ASC
    LIMIT 1
)
WHERE sender_type = 'agent' AND sender_id IS NOT NULL;

CREATE INDEX idx_chat_messages_sender_session_agent_id
    ON chat_messages(sender_session_agent_id);

CREATE TABLE chat_message_targets (
    message_id            BLOB NOT NULL,
    ordinal               INTEGER NOT NULL,
    session_id            BLOB NOT NULL,
    session_agent_id      BLOB,
    project_member_id     BLOB,
    agent_id              BLOB NOT NULL,
    member_name_snapshot  TEXT NOT NULL,
    route_kind            TEXT NOT NULL
                              CHECK (route_kind IN (
                                  'explicit_mention',
                                  'selected_member',
                                  'default_lead',
                                  'agent_protocol',
                                  'protocol_retry'
                              )),
    resolution_status     TEXT NOT NULL DEFAULT 'resolved'
                              CHECK (resolution_status IN (
                                  'resolved', 'missing', 'removed', 'rejected'
                              )),
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    PRIMARY KEY (message_id, ordinal),
    UNIQUE (message_id, session_agent_id),
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (session_agent_id) REFERENCES chat_session_agents(id) ON DELETE SET NULL,
    FOREIGN KEY (project_member_id) REFERENCES project_members(id) ON DELETE SET NULL,
    -- agent_id is an immutable identity snapshot. Do not attach a cascading FK:
    -- deleting an execution profile must not erase historical routing evidence.
    CHECK (length(agent_id) > 0)
);

CREATE INDEX idx_chat_message_targets_session_agent
    ON chat_message_targets(session_id, session_agent_id);
