FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY proto/ /app/proto/
COPY server-a/Cargo.toml server-a/Cargo.lock ./server-a/
COPY server-a/build.rs ./server-a/
COPY server-a/src/ ./server-a/src/

WORKDIR /app/server-a
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/server-a/target/release/server-a /usr/local/bin/server-a
COPY certs/ /app/certs/
WORKDIR /app
EXPOSE 3003
CMD ["server-a"]
