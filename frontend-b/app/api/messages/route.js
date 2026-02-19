import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTO_PATH = path.join(process.cwd(), "..", "proto", "message.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition);
const client = new proto.messenger.Messenger(
    "localhost:3004",
    grpc.credentials.createInsecure()
);

export async function GET() {
    return new Promise((resolve) => {
        client.GetMessages({}, (error, response) => {
            if (error) {
                resolve(
                    new Response(
                        JSON.stringify({ error: error.message, messages: [] }),
                        {
                            status: 500,
                            headers: { "Content-Type": "application/json" },
                        }
                    )
                );
            } else {
                resolve(
                    new Response(JSON.stringify(response), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    })
                );
            }
        });
    });
}
