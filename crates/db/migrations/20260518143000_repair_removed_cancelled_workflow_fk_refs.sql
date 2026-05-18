-- Repair databases that applied 20260518141000 before child foreign-key
-- references were normalized back from rebuilt table names.
PRAGMA foreign_keys = OFF;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
COMMIT TRANSACTION;

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

PRAGMA writable_schema = ON;

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_executions_old"', 'chat_workflow_executions')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_executions_old"%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, 'chat_workflow_executions_old', 'chat_workflow_executions')
WHERE type = 'table'
  AND sql LIKE '%chat_workflow_executions_old%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, '"chat_workflow_steps_old"', 'chat_workflow_steps')
WHERE type = 'table'
  AND sql LIKE '%"chat_workflow_steps_old"%';

UPDATE sqlite_schema
SET sql = REPLACE(sql, 'chat_workflow_steps_old', 'chat_workflow_steps')
WHERE type = 'table'
  AND sql LIKE '%chat_workflow_steps_old%';

PRAGMA writable_schema = OFF;
PRAGMA schema_version = 2026051815;

PRAGMA foreign_key_check;

COMMIT;

PRAGMA foreign_keys = ON;

-- sqlx workaround due to lack of `-- no-transaction` in sqlx-sqlite.
BEGIN TRANSACTION;
