import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { buildReactSandboxHTML } from '../../utils/sandbox';
import type { VizType } from '../../types';
import './Sandbox.css';

interface SandboxViewProps {
  vizId: string;
  type: VizType;
  code: string;
  title: string;
  initialHeight: number;
}

const store = new Map<string, { type: VizType; code: string }>();

type Html2Canvas = (
  element: HTMLElement,
  options?: {
    backgroundColor?: string;
    scale?: number;
    width?: number;
    height?: number;
    windowWidth?: number;
    windowHeight?: number;
    scrollX?: number;
    scrollY?: number;
    useCORS?: boolean;
  },
) => Promise<HTMLCanvasElement>;

type SandboxWindow = Window & {
  html2canvas?: Html2Canvas;
};

type FfmpegFileData = Uint8Array | string;

interface FfmpegInstance {
  load: (options: Record<string, unknown>) => Promise<boolean>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  readFile: (path: string) => Promise<FfmpegFileData>;
  deleteFile?: (path: string) => Promise<void>;
}

interface FfmpegRuntime {
  ffmpeg: FfmpegInstance;
  fetchFile: (data: Blob | File | string) => Promise<Uint8Array>;
}

let ffmpegRuntimePromise: Promise<FfmpegRuntime> | null = null;

const importRemoteModule = <T,>(url: string): Promise<T> => {
  const importer = new Function('url', 'return import(url)') as (moduleUrl: string) => Promise<T>;
  return importer(url);
};

function apiBaseUrl() {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
}

export function getVizCode(id: string) {
  return store.get(id);
}

function downloadViz(id: string) {
  const entry = store.get(id);
  if (!entry) {
    alert('找不到源码');
    return;
  }
  const ts = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[T:]/g, '-');
  const ext = entry.type === 'html' ? 'html' : 'jsx';
  const filename = entry.type === 'html'
    ? `visualization-${ts}.${ext}`
    : `component-${ts}.${ext}`;
  const mime = entry.type === 'html' ? 'text/html' : 'text/jsx';
  const blob = new Blob([entry.code], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function mediaRecorderMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function extensionForMimeType(mimeType: string) {
  return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

function loadHtml2Canvas(win: SandboxWindow): Promise<Html2Canvas> {
  if (win.html2canvas) return Promise.resolve(win.html2canvas);

  return new Promise((resolve, reject) => {
    const doc = win.document;
    const existing = doc.querySelector<HTMLScriptElement>('script[data-sandbox-html2canvas]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (win.html2canvas) resolve(win.html2canvas);
        else reject(new Error('html2canvas 加载失败'));
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('html2canvas 加载失败')), { once: true });
      return;
    }

    const script = doc.createElement('script');
    script.dataset.sandboxHtml2canvas = 'true';
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => {
      if (win.html2canvas) resolve(win.html2canvas);
      else reject(new Error('html2canvas 未初始化'));
    };
    script.onerror = () => reject(new Error('无法加载 html2canvas'));
    doc.head.appendChild(script);
  });
}

async function loadFfmpegRuntime(): Promise<FfmpegRuntime> {
  if (ffmpegRuntimePromise) return ffmpegRuntimePromise;

  ffmpegRuntimePromise = (async () => {
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      importRemoteModule<{ FFmpeg: new () => FfmpegInstance }>('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
      importRemoteModule<{
        fetchFile: (data: Blob | File | string) => Promise<Uint8Array>;
        toBlobURL: (url: string, mimeType: string) => Promise<string>;
      }>('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js'),
    ]);

    const ffmpeg = new FFmpeg();
    const coreBaseUrl = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${coreBaseUrl}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    return { ffmpeg, fetchFile };
  })();

  return ffmpegRuntimePromise;
}

