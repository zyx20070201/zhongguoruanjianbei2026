#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${CONTEXT_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${CONTEXT_SSH_PORT:-18102}"
SSH_USER="${CONTEXT_SSH_USER:-root}"
REMOTE_CONTEXT_DIR="${CONTEXT_REMOTE_DIR:-/root/autodl-tmp/context-stack}"
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

prepare_askpass() {
  if [[ -z "$SSH_PASSWORD" || -n "$ASKPASS_FILE" ]]; then
    return
  fi
  ASKPASS_FILE="${TMPDIR:-/tmp}/pp1-context-watchdog-askpass-$$.sh"
  cat > "$ASKPASS_FILE" <<EOF
#!/bin/sh
printf %s "$SSH_PASSWORD"
EOF
  chmod 700 "$ASKPASS_FILE"
}

run_ssh() {
  prepare_askpass
  if [[ -n "$SSH_PASSWORD" ]]; then
    SSH_ASKPASS="$ASKPASS_FILE" \
    SSH_ASKPASS_REQUIRE=force \
    DISPLAY="${DISPLAY:-:0}" \
    ssh \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/tmp/pp1-context-known-hosts \
      -o ConnectTimeout=10 \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -p "$SSH_PORT" \
      "$SSH_USER@$SSH_HOST" \
      "$@" < /dev/null
  else
    ssh \
      -o ConnectTimeout=10 \
      -p "$SSH_PORT" \
      "$SSH_USER@$SSH_HOST" \
      "$@"
  fi
}

remote_install_command=$(cat <<EOF
set -euo pipefail
mkdir -p '$REMOTE_CONTEXT_DIR/logs'
cat > '$REMOTE_CONTEXT_DIR/context_watchdog.sh' <<'WATCHDOG'
#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="\${CONTEXT_REMOTE_DIR:-/root/autodl-tmp/context-stack}"
LOG_DIR="\$BASE_DIR/logs"
START_SCRIPT="\$BASE_DIR/start_context_services.sh"
QDRANT_PORT="\${CONTEXT_REMOTE_QDRANT_PORT:-6333}"
EMBEDDING_PORT="\${CONTEXT_REMOTE_EMBEDDING_PORT:-8000}"
RERANKER_PORT="\${CONTEXT_REMOTE_RERANKER_PORT:-8001}"

healthy() {
  curl -fsS --max-time 3 "http://127.0.0.1:\$QDRANT_PORT/collections" >/dev/null &&
  curl -fsS --max-time 3 "http://127.0.0.1:\$EMBEDDING_PORT/health" >/dev/null &&
  curl -fsS --max-time 3 "http://127.0.0.1:\$RERANKER_PORT/health" >/dev/null
}

mkdir -p "\$LOG_DIR"
while true; do
  if ! healthy; then
    {
      echo "[\$(date -Is)] context stack unhealthy; restarting"
      cd "\$BASE_DIR"
      bash "\$START_SCRIPT"
    } >> "\$LOG_DIR/watchdog.log" 2>&1 || true
  fi
  sleep "\${CONTEXT_WATCHDOG_INTERVAL_SECONDS:-60}"
done
WATCHDOG
chmod +x '$REMOTE_CONTEXT_DIR/context_watchdog.sh'
if ! ps -ef | grep -F '$REMOTE_CONTEXT_DIR/context_watchdog.sh' | grep -v grep >/dev/null; then
  nohup bash '$REMOTE_CONTEXT_DIR/context_watchdog.sh' >> '$REMOTE_CONTEXT_DIR/logs/watchdog.log' 2>&1 &
fi
echo "Context watchdog installed and running from $REMOTE_CONTEXT_DIR/context_watchdog.sh"
ps -ef | grep -F '$REMOTE_CONTEXT_DIR/context_watchdog.sh' | grep -v grep || true
EOF
)

run_ssh "$remote_install_command"
