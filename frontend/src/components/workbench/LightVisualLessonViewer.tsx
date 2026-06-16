import { ChevronLeft, ChevronRight, Download, Pause, Play } from 'lucide-react';
import { ComponentType, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import * as echarts from 'echarts';
import mermaid from 'mermaid';
import Reveal, { type RevealApi } from 'reveal.js';
import OpenWebUIMarkdownPreview from './OpenWebUIMarkdownPreview';
import '@excalidraw/excalidraw/index.css';
import 'reveal.js/reveal.css';
import 'reveal.js/theme/white.css';

const ExcalidrawCanvas = lazy(() =>
  import('@excalidraw/excalidraw').then((module) => ({ default: module.Excalidraw }))
);

interface LightVisualLessonTimelineStep {
  kind: 'text' | 'visual';
  content: string;
  visualIndex?: number;
}

interface LightVisualLessonVisualBlock {
  type: 'diagram' | 'chart' | 'table' | 'formula' | 'code' | 'image_hint' | 'sketch';
  content: string;
}

interface LightVisualLessonSlide {
  header: string;
  description: string;
  timeline?: LightVisualLessonTimelineStep[];
  visuals?: LightVisualLessonVisualBlock[];
}

export interface LightVisualLessonPayload {
  title: string;
  markdownDraft?: string;
  slides: LightVisualLessonSlide[];
}

export interface LightVisualLessonViewerResult {
  name: string;
  content: string;
}

const isObjectRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const escapeLightVisualPdfHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildLightVisualLessonPrintHtml = (lesson: LightVisualLessonPayload) => {
  const slides = lesson.slides.map((slide, index) => {
    const visuals = (slide.visuals || [])
      .map((visual) => `
        <div class="visual">
          <div class="visual-type">${escapeLightVisualPdfHtml(visual.type)}</div>
          <pre>${escapeLightVisualPdfHtml(visual.content)}</pre>
        </div>`)
      .join('');
    return `
      <section class="slide">
        <div class="kicker">Slide ${index + 1}/${lesson.slides.length}</div>
        <h1>${escapeLightVisualPdfHtml(slide.header)}</h1>
        <div class="description">${escapeLightVisualPdfHtml(slide.description).replace(/\n/g, '<br />')}</div>
        ${visuals ? `<div class="visuals">${visuals}</div>` : ''}
      </section>`;
  }).join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeLightVisualPdfHtml(lesson.title)}</title>
    <style>
      @page { size: 16in 9in; margin: 0.45in; }
      body { margin: 0; color: #202124; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .slide { break-after: page; min-height: 8.1in; display: flex; flex-direction: column; gap: 18px; }
      .kicker { color: #64748b; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 0; font-size: 34px; line-height: 1.16; }
      .description { font-size: 18px; line-height: 1.62; white-space: normal; }
      .visuals { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
      .visual { border: 1px solid #dfe3ea; border-radius: 8px; padding: 12px; background: #f8fafc; }
      .visual-type { margin-bottom: 8px; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; }
      pre { margin: 0; white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
    </style>
  </head>
  <body>${slides}</body>
</html>`;
};

const exportLightVisualLessonToPdf = (lesson: LightVisualLessonPayload) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.alert('浏览器阻止了导出窗口，请允许弹窗后再试。');
    return;
  }
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(buildLightVisualLessonPrintHtml(lesson));
  printWindow.document.close();
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 350);
};

const splitLightLessonDescription = (description: string, timelineLength: number) => {
  const text = description.trim();
  if (!text) return [];
  const targetCount = Math.max(1, Math.min(timelineLength || 1, 8));
  if (targetCount <= 1) return [text];
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length >= targetCount) return blocks;

  const sentences = text
    .split(/(?<=[。！？!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length >= targetCount) return sentences;

  return blocks.length ? blocks : [text];
};

export const normalizeLightVisualLessonPayload = (value: unknown, fallbackTitle: string): LightVisualLessonPayload | null => {
  const payload = isObjectRecord(value) ? value : null;
  const rawSlides = Array.isArray(payload?.slides) ? payload.slides : [];
  if (!rawSlides.length) return null;
  const nestedDescription = rawSlides.length === 1
    ? String((rawSlides[0] as any)?.description || (rawSlides[0] as any)?.content || '').trim()
    : '';
  if (nestedDescription.startsWith('{') && nestedDescription.includes('"slides"')) {
    try {
      const nested = JSON.parse(nestedDescription);
      if (Array.isArray(nested?.slides) && nested.slides.length) {
        const normalized = normalizeLightVisualLessonPayload(nested, fallbackTitle);
        if (normalized) return normalized;
      }
    } catch {
      // Keep the original payload if the description is not valid JSON.
    }
  }
  const slides = rawSlides.map((slide: any, index): LightVisualLessonSlide => {
    const description = String(slide?.description || '').trim();
    const timeline = Array.isArray(slide?.timeline)
      ? slide.timeline.map((step: any): LightVisualLessonTimelineStep | null => {
          const content = String(step?.content || '').trim();
          if (!content) return null;
          return {
            kind: step?.kind === 'visual' ? 'visual' : 'text',
            content,
            visualIndex: Number.isInteger(step?.visualIndex) ? step.visualIndex : undefined
          };
        }).filter((step: LightVisualLessonTimelineStep | null): step is LightVisualLessonTimelineStep => Boolean(step))
      : [];
    const visuals = Array.isArray(slide?.visuals)
      ? slide.visuals.map((visual: any): LightVisualLessonVisualBlock | null => {
          const content = String(visual?.content || '').trim();
          if (!content) return null;
          const type = ['diagram', 'chart', 'table', 'formula', 'code', 'image_hint', 'sketch'].includes(String(visual?.type))
            ? visual.type
            : 'diagram';
          return { type, content };
        }).filter((visual: LightVisualLessonVisualBlock | null): visual is LightVisualLessonVisualBlock => Boolean(visual))
      : [];
    return {
      header: String(slide?.header || `Slide ${index + 1}`).trim(),
      description,
      timeline: timeline.length ? timeline : description ? [{ kind: 'text', content: description }] : [],
      visuals
    };
  }).filter((slide) => slide.header || slide.description);
  if (!slides.length) return null;
  return {
    title: String(payload?.title || fallbackTitle || 'Light Visual Lesson').trim(),
    markdownDraft: typeof payload?.markdownDraft === 'string' ? payload.markdownDraft : undefined,
    slides
  };
};

export const extractLightVisualLessonPayloadFromText = (text: string, fallbackTitle: string): LightVisualLessonPayload | null => {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    const fromRoot = normalizeLightVisualLessonPayload(parsed, fallbackTitle);
    if (fromRoot) return fromRoot;
    if (isObjectRecord(parsed?.payload)) {
      return normalizeLightVisualLessonPayload(parsed.payload, fallbackTitle);
    }
  } catch {
    return null;
  }
  return null;
};

const cleanupMermaidRenderArtifacts = (renderId: string) => {
  if (typeof document === 'undefined') return;
  const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(renderId) : renderId;
  document.querySelectorAll(`#${escapedId}, #d${escapedId}`).forEach((element) => {
    element.remove();
  });
  document.querySelectorAll('.mermaid').forEach((element) => {
    const text = element.textContent || '';
    if (/Syntax error in text/i.test(text) && /mermaid version/i.test(text)) {
      element.remove();
    }
  });
};

const cleanRevealText = (value: string | undefined, maxLength = 420) => {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

type LightVisualRendererKind = 'mermaid' | 'echarts' | 'excalidraw';

const parseJsonObject = (value: string): Record<string, any> | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || trimmed;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const stripCodeFence = (value: string, lang?: string) => {
  const pattern = lang ? new RegExp(`\`\`\`${lang}\\s*([\\s\\S]*?)\`\`\``, 'i') : /```[a-z0-9_-]*\s*([\s\S]*?)```/i;
  return value.match(pattern)?.[1]?.trim() || value.trim();
};

const lightVisualLines = (content: string) =>
  content
    .split(/\n+|[。；;.!?！？]\s*/)
    .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);

const mermaidFromLightVisual = (visual: LightVisualLessonVisualBlock) => {
  const content = stripCodeFence(visual.content, 'mermaid');
  if (/^(flowchart|graph|sequenceDiagram|stateDiagram|classDiagram|erDiagram|mindmap|timeline|pie)\b/i.test(content)) {
    return content;
  }
  const lines = lightVisualLines(content);
  const safeLabel = (value: string) => cleanRevealText(value, 56).replace(/[|"[\]{}]/g, '');
  return [
    'flowchart TD',
    `  n0["${safeLabel(lines[0] || '核心图解')}"]`,
    ...(lines.slice(1).map((line, index) => [
      `  n${index + 1}["${safeLabel(line)}"]`,
      `  n${index} --> n${index + 1}`
    ]).flat())
  ].join('\n');
};

const echartsOptionFromLightVisual = (visual: LightVisualLessonVisualBlock): echarts.EChartsOption => {
  const parsed = parseJsonObject(visual.content);
  if (parsed?.series || parsed?.dataset || parsed?.xAxis || parsed?.yAxis) return parsed as echarts.EChartsOption;
  const lines = lightVisualLines(visual.content);
  const values = lines.map((line, index) => {
    const number = Number(line.match(/-?\d+(?:\.\d+)?/)?.[0]);
    return {
      name: cleanRevealText(line.replace(/-?\d+(?:\.\d+)?/g, ''), 24) || `Item ${index + 1}`,
      value: Number.isFinite(number) ? number : index + 1
    };
  });
  const data = values.length ? values : [{ name: 'Point', value: 1 }];
  return {
    tooltip: {},
    grid: { left: 36, right: 16, top: 28, bottom: 32 },
    xAxis: { type: 'category', data: data.map((item) => item.name), axisLabel: { interval: 0, rotate: data.length > 3 ? 20 : 0 } },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: data.map((item) => item.value), itemStyle: { color: '#2563eb' } }]
  };
};

function LightVisualMermaidRenderer({ visual }: { visual: LightVisualLessonVisualBlock }) {
  const source = useMemo(() => mermaidFromLightVisual(visual), [visual]);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const diagramId = `light-visual-mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict' });
    (mermaid as any).parse?.(source)
      .then(() => mermaid.render(diagramId, source))
      .then((result: any) => {
        cleanupMermaidRenderArtifacts(diagramId);
        if (!cancelled) setSvg(result.svg || '');
      })
      .catch(() => {
        cleanupMermaidRenderArtifacts(diagramId);
        if (!cancelled) setError('Mermaid diagram could not be rendered.');
      });
    return () => {
      cancelled = true;
      cleanupMermaidRenderArtifacts(diagramId);
    };
  }, [source]);

  if (error) return <OpenWebUIMarkdownPreview content={visual.content} />;
  return svg ? (
    <div className="flex h-full min-h-[220px] items-center justify-center overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-[#94a3b8]">Rendering Mermaid...</div>
  );
}

function LightVisualEChartsRenderer({ visual }: { visual: LightVisualLessonVisualBlock }) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const option = useMemo(() => echartsOptionFromLightVisual(visual), [visual]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'svg' });
    chart.setOption(option);
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [option]);

  return <div ref={chartRef} className="h-full min-h-[240px] w-full" />;
}

const excalidrawSceneFromLightVisual = (visual: LightVisualLessonVisualBlock) => {
  const parsed = parseJsonObject(visual.content);
  if (Array.isArray(parsed?.elements)) return parsed.elements;
  const lines = lightVisualLines(visual.content);
  const items = lines.length ? lines : [visual.content || '图解'];
  const skeletons: any[] = [
    {
      type: 'rectangle',
      x: 10,
      y: 10,
      width: 460,
      height: 250,
      strokeColor: '#94a3b8',
      backgroundColor: 'transparent',
      roughness: 1
    }
  ];
  items.slice(0, 4).forEach((line, index) => {
    skeletons.push({
      type: 'rectangle',
      x: 42 + index * 92,
      y: 82,
      width: 76,
      height: 54,
      strokeColor: '#2563eb',
      backgroundColor: index % 2 ? '#fef3c7' : '#dbeafe',
      roughness: 1
    });
    skeletons.push({
      type: 'text',
      x: 46 + index * 92,
      y: 148,
      width: 84,
      height: 36,
      text: cleanRevealText(line, 20),
      fontSize: 13,
      strokeColor: '#202124'
    });
  });
  return convertToExcalidrawElements(skeletons, { regenerateIds: true });
};

function LightVisualExcalidrawRenderer({ visual }: { visual: LightVisualLessonVisualBlock }) {
  const elements = useMemo(() => excalidrawSceneFromLightVisual(visual), [visual]);
  const initialData = useMemo(() => ({
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      viewModeEnabled: true,
      zenModeEnabled: true,
      scrollX: 40,
      scrollY: 40,
      zoom: { value: 0.88 }
    }
  }), [elements]);

  return (
    <div className="h-full min-h-[260px] overflow-hidden rounded-md bg-white">
      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-[#94a3b8]">Rendering Excalidraw...</div>}>
        <ExcalidrawCanvas
          initialData={initialData as any}
          viewModeEnabled
          zenModeEnabled
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false }, tools: { image: false } } as any}
          detectScroll={false}
          handleKeyboardGlobally={false}
        />
      </Suspense>
    </div>
  );
}

const lightVisualRendererRegistry: Array<{
  id: LightVisualRendererKind;
  label: string;
  canRender: (visual: LightVisualLessonVisualBlock) => boolean;
  Component: ComponentType<{ visual: LightVisualLessonVisualBlock }>;
}> = [
  {
    id: 'echarts',
    label: 'ECharts',
    canRender: (visual) => visual.type === 'chart' || visual.type === 'table' || Boolean(parseJsonObject(visual.content)?.series),
    Component: LightVisualEChartsRenderer
  },
  {
    id: 'excalidraw',
    label: 'Excalidraw',
    canRender: (visual) => visual.type === 'sketch' || visual.type === 'image_hint',
    Component: LightVisualExcalidrawRenderer
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    canRender: () => true,
    Component: LightVisualMermaidRenderer
  }
];

function LightVisualLessonVisualPanel({ visuals }: { visuals: LightVisualLessonVisualBlock[] }) {
  if (!visuals.length) {
    return null;
  }
  return (
    <div className="h-full min-h-[260px] space-y-4">
      {visuals.map((visual, visualIndex) => {
        const renderer = lightVisualRendererRegistry.find((entry) => entry.canRender(visual)) || lightVisualRendererRegistry[lightVisualRendererRegistry.length - 1];
        const Renderer = renderer.Component;
        return (
          <div key={`${visual.type}-${visualIndex}`} className={visualIndex === 0 ? 'h-full min-h-[260px]' : 'fragment h-full min-h-[260px]'}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
              {renderer.label}
            </div>
            <div className="h-[calc(100%-1.5rem)] min-h-[230px] overflow-hidden">
              <Renderer visual={visual} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LightVisualLessonViewer({
  result,
  lesson,
  onBack
}: {
  result: LightVisualLessonViewerResult;
  lesson: LightVisualLessonPayload | null;
  onBack?: () => void;
}) {
  const slides = lesson?.slides?.length ? lesson.slides : [];
  const revealRootRef = useRef<HTMLDivElement | null>(null);
  const revealDeckRef = useRef<RevealApi | null>(null);
  const [isRevealReady, setIsRevealReady] = useState(false);
  const [isLessonPlaying, setIsLessonPlaying] = useState(false);

  useEffect(() => {
    const root = revealRootRef.current;
    if (!root || !slides.length) return;

    let cancelled = false;
    let initialized = false;
    setIsRevealReady(false);
    setIsLessonPlaying(false);
    const deck = new Reveal(root, {
      embedded: true,
      controls: true,
      progress: true,
      history: false,
      center: false,
      hash: false,
      respondToHashChanges: false,
      transition: 'slide',
      backgroundTransition: 'fade',
      width: 1280,
      height: 720,
      margin: 0.06,
      minScale: 0.2,
      maxScale: 1.4
    });

    const destroyDeck = () => {
      if (!initialized) return;
      try {
        deck.destroy();
      } catch {
        // Reveal may throw while React is tearing down an instance before it fully bound events.
      }
    };

    deck.initialize()
      .then(() => {
        initialized = true;
        if (cancelled) {
          destroyDeck();
          return;
        }
        revealDeckRef.current = deck;
        setIsRevealReady(true);
      })
      .catch(() => {
        if (revealDeckRef.current === deck) {
          revealDeckRef.current = null;
        }
        setIsRevealReady(false);
      });

    return () => {
      cancelled = true;
      if (revealDeckRef.current === deck) {
        revealDeckRef.current = null;
      }
      setIsRevealReady(false);
      setIsLessonPlaying(false);
      destroyDeck();
    };
  }, [lesson?.title, slides.length]);

  useEffect(() => {
    try {
      revealDeckRef.current?.sync();
    } catch {
      // Ignore sync calls that race with Reveal initialization or cleanup.
    }
  }, [lesson?.title, slides]);

  useEffect(() => {
    if (!isLessonPlaying) return;
    const timer = window.setInterval(() => {
      const deck = revealDeckRef.current;
      if (!deck) {
        setIsLessonPlaying(false);
        return;
      }
      try {
        const fragments = deck.availableFragments();
        const routes = deck.availableRoutes({ includeFragments: true });
        if (!fragments.next && !routes.right && !routes.down && deck.isLastSlide()) {
          setIsLessonPlaying(false);
          return;
        }
        deck.next();
      } catch {
        setIsLessonPlaying(false);
      }
    }, 1600);
    return () => window.clearInterval(timer);
  }, [isLessonPlaying]);

  const navigateReveal = (direction: 'prev' | 'next') => {
    const deck = revealDeckRef.current;
    if (!deck) return;
    setIsLessonPlaying(false);
    try {
      if (direction === 'prev') {
        deck.prev();
      } else {
        deck.next();
      }
    } catch {
      // Reveal navigation can race with initialization if the workbench is switching.
    }
  };

  if (!lesson || !slides.length) {
    return (
      <div className="mx-auto max-w-4xl">
        <OpenWebUIMarkdownPreview content={result.content} />
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-w-fit shrink-0 p-1.5 text-sm font-medium text-gray-900 transition select-none hover:text-gray-700"
            >
              <span className="whitespace-nowrap">&lt;AI Studio</span>
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#7b8190]">
              Light Visual Lesson · Reveal.js
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold text-[#202124]">{lesson.title}</h3>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-[#f4f5f7] p-4">
        <div className="mb-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => navigateReveal('prev')}
            disabled={!isRevealReady}
            title="Previous step"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
            上一步
          </button>
          <button
            type="button"
            onClick={() => setIsLessonPlaying((playing) => !playing)}
            disabled={!isRevealReady}
            title={isLessonPlaying ? 'Pause' : 'Play'}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#202124] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#34373c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLessonPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isLessonPlaying ? '暂停' : '播放'}
          </button>
          <button
            type="button"
            onClick={() => navigateReveal('next')}
            disabled={!isRevealReady}
            title="Next step"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            下一步
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exportLightVisualLessonToPdf(lesson)}
            title="Export PDF"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#dfe3ea] bg-white px-3 text-sm font-semibold text-[#343a46] shadow-sm transition hover:bg-[#f8fafc]"
          >
            <Download className="h-4 w-4" />
            导出 PDF
          </button>
        </div>
        <div
          ref={revealRootRef}
          className="reveal h-[calc(100%-48px)] min-h-[680px] overflow-hidden rounded-lg border border-[#dfe3ea] bg-white shadow-sm"
        >
          <div className="slides">
            {slides.map((slide, slideIndex) => {
              const visuals = slide.visuals || [];
              const hasVisuals = visuals.length > 0;
              const descriptionBlocks = splitLightLessonDescription(slide.description, slide.timeline?.length || 1);
              return (
                <section key={`${slide.header}-${slideIndex}`} data-auto-animate>
                  <div className="mx-auto grid h-[720px] max-h-[720px] w-full max-w-[1240px] grid-rows-[2rem_5.5rem_minmax(0,1fr)] px-6 py-5 text-left">
                    <div className="min-h-0 text-sm font-semibold uppercase tracking-wide text-[#64748b]">
                      Slide {slideIndex + 1}/{slides.length}
                    </div>
                    <h2 className="m-0 flex min-h-0 items-start overflow-hidden text-left text-[2.1rem] font-semibold leading-tight text-[#202124]">
                      {slide.header}
                    </h2>
                    <div className={`grid min-h-0 grid-cols-1 gap-8 ${hasVisuals ? 'lg:grid-cols-[minmax(0,1fr)_minmax(260px,30%)]' : ''}`}>
                      <div className={`h-full min-h-0 overflow-y-auto overscroll-contain px-1 py-1 pr-4 text-left text-[1.02rem] leading-7 text-[#202124] ${hasVisuals ? '' : 'max-w-[1080px]'}`}>
                        {descriptionBlocks.map((block, blockIndex) => (
                          <div key={`${slideIndex}-${blockIndex}`} className={blockIndex === 0 ? undefined : 'fragment'}>
                            <OpenWebUIMarkdownPreview content={block} />
                          </div>
                        ))}
                      </div>
                      {hasVisuals ? (
                        <div className="h-full min-h-0 overflow-hidden bg-white px-1 py-1 text-left">
                          <LightVisualLessonVisualPanel visuals={visuals} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
