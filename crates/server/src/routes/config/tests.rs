#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn temp_test_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openteams-config-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("failed to create temp test dir");
        dir.join(name)
    }

    #[tokio::test]
    async fn google_validation_request_keeps_api_key_out_of_url() {
        let req = ValidateProviderRequest {
            api_key: Some("secret-key".into()),
            endpoint: None,
        };

        let spec = build_validation_request("google", &req, "secret-key")
            .await
            .expect("expected validation request");

        assert_eq!(
            spec.url.as_str(),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
        assert_eq!(
            spec.auth_header,
            Some(("x-goog-api-key", "secret-key".to_string()))
        );
        assert!(spec.url.query().is_none());
    }

    #[tokio::test]
    async fn minimax_validation_request_uses_messages_endpoint() {
        let req = ValidateProviderRequest {
            api_key: Some("secret-key".into()),
            endpoint: None,
        };

        let spec = build_validation_request("minimax", &req, "secret-key")
            .await
            .expect("expected validation request");

        assert_eq!(spec.method, http::Method::POST);
        assert_eq!(
            spec.url.as_str(),
            "https://api.minimaxi.com/anthropic/v1/messages"
        );
        assert_eq!(
            spec.auth_header,
            Some(("Authorization", "Bearer secret-key".to_string()))
        );
        assert_eq!(
            spec.json_body,
            Some(json!({
                "model": "MiniMax-M2.5",
                "max_tokens": 1,
                "messages": [{
                    "role": "user",
                    "content": "ping"
                }]
            }))
        );
    }

    #[test]
    fn provider_validation_allows_http_endpoint() {
        let url = validate_provider_endpoint("http://api.openai.com/v1")
            .expect("expected provider http endpoint to be accepted");

        assert_eq!(url.as_str(), "http://api.openai.com/v1/");
    }

    #[test]
    fn provider_validation_allows_custom_host_and_port() {
        let url = validate_provider_endpoint("http://proxy.local:8080/v1")
            .expect("expected custom host and port to be accepted");

        assert_eq!(url.as_str(), "http://proxy.local:8080/v1/");
    }

    #[tokio::test]
    async fn custom_validation_allows_private_ip_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("https://127.0.0.1:8443/".into()),
        };

        let spec = build_validation_request("custom", &req, "")
            .await
            .expect("expected custom endpoint to be accepted");

        assert_eq!(spec.url.as_str(), "https://127.0.0.1:8443/models");
        assert!(spec.dns_override.is_none());
    }

    #[tokio::test]
    async fn custom_validation_allows_http_private_ip_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("http://127.0.0.1:8080/v1".into()),
        };

        let spec = build_validation_request("custom", &req, "")
            .await
            .expect("expected custom http endpoint to be accepted");

        assert_eq!(spec.url.as_str(), "http://127.0.0.1:8080/v1/models");
        assert!(spec.dns_override.is_none());
    }

    #[tokio::test]
    async fn custom_validation_allows_localhost_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("https://localhost:8443/".into()),
        };

        let spec = build_validation_request("custom", &req, "")
            .await
            .expect("expected localhost custom endpoint to be accepted");

        let (host, addrs) = spec
            .dns_override
            .expect("localhost should still resolve to concrete addresses");
        assert_eq!(host, "localhost");
        assert!(!addrs.is_empty());
    }

    #[tokio::test]
    async fn ollama_validation_allows_private_ip_endpoints() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("http://192.168.1.10:11434/".into()),
        };

        let spec = build_validation_request("ollama", &req, "")
            .await
            .expect("expected private ollama endpoint to be accepted");

        assert_eq!(spec.url.as_str(), "http://192.168.1.10:11434/api/tags");
        assert!(spec.dns_override.is_none());
    }

    #[tokio::test]
    async fn ollama_validation_request_pins_loopback_resolution() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("http://localhost:11434/".into()),
        };

        let spec = build_validation_request("ollama", &req, "")
            .await
            .expect("expected validation request");

        let (host, addrs) = spec
            .dns_override
            .expect("localhost should be pinned to resolved loopback addresses");
        assert_eq!(host, "localhost");
        assert!(!addrs.is_empty());
        assert!(addrs.iter().all(|addr| addr.ip().is_loopback()));
    }

    #[test]
    fn saved_provider_api_key_reuses_stored_secret_when_request_key_is_masked() {
        let mut config = CliConfig::default_config();
        config.provider.anthropic = Some(services::services::cli_config::ProviderCredentials {
            api_key: Some("live-secret".into()),
            endpoint: None,
        });

        let request_key = normalize_validation_api_key(Some("live***cret"));
        let resolved = request_key.or_else(|| saved_provider_api_key(&config, "anthropic"));

        assert_eq!(resolved.as_deref(), Some("live-secret"));
    }

    #[test]
    fn saved_provider_api_key_reads_minimax_credentials() {
        let mut config = CliConfig::default_config();
        config.provider.minimax = Some(services::services::cli_config::ProviderCredentials {
            api_key: Some("mini-secret".into()),
            endpoint: Some(DEFAULT_MINIMAX_ENDPOINT.into()),
        });

        assert_eq!(
            saved_provider_api_key(&config, "minimax").as_deref(),
            Some("mini-secret")
        );
    }

    fn custom_probe_request(
        npm: &str,
        base_url: Option<&str>,
        api_key: Option<&str>,
        model_id: Option<&str>,
    ) -> CustomProviderProbeRequest {
        CustomProviderProbeRequest {
            id: "draft-provider".into(),
            npm: Some(npm.into()),
            options: CustomProviderOptions {
                base_url: base_url.map(str::to_string),
                api_key: api_key.map(str::to_string),
                timeout: None,
            },
            model_id: model_id.map(str::to_string),
        }
    }

    #[test]
    fn custom_provider_protocol_maps_supported_sdks_and_rejects_unknown() {
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/openai-compatible")),
            Some(CustomProviderProtocol::OpenAiCompatible)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/openai")),
            Some(CustomProviderProtocol::OpenAiCompatible)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@openrouter/ai-sdk-provider")),
            Some(CustomProviderProtocol::OpenAiCompatible)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/groq")),
            Some(CustomProviderProtocol::OpenAiCompatible)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/anthropic")),
            Some(CustomProviderProtocol::Anthropic)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/google")),
            Some(CustomProviderProtocol::Google)
        );
        assert_eq!(
            custom_provider_protocol_from_npm(Some("@ai-sdk/azure")),
            None
        );
    }

    #[tokio::test]
    async fn custom_provider_models_request_uses_openai_compatible_protocol() {
        let config = CliConfig::default_config();
        let req = custom_probe_request(
            "@ai-sdk/openai-compatible",
            Some("http://127.0.0.1:8080/v1"),
            Some("secret-key"),
            None,
        );

        let (protocol, spec) = build_custom_provider_models_request(&req, &config)
            .await
            .expect("expected custom model discovery request");

        assert_eq!(protocol, CustomProviderProtocol::OpenAiCompatible);
        assert_eq!(spec.method, http::Method::GET);
        assert_eq!(spec.url.as_str(), "http://127.0.0.1:8080/v1/models");
        assert_eq!(
            spec.auth_header,
            Some(("Authorization", "Bearer secret-key".to_string()))
        );
    }

    #[tokio::test]
    async fn custom_provider_model_validation_builds_protocol_specific_requests() {
        let config = CliConfig::default_config();
        let openai_req = custom_probe_request(
            "@ai-sdk/openai",
            Some("http://127.0.0.1:8080/v1"),
            Some("openai-secret"),
            Some("gpt-test"),
        );
        let anthropic_req = custom_probe_request(
            "@ai-sdk/anthropic",
            Some("http://127.0.0.1:8081"),
            Some("anthropic-secret"),
            Some("claude-test"),
        );
        let google_req = custom_probe_request(
            "@ai-sdk/google",
            Some("http://127.0.0.1:8082"),
            Some("google-secret"),
            Some("models/gemini-test"),
        );

        let openai_spec =
            build_custom_provider_model_validation_request(&openai_req, &config, "gpt-test")
                .await
                .expect("expected openai model validation request");
        assert_eq!(openai_spec.method, http::Method::POST);
        assert_eq!(
            openai_spec.url.as_str(),
            "http://127.0.0.1:8080/v1/chat/completions"
        );
        assert_eq!(
            openai_spec.auth_header,
            Some(("Authorization", "Bearer openai-secret".to_string()))
        );

        let anthropic_spec =
            build_custom_provider_model_validation_request(&anthropic_req, &config, "claude-test")
                .await
                .expect("expected anthropic model validation request");
        assert_eq!(anthropic_spec.method, http::Method::POST);
        assert_eq!(
            anthropic_spec.url.as_str(),
            "http://127.0.0.1:8081/v1/messages"
        );
        assert_eq!(
            anthropic_spec.auth_header,
            Some(("x-api-key", "anthropic-secret".to_string()))
        );
        assert_eq!(
            anthropic_spec.extra_headers,
            vec![("anthropic-version", "2023-06-01".to_string())]
        );

        let google_spec = build_custom_provider_model_validation_request(
            &google_req,
            &config,
            "models/gemini-test",
        )
        .await
        .expect("expected google model validation request");
        assert_eq!(google_spec.method, http::Method::POST);
        assert_eq!(
            google_spec.url.as_str(),
            "http://127.0.0.1:8082/v1beta/models/gemini-test:generateContent"
        );
        assert_eq!(
            google_spec.auth_header,
            Some(("x-goog-api-key", "google-secret".to_string()))
        );
    }

    #[tokio::test]
    async fn custom_provider_probe_falls_back_to_saved_key_when_request_key_is_masked() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "draft-provider".to_string(),
            CustomProviderEntry {
                id: "draft-provider".into(),
                name: Some("Draft Provider".into()),
                npm: Some("@ai-sdk/openai-compatible".into()),
                options: CustomProviderOptions {
                    base_url: Some("http://127.0.0.1:8090/v1".into()),
                    api_key: Some("saved-secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));
        let req = CustomProviderProbeRequest {
            id: "draft-provider".into(),
            npm: Some("@ai-sdk/openai-compatible".into()),
            options: CustomProviderOptions {
                base_url: Some("http://127.0.0.1:8090/v1".into()),
                api_key: Some("save***cret".into()),
                timeout: None,
            },
            model_id: None,
        };

        let (_protocol, spec) = build_custom_provider_models_request(&req, &config)
            .await
            .expect("expected request to use saved credentials");

        assert_eq!(
            spec.auth_header,
            Some(("Authorization", "Bearer saved-secret".to_string()))
        );
    }

    #[test]
    fn legacy_custom_validate_can_find_saved_custom_provider_key_by_endpoint() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "proxy".to_string(),
            CustomProviderEntry {
                id: "proxy".into(),
                name: Some("Proxy".into()),
                npm: Some("@ai-sdk/openai-compatible".into()),
                options: CustomProviderOptions {
                    base_url: Some("https://proxy.example.com/v1".into()),
                    api_key: Some("stored-secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));

        assert_eq!(
            saved_custom_provider_api_key_for_endpoint(
                &config,
                Some("https://proxy.example.com/v1")
            )
            .as_deref(),
            Some("stored-secret")
        );
    }

    #[test]
    fn legacy_custom_validate_prefers_endpoint_matched_custom_provider_key_over_legacy_key() {
        let mut config = CliConfig::default_config();
        config.provider.custom = Some(services::services::cli_config::CustomProviderConfig {
            name: Some("Legacy Custom".into()),
            endpoint: Some("https://legacy.example.com/v1".into()),
            api_key: Some("wrong-legacy-secret".into()),
        });
        config.provider.custom_providers = Some(HashMap::from([(
            "proxy".to_string(),
            CustomProviderEntry {
                id: "proxy".into(),
                name: Some("Proxy".into()),
                npm: Some("@ai-sdk/openai-compatible".into()),
                options: CustomProviderOptions {
                    base_url: Some("https://proxy.example.com/v1".into()),
                    api_key: Some("matched-provider-secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));
        let req = ValidateProviderRequest {
            api_key: Some("match***cret".into()),
            endpoint: Some("https://proxy.example.com/v1".into()),
        };

        let resolved = resolve_provider_validation_api_key(
            "custom",
            &req,
            normalize_validation_api_key(req.api_key.as_deref()),
            Some(&config),
        );

        assert_eq!(resolved, "matched-provider-secret");
    }

    #[test]
    fn custom_provider_model_parsers_cover_openai_anthropic_google_and_ollama_shapes() {
        let openai = parse_custom_provider_models_response(
            CustomProviderProtocol::OpenAiCompatible,
            json!({ "data": [{ "id": "gpt-test", "name": "GPT Test" }] }),
        );
        let anthropic = parse_custom_provider_models_response(
            CustomProviderProtocol::Anthropic,
            json!({ "data": [{ "id": "claude-test", "display_name": "Claude Test" }] }),
        );
        let google = parse_custom_provider_models_response(
            CustomProviderProtocol::Google,
            json!({ "models": [{ "name": "models/gemini-test", "displayName": "Gemini Test" }] }),
        );
        let ollama = parse_provider_models_response(
            "ollama",
            json!({ "models": [{ "model": "llama-test", "name": "Llama Test" }] }),
        );

        assert_eq!(openai[0].id, "gpt-test");
        assert_eq!(anthropic[0].name, "Claude Test");
        assert_eq!(google[0].id, "gemini-test");
        assert_eq!(ollama[0].id, "llama-test");
    }

    #[tokio::test]
    async fn custom_provider_probe_returns_unsupported_for_unknown_npm() {
        let config = CliConfig::default_config();
        let req = custom_probe_request(
            "@ai-sdk/azure",
            Some("http://127.0.0.1:8080/v1"),
            Some("secret-key"),
            None,
        );

        match build_custom_provider_models_request(&req, &config).await {
            Err(CustomProviderProbeBuildError::Unsupported(message)) => {
                assert!(message.contains("@ai-sdk/azure"));
            }
            _ => panic!("expected unsupported custom provider protocol"),
        }
    }

    #[test]
    fn custom_provider_http_errors_are_user_safe_and_specific() {
        assert!(
            custom_provider_http_error_message(http::StatusCode::UNAUTHORIZED)
                .contains("Authentication failed")
        );
        assert!(
            custom_provider_http_error_message(http::StatusCode::FORBIDDEN)
                .contains("Authentication failed")
        );
        assert!(
            custom_provider_http_error_message(http::StatusCode::NOT_FOUND)
                .contains("Base URL may not match")
        );
        assert!(
            custom_provider_http_error_message(http::StatusCode::METHOD_NOT_ALLOWED)
                .contains("Endpoint is reachable")
        );
        assert!(
            !custom_provider_http_error_message(http::StatusCode::UNAUTHORIZED).contains("secret")
        );
    }

    #[test]
    fn provider_model_listing_returns_error_when_live_and_catalog_sources_fail() {
        let result = resolve_provider_models_result(
            "openai",
            Err("live failed".into()),
            Err("catalog failed".into()),
        );

        let message = result.expect_err("model listing should fail without static fallback");
        assert!(message.contains("live failed"));
        assert!(message.contains("catalog failed"));
        assert!(!message.contains("gpt-5.4"));
    }

    #[test]
    fn method_not_allowed_on_custom_url_is_treated_as_reachable() {
        let req = ValidateProviderRequest {
            api_key: None,
            endpoint: Some("https://proxy.example.com/v1/".into()),
        };
        let spec = ValidationRequestSpec {
            method: http::Method::GET,
            url: Url::parse("https://proxy.example.com/v1/models").expect("valid url"),
            auth_header: None,
            extra_headers: Vec::new(),
            dns_override: None,
            json_body: None,
        };

        assert!(validation_method_not_allowed_is_reachable(
            &req,
            &spec.method,
            http::StatusCode::METHOD_NOT_ALLOWED,
        ));
    }

    #[test]
    fn normalize_custom_provider_entries_fixes_legacy_litellm_npm() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "litellm".to_string(),
            CustomProviderEntry {
                id: "litellm".into(),
                name: Some("LITELLM".into()),
                npm: Some(LEGACY_CUSTOM_PROVIDER_NPM.into()),
                options: services::services::cli_config::CustomProviderOptions {
                    base_url: Some("https://litellm.example.com/v1".into()),
                    api_key: Some("secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));

        normalize_custom_provider_entries(&mut config);

        assert_eq!(
            config
                .provider
                .custom_providers
                .as_ref()
                .and_then(|providers| providers.get("litellm"))
                .and_then(|provider| provider.npm.as_deref()),
            Some(DEFAULT_CUSTOM_PROVIDER_NPM)
        );
    }

    #[test]
    fn normalize_custom_provider_entries_keeps_non_litellm_anthropic_provider() {
        let mut config = CliConfig::default_config();
        config.provider.custom_providers = Some(HashMap::from([(
            "anthropic-proxy".to_string(),
            CustomProviderEntry {
                id: "anthropic-proxy".into(),
                name: Some("Anthropic Proxy".into()),
                npm: Some(LEGACY_CUSTOM_PROVIDER_NPM.into()),
                options: services::services::cli_config::CustomProviderOptions {
                    base_url: Some("https://api.anthropic.com".into()),
                    api_key: Some("secret".into()),
                    timeout: None,
                },
                models: None,
            },
        )]));

        normalize_custom_provider_entries(&mut config);

        assert_eq!(
            config
                .provider
                .custom_providers
                .as_ref()
                .and_then(|providers| providers.get("anthropic-proxy"))
                .and_then(|provider| provider.npm.as_deref()),
            Some(LEGACY_CUSTOM_PROVIDER_NPM)
        );
    }

    #[test]
    fn sync_requested_provider_to_cli_config_writes_builtin_provider_when_default_is_builtin() {
        let mut cli_config = OpenTeamsCliConfig::default();
        let mut app_config = CliConfig::default_config();
        app_config.provider.default = "anthropic".into();
        app_config.provider.anthropic = Some(services::services::cli_config::ProviderCredentials {
            api_key: Some("live-secret".into()),
            endpoint: Some(DEFAULT_ANTHROPIC_ENDPOINT.into()),
        });
        app_config.provider.custom = Some(services::services::cli_config::CustomProviderConfig {
            name: Some("Legacy Custom".into()),
            endpoint: Some("https://custom.example.com/v1".into()),
            api_key: Some("secret".into()),
        });

        sync_requested_provider_to_cli_config(&mut cli_config, &app_config, None);

        let providers = cli_config
            .provider
            .expect("builtin provider should be synced");
        let anthropic = providers
            .get("anthropic")
            .expect("anthropic provider should exist");
        assert_eq!(anthropic.npm, None);
        assert_eq!(anthropic.name, None);
        assert_eq!(
            anthropic
                .options
                .as_ref()
                .and_then(|options| options.api_key.as_deref()),
            Some("live-secret")
        );
        assert_eq!(
            anthropic
                .options
                .as_ref()
                .and_then(|options| options.base_url.as_deref()),
            Some(DEFAULT_ANTHROPIC_ENDPOINT)
        );
        assert!(!providers.contains_key("custom"));
    }

    fn build_test_openteams_cli_config(
        models: &[&str],
        default_model: Option<&str>,
    ) -> OpenTeamsCliConfig {
        OpenTeamsCliConfig {
            provider: Some(HashMap::from([(
                "litellm".to_string(),
                OpenTeamsCliProviderConfig {
                    npm: Some(DEFAULT_CUSTOM_PROVIDER_NPM.into()),
                    name: Some("LiteLLM".into()),
                    options: Some(OpenTeamsCliProviderOptions {
                        api_key: Some("secret".into()),
                        base_url: Some("https://litellm.example.com/v1".into()),
                        timeout: None,
                        chunk_timeout: None,
                        enterprise_url: None,
                        set_cache_key: None,
                    }),
                    models: Some(
                        models
                            .iter()
                            .map(|model_id| {
                                (
                                    (*model_id).to_string(),
                                    services::services::cli_config::OpenTeamsCliModelConfig {
                                        name: Some((*model_id).to_string()),
                                        modalities: None,
                                        options: None,
                                        limit: None,
                                        variants: None,
                                    },
                                )
                            })
                            .collect(),
                    ),
                    whitelist: None,
                    blacklist: None,
                },
            )])),
            model: default_model.map(str::to_string),
            ..OpenTeamsCliConfig::default()
        }
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_replaces_builtin_variants() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro"],
            Some("litellm/gpt-4o"),
        );

        let changed = sync_openteams_cli_models_into_profiles(&mut profiles, &cli_config);

        assert!(changed);

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        assert!(!executor_config.configurations.contains_key("PLAN"));
        assert!(!executor_config.configurations.contains_key("APPROVALS"));
        assert_eq!(executor_config.configurations.len(), 4);
        match executor_config
            .get_default()
            .expect("OpenTeams CLI default config should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(config.model, None);
                assert_eq!(config.variant, None);
                assert_eq!(config.agent, None);
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }

        let default_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");
        let gemini_variant_key = model_variant_key("litellm/gemini-2.5-pro");
        assert!(
            executor_config
                .configurations
                .contains_key(&default_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&gemini_variant_key)
        );

        match executor_config
            .configurations
            .get(&claude_variant_key)
            .expect("Claude variant should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(
                    config.model.as_deref(),
                    Some("litellm/claude-sonnet-4-20250514")
                );
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_keeps_generic_default_on_resync() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514"],
            Some("litellm/gpt-4o"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        assert!(!sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");

        match executor_config
            .get_default()
            .expect("OpenTeams CLI default config should exist")
        {
            executors::executors::CodingAgent::OpenTeamsCli(config) => {
                assert_eq!(config.model, None);
                assert_eq!(config.variant, None);
                assert_eq!(config.agent, None);
            }
            other => panic!("expected OpenTeams CLI config, got {other:?}"),
        }

        let gpt_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");
        assert!(
            executor_config
                .configurations
                .contains_key(&gpt_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_removes_deleted_custom_models() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let mut cli_config = build_test_openteams_cli_config(
            &["gpt-4o", "claude-sonnet-4-20250514"],
            Some("litellm/gpt-4o"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        cli_config
            .provider
            .as_mut()
            .and_then(|providers| providers.get_mut("litellm"))
            .and_then(|provider| provider.models.as_mut())
            .expect("custom provider models should exist")
            .remove("claude-sonnet-4-20250514");

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        let gpt_variant_key = model_variant_key("litellm/gpt-4o");
        let claude_variant_key = model_variant_key("litellm/claude-sonnet-4-20250514");

        assert!(
            executor_config
                .configurations
                .contains_key(&gpt_variant_key)
        );
        assert!(
            !executor_config
                .configurations
                .contains_key(&claude_variant_key)
        );
    }

    #[test]
    fn sync_openteams_cli_models_into_profiles_keeps_all_models_from_provider_map() {
        let mut profiles = ExecutorConfigs::from_defaults();
        let cli_config = build_test_openteams_cli_config(
            &["gpt-5.3-codex-2026-02-24", "gpt-5.4-2026-03-05"],
            Some("codingplane/glm-5"),
        );

        assert!(sync_openteams_cli_models_into_profiles(
            &mut profiles,
            &cli_config
        ));

        let executor_config = profiles
            .executors
            .get(&BaseCodingAgent::OpenTeamsCli)
            .expect("OpenTeams CLI executor should exist");
        let gpt53_variant_key = model_variant_key("litellm/gpt-5.3-codex-2026-02-24");
        let gpt54_variant_key = model_variant_key("litellm/gpt-5.4-2026-03-05");
        let default_variant_key = model_variant_key("codingplane/glm-5");

        assert!(
            executor_config
                .configurations
                .contains_key(&gpt53_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&gpt54_variant_key)
        );
        assert!(
            executor_config
                .configurations
                .contains_key(&default_variant_key)
        );
    }

    #[test]
    fn openteams_cli_provider_options_serialize_with_camel_case_keys() {
        let options = OpenTeamsCliProviderOptions {
            api_key: Some("secret".into()),
            base_url: Some("https://litellm.example.com/v1".into()),
            timeout: Some(30_000),
            chunk_timeout: Some(5_000),
            enterprise_url: Some("https://ghe.example.com".into()),
            set_cache_key: Some(true),
        };

        let value = serde_json::to_value(&options).expect("serialize provider options");

        assert_eq!(
            value,
            json!({
                "apiKey": "secret",
                "baseURL": "https://litellm.example.com/v1",
                "timeout": 30_000,
                "chunkTimeout": 5_000,
                "enterpriseUrl": "https://ghe.example.com",
                "setCacheKey": true,
            })
        );
    }

    #[test]
    fn openteams_cli_provider_options_deserialize_legacy_snake_case_keys() {
        let value = json!({
            "api_key": "secret",
            "baseURL": "https://litellm.example.com/v1",
            "chunk_timeout": 5_000,
            "enterprise_url": "https://ghe.example.com",
            "set_cache_key": true,
        });

        let options: OpenTeamsCliProviderOptions =
            serde_json::from_value(value).expect("deserialize provider options");

        assert_eq!(options.api_key.as_deref(), Some("secret"));
        assert_eq!(
            options.base_url.as_deref(),
            Some("https://litellm.example.com/v1")
        );
        assert_eq!(options.chunk_timeout, Some(5_000));
        assert_eq!(
            options.enterprise_url.as_deref(),
            Some("https://ghe.example.com")
        );
        assert_eq!(options.set_cache_key, Some(true));
    }

    #[test]
    fn parse_openteams_cli_config_content_accepts_trailing_commas() {
        let config = parse_openteams_cli_config_content(
            r#"{
  "provider": {
    "custom": {
      "npm": "@acme/provider",
    },
  },
  "model": "custom/foo",
}"#,
        )
        .expect("parse openteams cli config with trailing commas");

        assert_eq!(config.model.as_deref(), Some("custom/foo"));
        assert!(
            config
                .provider
                .as_ref()
                .is_some_and(|providers| providers.contains_key("custom"))
        );
    }

    #[test]
    fn parse_openteams_cli_config_content_accepts_jsonc_comments() {
        let config = parse_openteams_cli_config_content(
            r#"{
  // preferred provider
  "provider": {
    "custom": {
      "npm": "@acme/provider"
    }
  },
  "model": "custom/foo"
}"#,
        )
        .expect("parse openteams cli config with comments");

        assert_eq!(config.model.as_deref(), Some("custom/foo"));
    }

    #[test]
    fn write_secure_cli_config_file_sync_overwrites_atomically() {
        let path = temp_test_path("config.toml");
        let first = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &first).expect("first write should succeed");

        let mut updated = CliConfig::default_config();
        updated.provider.default = "openai".into();
        let second = toml::to_string_pretty(&updated).unwrap();
        write_secure_cli_config_file_sync(&path, &second).expect("second write should succeed");

        let persisted = std::fs::read_to_string(&path).expect("config should exist");
        let parsed: CliConfig = toml::from_str(&persisted).expect("config should parse");
        assert_eq!(parsed.provider.default, "openai");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn write_secure_cli_config_file_sync_uses_restricted_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_test_path("config.toml");
        let content = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &content).expect("write should succeed");

        let mode = std::fs::metadata(&path)
            .expect("config metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn write_secure_cli_config_file_sync_restricts_parent_directory_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_test_path("config.toml");
        let content = toml::to_string_pretty(&CliConfig::default_config()).unwrap();

        write_secure_cli_config_file_sync(&path, &content).expect("write should succeed");

        let dir_mode = std::fs::metadata(path.parent().unwrap())
            .expect("parent metadata should exist")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
