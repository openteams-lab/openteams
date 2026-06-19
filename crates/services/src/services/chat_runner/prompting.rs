use super::*;

impl ChatRunner {
    pub(super) async fn resolve_workspace_path_for_agent(
        &self,
        session_id: Uuid,
        agent_id: Uuid,
        session_agent_workspace_path: Option<String>,
    ) -> Result<String, ChatRunnerError> {
        if let Some(workspace_path) = session_agent_workspace_path {
            return Ok(workspace_path);
        }

        let session_default_workspace_path = ChatSession::find_by_id(&self.db.pool, session_id)
            .await?
            .and_then(|session| session.default_workspace_path);

        Ok(Self::select_workspace_path(
            None,
            session_default_workspace_path.as_deref(),
            self.build_workspace_path(session_id, agent_id),
        ))
    }

    pub(super) fn select_workspace_path(
        session_agent_workspace_path: Option<&str>,
        session_default_workspace_path: Option<&str>,
        generated_workspace_path: String,
    ) -> String {
        session_agent_workspace_path
            .or(session_default_workspace_path)
            .map(str::to_string)
            .unwrap_or(generated_workspace_path)
    }

    pub(super) fn build_workspace_path(&self, session_id: Uuid, agent_id: Uuid) -> String {
        asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join("agents")
            .join(agent_id.to_string())
            .to_string_lossy()
            .to_string()
    }

    pub(super) fn workspace_runs_dir(workspace_path: &Path, session_id: Uuid) -> PathBuf {
        workspace_path
            .join(OPENTEAMS_WORKSPACE_DIR)
            .join(RUNS_DIR_NAME)
            .join(session_id.to_string())
    }

    pub(super) fn workspace_run_records_dir(workspace_path: &Path, session_id: Uuid) -> PathBuf {
        Self::workspace_runs_dir(workspace_path, session_id).join(RUN_RECORDS_DIR_NAME)
    }

    pub(super) fn workspace_live_spool_dir(workspace_path: &Path) -> PathBuf {
        workspace_path
            .join(OPENTEAMS_WORKSPACE_DIR)
            .join("tmp")
            .join(RUNS_DIR_NAME)
    }

    pub(super) fn workspace_live_spool_path(workspace_path: &Path, run_id: Uuid) -> PathBuf {
        Self::workspace_live_spool_dir(workspace_path).join(format!("{run_id}.log"))
    }

    pub(super) fn run_records_prefix(session_agent_id: Uuid, run_index: i64) -> String {
        format!("session_agent_{session_agent_id}_run_{run_index:04}")
    }

    pub(super) fn session_protocol_dir(session_id: Uuid) -> PathBuf {
        asset_dir()
            .join("chat")
            .join(format!("session_{session_id}"))
            .join(SHARED_PROTOCOL_DIR_NAME)
    }

    pub(super) fn session_shared_blackboard_path(session_id: Uuid) -> PathBuf {
        Self::session_protocol_dir(session_id).join(SHARED_BLACKBOARD_FILE_NAME)
    }

    pub(super) fn session_work_records_path(session_id: Uuid) -> PathBuf {
        Self::session_protocol_dir(session_id).join(WORK_RECORDS_FILE_NAME)
    }

    pub(super) async fn sync_protocol_context_files(
        session_id: Uuid,
        context_dir: &Path,
    ) -> Result<(), ChatRunnerError> {
        let protocol_dir = Self::session_protocol_dir(session_id);
        fs::create_dir_all(&protocol_dir).await?;

        for (canonical, dest_name) in [
            (
                Self::session_shared_blackboard_path(session_id),
                SHARED_BLACKBOARD_FILE_NAME,
            ),
            (
                Self::session_work_records_path(session_id),
                WORK_RECORDS_FILE_NAME,
            ),
        ] {
            if fs::metadata(&canonical).await.is_err() {
                fs::write(&canonical, "").await?;
            }
            let contents = fs::read(&canonical).await.unwrap_or_default();
            fs::write(context_dir.join(dest_name), contents).await?;
        }

        Ok(())
    }

