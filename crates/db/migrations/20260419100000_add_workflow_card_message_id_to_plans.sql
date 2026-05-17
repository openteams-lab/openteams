-- Add workflow_card_message_id to chat_workflow_plans so plans can reference their preview card message
ALTER TABLE chat_workflow_plans ADD COLUMN workflow_card_message_id BLOB;
