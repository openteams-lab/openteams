#[derive(Debug, Clone, Serialize, TS)]
pub struct VersionCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub deploy_mode: String,
    pub release_url: String,
    pub release_notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct UpdateNpxResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PreparedNpxPackage {
    package_spec: String,
    cli_path: PathBuf,
    archive_path: Option<PathBuf>,
    extract_dir: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct NpmPackEntry {
    filename: String,
}
