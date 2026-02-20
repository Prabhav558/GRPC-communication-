FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml build.rs ./
COPY proto/ ./proto/
COPY src/ ./src/

RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/encryption-server /usr/local/bin/encryption-server
COPY certs/ /app/certs/
WORKDIR /app
EXPOSE 3004
CMD ["encryption-server"]
