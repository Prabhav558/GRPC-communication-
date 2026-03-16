const http = require("http");
const next = require("next");
const { parse } = require("url");
const { startGrpcServer } = require("./grpc-server");

// Initialize the global data stores before anything else
if (!globalThis.__pipelineData) {
    globalThis.__pipelineData = [];
}
if (!globalThis.__dbMetadata) {
    globalThis.__dbMetadata = null;
}
if (!globalThis.__cdcEvents) {
    globalThis.__cdcEvents = [];
}

// Start gRPC server
startGrpcServer();

// Start Next.js programmatically in the SAME process
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    const server = http.createServer((req, res) => {
        const parsedUrl = parse(req.url, true);

        // /api/data — pipeline messages
        if (parsedUrl.pathname === "/api/data") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ data: globalThis.__pipelineData || [] }));
            return;
        }

        // /api/db-metadata — latest DB metadata snapshot
        if (parsedUrl.pathname === "/api/db-metadata") {
            const db = parsedUrl.query.db || "pipeline_db";
            const meta = globalThis.__dbMetadata ? globalThis.__dbMetadata[db] : null;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ metadata: meta || null }));
            return;
        }

        // /api/databases — proxy to middleware to list all valid databases
        if (parsedUrl.pathname === "/api/databases") {
            fetch("http://middleware:3003/db/list")
                .then(r => r.json())
                .then(data => {
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(data));
                })
                .catch(err => {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                });
            return;
        }

        // /api/trigger-db-fetch — trigger a fresh metadata fetch for a specific DB
        if (parsedUrl.pathname === "/api/trigger-db-fetch") {
            const db = parsedUrl.query.db || "pipeline_db";
            fetch(`http://middleware:3003/db/metadata?db=${encodeURIComponent(db)}`)
                .then(r => r.json())
                .then(data => {
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(data));
                })
                .catch(err => {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: err.message }));
                });
            return;
        }

        // /api/cdc-events — CDC event stream (most recent last, optional limit)
        if (parsedUrl.pathname === "/api/cdc-events") {
            const limit = parseInt(parsedUrl.query.limit || "100", 10);
            const events = globalThis.__cdcEvents || [];
            const sliced = events.slice(-limit).reverse();
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ events: sliced, total: events.length }));
            return;
        }

        handle(req, res, parsedUrl);
    });

    server.listen(3000, "0.0.0.0", () => {
        console.log("🚀 Next.js frontend listening on http://0.0.0.0:3000");
    });
});
