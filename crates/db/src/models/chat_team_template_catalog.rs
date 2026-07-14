use std::{fmt, str::FromStr};

use sqlx::{FromRow, SqliteConnection, SqlitePool};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamTemplateCatalogSource {
    Builtin,
    Custom,
}

impl TeamTemplateCatalogSource {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Custom => "custom",
        }
    }
}

impl fmt::Display for TeamTemplateCatalogSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TeamTemplateCatalogSource {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "builtin" => Ok(Self::Builtin),
            "custom" => Ok(Self::Custom),
            _ => Err(format!("unknown team template catalog source: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamTemplateCatalogTier {
    Standard,
    Advanced,
}

impl TeamTemplateCatalogTier {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Advanced => "advanced",
        }
    }
}

impl fmt::Display for TeamTemplateCatalogTier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TeamTemplateCatalogTier {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "standard" => Ok(Self::Standard),
            "advanced" => Ok(Self::Advanced),
            _ => Err(format!("unknown team template catalog tier: {value}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatTeamTemplateCatalog {
    pub template_id: String,
    pub source: TeamTemplateCatalogSource,
    pub tier: TeamTemplateCatalogTier,
    pub enabled: bool,
    pub sort_order: i64,
    pub content_checksum: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpsertChatTeamTemplateCatalog {
    pub template_id: String,
    pub source: TeamTemplateCatalogSource,
    pub tier: TeamTemplateCatalogTier,
    pub enabled: bool,
    pub sort_order: i64,
    pub content_checksum: String,
}

#[derive(Debug, FromRow)]
struct ChatTeamTemplateCatalogRecord {
    template_id: String,
    source: String,
    tier: String,
    enabled: bool,
    sort_order: i64,
    content_checksum: String,
    created_at: String,
    updated_at: String,
}

impl TryFrom<ChatTeamTemplateCatalogRecord> for ChatTeamTemplateCatalog {
    type Error = sqlx::Error;

    fn try_from(record: ChatTeamTemplateCatalogRecord) -> Result<Self, Self::Error> {
        let source = TeamTemplateCatalogSource::from_str(&record.source)
            .map_err(|err| sqlx::Error::Decode(err.into()))?;
        let tier = TeamTemplateCatalogTier::from_str(&record.tier)
            .map_err(|err| sqlx::Error::Decode(err.into()))?;

        Ok(Self {
            template_id: record.template_id,
            source,
            tier,
            enabled: record.enabled,
            sort_order: record.sort_order,
            content_checksum: record.content_checksum,
            created_at: record.created_at,
            updated_at: record.updated_at,
        })
    }
}

impl ChatTeamTemplateCatalog {
    pub async fn find_by_id(
        pool: &SqlitePool,
        template_id: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        let mut conn = pool.acquire().await?;
        Self::find_by_id_in_conn(&mut conn, template_id).await
    }

    pub async fn find_by_id_in_conn(
        conn: &mut SqliteConnection,
        template_id: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        let record = sqlx::query_as::<_, ChatTeamTemplateCatalogRecord>(
            r#"
            SELECT template_id, source, tier, enabled, sort_order, content_checksum, created_at, updated_at
            FROM chat_team_template_catalog
            WHERE template_id = ?1
            "#,
        )
        .bind(template_id)
        .fetch_optional(conn)
        .await?;

        record.map(Self::try_from).transpose()
    }

    pub async fn list_stable_sorted(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        let records = sqlx::query_as::<_, ChatTeamTemplateCatalogRecord>(
            r#"
            SELECT template_id, source, tier, enabled, sort_order, content_checksum, created_at, updated_at
            FROM chat_team_template_catalog
            ORDER BY enabled DESC, tier DESC, sort_order ASC, template_id ASC
            "#,
        )
        .fetch_all(pool)
        .await?;

        records.into_iter().map(Self::try_from).collect()
    }

    pub async fn upsert(
        pool: &SqlitePool,
        input: &UpsertChatTeamTemplateCatalog,
    ) -> Result<Self, sqlx::Error> {
        let mut conn = pool.acquire().await?;
        Self::upsert_in_conn(&mut conn, input).await
    }

    pub async fn upsert_in_conn(
        conn: &mut SqliteConnection,
        input: &UpsertChatTeamTemplateCatalog,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO chat_team_template_catalog (
                template_id, source, tier, enabled, sort_order, content_checksum
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(template_id) DO UPDATE SET
                source = excluded.source,
                tier = excluded.tier,
                enabled = excluded.enabled,
                sort_order = excluded.sort_order,
                content_checksum = excluded.content_checksum,
                updated_at = datetime('now', 'subsec')
            WHERE chat_team_template_catalog.source != excluded.source
               OR chat_team_template_catalog.tier != excluded.tier
               OR chat_team_template_catalog.enabled != excluded.enabled
               OR chat_team_template_catalog.sort_order != excluded.sort_order
               OR chat_team_template_catalog.content_checksum != excluded.content_checksum
            "#,
        )
        .bind(&input.template_id)
        .bind(input.source.as_str())
        .bind(input.tier.as_str())
        .bind(input.enabled)
        .bind(input.sort_order)
        .bind(&input.content_checksum)
        .execute(&mut *conn)
        .await?;

        Self::find_by_id_in_conn(conn, &input.template_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn delete_stale_builtin(
        pool: &SqlitePool,
        current_template_ids: &[String],
    ) -> Result<u64, sqlx::Error> {
        let mut conn = pool.acquire().await?;
        Self::delete_stale_builtin_in_conn(&mut conn, current_template_ids).await
    }

    pub async fn delete_stale_builtin_in_conn(
        conn: &mut SqliteConnection,
        current_template_ids: &[String],
    ) -> Result<u64, sqlx::Error> {
        let builtin_ids = sqlx::query_scalar::<_, String>(
            "SELECT template_id FROM chat_team_template_catalog WHERE source = 'builtin'",
        )
        .fetch_all(&mut *conn)
        .await?;

        let mut deleted = 0;
        for template_id in builtin_ids {
            if current_template_ids.iter().any(|id| id == &template_id) {
                continue;
            }
            let result = sqlx::query(
                "DELETE FROM chat_team_template_catalog WHERE template_id = ?1 AND source = 'builtin'",
            )
            .bind(&template_id)
            .execute(&mut *conn)
            .await?;
            deleted += result.rows_affected();
        }

        Ok(deleted)
    }

    pub async fn reconcile_custom(
        pool: &SqlitePool,
        custom_rows: &[UpsertChatTeamTemplateCatalog],
    ) -> Result<u64, sqlx::Error> {
        let mut conn = pool.acquire().await?;
        Self::reconcile_custom_in_conn(&mut conn, custom_rows).await
    }

    pub async fn reconcile_custom_in_conn(
        conn: &mut SqliteConnection,
        custom_rows: &[UpsertChatTeamTemplateCatalog],
    ) -> Result<u64, sqlx::Error> {
        let custom_ids = custom_rows
            .iter()
            .map(|row| row.template_id.as_str())
            .collect::<Vec<_>>();
        let existing_custom_ids = sqlx::query_scalar::<_, String>(
            "SELECT template_id FROM chat_team_template_catalog WHERE source = 'custom'",
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut changed = 0;

        for template_id in existing_custom_ids {
            if custom_ids.iter().any(|id| *id == template_id) {
                continue;
            }
            let result = sqlx::query(
                "DELETE FROM chat_team_template_catalog WHERE template_id = ?1 AND source = 'custom'",
            )
            .bind(&template_id)
            .execute(&mut *conn)
            .await?;
            changed += result.rows_affected();
        }

        for row in custom_rows {
            Self::upsert_in_conn(conn, row).await?;
            changed += 1;
        }

        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::{
        ChatTeamTemplateCatalog, TeamTemplateCatalogSource, TeamTemplateCatalogTier,
        UpsertChatTeamTemplateCatalog,
    };

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite memory pool");
        sqlx::query(include_str!(
            "../../migrations/20260713120000_create_chat_team_template_catalog.sql"
        ))
        .execute(&pool)
        .await
        .expect("create catalog table");
        pool
    }

    fn row(
        template_id: &str,
        source: TeamTemplateCatalogSource,
        tier: TeamTemplateCatalogTier,
        enabled: bool,
        sort_order: i64,
        checksum: &str,
    ) -> UpsertChatTeamTemplateCatalog {
        UpsertChatTeamTemplateCatalog {
            template_id: template_id.to_string(),
            source,
            tier,
            enabled,
            sort_order,
            content_checksum: checksum.to_string(),
        }
    }

    #[tokio::test]
    async fn constraints_reject_unknown_source_and_tier_values() {
        let pool = setup_pool().await;

        let invalid_source = sqlx::query(
            "INSERT INTO chat_team_template_catalog (template_id, source, tier, content_checksum) VALUES ('bad-source', 'remote', 'standard', 'sum')",
        )
        .execute(&pool)
        .await;
        assert!(invalid_source.is_err());

        let invalid_tier = sqlx::query(
            "INSERT INTO chat_team_template_catalog (template_id, source, tier, content_checksum) VALUES ('bad-tier', 'builtin', 'premium', 'sum')",
        )
        .execute(&pool)
        .await;
        assert!(invalid_tier.is_err());
    }

    #[tokio::test]
    async fn crud_and_stable_sorting_use_typed_catalog_values() {
        let pool = setup_pool().await;

        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "advanced",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Advanced,
                true,
                1,
                "sum-a",
            ),
        )
        .await
        .expect("upsert advanced");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "standard",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Standard,
                true,
                2,
                "sum-s",
            ),
        )
        .await
        .expect("upsert standard");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "disabled",
                TeamTemplateCatalogSource::Custom,
                TeamTemplateCatalogTier::Standard,
                false,
                0,
                "sum-d",
            ),
        )
        .await
        .expect("upsert disabled");

        let found = ChatTeamTemplateCatalog::find_by_id(&pool, "standard")
            .await
            .expect("find standard")
            .expect("standard exists");
        assert_eq!(found.source, TeamTemplateCatalogSource::Builtin);
        assert_eq!(found.tier, TeamTemplateCatalogTier::Standard);

        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "standard",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Standard,
                true,
                2,
                "sum-s2",
            ),
        )
        .await
        .expect("update standard");
        let updated = ChatTeamTemplateCatalog::find_by_id(&pool, "standard")
            .await
            .expect("find updated")
            .expect("updated exists");
        assert_eq!(updated.content_checksum, "sum-s2");

        let sorted = ChatTeamTemplateCatalog::list_stable_sorted(&pool)
            .await
            .expect("list sorted");
        let ids = sorted
            .iter()
            .map(|entry| entry.template_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["standard", "advanced", "disabled"]);
    }

    #[tokio::test]
    async fn stale_builtin_cleanup_and_custom_reconciliation_are_idempotent() {
        let pool = setup_pool().await;

        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "current_builtin",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Standard,
                true,
                0,
                "current",
            ),
        )
        .await
        .expect("insert current builtin");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "stale_builtin",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Advanced,
                true,
                1,
                "stale",
            ),
        )
        .await
        .expect("insert stale builtin");
        ChatTeamTemplateCatalog::upsert(
            &pool,
            &row(
                "custom_one",
                TeamTemplateCatalogSource::Builtin,
                TeamTemplateCatalogTier::Advanced,
                false,
                99,
                "wrong",
            ),
        )
        .await
        .expect("insert drifted custom");

        let deleted = ChatTeamTemplateCatalog::delete_stale_builtin(
            &pool,
            &["current_builtin".to_string(), "custom_one".to_string()],
        )
        .await
        .expect("delete stale builtin");
        assert_eq!(deleted, 1);

        let reconciled = ChatTeamTemplateCatalog::reconcile_custom(
            &pool,
            &[row(
                "custom_one",
                TeamTemplateCatalogSource::Custom,
                TeamTemplateCatalogTier::Standard,
                true,
                10,
                "custom-sum",
            )],
        )
        .await
        .expect("reconcile custom");
        assert_eq!(reconciled, 1);

        let custom = ChatTeamTemplateCatalog::find_by_id(&pool, "custom_one")
            .await
            .expect("find custom")
            .expect("custom exists");
        assert_eq!(custom.source, TeamTemplateCatalogSource::Custom);
        assert_eq!(custom.tier, TeamTemplateCatalogTier::Standard);
        assert!(custom.enabled);
        assert_eq!(custom.sort_order, 10);
        assert_eq!(custom.content_checksum, "custom-sum");
        assert!(
            ChatTeamTemplateCatalog::find_by_id(&pool, "stale_builtin")
                .await
                .expect("find stale")
                .is_none()
        );

        let deleted_again = ChatTeamTemplateCatalog::delete_stale_builtin(
            &pool,
            &["current_builtin".to_string(), "custom_one".to_string()],
        )
        .await
        .expect("delete stale builtin again");
        assert_eq!(deleted_again, 0);
    }
}
