use serde::Deserialize;
use serde_json::{Map, Value as JsonValue};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Connection, Row, Sqlite, TypeInfo, Value, ValueRef};
use tauri::State;
use tauri_plugin_sql::DbPool;

const DATABASE: &str = "sqlite:layp.db";

#[derive(Deserialize)]
pub struct SqlStatement {
    pub sql: String,
    #[serde(default)]
    pub values: Vec<JsonValue>,
}

#[derive(serde::Serialize)]
pub struct SqlBatch {
    pub rows: Vec<Map<String, JsonValue>>,
    #[serde(rename = "rowsAffected")]
    pub rows_affected: u64,
}

/// `batches` are the statement results. `now` is sampled after those statements and before commit.
#[derive(serde::Serialize)]
pub struct SqlTxResult {
    pub batches: Vec<SqlBatch>,
    pub now: String,
}

/// UTC millisecond stamp, the same shape as `Date.toISOString()`.
pub(crate) fn now_iso() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    iso_from_unix_millis(millis)
}

pub(crate) fn iso_from_unix_millis(millis: u64) -> String {
    let secs = millis / 1000;
    let sub = (millis % 1000) as u32;
    let days = (secs / 86_400) as i64;
    let time = (secs % 86_400) as u32;
    let hour = time / 3600;
    let minute = (time % 3600) / 60;
    let second = time % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{sub:03}Z")
}

/// Howard Hinnant's civil_from_days. `z` is days since 1970-01-01.
fn civil_from_days(mut z: i64) -> (i32, u32, u32) {
    z += 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let year_of_era = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year_of_era + 1 } else { year_of_era };
    (year as i32, month as u32, day as u32)
}

/// One checkout from the plugin pool. The `DbInstances` guard is dropped before any SQL.
#[tauri::command]
pub async fn sql_transaction(
    instances: State<'_, tauri_plugin_sql::DbInstances>,
    statements: Vec<SqlStatement>,
) -> Result<SqlTxResult, String> {
    let pool = {
        let guard = instances.0.read().await;
        let Some(DbPool::Sqlite(pool)) = guard.get(DATABASE) else {
            return Err("database is not open".to_string());
        };
        pool.clone()
    };
    run_on_pool(&pool, statements).await
}

pub async fn run_on_pool(pool: &sqlx::Pool<Sqlite>, statements: Vec<SqlStatement>) -> Result<SqlTxResult, String> {
    let mut conn = pool.acquire().await.map_err(|err| err.to_string())?;
    // These pragmas are per connection and are ignored once a transaction is open.
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&mut *conn)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("PRAGMA busy_timeout = 5000")
        .execute(&mut *conn)
        .await
        .map_err(|err| err.to_string())?;
    // pool.begin() is BEGIN DEFERRED on a different checkout. IMMEDIATE reserves the write lock here.
    let mut tx = conn.begin_with("BEGIN IMMEDIATE").await.map_err(|err| err.to_string())?;
    let result = execute_all(&mut tx, &statements).await;
    match result {
        Ok(batches) => {
            // After the reads, before commit. Callers use this stamp instead of sampling again.
            let now = now_iso();
            tx.commit().await.map_err(|err| err.to_string())?;
            Ok(SqlTxResult { batches, now })
        }
        Err(err) => {
            let _ = tx.rollback().await;
            Err(err)
        }
    }
}

async fn execute_all(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    statements: &[SqlStatement],
) -> Result<Vec<SqlBatch>, String> {
    let mut batches = Vec::with_capacity(statements.len());
    for statement in statements {
        let (rows, rows_affected) = execute_one(tx, statement).await?;
        batches.push(SqlBatch { rows, rows_affected });
    }
    Ok(batches)
}

async fn execute_one(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    statement: &SqlStatement,
) -> Result<(Vec<Map<String, JsonValue>>, u64), String> {
    let mut query = sqlx::query(&statement.sql);
    for value in &statement.values {
        if value.is_null() {
            query = query.bind(None::<String>);
        } else if let Some(text) = value.as_str() {
            query = query.bind(text.to_owned());
        } else if let Some(number) = value.as_number() {
            let float = number.as_f64().ok_or_else(|| "sql number is not finite".to_string())?;
            query = query.bind(float);
        } else {
            return Err("sql value must be null, string, or number".to_string());
        }
    }
    if is_query(&statement.sql) {
        let rows = query.fetch_all(&mut **tx).await.map_err(|err| err.to_string())?;
        let mapped = rows.iter().map(row_to_json).collect::<Result<Vec<_>, _>>()?;
        let count = mapped.len() as u64;
        Ok((mapped, count))
    } else {
        let result = query.execute(&mut **tx).await.map_err(|err| err.to_string())?;
        Ok((Vec::new(), result.rows_affected()))
    }
}

