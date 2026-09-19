#!/bin/sh
# Generates a self-signed TLS cert if none is provided, then starts the server.
# Replace ./certs/server.crt|server.key with your own certs to use them instead.
set -e

CERT_DIR="${CERT_DIR:-/app/certs}"
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  echo "No TLS cert found in $CERT_DIR, generating a self-signed certificate..."
  openssl req -x509 -newkey rsa:2048 -nodes \
    -subj "/CN=knx2home.local" \
    -keyout "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -days 3650
  chmod 600 "$CERT_DIR/server.key"
fi

exec node server.js