async function transcodeWebmToMp4(webmBlob: Blob): Promise<Blob> {
  const { ffmpeg, fetchFile } = await loadFfmpegRuntime();
  const id = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const inputName = `input-${id}.webm`;
  const outputName = `output-${id}.mp4`;

  await ffmpeg.writeFile(inputName, await fetchFile(webmBlob));
  await ffmpeg.exec([
    '-i',
    inputName,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    'faststart',
    outputName,
  ]);

  const output = await ffmpeg.readFile(outputName);
  await Promise.all([
    ffmpeg.deleteFile?.(inputName).catch(() => undefined),
    ffmpeg.deleteFile?.(outputName).catch(() => undefined),
  ]);

  const bytes = output instanceof Uint8Array ? output : new TextEncoder().encode(output);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'video/mp4' });
}

async function renderVideoOnBackend(input: { type: VizType; code: string; width: number; height: number }) {
  const response = await fetch(`${apiBaseUrl()}/studio/react-chat-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      type: input.type,
      code: input.code,
      width: input.width,
      height: input.height,
      fps: 12,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `后端录制失败：HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text);
      message = payload.error || message;
    } catch {
      if (text) message = text.slice(0, 300);
    }
    throw new Error(message);
  }

  return response.blob();
}

const resetControlLabels = [
  '回到开始',
  '重新开始',
  '重置',
  'reset',
  'restart',
  'replay',
  'start over',
  'back to start',
];

const startControlLabels = [
  '播放',
  '开始',
  '开始演示',
  '自动演示',
  '运行',
  'play',
  'start',
  'run',
  'auto',
  'demo',
];

const nextControlLabels = [
  '下一步',
  '下一个',
  '继续',
  '前进',
  'next',
  'continue',
  'step',
  'forward',
];

const blockedNextLabels = [
  '上一步',
  '回到',
  '结束',
  '最后',
  'previous',
  'back',
  'finish',
  'end',
  'last',
];

function normalizeControlText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function controlText(element: Element) {
  const input = element as HTMLInputElement;
  return normalizeControlText([
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    input.value,
    element.textContent,
  ].filter(Boolean).join(' '));
}

function asFrameHTMLElement(element: Element): HTMLElement | null {
  return typeof (element as HTMLElement).click === 'function' &&
    typeof (element as HTMLElement).getBoundingClientRect === 'function'
    ? element as HTMLElement
    : null;
}

function isNativeDisabled(element: HTMLElement) {
  return Boolean((element as HTMLButtonElement | HTMLInputElement).disabled);
}

function isUsableControl(element: Element): element is HTMLElement {
  const htmlElement = asFrameHTMLElement(element);
  if (!htmlElement) return false;
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    !isNativeDisabled(htmlElement) &&
    element.getAttribute('aria-disabled') !== 'true' &&
    style?.display !== 'none' &&
    style?.visibility !== 'hidden' &&
    Number(style?.opacity ?? '1') > 0.05
  );
}

function textMatches(text: string, labels: string[]) {
  return labels.some((label) => text.includes(label.toLowerCase()));
}

function findControl(doc: Document, labels: string[], options: { block?: string[] } = {}) {
  const controls = Array.from(doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a'));
  return controls.find((control): control is HTMLElement => {
    if (!isUsableControl(control)) return false;
    const text = controlText(control);
    if (!text || !textMatches(text, labels)) return false;
    return options.block ? !textMatches(text, options.block) : true;
  }) || null;
}

function activateControl(element: HTMLElement) {
  const win = element.ownerDocument.defaultView || window;
  element.scrollIntoView({ block: 'center', inline: 'center' });
  if (typeof win.PointerEvent === 'function') {
    element.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
  }
  element.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  if (typeof win.PointerEvent === 'function') {
    element.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
  }
  element.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.click();
}

function detectStepCount(doc: Document) {
  const text = doc.body?.innerText || doc.body?.textContent || '';
  const matches = Array.from(text.matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})/g));
  const totals = matches
    .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
    .filter((item) => Number.isFinite(item.current) && Number.isFinite(item.total) && item.total >= item.current && item.total > 1 && item.total <= 200)
    .map((item) => item.total);
  return totals.length ? Math.max(...totals) : null;
}

