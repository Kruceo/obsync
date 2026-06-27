#!/usr/bin/env bash
set -euo pipefail

# Optional standalone script to create the obsidian-vault bucket via MinIO Client (mc).
# The preferred setup runs automatically via the 'minio-setup' service in docker-compose.yml.

MINIO_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-minioadmin}"
ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
BUCKET="${S3_BUCKET:-obsidian-vault}"

echo "==> Setting up MinIO at ${ENDPOINT}"
mc alias set local "${ENDPOINT}" "${MINIO_USER}" "${MINIO_PASS}" --api S3v4
mc mb "local/${BUCKET}" --ignore-existing
mc anonymous set download "local/${BUCKET}"

echo "==> Bucket '${BUCKET}' is ready at ${ENDPOINT}"
