package com.grpc.cdc;

import com.grpc.cdc.proto.CdcEventRequest;
import com.grpc.cdc.proto.CdcIngestionServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.netty.GrpcSslContexts;
import io.grpc.netty.NegotiationType;
import io.grpc.netty.NettyChannelBuilder;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;

import javax.net.ssl.SSLException;
import java.io.File;
import java.io.IOException;

/**
 * mTLS gRPC client that sends CDC events to the middleware's CdcIngestionService.
 */
public class CdcGrpcClient {

    private static void log(String msg) {
        System.out.println("[CDC-gRPC] " + msg);
        System.out.flush();
    }

    private final ManagedChannel channel;
    private final CdcIngestionServiceGrpc.CdcIngestionServiceBlockingStub stub;

    public CdcGrpcClient(String middlewareHost, int middlewarePort, String certsDir)
            throws SSLException, IOException {

        log("Loading mTLS certificates from " + certsDir);

        File caCert     = new File(certsDir + "/ca.pem");
        File clientCert = new File(certsDir + "/cdc-service.pem");
        File clientKey  = new File(certsDir + "/cdc-service-key.pem");

        if (!caCert.exists())     throw new IOException("Missing: " + caCert.getAbsolutePath());
        if (!clientCert.exists()) throw new IOException("Missing: " + clientCert.getAbsolutePath());
        if (!clientKey.exists())  throw new IOException("Missing: " + clientKey.getAbsolutePath());

        // Build mTLS SSL context
        SslContext sslContext = GrpcSslContexts.configure(
            SslContextBuilder.forClient()
                .trustManager(caCert)
                .keyManager(clientCert, clientKey)
        ).build();

        log("Connecting to Middleware gRPC CDC at " + middlewareHost + ":" + middlewarePort + " (mTLS)...");

        channel = NettyChannelBuilder
                .forAddress(middlewareHost, middlewarePort)
                .negotiationType(NegotiationType.TLS)
                .sslContext(sslContext)
                .overrideAuthority(middlewareHost)
                .build();

        stub = CdcIngestionServiceGrpc.newBlockingStub(channel);
        log("gRPC channel created successfully");
    }

    public boolean sendCdcEvent(CdcEventRequest request) {
        try {
            var response = stub.ingestCdcEvent(request);
            if (response.getSuccess()) {
                log("✅ Event ACK'd (ack_id: " + response.getAckId() + ")");
                return true;
            } else {
                System.err.println("[CDC-gRPC] ⚠ Middleware returned success=false");
                return false;
            }
        } catch (Exception e) {
            System.err.println("[CDC-gRPC] ❌ gRPC call failed: " + e.getMessage());
            return false;
        }
    }

    public void shutdown() {
        channel.shutdownNow();
    }
}
