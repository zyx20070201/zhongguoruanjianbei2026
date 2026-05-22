#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${AI_COURSE_KG_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${AI_COURSE_KG_SSH_PORT:-23428}"
SSH_USER="${AI_COURSE_KG_SSH_USER:-root}"
REMOTE_DIR="${AI_COURSE_KG_REMOTE_DIR:-/root/autodl-tmp/pp1-ai-course-kg}"
REMOTE_PORT="${AI_COURSE_KG_REMOTE_PORT:-8101}"
LOCAL_PORT="${AI_COURSE_KG_LOCAL_PORT:-18101}"
API_KEY="${AI_COURSE_KG_API_KEY:-pp1-ai-course-kg-local}"
SSH_PASSWORD="${AI_COURSE_KG_SSH_PASSWORD:-}"
ENV_FILE="${AI_COURSE_KG_ENV_FILE:-backend/.env}"
WORKER_FILE="${AI_COURSE_KG_WORKER_FILE:-scripts/autodl-ai-course-kg-worker.py}"
ONEKE_ROOT="${AI_COURSE_KG_ONEKE_ROOT:-/root/autodl-tmp/OneKE}"

ssh_target="$SSH_USER@$SSH_HOST"

env_file_value() {
  local key="$1"
  if [[ -f "$ENV_FILE" ]]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

OPENAI_API_KEY_VALUE="${AI_COURSE_KG_DEPLOY_OPENAI_API_KEY:-$(env_file_value OPENAI_API_KEY)}"
OPENAI_BASE_URL_VALUE="${AI_COURSE_KG_DEPLOY_OPENAI_BASE_URL:-$(env_file_value OPENAI_BASE_URL)}"
OPENAI_API_MODE_VALUE="${AI_COURSE_KG_DEPLOY_OPENAI_API_MODE:-$(env_file_value OPENAI_API_MODE)}"
AI_COURSE_KG_MODEL_VALUE="${AI_COURSE_KG_MODEL:-$(env_file_value AI_LEARNING_MODEL)}"
if [[ -z "$AI_COURSE_KG_MODEL_VALUE" ]]; then
  AI_COURSE_KG_MODEL_VALUE="${AI_COURSE_KG_DEPLOY_OPENAI_MODEL:-$(env_file_value OPENAI_MODEL)}"
fi
if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  OPENAI_API_KEY_VALUE="${OPENAI_API_KEY:-}"
fi
if [[ -z "$OPENAI_BASE_URL_VALUE" ]]; then
  OPENAI_BASE_URL_VALUE="${OPENAI_BASE_URL:-}"
fi
if [[ -z "$OPENAI_API_MODE_VALUE" ]]; then
  OPENAI_API_MODE_VALUE="${OPENAI_API_MODE:-}"
fi
if [[ -z "$AI_COURSE_KG_MODEL_VALUE" ]]; then
  AI_COURSE_KG_MODEL_VALUE="${OPENAI_MODEL:-}"
fi

echo "Deploying AI course KG worker to $ssh_target:$REMOTE_DIR"

if [[ ! -f "$WORKER_FILE" ]]; then
  echo "Worker file not found: $WORKER_FILE" >&2
  exit 1
fi
if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  echo "OPENAI_API_KEY is required. Export it or set it in $ENV_FILE." >&2
  exit 1
fi

ssh_run() {
  local command="$1"
  if [[ -n "$SSH_PASSWORD" ]]; then
    local output
    local status
    set +e
    output=$(
    AI_COURSE_KG_EXPECT_PASSWORD="$SSH_PASSWORD" \
    AI_COURSE_KG_EXPECT_PORT="$SSH_PORT" \
    AI_COURSE_KG_EXPECT_TARGET="$ssh_target" \
    AI_COURSE_KG_EXPECT_COMMAND="$command" \
    expect -c '
      set timeout -1
      spawn ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-ai-course-kg-known-hosts -p $env(AI_COURSE_KG_EXPECT_PORT) $env(AI_COURSE_KG_EXPECT_TARGET) $env(AI_COURSE_KG_EXPECT_COMMAND)
      expect {
        -re "yes/no" { send "yes\r"; exp_continue }
        -re "password:" { send "$env(AI_COURSE_KG_EXPECT_PASSWORD)\r"; exp_continue }
        eof
      }
    '
    )
    status=$?
    set -e
    printf '%s\n' "$output"
    if [[ $status -ne 0 || "$output" == *"Could not resolve hostname"* || "$output" == *"Permission denied"* ]]; then
      return 1
    fi
  else
    ssh -tt -p "$SSH_PORT" "$ssh_target" "$command"
  fi
}

scp_run() {
  local source="$1"
  local target="$2"
  if [[ -n "$SSH_PASSWORD" ]]; then
    local output
    local status
    set +e
    output=$(
    AI_COURSE_KG_EXPECT_PASSWORD="$SSH_PASSWORD" \
    AI_COURSE_KG_EXPECT_PORT="$SSH_PORT" \
    AI_COURSE_KG_EXPECT_SOURCE="$source" \
    AI_COURSE_KG_EXPECT_TARGET="$target" \
    expect -c '
      set timeout -1
      spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-ai-course-kg-known-hosts -P $env(AI_COURSE_KG_EXPECT_PORT) $env(AI_COURSE_KG_EXPECT_SOURCE) $env(AI_COURSE_KG_EXPECT_TARGET)
      expect {
        -re "yes/no" { send "yes\r"; exp_continue }
        -re "password:" { send "$env(AI_COURSE_KG_EXPECT_PASSWORD)\r"; exp_continue }
        eof
      }
    '
    )
    status=$?
    set -e
    printf '%s\n' "$output"
    if [[ $status -ne 0 || "$output" == *"Could not resolve hostname"* || "$output" == *"Permission denied"* || "$output" == *"Connection closed"* ]]; then
      return 1
    fi
  else
    scp -P "$SSH_PORT" "$source" "$target"
  fi
}

tmp_env="$(mktemp)"
cat > "$tmp_env" <<EOF
AI_COURSE_KG_API_KEY=$API_KEY
OPENAI_API_KEY=$OPENAI_API_KEY_VALUE
OPENAI_BASE_URL=${OPENAI_BASE_URL_VALUE:-https://api.openai.com/v1}
OPENAI_API_MODE=${OPENAI_API_MODE_VALUE:-chat_completions}
AI_COURSE_KG_MODEL=${AI_COURSE_KG_MODEL_VALUE:-gpt-5.4}
AI_COURSE_KG_LLM_TIMEOUT_MS=${AI_COURSE_KG_LLM_TIMEOUT_MS:-90000}
ONEKE_ROOT=$ONEKE_ROOT
EOF

ssh_run "mkdir -p '$REMOTE_DIR'"
scp_run "$WORKER_FILE" "$ssh_target:$REMOTE_DIR/app.py"
scp_run "$tmp_env" "$ssh_target:$REMOTE_DIR/service.env"
rm -f "$tmp_env"

ssh_run "
set -e
cd '$REMOTE_DIR'
PYTHON_BIN='/root/miniconda3/bin/python'
if [ ! -x \"\$PYTHON_BIN\" ]; then
  PYTHON_BIN=\"\$(command -v python3 || command -v python)\"
fi
\"\$PYTHON_BIN\" -m pip install -U pip >/dev/null
\"\$PYTHON_BIN\" -m pip install -U fastapi uvicorn pydantic openai==1.55.3 langchain==0.3.3 langchain-core==0.3.10 langchain-openai==0.2.0 langchain-community==0.3.2 beautifulsoup4==4.12.3 docx2txt==0.9 pypdf==4.3.1 nltk==3.9.1 rapidfuzz==3.10.1 neo4j==5.28.1 transformers >/dev/null
if [ ! -d '$ONEKE_ROOT/.git' ]; then
  rm -rf '$ONEKE_ROOT'
  git clone --depth 1 https://github.com/zjunlp/OneKE.git '$ONEKE_ROOT'
fi
screen -S pp1-ai-course-kg -X quit >/dev/null 2>&1 || true
: > '$REMOTE_DIR/server.log'
screen -dmS pp1-ai-course-kg bash -lc \"cd '$REMOTE_DIR' && set -a && . '$REMOTE_DIR/service.env' && set +a && exec '\$PYTHON_BIN' -m uvicorn app:app --host 127.0.0.1 --port '$REMOTE_PORT' > '$REMOTE_DIR/server.log' 2>&1\"
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:$REMOTE_PORT/health; then
    break
  fi
  sleep 1
  if [ \"\$attempt\" = 5 ]; then
    echo 'AI course KG worker failed to become healthy. Recent server.log:' >&2
    tail -n 120 '$REMOTE_DIR/server.log' >&2 || true
    screen -ls >&2 || true
    exit 1
  fi
done
"

pkill -f "127.0.0.1:$REMOTE_PORT" >/dev/null 2>&1 || true
if [[ -n "$SSH_PASSWORD" ]]; then
  tunnel_output=$(
  AI_COURSE_KG_EXPECT_PASSWORD="$SSH_PASSWORD" \
  AI_COURSE_KG_EXPECT_PORT="$SSH_PORT" \
  AI_COURSE_KG_EXPECT_LOCAL_PORT="$LOCAL_PORT" \
  AI_COURSE_KG_EXPECT_REMOTE_PORT="$REMOTE_PORT" \
  AI_COURSE_KG_EXPECT_TARGET="$ssh_target" \
  expect -c '
    set timeout -1
    set forward "$env(AI_COURSE_KG_EXPECT_LOCAL_PORT):127.0.0.1:$env(AI_COURSE_KG_EXPECT_REMOTE_PORT)"
    spawn ssh -fN -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-ai-course-kg-known-hosts -o ServerAliveInterval=15 -o ServerAliveCountMax=6 -L $forward -p $env(AI_COURSE_KG_EXPECT_PORT) $env(AI_COURSE_KG_EXPECT_TARGET)
    expect {
      -re "yes/no" { send "yes\r"; exp_continue }
      -re "password:" { send "$env(AI_COURSE_KG_EXPECT_PASSWORD)\r"; exp_continue }
      eof
    }
  '
  )
  printf '%s\n' "$tunnel_output"
  if [[ "$tunnel_output" == *"Could not resolve hostname"* || "$tunnel_output" == *"Permission denied"* ]]; then
    exit 1
  fi
else
  ssh -fN \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=6 \
    -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
    -p "$SSH_PORT" \
    "$ssh_target"
fi

echo
echo "AI course KG tunnel:"
echo "  http://127.0.0.1:$LOCAL_PORT -> AutoDL 127.0.0.1:$REMOTE_PORT"
