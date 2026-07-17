use std::{
    fmt::Write as _,
    fs, io,
    path::{Path, PathBuf},
};

use db::models::chat_team_template_catalog::{
    ChatTeamTemplateCatalog, TeamTemplateCatalogSource, TeamTemplateCatalogTier,
    UpsertChatTeamTemplateCatalog,
};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use thiserror::Error;

use crate::services::config::{
    ChatTeamPreset, ChatTeamTemplateTier, Config, ConfigError,
    preset_loader::{BuiltinTeamTemplateCatalogEntry, PresetLoader},
    save_config_to_file_atomic,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamTemplateCatalogSyncResult {
    pub builtin_upserted: usize,
    pub stale_builtin_deleted: u64,
    pub custom_reconciled: u64,
}

#[derive(Debug, Error)]
pub enum TeamTemplateCatalogError {
    #[error("failed to load built-in team template catalog: {0}")]
    BuiltinCatalog(anyhow::Error),
    #[error("failed to read team template config: {0}")]
    ConfigRead(#[source] io::Error),
    #[error("failed to parse team template config: {0}")]
    ConfigParse(#[source] anyhow::Error),
    #[error("failed to save custom team template config: {0}")]
    ConfigSave(#[source] ConfigError),
    #[error(
        "failed to update custom team template catalog: {source_message}; restored previous config"
    )]
    CatalogUpdateRestored { source_message: String },
    #[error(
        "failed to update custom team template catalog: {source_message}; failed to restore previous config: {restore_error}"
    )]
    CatalogUpdateRestoreFailed {
        source_message: String,
        restore_error: std::io::Error,
    },
    #[error("failed to sync team template catalog: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid team template catalog tier for {template_id}: {tier}")]
    InvalidTier { template_id: String, tier: String },
}

#[derive(Clone)]
pub struct TeamTemplateCatalogService {
    pool: SqlitePool,
    config_path: PathBuf,
    #[cfg(test)]
    builtin_entries: Option<Vec<BuiltinTeamTemplateCatalogEntry>>,
}

impl TeamTemplateCatalogService {
    pub fn new(pool: SqlitePool, config_path: impl Into<PathBuf>) -> Self {
        Self {
            pool,
            config_path: config_path.into(),
            #[cfg(test)]
            builtin_entries: None,
        }
    }

    #[cfg(test)]
    fn new_for_test_with_builtin_entries(
        pool: SqlitePool,
        config_path: impl Into<PathBuf>,
        builtin_entries: Vec<BuiltinTeamTemplateCatalogEntry>,
    ) -> Self {
        Self {
            pool,
            config_path: config_path.into(),
            builtin_entries: Some(builtin_entries),
        }
    }

    pub async fn sync(&self) -> Result<TeamTemplateCatalogSyncResult, TeamTemplateCatalogError> {
        let config = self.load_config_for_sync()?;
        self.sync_with_config(&config).await
    }

    pub async fn save_config_and_sync(
        &self,
        config: &Config,
    ) -> Result<(), TeamTemplateCatalogError> {
        let previous_config = match read_optional_config_raw(&self.config_path) {
            Ok(raw) => raw,
            Err(err) => {
                tracing::warn!(
                    config_path = %self.config_path.display(),
                    error = ?err,
                    "failed to read previous team template config before save; restore may be unavailable"
                );
                None
            }
        };

        if let Err(err) = save_config_to_file_atomic(config, &self.config_path).await {
            tracing::error!(
                config_path = %self.config_path.display(),
                error = ?err,
                "failed to save team template config before catalog sync"
            );
            return Err(TeamTemplateCatalogError::ConfigSave(err));
        }

        if let Err(source) = self.sync_with_config(config).await {
            tracing::error!(
                config_path = %self.config_path.display(),
                error = ?source,
                "failed to update team template catalog after config save; attempting config restore"
            );
            return match self.restore_previous_config(previous_config.as_deref()) {
                Ok(()) => {
                    tracing::warn!(
                        config_path = %self.config_path.display(),
                        "restored previous team template config after catalog update failure"
                    );
                    Err(TeamTemplateCatalogError::CatalogUpdateRestored {
                        source_message: source.to_string(),
                    })
                }
                Err(restore_error) => {
                    tracing::error!(
                        config_path = %self.config_path.display(),
                        error = ?restore_error,
                        "failed to restore previous team template config after catalog update failure"
                    );
                    Err(TeamTemplateCatalogError::CatalogUpdateRestoreFailed {
                        source_message: source.to_string(),
                        restore_error,
                    })
                }
            };
        }

        Ok(())
    }

