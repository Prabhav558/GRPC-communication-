use tonic::transport::{Certificate, Identity, Server, ServerTlsConfig};
use tonic::{Request, Response, Status};
use std::sync::Arc;
use tokio::sync::Mutex;

// Import from the generated pipeline module
use crate::pipeline::cdc_ingestion_service_server::{CdcIngestionService, CdcIngestionServiceServer};
use crate::pipeline::{CdcEventRequest, CdcEventResponse};

pub type GrpcClient = Arc<Mutex<crate::pipeline::encryption_service_client::EncryptionServiceClient<tonic::transport::Channel>>>;

pub struct CdcIngestionServiceImpl {
    pub encryption_client: GrpcClient,
}

#[tonic::async_trait]
impl CdcIngestionService for CdcIngestionServiceImpl {
    async fn ingest_cdc_event(
        &self,
        request: Request<CdcEventRequest>,
    ) -> Result<Response<CdcEventResponse>, Status> {
        let event = request.into_inner();

        println!("📥 CDC Event: {} on {}.{}",
            event.operation, event.schema_name, event.table_name);

        // Forward to encryption server
        let mut client = self.encryption_client.lock().await;

        match client.process_cdc_event(event).await {
            Ok(_) => Ok(Response::new(CdcEventResponse {
                success: true,
                ack_id: uuid::Uuid::new_v4().to_string(),
            })),
            Err(e) => {
                eprintln!("❌ Failed to forward CDC event: {}", e);
                Err(Status::internal(format!("Failed to forward: {}", e)))
            }
        }
    }
}

pub async fn start_grpc_server(
    encryption_client: GrpcClient,
    certs_dir: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let addr = "0.0.0.0:3006".parse()?;

    // Load mTLS certificates (middleware acts as server on port 3006)
    let ca_cert    = std::fs::read_to_string(format!("{}/ca.pem", certs_dir))?;
    let server_cert = std::fs::read_to_string(format!("{}/middleware.pem", certs_dir))?;
    let server_key  = std::fs::read_to_string(format!("{}/middleware-key.pem", certs_dir))?;

    let server_identity = Identity::from_pem(&server_cert, &server_key);
    let client_ca = Certificate::from_pem(&ca_cert);

    // Require client cert (mTLS) — only cdc-service (signed by our CA) can connect
    let tls_config = ServerTlsConfig::new()
        .identity(server_identity)
        .client_ca_root(client_ca);

    let service = CdcIngestionServiceImpl { encryption_client };

    println!("🔒 gRPC CDC Ingestion server — mTLS enabled");
    println!("🚀 Starting gRPC CDC Ingestion server on {}", addr);

    Server::builder()
        .tls_config(tls_config)?
        .add_service(CdcIngestionServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
