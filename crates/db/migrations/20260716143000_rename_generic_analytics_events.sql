-- Session creation and agent membership are generic chat events, not workflow events.
-- Delivered rows retain their historical names because they have already been exported;
-- every row that can still be delivered must use the corrected generic wire name.
UPDATE analytics_events
SET event_type = 'session_created'
WHERE event_type = 'workflow.session_created'
  AND posthog_status <> 'delivered';

UPDATE analytics_events
SET event_type = 'agent_added'
WHERE event_type = 'workflow.agent_added'
  AND posthog_status <> 'delivered';
