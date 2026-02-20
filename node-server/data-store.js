// Shared in-memory data store — uses globalThis so it works
// across both the gRPC server and Next.js API routes in the same process.
if (!globalThis.__pipelineData) {
    globalThis.__pipelineData = [];
}

module.exports = globalThis.__pipelineData;
