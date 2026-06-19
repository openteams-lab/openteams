use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, header::HOST},
    response::{Html, Json as ResponseJson},
    routing::{get, post},
};
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use services::services::github::{
    auth::{
        DeviceFlowGitHubAuthProvider, GitHubAuthProvider, GitHubDeviceFlowPollResponse,
        GitHubDeviceFlowStartResponse, GitHubOAuthFlowStatus, GitHubOAuthStartResponse,
        GitHubOAuthStatusResponse,
    },
    rest_client::{GitHubApiErrorData, GitHubRepositorySummary, GitHubRestClient, GitHubRestError},
};
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct GitHubDevicePollRequest {
    pub device_code: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct GitHubOAuthStatusQuery {
    pub flow_id: String,
}

#[derive(Debug, Deserialize)]
struct GitHubOAuthCallbackQuery {
    flow_id: String,
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/github/auth/oauth/start", post(start_oauth_flow))
        .route("/github/auth/oauth/callback", get(oauth_callback))
        .route("/github/auth/oauth/status", get(oauth_status))
        .route("/github/auth/device/start", post(start_device_flow))
        .route("/github/auth/device/poll", post(poll_device_flow))
        .route("/github/auth/account", get(current_account))
        .route("/github/auth/disconnect", post(disconnect))
        .route("/github/repos", get(list_github_repos))
}

fn provider() -> Result<DeviceFlowGitHubAuthProvider, ApiError> {
    DeviceFlowGitHubAuthProvider::from_env()
        .map_err(|err| ApiError::BadRequest(format!("GitHub auth setup failed: {err}")))
}

async fn start_oauth_flow(
    State(_deployment): State<DeploymentImpl>,
    headers: HeaderMap,
) -> Result<ResponseJson<ApiResponse<GitHubOAuthStartResponse>>, ApiError> {
    let callback_base_url = oauth_callback_base_url(&headers);
    let response = provider()?
        .start_oauth_flow(&callback_base_url)
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub OAuth start failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn oauth_status(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<GitHubOAuthStatusQuery>,
) -> Result<ResponseJson<ApiResponse<GitHubOAuthStatusResponse>>, ApiError> {
    let response = provider()?.oauth_flow_status(&query.flow_id);
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn oauth_callback(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<GitHubOAuthCallbackQuery>,
) -> Result<Html<String>, ApiError> {
    let provider = provider()?;
    let response = if let Some(error) = query.error {
        provider.fail_oauth_flow(
            &query.flow_id,
            GitHubOAuthFlowStatus::Denied,
            query.error_description.unwrap_or(error),
        )
    } else {
        let Some(code) = query.code.as_deref() else {
            let response = provider.fail_oauth_flow(
                &query.flow_id,
                GitHubOAuthFlowStatus::Error,
                "missing_oauth_code".to_string(),
            );
            return Ok(Html(oauth_callback_page(&response)));
        };
        let Some(state) = query.state.as_deref() else {
            let response = provider.fail_oauth_flow(
                &query.flow_id,
                GitHubOAuthFlowStatus::Error,
                "missing_oauth_state".to_string(),
            );
            return Ok(Html(oauth_callback_page(&response)));
        };
        provider
            .complete_oauth_callback(&query.flow_id, state, code)
            .await
            .map_err(|err| ApiError::BadRequest(format!("GitHub OAuth callback failed: {err}")))?
    };
    Ok(Html(oauth_callback_page(&response)))
}

async fn start_device_flow(
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<GitHubDeviceFlowStartResponse>>, ApiError> {
    let response = provider()?
        .start_device_flow()
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub device flow start failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn poll_device_flow(
    State(_deployment): State<DeploymentImpl>,
    Json(payload): Json<GitHubDevicePollRequest>,
) -> Result<ResponseJson<ApiResponse<GitHubDeviceFlowPollResponse>>, ApiError> {
    let response = provider()?
        .poll_device_flow(&payload.device_code)
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub device flow poll failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn current_account(
    State(_deployment): State<DeploymentImpl>,
) -> Result<
    ResponseJson<ApiResponse<Option<services::services::github::auth::GitHubAccount>>>,
    ApiError,
> {
    let account = provider()?
        .current_account()
        .await
        .map_err(|err| ApiError::BadRequest(format!("GitHub account lookup failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(account)))
}

async fn disconnect(
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    provider()?
        .disconnect()
        .map_err(|err| ApiError::BadRequest(format!("GitHub disconnect failed: {err}")))?;
    Ok(ResponseJson(ApiResponse::success(())))
}

async fn list_github_repos(
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<GitHubRepositorySummary>, GitHubApiErrorData>>, ApiError> {
    let provider = provider()?;
    let token = match provider.access_token().await {
        Ok(token) => token,
        Err(err) => {
            return Ok(ResponseJson(ApiResponse::error_with_data(
                github_error_data("github_auth_required", err.to_string()),
            )));
        }
    };
    let client = GitHubRestClient::new(SecretString::from(token.token.expose_secret().to_string()));
    match client.list_authenticated_repositories().await {
        Ok(repos) => Ok(ResponseJson(ApiResponse::success(repos))),
        Err(GitHubRestError::Api(data)) => Ok(ResponseJson(ApiResponse::error_with_data(data))),
        Err(err) => Ok(ResponseJson(ApiResponse::error_with_data(
            github_error_data("github_write_failed", err.to_string()),
        ))),
    }
}

fn github_error_data(code: &str, message: impl Into<String>) -> GitHubApiErrorData {
    GitHubApiErrorData {
        code: code.to_string(),
        message: message.into(),
        retry_after: None,
        last_synced_at: None,
        stale: false,
    }
}

fn oauth_callback_base_url(headers: &HeaderMap) -> String {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("http");
    let host = headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("127.0.0.1:3001");
    format!(
        "{scheme}://{}/api/github/auth/oauth/callback",
        normalize_loopback_host(host)
    )
}

fn normalize_loopback_host(host: &str) -> String {
    let trimmed = host.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower == "localhost" || lower == "0.0.0.0" {
        return "127.0.0.1".to_string();
    }
    for prefix in ["localhost:", "0.0.0.0:"] {
        if let Some(port) = lower.strip_prefix(prefix) {
            return format!("127.0.0.1:{port}");
        }
    }
    trimmed.to_string()
}

fn oauth_callback_page(response: &GitHubOAuthStatusResponse) -> String {
    let (title, body, state_class, icon_svg) = match response.status {
        GitHubOAuthFlowStatus::Authorized => {
            let login = response
                .account
                .as_ref()
                .map(|account| account.login.as_str())
                .unwrap_or("GitHub");
            (
                "GitHub authorization complete",
                format!(
                    "Authorized as <strong>{}</strong>. You can close this window.",
                    escape_html(login)
                ),
                "state-success",
                r#"<svg width="14" height="14" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>"#,
            )
        }
        GitHubOAuthFlowStatus::Denied => (
            "GitHub authorization cancelled",
            escape_html("Authorization was cancelled. You can return to OpenTeams."),
            "state-warning",
            r#"<svg width="14" height="14" viewBox="0 0 24 24"><line x1="12" y1="7" x2="12" y2="13"></line><line x1="12" y1="17" x2="12" y2="17"></line><circle cx="12" cy="12" r="9"></circle></svg>"#,
        ),
        GitHubOAuthFlowStatus::Expired => (
            "GitHub authorization expired",
            escape_html("The authorization request expired. Start a new login from OpenTeams."),
            "state-warning",
            r#"<svg width="14" height="14" viewBox="0 0 24 24"><line x1="12" y1="7" x2="12" y2="13"></line><line x1="12" y1="17" x2="12" y2="17"></line><circle cx="12" cy="12" r="9"></circle></svg>"#,
        ),
        _ => (
            "GitHub authorization failed",
            format!(
                "Authorization failed: {}",
                escape_html(response.error.as_deref().unwrap_or("unknown error"))
            ),
            "state-warning",
            r#"<svg width="14" height="14" viewBox="0 0 24 24"><line x1="12" y1="7" x2="12" y2="13"></line><line x1="12" y1="17" x2="12" y2="17"></line><circle cx="12" cy="12" r="9"></circle></svg>"#,
        ),
    };
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{}</title>
<style>
    :root {{
        --bg-page: #f6f8fa;
        --bg-card: #ffffff;
        --border-light: #d0d7de;
        --text-primary: #1f2328;
        --text-secondary: #57606a;
        --text-muted: #6e7781;
        --accent-blue: #2f81f7;
        --accent-blue-hover: #218bff;
        --success-color: #1f883d;
        --success-bg: #dafbe1;
        --success-border: #2ea04333;
        --warning-color: #9a6700;
        --warning-bg: #fff8c5;
        --warning-border: #d29922;
        --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }}

    * {{
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }}

    body {{
        min-height: 100dvh;
        background-color: var(--bg-page);
        color: var(--text-primary);
        font-family: var(--font-sans);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 92px 24px 24px;
        -webkit-font-smoothing: antialiased;
    }}

    .success-card {{
        width: 100%;
        max-width: 540px;
        background-color: var(--bg-card);
        border: 1px solid var(--border-light);
        border-radius: 8px;
        box-shadow: 0 1px 0 rgba(27, 31, 36, 0.04), 0 1px 3px rgba(27, 31, 36, 0.08);
        display: flex;
        flex-direction: column;
    }}

    .card-header {{
        padding: 20px 24px;
        border-bottom: 1px solid var(--border-light);
        display: flex;
        align-items: center;
        gap: 12px;
    }}

    .success-icon-box {{
        width: 28px;
        height: 28px;
        background-color: var(--success-bg);
        border: 1px solid var(--success-border);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--success-color);
        flex: 0 0 auto;
    }}

    .success-card.state-warning .success-icon-box {{
        background-color: var(--warning-bg);
        border-color: var(--warning-border);
        color: var(--warning-color);
    }}

    .card-header h1 {{
        font-size: 16px;
        font-weight: 600;
        letter-spacing: -0.01em;
    }}

    .card-body {{
        padding: 32px 24px;
    }}

    .meta-text {{
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-muted);
        margin-bottom: 12px;
        text-transform: lowercase;
    }}

    .main-message {{
        font-size: 15px;
        line-height: 1.5;
        color: var(--text-primary);
    }}

    .main-message strong {{
        font-weight: 600;
        color: #1f2328;
    }}

    .card-footer {{
        padding: 16px 24px;
        border-top: 1px solid var(--border-light);
        background: rgba(255, 255, 255, 0.01);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border-bottom-left-radius: 8px;
        border-bottom-right-radius: 8px;
    }}

    .footer-hint {{
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-secondary);
    }}

    .btn-primary {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        padding: 0 16px;
        height: 32px;
        border-radius: 6px;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
        border: 1px solid #2ea043;
        background-color: #2ea043;
        color: #ffffff;
        box-shadow: none;
    }}

    .btn-primary:hover {{
        background-color: #2ea043;
        border-color: #2ea043;
    }}

    .btn-primary:focus-visible {{
        outline: 2px solid rgba(47, 129, 247, 0.4);
        outline-offset: 2px;
    }}

    svg {{
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-linejoin: round;
    }}

    @media (max-width: 560px) {{
        body {{
            padding: 56px 16px 16px;
        }}

        .card-footer {{
            align-items: stretch;
            flex-direction: column;
        }}

        .btn-primary {{
            width: 100%;
        }}
    }}
</style>
</head>
<body>
  <div class="success-card {}" role="dialog" aria-labelledby="oauth-title" aria-describedby="oauth-message">
    <header class="card-header">
      <div class="success-icon-box">
        {}
      </div>
      <h1 id="oauth-title">{}</h1>
    </header>

    <main class="card-body">
      <div class="meta-text">github oauth callback</div>
      <div id="oauth-message" class="main-message">
        {}
      </div>
    </main>

    <footer class="card-footer">
      <div class="footer-hint">Return to OpenTeams after closing this browser tab.</div>
      <button class="btn-primary" onclick="window.close()">Close window</button>
    </footer>
  </div>
</body>
</html>"#,
        escape_html(title),
        state_class,
        icon_svg,
        escape_html(title),
        body
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, header::HOST};

    use super::{github_error_data, oauth_callback_base_url};

    #[test]
    fn github_repo_list_auth_errors_are_structured() {
        let data = github_error_data("github_auth_required", "GitHub auth required");

        assert_eq!(data.code, "github_auth_required");
        assert_eq!(data.message, "GitHub auth required");
        assert!(!data.stale);
    }

    #[test]
    fn oauth_callback_base_url_uses_loopback_literal() {
        let mut headers = HeaderMap::new();
        headers.insert(HOST, HeaderValue::from_static("localhost:3001"));

        assert_eq!(
            oauth_callback_base_url(&headers),
            "http://127.0.0.1:3001/api/github/auth/oauth/callback"
        );
    }
}
