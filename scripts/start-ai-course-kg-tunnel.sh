#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${AI_COURSE_KG_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${AI_COURSE_KG_SSH_PORT:-23428}"
SSH_USER="${AI_COURSE_KG_SSH_USER:-root}"
LOCAL_PORT="${AI_COURSE_KG_LOCAL_PORT:-18101}"
REMOTE_PORT="${AI_COURSE_KG_REMOTE_PORT:-8101}"
SSH_PASSWORD="${AI_COURSE_KG_SSH_PASSWORD:-}"

if [[ -n "$SSH_PASSWORD" ]]; then
  askpass_file="${TMPDIR:-/tmp}/pp1-ai-course-kg-askpass.sh"
  cat > "$askpass_file" <<EOF
#!/bin/sh
printf %s "$SSH_PASSWORD"
EOF
  chmod 700 "$askpass_file"
  SSH_ASKPASS="$askpass_file" \
  SSH_ASKPASS_REQUIRE=force \
  DISPLAY="${DISPLAY:-:0}" \
  ssh -fN \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/tmp/pp1-ai-course-kg-known-hosts \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=6 \
    -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
    -p "$SSH_PORT" \
    "$SSH_USER@$SSH_HOST" < /dev/null
else
  ssh -fN \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=6 \
    -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
    -p "$SSH_PORT" \
    "$SSH_USER@$SSH_HOST"
fi

echo "AI course KG tunnel started:"
echo "  http://127.0.0.1:$LOCAL_PORT -> 127.0.0.1:$REMOTE_PORT"
