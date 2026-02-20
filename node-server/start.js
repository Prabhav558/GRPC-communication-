const http = require("http");
const next = require("next");
const { parse } = require("url");
const { startGrpcServer } = require("./grpc-server");

// Initialize the global data store before anything else
if (!globalThis.__pipelineData) {
    globalThis.__pipelineData = [];
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

        // Custom /api/data handler — same process, same globalThis
        if (parsedUrl.pathname === "/api/data") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ data: globalThis.__pipelineData || [] }));
            return;
        }

        handle(req, res, parsedUrl);
    });

    server.listen(3000, "0.0.0.0", () => {
        console.log("🚀 Next.js frontend listening on http://0.0.0.0:3000");
    });
});
