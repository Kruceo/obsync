#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
MAX_RETRIES=30
DELAY=2

echo "==> Waiting for MinIO at ${ENDPOINT}..."
for i in $(seq 1 $MAX_RETRIES); do
  if curl -fsS "${ENDPOINT}/minio/health/live" >/dev/null 2>&1; then
    echo "==> MinIO is ready!"
    exit 0
  fi
  echo "   attempt $i/$MAX_RETRIES - waiting ${DELAY}s"
  sleep $DELAY
done

echo "==> Timeout: MinIO did not become ready"
exit 1
