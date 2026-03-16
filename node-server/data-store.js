// Shared in-memory data store — uses globalThis so it works
// across both the gRPC server and Next.js API routes in the same process.
if (!globalThis.__pipelineData) {
    globalThis.__pipelineData = [];
}

// Latest DB metadata snapshot (from middleware DB queries)
if (!globalThis.__dbMetadata) {
    globalThis.__dbMetadata = null;
}

// CDC event stream — capped at 1000 events (FIFO)
if (!globalThis.__cdcEvents) {
    globalThis.__cdcEvents = [];
}

module.exports = globalThis.__pipelineData;
