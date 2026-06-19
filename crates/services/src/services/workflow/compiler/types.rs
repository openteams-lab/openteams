/// Compile errors produced by workflow plan compilation.
#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    #[error("Plan validation failed: {0}")]
    ValidationFailed(String),
    #[error("Compilation failed: {0}")]
    CompileError(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParallelWorkspaceConflict {
    pub wave_index: usize,
    pub workspace_path: String,
    pub members: Vec<ParallelWorkspaceMember>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParallelWorkspaceMember {
    pub agent_id: String,
    pub step_keys: Vec<String>,
}

/// Compiler that converts workflow plan JSON into an executable compiled graph.
pub struct WorkflowCompiler;
