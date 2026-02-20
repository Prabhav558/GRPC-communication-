const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");
const path = require("path");

// Shared in-memory data store
const dataStore = require("./data-store");

const PROTO_PATH = process.env.PROTO_PATH || path.join(__dirname, "proto/message.proto");
const CERTS_DIR = process.env.CERTS_DIR || path.join(__dirname, "certs");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const pipeline = grpc.loadPackageDefinition(packageDefinition).pipeline;

// DisplayService implementation
function sendToDisplay(call, callback) {
    const { json_data, request_id } = call.request;

    console.log(`📥 Received data from encryption server (request_id: ${request_id})`);

    const display_id = `disp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    dataStore.push({
        display_id,
        request_id,
        json_data,
        received_at: new Date().toISOString(),
    });

    console.log(`✅ Data stored for display (display_id: ${display_id}, total: ${dataStore.length})`);

    callback(null, { success: true, display_id });
}

function startGrpcServer() {
    const server = new grpc.Server();

    // Load mTLS certificates
    const caCert = fs.readFileSync(path.join(CERTS_DIR, "ca.pem"));
    const serverCert = fs.readFileSync(path.join(CERTS_DIR, "node-server.pem"));
    const serverKey = fs.readFileSync(path.join(CERTS_DIR, "node-server-key.pem"));

    const tlsCredentials = grpc.ServerCredentials.createSsl(caCert, [
        { cert_chain: serverCert, private_key: serverKey },
    ], true); // requireClientCert = true for mTLS

    server.addService(pipeline.DisplayService.service, {
        sendToDisplay: sendToDisplay,
    });

    server.bindAsync("0.0.0.0:3005", tlsCredentials, (err, port) => {
        if (err) {
            console.error("❌ Failed to start gRPC server:", err);
            process.exit(1);
        }
        console.log(`🔒 mTLS enabled (ECDSA P-256)`);
        console.log(`🚀 Node Server (gRPC) listening on port ${port}`);
    });
}

module.exports = { startGrpcServer };
