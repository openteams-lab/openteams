use std::{io, path::Path};

use tokio::{fs, io::AsyncWriteExt};

use super::ChatRunActivityLine;

pub(super) async fn append_activity_line(
    path: &Path,
    line: &ChatRunActivityLine,
) -> Result<(), io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let mut record = serde_json::to_vec(line).map_err(io::Error::other)?;
    record.push(b'\n');

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    file.write_all(&record).await?;
    file.flush().await
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::*;
    use crate::services::chat_runner::{
        ChatRunActivityLineType, ChatStreamDeltaType,
    };

    fn activity_line(run_id: Uuid, sequence: u64, content: &str) -> ChatRunActivityLine {
        ChatRunActivityLine {
            line_id: Uuid::new_v4(),
            run_id,
            session_id: Uuid::new_v4(),
            session_agent_id: Uuid::new_v4(),
            agent_id: Uuid::new_v4(),
            agent_name: "codex".to_string(),
            sequence,
            line_type: ChatRunActivityLineType::Thinking,
            stream_type: ChatStreamDeltaType::Thinking,
            content: content.to_string(),
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn appends_complete_jsonl_records_in_order() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("activity.jsonl");
        let run_id = Uuid::new_v4();

        append_activity_line(&path, &activity_line(run_id, 0, "first"))
            .await
            .expect("append first");
        append_activity_line(&path, &activity_line(run_id, 1, "second"))
            .await
            .expect("append second");

        let content = fs::read_to_string(&path).await.expect("read activity");
        assert!(content.ends_with('\n'));
        let lines = content.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);
        let first: ChatRunActivityLine = serde_json::from_str(lines[0]).expect("parse first");
        let second: ChatRunActivityLine = serde_json::from_str(lines[1]).expect("parse second");
        assert_eq!((first.sequence, first.content.as_str()), (0, "first"));
        assert_eq!((second.sequence, second.content.as_str()), (1, "second"));
    }

    #[tokio::test]
    async fn append_returns_error_for_non_directory_parent() {
        let temp = tempdir().expect("tempdir");
        let blocker = temp.path().join("blocker");
        fs::write(&blocker, b"file").await.expect("write blocker");

        let error = append_activity_line(
            &blocker.join("activity.jsonl"),
            &activity_line(Uuid::new_v4(), 0, "line"),
        )
        .await
        .expect_err("invalid parent should fail");

        assert!(matches!(
            error.kind(),
            io::ErrorKind::AlreadyExists | io::ErrorKind::NotADirectory
        ));
    }
}