    pub(super) async fn append_jsonl_line<T: Serialize>(
        path: &Path,
        value: &T,
    ) -> Result<(), ChatRunnerError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;
        let line = serde_json::to_string(value)?;
        file.write_all(line.as_bytes()).await?;
        file.write_all(b"\n").await?;
        Ok(())
    }

    pub(super) fn parse_runner_type(
        &self,
        agent: &ChatAgent,
    ) -> Result<BaseCodingAgent, ChatRunnerError> {
        let raw = agent.runner_type.trim();
        let normalized = raw.replace(['-', ' '], "_").to_ascii_uppercase();
        BaseCodingAgent::from_str(&normalized)
            .map_err(|_| ChatRunnerError::UnknownRunnerType(raw.to_string()))
    }

    pub(crate) async fn resolve_session_agent_skills(
        &self,
        session_agent: &ChatSessionAgent,
        agent: &ChatAgent,
    ) -> Result<Vec<ChatSkill>, ChatRunnerError> {
        let runner_type = self.parse_runner_type(agent)?;
        let allowed_skill_ids = session_agent
            .allowed_skill_ids
            .0
            .iter()
            .map(|skill_id| skill_id.trim().to_string())
            .filter(|skill_id| !skill_id.is_empty())
            .collect::<HashSet<_>>();

        if allowed_skill_ids.is_empty() {
            return Ok(Vec::new());
        }

        let skills = list_native_skills_for_runner(&self.db.pool, runner_type)
            .await?
            .into_iter()
            .filter(|item| item.enabled)
            .filter(|item| allowed_skill_ids.contains(&item.skill.id.to_string()))
            .map(|item| item.skill)
            .collect();

        Ok(skills)
    }

    pub(crate) async fn ensure_and_allow_builtin_skills(
        &self,
        session_agent: &mut ChatSessionAgent,
        agent: &ChatAgent,
        skill_names: &[&str],
    ) -> Result<(), ChatRunnerError> {
        let runner_type = self.parse_runner_type(agent)?;

        ensure_builtin_skills_installed(&self.db.pool, runner_type, skill_names).await?;
        auto_allow_builtin_skills(&self.db.pool, session_agent, runner_type, skill_names).await?;

        Ok(())
    }

    /// Unified entry point before running any agent prompt.
    /// 1. Installs and allows builtin skills required by the given context.
    /// 2. Resolves all authorized skills for the session agent.
    ///
    /// Returns the list of resolved skills for prompt injection.
    pub(crate) async fn prepare_and_resolve_agent_skills(
        &self,
        session_agent: &mut ChatSessionAgent,
        agent: &ChatAgent,
        context: crate::services::agent_skill_policy::AgentPromptContext,
    ) -> Result<Vec<db::models::chat_skill::ChatSkill>, ChatRunnerError> {
        let skills = self
            .resolve_session_agent_skills(session_agent, agent)
            .await?;
        let mut required_installed_skills =
            crate::services::agent_skill_policy::required_builtin_skills(context).to_vec();
        for skill in &skills {
            let name = skill.name.trim();
            if !name.is_empty()
                && !required_installed_skills
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(name))
            {
                required_installed_skills.push(name);
            }
        }

        if !required_installed_skills.is_empty() {
            self.ensure_and_allow_builtin_skills(session_agent, agent, &required_installed_skills)
                .await?;
        }

        Ok(skills)
    }

    pub(super) fn sanitize_sender_token(value: &str, fallback: &str) -> String {
        let sanitized = value
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect::<String>();
        if sanitized.is_empty() {
            fallback.to_string()
        } else {
            sanitized
        }
    }

    pub(super) fn resolve_message_sender_identity(message: &ChatMessage) -> MessageSenderIdentity {
        let sender_meta = message.meta.0.get("sender");
        let structured_meta = message.meta.0.get("structured");

        let user_handle = message
            .meta
            .0
            .get("sender_handle")
            .and_then(|value| value.as_str())
            .or_else(|| {
                sender_meta
                    .and_then(|value| value.get("handle"))
                    .and_then(|value| value.as_str())
            })
            .or_else(|| {
                structured_meta
                    .and_then(|value| value.get("sender_handle"))
                    .and_then(|value| value.as_str())
            });

        let agent_label = sender_meta
            .and_then(|value| value.get("name").and_then(|name| name.as_str()))
            .or_else(|| {
                sender_meta.and_then(|value| value.get("label").and_then(|label| label.as_str()))
            })
            .or_else(|| {
                structured_meta
                    .and_then(|value| value.get("sender_label").and_then(|label| label.as_str()))
            });

        match message.sender_type {
            ChatSenderType::User => {
                let label = Self::sanitize_sender_token(user_handle.unwrap_or("you"), "you");
                MessageSenderIdentity {
                    address: format!("user:{label}"),
                    label,
                }
            }
            ChatSenderType::Agent => {
                let label = Self::sanitize_sender_token(agent_label.unwrap_or("agent"), "agent");
                MessageSenderIdentity {
                    address: format!("agent:{label}"),
                    label,
                }
            }
            ChatSenderType::System => MessageSenderIdentity {
                address: "system".to_string(),
                label: "system".to_string(),
            },
        }
    }

    pub(super) async fn capture_tracked_git_diff_snapshot(workspace_path: &Path) -> Option<String> {
        let check = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
            .await
            .ok()?;

        if !check.status.success() {
            return None;
        }

        let status = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["status", "--porcelain"])
            .output()
            .await
            .ok()?;

        if !status.status.success() {
            return None;
        }

        let status_text = String::from_utf8_lossy(&status.stdout);
        let has_tracked_changes = status_text.lines().any(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with("??")
        });

        if !has_tracked_changes {
            return None;
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args(["diff", "--no-color"])
            .output()
            .await
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let diff = String::from_utf8_lossy(&output.stdout).to_string();
        if diff.trim().is_empty() {
            return None;
        }

        Some(diff)
    }

    fn diff_header_path(line: &str, workspace_path: &Path) -> Option<String> {
        let rest = line.strip_prefix("diff --git a/")?;
        let (old_path, new_path) = rest.split_once(" b/")?;
        let preferred = if new_path.trim() == "/dev/null" {
            old_path
        } else {
            new_path
        };
        normalize_workspace_observed_path(preferred, workspace_path)
    }

    fn split_git_diff_by_path(
        diff: &str,
        workspace_path: &Path,
    ) -> BTreeMap<String, String> {
        let mut patches = BTreeMap::<String, String>::new();
        let mut current_path: Option<String> = None;
        let mut current_patch = String::new();

        for line in diff.split_inclusive('\n') {
            if let Some(next_path) = Self::diff_header_path(line, workspace_path) {
                if let Some(path) = current_path.take()
                    && !current_patch.trim().is_empty()
                {
                    patches.insert(path, std::mem::take(&mut current_patch));
                }
                current_path = Some(next_path);
            }

            if current_path.is_some() {
                current_patch.push_str(line);
            }
        }

        if let Some(path) = current_path
            && !current_patch.trim().is_empty()
        {
            patches.insert(path, current_patch);
        }

        patches
    }

    fn filter_git_diff_against_baseline(
        diff: &str,
        baseline_diff: Option<&str>,
        workspace_path: &Path,
    ) -> (String, Vec<String>) {
        let current_patches = Self::split_git_diff_by_path(diff, workspace_path);
        let baseline_patches = baseline_diff
            .map(|baseline| Self::split_git_diff_by_path(baseline, workspace_path))
            .unwrap_or_default();

        let mut filtered_diff = String::new();
        let mut observed_paths = Vec::new();

        for (path, patch) in current_patches {
            if baseline_patches
                .get(&path)
                .is_some_and(|baseline_patch| baseline_patch == &patch)
            {
                continue;
            }

            filtered_diff.push_str(&patch);
            if !filtered_diff.ends_with('\n') {
                filtered_diff.push('\n');
            }
            observed_paths.push(path);
        }

        (filtered_diff, observed_paths)
    }

    #[allow(dead_code)]
    pub(super) async fn capture_git_diff(
        workspace_path: &Path,
        run_dir: &Path,
        session_agent_id: Uuid,
        run_index: i64,
        baseline_diff: Option<&str>,
    ) -> Option<DiffInfo> {
        let diff = Self::capture_tracked_git_diff_snapshot(workspace_path).await?;
        let (diff, observed_paths) =
            Self::filter_git_diff_against_baseline(&diff, baseline_diff, workspace_path);
        if diff.trim().is_empty() || observed_paths.is_empty() {
            return None;
        }

        let diff_path = run_dir.join(format!(
            "{}_diff.patch",
            Self::run_records_prefix(session_agent_id, run_index)
        ));
        if let Err(err) = fs::write(&diff_path, &diff).await {
            tracing::warn!("Failed to write diff patch: {}", err);
            return None;
        }

        // Consider diff truncated if it's over 4KB (for UI display purposes)
        let truncated = diff.len() > 4000;

        Some(DiffInfo {
            _truncated: truncated,
            observed_paths,
        })
    }

    pub(super) async fn capture_untracked_file_snapshot(workspace_path: &Path) -> Vec<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(workspace_path)
            .args([
                "-c",
                "core.quotePath=false",
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
            ])
            .output()
            .await;

        let output = match output {
            Ok(output) if output.status.success() => output,
            _ => return Vec::new(),
        };

        let mut files = Vec::new();

        for raw in output.stdout.split(|b| *b == b'\0') {
            if raw.is_empty() {
                continue;
            }
            let rel = String::from_utf8_lossy(raw).to_string();
            let rel_path = PathBuf::from(&rel);
            if rel_path.is_absolute()
                || rel_path
                    .components()
                    .any(|component| matches!(component, std::path::Component::ParentDir))
            {
                continue;
            }
            if is_internal_openteams_runtime_path(&rel_path) {
                // Skip internal runtime artifacts generated by chat context snapshots.
                continue;
            }

            if let Some(path) = normalize_workspace_observed_path(&rel, workspace_path) {
                files.push(path);
            }
        }

        files.sort();
        files.dedup();
        files
    }

    #[allow(dead_code)]
    pub(super) async fn capture_untracked_files(
        workspace_path: &Path,
        _run_dir: &Path,
        _session_agent_id: Uuid,
        _run_index: i64,
    ) -> Vec<String> {
        Self::capture_untracked_file_snapshot(workspace_path).await
    }

    pub(super) async fn build_context_snapshot(
        &self,
        session_id: Uuid,
        workspace_path: &str,
    ) -> Result<ContextSnapshot, ChatRunnerError> {
        // Create context directory first (needed for cutoff files)
        let context_dir = PathBuf::from(workspace_path)
            .join(OPENTEAMS_WORKSPACE_DIR)
            .join(CONTEXT_DIR_NAME)
            .join(session_id.to_string());
        fs::create_dir_all(&context_dir).await?;
        let legacy_compacted_context_path = context_dir.join(LEGACY_COMPACTED_CONTEXT_FILE_NAME);
        if let Err(err) = fs::remove_file(&legacy_compacted_context_path).await
            && err.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(
                session_id = %session_id,
                error = %err,
                path = %legacy_compacted_context_path.display(),
                "Failed to remove legacy background compacted context file"
            );
        }

        // Main path must never block on summarization: always build full context synchronously.
        let full_context =
            crate::services::chat::build_full_context(&self.db.pool, session_id).await?;
        let jsonl = full_context.jsonl;
        let context_path = context_dir.join("messages.jsonl");
        fs::write(&context_path, jsonl.as_bytes()).await?;
        Self::sync_protocol_context_files(session_id, &context_dir).await?;
        tracing::info!(
            session_id = %session_id,
            workspace_path = %workspace_path,
            context_path = %context_path.display(),
            "Using workspace context (full, non-blocking)"
        );

        // Kick off background compaction for future runs, without blocking current run.
        self.spawn_background_context_compaction(
            session_id,
            workspace_path.to_string(),
            context_dir.clone(),
        );

        Ok(ContextSnapshot {
            workspace_path: context_path,
            context_compacted: false,
            compression_warning: None,
        })
    }

    pub(super) fn spawn_background_context_compaction(
        &self,
        session_id: Uuid,
        workspace_path: String,
        context_dir: PathBuf,
    ) {
        if self
            .background_compaction_inflight
            .contains_key(&session_id)
        {
            return;
        }
        self.background_compaction_inflight.insert(session_id, ());

        let runner = self.clone();
        tokio::spawn(async move {
            let workspace_path_buf = PathBuf::from(&workspace_path);
            let result = crate::services::chat::build_compacted_context(
                &runner.db.pool,
                session_id,
                None,
                Some(workspace_path_buf.as_path()),
                Some(context_dir.as_path()),
            )
            .await;

            match result {
                Ok(compacted) => {
                    if compacted.context_compacted {
                        let workspace_context_path = context_dir.join("messages.jsonl");
                        if let Err(err) =
                            fs::write(&workspace_context_path, compacted.jsonl.as_bytes()).await
                        {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %err,
                                path = %workspace_context_path.display(),
                                "Failed to update workspace context with compacted history"
                            );
                        } else {
                            tracing::info!(
                                session_id = %session_id,
                                path = %workspace_context_path.display(),
                                compacted_message_count = compacted.messages.len(),
                                "Background context compaction completed and updated workspace context"
                            );
                        }
                    }

                    if let Some(warning) = compacted.compression_warning {
                        runner.emit(
                            session_id,
                            ChatStreamEvent::CompressionWarning {
                                session_id,
                                warning: warning.into(),
                            },
                        );
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %err,
                        "Background context compaction failed"
                    );
                }
            }

            runner.background_compaction_inflight.remove(&session_id);
        });
    }

    pub(super) async fn build_reference_context(
        &self,
        session_id: Uuid,
        source_message: &ChatMessage,
        context_dir: &Path,
    ) -> Result<Option<ReferenceContext>, ChatRunnerError> {
        let Some(reference_id) = chat::extract_reference_message_id(&source_message.meta.0) else {
            return Ok(None);
        };

        let Some(reference) = ChatMessage::find_by_id(&self.db.pool, reference_id).await? else {
            return Ok(None);
        };

        if reference.session_id != session_id {
            return Ok(None);
        }

        let sender_label = reference
            .meta
            .0
            .get("sender")
            .and_then(|value| value.get("label"))
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string();

        let attachments = chat::extract_attachments(&reference.meta.0);
        let mut reference_attachments = Vec::new();

        if !attachments.is_empty() {
            let reference_dir = context_dir
                .join("references")
                .join(reference_id.to_string());
            fs::create_dir_all(&reference_dir).await?;

            for attachment in attachments {
                let relative = PathBuf::from(&attachment.relative_path);
                if relative.is_absolute()
                    || relative
                        .components()
                        .any(|component| matches!(component, Component::ParentDir))
                {
                    continue;
                }

                let source_path = asset_dir().join(&relative);
                let file_name = source_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| attachment.name.clone());
                let dest_path = reference_dir.join(&file_name);
                let local_path = if fs::copy(&source_path, &dest_path).await.is_ok() {
                    dest_path.to_string_lossy().to_string()
                } else {
                    source_path.to_string_lossy().to_string()
                };

                reference_attachments.push(ReferenceAttachment {
                    name: attachment.name,
                    mime_type: attachment.mime_type,
                    size_bytes: attachment.size_bytes,
                    kind: attachment.kind,
                    local_path,
                });
            }
        }

        Ok(Some(ReferenceContext {
            message_id: reference.id,
            sender_label,
            sender_type: reference.sender_type,
            created_at: reference.created_at.to_rfc3339(),
            content: reference.content,
            attachments: reference_attachments,
        }))
    }

    pub(super) async fn build_message_attachment_context(
        &self,
        source_message: &ChatMessage,
        context_dir: &Path,
    ) -> Result<Option<MessageAttachmentContext>, ChatRunnerError> {
        let attachments = chat::extract_attachments(&source_message.meta.0);
        if attachments.is_empty() {
            return Ok(None);
        }

        let message_dir = context_dir
            .join("attachments")
            .join(source_message.id.to_string());
        fs::create_dir_all(&message_dir).await?;

        let mut message_attachments = Vec::new();
        for attachment in attachments {
            let relative = PathBuf::from(&attachment.relative_path);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|component| matches!(component, Component::ParentDir))
            {
                continue;
            }

            let source_path = asset_dir().join(&relative);
            let file_name = source_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| attachment.name.clone());
            let dest_path = message_dir.join(&file_name);
            let local_path = if fs::copy(&source_path, &dest_path).await.is_ok() {
                dest_path.to_string_lossy().to_string()
            } else {
                source_path.to_string_lossy().to_string()
            };

            message_attachments.push(ReferenceAttachment {
                name: attachment.name,
                mime_type: attachment.mime_type,
                size_bytes: attachment.size_bytes,
                kind: attachment.kind,
                local_path,
            });
        }

        Ok(Some(MessageAttachmentContext {
            attachments: message_attachments,
        }))
    }

    pub(super) async fn build_session_agent_summaries(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<SessionAgentSummary>, ChatRunnerError> {
        let session_agents =
            ChatSessionAgent::find_all_for_session(&self.db.pool, session_id).await?;
        if session_agents.is_empty() {
            return Ok(Vec::new());
        }

        let agents = ChatAgent::find_all(&self.db.pool).await?;
        let member_names =
            chat::member_name_overrides_for_session(&self.db.pool, session_id).await?;
        let agent_map: HashMap<Uuid, ChatAgent> =
            agents.into_iter().map(|agent| (agent.id, agent)).collect();

        let mut summaries = Vec::with_capacity(session_agents.len());
        for session_agent in session_agents {
            let Some(agent) = agent_map.get(&session_agent.agent_id) else {
                tracing::warn!(
                    session_agent_id = %session_agent.id,
                    agent_id = %session_agent.agent_id,
                    "chat session agent missing backing agent"
                );
                continue;
            };
            let system_prompt = agent.system_prompt.trim();
            // Extract description from first line of system prompt or use agent name
            let description = if !system_prompt.is_empty() {
                system_prompt
                    .lines()
                    .next()
                    .map(|line| line.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            };
            let agent_skills = self
                .resolve_session_agent_skills(&session_agent, agent)
                .await
                .unwrap_or_default();
            let skills_used: Vec<String> = agent_skills
                .iter()
                .map(|skill| skill.name.clone())
                .collect();

            summaries.push(SessionAgentSummary {
                session_agent_id: session_agent.id,
                agent_id: agent.id,
                name: chat::effective_agent_name(
                    agent,
                    member_names.get(&agent.id).map(String::as_str),
                ),
                runner_type: agent.runner_type.clone(),
                state: session_agent.state,
                description,
                system_prompt: if system_prompt.is_empty() {
                    None
                } else {
                    Some(system_prompt.to_string())
                },
                tools_enabled: agent.tools_enabled.0.clone(),
                skills_used,
            });
        }

        Ok(summaries)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_exact_markdown_prompt(
        agent: &ChatAgent,
        message: &ChatMessage,
        context_dir: &Path,
        workspace_path: &Path,
        session_agents: &[SessionAgentSummary],
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
        skills: &[ChatSkill],
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let mut markdown = String::new();
        let sender = Self::resolve_message_sender_identity(message);
        let messages_path = context_dir.join("messages.jsonl");
        let shared_blackboard_path = context_dir.join(SHARED_BLACKBOARD_FILE_NAME);
        let work_records_path = context_dir.join(WORK_RECORDS_FILE_NAME);
        let visible_members = session_agents
            .iter()
            .filter(|member| member.agent_id != agent.id)
            .collect::<Vec<_>>();
        let active_skills = Self::filter_active_skills(skills, Some(message.content.as_str()));
        let is_protocol_retry = Self::extract_protocol_retry_attempt(&message.meta) > 0;

        // Compute relative paths for context files
        let messages_rel = pathdiff::diff_paths(&messages_path, workspace_path)
            .unwrap_or_else(|| messages_path.clone());
        let shared_blackboard_rel = pathdiff::diff_paths(&shared_blackboard_path, workspace_path)
            .unwrap_or_else(|| shared_blackboard_path.clone());
        let work_records_rel = pathdiff::diff_paths(&work_records_path, workspace_path)
            .unwrap_or_else(|| work_records_path.clone());

        let is_workflow_mode = chat::is_workflow_chat_input_mode(&message.meta.0);

        markdown.push_str("# Chat Message\n\n");
        markdown.push_str("## Output Requirements\n");
        markdown.push_str("Return **only a JSON array** matching the following schema.\n\n");

        markdown.push_str("### Rules\n");
        markdown.push_str("1. Output only content directly related to the current task.\n");
        if is_workflow_mode {
            markdown.push_str("2. Keep messages concise.\n");
            markdown.push_str(
                "3. Workflow mode: `send.to` may only be `\"you\"` (the user). Do not send direct group-chat messages to other agents; workflow orchestration will dispatch agent work through the workflow plan.\n",
            );
        } else {
            markdown.push_str(
                "2. Keep messages concise. Put complex content into files instead of long text.\n",
            );
            markdown
                .push_str("3. `send.to` must match a group member name or `\"you\"` (the user).\n");
        }
        markdown.push_str("4. `record`: long-lived shared facts only. Written to `");
        markdown.push_str(&shared_blackboard_rel.to_string_lossy());
        markdown.push_str("`.\n");
        markdown.push_str("5. `artifact`: deliverables or file paths only. Written to `");
        markdown.push_str(&work_records_rel.to_string_lossy());
        markdown.push_str("`.\n");
        markdown.push_str(
            "6. `conclusion`: current-turn summary only (completed work, blockers, next steps). Max 3 sentences. Written to `",
        );
        markdown.push_str(&work_records_rel.to_string_lossy());
        markdown.push_str("`.\n");
        if is_workflow_mode {
            markdown.push_str("7. `workflow_generate`: \n");
            markdown.push_str(
                "- Emit `workflow_generate` only when the user explicitly asks to start generating an execution plan.\n",
            );
            markdown.push_str(
                "- Treat explicit trigger phrases such as `生成计划`, `开始执行`, `开始落实`, `进入执行`, `generate plan`, or `start execution`, and close equivalents, as valid start-plan requests.\n",
            );
            markdown.push_str(
                "- Review the chat history first and confirm that a final implementation plan has already been discussed and agreed on.\n",
            );
            markdown.push_str(
                "- If no final plan is confirmed, emit `workflow_generate` with `plan_check: false` and also send a `send` message to `\"you\"` explaining the current planning status; do not send workflow-mode messages to other agents.\n",
            );
            markdown.push_str(
                "- If a final plan is confirmed, emit `workflow_generate` with `plan_check: true`; its `content` must be a concise plan-generation brief that includes the essential plan summary, relevant plan files, participating members, and other execution-defining context.\n",
            );
            markdown.push_str(
                "- `design_doc_path` (optional, array of strings): file paths to design documents that were discussed and confirmed. If the chat history references design document files, include their paths here so the plan generator can read them for context. Leave empty or omit if no design documents are available.\n\n",
            );
        }

        if is_workflow_mode {
            markdown.push_str("### Schema\n");
            markdown.push_str("```json\n");
            markdown.push_str(PROTOCOL_OUTPUT_SCHEMA_JSON_WORKFLOW_PLAN);
            markdown.push_str("\n```\n\n");
        } else {
            markdown.push_str("### Schema\n");
            markdown.push_str("```json\n");
            markdown.push_str(PROTOCOL_OUTPUT_SCHEMA_JSON);
            markdown.push_str("\n```\n\n");
        }

        if is_workflow_mode {
            markdown.push_str("### Example\n");
            markdown.push_str("```json\n");
            markdown.push_str(MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON_WORKFLOW_PLAN);
            markdown.push_str("\n```\n\n");
        } else {
            markdown.push_str("### Example\n");
            markdown.push_str("```json\n");
            markdown.push_str(MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON);
            markdown.push_str("\n```\n\n");
        }

        if !is_protocol_retry {
            markdown.push_str("## Agent\n");
            markdown.push_str("- name: ");
            markdown.push_str(&agent.name);
            markdown.push('\n');
            let normalized_system_prompt =
                Self::strip_embedded_team_protocol_from_system_prompt(&agent.system_prompt);
            if !normalized_system_prompt.is_empty() {
                markdown.push_str("- role define: ");
                markdown.push_str("\n```\n");
                markdown.push_str(&normalized_system_prompt);
                markdown.push_str("\n```\n");
            }

            if !is_workflow_mode {
                markdown.push_str("## Team Protocol\n");
                if let Some(protocol) = team_protocol {
                    if !protocol.trim().is_empty() {
                        markdown.push_str("\n````\n");
                        markdown.push_str(protocol.trim());
                        markdown.push_str("\n````\n");
                    } else {
                        markdown.push_str("No team protocol configured.\n");
                    }
                } else {
                    markdown.push_str("No team protocol configured.\n");
                }
                markdown.push('\n');
            }
        }

        markdown.push_str("## Group Members\n");
        if visible_members.is_empty() {
            markdown.push_str("_None_\n\n");
        } else {
            for member in visible_members {
                markdown.push_str("- ");
                markdown.push_str(&member.name);
                if let Some(desc) = &member.description {
                    markdown.push_str(": ");
                    markdown.push_str(desc);
                }
                markdown.push('\n');
            }
            markdown.push('\n');
        }

        markdown.push_str("## History\n");
        markdown.push_str("Read history only when the task clearly depends on continuation, refinement, or prior context.  \n");
        markdown.push_str("Available files:\n");
        markdown.push_str("- `");
        markdown.push_str(&messages_rel.to_string_lossy());
        markdown.push_str("`\n");
        markdown.push_str("- `");
        markdown.push_str(&shared_blackboard_rel.to_string_lossy());
        markdown.push_str("`\n");
        markdown.push_str("- `");
        markdown.push_str(&work_records_rel.to_string_lossy());
        markdown.push_str("`\n\n");

        markdown.push_str("## Using language: \n");
        markdown.push_str(prompt_language.setting);
        markdown.push_str("\n\n");

        if !is_protocol_retry {
            markdown.push_str("\n## Turn Skills\n");
            if active_skills.is_empty() {
                markdown.push_str("- No skills enabled for this turn. Do not use any skills.\n");
            } else {
                markdown.push_str("- Enabled skills: ");
                let skill_names: Vec<&str> =
                    active_skills.iter().map(|s| s.name.as_str()).collect();
                markdown.push_str(&skill_names.join(", "));
                markdown.push('\n');
            }
        }

        if is_workflow_mode {
            markdown.push_str("\n## Workflow Mode\n");
            markdown.push_str("**Currently in workflow mode**, you are the lead agent in this mode, responsible for confirming requirements with the user, discussing solution details, and generating an execution plan.\n");
            markdown.push_str("You MUST use the `brainstorming` skill to complete the solution design. no implementation work is allowed.\n");
            markdown.push_str("After the solution is confirmed, please prompt the user to decide if they want to proceed with generating the plan.\n");
        }

        markdown.push_str("## Current Turn\n");

        markdown.push_str("\n### Input Message\n");
        markdown.push_str("- sender: ");
        markdown.push_str(&sender.label);
        markdown.push('\n');
        markdown.push_str("- content:\n");
        markdown.push_str("```text\n");
        markdown.push_str(&message.content);
        if !message.content.ends_with('\n') {
            markdown.push('\n');
        }
        markdown.push_str("```\n");
        if let Some((intent, meaning)) = Self::routed_message_intent_context(message, &agent.name) {
            markdown.push_str("- intent: ");
            markdown.push_str(&intent);
            markdown.push('\n');
            markdown.push_str("- intent_meaning: ");
            markdown.push_str(&meaning);
            markdown.push('\n');
            if intent == "notify" {
                markdown.push_str(
                    "- response_requirement: Notification only. Do not send a reply or acknowledgment to the sender.\n",
                );
            }
        }

        if let Some(reference) = reference {
            markdown.push_str("\n### Reference\n");
            markdown.push_str("User referenced the following historical message. Prioritize it.\n");
            markdown.push_str("- message_id: ");
            markdown.push_str(&reference.message_id.to_string());
            markdown.push('\n');
            markdown.push_str("- sender: ");
            markdown.push_str(&reference.sender_label);
            markdown.push('\n');
            markdown.push_str("- sender_type: ");
            markdown.push_str(&format!("{:?}", reference.sender_type));
            markdown.push('\n');
            markdown.push_str("- created_at: ");
            markdown.push_str(&reference.created_at);
            markdown.push('\n');
            markdown.push_str("- content:\n");
            markdown.push_str("```text\n");
            markdown.push_str(&reference.content);
            if !reference.content.ends_with('\n') {
                markdown.push('\n');
            }
            markdown.push_str("```\n");

            for (index, attachment) in reference.attachments.iter().enumerate() {
                markdown.push_str(&format!("\n#### Reference Attachment {}\n", index + 1));
                markdown.push_str("- name: ");
                markdown.push_str(&attachment.name);
                markdown.push('\n');
                markdown.push_str("- kind: ");
                markdown.push_str(&attachment.kind);
                markdown.push('\n');
                markdown.push_str("- size_bytes: ");
                markdown.push_str(&attachment.size_bytes.to_string());
                markdown.push('\n');
                markdown.push_str("- mime_type: ");
                markdown.push_str(attachment.mime_type.as_deref().unwrap_or("unknown"));
                markdown.push('\n');
                markdown.push_str("- local_path: ");
                markdown.push_str(&attachment.local_path);
                markdown.push('\n');
            }
        }

        if let Some(attachments_ctx) = message_attachments {
            for (index, attachment) in attachments_ctx.attachments.iter().enumerate() {
                markdown.push_str(&format!("\n### Attachment {}\n", index + 1));
                markdown.push_str("- name: ");
                markdown.push_str(&attachment.name);
                markdown.push('\n');
                markdown.push_str("- kind: ");
                markdown.push_str(&attachment.kind);
                markdown.push('\n');
                markdown.push_str("- size_bytes: ");
                markdown.push_str(&attachment.size_bytes.to_string());
                markdown.push('\n');
                markdown.push_str("- mime_type: ");
                markdown.push_str(attachment.mime_type.as_deref().unwrap_or("unknown"));
                markdown.push('\n');
                markdown.push_str("- local_path: ");
                markdown.push_str(&attachment.local_path);
                markdown.push('\n');
            }
        }

        markdown.push_str("## Envelope\n");
        markdown.push_str("- session_id: ");
        markdown.push_str(&message.session_id.to_string());
        markdown.push('\n');
        markdown.push_str("- from: ");
        markdown.push_str(&sender.address);
        markdown.push('\n');
        markdown.push_str("- to: agent:");
        markdown.push_str(&agent.name);
        markdown.push('\n');
        markdown.push_str("- message_id: ");
        markdown.push_str(&message.id.to_string());
        markdown.push('\n');
        markdown.push_str("- timestamp: ");
        markdown.push_str(&message.created_at.to_string());
        markdown.push('\n');

        markdown
    }

    pub(super) fn resolve_prompt_language(
        message: &ChatMessage,
        configured_language: &UiLanguage,
    ) -> ResolvedPromptLanguage {
        let system_locale = sys_locale::get_locale();
        Self::resolve_prompt_language_with_system_locale(
            message,
            configured_language,
            system_locale.as_deref(),
        )
    }

    pub(super) fn resolve_prompt_language_with_system_locale(
        message: &ChatMessage,
        configured_language: &UiLanguage,
        system_locale: Option<&str>,
    ) -> ResolvedPromptLanguage {
        Self::resolve_prompt_language_from_meta(&message.meta)
            .or_else(|| match configured_language {
                UiLanguage::Browser => system_locale
                    .and_then(Self::resolve_prompt_language_from_value)
                    .or_else(|| Self::infer_prompt_language_from_text(&message.content)),
                _ => None,
            })
            .unwrap_or_else(|| Self::resolve_prompt_language_from_ui_language(configured_language))
    }

    pub(super) fn resolve_prompt_language_from_meta(
        meta: &sqlx::types::Json<serde_json::Value>,
    ) -> Option<ResolvedPromptLanguage> {
        meta.get("app_language")
            .and_then(|value| value.as_str())
            .and_then(Self::resolve_prompt_language_from_value)
    }

    pub(super) fn resolve_prompt_language_from_ui_language(
        language: &UiLanguage,
    ) -> ResolvedPromptLanguage {
        match language {
            UiLanguage::Browser | UiLanguage::En => ResolvedPromptLanguage {
                setting: "english",
                code: "en",
                instruction: "You MUST respond in English.",
            },
            UiLanguage::ZhHans => ResolvedPromptLanguage {
                setting: "simplified_chinese",
                code: "zh-Hans",
                instruction: "You MUST respond in Simplified Chinese.",
            },
            UiLanguage::ZhHant => ResolvedPromptLanguage {
                setting: "traditional_chinese",
                code: "zh-Hant",
                instruction: "You MUST respond in Traditional Chinese.",
            },
            UiLanguage::Ja => ResolvedPromptLanguage {
                setting: "japanese",
                code: "ja",
                instruction: "You MUST respond in Japanese.",
            },
            UiLanguage::Ko => ResolvedPromptLanguage {
                setting: "korean",
                code: "ko",
                instruction: "You MUST respond in Korean.",
            },
            UiLanguage::Fr => ResolvedPromptLanguage {
                setting: "french",
                code: "fr",
                instruction: "You MUST respond in French.",
            },
            UiLanguage::Es => ResolvedPromptLanguage {
                setting: "spanish",
                code: "es",
                instruction: "You MUST respond in Spanish.",
            },
        }
    }

    pub(super) fn resolve_prompt_language_from_value(
        value: &str,
    ) -> Option<ResolvedPromptLanguage> {
        let normalized = value.trim().replace('_', "-").to_ascii_lowercase();
        if normalized.is_empty() || normalized == "browser" {
            return None;
        }

        if normalized == "zh-hant"
            || normalized.starts_with("zh-hant-")
            || normalized.starts_with("zh-tw")
            || normalized.starts_with("zh-hk")
            || normalized.starts_with("zh-mo")
            || normalized == "traditional-chinese"
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHant,
            ));
        }

        if normalized == "zh"
            || normalized == "zh-hans"
            || normalized.starts_with("zh-hans-")
            || normalized.starts_with("zh-cn")
            || normalized.starts_with("zh-sg")
            || normalized == "simplified-chinese"
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHans,
            ));
        }

        if normalized == "en" || normalized.starts_with("en-") || normalized == "english" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::En,
            ));
        }

        if normalized == "fr" || normalized.starts_with("fr-") || normalized == "french" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Fr,
            ));
        }

        if normalized == "ja" || normalized.starts_with("ja-") || normalized == "japanese" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ja,
            ));
        }

        if normalized == "es" || normalized.starts_with("es-") || normalized == "spanish" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Es,
            ));
        }

        if normalized == "ko" || normalized.starts_with("ko-") || normalized == "korean" {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ko,
            ));
        }

        None
    }

    pub(super) fn infer_prompt_language_from_text(text: &str) -> Option<ResolvedPromptLanguage> {
        const TRADITIONAL_CHINESE_HINT_CHARS: &str = "\u{81fa}\u{7063}\u{7e41}\u{9ad4}\u{9019}\u{500b}\u{55ce}\u{70ba}\u{65bc}\u{8207}\u{5f8c}\u{6703}\u{767c}\u{73fe}\u{9801}";
        const SPANISH_HINT_CHARS: &str =
            "\u{00bf}\u{00a1}\u{00f1}\u{00e1}\u{00e9}\u{00ed}\u{00f3}\u{00fa}";
        const FRENCH_HINT_CHARS: &str = "\u{00e0}\u{00e2}\u{00e7}\u{00e9}\u{00e8}\u{00ea}\u{00eb}\u{00ee}\u{00ef}\u{00f4}\u{00f9}\u{00fb}\u{00fc}\u{00ff}\u{0153}\u{00e6}";

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{3040}'..='\u{30ff}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ja,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{ac00}'..='\u{d7af}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Ko,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| TRADITIONAL_CHINESE_HINT_CHARS.contains(ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHant,
            ));
        }

        if trimmed
            .chars()
            .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
        {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::ZhHans,
            ));
        }

        if trimmed.chars().any(|ch| FRENCH_HINT_CHARS.contains(ch)) {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Fr,
            ));
        }

        if trimmed.chars().any(|ch| SPANISH_HINT_CHARS.contains(ch)) {
            return Some(Self::resolve_prompt_language_from_ui_language(
                &UiLanguage::Es,
            ));
        }

        Some(Self::resolve_prompt_language_from_ui_language(
            &UiLanguage::En,
        ))
    }

    pub(super) fn parse_agent_protocol_messages(
        content: &str,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        let strict_error = match Self::extract_json_from_content(content) {
            Ok(json_str) => match Self::parse_agent_protocol_messages_from_json(&json_str) {
                Ok(messages) => return Ok(messages),
                Err(err) => err,
            },
            Err(err) => err,
        };

        if strict_error.code != ChatProtocolNoticeCode::InvalidJson {
            return Err(strict_error);
        }

        let Some(relaxed_json) = Self::extract_relaxed_json_from_content(content) else {
            return Err(strict_error);
        };
        let normalized_json = Self::normalize_relaxed_protocol_json(&relaxed_json);

        match Self::parse_agent_protocol_messages_from_json(&normalized_json) {
            Ok(messages) => Ok(messages),
            Err(err) if err.code != ChatProtocolNoticeCode::InvalidJson => Err(err),
            Err(_) => {
                let repaired_json =
                    Self::repair_relaxed_protocol_json_string_quotes(&normalized_json);
                if repaired_json == normalized_json {
                    return Err(strict_error);
                }

                match Self::parse_agent_protocol_messages_from_json(&repaired_json) {
                    Ok(messages) => Ok(messages),
                    Err(err) if err.code != ChatProtocolNoticeCode::InvalidJson => Err(err),
                    Err(_) => Err(strict_error),
                }
            }
        }
    }

    pub(super) fn parse_agent_protocol_messages_from_json(
        json_str: &str,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        let raw: serde_json::Value =
            serde_json::from_str(json_str).map_err(Self::invalid_json_error)?;
        let messages = match &raw {
            serde_json::Value::Array(_) => {
                serde_json::from_str::<Vec<AgentProtocolMessage>>(json_str)
                    .map_err(Self::invalid_json_error)?
            }
            _ => {
                return Err(AgentProtocolError {
                    code: ChatProtocolNoticeCode::NotJsonArray,
                    target: None,
                    detail: Some(format!(
                        "Parsed JSON value was {}. Expected a JSON array.",
                        Self::json_value_kind(&raw)
                    )),
                });
            }
        };

        Self::validate_agent_protocol_messages(messages)
    }

    pub(super) fn extract_relaxed_json_from_content(content: &str) -> Option<String> {
        let trimmed = content.trim();
        if matches!(trimmed.chars().next(), Some('[' | '{'))
            && let Some(candidate) = Self::extract_balanced_json_like_prefix(trimmed)
        {
            return Some(candidate);
        }

        if let Some(start) = trimmed.find("```json") {
            let json_start = start + 7;
            let remaining = &trimmed[json_start..];
            if let Some(candidate) = Self::extract_balanced_json_like_prefix(remaining) {
                return Some(candidate);
            }
        }

        if let Some(start) = trimmed.find("```") {
            let block_start = start + 3;
            let remaining = &trimmed[block_start..];
            if let Some(candidate) = Self::extract_balanced_json_like_prefix(remaining) {
                return Some(candidate);
            }
        }

        for (index, ch) in trimmed.char_indices() {
            if matches!(ch, '[' | '{')
                && let Some(candidate) = Self::extract_balanced_json_like_prefix(&trimmed[index..])
            {
                return Some(candidate);
            }
        }

        None
    }

    pub(super) fn extract_balanced_json_like_prefix(content: &str) -> Option<String> {
        let trimmed = content.trim_start();
        if !matches!(trimmed.chars().next(), Some('[' | '{')) {
            return None;
        }

        let mut stack = Vec::new();
        let mut in_string = false;
        let mut escaped = false;

        for (index, ch) in trimmed.char_indices() {
            if in_string {
                if escaped {
                    escaped = false;
                    continue;
                }

                match ch {
                    '\\' => escaped = true,
                    '"' => in_string = false,
                    _ => {}
                }
                continue;
            }

            match ch {
                '"' => in_string = true,
                '[' | '{' => stack.push(ch),
                ']' => {
                    if stack.pop() != Some('[') {
                        return None;
                    }
                    if stack.is_empty() {
                        return Some(trimmed[..index + ch.len_utf8()].to_string());
                    }
                }
                '}' => {
                    if stack.pop() != Some('{') {
                        return None;
                    }
                    if stack.is_empty() {
                        return Some(trimmed[..index + ch.len_utf8()].to_string());
                    }
                }
                _ => {}
            }
        }

        None
    }

    pub(super) fn normalize_relaxed_protocol_json(content: &str) -> String {
        #[derive(Clone, Copy)]
        enum Scope {
            Array,
            Object { expecting_first_member: bool },
        }

        let mut normalized = String::with_capacity(content.len() + 32);
        let mut scopes = Vec::new();
        let mut index = 0usize;

        while index < content.len() {
            let Some(ch) = content[index..].chars().next() else {
                break;
            };
            let next = index + ch.len_utf8();

            match ch {
                '{' => {
                    normalized.push(ch);
                    scopes.push(Scope::Object {
                        expecting_first_member: true,
                    });
                    index = next;
                }
                '[' => {
                    normalized.push(ch);
                    scopes.push(Scope::Array);
                    index = next;
                }
                '}' | ']' => {
                    normalized.push(ch);
                    scopes.pop();
                    index = next;
                }
                '"' => {
                    let Some(string_end) = Self::find_json_string_end(content, index) else {
                        normalized.push_str(&content[index..]);
                        break;
                    };
                    let raw_literal = &content[index..string_end];
                    let is_first_object_member = matches!(
                        scopes.last(),
                        Some(Scope::Object {
                            expecting_first_member: true
                        })
                    );

                    if is_first_object_member
                        && let Ok(raw_value) = serde_json::from_str::<String>(raw_literal)
                        && let Some(protocol_type) =
                            Self::canonical_protocol_message_type_name(&raw_value)
                    {
                        let next_token_index = Self::skip_json_whitespace(content, string_end);
                        if matches!(content[next_token_index..].chars().next(), Some(',')) {
                            normalized.push_str("\"type\": ");
                            normalized.push_str(
                                &serde_json::to_string(protocol_type)
                                    .expect("protocol type should serialize"),
                            );
                            if let Some(Scope::Object {
                                expecting_first_member,
                            }) = scopes.last_mut()
                            {
                                *expecting_first_member = false;
                            }
                            index = string_end;
                            continue;
                        }
                    }

                    normalized.push_str(raw_literal);
                    if let Some(Scope::Object {
                        expecting_first_member,
                    }) = scopes.last_mut()
                        && *expecting_first_member
                    {
                        *expecting_first_member = false;
                    }
                    index = string_end;
                }
                _ => {
                    normalized.push_str(&content[index..next]);
                    index = next;
                }
            }
        }

        normalized
    }

    pub(super) fn repair_relaxed_protocol_json_string_quotes(content: &str) -> String {
        #[derive(Clone, Copy)]
        enum Scope {
            Array,
            Object { phase: ObjectPhase },
        }

        #[derive(Clone, Copy, PartialEq, Eq)]
        enum ObjectPhase {
            ExpectKeyOrEnd,
            AfterKey,
            ExpectValue,
            AfterValue,
        }

        #[derive(Clone, Copy)]
        enum StringRole {
            Key,
            Value,
        }

        let mut repaired = String::with_capacity(content.len() + 16);
        let mut scopes = Vec::new();
        let mut index = 0usize;
        let mut in_string: Option<StringRole> = None;
        let mut escaped = false;

        while index < content.len() {
            let Some(ch) = content[index..].chars().next() else {
                break;
            };
            let next = index + ch.len_utf8();

            if let Some(role) = in_string {
                if escaped {
                    repaired.push(ch);
                    escaped = false;
                    index = next;
                    continue;
                }

                match ch {
                    '\\' => {
                        repaired.push(ch);
                        escaped = true;
                    }
                    '"' => {
                        let next_non_ws = Self::next_non_whitespace_char(content, next);
                        let closes_string = match role {
                            StringRole::Key => next_non_ws == Some(':'),
                            StringRole::Value => {
                                matches!(next_non_ws, Some(',' | '}' | ']'))
                                    || next_non_ws.is_none()
                            }
                        };

                        if closes_string {
                            repaired.push(ch);
                            if let Some(Scope::Object { phase }) = scopes.last_mut() {
                                match role {
                                    StringRole::Key if *phase == ObjectPhase::ExpectKeyOrEnd => {
                                        *phase = ObjectPhase::AfterKey;
                                    }
                                    StringRole::Value if *phase == ObjectPhase::ExpectValue => {
                                        *phase = ObjectPhase::AfterValue;
                                    }
                                    _ => {}
                                }
                            }
                            in_string = None;
                        } else {
                            repaired.push('\\');
                            repaired.push('"');
                        }
                    }
                    _ => repaired.push(ch),
                }

                index = next;
                continue;
            }

            match ch {
                '{' => {
                    if let Some(Scope::Object { phase }) = scopes.last_mut()
                        && *phase == ObjectPhase::ExpectValue
                    {
                        *phase = ObjectPhase::AfterValue;
                    }
                    repaired.push(ch);
                    scopes.push(Scope::Object {
                        phase: ObjectPhase::ExpectKeyOrEnd,
                    });
                }
                '[' => {
                    if let Some(Scope::Object { phase }) = scopes.last_mut()
                        && *phase == ObjectPhase::ExpectValue
                    {
                        *phase = ObjectPhase::AfterValue;
                    }
                    repaired.push(ch);
                    scopes.push(Scope::Array);
                }
                '}' | ']' => {
                    repaired.push(ch);
                    scopes.pop();
                }
                '"' => {
                    let role = match scopes.last() {
                        Some(Scope::Object {
                            phase: ObjectPhase::ExpectKeyOrEnd,
                        }) => StringRole::Key,
                        _ => StringRole::Value,
                    };
                    repaired.push(ch);
                    in_string = Some(role);
                }
                ':' => {
                    repaired.push(ch);
                    if let Some(Scope::Object { phase }) = scopes.last_mut()
                        && *phase == ObjectPhase::AfterKey
                    {
                        *phase = ObjectPhase::ExpectValue;
                    }
                }
                ',' => {
                    repaired.push(ch);
                    if let Some(Scope::Object { phase }) = scopes.last_mut()
                        && *phase == ObjectPhase::AfterValue
                    {
                        *phase = ObjectPhase::ExpectKeyOrEnd;
                    }
                }
                _ => {
                    repaired.push(ch);
                    if !ch.is_whitespace()
                        && let Some(Scope::Object { phase }) = scopes.last_mut()
                        && *phase == ObjectPhase::ExpectValue
                    {
                        *phase = ObjectPhase::AfterValue;
                    }
                }
            }

            index = next;
        }

        repaired
    }

    pub(super) fn find_json_string_end(content: &str, start: usize) -> Option<usize> {
        let mut escaped = false;
        let mut index = start + 1;

        while index < content.len() {
            let ch = content[index..].chars().next()?;
            let next = index + ch.len_utf8();

            if escaped {
                escaped = false;
                index = next;
                continue;
            }

            match ch {
                '\\' => escaped = true,
                '"' => return Some(next),
                _ => {}
            }

            index = next;
        }

        None
    }

    pub(super) fn skip_json_whitespace(content: &str, start: usize) -> usize {
        let mut index = start;
        while index < content.len() {
            let Some(ch) = content[index..].chars().next() else {
                break;
            };
            if !ch.is_whitespace() {
                break;
            }
            index += ch.len_utf8();
        }
        index
    }

    pub(super) fn next_non_whitespace_char(content: &str, start: usize) -> Option<char> {
        let index = Self::skip_json_whitespace(content, start);
        content[index..].chars().next()
    }

    pub(super) fn canonical_protocol_message_type_name(value: &str) -> Option<&'static str> {
        let normalized = value.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "send" => Some("send"),
            "record" => Some("record"),
            "artifact" | "artiface" | "artefact" => Some("artifact"),
            "conclusion" => Some("conclusion"),
            "workflow_generate" => Some("workflow_generate"),
            _ => None,
        }
    }

    pub(super) fn validate_agent_protocol_messages(
        messages: Vec<AgentProtocolMessage>,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        if messages.is_empty() {
            return Err(AgentProtocolError {
                code: ChatProtocolNoticeCode::EmptyMessage,
                target: None,
                detail: None,
            });
        }

        let mut validated = Vec::with_capacity(messages.len());
        for message in messages {
            match message.message_type {
                AgentProtocolMessageType::Send => {
                    let Some(target) = message.to.as_deref() else {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::MissingSendTarget,
                            target: None,
                            detail: None,
                        });
                    };
                    let Some(target) = Self::normalize_protocol_target(target) else {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::InvalidSendTarget,
                            target: Some(target.to_string()),
                            detail: None,
                        });
                    };
                    let intent = match message.intent.as_deref() {
                        Some(raw_intent) if !raw_intent.trim().is_empty() => {
                            let Some(intent) = Self::normalize_protocol_send_intent(raw_intent)
                            else {
                                return Err(AgentProtocolError {
                                    code: ChatProtocolNoticeCode::InvalidSendIntent,
                                    target: Some(raw_intent.trim().to_string()),
                                    detail: Some(format!(
                                        "Allowed values: {}.",
                                        PROTOCOL_SEND_INTENT_VALUES.join(", ")
                                    )),
                                });
                            };
                            Some(intent)
                        }
                        _ => None,
                    };
                    validated.push(AgentProtocolMessage {
                        message_type: AgentProtocolMessageType::Send,
                        to: Some(target),
                        intent,
                        plan_check: None,
                        content: message.content.trim().to_string(),
                        design_doc_path: None,
                    });
                }
                AgentProtocolMessageType::Record
                | AgentProtocolMessageType::Artifact
                | AgentProtocolMessageType::Conclusion => {
                    let content = message.content.trim().to_string();
                    if content.is_empty() {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::EmptyMessage,
                            target: None,
                            detail: None,
                        });
                    }
                    validated.push(AgentProtocolMessage {
                        message_type: message.message_type,
                        to: None,
                        intent: None,
                        plan_check: None,
                        content,
                        design_doc_path: None,
                    });
                }
                AgentProtocolMessageType::WorkflowGenerate => {
                    let plan_check = message.plan_check.unwrap_or(false);
                    let content = message.content.trim().to_string();
                    if plan_check && content.is_empty() {
                        return Err(AgentProtocolError {
                            code: ChatProtocolNoticeCode::EmptyMessage,
                            target: None,
                            detail: Some(
                                "`workflow_generate.content` is required when `plan_check` is true."
                                    .to_string(),
                            ),
                        });
                    }
                    validated.push(AgentProtocolMessage {
                        message_type: AgentProtocolMessageType::WorkflowGenerate,
                        to: None,
                        intent: None,
                        plan_check: Some(plan_check),
                        content,
                        design_doc_path: message.design_doc_path.clone(),
                    });
                }
            }
        }

        Ok(validated)
    }

    pub(super) fn normalize_protocol_target(target: &str) -> Option<String> {
        let normalized = target.trim().trim_start_matches('@').trim();
        if normalized.is_empty() {
            return None;
        }

        let normalized = if normalized.eq_ignore_ascii_case("user") {
            RESERVED_USER_HANDLE
        } else {
            normalized
        };

        if normalized
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            Some(normalized.to_string())
        } else {
            None
        }
    }

    pub(super) fn normalize_protocol_send_intent(intent: &str) -> Option<String> {
        let normalized = intent.trim().to_ascii_lowercase();
        if PROTOCOL_SEND_INTENT_VALUES.contains(&normalized.as_str()) {
            Some(normalized)
        } else {
            None
        }
    }

    pub(super) fn protocol_send_intent_meaning(intent: &str) -> Option<&'static str> {
        match intent {
            "request" => Some("Ask for work or information."),
            "reply" => Some("The receiver should reply."),
            "notify" => Some("Informational only. Do not send a reply."),
            "blocker" => Some("Report a blocking issue."),
            "confirm" => Some("Explicit confirmation is required."),
            _ => None,
        }
    }

    pub(super) fn routed_message_intent_context(
        message: &ChatMessage,
        recipient_agent_name: &str,
    ) -> Option<(String, String)> {
        let protocol = message.meta.0.get("protocol")?.as_object()?;
        if protocol.get("type").and_then(serde_json::Value::as_str) != Some("send") {
            return None;
        }

        let target = Self::normalize_protocol_target(
            protocol.get("to").and_then(serde_json::Value::as_str)?,
        )?;
        let recipient = Self::normalize_protocol_target(recipient_agent_name)?;
        if target != recipient {
            return None;
        }

        let intent = Self::normalize_protocol_send_intent(
            protocol.get("intent").and_then(serde_json::Value::as_str)?,
        )?;
        let meaning = protocol
            .get("intent_meaning")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| Self::protocol_send_intent_meaning(&intent).map(str::to_string))?;

        Some((intent, meaning))
    }

    pub(super) fn build_send_message_content(target: &str, content: &str) -> String {
        let content = content.trim();
        if content.is_empty() {
            format!("@{target}")
        } else {
            format!("@{target} {content}")
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_protocol_send_message_meta(
        app_language: &str,
        run_id: Uuid,
        session_agent_id: Uuid,
        source_message_id: Uuid,
        client_message_id: Option<&str>,
        chain_depth: u32,
        target: &str,
        index: usize,
        intent: Option<&str>,
        intent_meaning: Option<&str>,
        token_usage: Option<&TokenUsageInfo>,
    ) -> serde_json::Value {
        let mut protocol_meta = serde_json::json!({
            "type": "send",
            "to": target,
            "index": index,
        });
        if let Some(intent) = intent {
            protocol_meta["intent"] = serde_json::json!(intent);
        }
        if let Some(intent_meaning) = intent_meaning {
            protocol_meta["intent_meaning"] = serde_json::json!(intent_meaning);
        }

        let mut meta = serde_json::json!({
            "app_language": app_language,
            "run_id": run_id,
            "session_agent_id": session_agent_id,
            "source_message_id": source_message_id,
            "client_message_id": client_message_id,
            "chain_depth": chain_depth + 1,
            "protocol": protocol_meta
        });

        if let Some(token_usage) = token_usage {
            meta["token_usage"] = serde_json::json!({
                "total_tokens": token_usage.total_tokens,
                "model_context_window": token_usage.model_context_window,
                "input_tokens": token_usage.input_tokens,
                "output_tokens": token_usage.output_tokens,
                "reasoning_output_tokens": token_usage.reasoning_output_tokens,
                "cache_read_tokens": token_usage.cache_read_tokens,
                "runtime_agent": token_usage.runtime_agent,
                "runtime_model_id": token_usage.runtime_model_id,
                "provider_id": token_usage.provider_id,
                "runtime_thread_id": token_usage.runtime_thread_id,
                "usage_scope": token_usage.usage_scope,
                "snapshot_total_tokens": token_usage.snapshot_total_tokens,
                "snapshot_input_tokens": token_usage.snapshot_input_tokens,
                "snapshot_output_tokens": token_usage.snapshot_output_tokens,
                "snapshot_reasoning_output_tokens": token_usage.snapshot_reasoning_output_tokens,
                "snapshot_cache_read_tokens": token_usage.snapshot_cache_read_tokens,
                "is_estimated": token_usage.is_estimated,
            });
        }

        meta
    }

    /// Extract JSON from content, handling various formats
    pub(super) fn extract_json_from_content(content: &str) -> Result<String, AgentProtocolError> {
        let content = content.trim();

        // If content is empty, return EmptyMessage for cleaner error handling
        if content.is_empty() {
            return Err(AgentProtocolError {
                code: ChatProtocolNoticeCode::EmptyMessage,
                target: None,
                detail: None,
            });
        }

        match Self::extract_json_candidate(content) {
            Ok(Some(candidate)) => return Ok(candidate),
            Ok(None) => {}
            Err(err) => return Err(Self::invalid_json_error(err)),
        }

        Err(AgentProtocolError {
            code: ChatProtocolNoticeCode::InvalidJson,
            target: None,
            detail: Some("Could not locate a JSON object or array in the response.".to_string()),
        })
    }

    pub(super) fn extract_json_candidate(
        content: &str,
    ) -> Result<Option<String>, serde_json::Error> {
        let trimmed = content.trim();
        if matches!(trimmed.chars().next(), Some('[' | '{'))
            && let Ok(Some(candidate)) = Self::extract_json_prefix(trimmed)
        {
            return Ok(Some(candidate));
        }

        if let Some(start) = trimmed.find("```json") {
            let json_start = start + 7;
            let remaining = &trimmed[json_start..];
            match Self::extract_json_prefix(remaining) {
                Ok(Some(candidate)) => return Ok(Some(candidate)),
                Ok(None) => {}
                Err(err) => return Err(err),
            }
        }

        if let Some(start) = trimmed.find("```") {
            let block_start = start + 3;
            let remaining = &trimmed[block_start..];
            if let Ok(Some(candidate)) = Self::extract_json_prefix(remaining) {
                return Ok(Some(candidate));
            }
        }

        for (index, ch) in trimmed.char_indices() {
            if matches!(ch, '[' | '{')
                && let Ok(Some(candidate)) = Self::extract_json_prefix(&trimmed[index..])
            {
                return Ok(Some(candidate));
            }
        }

        Ok(None)
    }

    pub(super) fn extract_json_prefix(content: &str) -> Result<Option<String>, serde_json::Error> {
        let trimmed = content.trim_start();
        if !matches!(trimmed.chars().next(), Some('[' | '{')) {
            return Ok(None);
        }

        let mut stream =
            serde_json::Deserializer::from_str(trimmed).into_iter::<serde_json::Value>();
        let value = match stream.next() {
            Some(Ok(value)) => value,
            Some(Err(err)) => return Err(err),
            None => return Ok(None),
        };

        if !matches!(
            value,
            serde_json::Value::Array(_) | serde_json::Value::Object(_)
        ) {
            return Ok(None);
        }

        let offset = stream.byte_offset();
        Ok(Some(trimmed[..offset].trim_end().to_string()))
    }

    pub(super) fn invalid_json_error(err: serde_json::Error) -> AgentProtocolError {
        AgentProtocolError {
            code: ChatProtocolNoticeCode::InvalidJson,
            target: None,
            detail: Some(err.to_string()),
        }
    }

    pub(super) fn json_value_kind(value: &serde_json::Value) -> &'static str {
        match value {
            serde_json::Value::Null => "null",
            serde_json::Value::Bool(_) => "a boolean",
            serde_json::Value::Number(_) => "a number",
            serde_json::Value::String(_) => "a string",
            serde_json::Value::Array(_) => "an array",
            serde_json::Value::Object(_) => "an object",
        }
    }

    /// Filter skills based on trigger type and message content.
    /// - 'always' skills are always included
    /// - 'keyword' skills are included if any keyword matches the message
    /// - 'manual' skills are included if the message contains /skill_name
    pub(super) fn filter_active_skills<'a>(
        skills: &'a [ChatSkill],
        user_message: Option<&str>,
    ) -> Vec<&'a ChatSkill> {
        let message_lower = user_message.map(|m| m.to_lowercase()).unwrap_or_default();

        skills
            .iter()
            .filter(|skill| {
                match skill.trigger_type.as_str() {
                    "always" => true,
                    "keyword" => {
                        if message_lower.is_empty() {
                            return false;
                        }
                        skill
                            .trigger_keywords
                            .0
                            .iter()
                            .any(|kw| message_lower.contains(&kw.to_lowercase()))
                    }
                    "manual" => {
                        if message_lower.is_empty() {
                            return false;
                        }
                        // Check for /skill_name pattern
                        let slash_cmd = format!("/{}", skill.name.to_lowercase().replace(' ', "-"));
                        message_lower.contains(&slash_cmd)
                    }
                    _ => false,
                }
            })
            .collect()
    }

    #[cfg(test)]
    pub(super) fn resolve_team_protocol_guidelines(team_protocol: Option<&str>) -> String {
        let normalized_protocol = team_protocol.map(str::trim).unwrap_or_default();
        if normalized_protocol.is_empty() {
            return PresetLoader::load_team_protocol();
        }
        normalized_protocol.to_string()
    }

    pub(super) fn resolve_session_team_protocol(session: Option<&ChatSession>) -> Option<&str> {
        let session = session?;
        if !session.team_protocol_enabled {
            return None;
        }

        session
            .team_protocol
            .as_deref()
            .map(str::trim)
            .filter(|protocol| !protocol.is_empty())
    }

    pub(super) fn strip_embedded_team_protocol_from_system_prompt(system_prompt: &str) -> String {
        let normalized = system_prompt.replace("\r\n", "\n");

        let without_injected_prefix = if normalized.starts_with("(Team Protocol)\n") {
            normalized
                .split_once("\n\n")
                .map(|(_, rest)| rest.to_string())
                .unwrap_or_default()
        } else {
            normalized
        };

        if let Some((before_protocol, after_marker)) =
            without_injected_prefix.split_once("\n(Embedded: Team Collaboration Protocol)\n")
            && let Some((_, after_protocol)) = after_marker.split_once("\n\nInputs:\n")
        {
            return format!(
                "{}\n\nInputs:\n{after_protocol}",
                before_protocol.trim_end()
            )
            .trim()
            .to_string();
        }

        without_injected_prefix.trim().to_string()
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_prompt(
        &self,
        agent: &ChatAgent,
        message: &ChatMessage,
        context_path: &Path,
        workspace_path: &Path,
        session_agents: &[SessionAgentSummary],
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
        skills: &[ChatSkill],
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let context_dir = context_path.parent().unwrap_or(context_path);

        Self::build_exact_markdown_prompt(
            agent,
            message,
            context_dir,
            workspace_path,
            session_agents,
            message_attachments,
            reference,
            skills,
            prompt_language,
            team_protocol,
        )
    }
}
