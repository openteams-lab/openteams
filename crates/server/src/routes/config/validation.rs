#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ValidateProviderRequest {
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ValidateProviderResponse {
    pub valid: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CustomProviderProbeRequest {
    pub id: String,
    pub npm: Option<String>,
    pub options: CustomProviderOptions,
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CustomProviderProbeStatus {
    Success,
    Failed,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CustomProviderProbeResponse {
    pub status: CustomProviderProbeStatus,
    pub valid: bool,
    pub message: String,
    pub models: Vec<ModelInfo>,
}

const VALIDATION_TIMEOUT: Duration = Duration::from_secs(10);
const VALIDATION_CONNECTION_FAILED_MESSAGE: &str =
    "Connection test failed. Check the endpoint and credentials.";
const DEFAULT_ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/";
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/";
const DEFAULT_GOOGLE_ENDPOINT: &str = "https://generativelanguage.googleapis.com/";
const DEFAULT_OPENROUTER_ENDPOINT: &str = "https://openrouter.ai/api/v1/";
const DEFAULT_MINIMAX_ENDPOINT: &str = "https://api.minimaxi.com/anthropic/v1/";
const DEFAULT_OLLAMA_ENDPOINT: &str = "http://localhost:11434/";
const DEFAULT_CUSTOM_PROVIDER_NPM: &str = "@ai-sdk/openai-compatible";
const LEGACY_CUSTOM_PROVIDER_NPM: &str = "@ai-sdk/anthropic";
const AUTO_MODEL_VARIANT_PREFIX: &str = "AUTO_MODEL_";

struct ValidationRequestSpec {
    method: http::Method,
    url: Url,
    auth_header: Option<(&'static str, String)>,
    extra_headers: Vec<(&'static str, String)>,
    dns_override: Option<(String, Vec<SocketAddr>)>,
    json_body: Option<Value>,
}

fn validation_result(
    valid: bool,
    message: impl Into<String>,
) -> ResponseJson<ApiResponse<ValidateProviderResponse>> {
    ResponseJson(ApiResponse::success(ValidateProviderResponse {
        valid,
        message: message.into(),
    }))
}

fn normalize_validation_api_key(api_key: Option<&str>) -> Option<String> {
    api_key
        .map(str::trim)
        .filter(|key| !key.is_empty() && !key.contains("***"))
        .map(ToOwned::to_owned)
}

fn saved_provider_api_key(config: &CliConfig, provider: &str) -> Option<String> {
    match provider {
        "anthropic" => config.provider.anthropic.as_ref()?.api_key.clone(),
        "openai" => config.provider.openai.as_ref()?.api_key.clone(),
        "google" => config.provider.google.as_ref()?.api_key.clone(),
        "openrouter" => config.provider.openrouter.as_ref()?.api_key.clone(),
        "minimax" => config.provider.minimax.as_ref()?.api_key.clone(),
        "custom" => config.provider.custom.as_ref()?.api_key.clone(),
        other => config
            .provider
            .custom_providers
            .as_ref()
            .and_then(|p| p.get(other))
            .and_then(|e| e.options.api_key.clone()),
    }
}

fn saved_provider_endpoint(config: &CliConfig, provider: &str) -> Option<String> {
    match provider {
        "anthropic" => config.provider.anthropic.as_ref()?.endpoint.clone(),
        "openai" => config.provider.openai.as_ref()?.endpoint.clone(),
        "google" => config.provider.google.as_ref()?.endpoint.clone(),
        "openrouter" => config.provider.openrouter.as_ref()?.endpoint.clone(),
        "minimax" => config.provider.minimax.as_ref()?.endpoint.clone(),
        "ollama" => config.provider.ollama.as_ref()?.endpoint.clone(),
        "custom" => config.provider.custom.as_ref()?.endpoint.clone(),
        other => config
            .provider
            .custom_providers
            .as_ref()
            .and_then(|providers| providers.get(other))
            .and_then(|provider| provider.options.base_url.clone()),
    }
}

fn configured_or_default_endpoint(config: &CliConfig, provider: &str) -> Option<String> {
    let configured = saved_provider_endpoint(config, provider)
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
        .map(ToOwned::to_owned);

    configured.or_else(|| match provider {
        "anthropic" => Some(DEFAULT_ANTHROPIC_ENDPOINT.to_string()),
        "openai" => Some(DEFAULT_OPENAI_ENDPOINT.to_string()),
        "google" => Some(DEFAULT_GOOGLE_ENDPOINT.to_string()),
        "openrouter" => Some(DEFAULT_OPENROUTER_ENDPOINT.to_string()),
        "minimax" => Some(DEFAULT_MINIMAX_ENDPOINT.to_string()),
        "ollama" => Some(DEFAULT_OLLAMA_ENDPOINT.to_string()),
        _ => None,
    })
}

async fn build_provider_models_request(
    provider: &str,
    config: &CliConfig,
) -> Result<ValidationRequestSpec, String> {
    let endpoint = configured_or_default_endpoint(config, provider)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;
    let api_key = saved_provider_api_key(config, provider).unwrap_or_default();

    match provider {
        "anthropic" => {
            if api_key.is_empty() {
                return Err("Anthropic model discovery requires an API key".into());
            }
            let url = join_validation_url(validate_provider_endpoint(&endpoint)?, "v1/models")?;
            validation_request_spec(url, Some(("x-api-key", api_key))).await
        }
        "openai" => {
            if api_key.is_empty() {
                return Err("OpenAI model discovery requires an API key".into());
            }
            let url = join_validation_url(validate_provider_endpoint(&endpoint)?, "models")?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "google" => {
            if api_key.is_empty() {
                return Err("Google model discovery requires an API key".into());
            }
            let url = join_validation_url(validate_provider_endpoint(&endpoint)?, "v1beta/models")?;
            validation_request_spec(url, Some(("x-goog-api-key", api_key))).await
        }
        "openrouter" => {
            if api_key.is_empty() {
                return Err("OpenRouter model discovery requires an API key".into());
            }
            let url = join_validation_url(validate_provider_endpoint(&endpoint)?, "models")?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "ollama" => {
            let url = join_validation_url(validate_ollama_endpoint(&endpoint)?, "api/tags")?;
            validation_request_spec(url, None).await
        }
        _ => Err(format!(
            "Live model discovery is not supported for provider {provider}"
        )),
    }
}

async fn fetch_live_provider_models(
    provider: &str,
    config: &CliConfig,
) -> Result<Vec<ModelInfo>, String> {
    let spec = build_provider_models_request(provider, config).await?;
    let mut client_builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some((domain, addrs)) = &spec.dns_override {
        client_builder = client_builder.resolve_to_addrs(domain, addrs);
    }

    let client = client_builder.build().map_err(|err| err.to_string())?;
    let mut request = client
        .request(spec.method.clone(), spec.url)
        .timeout(VALIDATION_TIMEOUT);
    if let Some((header_name, header_value)) = spec.auth_header {
        request = request.header(header_name, header_value);
    }
    for (header_name, header_value) in spec.extra_headers {
        request = request.header(header_name, header_value);
    }

    let value = request
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let models = parse_provider_models_response(provider, value);
    if models.is_empty() {
        return Err(format!("No live models found for provider {provider}"));
    }

    Ok(dedupe_model_infos(models))
}

#[derive(Debug)]
enum CustomProviderProbeBuildError {
    Unsupported(String),
    Failed(String),
}

fn custom_provider_probe_response(
    status: CustomProviderProbeStatus,
    valid: bool,
    message: impl Into<String>,
    models: Vec<ModelInfo>,
) -> ResponseJson<ApiResponse<CustomProviderProbeResponse>> {
    ResponseJson(ApiResponse::success(CustomProviderProbeResponse {
        status,
        valid,
        message: message.into(),
        models,
    }))
}

fn non_empty_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn saved_custom_provider_entry<'a>(
    config: &'a CliConfig,
    id: &str,
) -> Option<&'a CustomProviderEntry> {
    let id = id.trim();
    if id.is_empty() {
        return None;
    }
    config
        .provider
        .custom_providers
        .as_ref()
        .and_then(|providers| providers.get(id))
}

fn saved_custom_provider_api_key_for_endpoint(
    config: &CliConfig,
    endpoint: Option<&str>,
) -> Option<String> {
    let endpoint = endpoint?.trim();
    if endpoint.is_empty() {
        return None;
    }
    config
        .provider
        .custom_providers
        .as_ref()?
        .values()
        .find(|entry| {
            entry
                .options
                .base_url
                .as_deref()
                .map(str::trim)
                .is_some_and(|base_url| base_url == endpoint)
        })
        .and_then(|entry| normalize_validation_api_key(entry.options.api_key.as_deref()))
}

fn resolve_provider_validation_api_key(
    provider: &str,
    req: &ValidateProviderRequest,
    request_api_key: Option<String>,
    stored_config: Option<&CliConfig>,
) -> String {
    if provider == "custom" {
        request_api_key
            .or_else(|| {
                stored_config.and_then(|config| {
                    saved_custom_provider_api_key_for_endpoint(config, req.endpoint.as_deref())
                })
            })
            .or_else(|| stored_config.and_then(|config| saved_provider_api_key(config, provider)))
            .unwrap_or_default()
    } else {
        request_api_key
            .or_else(|| stored_config.and_then(|config| saved_provider_api_key(config, provider)))
            .unwrap_or_default()
    }
}

fn resolve_custom_provider_npm(
    req: &CustomProviderProbeRequest,
    saved_entry: Option<&CustomProviderEntry>,
) -> String {
    non_empty_trimmed(req.npm.as_deref())
        .or_else(|| saved_entry.and_then(|entry| non_empty_trimmed(entry.npm.as_deref())))
        .unwrap_or_else(|| DEFAULT_CUSTOM_PROVIDER_NPM.to_string())
}

fn resolve_custom_provider_base_url(
    req: &CustomProviderProbeRequest,
    saved_entry: Option<&CustomProviderEntry>,
) -> Option<String> {
    non_empty_trimmed(req.options.base_url.as_deref()).or_else(|| {
        saved_entry.and_then(|entry| non_empty_trimmed(entry.options.base_url.as_deref()))
    })
}

fn resolve_custom_provider_api_key(
    req: &CustomProviderProbeRequest,
    saved_entry: Option<&CustomProviderEntry>,
) -> Option<String> {
    normalize_validation_api_key(req.options.api_key.as_deref()).or_else(|| {
        saved_entry.and_then(|entry| normalize_validation_api_key(entry.options.api_key.as_deref()))
    })
}

fn custom_provider_auth_header(
    protocol: CustomProviderProtocol,
    api_key: String,
) -> (&'static str, String) {
    match protocol {
        CustomProviderProtocol::OpenAiCompatible => ("Authorization", format!("Bearer {api_key}")),
        CustomProviderProtocol::Anthropic => ("x-api-key", api_key),
        CustomProviderProtocol::Google => ("x-goog-api-key", api_key),
    }
}

fn custom_provider_extra_headers(protocol: CustomProviderProtocol) -> Vec<(&'static str, String)> {
    match protocol {
        CustomProviderProtocol::Anthropic => {
            vec![("anthropic-version", "2023-06-01".to_string())]
        }
        _ => Vec::new(),
    }
}

fn custom_provider_http_error_message(status: http::StatusCode) -> String {
    match status {
        http::StatusCode::UNAUTHORIZED | http::StatusCode::FORBIDDEN => {
            "Authentication failed. Check the API key and SDK authentication requirements."
                .to_string()
        }
        http::StatusCode::NOT_FOUND => {
            "Base URL may not match the selected SDK protocol.".to_string()
        }
        http::StatusCode::METHOD_NOT_ALLOWED => {
            "Endpoint is reachable, but this URL does not support the selected SDK operation."
                .to_string()
        }
        _ => format!("API returned status {status}"),
    }
}

fn custom_provider_model_id(req: &CustomProviderProbeRequest) -> Option<String> {
    non_empty_trimmed(req.model_id.as_deref())
}

fn custom_provider_google_model_path(model_id: &str) -> String {
    model_id
        .trim()
        .strip_prefix("models/")
        .unwrap_or_else(|| model_id.trim())
        .replace('/', "%2F")
}

async fn build_custom_provider_models_request(
    req: &CustomProviderProbeRequest,
    config: &CliConfig,
) -> Result<(CustomProviderProtocol, ValidationRequestSpec), CustomProviderProbeBuildError> {
    let saved_entry = saved_custom_provider_entry(config, &req.id);
    let npm = resolve_custom_provider_npm(req, saved_entry);
    let Some(protocol) = custom_provider_protocol_from_npm(Some(&npm)) else {
        return Err(CustomProviderProbeBuildError::Unsupported(format!(
            "SDK package '{npm}' does not support automatic model discovery or validation yet."
        )));
    };
    let base_url = resolve_custom_provider_base_url(req, saved_entry).ok_or_else(|| {
        CustomProviderProbeBuildError::Failed("Custom provider requires a baseURL.".to_string())
    })?;
    let api_key = resolve_custom_provider_api_key(req, saved_entry).ok_or_else(|| {
        CustomProviderProbeBuildError::Failed(
            "API key is required. Saved provider credentials were not found for this provider id."
                .to_string(),
        )
    })?;

    let relative_path = match protocol {
        CustomProviderProtocol::OpenAiCompatible => "models",
        CustomProviderProtocol::Anthropic => "v1/models",
        CustomProviderProtocol::Google => "v1beta/models",
    };
    let base_url =
        validate_provider_endpoint(&base_url).map_err(CustomProviderProbeBuildError::Failed)?;
    let url = join_validation_url(base_url, relative_path)
        .map_err(CustomProviderProbeBuildError::Failed)?;
    validation_request_spec_with_extra_headers(
        url,
        Some(custom_provider_auth_header(protocol, api_key)),
        custom_provider_extra_headers(protocol),
    )
    .await
    .map(|spec| (protocol, spec))
    .map_err(CustomProviderProbeBuildError::Failed)
}

async fn build_custom_provider_model_validation_request(
    req: &CustomProviderProbeRequest,
    config: &CliConfig,
    model_id: &str,
) -> Result<ValidationRequestSpec, CustomProviderProbeBuildError> {
    let saved_entry = saved_custom_provider_entry(config, &req.id);
    let npm = resolve_custom_provider_npm(req, saved_entry);
    let Some(protocol) = custom_provider_protocol_from_npm(Some(&npm)) else {
        return Err(CustomProviderProbeBuildError::Unsupported(format!(
            "SDK package '{npm}' does not support automatic model discovery or validation yet."
        )));
    };
    let base_url = resolve_custom_provider_base_url(req, saved_entry).ok_or_else(|| {
        CustomProviderProbeBuildError::Failed("Custom provider requires a baseURL.".to_string())
    })?;
    let api_key = resolve_custom_provider_api_key(req, saved_entry).ok_or_else(|| {
        CustomProviderProbeBuildError::Failed(
            "API key is required. Saved provider credentials were not found for this provider id."
                .to_string(),
        )
    })?;

    let base_url =
        validate_provider_endpoint(&base_url).map_err(CustomProviderProbeBuildError::Failed)?;
    match protocol {
        CustomProviderProtocol::OpenAiCompatible => {
            let url = join_validation_url(base_url, "chat/completions")
                .map_err(CustomProviderProbeBuildError::Failed)?;
            validation_post_request_spec_with_extra_headers(
                url,
                Some(custom_provider_auth_header(protocol, api_key)),
                custom_provider_extra_headers(protocol),
                json!({
                    "model": model_id,
                    "max_tokens": 1,
                    "messages": [{
                        "role": "user",
                        "content": "ping"
                    }]
                }),
            )
            .await
        }
        CustomProviderProtocol::Anthropic => {
            let url = join_validation_url(base_url, "v1/messages")
                .map_err(CustomProviderProbeBuildError::Failed)?;
            validation_post_request_spec_with_extra_headers(
                url,
                Some(custom_provider_auth_header(protocol, api_key)),
                custom_provider_extra_headers(protocol),
                json!({
                    "model": model_id,
                    "max_tokens": 1,
                    "messages": [{
                        "role": "user",
                        "content": "ping"
                    }]
                }),
            )
            .await
        }
        CustomProviderProtocol::Google => {
            let relative_path = format!(
                "v1beta/models/{}:generateContent",
                custom_provider_google_model_path(model_id)
            );
            let url = join_validation_url(base_url, &relative_path)
                .map_err(CustomProviderProbeBuildError::Failed)?;
            validation_post_request_spec_with_extra_headers(
                url,
                Some(custom_provider_auth_header(protocol, api_key)),
                custom_provider_extra_headers(protocol),
                json!({
                    "contents": [{
                        "role": "user",
                        "parts": [{ "text": "ping" }]
                    }]
                }),
            )
            .await
        }
    }
    .map_err(CustomProviderProbeBuildError::Failed)
}

async fn send_validation_request(spec: ValidationRequestSpec) -> Result<reqwest::Response, String> {
    let mut client_builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some((domain, addrs)) = &spec.dns_override {
        client_builder = client_builder.resolve_to_addrs(domain, addrs);
    }

    let client = client_builder.build().map_err(|err| err.to_string())?;
    let mut request = client
        .request(spec.method, spec.url)
        .timeout(VALIDATION_TIMEOUT);
    if let Some((header_name, header_value)) = spec.auth_header {
        request = request.header(header_name, header_value);
    }
    for (header_name, header_value) in spec.extra_headers {
        request = request.header(header_name, header_value);
    }
    if let Some(json_body) = spec.json_body {
        request = request.json(&json_body);
    }

    request.send().await.map_err(|err| err.to_string())
}

fn custom_provider_build_error_response(
    err: CustomProviderProbeBuildError,
) -> ResponseJson<ApiResponse<CustomProviderProbeResponse>> {
    match err {
        CustomProviderProbeBuildError::Unsupported(message) => custom_provider_probe_response(
            CustomProviderProbeStatus::Unsupported,
            false,
            message,
            Vec::new(),
        ),
        CustomProviderProbeBuildError::Failed(message) => custom_provider_probe_response(
            CustomProviderProbeStatus::Failed,
            false,
            message,
            Vec::new(),
        ),
    }
}

async fn list_custom_provider_draft_models(
    Json(req): Json<CustomProviderProbeRequest>,
) -> ResponseJson<ApiResponse<CustomProviderProbeResponse>> {
    let config = read_cli_config_from_disk().await;
    let (protocol, spec) = match build_custom_provider_models_request(&req, &config).await {
        Ok(built) => built,
        Err(err) => return custom_provider_build_error_response(err),
    };

    let resp = match send_validation_request(spec).await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::warn!(%err, "custom provider model discovery request failed");
            return custom_provider_probe_response(
                CustomProviderProbeStatus::Failed,
                false,
                VALIDATION_CONNECTION_FAILED_MESSAGE,
                Vec::new(),
            );
        }
    };

    let status = resp.status();
    if !status.is_success() {
        return custom_provider_probe_response(
            CustomProviderProbeStatus::Failed,
            false,
            custom_provider_http_error_message(status),
            Vec::new(),
        );
    }

    let value = match resp.json::<Value>().await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(%err, "custom provider model discovery returned invalid JSON");
            return custom_provider_probe_response(
                CustomProviderProbeStatus::Failed,
                false,
                "Model list response was not valid JSON.",
                Vec::new(),
            );
        }
    };
    let models = dedupe_model_infos(parse_custom_provider_models_response(protocol, value));
    if models.is_empty() {
        return custom_provider_probe_response(
            CustomProviderProbeStatus::Failed,
            false,
            "No models were returned by this provider.",
            Vec::new(),
        );
    }

    custom_provider_probe_response(
        CustomProviderProbeStatus::Success,
        true,
        "Models discovered successfully.",
        models,
    )
}

async fn validate_custom_provider_draft(
    Json(req): Json<CustomProviderProbeRequest>,
) -> ResponseJson<ApiResponse<CustomProviderProbeResponse>> {
    let config = read_cli_config_from_disk().await;
    let is_model_validation = custom_provider_model_id(&req).is_some();
    let spec = if let Some(model_id) = custom_provider_model_id(&req) {
        match build_custom_provider_model_validation_request(&req, &config, &model_id).await {
            Ok(spec) => spec,
            Err(err) => return custom_provider_build_error_response(err),
        }
    } else {
        match build_custom_provider_models_request(&req, &config).await {
            Ok((_protocol, spec)) => spec,
            Err(err) => return custom_provider_build_error_response(err),
        }
    };

    let resp = match send_validation_request(spec).await {
        Ok(resp) => resp,
        Err(err) => {
            tracing::warn!(%err, "custom provider validation request failed");
            return custom_provider_probe_response(
                CustomProviderProbeStatus::Failed,
                false,
                VALIDATION_CONNECTION_FAILED_MESSAGE,
                Vec::new(),
            );
        }
    };

    let status = resp.status();
    if status.is_success() {
        return custom_provider_probe_response(
            CustomProviderProbeStatus::Success,
            true,
            "Connection successful.",
            Vec::new(),
        );
    }
    if status == http::StatusCode::METHOD_NOT_ALLOWED && !is_model_validation {
        return custom_provider_probe_response(
            CustomProviderProbeStatus::Success,
            true,
            "Endpoint is reachable, but this URL does not expose GET model listing.",
            Vec::new(),
        );
    }

    custom_provider_probe_response(
        CustomProviderProbeStatus::Failed,
        false,
        custom_provider_http_error_message(status),
        Vec::new(),
    )
}

fn validation_method_not_allowed_is_reachable(
    req: &ValidateProviderRequest,
    method: &http::Method,
    status: http::StatusCode,
) -> bool {
    status == http::StatusCode::METHOD_NOT_ALLOWED
        && method == http::Method::GET
        && req
            .endpoint
            .as_deref()
            .map(str::trim)
            .is_some_and(|endpoint| !endpoint.is_empty())
}

fn ensure_trailing_slash(url: &mut Url) {
    let path = url.path();
    if path.is_empty() {
        url.set_path("/");
    } else if !path.ends_with('/') {
        let next = format!("{path}/");
        url.set_path(&next);
    }
}

fn parse_endpoint_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw).map_err(|_| "Endpoint URL is invalid".to_string())?;

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Endpoint URL cannot include credentials".into());
    }

    if url.query().is_some() || url.fragment().is_some() {
        return Err("Endpoint URL cannot include query parameters or fragments".into());
    }

    if url.host().is_none() {
        return Err("Endpoint URL must include a host".into());
    }

    ensure_trailing_slash(&mut url);
    Ok(url)
}

