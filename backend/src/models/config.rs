use crate::executor::ExecutorConfig;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Config {
    pub theme: ThemeMode,
    pub executor: ExecutorConfig,
    pub disclaimer_acknowledged: bool,
    pub sound_alerts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    System,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            theme: ThemeMode::System,
            executor: ExecutorConfig::Claude,
            disclaimer_acknowledged: false,
            sound_alerts: true,
        }
    }
}

impl Config {
    pub fn load(config_path: &PathBuf) -> anyhow::Result<Self> {
        if config_path.exists() {
            let content = std::fs::read_to_string(config_path)?;
            
            // Try to deserialize as is first
            match serde_json::from_str::<Config>(&content) {
                Ok(config) => Ok(config),
                Err(_) => {
                    // If full deserialization fails, merge with defaults
                    let config = Self::load_with_defaults(&content, config_path)?;
                    Ok(config)
                }
            }
        } else {
            let config = Config::default();
            config.save(config_path)?;
            Ok(config)
        }
    }

    fn load_with_defaults(content: &str, config_path: &PathBuf) -> anyhow::Result<Self> {
        // Parse as generic JSON value
        let existing_value: serde_json::Value = serde_json::from_str(content)?;
        
        // Get default config as JSON value
        let default_config = Config::default();
        let default_value = serde_json::to_value(&default_config)?;
        
        // Merge existing config with defaults
        let merged_value = Self::merge_json_values(default_value, existing_value);
        
        // Deserialize merged value back to Config
        let config: Config = serde_json::from_value(merged_value)?;
        
        // Save the updated config with any missing defaults
        config.save(config_path)?;
        
        Ok(config)
    }

    fn merge_json_values(mut base: serde_json::Value, overlay: serde_json::Value) -> serde_json::Value {
        match (&mut base, overlay) {
            (serde_json::Value::Object(base_map), serde_json::Value::Object(overlay_map)) => {
                for (key, value) in overlay_map {
                    base_map.entry(key).and_modify(|base_value| {
                        *base_value = Self::merge_json_values(base_value.clone(), value.clone());
                    }).or_insert(value);
                }
                base
            }
            (_, overlay) => overlay, // Use overlay value for non-objects
        }
    }

    pub fn save(&self, config_path: &PathBuf) -> anyhow::Result<()> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(config_path, content)?;
        Ok(())
    }
}
