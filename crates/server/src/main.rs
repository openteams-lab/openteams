use std::{path::PathBuf, time::Duration};

use anyhow::{self, Error as AnyhowError};
use deployment::{Deployment, DeploymentError};
use server::{DeploymentImpl, npx_browser_lifecycle, routes};
use services::services::{
    agent_runtime::refresh_runtime_discovery,
    build_stats::model_pricing_sync::ModelPricingSyncService,
    config::{TeamTemplateCatalogService, TeamTemplateCatalogSyncResult, load_config_from_file},
    container::ContainerService,
    project::migration::ProjectMigrationService,
};
use sqlx::{Error as SqlxError, SqlitePool};
use strip_ansi_escapes::strip;
use thiserror::Error;
use tracing_subscriber::{EnvFilter, prelude::*};
use utils::{
    assets::{asset_dir, config_path},
    browser::open_browser,
    port_file::write_port_file,
    sentry::{self as sentry_utils, SentrySource, sentry_layer},
};

#[derive(Debug, Error)]
pub enum OpenTeamsError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] SqlxError),
    #[error(transparent)]
    Deployment(#[from] DeploymentError),
    #[error(transparent)]
    Other(#[from] AnyhowError),
}

fn is_desktop_mode() -> bool {
    std::env::var_os("AGENT_CHATGROUP_DESKTOP").is_some()
}

fn should_skip_browser_launch() -> bool {
    std::env::var_os("OPENTEAMS_SKIP_BROWSER").is_some()
}

fn should_auto_migrate_projects() -> bool {
    std::env::var("OPENTEAMS_AUTO_MIGRATE_PROJECTS")
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            value != "0" && value != "false"
        })
        .unwrap_or(true)
}

#[tokio::main]
async fn main() -> Result<(), OpenTeamsError> {
    // Install rustls crypto provider before any TLS operations
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    let startup_config = load_config_from_file(&config_path().to_path_buf()).await;
    if startup_config.error_reporting_enabled {
        sentry_utils::init_once(SentrySource::Backend);
    }

    let default_log_level = if cfg!(debug_assertions) {
        "info"
    } else {
        "error"
    };
    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| default_log_level.to_string());
    let filter_string = format!(
        "warn,server={level},services={level},db={level},executors={level},deployment={level},local_deployment={level},utils={level}",
        level = log_level
    );
    let env_filter =
        EnvFilter::try_new(filter_string.clone()).expect("Failed to create tracing filter");

    // In release builds, also persist logs to a local file for troubleshooting.
    // Set AGENT_CHATGROUP_FILE_LOG=0 to disable file logging.
    let mut file_log_guard = None;
    let mut file_log_dir = None;
    let file_log_layer = if !cfg!(debug_assertions)
        && std::env::var("AGENT_CHATGROUP_FILE_LOG")
            .map(|v| v != "0")
            .unwrap_or(true)
    {
        let log_dir = asset_dir().join("logs");
        match std::fs::create_dir_all(&log_dir) {
            Ok(_) => {
                let file_appender = tracing_appender::rolling::daily(&log_dir, "server.log");
                let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
                file_log_guard = Some(guard);
                file_log_dir = Some(log_dir);
                Some(
                    tracing_subscriber::fmt::layer()
                        .with_ansi(false)
                        .with_writer(non_blocking)
                        .with_filter(
                            EnvFilter::try_new(filter_string)
                                .expect("Failed to create file tracing filter"),
                        ),
                )
            }
            Err(err) => {
                eprintln!("Failed to create log directory: {}", err);
                None
            }
        }
    } else {
        None
    };

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(env_filter))
        .with(file_log_layer)
        .with(sentry_layer())
        .init();

    if let Some(log_dir) = &file_log_dir {
        tracing::info!(
            log_dir = %log_dir.display(),
            "Release file logging is enabled"
        );
    }

    // Keep the non-blocking file logging worker alive for the full process lifetime.
    let _file_log_guard = file_log_guard;

    // Create asset directory if it doesn't exist
    if !asset_dir().exists() {
        std::fs::create_dir_all(asset_dir())?;
    }

    let deployment = DeploymentImpl::new().await?;
    let _ = sync_team_template_catalog_on_server_startup(
        deployment.db().pool.clone(),
        config_path().to_path_buf(),
    )
    .await;
    deployment
        .container()
        .cleanup_orphan_executions()
        .await
        .map_err(DeploymentError::from)?;
    deployment
        .container()
        .backfill_before_head_commits()
        .await
        .map_err(DeploymentError::from)?;
    deployment
        .container()
        .backfill_repo_names()
        .await
        .map_err(DeploymentError::from)?;
    if should_auto_migrate_projects() {
        match ProjectMigrationService::has_legacy_sessions(&deployment.db().pool).await {
            Ok(true) => {
                tracing::info!("Legacy chat sessions detected; running project migration");
                if let Err(err) = ProjectMigrationService::new()
                    .migrate_legacy_sessions(&deployment.db().pool, deployment.user_id())
                    .await
                {
                    tracing::error!("Failed to migrate legacy chat sessions: {err}");
                }
            }
            Ok(false) => {
                tracing::debug!("No legacy chat sessions detected for project migration");
            }
            Err(err) => {
                tracing::warn!("Failed to check for legacy chat sessions: {err}");
            }
        }
    } else {
        tracing::info!("Automatic legacy project migration disabled by configuration");
    }

    let runtime_discovery_dir = std::env::current_dir().unwrap_or_else(|err| {
        tracing::warn!("Failed to resolve current directory for runtime discovery: {err}");
        asset_dir()
    });
    tokio::spawn(async move {
        if let Err(err) = refresh_runtime_discovery(&runtime_discovery_dir).await {
            tracing::warn!("Failed to refresh executor models at startup: {err}");
        }
    });

    // Keep model pricing sourced from external registries instead of local defaults.
    let pricing_pool = deployment.db().pool.clone();
    tokio::spawn(async move {
        let pricing_sync = ModelPricingSyncService::new();
        if let Err(err) = pricing_sync.sync_prices(&pricing_pool).await {
            tracing::warn!("Failed to sync model pricing: {err}");
        }

        let mut ticker = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(err) = pricing_sync.sync_prices(&pricing_pool).await {
                tracing::warn!("Failed to sync model pricing: {err}");
            }
        }
    });
    let app_router = routes::router(deployment.clone());

    let port = std::env::var("BACKEND_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|s| {
            // remove any ANSI codes, then turn into String
            let cleaned =
                String::from_utf8(strip(s.as_bytes())).expect("UTF-8 after stripping ANSI");
            cleaned.trim().parse::<u16>().ok()
        })
        .unwrap_or_else(|| {
            tracing::info!("No PORT environment variable set, using port 0 for auto-assignment");
            0
        }); // Use 0 to find free port if no specific port provided

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let bind_addr = format!("{host}:{port}");
    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(listener) => listener,
        Err(err)
            if cfg!(debug_assertions)
                && err.kind() == std::io::ErrorKind::AddrInUse
                && port != 0 =>
        {
            tracing::warn!(
                "Requested backend port {port} ({bind_addr}) is already in use; \
                 falling back to an ephemeral port for this debug run"
            );
            tokio::net::TcpListener::bind(format!("{host}:0")).await?
        }
        Err(err) => return Err(err.into()),
    };
    let actual_port = listener.local_addr()?.port(); // get 鈫?53427 (example)

    tracing::info!("Server running on http://{host}:{actual_port}");

    // Production non-desktop mode: write port file for extension discovery and open browser.
    // Desktop mode is launched by Tauri sidecar and should not open an external terminal/browser.
    if !cfg!(debug_assertions) && !is_desktop_mode() {
        if let Err(e) = write_port_file(actual_port).await {
            tracing::warn!("Failed to write port file: {}", e);
        }

        if should_skip_browser_launch() {
            tracing::info!("Skipping automatic browser launch for restarted process");
        } else {
            tracing::info!("Opening browser...");
            tokio::spawn(async move {
                if let Err(e) = open_browser(&format!("http://127.0.0.1:{actual_port}")).await {
                    tracing::warn!(
                        "Failed to open browser automatically: {}. Please open http://127.0.0.1:{} manually.",
                        e,
                        actual_port
                    );
                }
            });
        }
    }

    npx_browser_lifecycle::start_shutdown_monitor();

    axum::serve(listener, app_router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    perform_cleanup_actions(&deployment).await;

    Ok(())
}