fn validate_provider_endpoint(raw: &str) -> Result<Url, String> {
    let url = parse_endpoint_url(raw)?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Endpoint must use HTTP or HTTPS".into());
    }

    Ok(url)
}

fn validate_ollama_endpoint(raw: &str) -> Result<Url, String> {
    let url = parse_endpoint_url(raw)?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Ollama endpoint must use HTTP or HTTPS".into());
    }

    Ok(url)
}

async fn validate_custom_endpoint(raw: &str) -> Result<Url, String> {
    validate_provider_endpoint(raw)
}

async fn resolve_validation_host(url: &Url) -> Result<Option<(String, Vec<SocketAddr>)>, String> {
    let Some(host) = url.host() else {
        return Err("Endpoint URL must include a host".into());
    };

    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Endpoint URL must include a valid port".to_string())?;

    match host {
        Host::Domain(domain) => {
            let addrs = tokio::net::lookup_host((domain, port))
                .await
                .map_err(|_| "Endpoint host could not be resolved".to_string())?
                .collect::<Vec<_>>();

            if addrs.is_empty() {
                return Err("Endpoint host could not be resolved".into());
            }

            Ok(Some((domain.to_ascii_lowercase(), addrs)))
        }
        Host::Ipv4(_) => Ok(None),
        Host::Ipv6(_) => Ok(None),
    }
}