    async fn sync_with_config(
        &self,
        config: &Config,
    ) -> Result<TeamTemplateCatalogSyncResult, TeamTemplateCatalogError> {
        let builtin_rows = self.builtin_rows()?;
        let custom_rows = self.custom_rows_from_config(config, builtin_rows.len() as i64);
        let mut retained_template_ids = builtin_rows
            .iter()
            .map(|row| row.template_id.clone())
            .collect::<Vec<_>>();
        retained_template_ids.extend(custom_rows.iter().map(|row| row.template_id.clone()));

        let mut tx = self.pool.begin().await?;
        for row in &builtin_rows {
            ChatTeamTemplateCatalog::upsert_in_conn(&mut tx, row).await?;
        }
        let stale_builtin_deleted =
            ChatTeamTemplateCatalog::delete_stale_builtin_in_conn(&mut tx, &retained_template_ids)
                .await?;
        let custom_reconciled =
            ChatTeamTemplateCatalog::reconcile_custom_in_conn(&mut tx, &custom_rows).await?;
        tx.commit().await?;

        Ok(TeamTemplateCatalogSyncResult {
            builtin_upserted: builtin_rows.len(),
            stale_builtin_deleted,
            custom_reconciled,
        })
    }

    pub async fn save_custom_template(
        &self,
        mut template: ChatTeamPreset,
    ) -> Result<(), TeamTemplateCatalogError> {
        template.is_builtin = false;
        let mut config = self.load_config_for_write()?;

        config
            .chat_presets
            .teams
            .retain(|team| team.is_builtin || team.id != template.id);
        config.chat_presets.teams.push(template.clone());

        self.save_config_and_sync(&config).await
    }

