use db::models::{project::Project, scratch::Scratch};
use json_patch::{AddOperation, Patch, PatchOperation, RemoveOperation, ReplaceOperation};
use uuid::Uuid;

fn escape_pointer_segment(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

pub mod project_patch {
    use super::*;

    fn project_path(project_id: Uuid) -> String {
        format!(
            "/projects/{}",
            escape_pointer_segment(&project_id.to_string())
        )
    }

    pub fn add(project: &Project) -> Patch {
        Patch(vec![PatchOperation::Add(AddOperation {
            path: project_path(project.id)
                .try_into()
                .expect("Project path should be valid"),
            value: serde_json::to_value(project).expect("Project serialization should not fail"),
        })])
    }

    pub fn replace(project: &Project) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: project_path(project.id)
                .try_into()
                .expect("Project path should be valid"),
            value: serde_json::to_value(project).expect("Project serialization should not fail"),
        })])
    }

    pub fn remove(project_id: Uuid) -> Patch {
        Patch(vec![PatchOperation::Remove(RemoveOperation {
            path: project_path(project_id)
                .try_into()
                .expect("Project path should be valid"),
        })])
    }
}

pub mod scratch_patch {
    use super::*;

    const SCRATCH_PATH: &str = "/scratch";

    pub fn add(scratch: &Scratch) -> Patch {
        Patch(vec![PatchOperation::Add(AddOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::to_value(scratch).expect("Scratch serialization should not fail"),
        })])
    }

    pub fn replace(scratch: &Scratch) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::to_value(scratch).expect("Scratch serialization should not fail"),
        })])
    }

    pub fn remove(scratch_id: Uuid, scratch_type_str: &str) -> Patch {
        Patch(vec![PatchOperation::Replace(ReplaceOperation {
            path: SCRATCH_PATH
                .try_into()
                .expect("Scratch path should be valid"),
            value: serde_json::json!({
                "id": scratch_id,
                "payload": { "type": scratch_type_str },
                "deleted": true
            }),
        })])
    }
}
