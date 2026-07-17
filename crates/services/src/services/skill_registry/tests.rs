#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use chrono::Utc;
    use db::models::{
        chat_session_agent::{ChatSessionAgent, CreateChatSessionAgent},
        chat_skill::{ChatSkill, CreateChatSkill},
    };
    use sqlx::types::Json;
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::{
        check_link_conflict, create_skill_link, discover_global_skills, global_skill_roots,
        install_skill_files_from_embedded_at_paths, is_openteams_managed_link, LinkConflict,
        RemoteSkillPackage, uninstall_skill_files_from_global_directory_at_paths,
        openteams_skill_data_dir, parse_discovered_skill_markdown,
        sync_discovered_global_skills_at_home_dir,
    };

    #[test]
    fn global_skill_roots_use_slugified_skill_name() {
        let home_dir = Path::new("/tmp/test-home");
        let roots = global_skill_roots(home_dir, "Apify Automation");

        assert!(roots.iter().all(|root| root.ends_with("apify-automation")));
    }

    #[test]
    fn parse_discovered_skill_markdown_extracts_frontmatter_and_body() {
        let markdown = r#"---
name: Apify Automation
description: "Automate Apify tasks."
author: Acme
version: 2.1.0
tags:
  - integration
  - automation
compatible_agents:
  - claude
  - cursor
---
# Apify Automation

> Automate Apify tasks.

Use this skill to automate Apify workflows.
"#;

        let parsed = parse_discovered_skill_markdown("apify-automation", markdown);

        assert_eq!(parsed.name, "Apify Automation");
        assert_eq!(parsed.description, "Automate Apify tasks.");
        assert_eq!(parsed.author.as_deref(), Some("Acme"));
        assert_eq!(parsed.version.as_deref(), Some("2.1.0"));
        assert_eq!(parsed.tags, vec!["integration", "automation"]);
        assert_eq!(parsed.compatible_agents, vec!["claude", "cursor"]);
        assert_eq!(
            parsed.content,
            "Use this skill to automate Apify workflows."
        );
    }

    #[test]
    fn parse_discovered_skill_markdown_falls_back_to_heading_and_quote() {
        let markdown = r#"# Browser Automation

> Drive browser tasks safely.

Open the page and inspect it carefully.
"#;

        let parsed = parse_discovered_skill_markdown("browser-automation", markdown);

        assert_eq!(parsed.name, "Browser Automation");
        assert_eq!(parsed.description, "Drive browser tasks safely.");
        assert_eq!(parsed.content, "Open the page and inspect it carefully.");
    }

    #[tokio::test]
    async fn discover_global_skills_reads_agent_skill_directories() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let skill_dir = temp_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("browser-automation");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "# Browser Automation\n\n> Drive browser tasks safely.\n\nOpen the page.\n",
        )
        .expect("write skill file");

        let discovered = discover_global_skills(temp_dir.path()).await;
        let skill = discovered
            .get("browser-automation")
            .expect("discovered skill");

        assert_eq!(skill.name, "Browser Automation");
        assert!(skill.compatible_agents.contains("claude"));
    }

    #[tokio::test]
    async fn sync_discovered_global_skills_prunes_removed_installed_skill_rows() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let skill_dir = temp_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("browser-automation");
        std::fs::create_dir_all(&skill_dir).expect("create skill dir");
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "# Browser Automation\n\n> Drive browser tasks safely.\n\nOpen the page.\n",
        )
        .expect("write skill file");

        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        sqlx::query(
            r#"CREATE TABLE chat_skills (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                content TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                trigger_keywords TEXT NOT NULL DEFAULT '[]',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                source TEXT NOT NULL DEFAULT 'local',
                source_url TEXT,
                version TEXT NOT NULL DEFAULT '1.0.0',
                author TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                category TEXT,
                compatible_agents TEXT NOT NULL DEFAULT '[]',
                download_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_skills table");
        sqlx::query(
            r#"CREATE TABLE chat_session_agents (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'idle',
                workspace_path TEXT,
                pty_session_key TEXT,
                agent_session_id TEXT,
                agent_message_id TEXT,
                project_member_id TEXT,
                member_name TEXT NOT NULL DEFAULT '',
                execution_config TEXT NOT NULL DEFAULT '{}',
                allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_session_agents table");
        for statement in [
            "CREATE TABLE project_members (id TEXT PRIMARY KEY, member_name TEXT)",
            "CREATE TABLE chat_agents (id TEXT PRIMARY KEY, name TEXT)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create session agent lookup table");
        }

        let installed_skill = ChatSkill::create(
            &pool,
            &CreateChatSkill {
                name: "Browser Automation".to_string(),
                description: Some("Drive browser tasks safely.".to_string()),
                content: "Open the page.".to_string(),
                trigger_type: Some("always".to_string()),
                trigger_keywords: None,
                enabled: Some(true),
                source: Some("registry".to_string()),
                source_url: Some("https://skills.example/browser-automation".to_string()),
                version: Some("1.0.0".to_string()),
                author: None,
                tags: Some(vec!["automation".to_string()]),
                category: None,
                compatible_agents: Some(vec!["claude".to_string()]),
                download_count: Some(0),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create installed skill row");

        let custom_skill = ChatSkill::create(
            &pool,
            &CreateChatSkill {
                name: "Imported Local Path".to_string(),
                description: Some("Imported from a custom path".to_string()),
                content: "Use skill files from path".to_string(),
                trigger_type: Some("manual".to_string()),
                trigger_keywords: None,
                enabled: Some(true),
                source: Some("local_path".to_string()),
                source_url: Some("C:/tmp/custom-skill".to_string()),
                version: Some("1.0.0".to_string()),
                author: None,
                tags: Some(vec!["local".to_string()]),
                category: None,
                compatible_agents: Some(vec![]),
                download_count: Some(0),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create local path skill row");
        let session_agent = ChatSessionAgent::create(
            &pool,
            &CreateChatSessionAgent {
                session_id: Uuid::new_v4(),
                agent_id: Uuid::new_v4(),
                member_name: None,
                workspace_path: None,
                allowed_skill_ids: vec![
                    installed_skill.id.to_string(),
                    custom_skill.id.to_string(),
                ],
                project_member_id: None,
                execution_config: db::models::member_execution_config::MemberExecutionConfig::default(),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create session agent");

        let initial_sync = sync_discovered_global_skills_at_home_dir(&pool, temp_dir.path())
            .await
            .expect("initial sync succeeds");
        assert_eq!(initial_sync, 0);

        std::fs::remove_dir_all(&skill_dir).expect("remove skill dir");

        let pruned = sync_discovered_global_skills_at_home_dir(&pool, temp_dir.path())
            .await
            .expect("prune sync succeeds");
        assert_eq!(pruned, 1);

        let remaining_skills = ChatSkill::find_all(&pool)
            .await
            .expect("load remaining skills");
        let remaining_ids = remaining_skills
            .into_iter()
            .map(|skill| skill.id)
            .collect::<Vec<_>>();
        let refreshed_session_agent = ChatSessionAgent::find_by_id(&pool, session_agent.id)
            .await
            .expect("load session agent")
            .expect("session agent exists");

        assert!(!remaining_ids.contains(&installed_skill.id));
        assert!(remaining_ids.contains(&custom_skill.id));
        assert_eq!(
            refreshed_session_agent.allowed_skill_ids.0,
            vec![custom_skill.id.to_string()]
        );
    }

    #[tokio::test]
    async fn sync_discovered_global_skills_refreshes_compatible_agents_after_root_removal() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let universal_skill_dir = temp_dir
            .path()
            .join(".agents")
            .join("skills")
            .join("browser-automation");
        let claude_skill_dir = temp_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("browser-automation");

        for skill_dir in [&universal_skill_dir, &claude_skill_dir] {
            std::fs::create_dir_all(skill_dir).expect("create skill dir");
            std::fs::write(
                skill_dir.join("SKILL.md"),
                "# Browser Automation\n\n> Drive browser tasks safely.\n\nOpen the page.\n",
            )
            .expect("write skill file");
        }

        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        sqlx::query(
            r#"CREATE TABLE chat_skills (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                content TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                trigger_keywords TEXT NOT NULL DEFAULT '[]',
                enabled BOOLEAN NOT NULL DEFAULT 1,
                source TEXT NOT NULL DEFAULT 'local',
                source_url TEXT,
                version TEXT NOT NULL DEFAULT '1.0.0',
                author TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                category TEXT,
                compatible_agents TEXT NOT NULL DEFAULT '[]',
                download_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .expect("create chat_skills table");

        let installed_skill = ChatSkill::create(
            &pool,
            &CreateChatSkill {
                name: "Browser Automation".to_string(),
                description: Some("Drive browser tasks safely.".to_string()),
                content: "Open the page.".to_string(),
                trigger_type: Some("always".to_string()),
                trigger_keywords: None,
                enabled: Some(true),
                source: Some("registry".to_string()),
                source_url: Some("https://skills.example/browser-automation".to_string()),
                version: Some("1.0.0".to_string()),
                author: None,
                tags: Some(vec!["automation".to_string()]),
                category: None,
                compatible_agents: Some(vec![]),
                download_count: Some(0),
            },
            Uuid::new_v4(),
        )
        .await
        .expect("create installed skill row");

        let initial_sync = sync_discovered_global_skills_at_home_dir(&pool, temp_dir.path())
            .await
            .expect("initial sync succeeds");
        assert_eq!(initial_sync, 1);

        let refreshed = ChatSkill::find_by_id(&pool, installed_skill.id)
            .await
            .expect("load refreshed skill")
            .expect("skill exists");
        assert_eq!(refreshed.compatible_agents.0, vec!["claude".to_string()]);

        std::fs::remove_dir_all(&claude_skill_dir).expect("remove claude skill dir");

        let resynced = sync_discovered_global_skills_at_home_dir(&pool, temp_dir.path())
            .await
            .expect("refresh sync succeeds");
        assert_eq!(resynced, 1);

        let universal_only = ChatSkill::find_by_id(&pool, installed_skill.id)
            .await
            .expect("load universal-only skill")
            .expect("skill still exists");
        assert!(universal_only.compatible_agents.0.is_empty());
    }

    #[test]
    fn embedded_skill_files_are_available() {
        use super::{get_embedded_skill_files, has_embedded_skill_files};

        // Check that artifacts-builder has embedded files
        assert!(has_embedded_skill_files("artifacts-builder"));

        let files = get_embedded_skill_files("artifacts-builder");
        assert!(!files.is_empty());

        // Should have SKILL.md
        let skill_md = files.iter().find(|(path, _)| path.contains("SKILL.md"));
        assert!(skill_md.is_some(), "Should have SKILL.md file");

        // Content should not be empty
        if let Some((_, content)) = skill_md {
            assert!(!content.is_empty(), "SKILL.md content should not be empty");
        }
    }

    #[test]
    fn embedded_files_count_is_reasonable() {
        use super::EmbeddedSkillFiles;

        let count = EmbeddedSkillFiles::iter().count();
        // Should have at least some files embedded
        assert!(
            count > 100,
            "Expected at least 100 embedded files, got {}",
            count
        );
    }

    fn test_remote_skill(name: &str) -> RemoteSkillPackage {
        RemoteSkillPackage {
            id: name.to_string(),
            name: name.to_string(),
            description: "Test skill".to_string(),
            category: None,
            version: "1.0.0".to_string(),
            author: None,
            tags: Vec::new(),
            compatible_agents: vec!["claude".to_string()],
            source_url: Some(format!("https://skills.example/{name}")),
            content: "Test skill content".to_string(),
            download_count: Some(0),
        }
    }

    fn test_chat_skill(name: &str) -> ChatSkill {
        ChatSkill {
            id: Uuid::new_v4(),
            name: name.to_string(),
            description: "Test skill".to_string(),
            content: "Test skill content".to_string(),
            trigger_type: "always".to_string(),
            trigger_keywords: Json(Vec::new()),
            enabled: true,
            source: "registry".to_string(),
            source_url: Some(format!("https://skills.example/{}", name.replace(' ', "-"))),
            version: "1.0.0".to_string(),
            author: None,
            tags: Json(Vec::new()),
            category: None,
            compatible_agents: Json(Vec::new()),
            download_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn embedded_install_writes_central_data_and_agent_link() {
        let home_dir = tempfile::tempdir().expect("home dir");
        let app_data = tempfile::tempdir().expect("app data");
        let skill = test_remote_skill("artifacts-builder");
        let target_agents = vec!["claude".to_string()];

        let count = install_skill_files_from_embedded_at_paths(
            &skill,
            Some(&target_agents),
            home_dir.path(),
            app_data.path(),
        )
        .await
        .expect("install embedded skill");

        assert!(count > 0);
        let central_dir = openteams_skill_data_dir("artifacts-builder", app_data.path());
        let agent_dir = home_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("artifacts-builder");

        assert!(central_dir.join("SKILL.md").exists());
        assert!(agent_dir.join("SKILL.md").exists());
        assert!(is_openteams_managed_link(&agent_dir, app_data.path()).await);
    }

    #[tokio::test]
    async fn embedded_install_skips_user_owned_real_directory() {
        let home_dir = tempfile::tempdir().expect("home dir");
        let app_data = tempfile::tempdir().expect("app data");
        let skill = test_remote_skill("artifacts-builder");
        let target_agents = vec!["claude".to_string()];
        let user_dir = home_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("artifacts-builder");
        fs::create_dir_all(&user_dir).expect("create user dir");
        fs::write(user_dir.join("SKILL.md"), "user owned").expect("write user skill");

        install_skill_files_from_embedded_at_paths(
            &skill,
            Some(&target_agents),
            home_dir.path(),
            app_data.path(),
        )
        .await
        .expect("install embedded skill");

        let central_dir = openteams_skill_data_dir("artifacts-builder", app_data.path());
        assert!(central_dir.join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(user_dir.join("SKILL.md")).expect("read user skill"),
            "user owned"
        );
        assert_eq!(
            check_link_conflict(&user_dir, app_data.path()).await,
            LinkConflict::UserOwned
        );
    }

    #[tokio::test]
    async fn safe_uninstall_removes_managed_link_and_preserves_user_dir() {
        let home_dir = tempfile::tempdir().expect("home dir");
        let app_data = tempfile::tempdir().expect("app data");
        let central_dir = openteams_skill_data_dir("managed-skill", app_data.path());
        fs::create_dir_all(&central_dir).expect("create central dir");
        fs::write(central_dir.join("SKILL.md"), "managed").expect("write central skill");

        let managed_dir = home_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("managed-skill");
        create_skill_link(&central_dir, &managed_dir)
            .await
            .expect("create managed link");

        let user_dir = home_dir
            .path()
            .join(".gemini")
            .join("skills")
            .join("managed-skill");
        fs::create_dir_all(&user_dir).expect("create user dir");
        fs::write(user_dir.join("SKILL.md"), "user owned").expect("write user skill");

        uninstall_skill_files_from_global_directory_at_paths(
            &test_chat_skill("managed-skill"),
            home_dir.path(),
            app_data.path(),
        )
        .await
        .expect("safe uninstall");

        assert!(!managed_dir.exists());
        assert!(!central_dir.exists());
        assert_eq!(
            fs::read_to_string(user_dir.join("SKILL.md")).expect("read user skill"),
            "user owned"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn user_owned_symlink_is_not_managed() {
        let home_dir = tempfile::tempdir().expect("home dir");
        let app_data = tempfile::tempdir().expect("app data");
        let target_dir = tempfile::tempdir().expect("user target");
        let skill_dir = home_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("user-skill");
        fs::create_dir_all(skill_dir.parent().expect("skill parent")).expect("create parent");
        std::os::unix::fs::symlink(target_dir.path(), &skill_dir).expect("create user symlink");

        assert_eq!(
            check_link_conflict(&skill_dir, app_data.path()).await,
            LinkConflict::UserOwned
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn user_owned_junction_is_not_managed() {
        let home_dir = tempfile::tempdir().expect("home dir");
        let app_data = tempfile::tempdir().expect("app data");
        let target_dir = tempfile::tempdir().expect("user target");
        let skill_dir = home_dir
            .path()
            .join(".claude")
            .join("skills")
            .join("user-skill");
        fs::create_dir_all(skill_dir.parent().expect("skill parent")).expect("create parent");
        junction::create(target_dir.path(), &skill_dir).expect("create user junction");

        assert_eq!(
            check_link_conflict(&skill_dir, app_data.path()).await,
            LinkConflict::UserOwned
        );
    }
}
