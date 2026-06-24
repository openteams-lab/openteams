use db::models::{project::Project, scratch::Scratch};
use futures::StreamExt;
use serde_json::json;
use tokio_stream::wrappers::{BroadcastStream, errors::BroadcastStreamRecvError};
use utils::log_msg::LogMsg;
use uuid::Uuid;

use super::{EventService, types::EventError};

impl EventService {
    pub async fn stream_projects_raw(
        &self,
    ) -> Result<futures::stream::BoxStream<'static, Result<LogMsg, std::io::Error>>, EventError>
    {
        fn build_projects_snapshot(projects: Vec<Project>) -> LogMsg {
            let projects_map: serde_json::Map<String, serde_json::Value> = projects
                .into_iter()
                .map(|project| {
                    (
                        project.id.to_string(),
                        serde_json::to_value(project).unwrap(),
                    )
                })
                .collect();

            LogMsg::JsonPatch(
                serde_json::from_value(json!([{
                    "op": "replace",
                    "path": "/projects",
                    "value": projects_map
                }]))
                .unwrap(),
            )
        }

        let initial_msg = build_projects_snapshot(Project::find_all(&self.db.pool).await?);
        let db_pool = self.db.pool.clone();
        let filtered_stream =
            BroadcastStream::new(self.msg_store.get_receiver()).filter_map(move |msg_result| {
                let db_pool = db_pool.clone();
                async move {
                    match msg_result {
                        Ok(LogMsg::JsonPatch(patch)) => {
                            if let Some(patch_op) = patch.0.first()
                                && patch_op.path().starts_with("/projects")
                            {
                                return Some(Ok(LogMsg::JsonPatch(patch)));
                            }
                            None
                        }
                        Ok(other) => Some(Ok(other)),
                        Err(BroadcastStreamRecvError::Lagged(skipped)) => {
                            tracing::warn!(
                                skipped = skipped,
                                "projects stream lagged; resyncing snapshot"
                            );

                            match Project::find_all(&db_pool).await {
                                Ok(projects) => Some(Ok(build_projects_snapshot(projects))),
                                Err(err) => Some(Err(std::io::Error::other(format!(
                                    "failed to resync projects after lag: {err}"
                                )))),
                            }
                        }
                    }
                }
            });

        let initial_stream = futures::stream::iter(vec![Ok(initial_msg), Ok(LogMsg::Ready)]);
        Ok(initial_stream.chain(filtered_stream).boxed())
    }

    pub async fn stream_scratch_raw(
        &self,
        scratch_id: Uuid,
        scratch_type: &db::models::scratch::ScratchType,
    ) -> Result<futures::stream::BoxStream<'static, Result<LogMsg, std::io::Error>>, EventError>
    {
        let scratch = Scratch::find_by_id(&self.db.pool, scratch_id, scratch_type)
            .await
            .unwrap_or(None);

        let initial_msg = LogMsg::JsonPatch(
            serde_json::from_value(json!([{
                "op": "replace",
                "path": "/scratch",
                "value": scratch
            }]))
            .unwrap(),
        );
        let type_str = scratch_type.to_string();

        let filtered_stream =
            BroadcastStream::new(self.msg_store.get_receiver()).filter_map(move |msg_result| {
                let id_str = scratch_id.to_string();
                let type_str = type_str.clone();
                async move {
                    match msg_result {
                        Ok(LogMsg::JsonPatch(patch)) => {
                            if let Some(op) = patch.0.first()
                                && op.path() == "/scratch"
                            {
                                let value = match op {
                                    json_patch::PatchOperation::Add(a) => Some(&a.value),
                                    json_patch::PatchOperation::Replace(r) => Some(&r.value),
                                    json_patch::PatchOperation::Remove(_) => None,
                                    _ => None,
                                };

                                if value.is_some_and(|v| {
                                    v.get("id").and_then(|v| v.as_str()) == Some(&id_str)
                                        && v.get("payload")
                                            .and_then(|p| p.get("type"))
                                            .and_then(|t| t.as_str())
                                            == Some(&type_str)
                                }) {
                                    return Some(Ok(LogMsg::JsonPatch(patch)));
                                }
                            }
                            None
                        }
                        Ok(other) => Some(Ok(other)),
                        Err(_) => None,
                    }
                }
            });

        let initial_stream = futures::stream::iter(vec![Ok(initial_msg), Ok(LogMsg::Ready)]);
        Ok(initial_stream.chain(filtered_stream).boxed())
    }
}
