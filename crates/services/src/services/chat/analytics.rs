pub fn build_message_analytics_metrics(message: &ChatMessage) -> MessageAnalyticsMetrics {
    let attachments = extract_attachments(&message.meta.0);
    let attachment_total_size_bytes = attachments
        .iter()
        .map(|attachment| attachment.size_bytes.max(0) as u64)
        .sum::<u64>();

    MessageAnalyticsMetrics {
        message_length_bucket: workflow_analytics::message_length_bucket(message.content.len()),
        mention_count: message.mentions.0.len(),
        attachment_count: attachments.len(),
        attachment_total_size_bytes,
    }
}

pub fn emit_user_message_workflow_analytics(
    analytics: Option<&AnalyticsService>,
    session_id: Uuid,
    user_id: Option<&str>,
    message: &ChatMessage,
) {
    if !matches!(message.sender_type, ChatSenderType::User) {
        return;
    }

    let metrics = build_message_analytics_metrics(message);
    workflow_analytics::track_message_sent(
        analytics,
        session_id,
        user_id,
        message.content.len(),
        metrics.mention_count,
        metrics.attachment_count,
    );

}
