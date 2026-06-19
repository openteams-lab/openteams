use executors::executors::BaseCodingAgent;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct MemberExecutionConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner_type: Option<BaseCodingAgent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_variant: Option<String>,
}

impl MemberExecutionConfig {
    pub fn has_overrides(&self) -> bool {
        self.runner_type.is_some()
            || is_present(self.model_name.as_deref())
            || is_present(self.thinking_effort.as_deref())
            || is_present(self.model_variant.as_deref())
    }

    pub fn normalized(mut self) -> Self {
        self.model_name = normalize_optional_string(self.model_name);
        self.thinking_effort = normalize_optional_string(self.thinking_effort);
        self.model_variant = normalize_optional_string(self.model_variant);
        self
    }
}

fn is_present(value: Option<&str>) -> bool {
    value.map(str::trim).is_some_and(|value| !value.is_empty())
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
