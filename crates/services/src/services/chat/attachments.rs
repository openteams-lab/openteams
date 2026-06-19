pub fn extract_attachments(meta: &Value) -> Vec<ChatAttachmentMeta> {
    meta.get("attachments")
        .and_then(|value| serde_json::from_value::<Vec<ChatAttachmentMeta>>(value.clone()).ok())
        .unwrap_or_default()
}

pub fn has_attachments(meta: &Value) -> bool {
    !extract_attachments(meta).is_empty()
}

pub fn extract_reference_message_id(meta: &Value) -> Option<Uuid> {
    let id = meta
        .get("reference")
        .and_then(|value| value.get("message_id"))
        .and_then(|value| value.as_str())
        .or_else(|| {
            meta.get("reference_message_id")
                .and_then(|value| value.as_str())
        });
    id.and_then(|value| Uuid::parse_str(value).ok())
}
