use axum::{Json, extract::State, http::StatusCode};
use db::models::analytics::{AnalyticsEvent, AnalyticsEventCategory, CreateAnalyticsEvent};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::analytics::forward_analytics_record_to_posthog;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::DeploymentImpl;

include!("types.rs");
include!("tracking.rs");
include!("metrics.rs");
include!("dashboard.rs");
include!("funnel.rs");
include!("usage.rs");
include!("user_profile.rs");
include!("router.rs");
include!("tests.rs");
