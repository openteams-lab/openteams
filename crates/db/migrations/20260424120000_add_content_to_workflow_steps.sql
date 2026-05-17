ALTER TABLE chat_workflow_steps
ADD COLUMN content TEXT;

UPDATE chat_workflow_steps
SET content = CASE
    WHEN json_valid(summary_text) THEN json_extract(summary_text, '$.content')
    ELSE NULL
END
WHERE content IS NULL;
