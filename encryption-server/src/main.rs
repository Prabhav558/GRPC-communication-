use std::sync::Arc;
use tokio::sync::Mutex;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Identity, Server, ServerTlsConfig};
use tonic::{Request, Response, Status};

pub mod pipeline {
    tonic::include_proto!("pipeline");
}

use pipeline::display_service_client::DisplayServiceClient;
use pipeline::encryption_service_server::{EncryptionService, EncryptionServiceServer};
use pipeline::{
    CdcEventDisplayRequest, CdcEventDisplayResponse, CdcEventRequest, CdcEventResponse,
    DataRequest, DataResponse, DbMetadataDisplayRequest, DbMetadataDisplayResponse,
    DbMetadataRequest, DbMetadataResponse, DisplayRequest,
};

pub struct MyEncryptionService {
    display_client: Arc<Mutex<DisplayServiceClient<Channel>>>,
}

#[tonic::async_trait]
impl EncryptionService for MyEncryptionService {
    async fn process_data(
        &self,
        request: Request<DataRequest>,
    ) -> Result<Response<DataResponse>, Status> {
        let req = request.into_inner();
        let request_id = uuid::Uuid::new_v4().to_string();

        println!(
            "📥 Received data from middleware (source_id: {})",
            req.source_id
        );
        println!("📤 Forwarding data to Node Server (request_id: {})", request_id);

        let mut display_client = self.display_client.lock().await;
        let display_request = tonic::Request::new(DisplayRequest {
            json_data: req.json_data,
            request_id: request_id.clone(),
        });

        match display_client.send_to_display(display_request).await {
            Ok(response) => {
                let res = response.into_inner();
                println!(
                    "✅ Node Server acknowledged (display_id: {})",
                    res.display_id
                );
                Ok(Response::new(DataResponse {
                    success: true,
                    request_id,
                }))
            }
            Err(e) => {
                eprintln!("❌ Failed to forward to Node Server: {}", e);
                Err(Status::internal(format!(
                    "Failed to forward to display: {}",
                    e
                )))
            }
        }
    }

    async fn process_db_metadata(
        &self,
        request: Request<DbMetadataRequest>,
    ) -> Result<Response<DbMetadataResponse>, Status> {
        let req = request.into_inner();
        let response_id = uuid::Uuid::new_v4().to_string();

        println!(
            "📊 Received DB metadata from middleware (request_id: {})",
            req.request_id
        );

        let mut display_client = self.display_client.lock().await;
        let display_request = tonic::Request::new(DbMetadataDisplayRequest {
            request_id: req.request_id.clone(),
            database_info: req.database_info,
            tables: req.tables,
        });

        match display_client.send_db_metadata(display_request).await {
            Ok(response) => {
                let res = response.into_inner();
                println!("✅ DB metadata forwarded to Node Server (display_id: {})", res.display_id);
                Ok(Response::new(DbMetadataResponse {
                    success: true,
                    response_id,
                }))
            }
            Err(e) => {
                eprintln!("❌ Failed to forward DB metadata: {}", e);
                Err(Status::internal(format!("Failed to forward DB metadata: {}", e)))
            }
        }
    }

    async fn process_cdc_event(
        &self,
        request: Request<CdcEventRequest>,
    ) -> Result<Response<CdcEventResponse>, Status> {
        let req = request.into_inner();
        let ack_id = uuid::Uuid::new_v4().to_string();

        println!(
            "🔄 Received CDC event: {} on {}.{} (id: {})",
            req.operation, req.schema_name, req.table_name, req.event_id
        );

        let mut display_client = self.display_client.lock().await;
        let display_request = tonic::Request::new(CdcEventDisplayRequest {
            event_id: req.event_id,
            operation: req.operation,
            table_name: req.table_name,
            schema_name: req.schema_name,
            before_data: req.before_data,
            after_data: req.after_data,
            timestamp: req.timestamp,
            lsn: req.lsn,
        });

        match display_client.send_cdc_event(display_request).await {
            Ok(response) => {
                let _res = response.into_inner();
                println!("✅ CDC event forwarded to Node Server");
                Ok(Response::new(CdcEventResponse {
                    success: true,
                    ack_id,
                }))
            }
            Err(e) => {
                eprintln!("❌ Failed to forward CDC event: {}", e);
                Err(Status::internal(format!("Failed to forward CDC event: {}", e)))
            }
        }
    }
}

async fn connect_to_node_server(
    node_server_url: &str,
    tls_config: ClientTlsConfig,
) -> Result<DisplayServiceClient<Channel>, Box<dyn std::error::Error>> {
    let max_retries = 15;
    for attempt in 1..=max_retries {
        match Channel::from_shared(node_server_url.to_string())?
            .tls_config(tls_config.clone())?
            .connect()
            .await
        {
            Ok(channel) => return Ok(DisplayServiceClient::new(channel)),
            Err(e) => {
                if attempt == max_retries {
                    return Err(Box::new(e));
                }
                eprintln!(
                    "⏳ Node Server not ready (attempt {}/{}): {}. Retrying in 2s...",
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
    let addr = "0.0.0.0:3004".parse()?;
    let certs_dir = std::env::var("CERTS_DIR").unwrap_or_else(|_| "./certs".to_string());
    let node_server_host =
        std::env::var("NODE_SERVER_HOST").unwrap_or_else(|_| "localhost".to_string());
    let node_server_url = format!("https://{}:3005", node_server_host);

    // Load certs
    let ca_cert = std::fs::read_to_string(format!("{}/ca.pem", certs_dir))?;
    let server_cert =
        std::fs::read_to_string(format!("{}/encryption-server.pem", certs_dir))?;
    let server_key =
        std::fs::read_to_string(format!("{}/encryption-server-key.pem", certs_dir))?;

    let server_identity = Identity::from_pem(&server_cert, &server_key);
    let client_ca = Certificate::from_pem(&ca_cert);

    let server_tls_config = ServerTlsConfig::new()
        .identity(server_identity)
        .client_ca_root(client_ca);

    // Connect to Node Server with retry
    println!("🔄 Connecting to Node Server at {} (mTLS)...", node_server_url);

    let client_tls_config = ClientTlsConfig::new()
        .domain_name(node_server_host.clone())
        .ca_certificate(Certificate::from_pem(&ca_cert))
        .identity(Identity::from_pem(&server_cert, &server_key));

    let display_client = connect_to_node_server(&node_server_url, client_tls_config).await?;
    println!("✅ Connected to Node Server!");

    let service = MyEncryptionService {
        display_client: Arc::new(Mutex::new(display_client)),
    };

    println!("🔒 mTLS enabled (ECDSA P-256)");
    println!("🚀 Encryption Server (gRPC) listening on port 3004");

    Server::builder()
        .tls_config(server_tls_config)?
        .add_service(EncryptionServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