async fn sync_team_template_catalog_on_server_startup(
    pool: SqlitePool,
    config_path: PathBuf,
) -> Result<TeamTemplateCatalogSyncResult, services::services::config::TeamTemplateCatalogError> {
    match TeamTemplateCatalogService::new(pool, config_path.clone())
        .sync()
        .await
    {
        Ok(result) => {
            tracing::info!(
                builtin_upserted = result.builtin_upserted,
                stale_builtin_deleted = result.stale_builtin_deleted,
                custom_reconciled = result.custom_reconciled,
                config_path = %config_path.display(),
                "synced team template catalog during server startup"
            );
            Ok(result)
        }
        Err(err) => {
            tracing::warn!(
                error = ?err,
                config_path = %config_path.display(),
                "failed to sync team template catalog during server startup"
            );
            Err(err)
        }
    }
}

pub async fn shutdown_signal() {
    // Always wait for Ctrl+C
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!("Failed to install Ctrl+C handler: {e}");
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        // Try to install SIGTERM handler, but don't panic if it fails
        let terminate = async {
            if let Ok(mut sigterm) = signal(SignalKind::terminate()) {
                sigterm.recv().await;
            } else {
                tracing::error!("Failed to install SIGTERM handler");
                // Fallback: never resolves
                std::future::pending::<()>().await;
            }
        };

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
            _ = npx_browser_lifecycle::wait_for_shutdown_signal() => {},
        }
    }

    #[cfg(not(unix))]
    {
        tokio::select! {
            _ = ctrl_c => {},
            _ = npx_browser_lifecycle::wait_for_shutdown_signal() => {},
        }
    }
}

pub async fn perform_cleanup_actions(deployment: &DeploymentImpl) {
    deployment
        .container()
        .kill_all_running_processes()
        .await
        .expect("Failed to cleanly kill running execution processes");
}

#[cfg(test)]
mod tests {
    use db::models::chat_team_template_catalog::{
        ChatTeamTemplateCatalog, TeamTemplateCatalogSource,
    };
    use services::services::config::{Config, save_config_to_file_atomic};

    use super::*;

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

    #[tokio::test]
    async fn server_startup_team_template_catalog_sync_is_idempotent() {
        let pool = setup_pool().await;
        let temp = tempfile::TempDir::new().expect("temp dir");
        let config_path = temp.path().join("config.json");
        save_config_to_file_atomic(&Config::default(), &config_path)
            .await
            .expect("write config");

        sync_team_template_catalog_on_server_startup(pool.clone(), config_path.clone())
            .await
            .expect("first startup sync");
        sync_team_template_catalog_on_server_startup(pool.clone(), config_path)
            .await
            .expect("second startup sync");

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
    }
}
