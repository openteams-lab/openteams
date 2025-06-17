use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
    Json, Router,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{create_token, hash_password, verify_password, AuthUser};
use crate::models::{
    user::{CreateUser, LoginRequest, LoginResponse, UpdateUser, User, UserResponse},
    ApiResponse,
};

pub async fn login(
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<LoginRequest>,
) -> Result<ResponseJson<ApiResponse<LoginResponse>>, StatusCode> {
    match User::find_by_email(&pool, &payload.email).await {
        Ok(Some(user)) => match verify_password(&payload.password, &user.password_hash) {
            Ok(true) => match create_token(user.id, user.email.clone(), user.is_admin) {
                Ok(token) => Ok(ResponseJson(ApiResponse {
                    success: true,
                    data: Some(LoginResponse {
                        user: user.into(),
                        token,
                    }),
                    message: Some("Login successful".to_string()),
                })),
                Err(e) => {
                    tracing::error!("Failed to create token: {}", e);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            },
            Ok(false) => Err(StatusCode::UNAUTHORIZED),
            Err(e) => {
                tracing::error!("Password verification error: {}", e);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        },
        Ok(None) => Err(StatusCode::UNAUTHORIZED),
        Err(e) => {
            tracing::error!("Failed to fetch user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_users(
    _auth: AuthUser,
    Extension(pool): Extension<PgPool>,
) -> Result<ResponseJson<ApiResponse<Vec<UserResponse>>>, StatusCode> {
    match User::find_all(&pool).await {
        Ok(users) => {
            let user_responses: Vec<UserResponse> = users.into_iter().map(|u| u.into()).collect();
            Ok(ResponseJson(ApiResponse {
                success: true,
                data: Some(user_responses),
                message: None,
            }))
        }
        Err(e) => {
            tracing::error!("Failed to fetch users: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_user(
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>,
) -> Result<ResponseJson<ApiResponse<UserResponse>>, StatusCode> {
    // Users can only view their own profile unless they're admin
    if auth.user_id != id && !auth.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    match User::find_by_id(&pool, id).await {
        Ok(Some(user)) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(user.into()),
            message: None,
        })),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn create_user(
    auth: AuthUser,
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<CreateUser>,
) -> Result<ResponseJson<ApiResponse<UserResponse>>, StatusCode> {
    // Only admins can create users
    if !auth.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let id = Uuid::new_v4();

    let password_hash = match hash_password(&payload.password) {
        Ok(hash) => hash,
        Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
    };

    match User::create(&pool, &payload, password_hash, id).await {
        Ok(user) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(user.into()),
            message: Some("User created successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to create user: {}", e);
            if e.to_string().contains("users_email_key") {
                Err(StatusCode::CONFLICT) // Email already exists
            } else {
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    }
}

pub async fn update_user(
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>,
    Json(payload): Json<UpdateUser>,
) -> Result<ResponseJson<ApiResponse<UserResponse>>, StatusCode> {
    // Users can only update their own profile unless they're admin
    if auth.user_id != id && !auth.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    // Get existing user
    let existing_user = match User::find_by_id(&pool, id).await {
        Ok(Some(user)) => user,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to check user existence: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let email = payload.email.unwrap_or(existing_user.email);
    let is_admin = if auth.is_admin {
        payload.is_admin.unwrap_or(existing_user.is_admin)
    } else {
        existing_user.is_admin // Non-admins can't change admin status
    };

    let password_hash = if let Some(new_password) = payload.password {
        match hash_password(&new_password) {
            Ok(hash) => hash,
            Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
        }
    } else {
        existing_user.password_hash
    };

    match User::update(&pool, id, email, password_hash, is_admin).await {
        Ok(user) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(user.into()),
            message: Some("User updated successfully".to_string()),
        })),
        Err(e) => {
            tracing::error!("Failed to update user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_user(
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Extension(pool): Extension<PgPool>,
) -> Result<ResponseJson<ApiResponse<()>>, StatusCode> {
    // Only admins can delete users, and they can't delete themselves
    if !auth.is_admin || auth.user_id == id {
        return Err(StatusCode::FORBIDDEN);
    }

    match User::delete(&pool, id).await {
        Ok(rows_affected) => {
            if rows_affected == 0 {
                Err(StatusCode::NOT_FOUND)
            } else {
                Ok(ResponseJson(ApiResponse {
                    success: true,
                    data: None,
                    message: Some("User deleted successfully".to_string()),
                }))
            }
        }
        Err(e) => {
            tracing::error!("Failed to delete user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_current_user(
    auth: AuthUser,
    Extension(pool): Extension<PgPool>,
) -> Result<ResponseJson<ApiResponse<UserResponse>>, StatusCode> {
    match User::find_by_id(&pool, auth.user_id).await {
        Ok(Some(user)) => Ok(ResponseJson(ApiResponse {
            success: true,
            data: Some(user.into()),
            message: None,
        })),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch current user: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn check_auth_status(auth: AuthUser) -> ResponseJson<ApiResponse<serde_json::Value>> {
    ResponseJson(ApiResponse {
        success: true,
        data: Some(serde_json::json!({
            "authenticated": true,
            "user_id": auth.user_id,
            "email": auth.email,
            "is_admin": auth.is_admin
        })),
        message: Some("User is authenticated".to_string()),
    })
}

pub fn public_users_router() -> Router {
    Router::new().route("/auth/login", post(login))
}

pub fn protected_users_router() -> Router {
    Router::new()
        .route("/auth/status", get(check_auth_status))
        .route("/auth/me", get(get_current_user))
        .route("/users", get(get_users).post(create_user))
        .route(
            "/users/:id",
            get(get_user).put(update_user).delete(delete_user),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{hash_password, AuthUser};
    use crate::models::user::{CreateUser, LoginRequest, UpdateUser};
    use axum::extract::Extension;
    use chrono::Utc;
    use sqlx::PgPool;
    use uuid::Uuid;

    async fn create_test_user(pool: &PgPool, email: &str, password: &str, is_admin: bool) -> User {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let password_hash = hash_password(password).unwrap();

        sqlx::query_as!(
            User,
            "INSERT INTO users (id, email, password_hash, is_admin, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, password_hash, is_admin, created_at, updated_at",
            id,
            email,
            password_hash,
            is_admin,
            now,
            now
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[sqlx::test]
    async fn test_login_success(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;

        let login_request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "password123".to_string(),
        };

        let result = login(Extension(pool), Json(login_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.as_ref().unwrap().user.email, user.email);
    }

    #[sqlx::test]
    async fn test_login_invalid_password(pool: PgPool) {
        create_test_user(&pool, "test@example.com", "password123", false).await;

        let login_request = LoginRequest {
            email: "test@example.com".to_string(),
            password: "wrongpassword".to_string(),
        };

        let result = login(Extension(pool), Json(login_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test]
    async fn test_login_user_not_found(pool: PgPool) {
        let login_request = LoginRequest {
            email: "nonexistent@example.com".to_string(),
            password: "password123".to_string(),
        };

        let result = login(Extension(pool), Json(login_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::UNAUTHORIZED);
    }

    #[sqlx::test]
    async fn test_get_users_as_admin(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;
        create_test_user(&pool, "user1@example.com", "password123", false).await;
        create_test_user(&pool, "user2@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email,
            is_admin: true,
        };

        let result = get_users(auth, Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().len(), 3);
    }

    #[sqlx::test]
    async fn test_get_user_own_profile(pool: PgPool) {
        let user = create_test_user(&pool, "test@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email.clone(),
            is_admin: false,
        };

        let result = get_user(auth, Path(user.id), Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().email, user.email);
    }

    #[sqlx::test]
    async fn test_get_user_forbidden_non_admin(pool: PgPool) {
        let user1 = create_test_user(&pool, "user1@example.com", "password123", false).await;
        let user2 = create_test_user(&pool, "user2@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user1.id,
            email: user1.email,
            is_admin: false,
        };

        let result = get_user(auth, Path(user2.id), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn test_get_user_admin_can_view_any(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;
        let regular_user = create_test_user(&pool, "user@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email,
            is_admin: true,
        };

        let result = get_user(auth, Path(regular_user.id), Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().email, regular_user.email);
    }

    #[sqlx::test]
    async fn test_create_user_as_admin(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email,
            is_admin: true,
        };

        let create_request = CreateUser {
            email: "newuser@example.com".to_string(),
            password: "password123".to_string(),
            is_admin: Some(false),
        };

        let result = create_user(auth, Extension(pool), Json(create_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().email, "newuser@example.com");
    }

    #[sqlx::test]
    async fn test_create_user_forbidden_non_admin(pool: PgPool) {
        let regular_user = create_test_user(&pool, "user@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: regular_user.id,
            email: regular_user.email,
            is_admin: false,
        };

        let create_request = CreateUser {
            email: "newuser@example.com".to_string(),
            password: "password123".to_string(),
            is_admin: Some(false),
        };

        let result = create_user(auth, Extension(pool), Json(create_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn test_create_user_duplicate_email(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;
        create_test_user(&pool, "existing@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email,
            is_admin: true,
        };

        let create_request = CreateUser {
            email: "existing@example.com".to_string(),
            password: "password123".to_string(),
            is_admin: Some(false),
        };

        let result = create_user(auth, Extension(pool), Json(create_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::CONFLICT);
    }

    #[sqlx::test]
    async fn test_update_user_own_profile(pool: PgPool) {
        let user = create_test_user(&pool, "user@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email.clone(),
            is_admin: false,
        };

        let update_request = UpdateUser {
            email: Some("newemail@example.com".to_string()),
            password: Some("newpassword123".to_string()),
            is_admin: None,
        };

        let result = update_user(auth, Path(user.id), Extension(pool), Json(update_request)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().email, "newemail@example.com");
    }

    #[sqlx::test]
    async fn test_update_user_forbidden_non_admin(pool: PgPool) {
        let user1 = create_test_user(&pool, "user1@example.com", "password123", false).await;
        let user2 = create_test_user(&pool, "user2@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user1.id,
            email: user1.email,
            is_admin: false,
        };

        let update_request = UpdateUser {
            email: Some("newemail@example.com".to_string()),
            password: None,
            is_admin: None,
        };

        let result = update_user(auth, Path(user2.id), Extension(pool), Json(update_request)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn test_delete_user_as_admin(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;
        let user_to_delete =
            create_test_user(&pool, "delete@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email,
            is_admin: true,
        };

        let result = delete_user(auth, Path(user_to_delete.id), Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert_eq!(response.message.unwrap(), "User deleted successfully");
    }

    #[sqlx::test]
    async fn test_delete_user_forbidden_non_admin(pool: PgPool) {
        let user1 = create_test_user(&pool, "user1@example.com", "password123", false).await;
        let user2 = create_test_user(&pool, "user2@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user1.id,
            email: user1.email,
            is_admin: false,
        };

        let result = delete_user(auth, Path(user2.id), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn test_delete_user_self_forbidden(pool: PgPool) {
        let admin_user = create_test_user(&pool, "admin@example.com", "password123", true).await;

        let auth = AuthUser {
            user_id: admin_user.id,
            email: admin_user.email.clone(),
            is_admin: true,
        };

        let result = delete_user(auth, Path(admin_user.id), Extension(pool)).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), StatusCode::FORBIDDEN);
    }

    #[sqlx::test]
    async fn test_get_current_user(pool: PgPool) {
        let user = create_test_user(&pool, "user@example.com", "password123", false).await;

        let auth = AuthUser {
            user_id: user.id,
            email: user.email.clone(),
            is_admin: false,
        };

        let result = get_current_user(auth, Extension(pool)).await;
        assert!(result.is_ok());

        let response = result.unwrap().0;
        assert!(response.success);
        assert!(response.data.is_some());
        assert_eq!(response.data.unwrap().email, user.email);
    }

    #[tokio::test]
    async fn test_check_auth_status() {
        let auth = AuthUser {
            user_id: Uuid::new_v4(),
            email: "test@example.com".to_string(),
            is_admin: true,
        };

        let response = check_auth_status(auth.clone()).await.0;
        assert!(response.success);
        assert!(response.data.is_some());

        let data = response.data.unwrap();
        assert_eq!(data["authenticated"], true);
        assert_eq!(data["user_id"], auth.user_id.to_string());
        assert_eq!(data["email"], auth.email);
        assert_eq!(data["is_admin"], auth.is_admin);
    }
}
