FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY proto/ /app/proto/
COPY server-b/Cargo.toml server-b/Cargo.lock ./server-b/
COPY server-b/build.rs ./server-b/
COPY server-b/src/ ./server-b/src/

WORKDIR /app/server-b
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/server-b/target/release/server-b /usr/local/bin/server-b
COPY certs/ /app/certs/
WORKDIR /app
EXPOSE 3004
CMD ["server-b"]
