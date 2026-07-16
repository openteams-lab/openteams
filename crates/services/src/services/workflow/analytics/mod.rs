//! Workflow analytics instrumentation module.
//!
//! Covers 5 event categories per `.openteams/plan.md`:
//! 1. Process funnel (workflow.*)
//! 2. Collaboration efficiency (collaboration.*)
//! 3. User engagement (engagement.*)
//! 4. Quality outcomes (quality.*)
//! 5. Risk/anomaly (risk.*)
//!
include!("tracking.rs");
include!("buckets.rs");