    pub async fn list_templates(
        &self,
        config: &Config,
        locale: Option<&str>,
    ) -> Result<Vec<ChatTeamPreset>, TeamTemplateCatalogError> {
        let rows = self.catalog_rows(config).await?;
        let builtin_by_id = PresetLoader::load_builtin_presets_for_locale(locale)
            .teams
            .into_iter()
            .map(|team| (team.id.clone(), team))
            .collect::<std::collections::HashMap<_, _>>();
        let custom_by_id = config
            .chat_presets
            .teams
            .iter()
            .filter(|team| !team.is_builtin)
            .cloned()
            .map(|team| (team.id.clone(), team))
            .collect::<std::collections::HashMap<_, _>>();

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let mut template = match row.source {
                    TeamTemplateCatalogSource::Builtin => {
                        builtin_by_id.get(&row.template_id)?.clone()
                    }
                    TeamTemplateCatalogSource::Custom => {
                        custom_by_id.get(&row.template_id)?.clone()
                    }
                };
                template.enabled = row.enabled;
                template.tier = config_tier(row.tier);
                Some(template)
            })
            .collect())
    }

    pub async fn get_template(
        &self,
        config: &Config,
        template_id: &str,
        locale: Option<&str>,
    ) -> Result<Option<ChatTeamPreset>, TeamTemplateCatalogError> {
        let row = match ChatTeamTemplateCatalog::find_by_id(&self.pool, template_id).await? {
            Some(row) => row,
            None => {
                self.sync_with_config(config).await?;
                match ChatTeamTemplateCatalog::find_by_id(&self.pool, template_id).await? {
                    Some(row) => row,
                    None => return Ok(None),
                }
            }
        };
        let mut template = match row.source {
            TeamTemplateCatalogSource::Builtin => {
                PresetLoader::load_builtin_presets_for_locale(locale)
                    .teams
                    .into_iter()
                    .find(|team| team.id == template_id)
            }
            TeamTemplateCatalogSource::Custom => config
                .chat_presets
                .teams
                .iter()
                .find(|team| !team.is_builtin && team.id == template_id)
                .cloned(),
        };
        if let Some(template) = template.as_mut() {
            template.enabled = row.enabled;
            template.tier = config_tier(row.tier);
        }
        Ok(template)
    }

    async fn catalog_rows(
        &self,
        config: &Config,
    ) -> Result<Vec<ChatTeamTemplateCatalog>, TeamTemplateCatalogError> {
        let mut rows = ChatTeamTemplateCatalog::list_stable_sorted(&self.pool).await?;
        if rows.is_empty() {
            self.sync_with_config(config).await?;
            rows = ChatTeamTemplateCatalog::list_stable_sorted(&self.pool).await?;
        }
        Ok(rows)
    }

    fn builtin_rows(&self) -> Result<Vec<UpsertChatTeamTemplateCatalog>, TeamTemplateCatalogError> {
        let entries = self.builtin_entries()?;
        entries
            .into_iter()
            .map(|entry| {
                let tier = catalog_tier(&entry.template_id, &entry.tier)?;
                Ok(UpsertChatTeamTemplateCatalog {
                    template_id: entry.template_id,
                    source: TeamTemplateCatalogSource::Builtin,
                    tier,
                    enabled: entry.enabled,
                    sort_order: entry.sort_order,
                    content_checksum: content_checksum(&entry.source_content),
                })
            })
            .collect()
    }

    #[cfg(test)]
    fn builtin_entries(
        &self,
    ) -> Result<Vec<BuiltinTeamTemplateCatalogEntry>, TeamTemplateCatalogError> {
        self.builtin_entries.clone().map(Ok).unwrap_or_else(|| {
            PresetLoader::load_builtin_team_template_catalog_entries()
                .map_err(TeamTemplateCatalogError::BuiltinCatalog)
        })
    }

    #[cfg(not(test))]
    fn builtin_entries(
        &self,
    ) -> Result<Vec<BuiltinTeamTemplateCatalogEntry>, TeamTemplateCatalogError> {
        PresetLoader::load_builtin_team_template_catalog_entries()
            .map_err(TeamTemplateCatalogError::BuiltinCatalog)
    }

    fn custom_rows_from_config(
        &self,
        config: &Config,
        sort_offset: i64,
    ) -> Vec<UpsertChatTeamTemplateCatalog> {
        config
            .chat_presets
            .teams
            .iter()
            .filter(|team| !team.is_builtin)
            .enumerate()
            .map(|(index, team)| UpsertChatTeamTemplateCatalog {
                template_id: team.id.clone(),
                source: TeamTemplateCatalogSource::Custom,
                tier: catalog_tier_from_config(team.tier),
                enabled: team.enabled,
                sort_order: sort_offset + index as i64,
                content_checksum: custom_template_checksum(team),
            })
            .collect()
    }

    fn restore_previous_config(&self, previous_config: Option<&str>) -> Result<(), std::io::Error> {
        match previous_config {
            Some(raw) => fs::write(&self.config_path, raw),
            None => remove_file_if_exists(&self.config_path),
        }
    }

    fn load_config_for_sync(&self) -> Result<Config, TeamTemplateCatalogError> {
        load_config_strict(&self.config_path)
    }

    fn load_config_for_write(&self) -> Result<Config, TeamTemplateCatalogError> {
        load_config_strict(&self.config_path)
    }
}

fn catalog_tier(
    template_id: &str,
    tier: &str,
) -> Result<TeamTemplateCatalogTier, TeamTemplateCatalogError> {
    match tier {
        "standard" => Ok(TeamTemplateCatalogTier::Standard),
        "advanced" => Ok(TeamTemplateCatalogTier::Advanced),
        _ => Err(TeamTemplateCatalogError::InvalidTier {
            template_id: template_id.to_string(),
            tier: tier.to_string(),
        }),
    }
}