async function preparePlaybackForRecording(doc: Document) {
  const reset = findControl(doc, resetControlLabels);
  if (reset) activateControl(reset);
  await wait(180);

  const start = findControl(doc, startControlLabels, { block: ['暂停', 'pause'] });
  if (start) activateControl(start);
  const started = Boolean(start);
  await wait(started ? 260 : 120);

  const stepCount = detectStepCount(doc);
  const durationSeconds = stepCount
    ? clamp(stepCount * 3 + 3, 12, 180)
    : 8;
  const nextIntervalMs = stepCount
    ? clamp(((durationSeconds - 3) * 1000) / Math.max(1, stepCount), 2500, 3500)
    : 1000;

  return {
    durationSeconds,
    nextIntervalMs,
    nextClickAtMs: 1000,
    advance(elapsedMs: number) {
      if (elapsedMs < this.nextClickAtMs) return;
      const next = findControl(doc, nextControlLabels, { block: blockedNextLabels });
      if (!next) return;
      activateControl(next);
      this.nextClickAtMs += this.nextIntervalMs;
    },
  };
}

// Expose downloadViz globally for onclick in the HTML attribute
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__sandboxDownload = downloadViz;
}

export function SandboxView({
  vizId,
  type,
  code,
  title,
  initialHeight,
}: SandboxViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Store code for later download
  useEffect(() => {
    store.set(vizId, { type, code });
    return () => { store.delete(vizId); };
  }, [vizId, type, code]);

  // Handle iframe height messages
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const iframe = iframeRef.current;
      if (!iframe || e.source !== iframe.contentWindow) return;
      if (e.data?.type === 'sandbox-height') {
        const h = Math.min(e.data.height + 10, 800);
        if (h > 50) iframe.style.height = `${h}px`;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const ch = Math.max(
          doc.body.scrollHeight,
          doc.documentElement.scrollHeight,
        );
        if (ch > 50) iframe.style.height = `${Math.min(ch + 20, 800)}px`;
      }
    } catch {
      // cross-origin, ignore
    }
  }, []);

  const exportVideo = useCallback(async () => {
    if (exporting) return;

    const iframe = iframeRef.current;
    const win = iframe?.contentWindow as SandboxWindow | null;
    const doc = iframe?.contentDocument;
    if (!iframe || !win || !doc) {
      alert('可视化还没有加载完成');
      return;
    }
    if (!('MediaRecorder' in window)) {
      alert('当前浏览器不支持 MediaRecorder 视频导出');
      return;
    }

    setExporting(true);
    setExportProgress(0);

    try {
      const iframeRect = iframe.getBoundingClientRect();
      const backendWidth = clamp(Math.ceil(iframeRect.width || iframe.clientWidth || 1280), 640, 1920);
      const backendHeight = clamp(Math.ceil(iframeRect.height || iframe.clientHeight || initialHeight || 720), 360, 1080);
      setExportProgress(8);
      try {
        const mp4Blob = await renderVideoOnBackend({
          type,
          code,
          width: backendWidth,
          height: backendHeight,
        });
        const ts = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[T:]/g, '-');
        setExportProgress(100);
        downloadBlob(mp4Blob, `visualization-video-${ts}.mp4`);
        return;
      } catch (backendError) {
        console.warn('Backend video export failed; falling back to browser recording.', backendError);
      }

      const html2canvas = await loadHtml2Canvas(win);
      const target = (doc.getElementById('root') || doc.body) as HTMLElement | null;
      if (!target) throw new Error('找不到可视化根节点');

      const rect = target.getBoundingClientRect();
      const rawWidth = Math.ceil(rect.width || iframe.clientWidth || 1280);
      const rawHeight = Math.ceil(rect.height || iframe.clientHeight || 720);
      const width = clamp(rawWidth, 320, 1920);
      const height = clamp(rawHeight, 240, 1080);
      const playback = await preparePlaybackForRecording(doc);
      const fps = 12;
      const durationSeconds = playback.durationSeconds;
      const totalFrames = fps * durationSeconds;
      const frameMs = 1000 / fps;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = width;
      outputCanvas.height = height;
      const context = outputCanvas.getContext('2d');
      if (!context) throw new Error('无法创建视频画布');

      const stream = outputCanvas.captureStream(fps);
      const mimeType = mediaRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = (event) => {
          const recorderError = event instanceof ErrorEvent ? event.error : null;
          reject(recorderError || new Error('视频录制失败'));
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
      });

      recorder.start(1000);
      const recordingStartedAt = performance.now();
      for (let frame = 0; frame < totalFrames; frame += 1) {
        playback.advance(performance.now() - recordingStartedAt);
        const snapshot = await html2canvas(target, {
          backgroundColor: '#ffffff',
          scale: 1,
          width,
          height,
          windowWidth: width,
          windowHeight: height,
          scrollX: 0,
          scrollY: 0,
          useCORS: true,
        });

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(snapshot, 0, 0, width, height);
        setExportProgress(Math.round(((frame + 1) / totalFrames) * 60));
        await wait(frameMs);
      }

      recorder.stop();
      const recordedBlob = await finished;
      const ts = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, '-');
      const recordedExt = extensionForMimeType(recordedBlob.type || mimeType);

      if (recordedExt === 'mp4') {
        setExportProgress(100);
        downloadBlob(recordedBlob, `visualization-video-${ts}.mp4`);
        return;
      }

      setExportProgress(68);
      try {
        const mp4Blob = await transcodeWebmToMp4(recordedBlob);
        setExportProgress(100);
        downloadBlob(mp4Blob, `visualization-video-${ts}.mp4`);
      } catch (conversionError) {
        console.error(conversionError);
        downloadBlob(recordedBlob, `visualization-video-${ts}.webm`);
        const reason = conversionError instanceof Error ? conversionError.message : String(conversionError);
        alert(`MP4 转码失败，已先下载 WebM 版本。\n\n原因：${reason || '浏览器无法加载或运行 ffmpeg.wasm'}\n\n建议：用 Chrome 最新版重试；如果仍失败，说明当前环境不支持浏览器内 wasm 转码。`);
      }
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : '视频导出失败');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }, [code, exporting, initialHeight, type]);

  const tagClass = type === 'html' ? 'html' : 'react';
  const ext = type === 'html' ? '.html' : '.jsx';

  const blobUrl = useMemo(() => {
    const blobHtml = type === 'react' ? buildReactSandboxHTML(code) : code;
    const blob = new Blob([blobHtml], { type: 'text/html;charset=utf-8' });
    return URL.createObjectURL(blob);
  }, [type, code]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  return (
    <div className="msg">
      <div className="msg-lbl">Claude</div>
      <div className="viz">
        <div className="viz-h">
          <div className="viz-left">
            <span>{title}</span>
          </div>
          <div className="viz-right">
            <button
              className="dl-btn"
              onClick={() => downloadViz(vizId)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {ext}
            </button>
            <button
              className="dl-btn video-btn"
              onClick={() => void exportVideo()}
              disabled={exporting}
              title="导出当前动画为 MP4 视频"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              {exporting ? `${exportProgress}%` : '.mp4'}
            </button>
            <span className={`vtag ${tagClass}`}>
              {type === 'html' ? 'HTML' : 'REACT'}
            </span>
          </div>
        </div>
        <iframe
          ref={iframeRef}
          className="viz-if"
          style={{ height: initialHeight }}
          src={blobUrl}
          onLoad={handleLoad}
        />
      </div>
    </div>
  );
}