async fn validation_request_spec(
    url: Url,
    auth_header: Option<(&'static str, String)>,
) -> Result<ValidationRequestSpec, String> {
    validation_request_spec_with_extra_headers(url, auth_header, Vec::new()).await
}

async fn validation_request_spec_with_extra_headers(
    url: Url,
    auth_header: Option<(&'static str, String)>,
    extra_headers: Vec<(&'static str, String)>,
) -> Result<ValidationRequestSpec, String> {
    let dns_override = resolve_validation_host(&url).await?;
    Ok(ValidationRequestSpec {
        method: http::Method::GET,
        url,
        auth_header,
        extra_headers,
        dns_override,
        json_body: None,
    })
}

async fn validation_post_request_spec(
    url: Url,
    auth_header: Option<(&'static str, String)>,
    json_body: Value,
) -> Result<ValidationRequestSpec, String> {
    validation_post_request_spec_with_extra_headers(url, auth_header, Vec::new(), json_body).await
}

async fn validation_post_request_spec_with_extra_headers(
    url: Url,
    auth_header: Option<(&'static str, String)>,
    extra_headers: Vec<(&'static str, String)>,
    json_body: Value,
) -> Result<ValidationRequestSpec, String> {
    let dns_override = resolve_validation_host(&url).await?;
    Ok(ValidationRequestSpec {
        method: http::Method::POST,
        url,
        auth_header,
        extra_headers,
        dns_override,
        json_body: Some(json_body),
    })
}

fn join_validation_url(base: Url, relative_path: &str) -> Result<Url, String> {
    base.join(relative_path)
        .map_err(|_| "Failed to build provider validation request".to_string())
}

async fn build_validation_request(
    provider: &str,
    req: &ValidateProviderRequest,
    api_key: &str,
) -> Result<ValidationRequestSpec, String> {
    match provider {
        "anthropic" => {
            let url = join_validation_url(
                validate_provider_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_ANTHROPIC_ENDPOINT),
                )?,
                "v1/models",
            )?;
            validation_request_spec(url, Some(("x-api-key", api_key.to_string()))).await
        }
        "openai" => {
            tracing::debug!("openai matched");
            let url = join_validation_url(
                validate_provider_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OPENAI_ENDPOINT),
                )?,
                "models",
            )?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "google" => {
            let url = join_validation_url(
                validate_provider_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_GOOGLE_ENDPOINT),
                )?,
                "v1beta/models",
            )?;
            validation_request_spec(url, Some(("x-goog-api-key", api_key.to_string()))).await
        }
        "openrouter" => {
            let url = join_validation_url(
                validate_provider_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OPENROUTER_ENDPOINT),
                )?,
                "models",
            )?;
            validation_request_spec(url, Some(("Authorization", format!("Bearer {api_key}")))).await
        }
        "minimax" => {
            let url = join_validation_url(
                validate_provider_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_MINIMAX_ENDPOINT),
                )?,
                "messages",
            )?;
            validation_post_request_spec(
                url,
                Some(("Authorization", format!("Bearer {api_key}"))),
                json!({
                    "model": "MiniMax-M2.5",
                    "max_tokens": 1,
                    "messages": [{
                        "role": "user",
                        "content": "ping"
                    }]
                }),
            )
            .await
        }
        "ollama" => {
            let url = join_validation_url(
                validate_ollama_endpoint(
                    req.endpoint
                        .as_deref()
                        .filter(|endpoint| !endpoint.is_empty())
                        .unwrap_or(DEFAULT_OLLAMA_ENDPOINT),
                )?,
                "api/tags",
            )?;
            validation_request_spec(url, None).await
        }
        "custom" => {
            tracing::debug!("custom matched");
            let endpoint = req
                .endpoint
                .as_deref()
                .filter(|endpoint| !endpoint.is_empty())
                .ok_or_else(|| "Custom provider requires an endpoint URL".to_string())?;
            let url = join_validation_url(validate_custom_endpoint(endpoint).await?, "models")?;
            let auth_header = if api_key.is_empty() {
                None
            } else {
                Some(("Authorization", format!("Bearer {api_key}")))
            };
            validation_request_spec(url, auth_header).await
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

/// Validate provider credentials (basic connectivity check)
async fn validate_provider(
    Path(provider): Path<String>,
    Json(req): Json<ValidateProviderRequest>,
) -> ResponseJson<ApiResponse<ValidateProviderResponse>> {
    let request_api_key = normalize_validation_api_key(req.api_key.as_deref());
    let stored_config = if request_api_key.is_none() {
        Some(read_cli_config_from_disk().await)
    } else {
        None
    };
    tracing::debug!(
        provider =  ?provider,
        "provider"
    );
    let api_key = resolve_provider_validation_api_key(
        provider.as_str(),
        &req,
        request_api_key,
        stored_config.as_ref(),
    );

    // Providers that require an API key
    let requires_api_key = matches!(
        provider.as_str(),
        "anthropic" | "openai" | "google" | "openrouter" | "minimax"
    );
    if requires_api_key && api_key.is_empty() {
        return validation_result(false, "API key is required");
    }

    let spec = match build_validation_request(provider.as_str(), &req, &api_key).await {
        Ok(spec) => spec,
        Err(message) => return validation_result(false, message),
    };

    let mut client_builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if let Some((domain, addrs)) = &spec.dns_override {
        client_builder = client_builder.resolve_to_addrs(domain, addrs);
    }

    let client = match client_builder.build() {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!(provider = %provider, %err, "failed to build validation client");
            return validation_result(false, VALIDATION_CONNECTION_FAILED_MESSAGE);
        }
    };

    let mut request = client
        .request(spec.method.clone(), spec.url.clone())
        .timeout(VALIDATION_TIMEOUT);
    let request_method = spec.method.clone();
    if let Some((header_name, header_value)) = spec.auth_header {
        request = request.header(header_name, header_value);
    }
    for (header_name, header_value) in spec.extra_headers {
        request = request.header(header_name, header_value);
    }
    if let Some(json_body) = spec.json_body {
        request = request.json(&json_body);
    }

    match request.send().await {
        Ok(resp) if resp.status().is_success() => validation_result(true, "Connection successful"),
        Ok(resp) => {
            if validation_method_not_allowed_is_reachable(&req, &request_method, resp.status()) {
                return validation_result(
                    true,
                    "Endpoint is reachable, but this URL does not expose GET model listing.",
                );
            }
            tracing::warn!(
                provider = %provider,
                status = %resp.status(),
                "provider validation returned non-success status"
            );
            validation_result(false, format!("API returned status {}", resp.status()))
        }
        Err(err) => {
            tracing::warn!(
                provider = %provider,
                is_connect = err.is_connect(),
                is_timeout = err.is_timeout(),
                "provider validation request failed"
            );
            validation_result(false, VALIDATION_CONNECTION_FAILED_MESSAGE)
        }
    }
}

