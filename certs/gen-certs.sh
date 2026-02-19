#!/usr/bin/env bash
# Generate mTLS certificates using ECDSA P-256 (prime256v1)
# All certs are X.509 v3 (required by rustls)

set -euo pipefail
cd "$(dirname "$0")"

# CA config (v3)
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

# Server cert extensions (SAN includes both localhost and Docker service name)
cat > server-b-ext.cnf <<EOF
basicConstraints = CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:localhost,DNS:server-b,IP:127.0.0.1
EOF

# Client cert extensions
cat > server-a-ext.cnf <<EOF
basicConstraints = CA:FALSE
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = clientAuth
EOF

echo "🔐 Generating ECDSA P-256 CA (X.509 v3)..."
openssl ecparam -genkey -name prime256v1 -noout -out ca-key.pem
openssl req -new -x509 -key ca-key.pem -out ca.pem -days 365 -config ca.cnf

echo "🔐 Generating Server B (gRPC server) certificate (v3)..."
openssl ecparam -genkey -name prime256v1 -noout -out server-b-key.pem
openssl req -new -key server-b-key.pem -out server-b.csr \
  -subj "/CN=server-b/O=Demo"
openssl x509 -req -in server-b.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-b.pem -days 365 \
  -extfile server-b-ext.cnf
rm -f server-b.csr

echo "🔐 Generating Server A (gRPC client) certificate (v3)..."
openssl ecparam -genkey -name prime256v1 -noout -out server-a-key.pem
openssl req -new -key server-a-key.pem -out server-a.csr \
  -subj "/CN=server-a/O=Demo"
openssl x509 -req -in server-a.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-a.pem -days 365 \
  -extfile server-a-ext.cnf
rm -f server-a.csr

rm -f ca.srl ca.cnf server-b-ext.cnf server-a-ext.cnf

echo ""
echo "✅ All certificates generated:"
ls -la *.pem
echo ""
echo "📋 CA certificate version:"
openssl x509 -in ca.pem -text -noout | grep -E "(Version|Public Key Algorithm|ASN1 OID)"
