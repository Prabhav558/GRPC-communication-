import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_B_HOST = process.env.SERVER_B_HOST || "localhost";
const CERTS_DIR = process.env.CERTS_DIR || path.join(process.cwd(), "..", "certs");
const PROTO_PATH = process.env.PROTO_PATH || path.join(process.cwd(), "..", "proto", "message.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

// Load mTLS certificates
const ca = fs.readFileSync(path.join(CERTS_DIR, "ca.pem"));
const clientCert = fs.readFileSync(path.join(CERTS_DIR, "server-a.pem"));
const clientKey = fs.readFileSync(path.join(CERTS_DIR, "server-a-key.pem"));

const proto = grpc.loadPackageDefinition(packageDefinition);
const client = new proto.messenger.Messenger(
    `${SERVER_B_HOST}:3004`,
    grpc.credentials.createSsl(ca, clientKey, clientCert)
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