// ── CLI Config Helpers ───────────────────────────────────────────────

async fn read_cli_config_from_disk() -> CliConfig {
    try_read_cli_config_from_disk()
        .await
        .unwrap_or_else(|_| CliConfig::default_config())
}

async fn try_read_cli_config_from_disk()
-> Result<CliConfig, Box<dyn std::error::Error + Send + Sync>> {
    let path = CliConfig::config_path().ok_or("Cannot determine home directory")?;
    let content = fs::read_to_string(&path).await?;
    let mut config: CliConfig = toml::from_str(&content)?;
    normalize_custom_provider_entries(&mut config);
    Ok(config)
}

async fn write_cli_config_to_disk(
    config: &CliConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = CliConfig::config_path().ok_or("Cannot determine home directory")?;
    let mut normalized = config.clone();
    normalize_custom_provider_entries(&mut normalized);
    let content = toml::to_string_pretty(&normalized)?;
    write_secure_cli_config_file(path, content).await?;
    Ok(())
}

async fn write_secure_cli_config_file(
    path: PathBuf,
    content: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tokio::task::spawn_blocking(move || write_secure_cli_config_file_sync(&path, &content))
        .await
        .map_err(|err| -> Box<dyn std::error::Error + Send + Sync> { Box::new(err) })?
        .map_err(|err| -> Box<dyn std::error::Error + Send + Sync> { Box::new(err) })?;
    Ok(())
}

