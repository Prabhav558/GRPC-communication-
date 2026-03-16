use deadpool_postgres::{Config, Pool, Runtime};
use std::env;
use tokio_postgres::NoTls;

pub type DbPool = Pool;

#[derive(Debug, Clone)]
pub struct DatabaseInfo {
    pub database_name: String,
    pub database_size: String,
    pub table_count: i32,
    pub postgres_version: String,
    pub timestamp: String,
}

#[derive(Debug, Clone)]
pub struct TableInfo {
    pub table_name: String,
    pub schema_name: String,
    pub row_count: i64,
    pub table_size: String,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone)]
pub struct ColumnInfo {
    pub column_name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: String,
}

pub async fn create_pool() -> Result<DbPool, Box<dyn std::error::Error>> {
    let mut cfg = Config::new();
    cfg.host = Some(env::var("POSTGRES_HOST").unwrap_or_else(|_| "localhost".to_string()));
    cfg.port = Some(env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".to_string()).parse()?);
    cfg.dbname = Some(env::var("POSTGRES_DB").unwrap_or_else(|_| "pipeline_db".to_string()));
    cfg.user = Some(env::var("POSTGRES_USER").unwrap_or_else(|_| "pipeline_user".to_string()));
    cfg.password = Some(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "pipeline_pass".to_string()));

    let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls)?;

    println!("✅ Database connection pool initialized");
    Ok(pool)
}

pub async fn connect_to_db(db_name: &str) -> Result<tokio_postgres::Client, Box<dyn std::error::Error>> {
    let mut cfg = tokio_postgres::Config::new();
    cfg.host(env::var("POSTGRES_HOST").unwrap_or_else(|_| "localhost".to_string()).as_str());
    cfg.port(env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".to_string()).parse()?);
    cfg.user(env::var("POSTGRES_USER").unwrap_or_else(|_| "pipeline_user".to_string()).as_str());
    cfg.password(env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "pipeline_pass".to_string()).as_str());
    cfg.dbname(db_name);
    
    let (client, connection) = cfg.connect(tokio_postgres::NoTls).await?;
    let db_name_owned = db_name.to_string();
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("❌ DB connection error for {}: {}", db_name_owned, e);
        }
    });

    Ok(client)
}

pub async fn get_all_databases(pool: &DbPool) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let client = pool.get().await?;
    let rows = client.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false AND has_database_privilege(datname, 'CONNECT') ORDER BY datname",
        &[]
    ).await?;
    let dbs = rows.iter().map(|r| r.get(0)).collect();
    Ok(dbs)
}

pub async fn get_database_metadata(client: &tokio_postgres::Client) -> Result<DatabaseInfo, Box<dyn std::error::Error>> {
    let row = client.query_one(
        "SELECT current_database(), pg_size_pretty(pg_database_size(current_database())), version()",
        &[]
    ).await?;

    let count_row = client.query_one(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')",
        &[]
    ).await?;

    Ok(DatabaseInfo {
        database_name: row.get(0),
        database_size: row.get(1),
        table_count: count_row.get::<_, i64>(0) as i32,
        postgres_version: row.get(2),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

pub async fn get_all_tables(client: &tokio_postgres::Client) -> Result<Vec<TableInfo>, Box<dyn std::error::Error>> {
    let rows = client.query(
        "SELECT table_schema, table_name FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name",
        &[]
    ).await?;

    let mut tables = Vec::new();

    for row in rows {
        let schema: String = row.get(0);
        let table: String = row.get(1);
        let full_table = format!("{}.{}", schema, table);

        // Get row count
        let count_row = client.query_one(
            &format!("SELECT COUNT(*) FROM {}", full_table),
            &[]
        ).await?;
        let row_count: i64 = count_row.get(0);

        // Get table size (embed table name as regclass literal, not as parameter)
        let size_row = client.query_one(
            &format!("SELECT pg_size_pretty(pg_total_relation_size('{}'::regclass))", full_table),
            &[]
        ).await?;
        let table_size: String = size_row.get(0);

        // Get columns
        let col_rows = client.query(
            "SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2
             ORDER BY ordinal_position",
            &[&schema, &table]
        ).await?;

        let columns = col_rows.iter().map(|r| ColumnInfo {
            column_name: r.get(0),
            data_type: r.get(1),
            is_nullable: r.get::<_, String>(2) == "YES",
            default_value: r.get::<_, Option<String>>(3).unwrap_or_default(),
        }).collect();

        tables.push(TableInfo {
            table_name: table,
            schema_name: schema,
            row_count,
            table_size,
            columns,
        });
    }

    Ok(tables)
}
