fn is_message_event_type(event_type: &str) -> bool {
    matches!(event_type, "message_send" | "first_message_sent")
}

fn resolve_analytics_user_id(
    requested_user_id: Option<String>,
    fallback_user_id: &str,
    event_type: &str,
) -> Option<String> {
    let requested_user_id = requested_user_id.and_then(|user_id| {
        let trimmed = user_id.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    });

    if requested_user_id.is_some() {
        return requested_user_id;
    }

    if is_message_event_type(event_type) {
        let trimmed = fallback_user_id.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

fn parse_event_category(value: &str) -> Option<AnalyticsEventCategory> {
    match value {
        "user_action" => Some(AnalyticsEventCategory::UserAction),
        "system" => Some(AnalyticsEventCategory::System),
        "conversion" => Some(AnalyticsEventCategory::Conversion),
        _ => None,
    }
}

fn parse_session_id(value: Option<&str>) -> Result<Option<Uuid>, &'static str> {
    match value {
        Some(raw) if !raw.is_empty() => Uuid::parse_str(raw)
            .map(Some)
            .map_err(|_| "Invalid session_id format"),
        _ => Ok(None),
    }
}

/// Track a single analytics event
pub async fn track_event(
    State(deployment): State<DeploymentImpl>,
    Json(req): Json<TrackEventRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    if !deployment.analytics_enabled() {
        return Ok(Json(ApiResponse::success("Analytics disabled".to_string())));
    }

    let pool = &deployment.db().pool;

    // Parse event category
    let event_category = parse_event_category(&req.event_category).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse::error(
                "Invalid event_category. Must be 'user_action', 'system', or 'conversion'",
            )),
        )
    })?;

    // Parse session_id if provided
    let session_id = parse_session_id(req.session_id.as_deref())
        .map_err(|message| (StatusCode::BAD_REQUEST, Json(ApiResponse::error(message))))?;

    let user_id = resolve_analytics_user_id(req.user_id, deployment.user_id(), &req.event_type);

    let create_event = CreateAnalyticsEvent {
        event_type: req.event_type,
        event_category,
        user_id,
        session_id,
        properties: req.properties,
        platform: req.platform,
        app_version: req.app_version,
        os: req.os,
        device_id: req.device_id,
    };

    match AnalyticsEvent::create(pool, &create_event, Uuid::new_v4()).await {
        Ok(event) => {
            forward_analytics_record_to_posthog(
                deployment.analytics().as_ref(),
                &event,
                "/analytics/events",
            );
            Ok(Json(ApiResponse::success("Event tracked".to_string())))
        }
        Err(e) => {
            tracing::error!("Failed to track analytics event: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Failed to track event")),
            ))
        }
    }
}

/// Track multiple analytics events in a batch
pub async fn track_events_batch(
    State(deployment): State<DeploymentImpl>,
    Json(req): Json<TrackEventsBatchRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    if !deployment.analytics_enabled() {
        return Ok(Json(ApiResponse::success("Analytics disabled".to_string())));
    }

    let pool = &deployment.db().pool;

    let mut events_to_create = Vec::with_capacity(req.events.len());

    for event_req in req.events {
        let Some(event_category) = parse_event_category(&event_req.event_category) else {
            continue;
        };

        let session_id = parse_session_id(event_req.session_id.as_deref())
            .ok()
            .flatten();
        let user_id = resolve_analytics_user_id(
            event_req.user_id,
            deployment.user_id(),
            &event_req.event_type,
        );

        events_to_create.push((
            Uuid::new_v4(),
            CreateAnalyticsEvent {
                event_type: event_req.event_type,
                event_category,
                user_id,
                session_id,
                properties: event_req.properties,
                platform: event_req.platform,
                app_version: event_req.app_version,
                os: event_req.os,
                device_id: event_req.device_id,
            },
        ));
    }

    match AnalyticsEvent::create_batch(pool, &events_to_create).await {
        Ok(events) => {
            for event in &events {
                forward_analytics_record_to_posthog(
                    deployment.analytics().as_ref(),
                    event,
                    "/analytics/events/batch",
                );
            }

            Ok(Json(ApiResponse::success(format!(
                "{} events tracked",
                events.len()
            ))))
        }
        Err(e) => {
            tracing::error!("Failed to track analytics events batch: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse::error("Failed to track events")),
            ))
        }
    }
}
