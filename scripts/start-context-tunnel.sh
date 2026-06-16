#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${CONTEXT_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${CONTEXT_SSH_PORT:-18102}"
SSH_USER="${CONTEXT_SSH_USER:-root}"
REMOTE_CONTEXT_DIR="${CONTEXT_REMOTE_DIR:-/root/autodl-tmp/context-stack}"
REMOTE_START_SCRIPT="${CONTEXT_REMOTE_START_SCRIPT:-$REMOTE_CONTEXT_DIR/start_context_services.sh}"
REMOTE_ENSURE_SERVICES="${CONTEXT_REMOTE_ENSURE_SERVICES:-1}"
LOCAL_HOST="${CONTEXT_LOCAL_HOST:-127.0.0.1}"
LOCAL_QDRANT_PORT="${CONTEXT_LOCAL_QDRANT_PORT:-16333}"
LOCAL_EMBEDDING_PORT="${CONTEXT_LOCAL_EMBEDDING_PORT:-18000}"
LOCAL_RERANKER_PORT="${CONTEXT_LOCAL_RERANKER_PORT:-18001}"
REMOTE_QDRANT_PORT="${CONTEXT_REMOTE_QDRANT_PORT:-6333}"
REMOTE_EMBEDDING_PORT="${CONTEXT_REMOTE_EMBEDDING_PORT:-8000}"
REMOTE_RERANKER_PORT="${CONTEXT_REMOTE_RERANKER_PORT:-8001}"
SSH_PASSWORD="${CONTEXT_SSH_PASSWORD:-}"
ASKPASS_FILE=""

cleanup() {
  if [[ -n "$ASKPASS_FILE" ]]; then
    rm -f "$ASKPASS_FILE"
  fi
}
trap cleanup EXIT

check_url() {
  local url="$1"
  curl -fsS --max-time 3 "$url" >/dev/null 2>&1
}

prepare_askpass() {
  if [[ -z "$SSH_PASSWORD" || -n "$ASKPASS_FILE" ]]; then
    return
  fi
  ASKPASS_FILE="${TMPDIR:-/tmp}/pp1-context-askpass-$$.sh"
  cat > "$ASKPASS_FILE" <<EOF
#!/bin/sh
printf %s "$SSH_PASSWORD"
EOF
  chmod 700 "$ASKPASS_FILE"
}

ssh_base_options() {
  echo \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/tmp/pp1-context-known-hosts \
    -o ConnectTimeout=10 \
    -p "$SSH_PORT"
}

run_ssh() {
  prepare_askpass
  if [[ -n "$SSH_PASSWORD" ]]; then
    SSH_ASKPASS="$ASKPASS_FILE" \
    SSH_ASKPASS_REQUIRE=force \
    DISPLAY="${DISPLAY:-:0}" \
    ssh \
      $(ssh_base_options) \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      "$SSH_USER@$SSH_HOST" \
      "$@" < /dev/null
  else
    ssh \
      $(ssh_base_options) \
      "$SSH_USER@$SSH_HOST" \
      "$@"
  fi
}

remote_health_command() {
  cat <<EOF
curl -fsS --max-time 3 http://127.0.0.1:$REMOTE_QDRANT_PORT/collections >/dev/null &&
curl -fsS --max-time 3 http://127.0.0.1:$REMOTE_EMBEDDING_PORT/health >/dev/null &&
curl -fsS --max-time 3 http://127.0.0.1:$REMOTE_RERANKER_PORT/health >/dev/null
EOF
}

ensure_remote_services() {
  if [[ "$REMOTE_ENSURE_SERVICES" == "0" ]]; then
    return
  fi

  if run_ssh "$(remote_health_command)"; then
    echo "AutoDL context services already healthy:"
    echo "  Qdrant    127.0.0.1:$REMOTE_QDRANT_PORT"
    echo "  Embedding 127.0.0.1:$REMOTE_EMBEDDING_PORT"
    echo "  Reranker  127.0.0.1:$REMOTE_RERANKER_PORT"
    return
  fi

  echo "AutoDL context services are not healthy; starting them..."
  run_ssh "cd '$REMOTE_CONTEXT_DIR' && bash '$REMOTE_START_SCRIPT'"

  for _ in {1..30}; do
    if run_ssh "$(remote_health_command)"; then
      echo "AutoDL context services are healthy after startup."
      return
    fi
    sleep 2
  done

  echo "AutoDL context services did not become healthy after startup." >&2
  exit 1
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

ensure_remote_services

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
  prepare_askpass
  SSH_ASKPASS="$ASKPASS_FILE" \
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