fn is_query(sql: &str) -> bool {
    let word = sql.trim_start().split_whitespace().next().unwrap_or("");
    word.eq_ignore_ascii_case("select")
        || word.eq_ignore_ascii_case("pragma")
        || word.eq_ignore_ascii_case("with")
        || word.eq_ignore_ascii_case("values")
}

fn row_to_json(row: &SqliteRow) -> Result<Map<String, JsonValue>, String> {
    let mut map = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(|err| err.to_string())?;
        map.insert(column.name().to_owned(), value_to_json(raw)?);
    }
    Ok(map)
}

fn value_to_json(value: sqlx::sqlite::SqliteValueRef<'_>) -> Result<JsonValue, String> {
    if value.is_null() {
        return Ok(JsonValue::Null);
    }
    match value.type_info().name() {
        "NULL" => Ok(JsonValue::Null),
        "TEXT" => Ok(JsonValue::String(
            value.to_owned().try_decode::<String>().map_err(|err| err.to_string())?,
        )),
        "INTEGER" | "NUMERIC" => {
            let number = value.to_owned().try_decode::<i64>().map_err(|err| err.to_string())?;
            Ok(JsonValue::Number(number.into()))
        }
        "REAL" | "FLOAT" => {
            let number = value.to_owned().try_decode::<f64>().map_err(|err| err.to_string())?;
            serde_json::Number::from_f64(number)
                .map(JsonValue::Number)
                .ok_or_else(|| "sql number is not finite".to_string())
        }
        "BLOB" => {
            let bytes = value.to_owned().try_decode::<Vec<u8>>().map_err(|err| err.to_string())?;
            Ok(JsonValue::Array(
                bytes.into_iter().map(|byte| JsonValue::Number(byte.into())).collect(),
            ))
        }
        other => Err(format!("unsupported sql type {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);

    async fn test_pool() -> (sqlx::Pool<Sqlite>, std::path::PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "layp-tx-{}-{}.db",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(SqliteConnectOptions::new().filename(&path).create_if_missing(true))
            .await
            .unwrap();
        (pool, path)
    }

    #[test]
    fn iso_matches_javascript_to_iso_string() {
        assert_eq!(iso_from_unix_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix_millis(1_791_417_600_000), "2026-10-08T00:00:00.000Z");
        assert_eq!(iso_from_unix_millis(1_791_417_600_123), "2026-10-08T00:00:00.123Z");
    }

    #[tokio::test]
    async fn failed_second_statement_rolls_back() {
        let (pool, path) = test_pool().await;
        sqlx::query("CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        let err = run_on_pool(
            &pool,
            vec![
                SqlStatement {
                    sql: "INSERT INTO sample (id, name) VALUES (1, 'a')".to_string(),
                    values: vec![],
                },
                SqlStatement {
                    sql: "INSERT INTO sample (id, name) VALUES (1, 'b')".to_string(),
                    values: vec![],
                },
            ],
        )
        .await;
        assert!(err.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn immediate_lock_blocks_then_the_row_is_visible() {
        let (pool, path) = test_pool().await;
        sqlx::query("CREATE TABLE sample (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();

        let mut holder = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA busy_timeout = 5000")
            .execute(&mut *holder)
            .await
            .unwrap();
        let mut tx = holder.begin_with("BEGIN IMMEDIATE").await.unwrap();
        let _read: Vec<SqliteRow> = sqlx::query("SELECT id FROM sample").fetch_all(&mut *tx).await.unwrap();

        let writer = pool.clone();
        let handle = tokio::spawn(async move {
            run_on_pool(
                &writer,
                vec![SqlStatement {
                    sql: "INSERT INTO sample (id) VALUES (1)".to_string(),
                    values: vec![],
                }],
            )
            .await
            .unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        assert!(!handle.is_finished(), "the second connection should still be waiting on the write lock");
        tx.commit().await.unwrap();
        drop(holder);
        handle.await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sample")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool.close().await;
        let _ = std::fs::remove_file(path);
    }
}
