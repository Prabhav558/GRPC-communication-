use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Identity};
use tower_http::cors::CorsLayer;

pub mod pipeline {
    tonic::include_proto!("pipeline");
}

use pipeline::encryption_service_client::EncryptionServiceClient;
use pipeline::DataRequest;

type GrpcClient = Arc<Mutex<EncryptionServiceClient<tonic::transport::Channel>>>;

#[derive(Clone)]
struct AppState {
    grpc_client: GrpcClient,
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

    let state = AppState {
        grpc_client: Arc::new(Mutex::new(client)),
    };

    let app = Router::new()
        .route("/process", post(process_data))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3003").await?;
    println!("🚀 Middleware (REST) listening on port 3003");
    axum::serve(listener, app).await?;

    Ok(())
}
