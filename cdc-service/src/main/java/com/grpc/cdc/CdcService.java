package com.grpc.cdc;

import com.google.gson.Gson;
import com.grpc.cdc.proto.CdcEventRequest;
import io.debezium.engine.ChangeEvent;
import io.debezium.engine.DebeziumEngine;
import io.debezium.engine.format.Json;

import java.io.IOException;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Main CDC service that:
 *  1. Connects to the middleware via mTLS gRPC
 *  2. Starts a Debezium Embedded Engine watching PostgreSQL WAL
 *  3. For each change event, builds a CdcEventRequest and sends it to middleware
 */
public class CdcService {

    private static final Gson gson = new Gson();

    private static void log(String msg) {
        System.out.println("[CDC] " + msg);
        System.out.flush();
    }

    public static void main(String[] args) throws Exception {
        // ── Configuration from environment ──────────────────────────────────
        String postgresHost = env("POSTGRES_HOST", "localhost");
        String postgresPort = env("POSTGRES_PORT", "5432");
        String postgresDb   = env("POSTGRES_DB",   "pipeline_db");
        String postgresUser = env("POSTGRES_USER", "pipeline_user");
        String postgresPass = env("POSTGRES_PASSWORD", "pipeline_pass");
        String middlewareHost = env("MIDDLEWARE_HOST", "middleware");
        int    middlewarePort = Integer.parseInt(env("MIDDLEWARE_PORT", "3006"));
        String certsDir       = env("CERTS_DIR", "/app/certs");
        String dataDir        = env("DATA_DIR",  "/app/data");

        log("🚀 CDC Service starting...");
        log("  PostgreSQL:  " + postgresHost + ":" + postgresPort + "/" + postgresDb);
        log("  Middleware:  " + middlewareHost + ":" + middlewarePort + " (mTLS gRPC)");
        log("  Certs:       " + certsDir);
        log("  Data:        " + dataDir);

        // Ensure data directory exists
        new java.io.File(dataDir).mkdirs();

        // ── Connect gRPC client (with retry) ────────────────────────────────
        CdcGrpcClient grpcClient = connectWithRetry(middlewareHost, middlewarePort, certsDir);
        log("✅ gRPC client connected to middleware!");

        // ── Debezium configuration ───────────────────────────────────────────
        Properties props = new Properties();
        props.setProperty("name",            "postgres-cdc-connector");
        props.setProperty("connector.class", "io.debezium.connector.postgresql.PostgresConnector");

        // Offset storage
        props.setProperty("offset.storage",               "org.apache.kafka.connect.storage.FileOffsetBackingStore");
        props.setProperty("offset.storage.file.filename", dataDir + "/offsets.dat");
        props.setProperty("offset.flush.interval.ms",    "1000");

        // PostgreSQL connection
        props.setProperty("database.hostname",    postgresHost);
        props.setProperty("database.port",        postgresPort);
        props.setProperty("database.user",        postgresUser);
        props.setProperty("database.password",    postgresPass);
        props.setProperty("database.dbname",      postgresDb);
        props.setProperty("database.server.name", "pipeline_postgres");

        // Use pgoutput logical decoding plugin
        props.setProperty("plugin.name",       "pgoutput");
        props.setProperty("slot.name",         "debezium_slot");
        props.setProperty("publication.name",  "debezium_publication");

        // Watch all tables in app_data schema
        props.setProperty("schema.include.list", "app_data");

        // Schema history
        props.setProperty("schema.history.internal",               "io.debezium.storage.file.history.FileSchemaHistory");
        props.setProperty("schema.history.internal.file.filename", dataDir + "/schema-history.dat");

        props.setProperty("decimal.handling.mode", "string");
        // Emit before image for UPDATE/DELETE
        props.setProperty("table.include.list", "app_data.users,app_data.orders");

        // ── Build and run Debezium engine ────────────────────────────────────
        final CdcGrpcClient client = grpcClient;

        log("🔧 Building Debezium engine...");
        DebeziumEngine<ChangeEvent<String, String>> engine =
            DebeziumEngine.create(Json.class)
                .using(props)
                .notifying(event -> handleEvent(event, client))
                .build();

        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.execute(engine);

        log("✅ CDC engine started — watching PostgreSQL WAL (slot: debezium_slot)...");

        // Add shutdown hook for graceful stop
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log("🛑 Shutting down CDC engine...");
            try { engine.close(); } catch (IOException e) { e.printStackTrace(); }
            executor.shutdown();
            try {
                if (!executor.awaitTermination(10, TimeUnit.SECONDS)) executor.shutdownNow();
            } catch (InterruptedException ex) { executor.shutdownNow(); }
            client.shutdown();
            log("👋 CDC Service stopped.");
        }));

        // Block forever
        executor.awaitTermination(Long.MAX_VALUE, TimeUnit.SECONDS);
    }

    // ── Event handler ─────────────────────────────────────────────────────────

    @SuppressWarnings("unchecked")
    private static void handleEvent(ChangeEvent<String, String> event, CdcGrpcClient client) {
        String rawValue = event.value();
        if (rawValue == null) return; // Tombstone / heartbeat

        try {
            Map<String, Object> root = gson.fromJson(rawValue, Map.class);
            if (root == null) return;

            Object payloadObj = root.get("payload");
            if (payloadObj == null) return;
            Map<String, Object> payload = (Map<String, Object>) payloadObj;

            String op = (String) payload.get("op");
            if (op == null) return;

            String operation = switch (op) {
                case "c" -> "INSERT";
                case "u" -> "UPDATE";
                case "d" -> "DELETE";
                case "r" -> "READ";
                default  -> op.toUpperCase();
            };

            Map<String, Object> source = (Map<String, Object>) payload.getOrDefault("source", Map.of());
            String schema = (String) source.getOrDefault("schema", "unknown");
            String table  = (String) source.getOrDefault("table",  "unknown");
            Object lsnObj = source.get("lsn");
            long lsn = lsnObj instanceof Number ? ((Number) lsnObj).longValue() : 0L;
            long tsMs = ((Number) payload.getOrDefault("ts_ms", System.currentTimeMillis())).longValue();

            Object before = payload.get("before");
            Object after  = payload.get("after");
            String beforeStr = before != null ? gson.toJson(before) : "";
            String afterStr  = after  != null ? gson.toJson(after)  : "";

            log("🔄 " + operation + " on " + schema + "." + table + " — sending to middleware via gRPC...");

            CdcEventRequest req = CdcEventRequest.newBuilder()
                    .setEventId(UUID.randomUUID().toString())
                    .setOperation(operation)
                    .setSchemaName(schema)
                    .setTableName(table)
                    .setBeforeData(beforeStr)
                    .setAfterData(afterStr)
                    .setTimestamp(tsMs)
                    .setLsn(lsn)
                    .build();

            boolean ok = client.sendCdcEvent(req);
            log(ok ? "✅ Event forwarded successfully" : "⚠ Event forwarding failed (will not retry)");

        } catch (Exception e) {
            System.err.println("[CDC] ❌ Failed to process event: " + e.getMessage());
            e.printStackTrace();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String env(String key, String defaultValue) {
        String v = System.getenv(key);
        return (v != null && !v.isBlank()) ? v : defaultValue;
    }

    private static CdcGrpcClient connectWithRetry(String host, int port, String certsDir)
            throws InterruptedException {
        int maxRetries = 20;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return new CdcGrpcClient(host, port, certsDir);
            } catch (Exception e) {
                if (attempt == maxRetries) {
                    System.err.println("[CDC] ❌ Could not connect after " + maxRetries + " attempts");
                    e.printStackTrace();
                    throw new RuntimeException("Failed to connect to middleware gRPC", e);
                }
                log("⏳ Middleware not ready (attempt " + attempt + "/" + maxRetries + "): " + e.getMessage() + ". Retrying in 3s...");
                Thread.sleep(3000);
            }
        }
        throw new IllegalStateException("unreachable");
    }
}