fn config_tier(tier: TeamTemplateCatalogTier) -> ChatTeamTemplateTier {
    match tier {
        TeamTemplateCatalogTier::Standard => ChatTeamTemplateTier::Standard,
        TeamTemplateCatalogTier::Advanced => ChatTeamTemplateTier::Advanced,
    }
}

fn catalog_tier_from_config(tier: ChatTeamTemplateTier) -> TeamTemplateCatalogTier {
    match tier {
        ChatTeamTemplateTier::Standard => TeamTemplateCatalogTier::Standard,
        ChatTeamTemplateTier::Advanced => TeamTemplateCatalogTier::Advanced,
    }
}

fn content_checksum(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n");
    let digest = Sha256::digest(normalized.as_bytes());
    let mut checksum = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut checksum, "{byte:02x}").expect("write to string");
    }
    checksum
}

fn custom_template_checksum(template: &ChatTeamPreset) -> String {
    let content = serde_json::to_string(template).expect("team template should serialize");
    content_checksum(&content)
}

fn remove_file_if_exists(path: &Path) -> Result<(), std::io::Error> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn load_config_strict(path: &Path) -> Result<Config, TeamTemplateCatalogError> {
    match fs::read_to_string(path) {
        Ok(raw) => Config::try_from_raw_config(&raw).map_err(TeamTemplateCatalogError::ConfigParse),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
        Err(err) => Err(TeamTemplateCatalogError::ConfigRead(err)),
    }
}

fn read_optional_config_raw(path: &Path) -> Result<Option<String>, io::Error> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use db::models::chat_team_template_catalog::{
        ChatTeamTemplateCatalog, TeamTemplateCatalogSource, TeamTemplateCatalogTier,
        UpsertChatTeamTemplateCatalog,
    };
    use sqlx::SqlitePool;
    use tempfile::TempDir;

    use crate::services::config::{
        ChatTeamPreset, ChatTeamTemplateTier, Config, TeamTemplateCatalogService,
        preset_loader::PresetLoader, save_config_to_file_atomic,
    };

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::migrate!("../db/migrations")
            .run(&pool)
            .await
            .expect("run migrations");
        pool
    }

    fn custom_team(id: &str) -> ChatTeamPreset {
        ChatTeamPreset {
            id: id.to_string(),
            name: "Custom Team".to_string(),
            description: "Custom team description".to_string(),
            members: Vec::new(),
            lead_member_id: None,
            workflow_steps: Vec::new(),
            team_protocol: "Keep the original custom protocol.".to_string(),
            is_builtin: false,
            enabled: true,
            tier: ChatTeamTemplateTier::Standard,
        }
    }

    fn advanced_custom_team(id: &str) -> ChatTeamPreset {
        ChatTeamPreset {
            tier: ChatTeamTemplateTier::Advanced,
            ..custom_team(id)
        }
    }

    async fn write_config_with_custom(path: &std::path::Path, team: ChatTeamPreset) {
        let mut config = Config::default();
        config.chat_presets.teams.push(team);
        save_config_to_file_atomic(&config, path)
            .await
            .expect("write config");
    }

    #[tokio::test]
    async fn sync_is_idempotent_and_indexes_current_builtin_markdown() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        save_config_to_file_atomic(&Config::default(), &config_path)
            .await
            .expect("write config");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);

        let first = service.sync().await.expect("first sync");
        let second = service.sync().await.expect("second sync");

        assert_eq!(first.builtin_upserted, 11);
        assert_eq!(second.builtin_upserted, 11);
        let rows = ChatTeamTemplateCatalog::list_stable_sorted(&pool)
            .await
            .expect("list catalog");
        assert_eq!(rows.len(), 11);
        assert_eq!(
            rows.iter()
                .filter(|row| row.source == TeamTemplateCatalogSource::Builtin)
                .count(),
            11
        );
        assert!(rows.iter().all(|row| !row.content_checksum.is_empty()));
    }

    #[tokio::test]
    async fn sync_does_not_fail_when_a_localized_builtin_source_is_unparseable() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        save_config_to_file_atomic(&Config::default(), &config_path)
            .await
            .expect("write config");
        let english = r#"---
