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

    pub(super) async fn resolve_session_agent_skills(
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

    pub(super) fn parse_executor_profile_id(
        &self,
        agent: &ChatAgent,
    ) -> Result<ExecutorProfileId, ChatRunnerError> {
        let executor = self.parse_runner_type(agent)?;
        let variant = Self::extract_executor_profile_variant(&agent.tools_enabled.0);
        Ok(match variant {
            Some(variant) => ExecutorProfileId::with_variant(executor, variant),
            None => ExecutorProfileId::new(executor),
        })
    }

    pub(super) fn extract_executor_profile_variant(
        tools_enabled: &serde_json::Value,
    ) -> Option<String> {
        let variant = tools_enabled
            .as_object()
            .and_then(|value| value.get(EXECUTOR_PROFILE_VARIANT_KEY))
            .and_then(serde_json::Value::as_str)?
            .trim();
        if variant.is_empty() || variant.eq_ignore_ascii_case("DEFAULT") {
            return None;
        }
        Some(canonical_variant_key(variant))
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

    #[allow(dead_code)]
    pub(super) async fn capture_git_diff(
        workspace_path: &Path,
        run_dir: &Path,
    ) -> Option<DiffInfo> {
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

        let diff_path = run_dir.join("diff.patch");
        if let Err(err) = fs::write(&diff_path, &diff).await {
            tracing::warn!("Failed to write diff patch: {}", err);
            return None;
        }

        // Consider diff truncated if it's over 4KB (for UI display purposes)
        let truncated = diff.len() > 4000;

        Some(DiffInfo {
            _truncated: truncated,
        })
    }

    #[allow(dead_code)]
    pub(super) async fn capture_untracked_files(
        workspace_path: &Path,
        run_dir: &Path,
    ) -> Vec<String> {
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
        let untracked_dir = run_dir.join("untracked");

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
            let first_component =
                rel_path
                    .components()
                    .next()
                    .and_then(|component| match component {
                        Component::Normal(part) => Some(part.to_string_lossy()),
                        _ => None,
                    });
            if let Some(first) = first_component
                && (first == OPENTEAMS_HOME_DIR || first == OPENTEAMS_WORKSPACE_DIR)
            {
                // Skip internal runtime artifacts generated by chat context snapshots.
                continue;
            }

            let src = workspace_path.join(&rel_path);
            let dest = untracked_dir.join(&rel_path);

            if let Some(parent) = dest.parent()
                && let Err(err) = fs::create_dir_all(parent).await
            {
                tracing::warn!("Failed to create untracked dir: {}", err);
                continue;
            }

            match fs::metadata(&src).await {
                Ok(metadata) => {
                    if metadata.len() > UNTRACKED_FILE_LIMIT {
                        let placeholder =
                            format!("File too large to display ({} bytes).", metadata.len());
                        let _ = fs::write(&dest, placeholder).await;
                    } else if let Ok(bytes) = fs::read(&src).await {
                        let content = String::from_utf8_lossy(&bytes).to_string();
                        let _ = fs::write(&dest, content).await;
                    }
                }
                Err(err) => {
                    tracing::warn!("Failed to read untracked file {}: {}", rel, err);
                }
            }

            files.push(rel_path.to_string_lossy().to_string());
        }

        files
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
                name: agent.name.clone(),
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

    /// Escape special characters for TOML string values
    pub(super) fn escape_toml_string(s: &str) -> String {
        s.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t")
    }
    #[cfg_attr(not(test), allow(dead_code))]
    /// Build the system prompt using Markdown sections while preserving all protocol fields.
    pub(super) fn build_system_prompt_markdown(
        agent: &ChatAgent,
        session_agents: &[SessionAgentSummary],
        context_dir: &Path,
        skills: &[ChatSkill],
        user_message_content: Option<&str>,
        prompt_language: ResolvedPromptLanguage,
        team_protocol: Option<&str>,
    ) -> String {
        let mut markdown = String::new();
        let messages_path = context_dir.join("messages.jsonl");
        let shared_blackboard_path = context_dir.join(SHARED_BLACKBOARD_FILE_NAME);
        let work_records_path = context_dir.join(WORK_RECORDS_FILE_NAME);
        let visible_members = session_agents
            .iter()
            .filter(|member| member.agent_id != agent.id)
            .collect::<Vec<_>>();

        Self::push_markdown_section(&mut markdown, 1, "ChatGroup Protocol");
        Self::push_markdown_field(&mut markdown, "PROTOCOL_VERSION", "chatgroup_markdown_v1");

        Self::push_markdown_section(&mut markdown, 2, "agent.role");
        Self::push_markdown_field(&mut markdown, "name", &agent.name);
        let normalized_system_prompt =
            Self::strip_embedded_team_protocol_from_system_prompt(&agent.system_prompt);
        if !normalized_system_prompt.is_empty() {
            Self::push_markdown_block_field(
                &mut markdown,
                "role",
                &normalized_system_prompt,
                "text",
            );
        }

        let active_skills = Self::filter_active_skills(skills, user_message_content);
        Self::push_markdown_section(&mut markdown, 2, "agent.skills");
        if active_skills.is_empty() {
            Self::push_markdown_field(
                &mut markdown,
                "restriction",
                "You have no skills enabled. Do not attempt to use any skill.",
            );
        } else {
            Self::push_markdown_block_field(
                &mut markdown,
                "restriction",
                concat!(
                    "Skills are available as local files in ~/.agents/skills and companion directories.\n",
                    "You can ONLY use the skills listed below. Do not invent or use unlisted skills.\n",
                ),
                "text",
            );
            for (index, skill) in active_skills.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("agent.skills.allowed item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &skill.name);
                Self::push_markdown_field(&mut markdown, "description", &skill.description);
            }
        }

        Self::push_markdown_section(&mut markdown, 2, "group");
        Self::push_markdown_field(
            &mut markdown,
            "members_description",
            "Other AI members currently in this group",
        );
        if visible_members.is_empty() {
            markdown.push_str("_No other AI members._\n\n");
        } else {
            for (index, member) in visible_members.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("group.members item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &member.name);
                let responsibility = member.description.as_deref().unwrap_or("AI assistant");
                Self::push_markdown_field(&mut markdown, "responsibility", responsibility);
                Self::push_markdown_field(&mut markdown, "state", &format!("{:?}", member.state));
                Self::push_markdown_json_field(&mut markdown, "skills_used", &member.skills_used);
            }
        }

        Self::push_markdown_section(&mut markdown, 2, "history.group_messages");
        Self::push_markdown_field(&mut markdown, "path", &messages_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Group chat history. Each line is a JSON message record containing sender and content, consistent with messages.jsonl history.",
        );
        Self::push_markdown_bool_field(&mut markdown, "optional", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            HISTORY_GROUP_MESSAGES_INSTRUCTION,
            "text",
        );

        Self::push_markdown_section(&mut markdown, 2, "history.shared_blackboard");
        Self::push_markdown_field(
            &mut markdown,
            "path",
            &shared_blackboard_path.to_string_lossy(),
        );
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted shared messages generated from record items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_SHARED_BLACKBOARD_INSTRUCTION,
        );

        Self::push_markdown_section(&mut markdown, 2, "history.work_records");
        Self::push_markdown_field(&mut markdown, "path", &work_records_path.to_string_lossy());
        Self::push_markdown_field(&mut markdown, "format", "jsonl");
        Self::push_markdown_field(
            &mut markdown,
            "description",
            "Persisted work outputs and summaries generated from artifact/conclusion items.",
        );
        Self::push_markdown_field(
            &mut markdown,
            "instruction",
            HISTORY_WORK_RECORDS_INSTRUCTION,
        );

        Self::push_markdown_section(&mut markdown, 2, "output");
        Self::push_markdown_bool_field(&mut markdown, "required", true);
        Self::push_markdown_field(&mut markdown, "format", "json");
        Self::push_markdown_field(&mut markdown, "container", "list");
        Self::push_markdown_bool_field(&mut markdown, "only_send_items_enter_group_history", true);
        Self::push_markdown_block_field(
            &mut markdown,
            "instruction",
            concat!(
                "Return ONLY a valid JSON array.\n",
                "Do not wrap the JSON array in prose or markdown unless your runner forces code fences.\n",
                "Your final reply MUST be parseable by a standard JSON parser.\n",
                "Escape all double quotes, backslashes, and newlines inside JSON string values.\n",
                "Before sending, verify that every `content` value is still a valid JSON string after escaping.\n",
                "Only send items will be turned into visible group chat messages and written into group history.\n",
                "The current agent is always recorded as the sender automatically. Do not impersonate other senders.\n",
                "Do not discuss anything unrelated to the assigned work. Keep every reply concise, precise, and free of filler.\n",
                "Use `to = \\\"you\\\"` when sending a message to the user. Here `you` refers to the human user.\n",
                "For send items, `intent` is optional but recommended when the routing semantics matter.\n",
            ),
            "text",
        );
        let mut allowed_targets: Vec<&str> = visible_members
            .iter()
            .map(|member| member.name.as_str())
            .collect();
        allowed_targets.push(RESERVED_USER_HANDLE);
        Self::push_markdown_json_field(&mut markdown, "allowed_targets", &allowed_targets);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 1");
        Self::push_markdown_field(&mut markdown, "type", "send");
        Self::push_markdown_json_field(
            &mut markdown,
            "required_fields",
            &["type", "to", "content"],
        );
        Self::push_markdown_json_field(&mut markdown, "optional_fields", &["intent"]);
        Self::push_markdown_block_field(
            &mut markdown,
            "rules",
            concat!(
                "- A send item targets exactly one receiver.\n",
                "- Use concise language with a clear goal.\n",
                "- Content may be empty.\n",
                "- Prefer setting `intent` for machine-readable routing semantics.\n",
                "- Optional `intent` values for send items: `request` = ask for work or information; `reply` = the receiver should reply; `notify` = informational only, no reply required; `blocker` = report a blocking issue; `confirm` = explicit confirmation is required.\n",
                "- The system will render the final group message as `@receiver content` and route it to that receiver.\n",
            ),
            "text",
        );

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 2");
        Self::push_markdown_field(&mut markdown, "type", "record");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_RECORD_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 3");
        Self::push_markdown_field(&mut markdown, "type", "artifact");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_ARTIFACT_RULE);

        Self::push_markdown_section(&mut markdown, 3, "output.message_types item 4");
        Self::push_markdown_field(&mut markdown, "type", "conclusion");
        Self::push_markdown_bool_field(&mut markdown, "required", false);
        Self::push_markdown_json_field(&mut markdown, "required_fields", &["type", "content"]);
        Self::push_markdown_field(&mut markdown, "rules", MARKDOWN_PROTOCOL_CONCLUSION_RULE);

        Self::push_markdown_section(&mut markdown, 2, "output.example");
        Self::push_markdown_block_field(
            &mut markdown,
            "json",
            MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON,
            "json",
        );

        Self::push_markdown_section(&mut markdown, 2, "language");
        Self::push_markdown_field(&mut markdown, "setting", prompt_language.setting);
        Self::push_markdown_field(&mut markdown, "instruction", prompt_language.instruction);

        Self::set_trailing_newlines(&mut markdown, 3);
        Self::push_markdown_section(&mut markdown, 2, "team.protocol");
        Self::push_markdown_bool_field(
            &mut markdown,
            "configured",
            team_protocol.is_some_and(|content| !content.trim().is_empty()),
        );
        Self::push_markdown_block_field(
            &mut markdown,
            "guidelines",
            &Self::resolve_team_protocol_guidelines(team_protocol),
            "text",
        );

        markdown
    }

    /// Build the user message prompt using Markdown sections while preserving all protocol fields.
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_user_prompt_markdown(
        agent: &ChatAgent,
        message: &ChatMessage,
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
    ) -> String {
        let mut markdown = String::new();
        let sender = Self::resolve_message_sender_identity(message);

        Self::push_markdown_section(&mut markdown, 2, "envelope");
        Self::push_markdown_field(&mut markdown, "session_id", &message.session_id.to_string());
        Self::push_markdown_field(&mut markdown, "from", &sender.address);
        Self::push_markdown_field(&mut markdown, "to", &format!("agent:{}", agent.name));
        Self::push_markdown_field(&mut markdown, "message_id", &message.id.to_string());
        Self::push_markdown_field(&mut markdown, "timestamp", &message.created_at.to_string());

        Self::push_markdown_section(&mut markdown, 2, "message");
        Self::push_markdown_field(&mut markdown, "sender", &sender.label);
        Self::push_markdown_block_field(&mut markdown, "content", message.content.trim(), "text");

        if let Some(reference) = reference {
            Self::push_markdown_section(&mut markdown, 3, "message.reference");
            Self::push_markdown_field(
                &mut markdown,
                "note",
                "User referenced the following historical message. Prioritize it.",
            );
            Self::push_markdown_field(
                &mut markdown,
                "message_id",
                &reference.message_id.to_string(),
            );
            Self::push_markdown_field(&mut markdown, "sender", &reference.sender_label);
            Self::push_markdown_field(
                &mut markdown,
                "sender_type",
                &format!("{:?}", reference.sender_type),
            );
            Self::push_markdown_field(&mut markdown, "created_at", &reference.created_at);
            Self::push_markdown_block_field(
                &mut markdown,
                "content",
                reference.content.trim(),
                "text",
            );

            for (index, attachment) in reference.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    4,
                    &format!("message.reference.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        if let Some(attachments_ctx) = message_attachments {
            for (index, attachment) in attachments_ctx.attachments.iter().enumerate() {
                Self::push_markdown_section(
                    &mut markdown,
                    3,
                    &format!("message.attachments item {}", index + 1),
                );
                Self::push_markdown_field(&mut markdown, "name", &attachment.name);
                Self::push_markdown_field(&mut markdown, "kind", &attachment.kind);
                Self::push_markdown_number_field(
                    &mut markdown,
                    "size_bytes",
                    attachment.size_bytes,
                );
                Self::push_markdown_field(
                    &mut markdown,
                    "mime_type",
                    attachment.mime_type.as_deref().unwrap_or("unknown"),
                );
                Self::push_markdown_field(&mut markdown, "local_path", &attachment.local_path);
            }
        }

        markdown
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

        // Compute relative paths for context files
        let messages_rel = pathdiff::diff_paths(&messages_path, workspace_path)
            .unwrap_or_else(|| messages_path.clone());
        let shared_blackboard_rel = pathdiff::diff_paths(&shared_blackboard_path, workspace_path)
            .unwrap_or_else(|| shared_blackboard_path.clone());
        let work_records_rel = pathdiff::diff_paths(&work_records_path, workspace_path)
            .unwrap_or_else(|| work_records_path.clone());

        markdown.push_str("# ChatGroup Message\n\n");

        markdown.push_str("## Input Message\n");
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
                markdown.push_str(&format!("\n#### Attachment {}\n", index + 1));
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

        markdown.push_str("\n## Output Requirements\n");
        markdown.push_str(
            "Return **only a JSON array** that must be parseable by a standard JSON parser.  \n",
        );
        markdown.push_str("Array items may only use these four message types: `send`, `record`, `artifact`, `conclusion`.\n\n");

        markdown.push_str("### General Rules\n");
        markdown.push_str("1. Output only content directly related to the current task.\n");
        markdown.push_str("2. Keep messages concise. Put complex content into files in the current workspace instead of sending long text directly.\n");
        markdown.push_str("3. Every `content` value must remain a valid JSON string, with quotes, backslashes, and newlines escaped properly.\n");
        markdown.push_str("4. Send a `send` message only when necessary.\n");
        markdown.push_str("5. When sending to the user, `to` must be `\"you\"`.\n\n");

        markdown.push_str("### Message Types\n\n");

        markdown.push_str("#### 1) send\n");
        markdown.push_str("Fields:\n");
        markdown.push_str("- Required: `type`, `to`, `content`\n");
        markdown.push_str("- Optional: `intent`\n\n");
        markdown.push_str("Rules:\n");
        markdown.push_str("- One message targets exactly one receiver.\n");
        markdown.push_str("- `to` must match a member name in `group members`.\n");
        markdown.push_str("- `content` cannot be empty and should stay within 1 to 5 sentences.\n");
        markdown.push_str(
            "- Recommended `intent` values: `request`, `reply`, `notify`, `blocker`, `confirm`\n\n",
        );

        markdown.push_str("#### 2) record\n");
        markdown.push_str("Fields:\n");
        markdown.push_str("- Required: `type`, `content`\n\n");
        markdown.push_str("Rules:\n");
        markdown.push_str("- Record only long-lived shared facts.\n");
        markdown.push_str("- Do not write process notes, temporary status, or blockers.\n");
        markdown.push_str("- Written to `");
        markdown.push_str(&shared_blackboard_rel.to_string_lossy());
        markdown.push_str("`.\n\n");

        markdown.push_str("#### 3) artifact\n");
        markdown.push_str("Fields:\n");
        markdown.push_str("- Required: `type`, `content`\n\n");
        markdown.push_str("Rules:\n");
        markdown.push_str("- Record only deliverables or concrete file paths.\n");
        markdown.push_str("- Written to `");
        markdown.push_str(&work_records_rel.to_string_lossy());
        markdown.push_str("`.\n\n");

        markdown.push_str("#### 4) conclusion\n");
        markdown.push_str("Fields:\n");
        markdown.push_str("- Required: `type`, `content`\n\n");
        markdown.push_str("Rules:\n");
        markdown.push_str("- Write only the current turn's summary, such as completed work, blockers, or next step.\n");
        markdown.push_str("- Keep it within 3 sentences.\n");
        markdown.push_str("- Do not write long-lived facts.\n");
        markdown.push_str("- Written to `");
        markdown.push_str(&work_records_rel.to_string_lossy());
        markdown.push_str("`.\n\n");

        markdown.push_str("### Message Format Example\n");
        markdown.push_str("```json\n");
        markdown.push_str(MARKDOWN_PROTOCOL_OUTPUT_EXAMPLE_JSON);
        markdown.push_str("\n```\n\n");

        markdown.push_str("## Agent\n");
        markdown.push_str("- name: ");
        markdown.push_str(&agent.name);
        markdown.push('\n');
        let normalized_system_prompt =
            Self::strip_embedded_team_protocol_from_system_prompt(&agent.system_prompt);
        markdown.push_str("- role: ");
        markdown.push_str(&normalized_system_prompt);
        markdown.push('\n');

        if active_skills.is_empty() {
            markdown.push_str("- skills: No skills enabled. Do not use any skills.\n");
        } else {
            markdown.push_str("- skills: ");
            let skill_names: Vec<&str> = active_skills.iter().map(|s| s.name.as_str()).collect();
            markdown.push_str(&skill_names.join(", "));
            markdown.push('\n');
        }

        markdown.push_str("- language: ");
        markdown.push_str(prompt_language.setting);
        markdown.push_str("\n\n");

        markdown.push_str("## Team Protocol\n");
        if let Some(protocol) = team_protocol {
            if !protocol.trim().is_empty() {
                markdown.push_str(protocol.trim());
                if !protocol.trim().ends_with('\n') {
                    markdown.push('\n');
                }
            } else {
                markdown.push_str("No team protocol configured.\n");
            }
        } else {
            markdown.push_str("No team protocol configured.\n");
        }
        markdown.push('\n');

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

    pub(super) fn push_markdown_section(markdown: &mut String, level: usize, title: &str) {
        let heading_level = level.clamp(1, 6);
        markdown.push_str(&"#".repeat(heading_level));
        markdown.push(' ');
        markdown.push_str(title);
        markdown.push_str("\n\n");
    }

    pub(super) fn push_markdown_field(markdown: &mut String, label: &str, value: &str) {
        if value.contains('\n') {
            Self::push_markdown_block_field(markdown, label, value, "text");
            return;
        }
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(value);
        markdown.push('\n');
    }

    pub(super) fn push_markdown_bool_field(markdown: &mut String, label: &str, value: bool) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(if value { "true" } else { "false" });
        markdown.push('\n');
    }

    pub(super) fn push_markdown_number_field(markdown: &mut String, label: &str, value: i64) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(&value.to_string());
        markdown.push('\n');
    }

    pub(super) fn push_markdown_json_field<T>(markdown: &mut String, label: &str, value: &T)
    where
        T: Serialize + ?Sized,
    {
        let json = serde_json::to_string(value).expect("markdown JSON field should serialize");
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**: ");
        markdown.push_str(&json);
        markdown.push('\n');
    }

    pub(super) fn push_markdown_block_field(
        markdown: &mut String,
        label: &str,
        value: &str,
        language: &str,
    ) {
        markdown.push_str("- **");
        markdown.push_str(label);
        markdown.push_str("**:\n\n");

        let fence = Self::markdown_fence_for_content(value);
        markdown.push_str(&fence);
        if !language.is_empty() {
            markdown.push_str(language);
        }
        markdown.push('\n');
        markdown.push_str(value);
        if !value.ends_with('\n') {
            markdown.push('\n');
        }
        markdown.push_str(&fence);
        markdown.push_str("\n\n");
    }

    pub(super) fn set_trailing_newlines(markdown: &mut String, newline_count: usize) {
        while markdown.ends_with('\n') {
            markdown.pop();
        }
        markdown.push_str(&"\n".repeat(newline_count));
    }

    pub(super) fn markdown_fence_for_content(content: &str) -> String {
        let mut longest_run = 0usize;
        let mut current_run = 0usize;
        for ch in content.chars() {
            if ch == '`' {
                current_run += 1;
                longest_run = longest_run.max(current_run);
            } else {
                current_run = 0;
            }
        }
        "`".repeat(longest_run.max(2) + 1)
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

    #[allow(dead_code)]
    /// Get language code and instruction based on UiLanguage setting
    pub(super) fn get_language_instruction(language: &UiLanguage) -> (&'static str, &'static str) {
        match language {
            UiLanguage::Browser => ("en", "You MUST respond in English."),
            UiLanguage::En => ("en", "You MUST respond in English."),
            UiLanguage::ZhHans => ("zh-Hans", "You MUST respond in Simplified Chinese."),
            UiLanguage::ZhHant => ("zh-Hant", "You MUST respond in Traditional Chinese."),
            UiLanguage::Ja => ("ja", "You MUST respond in Japanese."),
            UiLanguage::Ko => ("ko", "You MUST respond in Korean."),
            UiLanguage::Fr => ("fr", "You MUST respond in French."),
            UiLanguage::Es => ("es", "You MUST respond in Spanish."),
        }
    }

    pub(super) fn parse_agent_protocol_messages(
        content: &str,
    ) -> Result<Vec<AgentProtocolMessage>, AgentProtocolError> {
        let json_str = Self::extract_json_from_content(content)?;
        let raw: serde_json::Value =
            serde_json::from_str(&json_str).map_err(Self::invalid_json_error)?;

        let messages = match &raw {
            serde_json::Value::Array(_) => {
                serde_json::from_str::<Vec<AgentProtocolMessage>>(&json_str)
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
                        content: message.content.trim().to_string(),
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
                        content,
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
            "notify" => Some("Informational only. No reply is required."),
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
            "chain_depth": chain_depth + 1,
            "protocol": protocol_meta
        });

        if let Some(token_usage) = token_usage {
            meta["token_usage"] = serde_json::json!({
                "total_tokens": token_usage.total_tokens,
                "model_context_window": token_usage.model_context_window,
                "input_tokens": token_usage.input_tokens,
                "output_tokens": token_usage.output_tokens,
                "cache_read_tokens": token_usage.cache_read_tokens,
                "cache_write_tokens": token_usage.cache_write_tokens,
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

    /// Legacy TOML-based user prompt builder kept for transition safety.
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn build_user_prompt(
        &self,
        agent: &ChatAgent,
        message: &ChatMessage,
        message_attachments: Option<&MessageAttachmentContext>,
        reference: Option<&ReferenceContext>,
    ) -> String {
        let mut toml = String::new();

        // 1. Envelope section
        toml.push_str("[envelope]\n");
        toml.push_str(&format!("session_id = \"{}\"\n", message.session_id));
        let sender = Self::resolve_message_sender_identity(message);
        toml.push_str(&format!(
            "from = \"{}\"\n",
            Self::escape_toml_string(&sender.address)
        ));
        toml.push_str(&format!(
            "to = \"agent:{}\"\n",
            Self::escape_toml_string(&agent.name)
        ));
        toml.push_str(&format!("message_id = \"{}\"\n", message.id));
        toml.push_str(&format!("timestamp = \"{}\"\n\n", message.created_at));

        // 2. Message section
        toml.push_str("[message]\n");
        toml.push_str(&format!(
            "sender = \"{}\"\n",
            Self::escape_toml_string(&sender.label)
        ));
        toml.push_str(&format!(
            "content = \"\"\"\n{}\n\"\"\"\n",
            message.content.trim()
        ));

        if let Some(reference) = reference {
            toml.push_str("\n[message.reference]\n");
            toml.push_str(
                "note = \"User referenced the following historical message. Prioritize it.\"\n",
            );
            toml.push_str(&format!("message_id = \"{}\"\n", reference.message_id));
            toml.push_str(&format!(
                "sender = \"{}\"\n",
                Self::escape_toml_string(&reference.sender_label)
            ));
            toml.push_str(&format!("sender_type = \"{:?}\"\n", reference.sender_type));
            toml.push_str(&format!(
                "created_at = \"{}\"\n",
                Self::escape_toml_string(&reference.created_at)
            ));
            toml.push_str(&format!(
                "content = \"\"\"\n{}\n\"\"\"\n",
                reference.content.trim()
            ));

            if !reference.attachments.is_empty() {
                for attachment in &reference.attachments {
                    toml.push_str("\n[[message.reference.attachments]]\n");
                    toml.push_str(&format!(
                        "name = \"{}\"\n",
                        Self::escape_toml_string(&attachment.name)
                    ));
                    toml.push_str(&format!(
                        "kind = \"{}\"\n",
                        Self::escape_toml_string(&attachment.kind)
                    ));
                    toml.push_str(&format!("size_bytes = {}\n", attachment.size_bytes));
                    toml.push_str(&format!(
                        "mime_type = \"{}\"\n",
                        attachment.mime_type.as_deref().unwrap_or("unknown")
                    ));
                    toml.push_str(&format!(
                        "local_path = \"{}\"\n",
                        Self::escape_toml_string(&attachment.local_path)
                    ));
                }
            }
        }

        // 3. Message attachments (optional)
        if let Some(attachments_ctx) = message_attachments
            && !attachments_ctx.attachments.is_empty()
        {
            for attachment in &attachments_ctx.attachments {
                toml.push_str("\n[[message.attachments]]\n");
                toml.push_str(&format!(
                    "name = \"{}\"\n",
                    Self::escape_toml_string(&attachment.name)
                ));
                toml.push_str(&format!(
                    "kind = \"{}\"\n",
                    Self::escape_toml_string(&attachment.kind)
                ));
                toml.push_str(&format!("size_bytes = {}\n", attachment.size_bytes));
                toml.push_str(&format!(
                    "mime_type = \"{}\"\n",
                    attachment.mime_type.as_deref().unwrap_or("unknown")
                ));
                toml.push_str(&format!(
                    "local_path = \"{}\"\n",
                    Self::escape_toml_string(&attachment.local_path)
                ));
            }
        }

        toml
    }

    pub(super) fn resolve_team_protocol_guidelines(team_protocol: Option<&str>) -> String {
        let normalized_protocol = team_protocol.map(str::trim).unwrap_or_default();
        if normalized_protocol.is_empty() {
            return PresetLoader::load_team_protocol();
        }
        normalized_protocol.to_string()
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
