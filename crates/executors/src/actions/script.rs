use std::{path::Path, sync::Arc};

use async_trait::async_trait;
#[cfg(not(windows))]
use command_group::AsyncCommandGroup;
use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use tokio::process::Command;
use ts_rs::TS;

use crate::{
    actions::Executable,
    approvals::ExecutorApprovalService,
    env::ExecutionEnv,
    executors::{ExecutorError, SpawnedChild},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub enum ScriptRequestLanguage {
    Bash,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub enum ScriptContext {
    SetupScript,
    CleanupScript,
    ArchiveScript,
    DevServer,
    ToolInstallScript,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct ScriptRequest {
    pub script: String,
    pub language: ScriptRequestLanguage,
    pub context: ScriptContext,
    #[serde(default)]
    pub working_dir: Option<String>,
}

#[async_trait]
impl Executable for ScriptRequest {
    async fn spawn(
        &self,
        current_dir: &Path,
        _approvals: Arc<dyn ExecutorApprovalService>,
        _env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        #[cfg(windows)]
        {
            let _ = current_dir;
            return Err(ExecutorError::Io(std::io::Error::other(
                "Bash scripts are not supported on Windows. Use PowerShell or CMD scripts instead.",
            )));
        }

        #[cfg(not(windows))]
        {
            let effective_dir = match &self.working_dir {
                Some(rel_path) => current_dir.join(rel_path),
                None => current_dir.to_path_buf(),
            };

            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
            let mut command = Command::new(&shell);
            command
                .kill_on_drop(true)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .arg("-c")
                .arg(&self.script)
                .current_dir(&effective_dir);

            _env.apply_to_command(&mut command);

            let child = command.group_spawn()?;

            Ok(child.into())
        }
    }
}
