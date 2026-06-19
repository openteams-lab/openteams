use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use axum::{
    Json, Router,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
};
use flate2::read::GzDecoder;
use semver::Version;
use serde::{Deserialize, Serialize};
use tar::Archive;
use tokio::{process::Command, time::sleep};
use ts_rs::TS;
use utils::{response::ApiResponse, version::APP_VERSION};

use crate::{DeploymentImpl, npx_browser_lifecycle};

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/openteams-lab/openteams/releases/latest";
const NPX_UPDATE_PACKAGE_SPEC: &str = "@openteams-lab/openteams-web@latest";
const NPX_UPDATE_PACKAGE_ENV: &str = "OPENTEAMS_NPX_UPDATE_PACKAGE";
const NPX_UPDATE_STATE_FILE: &str = "prepared-package.json";
const PROCESS_EXIT_DELAY: Duration = Duration::from_millis(500);
// const SKIP_BROWSER_ENV: &str = "OPENTEAMS_SKIP_BROWSER";
const MOCK_GITHUB_LATEST_RELEASE_ENV: &str = "OPENTEAMS_MOCK_GITHUB_LATEST_RELEASE";
const MOCK_DEPLOY_MODE_ENV: &str = "OPENTEAMS_MOCK_DEPLOY_MODE";
const MOCK_RELEASE_TAG_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_TAG";
const MOCK_RELEASE_URL_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_URL";
const MOCK_RELEASE_NOTES_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_NOTES";
const MOCK_RELEASE_PUBLISHED_AT_ENV: &str = "OPENTEAMS_MOCK_GITHUB_RELEASE_PUBLISHED_AT";

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/version/check", get(check_version))
        .route("/version/update-npx", post(update_npx))
        .route("/version/restart", post(restart_service))
}

include!("types.rs");
include!("release.rs");
include!("npx_update.rs");
include!("deploy_mode.rs");
include!("process.rs");
include!("tests.rs");