fn ensure_cli_config_parent_dir(path: &StdPath) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }

    Ok(())
}

fn set_cli_config_file_permissions(_path: &StdPath) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(_path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically(from: &StdPath, to: &StdPath) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};

    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let from_wide = from
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let to_wide = to
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();

    let result = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };

    if result == 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomically(from: &StdPath, to: &StdPath) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

fn write_secure_cli_config_file_sync(path: &StdPath, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_cli_config_parent_dir(parent)?;
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config.toml".to_string());

    let temp_path = path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| -> std::io::Result<()> {
        let file = {
            let mut opts = std::fs::OpenOptions::new();
            opts.create_new(true).write(true);

            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }

            opts.open(&temp_path)?
        };

        use std::io::Write;
        let mut file = file;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        set_cli_config_file_permissions(&temp_path)?;
        Ok(())
    })();

    if let Err(err) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err);
    }

    if let Err(err) = replace_file_atomically(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(err);
    }

    set_cli_config_file_permissions(path)?;

    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)?.sync_all()?;
    }

    Ok(())
}

/// Mask an API key: show first 6 and last 4 chars, replace middle with ***
fn mask_key(key: &str) -> String {
    if key.len() <= 10 {
        return "***".to_string();
    }
    format!("{}***{}", &key[..6], &key[key.len() - 4..])
}

