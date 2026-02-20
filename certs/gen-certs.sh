#!/usr/bin/env bash
# Generate mTLS certificates using ECDSA P-256 for 3 services:
#   - middleware (client only → connects to encryption-server)
#   - encryption-server (server + client → accepts from middleware, connects to node-server)
#   - node-server (server only → accepts from encryption-server)
# Certs are distributed into each server's certs/ directory.
# All certs are X.509 v3 (required by rustls)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMPDIR=$(mktemp -d)
cd "$TMPDIR"

# ── CA config ──
cat > ca.cnf <<EOF
[req]
distinguished_name = req_dn
x509_extensions = v3_ca
prompt = no

[req_dn]
CN = gRPC Demo CA
O = Demo

[v3_ca]
basicConstraints = critical,CA:TRUE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
keyUsage = critical,keyCertSign,cRLSign
EOF

# ── Encryption-server cert extensions (server + client auth) ──
cat > encryption-server-ext.cnf <<EOF
basicConstraints = CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth,clientAuth
subjectAltName = DNS:localhost,DNS:encryption-server,IP:127.0.0.1
EOF

# ── Node-server cert extensions (server auth only) ──
cat > node-server-ext.cnf <<EOF
basicConstraints = CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,DNS:node-server,IP:127.0.0.1
EOF

# ── Middleware cert extensions (client auth only) ──
cat > middleware-ext.cnf <<EOF
basicConstraints = CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = clientAuth
EOF

echo "🔐 Generating ECDSA P-256 CA (X.509 v3)..."
openssl ecparam -genkey -name prime256v1 -noout -out ca-key.pem
openssl req -new -x509 -key ca-key.pem -out ca.pem -days 365 -config ca.cnf

echo "🔐 Generating Encryption Server certificate (server + client)..."
openssl ecparam -genkey -name prime256v1 -noout -out encryption-server-key.pem
openssl req -new -key encryption-server-key.pem -out encryption-server.csr \
  -subj "/CN=encryption-server/O=Demo"
openssl x509 -req -in encryption-server.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out encryption-server.pem -days 365 \
  -extfile encryption-server-ext.cnf

echo "🔐 Generating Node Server certificate (server)..."
openssl ecparam -genkey -name prime256v1 -noout -out node-server-key.pem
openssl req -new -key node-server-key.pem -out node-server.csr \
  -subj "/CN=node-server/O=Demo"
openssl x509 -req -in node-server.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out node-server.pem -days 365 \
  -extfile node-server-ext.cnf

echo "🔐 Generating Middleware certificate (client)..."
openssl ecparam -genkey -name prime256v1 -noout -out middleware-key.pem
openssl req -new -key middleware-key.pem -out middleware.csr \
  -subj "/CN=middleware/O=Demo"
openssl x509 -req -in middleware.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out middleware.pem -days 365 \
  -extfile middleware-ext.cnf

# ── Distribute certs to each server ──
echo ""
echo "📦 Distributing certs to servers..."

mkdir -p "$ROOT_DIR/middleware/certs"
cp ca.pem middleware.pem middleware-key.pem "$ROOT_DIR/middleware/certs/"

mkdir -p "$ROOT_DIR/encryption-server/certs"
cp ca.pem encryption-server.pem encryption-server-key.pem "$ROOT_DIR/encryption-server/certs/"

mkdir -p "$ROOT_DIR/node-server/certs"
cp ca.pem node-server.pem node-server-key.pem "$ROOT_DIR/node-server/certs/"

# Cleanup temp dir
rm -rf "$TMPDIR"

echo ""
echo "✅ All certificates generated and distributed:"
echo "  middleware/certs/         → ca.pem, middleware.pem, middleware-key.pem"
echo "  encryption-server/certs/ → ca.pem, encryption-server.pem, encryption-server-key.pem"
echo "  node-server/certs/       → ca.pem, node-server.pem, node-server-key.pem"
