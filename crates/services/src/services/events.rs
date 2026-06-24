use std::{str::FromStr, sync::Arc};

use db::{
    DBService,
    models::{project::Project, scratch::Scratch},
};
use serde_json::json;
use sqlx::{Sqlite, decode::Decode, sqlite::SqliteOperation};
use tokio::sync::RwLock;
use utils::msg_store::MsgStore;
use uuid::Uuid;

#[path = "events/patches.rs"]
pub mod patches;
#[path = "events/streams.rs"]
mod streams;
#[path = "events/types.rs"]
pub mod types;

pub use patches::{project_patch, scratch_patch};
pub use types::{EventError, EventPatch, EventPatchInner, HookTables, RecordTypes};

#[derive(Clone)]
pub struct EventService {
    msg_store: Arc<MsgStore>,
    db: DBService,
    #[allow(dead_code)]
    entry_count: Arc<RwLock<usize>>,
}

impl EventService {
    pub fn new(db: DBService, msg_store: Arc<MsgStore>, entry_count: Arc<RwLock<usize>>) -> Self {
        Self {
            msg_store,
            db,
            entry_count,
        }
    }

    pub fn create_hook(
        msg_store: Arc<MsgStore>,
        entry_count: Arc<RwLock<usize>>,
        db_service: DBService,
    ) -> impl for<'a> Fn(
        &'a mut sqlx::sqlite::SqliteConnection,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), sqlx::Error>> + Send + 'a>,
    > + Send
    + Sync
    + 'static {
        move |conn: &mut sqlx::sqlite::SqliteConnection| {
            let msg_store_for_hook = msg_store.clone();
            let entry_count_for_hook = entry_count.clone();
            let db_for_hook = db_service.clone();
            Box::pin(async move {
                let mut handle = conn.lock_handle().await?;
                let runtime_handle = tokio::runtime::Handle::current();
                handle.set_preupdate_hook({
                    let msg_store_for_preupdate = msg_store_for_hook.clone();
                    move |preupdate: sqlx::sqlite::PreupdateHookResult<'_>| {
                        if preupdate.operation != SqliteOperation::Delete {
                            return;
                        }

                        match preupdate.table {
                            "projects" => {
                                if let Ok(value) = preupdate.get_old_column_value(0)
                                    && let Ok(project_id) = <Uuid as Decode<Sqlite>>::decode(value)
                                {
                                    msg_store_for_preupdate
                                        .push_patch(project_patch::remove(project_id));
                                }
                            }
                            "scratch" => {
                                if let Ok(id_val) = preupdate.get_old_column_value(0)
                                    && let Ok(scratch_id) = <Uuid as Decode<Sqlite>>::decode(id_val)
                                    && let Ok(type_val) = preupdate.get_old_column_value(1)
                                    && let Ok(type_str) =
                                        <String as Decode<Sqlite>>::decode(type_val)
                                {
                                    msg_store_for_preupdate
                                        .push_patch(scratch_patch::remove(scratch_id, &type_str));
                                }
                            }
                            _ => {}
                        }
                    }
                });

                handle.set_update_hook(move |hook: sqlx::sqlite::UpdateHookResult<'_>| {
                    let runtime_handle = runtime_handle.clone();
                    let entry_count_for_hook = entry_count_for_hook.clone();
                    let msg_store_for_hook = msg_store_for_hook.clone();
                    let db = db_for_hook.clone();

                    if let Ok(table) = HookTables::from_str(hook.table) {
                        let rowid = hook.rowid;
                        runtime_handle.spawn(async move {
                            let record_type: RecordTypes = match (table, hook.operation.clone()) {
                                (HookTables::Projects, SqliteOperation::Delete)
                                | (HookTables::Scratch, SqliteOperation::Delete) => return,
                                (HookTables::Projects, _) => {
                                    match Project::find_by_rowid(&db.pool, rowid).await {
                                        Ok(Some(project)) => RecordTypes::Project(project),
                                        Ok(None) => RecordTypes::DeletedProject {
                                            rowid,
                                            project_id: None,
                                        },
                                        Err(err) => {
                                            tracing::error!(?err, "Failed to fetch project");
                                            return;
                                        }
                                    }
                                }
                                (HookTables::Scratch, _) => {
                                    match Scratch::find_by_rowid(&db.pool, rowid).await {
                                        Ok(Some(scratch)) => RecordTypes::Scratch(scratch),
                                        Ok(None) => RecordTypes::DeletedScratch {
                                            rowid,
                                            scratch_id: None,
                                            scratch_type: None,
                                        },
                                        Err(err) => {
                                            tracing::error!(?err, "Failed to fetch scratch");
                                            return;
                                        }
                                    }
                                }
                            };

                            match &record_type {
                                RecordTypes::Project(project) => {
                                    let patch = match hook.operation {
                                        SqliteOperation::Insert => project_patch::add(project),
                                        SqliteOperation::Update => project_patch::replace(project),
                                        _ => project_patch::replace(project),
                                    };
                                    msg_store_for_hook.push_patch(patch);
                                    return;
                                }
                                RecordTypes::Scratch(scratch) => {
                                    let patch = match hook.operation {
                                        SqliteOperation::Insert => scratch_patch::add(scratch),
                                        SqliteOperation::Update => scratch_patch::replace(scratch),
                                        _ => scratch_patch::replace(scratch),
                                    };
                                    msg_store_for_hook.push_patch(patch);
                                    return;
                                }
                                RecordTypes::DeletedScratch {
                                    scratch_id: Some(scratch_id),
                                    scratch_type: Some(scratch_type_str),
                                    ..
                                } => {
                                    msg_store_for_hook.push_patch(scratch_patch::remove(
                                        *scratch_id,
                                        scratch_type_str,
                                    ));
                                    return;
                                }
                                _ => {}
                            }

                            let db_op: &str = match hook.operation {
                                SqliteOperation::Insert => "insert",
                                SqliteOperation::Delete => "delete",
                                SqliteOperation::Update => "update",
                                SqliteOperation::Unknown(_) => "unknown",
                            };
                            let next_entry_count = {
                                let mut entry_count = entry_count_for_hook.write().await;
                                *entry_count += 1;
                                *entry_count
                            };
                            let event_patch = EventPatch {
                                op: "add".to_string(),
                                path: format!("/entries/{next_entry_count}"),
                                value: EventPatchInner {
                                    db_op: db_op.to_string(),
                                    record: record_type,
                                },
                            };
                            let patch =
                                serde_json::from_value(json!([
                                    serde_json::to_value(event_patch).unwrap()
                                ]))
                                .unwrap();

                            msg_store_for_hook.push_patch(patch);
                        });
                    }
                });

                Ok(())
            })
        }
    }

    pub fn msg_store(&self) -> &Arc<MsgStore> {
        &self.msg_store
    }
}
