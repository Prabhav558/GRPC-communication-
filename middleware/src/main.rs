use axum::{routing::{post, get}, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Identity};
use tower_http::cors::CorsLayer;

pub mod pipeline {
    tonic::include_proto!("pipeline");
}

mod db;
mod grpc_server;

use pipeline::encryption_service_client::EncryptionServiceClient;
use pipeline::{DataRequest, DbMetadataRequest, DatabaseInfo, TableInfo, ColumnInfo};

type GrpcClient = Arc<Mutex<EncryptionServiceClient<tonic::transport::Channel>>>;

#[derive(Clone)]
struct AppState {
    grpc_client: GrpcClient,
    db_pool: db::DbPool,
}

#[derive(Deserialize)]
struct ProcessRequest {
    data: serde_json::Value,
}

#[derive(Serialize)]
struct ProcessResponse {
    success: bool,
    request_id: String,
    message: String,
}

async fn process_data(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(payload): Json<ProcessRequest>,
) -> Json<ProcessResponse> {
    let mut client = state.grpc_client.lock().await;
    let source_id = uuid::Uuid::new_v4().to_string();
    let json_string = serde_json::to_string(&payload.data).unwrap_or_default();

    println!("📥 Received JSON data, forwarding to encryption server (id: {})", source_id);

    let request = tonic::Request::new(DataRequest {
        json_data: json_string,
        source_id: source_id.clone(),
    });

    match client.process_data(request).await {
        Ok(response) => {
            let res = response.into_inner();
            println!("✅ Encryption server processed data (request_id: {})", res.request_id);
            Json(ProcessResponse {
                success: res.success,
                request_id: res.request_id,
                message: "Data processed and forwarded successfully".to_string(),
            })
        }
        Err(e) => {
            eprintln!("❌ gRPC error: {}", e);
            Json(ProcessResponse {
                success: false,
                request_id: String::new(),
                message: format!("Failed to process: {}", e),
            })
        }
    }
}

#[derive(Deserialize)]
struct DbQuery {
    db: Option<String>,
}

async fn list_databases(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    match db::get_all_databases(&state.db_pool).await {
        Ok(dbs) => Json(serde_json::json!({ "success": true, "databases": dbs })),
        Err(e) => {
            eprintln!("❌ Failed to list databases: {}", e);
            Json(serde_json::json!({ "success": false, "error": e.to_string() }))
        }
    }
}

async fn get_db_metadata(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Query(query): axum::extract::Query<DbQuery>,
) -> Json<serde_json::Value> {
    let db_name = query.db.unwrap_or_else(|| std::env::var("POSTGRES_DB").unwrap_or_else(|_| "pipeline_db".to_string()));
    println!("📊 Fetching database metadata for {}...", db_name);

    let client = match db::connect_to_db(&db_name).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to connect to db {}: {}", db_name, e);
            return Json(serde_json::json!({ "success": false, "error": format!("Connection failed: {}", e) }));
        }
    };

    // Get database metadata
    let db_info = match db::get_database_metadata(&client).await {
        Ok(info) => info,
        Err(e) => {
            eprintln!("❌ Failed to get database metadata: {}", e);
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to fetch metadata: {}", e)
            }));
        }
    };

    // Get all tables
    let tables = match db::get_all_tables(&client).await {
        Ok(tables) => tables,
        Err(e) => {
            eprintln!("❌ Failed to get tables: {}", e);
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to fetch tables: {}", e)
            }));
        }
    };

    println!("✅ Retrieved metadata: {} tables", tables.len());

    // Convert to proto messages and forward to encryption server
    let request_id = uuid::Uuid::new_v4().to_string();

    let proto_db_info = DatabaseInfo {
        database_name: db_info.database_name.clone(),
        database_size: db_info.database_size.clone(),
        table_count: db_info.table_count,
        postgres_version: db_info.postgres_version.clone(),
        timestamp: db_info.timestamp.clone(),
    };

    let proto_tables: Vec<TableInfo> = tables.iter().map(|t| TableInfo {
        table_name: t.table_name.clone(),
        schema_name: t.schema_name.clone(),
        row_count: t.row_count,
        table_size: t.table_size.clone(),
        columns: t.columns.iter().map(|c| ColumnInfo {
            column_name: c.column_name.clone(),
            data_type: c.data_type.clone(),
            is_nullable: c.is_nullable,
            default_value: c.default_value.clone(),
        }).collect(),
    }).collect();

    let mut client = state.grpc_client.lock().await;
    let grpc_request = tonic::Request::new(DbMetadataRequest {
        request_id: request_id.clone(),
        database_info: Some(proto_db_info),
        tables: proto_tables,
    });

    match client.process_db_metadata(grpc_request).await {
        Ok(response) => {
            let res = response.into_inner();
            println!("✅ DB metadata forwarded to encryption server");
            Json(serde_json::json!({
                "success": res.success,
                "request_id": request_id,
                "database": {
                    "name": db_info.database_name,
                    "size": db_info.database_size,
                    "table_count": db_info.table_count,
                    "version": db_info.postgres_version,
                },
                "tables": tables.iter().map(|t| serde_json::json!({
                    "name": t.table_name,
                    "schema": t.schema_name,
                    "row_count": t.row_count,
                    "size": t.table_size,
                    "columns": t.columns.len(),
                })).collect::<Vec<_>>()
            }))
        }
        Err(e) => {
            eprintln!("❌ Failed to forward metadata: {}", e);
            Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to forward: {}", e)
            }))
        }
    }
}

