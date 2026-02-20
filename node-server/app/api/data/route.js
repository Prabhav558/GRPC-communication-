import { NextResponse } from "next/server";

export async function GET() {
    // Access the shared global data store populated by the gRPC server
    const data = globalThis.__pipelineData || [];
    return NextResponse.json({ data });
}
