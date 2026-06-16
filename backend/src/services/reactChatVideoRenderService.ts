import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

type VizType = 'react' | 'html';

export interface ReactChatVideoRenderInput {
  type: VizType;
  code: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface ReactChatVideoRenderResult {
  filename: string;
  mimeType: 'video/mp4';
  buffer: Buffer;
  metadata: {
    width: number;
    height: number;
    fps: number;
    durationSeconds: number;
    frameCount: number;
    stepCount: number | null;
    mode: 'headless-browser';
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const execFileAsync = (
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024 * 12
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || stdout || ''}`.trim()));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

const commandAvailable = async (command: string, args: string[] = ['-version']) => {
  try {
    await execFileAsync(command, args, { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
};

const chromeCandidates = () => [
  process.env.CHROME_EXECUTABLE_PATH || '',
  process.env.PUPPETEER_EXECUTABLE_PATH || '',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
].filter(Boolean);

const findChromeExecutable = async () => {
  for (const candidate of chromeCandidates()) {
    if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return '';
};

const escapeClosingScript = (value: string) => value.replace(/<\/script/gi, '<\\/script');

const reactSandboxHtml = (jsxCode: string) => {
  const encoded = JSON.stringify(jsxCode);
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2/dist/tailwind.min.css" rel="stylesheet">',
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#fff}#root{width:100%;min-height:100px}.sandbox-error{padding:20px;color:#dc2626;font-size:13px;font-family:monospace;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:12px;white-space:pre-wrap}.sandbox-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:40px;color:#6b7280;font-size:13px}.spinner{width:18px;height:18px;border:2px solid #e5e7eb;border-top-color:#6d5cff;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style>',
    '</head><body><div id="root"><div class="sandbox-loading"><div class="spinner"></div><span>加载依赖库...</span></div></div>',
    '<script>',
    'var S=[',
    '{u:"https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js",r:1,n:"React",a:function(){window.React=React}},',
    '{u:"https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js",r:1,n:"ReactDOM",a:function(){window.ReactDOM=ReactDOM}},',
    '{u:"https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js",r:1,n:"Babel"},',
    '{u:"https://cdn.jsdelivr.net/npm/prop-types@15/prop-types.min.js",r:0,n:"PropTypes",a:function(){window.PropTypes=PropTypes}},',
    '{u:"https://cdn.jsdelivr.net/npm/recharts@2.12.7/umd/Recharts.js",r:0,n:"Recharts"}',
    '];var lc=0;',
    'function L(i){if(i>=S.length){R();return}var o=S[i],s=document.createElement("script");s.src=o.u;',
    's.onload=function(){lc++;if(o.a)try{o.a()}catch(e){}var sp=document.querySelector(".sandbox-loading span");if(sp)sp.textContent=o.n+" ✓ ("+lc+"/"+S.length+")";L(i+1)};',
    's.onerror=function(){if(o.r){document.getElementById("root").innerHTML="<div class=sandbox-error>加载失败："+o.n+"</div>"}else L(i+1)};',
    'document.head.appendChild(s)}',
    'function R(){',
    'var reg={"react":Object.assign({},React,{default:React,useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,useMemo:React.useMemo,useCallback:React.useCallback,useReducer:React.useReducer,useContext:React.useContext,createContext:React.createContext,Fragment:React.Fragment,createElement:React.createElement,forwardRef:React.forwardRef,memo:React.memo}),',
    '"react-dom":Object.assign({default:ReactDOM},ReactDOM),"react-dom/client":Object.assign({default:ReactDOM},ReactDOM)};',
    'if(typeof Recharts!=="undefined")try{reg["recharts"]=Object.assign({default:Recharts},Recharts)}catch(e){}',
    'if(typeof PropTypes!=="undefined")reg["prop-types"]=Object.assign({default:PropTypes},PropTypes);',
    'function req(m){var mod=reg[m];if(!mod){if(typeof Proxy!=="undefined")return new Proxy({},{get:function(t,p){if(p==="__esModule")return true;return function(props){return React.createElement("span",null,props&&props.children||"")}}});return{}}return mod}',
    'try{',
    'var src=' + encoded + ';',
    'var compiled=Babel.transform(src,{presets:["react"],plugins:["transform-modules-commonjs"],filename:"c.jsx"}).code;',
    'var me={};var mo={exports:me};',
    'new Function("require","module","exports","React","ReactDOM",compiled)(req,mo,me,React,ReactDOM);',
    'var C=mo.exports.default||mo.exports;',
    'if(typeof C!=="function")throw new Error("未找到 export default 的组件");',
    'var root=document.getElementById("root");',
    'if(ReactDOM.createRoot)ReactDOM.createRoot(root).render(React.createElement(C));',
    'else ReactDOM.render(React.createElement(C),root);',
    '}catch(err){document.getElementById("root").innerHTML="<div class=sandbox-error>渲染错误：\\n\\n"+String(err.message).replace(/</g,"&lt;")+"</div>"}}',
    'L(0);',
    '</script></body></html>'
  ].join('\n');
};

const buildHtml = (input: ReactChatVideoRenderInput) => {
  if (input.type === 'html') return escapeClosingScript(input.code);
  return reactSandboxHtml(input.code);
};

const installBrowserAutomationScript = () => {
  const resetLabels = ['回到开始', '重新开始', '重置', 'reset', 'restart', 'replay', 'start over', 'back to start'];
  const startLabels = ['播放', '开始', '开始演示', '自动演示', '运行', 'play', 'start', 'run', 'auto', 'demo'];
  const nextLabels = ['下一步', '下一个', '继续', '前进', 'next', 'continue', 'step', 'forward'];
  const blockedNextLabels = ['上一步', '回到', '结束', '最后', 'previous', 'back', 'finish', 'end', 'last'];
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  const textMatches = (text: string, labels: string[]) => labels.some((label) => text.includes(label.toLowerCase()));
  const controlText = (element: Element) => normalize([
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    (element as HTMLInputElement).value,
    element.textContent
  ].filter(Boolean).join(' '));
  const isUsable = (element: Element) => {
    const htmlElement = element as HTMLElement;
    const rect = htmlElement.getBoundingClientRect();
    const style = window.getComputedStyle(htmlElement);
    return rect.width > 0 &&
      rect.height > 0 &&
      !(htmlElement as HTMLButtonElement | HTMLInputElement).disabled &&
      htmlElement.getAttribute('aria-disabled') !== 'true' &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0.05;
  };
  const controls = () => Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a'));
  const findControl = (labels: string[], block: string[] = []) => controls().find((control) => {
    if (!isUsable(control)) return false;
    const text = controlText(control);
    if (!text || !textMatches(text, labels)) return false;
    return block.length ? !textMatches(text, block) : true;
  }) as HTMLElement | undefined;
  const activate = (element?: HTMLElement) => {
    if (!element) return false;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof PointerEvent === 'function') element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    if (typeof PointerEvent === 'function') element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    element.click();
    return true;
  };
  const detectStepCount = () => {
    const text = document.body?.innerText || document.body?.textContent || '';
    const totals = Array.from(text.matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})/g))
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter((item) => Number.isFinite(item.current) && Number.isFinite(item.total) && item.total >= item.current && item.total > 1 && item.total <= 200)
      .map((item) => item.total);
    return totals.length ? Math.max(...totals) : null;
  };
  (window as any).__reactChatRecorder = {
    reset: () => activate(findControl(resetLabels)),
    start: () => activate(findControl(startLabels, ['暂停', 'pause'])),
    next: () => activate(findControl(nextLabels, blockedNextLabels)),
    detectStepCount
  };
};

export class ReactChatVideoRenderService {
  async render(input: ReactChatVideoRenderInput): Promise<ReactChatVideoRenderResult> {
    if (!['react', 'html'].includes(input.type)) throw new Error('type must be react or html.');
    if (!input.code || typeof input.code !== 'string') throw new Error('code is required.');
    if (input.code.length > 240000) throw new Error('code is too large for video export.');

    const hasFfmpeg = await commandAvailable('ffmpeg');
    if (!hasFfmpeg) throw new Error('FFmpeg is not installed or not available on PATH.');
    const chromePath = await findChromeExecutable();
    if (!chromePath) throw new Error('Chrome/Chromium executable was not found. Set CHROME_EXECUTABLE_PATH.');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer-core');

    const width = clamp(Number(input.width || 1280), 640, 1920);
    const height = clamp(Number(input.height || 720), 360, 1080);
    const fps = clamp(Number(input.fps || 12), 8, 24);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pp1-react-chat-video-'));
    const framesDir = path.join(tempDir, 'frames');
    await fs.mkdir(framesDir, { recursive: true });
    const htmlPath = path.join(tempDir, 'index.html');
    const outputPath = path.join(tempDir, 'visualization.mp4');
    await fs.writeFile(htmlPath, buildHtml(input), 'utf-8');

    let browser: any = null;
    try {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-extensions',
          '--autoplay-policy=no-user-gesture-required',
          '--font-render-hinting=none'
        ]
      });
      const page = await browser.newPage();
      page.setDefaultTimeout(60000);
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 90000 });
      await page.waitForFunction(() => !document.querySelector('.sandbox-loading'), { timeout: 60000 }).catch(() => null);
      await sleep(500);
      await page.evaluate(installBrowserAutomationScript);

      const stepCount = await page.evaluate(() => (window as any).__reactChatRecorder.detectStepCount()) as number | null;
      const durationSeconds = stepCount ? clamp(stepCount * 3 + 3, 12, 180) : 8;
      const totalFrames = Math.ceil(durationSeconds * fps);
      const frameMs = 1000 / fps;
      const nextIntervalMs = stepCount
        ? clamp(((durationSeconds - 3) * 1000) / Math.max(1, stepCount), 2500, 3500)
        : 1000;

      await page.evaluate(() => (window as any).__reactChatRecorder.reset());
      await sleep(180);
      await page.evaluate(() => (window as any).__reactChatRecorder.start());
      await sleep(260);

      let nextClickAtMs = 1000;
      const startedAt = Date.now();
      for (let frame = 0; frame < totalFrames; frame += 1) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= nextClickAtMs) {
          await page.evaluate(() => (window as any).__reactChatRecorder.next());
          nextClickAtMs += nextIntervalMs;
          await sleep(80);
        }
        const framePath = path.join(framesDir, `frame-${String(frame).padStart(5, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png', fullPage: false });
        const targetElapsed = (frame + 1) * frameMs;
        const delay = Math.max(0, targetElapsed - (Date.now() - startedAt));
        if (delay > 0) await sleep(delay);
      }

      await execFileAsync('ffmpeg', [
        '-y',
        '-framerate',
        String(fps),
        '-i',
        path.join(framesDir, 'frame-%05d.png'),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outputPath
      ], { cwd: tempDir, timeout: 240000 });

      const buffer = await fs.readFile(outputPath);
      return {
        filename: `react-chat-video-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.mp4`,
        mimeType: 'video/mp4',
        buffer,
        metadata: {
          width,
          height,
          fps,
          durationSeconds,
          frameCount: totalFrames,
          stepCount,
          mode: 'headless-browser'
        }
      };
    } finally {
      if (browser) await browser.close().catch(() => null);
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}

export const reactChatVideoRenderService = new ReactChatVideoRenderService();
