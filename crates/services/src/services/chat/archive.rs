pub async fn export_session_archive(
    pool: &SqlitePool,
    session: &ChatSession,
    archive_dir: &Path,
) -> Result<String, ChatServiceError> {
    fs::create_dir_all(archive_dir).await?;

    let messages = build_structured_messages(pool, session.id).await?;
    let export_path = archive_dir.join("messages_export.jsonl");
    let mut file = fs::File::create(&export_path).await?;
    for message in messages {
        let line = serde_json::to_string(&message).unwrap_or_default();
        file.write_all(line.as_bytes()).await?;
        file.write_all(b"\n").await?;
    }

    let summary_path = archive_dir.join("session_summary.md");
    let summary = session
        .summary_text
        .clone()
        .unwrap_or_else(|| "No summary available.".to_string());
    fs::write(&summary_path, summary).await?;

    Ok(archive_dir.to_string_lossy().to_string())
}

// ==========================================
// New Token-Based Compression System
// ==========================================

use super::chat_history_file::{SimplifiedMessage, append_to_split_file, estimate_token_count};
