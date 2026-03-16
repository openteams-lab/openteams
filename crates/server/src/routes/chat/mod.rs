pub mod agents;
pub mod messages;
pub mod presets;
pub mod runs;
pub mod sessions;
pub mod skills;
pub mod work_items;

use axum::{Router, extract::DefaultBodyLimit, middleware::from_fn_with_state, routing::get};

use crate::{
    DeploymentImpl,
    middleware::{load_chat_agent_middleware, load_chat_session_middleware},
};

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let session_router = Router::new()
        .route(
            "/",
            get(sessions::get_session)
                .put(sessions::update_session)
                .delete(sessions::delete_session),
        )
        .route("/archive", axum::routing::post(sessions::archive_session))
        .route("/restore", axum::routing::post(sessions::restore_session))
        .route("/stream", get(sessions::stream_session_ws))
        .route(
            "/agents",
            get(sessions::get_session_agents).post(sessions::create_session_agent),
        )
        .route(
            "/agents/{session_agent_id}",
            axum::routing::put(sessions::update_session_agent)
                .delete(sessions::delete_session_agent),
        )
        .route(
            "/agents/{session_agent_id}/stop",
            axum::routing::post(sessions::stop_session_agent),
        )
        .route(
            "/messages",
            get(messages::get_messages).post(messages::create_message),
        )
        .route("/work-items", get(work_items::get_work_items))
        .route(
            "/messages/batch-delete",
            axum::routing::post(messages::delete_messages_batch),
        )
        .route(
            "/messages/upload",
            axum::routing::post(messages::upload_message_attachments)
                .layer(DefaultBodyLimit::max(25 * 1024 * 1024)),
        )
        .route(
            "/messages/{message_id}/attachments/{attachment_id}",
            get(messages::serve_message_attachment),
        )
        .route(
            "/team-protocol",
            get(presets::get_team_protocol).post(presets::update_team_protocol),
        )
        .layer(from_fn_with_state(
            deployment.clone(),
            load_chat_session_middleware,
        ));

    let sessions_router = Router::new()
        .route(
            "/",
            get(sessions::get_sessions).post(sessions::create_session),
        )
        .nest("/{session_id}", session_router);

    let agent_router = Router::new()
        .route(
            "/",
            get(agents::get_agent)
                .put(agents::update_agent)
                .delete(agents::delete_agent),
        )
        .layer(from_fn_with_state(
            deployment.clone(),
            load_chat_agent_middleware,
        ));

    let agents_router = Router::new()
        .route("/", get(agents::get_agents).post(agents::create_agent))
        .nest("/{agent_id}", agent_router);

    let messages_router = Router::new().route(
        "/{message_id}",
        get(messages::get_message).delete(messages::delete_message),
    );

    // Skill CRUD routes
    let skills_router = Router::new()
        .route("/agents", get(skills::list_supported_agents_api))
        .route("/native/{runner_type}", get(skills::get_native_skills))
        .route(
            "/native/{runner_type}/{skill_id}",
            axum::routing::put(skills::update_native_skill),
        )
        .route("/", get(skills::get_skills).post(skills::create_skill))
        .route(
            "/{skill_id}",
            get(skills::get_skill)
                .put(skills::update_skill)
                .delete(skills::delete_skill),
        );

    // Agent-Skill assignment routes
    let agent_skills_router = Router::new()
        .route(
            "/",
            get(skills::get_agent_skill_assignments).post(skills::assign_skill_to_agent),
        )
        .route(
            "/{assignment_id}",
            axum::routing::put(skills::update_agent_skill)
                .delete(skills::unassign_skill_from_agent),
        );

    // Remote Skill Registry routes
    let registry_router = Router::new()
        .route("/skills", get(skills::list_registry_skills))
        .route("/skills/{skill_id}", get(skills::get_registry_skill))
        .route(
            "/skills/{skill_id}/install",
            axum::routing::post(skills::install_registry_skill),
        )
        .route("/categories", get(skills::list_registry_categories));

    // Built-in Skills routes (embedded from awesome-claude-skills)
    let builtin_router = Router::new()
        .route("/skills", get(skills::list_builtin_skills_api))
        .route("/skills/stats", get(skills::get_builtin_skills_stats))
        .route("/skills/{skill_id}", get(skills::get_builtin_skill_api))
        .route(
            "/skills/{skill_id}/install",
            axum::routing::post(skills::install_builtin_skill_api),
        );

    Router::new().nest(
        "/chat",
        Router::new()
            .nest("/sessions", sessions_router)
            .nest("/agents", agents_router)
            .nest("/messages", messages_router)
            .nest("/skills", skills_router)
            .nest("/agents/{agent_id}/skills", agent_skills_router)
            .nest("/registry", registry_router)
            .nest("/builtin", builtin_router)
            .route(
                "/validate-workspace-path",
                axum::routing::post(sessions::validate_workspace_path_endpoint),
            )
            .route("/runs/{run_id}/log", get(runs::get_run_log))
            .route("/runs/{run_id}/diff", get(runs::get_run_diff))
            .route(
                "/runs/{run_id}/untracked",
                get(runs::get_run_untracked_file),
            ),
    )
}
