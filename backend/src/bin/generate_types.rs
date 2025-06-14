use std::env;
use std::path::Path;
use ts_rs::TS;

// Import all the types we want to export using the library crate
use bloop_backend::models::{
    ApiResponse, Project, CreateProject, UpdateProject,
    CreateUser, UpdateUser, LoginRequest, LoginResponse, UserResponse,
};

fn main() {
    let shared_path = Path::new("../shared");
    
    // Create the shared directory if it doesn't exist
    std::fs::create_dir_all(shared_path).unwrap();
    
    println!("Generating TypeScript types...");
    
    // Set environment variable to configure ts-rs output directory
    env::set_var("TS_RS_EXPORT_DIR", shared_path.to_str().unwrap());
    
    // Export TypeScript types for each struct using ts-rs export functionality
    bloop_backend::models::ApiResponse::<()>::export().unwrap();
    bloop_backend::models::Project::export().unwrap();
    bloop_backend::models::CreateProject::export().unwrap();
    bloop_backend::models::UpdateProject::export().unwrap();    
    bloop_backend::models::CreateUser::export().unwrap();
    bloop_backend::models::UpdateUser::export().unwrap();
    bloop_backend::models::LoginRequest::export().unwrap();
    bloop_backend::models::LoginResponse::export().unwrap();
    bloop_backend::models::UserResponse::export().unwrap();
    
    println!("TypeScript types generated successfully in ../shared/");
}
