-- Project team protocols are now the only runtime source of truth. The prior
-- migration has already copied existing enabled session protocols into the
-- project-level table.
ALTER TABLE chat_sessions DROP COLUMN team_protocol;
ALTER TABLE chat_sessions DROP COLUMN team_protocol_enabled;
