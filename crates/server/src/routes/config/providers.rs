#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub configured: bool,
}

/// List available providers with configuration status
async fn list_cli_providers(
    State(_deployment): State<DeploymentImpl>,
) -> ResponseJson<ApiResponse<Vec<ProviderInfo>>> {
    let config = read_cli_config_from_disk().await;
    let providers = vec![
        ProviderInfo {
            id: "anthropic".into(),
            name: "Anthropic".into(),
            configured: config
                .provider
                .anthropic
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "openai".into(),
            name: "OpenAI".into(),
            configured: config
                .provider
                .openai
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "google".into(),
            name: "Google".into(),
            configured: config
                .provider
                .google
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            configured: config
                .provider
                .openrouter
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "minimax".into(),
            name: "MiniMax".into(),
            configured: config
                .provider
                .minimax
                .as_ref()
                .and_then(|p| p.api_key.as_ref())
                .map(|k| !k.is_empty())
                .unwrap_or(false),
        },
        ProviderInfo {
            id: "ollama".into(),
            name: "Ollama".into(),
            configured: config.provider.ollama.is_some(),
        },
    ];
    ResponseJson(ApiResponse::success(providers))
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

fn dedupe_model_infos(models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    let mut seen = BTreeSet::new();
    models
        .into_iter()
        .filter(|model| seen.insert(model.id.clone()))
        .collect()
}

fn parse_openai_style_models(value: Value) -> Vec<ModelInfo> {
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            let name = model
                .get("name")
                .or_else(|| model.get("display_name"))
                .or_else(|| model.get("displayName"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(ModelInfo {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

fn parse_anthropic_models(value: Value) -> Vec<ModelInfo> {
    value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            let name = model
                .get("display_name")
                .or_else(|| model.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(ModelInfo {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

fn parse_google_models(value: Value) -> Vec<ModelInfo> {
    value
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let raw_id = model.get("name").and_then(Value::as_str)?.trim();
            let id = raw_id.strip_prefix("models/").unwrap_or(raw_id).trim();
            if id.is_empty() {
                return None;
            }
            let name = model
                .get("displayName")
                .or_else(|| model.get("display_name"))
                .or_else(|| model.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(ModelInfo {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

fn parse_ollama_models(value: Value) -> Vec<ModelInfo> {
    value
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model
                .get("model")
                .or_else(|| model.get("name"))
                .and_then(Value::as_str)?
                .trim();
            if id.is_empty() {
                return None;
            }
            let name = model
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id);
            Some(ModelInfo {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

fn parse_models_dev_models(value: Value, provider: &str) -> Vec<ModelInfo> {
    value
        .get(provider)
        .and_then(|entry| entry.get("models"))
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|models| models.iter())
        .map(|(id, model)| {
            let name = model
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or(id.as_str());
            ModelInfo {
                id: id.clone(),
                name: name.to_string(),
            }
        })
        .collect()
}

fn parse_provider_models_response(provider: &str, value: Value) -> Vec<ModelInfo> {
    match provider {
        "anthropic" => parse_anthropic_models(value),
        "google" => parse_google_models(value),
        "ollama" => parse_ollama_models(value),
        _ => parse_openai_style_models(value),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CustomProviderProtocol {
    OpenAiCompatible,
    Anthropic,
    Google,
}

impl CustomProviderProtocol {
    fn parser_provider(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
        }
    }
}

fn custom_provider_protocol_from_npm(npm: Option<&str>) -> Option<CustomProviderProtocol> {
    let npm = npm?.trim().to_ascii_lowercase();
    if npm.is_empty() {
        return None;
    }

    match npm.as_str() {
        "@ai-sdk/anthropic" => Some(CustomProviderProtocol::Anthropic),
        "@ai-sdk/google" => Some(CustomProviderProtocol::Google),
        "@ai-sdk/openai"
        | "@ai-sdk/openai-compatible"
        | "@ai-sdk/deepinfra"
        | "@ai-sdk/groq"
        | "@ai-sdk/perplexity"
        | "@ai-sdk/togetherai"
        | "@ai-sdk/xai"
        | "@openrouter/ai-sdk-provider" => Some(CustomProviderProtocol::OpenAiCompatible),
        _ if npm.contains("openrouter") => Some(CustomProviderProtocol::OpenAiCompatible),
        _ => None,
    }
}

fn parse_custom_provider_models_response(
    protocol: CustomProviderProtocol,
    value: Value,
) -> Vec<ModelInfo> {
    parse_provider_models_response(protocol.parser_provider(), value)
}

async fn fetch_models_dev_provider_models(provider: &str) -> Result<Vec<ModelInfo>, String> {
    let value = reqwest::Client::new()
        .get("https://models.dev/api.json")
        .timeout(VALIDATION_TIMEOUT)
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .json::<Value>()
        .await
        .map_err(|err| err.to_string())?;

    let models = parse_models_dev_models(value, provider);
    if models.is_empty() {
        return Err(format!("No models found for provider {provider}"));
    }

    Ok(dedupe_model_infos(models))
}

fn provider_models_failure_message(
    provider: &str,
    live_error: &str,
    catalog_error: &str,
) -> String {
    format!(
        "Failed to list models for provider {provider}: live discovery failed ({live_error}); models.dev lookup failed ({catalog_error})"
    )
}

fn resolve_provider_models_result(
    provider: &str,
    live_result: Result<Vec<ModelInfo>, String>,
    catalog_result: Result<Vec<ModelInfo>, String>,
) -> Result<Vec<ModelInfo>, String> {
    match live_result {
        Ok(models) => Ok(models),
        Err(live_error) => match catalog_result {
            Ok(models) => Ok(models),
            Err(catalog_error) => Err(provider_models_failure_message(
                provider,
                &live_error,
                &catalog_error,
            )),
        },
    }
}

/// List models for a specific provider
async fn list_provider_models(
    Path(provider): Path<String>,
) -> ResponseJson<ApiResponse<Vec<ModelInfo>>> {
    let config = read_cli_config_from_disk().await;
    let models = match fetch_live_provider_models(provider.as_str(), &config).await {
        Ok(models) => Ok(models),
        Err(live_error) => {
            let catalog_result = fetch_models_dev_provider_models(provider.as_str()).await;
            resolve_provider_models_result(provider.as_str(), Err(live_error), catalog_result)
        }
    };
    match models {
        Ok(models) => ResponseJson(ApiResponse::success(models)),
        Err(message) => ResponseJson(ApiResponse::error(&message)),
    }
}