id: fullstack_delivery_team
name: Fullstack Delivery Team
description: English source
member_ids:
  - backend-engineer
workflow_steps:
  - title: Plan
    description: Plan the work.
enabled: true
tier: standard
---

Use the English protocol.
"#;
        let builtin_entries =
            PresetLoader::load_builtin_team_template_catalog_entries_from_files(vec![
                (
                    "en/fullstack_delivery_team.md".to_string(),
                    english.to_string(),
                ),
                (
                    "zh/fullstack_delivery_team.md".to_string(),
                    "not frontmatter".to_string(),
                ),
            ])
            .expect("localized parse failures should not fail catalog entries");
        let service = TeamTemplateCatalogService::new_for_test_with_builtin_entries(
            pool.clone(),
            config_path,
            builtin_entries,
        );

        service
            .sync()
            .await
            .expect("catalog sync should ignore damaged localized source");

        let rows = ChatTeamTemplateCatalog::list_stable_sorted(&pool)
            .await
            .expect("list rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].template_id, "fullstack_delivery_team");
        assert_eq!(rows[0].source, TeamTemplateCatalogSource::Builtin);
    }

    #[tokio::test]
    async fn list_and_get_templates_use_catalog_sorting_locale_and_custom_originals() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        let custom = custom_team("custom_catalog_original");
        write_config_with_custom(&config_path, custom.clone()).await;
        let config =
            Config::try_from_raw_config(&fs::read_to_string(&config_path).expect("read config"))
                .expect("parse config");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);
        service.sync().await.expect("sync");

        let english = service
            .get_template(&config, "fullstack_delivery_team", Some("en"))
            .await
            .expect("get English")
            .expect("English template exists");
        let localized = service
            .get_template(&config, "fullstack_delivery_team", Some("fr-FR"))
            .await
            .expect("get localized")
            .expect("localized template exists");
        let custom_detail = service
            .get_template(&config, "custom_catalog_original", Some("fr-FR"))
            .await
            .expect("get custom")
            .expect("custom template exists");
        let listed = service
            .list_templates(&config, Some("ja-JP"))
            .await
            .expect("list templates");

        assert_ne!(localized.name, english.name);
        assert_eq!(localized.members, english.members);
        assert_eq!(custom_detail.name, custom.name);
        assert_eq!(custom_detail.team_protocol, custom.team_protocol);
        assert_eq!(listed.len(), 12);
        assert_eq!(listed[0].tier, ChatTeamTemplateTier::Standard);
        assert_eq!(listed[8].tier, ChatTeamTemplateTier::Standard);
        assert_eq!(listed[9].tier, ChatTeamTemplateTier::Standard);
        assert_eq!(listed[10].tier, ChatTeamTemplateTier::Advanced);
        assert!(
            listed
                .iter()
                .any(|team| team.id == "custom_catalog_original")
        );
    }

    #[tokio::test]
    async fn sync_preserves_explicit_advanced_custom_tier() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        write_config_with_custom(&config_path, advanced_custom_team("custom_advanced")).await;
        let config =
            Config::try_from_raw_config(&fs::read_to_string(&config_path).expect("read config"))
                .expect("parse config");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);

        service.sync().await.expect("sync catalog");

        let row = ChatTeamTemplateCatalog::find_by_id(&pool, "custom_advanced")
            .await
            .expect("find custom")
            .expect("custom row exists");
        let detail = service
            .get_template(&config, "custom_advanced", Some("zh-CN"))
            .await
            .expect("get custom")
            .expect("custom detail exists");
        assert_eq!(row.tier, TeamTemplateCatalogTier::Advanced);
        assert_eq!(detail.tier, ChatTeamTemplateTier::Advanced);
    }

    #[tokio::test]
    async fn sync_removes_stale_builtin_and_corrects_custom_drift_from_config() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        write_config_with_custom(&config_path, custom_team("custom_sync")).await;

        ChatTeamTemplateCatalog::upsert(
            &pool,
            &UpsertChatTeamTemplateCatalog {
                template_id: "removed_builtin".to_string(),
                source: TeamTemplateCatalogSource::Builtin,
                tier: TeamTemplateCatalogTier::Advanced,
                enabled: true,
                sort_order: 999,
                content_checksum: "stale".to_string(),
            },
        )
        .await
        .expect("insert stale builtin");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &UpsertChatTeamTemplateCatalog {
                template_id: "custom_sync".to_string(),
                source: TeamTemplateCatalogSource::Builtin,
                tier: TeamTemplateCatalogTier::Advanced,
                enabled: false,
                sort_order: 999,
                content_checksum: "wrong".to_string(),
            },
        )
        .await
        .expect("insert drifted custom");

        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);
        let result = service.sync().await.expect("sync catalog");

        assert_eq!(result.stale_builtin_deleted, 1);
        let custom = ChatTeamTemplateCatalog::find_by_id(&pool, "custom_sync")
            .await
            .expect("find custom")
            .expect("custom catalog row exists");
        assert_eq!(custom.source, TeamTemplateCatalogSource::Custom);
        assert_eq!(custom.tier, TeamTemplateCatalogTier::Standard);
        assert!(custom.enabled);
        assert!(
            ChatTeamTemplateCatalog::find_by_id(&pool, "removed_builtin")
                .await
                .expect("find removed builtin")
                .is_none()
        );
    }

    #[tokio::test]
    async fn sync_config_parse_failure_does_not_delete_existing_custom_catalog_rows() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        fs::write(
            &config_path,
            r#"{"config_version":"v9","chat_presets":"broken"}"#,
        )
        .expect("write invalid config");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &UpsertChatTeamTemplateCatalog {
                template_id: "custom_parse_failure".to_string(),
                source: TeamTemplateCatalogSource::Custom,
                tier: TeamTemplateCatalogTier::Standard,
                enabled: true,
                sort_order: 10,
                content_checksum: "existing".to_string(),
            },
        )
        .await
        .expect("insert custom catalog row");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);

        let err = service
            .sync()
            .await
            .expect_err("invalid config should fail sync");

        assert!(
            err.to_string()
                .contains("failed to parse team template config")
        );
        assert!(
            ChatTeamTemplateCatalog::find_by_id(&pool, "custom_parse_failure")
                .await
                .expect("find custom after failed sync")
                .is_some()
        );
    }

    #[tokio::test]
    async fn save_custom_template_reports_config_path_failure_without_catalog_write() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let blocked_parent = temp.path().join("blocked-parent");
        fs::write(&blocked_parent, "not a directory").expect("create file where parent should be");
        let config_path = blocked_parent.join("config.json");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path);

        let err = service
            .save_custom_template(custom_team("custom_config_failure"))
            .await
            .expect_err("config write should fail");

        assert!(
            err.to_string()
                .contains("failed to read team template config")
        );
        assert!(
            ChatTeamTemplateCatalog::find_by_id(&pool, "custom_config_failure")
                .await
                .expect("find failed custom")
                .is_none()
        );
    }

    #[tokio::test]
    async fn save_custom_template_restores_previous_config_when_database_write_fails() {
        let pool = setup_pool().await;
        let temp = TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        save_config_to_file_atomic(&Config::default(), &config_path)
            .await
            .expect("write initial config");
        let before = fs::read_to_string(&config_path).expect("read initial config");
        let service = TeamTemplateCatalogService::new(pool.clone(), config_path.clone());
        pool.close().await;

        let err = service
            .save_custom_template(custom_team("custom_db_failure"))
            .await
            .expect_err("database write should fail");

        assert!(
            err.to_string()
                .contains("failed to update custom team template catalog")
        );
        let after = fs::read_to_string(&config_path).expect("read restored config");
        assert_eq!(after, before);
    }
}
