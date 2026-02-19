use std::sync::{Arc, Mutex};
use tonic::transport::{Certificate, Identity, Server, ServerTlsConfig};
use tonic::{Request, Response, Status};

pub mod messenger {
    tonic::include_proto!("messenger");
}

use messenger::messenger_server::{Messenger, MessengerServer};
use messenger::{Empty, MessageRequest, MessageResponse, MessagesResponse, StoredMessage};

#[derive(Debug)]
pub struct MyMessenger {
    messages: Arc<Mutex<Vec<StoredMessage>>>,
}

impl MyMessenger {
    fn new() -> Self {
        Self {
            messages: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[tonic::async_trait]
impl Messenger for MyMessenger {
    async fn send_message(
        &self,
        request: Request<MessageRequest>,
    ) -> Result<Response<MessageResponse>, Status> {
        let req = request.into_inner();
        let id = uuid::Uuid::new_v4().to_string();

        let msg = StoredMessage {
            id: id.clone(),
            content: req.content.clone(),
            sender: req.sender.clone(),
            timestamp: req.timestamp,
        };

        self.messages.lock().unwrap().push(msg);

        println!("📩 Received message from '{}': {}", req.sender, req.content);

        Ok(Response::new(MessageResponse {
            success: true,
            id,
        }))
    }

    async fn get_messages(
        &self,
        _request: Request<Empty>,
    ) -> Result<Response<MessagesResponse>, Status> {
        let messages = self.messages.lock().unwrap().clone();
        println!("📋 Returning {} messages", messages.len());
        Ok(Response::new(MessagesResponse { messages }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "0.0.0.0:3004".parse()?;
    let messenger = MyMessenger::new();

    // Load mTLS certificates
    let certs_dir = std::env::var("CERTS_DIR").unwrap_or_else(|_| "../certs".to_string());
    let ca_cert = std::fs::read_to_string(format!("{}/ca.pem", certs_dir))?;
    let server_cert = std::fs::read_to_string(format!("{}/server-b.pem", certs_dir))?;
    let server_key = std::fs::read_to_string(format!("{}/server-b-key.pem", certs_dir))?;

    let identity = Identity::from_pem(&server_cert, &server_key);
    let client_ca = Certificate::from_pem(&ca_cert);

    let tls_config = ServerTlsConfig::new()
        .identity(identity)
        .client_ca_root(client_ca);

    println!("🔒 mTLS enabled (ECDSA P-256)");
    println!("🚀 Server B (gRPC) listening on port 3004");

    Server::builder()
        .tls_config(tls_config)?
        .add_service(MessengerServer::new(messenger))
        .serve(addr)
        .await?;

    Ok(())
}
