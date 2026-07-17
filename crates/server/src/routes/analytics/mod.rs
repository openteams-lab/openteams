use crate::DeploymentImpl;

/// Analytics is backend-owned. There is intentionally no HTTP ingestion or local BI surface.
pub fn router() -> axum::Router<DeploymentImpl> {
    axum::Router::new()
}