fn mask_api_keys(mut config: CliConfig) -> CliConfig {
    fn mask_provider_key(key: &mut Option<String>) {
        if let Some(k) = key.as_ref() {
            *key = Some(mask_key(k));
        }
    }

    if let Some(p) = config.provider.anthropic.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.openai.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.google.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.openrouter.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.minimax.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(p) = config.provider.custom.as_mut() {
        mask_provider_key(&mut p.api_key);
    }
    if let Some(providers) = config.provider.custom_providers.as_mut() {
        for entry in providers.values_mut() {
            mask_custom_provider_key(entry);
        }
    }
    config
}

/// If user sends a masked key back (contains "***"), keep the old real key
fn merge_masked_keys(new_config: &mut CliConfig, old_config: &CliConfig) {
    fn keep_old_if_masked(new_key: &mut Option<String>, old_key: &Option<String>) {
        if let (Some(nk), Some(ok)) = (new_key.as_ref(), old_key.as_ref())
            && nk.contains("***")
        {
            *new_key = Some(ok.clone());
        }
    }

    if let (Some(np), Some(op)) = (
        new_config.provider.anthropic.as_mut(),
        old_config.provider.anthropic.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.openai.as_mut(),
        old_config.provider.openai.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.google.as_mut(),
        old_config.provider.google.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.openrouter.as_mut(),
        old_config.provider.openrouter.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.minimax.as_mut(),
        old_config.provider.minimax.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(np), Some(op)) = (
        new_config.provider.custom.as_mut(),
        old_config.provider.custom.as_ref(),
    ) {
        keep_old_if_masked(&mut np.api_key, &op.api_key);
    }
    if let (Some(new_providers), Some(old_providers)) = (
        new_config.provider.custom_providers.as_mut(),
        old_config.provider.custom_providers.as_ref(),
    ) {
        for (id, new_entry) in new_providers.iter_mut() {
            if let Some(old_entry) = old_providers.get(id) {
                keep_old_if_masked(&mut new_entry.options.api_key, &old_entry.options.api_key);
            }
        }
    }
}
