#!/usr/bin/env bash
set -euo pipefail

QDRANT_BASE_URL="${QDRANT_BASE_URL:-http://127.0.0.1:${CONTEXT_LOCAL_QDRANT_PORT:-16333}}"
EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-http://127.0.0.1:${CONTEXT_LOCAL_EMBEDDING_PORT:-18000}}"
RERANKER_BASE_URL="${RERANKER_BASE_URL:-http://127.0.0.1:${CONTEXT_LOCAL_RERANKER_PORT:-18001}}"

check_url() {
  local name="$1"
  local url="$2"
  local output
  if output="$(curl -fsS --max-time 3 "$url" 2>&1)"; then
    echo "ok   $name $url"
  else
    echo "fail $name $url"
    echo "     ${output//$'\n'/' '}"
  fi
}

check_url "qdrant" "$QDRANT_BASE_URL/collections"
check_url "embedding" "$EMBEDDING_BASE_URL/health"
check_url "reranker" "$RERANKER_BASE_URL/health"
