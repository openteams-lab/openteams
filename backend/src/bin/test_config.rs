use vibe_kanban::models::config::Config;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    // Test loading config with missing keys
    let test_path = PathBuf::from("../test_config.json");
    
    println!("Testing config loading with missing keys...");
    println!("Original config content:");
    let content = std::fs::read_to_string(&test_path)?;
    println!("{}", content);
    
    let config = Config::load(&test_path)?;
    
    println!("\nLoaded config (with defaults merged):");
    println!("{:#?}", config);
    
    println!("\nUpdated config file content:");
    let updated_content = std::fs::read_to_string(&test_path)?;
    println!("{}", updated_content);
    
    Ok(())
}