async fn connect_to_encryption_server(
    url: &str,
    tls_config: ClientTlsConfig,
) -> Result<EncryptionServiceClient<Channel>, Box<dyn std::error::Error>> {
    let max_retries = 15;
    for attempt in 1..=max_retries {
        match Channel::from_shared(url.to_string())?
            .tls_config(tls_config.clone())?
            .connect()
            .await
        {
            Ok(channel) => return Ok(EncryptionServiceClient::new(channel)),
            Err(e) => {
                if attempt == max_retries {
                    return Err(Box::new(e));
                }
                eprintln!(
                    "⏳ Encryption server not ready (attempt {}/{}): {}. Retrying in 2s...",
                    attempt, max_retries, e
                );
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
    unreachable!()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let encryption_host =
        std::env::var("ENCRYPTION_SERVER_HOST").unwrap_or_else(|_| "localhost".to_string());
    let certs_dir = std::env::var("CERTS_DIR").unwrap_or_else(|_| "./certs".to_string());
    let encryption_url = format!("https://{}:3004", encryption_host);

    // Initialize database pool
    println!("🔌 Connecting to PostgreSQL...");
    let db_pool = db::create_pool().await?;

    println!(
        "🔄 Connecting to Encryption Server at {} (mTLS)...",
        encryption_url
    );

    // Load mTLS certificates
    let ca_cert = std::fs::read_to_string(format!("{}/ca.pem", certs_dir))?;
    let client_cert = std::fs::read_to_string(format!("{}/middleware.pem", certs_dir))?;
    let client_key = std::fs::read_to_string(format!("{}/middleware-key.pem", certs_dir))?;

    let tls_config = ClientTlsConfig::new()
        .domain_name(encryption_host.clone())
        .ca_certificate(Certificate::from_pem(&ca_cert))
        .identity(Identity::from_pem(&client_cert, &client_key));

    let client = connect_to_encryption_server(&encryption_url, tls_config).await?;

    println!("🔒 mTLS enabled (ECDSA P-256)");
    println!("✅ Connected to Encryption Server!");

    let grpc_client = Arc::new(Mutex::new(client));

    // Start gRPC CDC Ingestion server in background
    let grpc_client_clone = grpc_client.clone();
    let certs_dir_clone = certs_dir.clone();
    tokio::spawn(async move {
        if let Err(e) = grpc_server::start_grpc_server(grpc_client_clone, certs_dir_clone).await {
            eprintln!("❌ gRPC server error: {}", e);
        }
    });

    let state = AppState {
        grpc_client,
        db_pool,
    };

    let app = Router::new()
        .route("/process", post(process_data))
        .route("/db/metadata", get(get_db_metadata))
        .route("/db/list", get(list_databases))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3003").await?;
    println!("🚀 Middleware (REST) listening on port 3003");
    println!("🚀 Middleware (gRPC CDC) listening on port 3006");
    axum::serve(listener, app).await?;

    Ok(())
}
