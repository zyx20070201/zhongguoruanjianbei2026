#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${VIDEO_ANALYSIS_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${VIDEO_ANALYSIS_SSH_PORT:-23428}"
SSH_USER="${VIDEO_ANALYSIS_SSH_USER:-root}"
LOCAL_PORT="${VIDEO_ANALYSIS_LOCAL_PORT:-18100}"
REMOTE_PORT="${VIDEO_ANALYSIS_REMOTE_PORT:-8100}"
SSH_PASSWORD="${VIDEO_ANALYSIS_SSH_PASSWORD:-}"

if [[ -n "$SSH_PASSWORD" ]]; then
  askpass_file="${TMPDIR:-/tmp}/pp1-video-analysis-askpass.sh"
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
    -o UserKnownHostsFile=/tmp/pp1-video-analysis-known-hosts \
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

echo "Video analysis tunnel started:"
echo "  http://127.0.0.1:$LOCAL_PORT -> 127.0.0.1:$REMOTE_PORT"
