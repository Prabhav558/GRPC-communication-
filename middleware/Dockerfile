FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml build.rs ./
COPY proto/ ./proto/
COPY src/ ./src/

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/middleware /usr/local/bin/middleware
COPY certs/ /app/certs/
WORKDIR /app
EXPOSE 3003
CMD ["middleware"]
