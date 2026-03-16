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

// ── Existing handler ────────────────────────────────────────────────────────
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

// ── NEW: DB Metadata handler ────────────────────────────────────────────────
function sendDbMetadata(call, callback) {
    const { request_id, database_info, tables } = call.request;

    console.log(`📊 Received DB metadata (request_id: ${request_id}, tables: ${tables.length})`);

    if (!globalThis.__dbMetadata) globalThis.__dbMetadata = {};

    globalThis.__dbMetadata[database_info.database_name] = {
        request_id,
        database_info,
        tables,
        last_updated: new Date().toISOString(),
    };

    const display_id = `db-meta-${Date.now()}`;
    console.log(`✅ DB metadata stored (display_id: ${display_id})`);

    callback(null, { success: true, display_id });
}

// ── NEW: CDC Event handler ──────────────────────────────────────────────────
function sendCdcEvent(call, callback) {
    const event = call.request;

    console.log(`🔄 Received CDC event: ${event.operation} on ${event.schema_name}.${event.table_name} (id: ${event.event_id})`);

    // Add to CDC events with received timestamp
    if (!globalThis.__cdcEvents) globalThis.__cdcEvents = [];
    globalThis.__cdcEvents.push({
        ...event,
        received_at: new Date().toISOString(),
    });

    // Keep only the last 1000 events (FIFO)
    if (globalThis.__cdcEvents.length > 1000) {
        globalThis.__cdcEvents.shift();
    }

    const display_id = `cdc-${event.event_id || Date.now()}`;
    console.log(`✅ CDC event stored (total: ${globalThis.__cdcEvents.length})`);

    callback(null, { success: true, display_id });
}

// ── Start gRPC server ───────────────────────────────────────────────────────
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
        sendDbMetadata: sendDbMetadata,
        sendCdcEvent: sendCdcEvent,
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
