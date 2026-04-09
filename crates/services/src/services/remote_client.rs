//! OAuth client for authorization-code handoffs with automatic retries.

use std::time::Duration;

use backon::{ExponentialBuilder, Retryable};
use chrono::Duration as ChronoDuration;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;
use url::Url;
use utils::{
    api::oauth::{ProfileResponse, TokenRefreshRequest, TokenRefreshResponse},
    jwt::extract_expiration,
};

use super::{auth::AuthContext, oauth_credentials::Credentials};

#[derive(Debug, Clone, Error)]
pub enum RemoteClientError {
    #[error("network error: {0}")]
    Transport(String),
    #[error("timeout")]
    Timeout,
    #[error("http {status}: {body}")]
    Http { status: u16, body: String },
    #[error("unauthorized")]
    Auth,
    #[error("json error: {0}")]
    Serde(String),
    #[error("url error: {0}")]
    Url(String),
    #[error("credentials storage error: {0}")]
    Storage(String),
    #[error("invalid access token: {0}")]
    Token(String),
}

impl RemoteClientError {
    /// Returns true if the error is transient and should be retried.
    pub fn should_retry(&self) -> bool {
        match self {
            Self::Transport(_) | Self::Timeout => true,
            Self::Http { status, .. } => (500..=599).contains(status),
            _ => false,
        }
    }
}

/// HTTP client for the remote OAuth server with automatic retries.
pub struct RemoteClient {
    base: Url,
    http: Client,
    auth_context: AuthContext,
}

impl std::fmt::Debug for RemoteClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RemoteClient")
            .field("base", &self.base)
            .field("http", &self.http)
            .field("auth_context", &"<present>")
            .finish()
    }
}

impl Clone for RemoteClient {
    fn clone(&self) -> Self {
        Self {
            base: self.base.clone(),
            http: self.http.clone(),
            auth_context: self.auth_context.clone(),
        }
    }
}

impl RemoteClient {
    const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
    const TOKEN_REFRESH_LEEWAY_SECS: i64 = 20;

    pub fn new(base_url: &str, auth_context: AuthContext) -> Result<Self, RemoteClientError> {
        let base = Url::parse(base_url).map_err(|e| RemoteClientError::Url(e.to_string()))?;
        let mut builder = Client::builder()
            .timeout(Self::REQUEST_TIMEOUT)
            .user_agent(concat!("remote-client/", env!("CARGO_PKG_VERSION")));

        #[cfg(debug_assertions)]
        {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let http = builder
            .build()
            .map_err(|e| RemoteClientError::Transport(e.to_string()))?;
        Ok(Self {
            base,
            http,
            auth_context,
        })
    }

    /// Returns a valid access token, refreshing when it's about to expire.
    fn require_token(
        &self,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<String, RemoteClientError>> + Send + '_>,
    > {
        Box::pin(async move {
            let leeway = ChronoDuration::seconds(Self::TOKEN_REFRESH_LEEWAY_SECS);
            let creds = self
                .auth_context
                .get_credentials()
                .await
                .ok_or(RemoteClientError::Auth)?;

            if let Some(token) = creds.access_token.as_ref()
                && !creds.expires_soon(leeway)
            {
                return Ok(token.clone());
            }

            let refreshed = {
                let _refresh_guard = self.auth_context.refresh_guard().await;
                let latest = self
                    .auth_context
                    .get_credentials()
                    .await
                    .ok_or(RemoteClientError::Auth)?;
                if let Some(token) = latest.access_token.as_ref()
                    && !latest.expires_soon(leeway)
                {
                    return Ok(token.clone());
                }

                self.refresh_credentials(&latest).await
            };

            match refreshed {
                Ok(updated) => updated.access_token.ok_or(RemoteClientError::Auth),
                Err(RemoteClientError::Auth) => {
                    let _ = self.auth_context.clear_credentials().await;
                    Err(RemoteClientError::Auth)
                }
                Err(err) => Err(err),
            }
        })
    }

    async fn refresh_credentials(
        &self,
        creds: &Credentials,
    ) -> Result<Credentials, RemoteClientError> {
        let response = self.refresh_token_request(&creds.refresh_token).await?;
        let access_token = response.access_token;
        let refresh_token = response.refresh_token;
        let expires_at = extract_expiration(&access_token)
            .map_err(|err| RemoteClientError::Token(err.to_string()))?;
        let new_creds = Credentials {
            access_token: Some(access_token),
            refresh_token,
            expires_at: Some(expires_at),
        };
        self.auth_context
            .save_credentials(&new_creds)
            .await
            .map_err(|e| RemoteClientError::Storage(e.to_string()))?;
        Ok(new_creds)
    }

    async fn refresh_token_request(
        &self,
        refresh_token: &str,
    ) -> Result<TokenRefreshResponse, RemoteClientError> {
        let request = TokenRefreshRequest {
            refresh_token: refresh_token.to_string(),
        };
        let res = self
            .send(
                reqwest::Method::POST,
                "/v1/tokens/refresh",
                false,
                Some(&request),
            )
            .await?;
        res.json::<TokenRefreshResponse>()
            .await
            .map_err(|e| RemoteClientError::Serde(e.to_string()))
    }

    async fn send<B>(
        &self,
        method: reqwest::Method,
        path: &str,
        requires_auth: bool,
        body: Option<&B>,
    ) -> Result<reqwest::Response, RemoteClientError>
    where
        B: Serialize,
    {
        let url = self
            .base
            .join(path)
            .map_err(|e| RemoteClientError::Url(e.to_string()))?;

        (|| async {
            let mut req = self
                .http
                .request(method.clone(), url.clone())
                .header("X-Client-Version", env!("CARGO_PKG_VERSION"))
                .header("X-Client-Type", "local-backend");

            if requires_auth {
                let token = self.require_token().await?;
                req = req.bearer_auth(token);
            }

            if let Some(b) = body {
                req = req.json(b);
            }

            let res = req.send().await.map_err(map_reqwest_error)?;

            match res.status() {
                s if s.is_success() => Ok(res),
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(RemoteClientError::Auth),
                s => {
                    let status = s.as_u16();
                    let body = res.text().await.unwrap_or_default();
                    Err(RemoteClientError::Http { status, body })
                }
            }
        })
        .retry(
            &ExponentialBuilder::default()
                .with_min_delay(Duration::from_millis(500))
                .with_max_delay(Duration::from_secs(2))
                .with_max_times(2)
                .with_jitter(),
        )
        .when(|e: &RemoteClientError| e.should_retry())
        .notify(|e, dur| {
            warn!(
                "Remote call failed, retrying after {:.2}s: {}",
                dur.as_secs_f64(),
                e
            )
        })
        .await
    }

    // Authenticated endpoint helpers (require token)
    async fn get_authed<T>(&self, path: &str) -> Result<T, RemoteClientError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let res = self
            .send(reqwest::Method::GET, path, true, None::<&()>)
            .await?;
        res.json::<T>()
            .await
            .map_err(|e| RemoteClientError::Serde(e.to_string()))
    }

    /// Fetches user profile.
    pub async fn profile(&self) -> Result<ProfileResponse, RemoteClientError> {
        self.get_authed("/v1/profile").await
    }
}

fn map_reqwest_error(e: reqwest::Error) -> RemoteClientError {
    if e.is_timeout() {
        RemoteClientError::Timeout
    } else {
        RemoteClientError::Transport(e.to_string())
    }
}
