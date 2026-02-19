use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Identity};
use tower_http::cors::CorsLayer;

pub mod messenger {
    tonic::include_proto!("messenger");
}

use messenger::messenger_client::MessengerClient;
use messenger::{Empty, MessageRequest};

type GrpcClient = Arc<Mutex<MessengerClient<tonic::transport::Channel>>>;

#[derive(Clone)]
struct AppState {
    grpc_client: GrpcClient,
}

#[derive(Deserialize)]
struct SendRequest {
    content: String,
    sender: String,
}

#[derive(Serialize)]
struct SendResponse {
    success: bool,
    id: String,
    message: String,
}

#[derive(Serialize)]
struct StoredMessageJson {
    id: String,
    content: String,
    sender: String,
    timestamp: i64,
}

#[derive(Serialize)]
struct MessagesJsonResponse {
    messages: Vec<StoredMessageJson>,
}

async fn send_message(
    State(state): State<AppState>,
    Json(payload): Json<SendRequest>,
) -> Json<SendResponse> {
    let mut client = state.grpc_client.lock().await;

    let timestamp = chrono::Utc::now().timestamp();

    let request = tonic::Request::new(MessageRequest {
        content: payload.content.clone(),
        sender: payload.sender.clone(),
        timestamp,
    });

    match client.send_message(request).await {
        Ok(response) => {
            let res = response.into_inner();
            println!(
                "✅ Message sent via gRPC: '{}' from '{}'",
                payload.content, payload.sender
            );
            Json(SendResponse {
                success: res.success,
                id: res.id,
                message: "Message sent successfully!".to_string(),
            })
        }
        Err(e) => {
            eprintln!("❌ gRPC error: {}", e);
            Json(SendResponse {
                success: false,
                id: String::new(),
                message: format!("Failed to send: {}", e),
            })
        }
    }
}

async fn get_messages(State(state): State<AppState>) -> Json<MessagesJsonResponse> {
    let mut client = state.grpc_client.lock().await;

    let request = tonic::Request::new(Empty {});

    match client.get_messages(request).await {
        Ok(response) => {
            let res = response.into_inner();
            let count = res.messages.len();
            let messages = res
                .messages
                .into_iter()
                .map(|m| StoredMessageJson {
                    id: m.id,
                    content: m.content,
                    sender: m.sender,
                    timestamp: m.timestamp,
                })
                .collect();
            println!("📋 Returning {} messages via REST", count);
            Json(MessagesJsonResponse { messages })
        }
        Err(e) => {
            eprintln!("❌ gRPC error fetching messages: {}", e);
            Json(MessagesJsonResponse {
                messages: Vec::new(),
            })
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let server_b_host = std::env::var("SERVER_B_HOST").unwrap_or_else(|_| "localhost".to_string());
    let certs_dir = std::env::var("CERTS_DIR").unwrap_or_else(|_| "../certs".to_string());
    let server_b_url = format!("https://{}:3004", server_b_host);

    println!("🔄 Connecting to Server B at {} (mTLS)...", server_b_url);

    // Load mTLS certificates
    let ca_cert = std::fs::read_to_string(format!("{}/ca.pem", certs_dir))?;
    let client_cert = std::fs::read_to_string(format!("{}/server-a.pem", certs_dir))?;
    let client_key = std::fs::read_to_string(format!("{}/server-a-key.pem", certs_dir))?;

    let tls_config = ClientTlsConfig::new()
        .domain_name(server_b_host.clone())
        .ca_certificate(Certificate::from_pem(&ca_cert))
        .identity(Identity::from_pem(&client_cert, &client_key));

    let channel = Channel::from_shared(server_b_url)?
        .tls_config(tls_config)?
        .connect()
        .await?;

    let client = MessengerClient::new(channel);

    println!("🔒 mTLS enabled (ECDSA P-256)");
    println!("✅ Connected to Server B!");

    let state = AppState {
        grpc_client: Arc::new(Mutex::new(client)),
    };

    let app = Router::new()
        .route("/send", post(send_message))
        .route("/messages", get(get_messages))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3003").await?;
    println!("🚀 Server A (REST) listening on port 3003");
    axum::serve(listener, app).await?;

    Ok(())
}
