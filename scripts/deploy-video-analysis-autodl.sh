#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${VIDEO_ANALYSIS_SSH_HOST:-connect.cqa1.seetacloud.com}"
SSH_PORT="${VIDEO_ANALYSIS_SSH_PORT:-23428}"
SSH_USER="${VIDEO_ANALYSIS_SSH_USER:-root}"
REMOTE_DIR="${VIDEO_ANALYSIS_REMOTE_DIR:-/root/autodl-tmp/pp1-video-analysis}"
REMOTE_PORT="${VIDEO_ANALYSIS_REMOTE_PORT:-8100}"
LOCAL_PORT="${VIDEO_ANALYSIS_LOCAL_PORT:-18100}"
API_KEY="${VIDEO_ANALYSIS_API_KEY:-pp1-video-analysis-local}"
SSH_PASSWORD="${VIDEO_ANALYSIS_SSH_PASSWORD:-}"

ssh_target="$SSH_USER@$SSH_HOST"

echo "Deploying video analysis service to $ssh_target:$REMOTE_DIR"

ssh_run() {
  local command="$1"
  if [[ -n "$SSH_PASSWORD" ]]; then
    local output
    local status
    set +e
    output=$(
    VIDEO_ANALYSIS_EXPECT_PASSWORD="$SSH_PASSWORD" \
    VIDEO_ANALYSIS_EXPECT_PORT="$SSH_PORT" \
    VIDEO_ANALYSIS_EXPECT_TARGET="$ssh_target" \
    VIDEO_ANALYSIS_EXPECT_COMMAND="$command" \
    expect -c '
      set timeout -1
      spawn ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-video-analysis-known-hosts -p $env(VIDEO_ANALYSIS_EXPECT_PORT) $env(VIDEO_ANALYSIS_EXPECT_TARGET) $env(VIDEO_ANALYSIS_EXPECT_COMMAND)
      expect {
        -re "yes/no" { send "yes\r"; exp_continue }
        -re "password:" { send "$env(VIDEO_ANALYSIS_EXPECT_PASSWORD)\r"; exp_continue }
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
    VIDEO_ANALYSIS_EXPECT_PASSWORD="$SSH_PASSWORD" \
    VIDEO_ANALYSIS_EXPECT_PORT="$SSH_PORT" \
    VIDEO_ANALYSIS_EXPECT_SOURCE="$source" \
    VIDEO_ANALYSIS_EXPECT_TARGET="$target" \
    expect -c '
      set timeout -1
      spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-video-analysis-known-hosts -P $env(VIDEO_ANALYSIS_EXPECT_PORT) $env(VIDEO_ANALYSIS_EXPECT_SOURCE) $env(VIDEO_ANALYSIS_EXPECT_TARGET)
      expect {
        -re "yes/no" { send "yes\r"; exp_continue }
        -re "password:" { send "$env(VIDEO_ANALYSIS_EXPECT_PASSWORD)\r"; exp_continue }
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

ssh_run "mkdir -p '$REMOTE_DIR'"

tmp_app="$(mktemp)"
cat > "$tmp_app" <<'PY'
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="PP1 Video Analysis Service")

API_KEY = os.environ.get("VIDEO_ANALYSIS_API_KEY", "")
DEFAULT_WHISPER_MODEL = os.environ.get("VIDEO_WHISPER_MODEL", "base")
MAX_DOWNLOAD_SECTION_SECONDS = int(os.environ.get("VIDEO_MAX_DOWNLOAD_SECTION_SECONDS", "300"))


class AnalyzeRequest(BaseModel):
    workspaceId: Optional[str] = None
    fileObjectId: Optional[str] = None
    sourceUrl: Optional[str] = None
    provider: Optional[str] = None
    title: Optional[str] = None
    mimeType: Optional[str] = None
    fileName: Optional[str] = None
    fileBase64: Optional[str] = None
    maxSlides: int = 12
    frameIntervalSeconds: int = 60
    whisperModel: Optional[str] = None


def authorize(authorization: Optional[str]) -> None:
    if not API_KEY:
        return
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def run(args: List[str], timeout: int = 1200) -> subprocess.CompletedProcess:
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=True)


def yt_dlp_args(extra: List[str], source_url: str) -> List[str]:
    return [
        sys.executable,
        "-m",
        "yt_dlp",
        "--force-ipv4",
        "--socket-timeout",
        "20",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        "--extractor-retries",
        "2",
        "--remote-components",
        "ejs:github",
        *extra,
        source_url,
    ]


def clock_to_seconds(value: str) -> float:
    parts = [float(part) for part in value.replace(",", ".").split(":")]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0] if parts else 0


def seconds_to_clock(value: float) -> str:
    value = max(0.0, float(value or 0))
    h = int(value // 3600)
    m = int((value % 3600) // 60)
    s = value % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def strip_tags(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return (
        value.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .strip()
    )


def parse_vtt(text: str, source: str) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    blocks = text.replace("\r", "").split("\n\n")
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        time_index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        if time_index < 0:
            continue
        raw_start, raw_end = [part.strip().split()[0] for part in lines[time_index].split("-->")[:2]]
        body = " ".join(strip_tags(line) for line in lines[time_index + 1 :]).strip()
        if not body:
            continue
        start = clock_to_seconds(raw_start)
        end = clock_to_seconds(raw_end)
        segments.append({
            "id": f"t{len(segments) + 1}",
            "start": start,
            "end": end if end > start else start + 4,
            "text": body,
            "source": source,
        })
    return segments


def normalize_video_url(source_url: str) -> str:
    try:
        from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

        parsed = urlparse(source_url)
        host = parsed.netloc.lower()
        if "youtube.com" in host or "youtu.be" in host:
            query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key not in {"list", "index", "pp", "start_radio"}]
            return urlunparse(parsed._replace(query=urlencode(query)))
    except Exception:
        pass
    return source_url


def pick_caption_track(metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    language_prefs = ["zh-Hans", "zh-CN", "zh", "en"]
    for pool_name in ["subtitles", "automatic_captions"]:
        pool = metadata.get(pool_name) or {}
        languages = list(pool.keys())
        ordered = [lang for lang in language_prefs if lang in languages] + [lang for lang in languages if lang not in language_prefs]
        for lang in ordered:
            tracks = pool.get(lang) or []
            if not isinstance(tracks, list):
                continue
            track = next((item for item in tracks if item.get("ext") == "vtt" and item.get("url")), None)
            track = track or next((item for item in tracks if item.get("url")), None)
            if track:
                return {"url": track["url"], "language": lang, "kind": "manual" if pool_name == "subtitles" else "automatic"}
    return None


def extract_remote_captions(source_url: str) -> Dict[str, Any]:
    source_url = normalize_video_url(source_url)
    metadata = json.loads(run(yt_dlp_args(["--no-playlist", "-J", "--skip-download"], source_url), timeout=90).stdout)
    track = pick_caption_track(metadata)
    if not track:
        return {
            "title": metadata.get("title"),
            "duration": metadata.get("duration"),
            "transcript": [],
            "warnings": ["yt-dlp found the video, but no subtitle or auto-caption track was available."],
            "tools": {"captions": "yt-dlp:metadata"},
        }
    response = requests.get(track["url"], timeout=60)
    response.raise_for_status()
    return {
        "title": metadata.get("title"),
        "duration": metadata.get("duration"),
        "transcript": parse_vtt(response.text, "platform_caption"),
        "warnings": [],
        "tools": {"captions": f"yt-dlp:{track['language']}:{track['kind']}"},
    }


def write_uploaded_video(req: AnalyzeRequest, workdir: Path) -> Optional[Path]:
    if not req.fileBase64:
        return None
    suffix = Path(req.fileName or "uploaded.mp4").suffix or ".mp4"
    path = workdir / f"source{suffix}"
    path.write_bytes(base64.b64decode(req.fileBase64))
    return path


def download_video_media(source_url: str, workdir: Path, need_video: bool) -> Optional[Path]:
    source_url = normalize_video_url(source_url)
    output = str(workdir / "source.%(ext)s")
    media_format = "18/b[height<=360][ext=mp4]/bv*[height<=360][ext=mp4]+ba[ext=m4a]/best[height<=360]/best" if need_video else "bestaudio/best"
    extra = ["--no-playlist", "-f", media_format, "-o", output]
    if need_video and MAX_DOWNLOAD_SECTION_SECONDS > 0:
        extra.extend(["--download-sections", f"*0-{MAX_DOWNLOAD_SECTION_SECONDS}", "--force-keyframes-at-cuts", "--merge-output-format", "mp4"])
    run(yt_dlp_args(extra, source_url), timeout=300 if need_video else 900)
    files = [path for path in workdir.iterdir() if path.name.startswith("source.")]
    return files[0] if files else None


def transcribe_video(video_path: Path, model_name: str) -> List[Dict[str, Any]]:
    from faster_whisper import WhisperModel

    device = os.environ.get("VIDEO_WHISPER_DEVICE", "cuda")
    compute_type = os.environ.get("VIDEO_WHISPER_COMPUTE_TYPE", "float16" if device == "cuda" else "int8")
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(str(video_path), beam_size=5, vad_filter=True)
    transcript: List[Dict[str, Any]] = []
    for index, segment in enumerate(segments, start=1):
        transcript.append({
            "id": f"t{index}",
            "start": float(segment.start),
            "end": float(segment.end),
            "text": segment.text.strip(),
            "source": "asr",
        })
    return transcript


def extract_slides(video_path: Path, workdir: Path, max_slides: int, interval: int) -> List[Dict[str, Any]]:
    if not shutil.which("ffmpeg"):
        return []
    frame_dir = workdir / "frames"
    frame_dir.mkdir(exist_ok=True)
    pattern = str(frame_dir / "frame_%03d.jpg")
    run([
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"fps=1/{max(1, interval)},scale=960:-1",
        "-frames:v",
        str(max(1, max_slides)),
        pattern,
    ], timeout=900)
    slides: List[Dict[str, Any]] = []
    for index, frame in enumerate(sorted(frame_dir.glob("*.jpg")), start=1):
        slides.append({
            "id": f"s{index}",
            "timestamp": (index - 1) * max(1, interval),
            "title": f"Frame {index}",
            "mimeType": "image/jpeg",
            "imageBase64": base64.b64encode(frame.read_bytes()).decode("ascii"),
        })
    return slides


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ytDlp": True,
        "gpuDevice": os.environ.get("VIDEO_WHISPER_DEVICE", "cuda"),
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest, authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    authorize(authorization)
    warnings: List[str] = []
    tools: Dict[str, str] = {"remote": "autodl-fastapi"}
    with tempfile.TemporaryDirectory(prefix="pp1-video-") as tmp:
        workdir = Path(tmp)
        video_path = write_uploaded_video(req, workdir)
        transcript: List[Dict[str, Any]] = []
        title = req.title
        duration = None

        if req.sourceUrl:
            try:
                captions = extract_remote_captions(req.sourceUrl)
                transcript = captions["transcript"]
                title = captions.get("title") or title
                duration = captions.get("duration")
                warnings.extend(captions.get("warnings") or [])
                tools.update(captions.get("tools") or {})
            except Exception as exc:
                warnings.append(f"yt-dlp captions unavailable: {exc}")

        if (not transcript or req.maxSlides > 0) and not video_path and req.sourceUrl:
            try:
                video_path = download_video_media(req.sourceUrl, workdir, req.maxSlides > 0)
                tools["download"] = "yt-dlp"
            except Exception as exc:
                warnings.append(f"video/audio download unavailable: {exc}")

        if not transcript and video_path:
            try:
                transcript = transcribe_video(video_path, req.whisperModel or DEFAULT_WHISPER_MODEL)
                tools["asr"] = "faster-whisper"
            except Exception as exc:
                warnings.append(f"ASR unavailable: {exc}")

        slides: List[Dict[str, Any]] = []
        if video_path and req.maxSlides > 0:
            try:
                slides = extract_slides(video_path, workdir, req.maxSlides, req.frameIntervalSeconds)
                tools["frames"] = "ffmpeg"
            except Exception as exc:
                warnings.append(f"slide frame extraction unavailable: {exc}")

        return {
            "jobId": str(uuid.uuid4()),
            "title": title,
            "duration": duration,
            "provider": req.provider or "unknown",
            "transcript": transcript,
            "slides": slides,
            "warnings": warnings,
            "tools": tools,
        }
PY

scp_run "$tmp_app" "$ssh_target:$REMOTE_DIR/app.py"
rm -f "$tmp_app"

ssh_run "
set -e
cd '$REMOTE_DIR'
PYTHON_BIN='/root/miniconda3/bin/python'
if [ ! -x \"\$PYTHON_BIN\" ]; then
  PYTHON_BIN=\"\$(command -v python3 || command -v python)\"
fi
if command -v apt-get >/dev/null 2>&1 && ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg
fi
\"\$PYTHON_BIN\" -m pip install -U pip >/dev/null
\"\$PYTHON_BIN\" -m pip install -U fastapi uvicorn requests yt-dlp faster-whisper 'numpy<2' >/dev/null
if [ -f '$REMOTE_DIR/server.pid' ]; then
  kill \"\$(cat '$REMOTE_DIR/server.pid')\" >/dev/null 2>&1 || true
fi
screen -S pp1-video-analysis -X quit >/dev/null 2>&1 || true
: > '$REMOTE_DIR/server.log'
screen -dmS pp1-video-analysis bash -lc \"cd '$REMOTE_DIR' && exec env VIDEO_ANALYSIS_API_KEY='$API_KEY' VIDEO_WHISPER_MODEL='${VIDEO_WHISPER_MODEL:-base}' '\$PYTHON_BIN' -m uvicorn app:app --host 127.0.0.1 --port '$REMOTE_PORT' > '$REMOTE_DIR/server.log' 2>&1\"
for attempt in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:$REMOTE_PORT/health; then
    break
  fi
  sleep 1
  if [ \"\$attempt\" = 5 ]; then
    echo 'Video analysis service failed to become healthy. Recent server.log:' >&2
    tail -n 120 '$REMOTE_DIR/server.log' >&2 || true
    screen -ls >&2 || true
    exit 1
  fi
done
"

pkill -f "127.0.0.1:$REMOTE_PORT" >/dev/null 2>&1 || true
if [[ -n "$SSH_PASSWORD" ]]; then
  tunnel_output=$(
  VIDEO_ANALYSIS_EXPECT_PASSWORD="$SSH_PASSWORD" \
  VIDEO_ANALYSIS_EXPECT_PORT="$SSH_PORT" \
  VIDEO_ANALYSIS_EXPECT_LOCAL_PORT="$LOCAL_PORT" \
  VIDEO_ANALYSIS_EXPECT_REMOTE_PORT="$REMOTE_PORT" \
  VIDEO_ANALYSIS_EXPECT_TARGET="$ssh_target" \
  expect -c '
    set timeout -1
    set forward "$env(VIDEO_ANALYSIS_EXPECT_LOCAL_PORT):127.0.0.1:$env(VIDEO_ANALYSIS_EXPECT_REMOTE_PORT)"
    spawn ssh -fN -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/pp1-video-analysis-known-hosts -o ServerAliveInterval=15 -o ServerAliveCountMax=6 -L $forward -p $env(VIDEO_ANALYSIS_EXPECT_PORT) $env(VIDEO_ANALYSIS_EXPECT_TARGET)
    expect {
      -re "yes/no" { send "yes\r"; exp_continue }
      -re "password:" { send "$env(VIDEO_ANALYSIS_EXPECT_PASSWORD)\r"; exp_continue }
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
echo "Video analysis tunnel:"
echo "  http://127.0.0.1:$LOCAL_PORT -> AutoDL 127.0.0.1:$REMOTE_PORT"
echo "  API key: $API_KEY"
