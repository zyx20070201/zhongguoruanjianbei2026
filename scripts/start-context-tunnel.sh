#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${CONTEXT_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${CONTEXT_SSH_PORT:-18102}"
SSH_USER="${CONTEXT_SSH_USER:-root}"
LOCAL_HOST="${CONTEXT_LOCAL_HOST:-127.0.0.1}"
LOCAL_QDRANT_PORT="${CONTEXT_LOCAL_QDRANT_PORT:-16333}"
LOCAL_EMBEDDING_PORT="${CONTEXT_LOCAL_EMBEDDING_PORT:-18000}"
LOCAL_RERANKER_PORT="${CONTEXT_LOCAL_RERANKER_PORT:-18001}"
REMOTE_QDRANT_PORT="${CONTEXT_REMOTE_QDRANT_PORT:-6333}"
REMOTE_EMBEDDING_PORT="${CONTEXT_REMOTE_EMBEDDING_PORT:-8000}"
REMOTE_RERANKER_PORT="${CONTEXT_REMOTE_RERANKER_PORT:-8001}"
SSH_PASSWORD="${CONTEXT_SSH_PASSWORD:-}"

check_url() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

if check_url "http://$LOCAL_HOST:$LOCAL_QDRANT_PORT/collections" &&
   check_url "http://$LOCAL_HOST:$LOCAL_EMBEDDING_PORT/health" &&
   check_url "http://$LOCAL_HOST:$LOCAL_RERANKER_PORT/health"; then
  echo "Context tunnel already healthy:"
  echo "  Qdrant    http://$LOCAL_HOST:$LOCAL_QDRANT_PORT"
  echo "  Embedding http://$LOCAL_HOST:$LOCAL_EMBEDDING_PORT"
  echo "  Reranker  http://$LOCAL_HOST:$LOCAL_RERANKER_PORT"
  exit 0
fi

SSH_OPTIONS=(
  -fN
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=6
  -o TCPKeepAlive=yes
  -L "$LOCAL_HOST:$LOCAL_QDRANT_PORT:127.0.0.1:$REMOTE_QDRANT_PORT"
  -L "$LOCAL_HOST:$LOCAL_EMBEDDING_PORT:127.0.0.1:$REMOTE_EMBEDDING_PORT"
  -L "$LOCAL_HOST:$LOCAL_RERANKER_PORT:127.0.0.1:$REMOTE_RERANKER_PORT"
  -p "$SSH_PORT"
)

if [[ -n "$SSH_PASSWORD" ]]; then
  askpass_file="${TMPDIR:-/tmp}/pp1-context-askpass.sh"
  cat > "$askpass_file" <<EOF
#!/bin/sh
printf %s "$SSH_PASSWORD"
EOF
  chmod 700 "$askpass_file"
  SSH_ASKPASS="$askpass_file" \
  SSH_ASKPASS_REQUIRE=force \
  DISPLAY="${DISPLAY:-:0}" \
  ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/tmp/pp1-context-known-hosts \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    "${SSH_OPTIONS[@]}" \
    "$SSH_USER@$SSH_HOST" < /dev/null
else
  ssh \
    "${SSH_OPTIONS[@]}" \
    "$SSH_USER@$SSH_HOST"
fi

for _ in {1..20}; do
  if check_url "http://$LOCAL_HOST:$LOCAL_QDRANT_PORT/collections" &&
     check_url "http://$LOCAL_HOST:$LOCAL_EMBEDDING_PORT/health" &&
     check_url "http://$LOCAL_HOST:$LOCAL_RERANKER_PORT/health"; then
    break
  fi
  sleep 0.5
done

if ! check_url "http://$LOCAL_HOST:$LOCAL_QDRANT_PORT/collections" ||
   ! check_url "http://$LOCAL_HOST:$LOCAL_EMBEDDING_PORT/health" ||
   ! check_url "http://$LOCAL_HOST:$LOCAL_RERANKER_PORT/health"; then
  echo "Context tunnel was created but health checks failed." >&2
  echo "Check whether local ports are occupied by a stale tunnel or whether AutoDL services are running." >&2
  exit 1
fi

echo "Context tunnel started:"
echo "  Qdrant    http://$LOCAL_HOST:$LOCAL_QDRANT_PORT -> 127.0.0.1:$REMOTE_QDRANT_PORT"
echo "  Embedding http://$LOCAL_HOST:$LOCAL_EMBEDDING_PORT -> 127.0.0.1:$REMOTE_EMBEDDING_PORT"
echo "  Reranker  http://$LOCAL_HOST:$LOCAL_RERANKER_PORT -> 127.0.0.1:$REMOTE_RERANKER_PORT"
