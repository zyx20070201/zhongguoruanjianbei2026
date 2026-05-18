import { StudioGenerationContext, StudioReviewResult } from './types';
import { buildFallbackTeachingVisualizationIR, normalizeTeachingVisualizationIR } from './visualizationIr';

type DeliveryKind = 'markdown' | 'pptx' | 'html' | 'python' | 'tsx';

export interface StudioDeliveryArtifact {
  kind: DeliveryKind;
  filename: string;
  content: string | Buffer;
  mimeType: string;
  isBinary: boolean;
  framework?: string;
  previewContent?: string;
  metadata?: Record<string, unknown>;
}

const clip = (value: string | null | undefined, maxLength = 1400) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const latestPrompt = (context: StudioGenerationContext) =>
  clip(context.input.prompt || context.template.promptFrame || context.template.title, 180);

const splitSlides = (content: string) =>
  content
    .split(/\n---+\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const title = block.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() || `Slide ${index + 1}`;
      const bullets = block
        .split('\n')
        .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
        .filter((item): item is string => Boolean(item))
        .slice(0, 6);
      const notes = block.match(/Notes:\s*([\s\S]*?)(?:\nVisual:|$)/i)?.[1]?.trim() || '';
      const visual = block.match(/Visual:\s*([\s\S]*?)$/i)?.[1]?.trim() || '';
      return { title, bullets, notes, visual };
    });

const toFileBase = (filename: string) => filename.replace(/\.[^.]+$/, '');

const pptxMime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const buildPptx = async (context: StudioGenerationContext, content: string): Promise<Buffer> => {
  // PptxGenJS is intentionally required here so the rest of Studio can still run
  // even if a deployment has not installed the optional deck renderer yet.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AI Studio';
  pptx.company = 'PP1';
  pptx.subject = context.template.title;
  pptx.title = latestPrompt(context);
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'zh-CN'
  };

  const slides = splitSlides(content);
  const deckSlides = slides.length ? slides : [{ title: latestPrompt(context), bullets: [clip(content, 420)], notes: '', visual: '' }];
  const accent = '1F5FD0';
  const text = '202124';
  const muted = '5F6368';

  deckSlides.slice(0, 18).forEach((item, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: index === 0 ? 'F6F7FB' : 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: accent }, line: { color: accent } });
    slide.addText(item.title, {
      x: 0.65,
      y: 0.52,
      w: 8.3,
      h: 0.64,
      fontFace: 'Aptos Display',
      fontSize: index === 0 ? 30 : 24,
      bold: true,
      color: text,
      margin: 0
    });
    slide.addText(`${index + 1} / ${deckSlides.length}`, {
      x: 11.35,
      y: 0.62,
      w: 1.2,
      h: 0.28,
      fontSize: 10,
      color: muted,
      align: 'right',
      margin: 0
    });

    const bullets = item.bullets.length ? item.bullets : [item.notes || item.visual || clip(content, 260)];
    slide.addText(
      bullets.map((bullet) => ({ text: clip(bullet, 150), options: { bullet: { indent: 18 }, hanging: 4 } })),
      {
        x: 0.85,
        y: 1.55,
        w: 7.0,
        h: 4.25,
        fontSize: 17,
        breakLine: false,
        color: text,
        fit: 'shrink',
        paraSpaceAfterPt: 10,
        margin: 0.05
      }
    );

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.45,
      y: 1.5,
      w: 3.95,
      h: 3.0,
      rectRadius: 0.08,
      fill: { color: index === 0 ? 'FFFFFF' : 'F6F7FB' },
      line: { color: 'E5E7EB' }
    });
    slide.addText(item.visual || 'Visual suggestion\nUse this area for diagrams, timelines, formulas, or screenshots.', {
      x: 8.82,
      y: 1.88,
      w: 3.2,
      h: 1.9,
      fontSize: 14,
      color: muted,
      fit: 'shrink',
      valign: 'mid',
      margin: 0
    });

    if (item.notes) {
      slide.addNotes(item.notes);
      slide.addText(`Notes: ${clip(item.notes, 180)}`, {
        x: 0.85,
        y: 6.05,
        w: 11.2,
        h: 0.44,
        fontSize: 10,
        color: muted,
        fit: 'shrink',
        margin: 0
      });
    }
  });

  const raw = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
};

const p5Html = (context: StudioGenerationContext, content: string) => {
  const title = latestPrompt(context);
  const citations = context.capsule.citations.slice(0, 6).map((citation) => citation.label);
  const parsed = (() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  })();
  const visualization = normalizeTeachingVisualizationIR(context, parsed?.payload || parsed || buildFallbackTeachingVisualizationIR(context, content), content);
  const irJson = JSON.stringify(visualization).replace(/</g, '\\u003c');
  const notes = clip(content, 1200);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - Interactive Demo</title>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #fbfbfa; color: #202124; }
    .shell { display: grid; grid-template-columns: minmax(0, 1fr) 320px; min-height: 100vh; }
    main { min-width: 0; display: grid; place-items: center; padding: 24px; }
    aside { border-left: 1px solid #e5e5e1; background: #fff; padding: 18px; overflow: auto; }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.2; }
    p, li { line-height: 1.65; color: #5f6368; }
    .control { margin: 18px 0; }
    label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 700; color: #777a80; text-transform: uppercase; }
    input[type="range"] { width: 100%; }
    button { border: 1px solid #202124; background: #202124; color: #fff; border-radius: 999px; padding: 9px 14px; font-weight: 700; cursor: pointer; }
    button.secondary { background: #fff; color: #202124; }
    .canvas-wrap { width: min(100%, 980px); aspect-ratio: 16 / 10; border: 1px solid #e5e5e1; background: #fff; box-shadow: 0 16px 50px rgba(15, 23, 42, 0.08); }
    canvas { display: block; width: 100% !important; height: 100% !important; }
    code { background: #f1f5f9; padding: 2px 5px; border-radius: 5px; }
    @media (max-width: 860px) { .shell { grid-template-columns: 1fr; } aside { border-left: 0; border-top: 1px solid #e5e5e1; } }
  </style>
</head>
<body>
  <div class="shell">
    <main><div id="canvas" class="canvas-wrap"></div></main>
    <aside>
      <h1>${escapeHtml(title)}</h1>
      <p>这个演示使用 AI Studio 教学过程 IR：先生成步骤轨迹，再映射到通用视觉元素。</p>
      <div class="control">
        <label for="speed">Speed / 速度</label>
        <input id="speed" type="range" min="1" max="8" value="3" />
      </div>
      <div class="control">
        <label for="amplitude">Parameter / 参数</label>
        <input id="amplitude" type="range" min="20" max="180" value="90" />
      </div>
      <p>
        <button id="play">Play</button>
        <button id="step" class="secondary">Next step</button>
        <button id="reset" class="secondary">Reset</button>
      </p>
      <h2 id="step-title">步骤</h2>
      <p id="step-text">${escapeHtml(notes)}</p>
      <p id="step-check"></p>
      <h2>来源</h2>
      <ul>${citations.length ? citations.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>当前上下文</li>'}</ul>
    </aside>
  </div>
  <script>
    const visualization = ${irJson};
    const trace = visualization.processTrace || { steps: [], stateModel: { primitives: [] } };
    const primitive = (trace.stateModel.primitives || [])[0] || { id: 'main', kind: 'text', label: 'Visual', data: {} };
    const state = { t: 0, step: 0, playing: false };
    const labels = (trace.steps || []).map((step) => step.title);
    function currentStep() { return trace.steps[state.step] || trace.steps[0] || { title: 'Step', narration: '', observation: '', visualCues: [] }; }
    function activeTargets() {
      const step = currentStep();
      const cue = (step.visualCues || []).find((item) => item.primitiveId === primitive.id) || (step.visualCues || [])[0] || { targetIds: [], effect: 'focus' };
      return { ids: new Set(cue.targetIds || step.operation?.targetIds || []), effect: cue.effect || 'focus' };
    }
    function updateText() {
      const step = currentStep();
      document.getElementById('step-title').textContent = 'Step ' + (state.step + 1) + ': ' + (step.title || '');
      document.getElementById('step-text').textContent = [step.narration, step.observation].filter(Boolean).join(' ');
      document.getElementById('step-check').textContent = step.checkQuestion || '';
    }
    document.getElementById('play').onclick = () => { state.playing = !state.playing; document.getElementById('play').textContent = state.playing ? 'Pause' : 'Play'; };
    document.getElementById('step').onclick = () => { state.step = (state.step + 1) % Math.max(1, labels.length); updateText(); };
    document.getElementById('reset').onclick = () => { state.t = 0; state.step = 0; state.playing = false; document.getElementById('play').textContent = 'Play'; updateText(); };
    function setup() {
      const host = document.getElementById('canvas');
      const canvas = createCanvas(host.clientWidth, host.clientHeight);
      canvas.parent('canvas');
      textFont('Inter, system-ui, sans-serif');
    }
    function windowResized() {
      const host = document.getElementById('canvas');
      resizeCanvas(host.clientWidth, host.clientHeight);
    }
    function draw() {
      const speed = Number(document.getElementById('speed').value);
      const amplitude = Number(document.getElementById('amplitude').value);
      if (state.playing) state.t += 0.012 * speed;
      background('#ffffff');
      stroke('#e5e7eb');
      for (let x = 40; x < width; x += 48) line(x, 0, x, height);
      for (let y = 40; y < height; y += 48) line(0, y, width, y);
      noStroke();
      fill('#202124');
      textSize(24);
      text('${escapeHtml(title).replace(/'/g, "\\'")}', 34, 46);
      textSize(13);
      fill('#5f6368');
      text('Step ' + (state.step + 1) + ': ' + (labels[state.step] || 'Process'), 36, 74);
      const active = activeTargets();
      const baseY = height * 0.58;
      const sourceItems = primitive.kind === 'sequence' && Array.isArray(primitive.data.items) ? primitive.data.items : [];
      const sourceNodes = (primitive.kind === 'graph' || primitive.kind === 'state_machine') && Array.isArray(primitive.data.nodes) ? primitive.data.nodes : [];
      const displayItems = sourceItems.length ? sourceItems : sourceNodes.length ? sourceNodes : Array.from({ length: 7 }).map((_, index) => ({ id: 'item-' + index, label: String(index + 1) }));
      const count = displayItems.length;
      for (let i = 0; i < count; i++) {
        const progress = (i / Math.max(1, count - 1));
        const x = 80 + progress * (width - 160);
        const y = baseY + Math.sin(state.t * 3 + i * 0.78 + state.step) * amplitude * 0.45;
        const item = displayItems[i] || {};
        const itemId = String(item.id || 'item-' + i);
        const isActive = active.ids.has(itemId);
        fill(isActive ? (active.effect === 'warning' ? '#ea4335' : active.effect === 'success' ? '#34a853' : '#1f5fd0') : ['#78d9ff', '#9dffcb', '#ffd166', '#f78fb3'][i % 4]);
        circle(x, y, 34 + (isActive ? 10 : 0));
        fill('#202124');
        textAlign(CENTER);
        text(String(item.label || item.value || i + 1), x, y + 5);
        if (i > 0) {
          stroke('#94a3b8');
          line(x - (width - 160) / (count - 1), baseY + Math.sin(state.t * 3 + (i - 1) * 0.78 + state.step) * amplitude * 0.45, x, y);
          noStroke();
        }
      }
      textAlign(LEFT);
      fill('#334155');
      textSize(15);
      text('观察问题：参数变化时，哪些节点/状态先改变？下一步为什么成立？', 36, height - 42);
    }
    updateText();
  </script>
</body>
</html>`;
};

const manimSource = (context: StudioGenerationContext, content: string) => {
  const title = latestPrompt(context).replace(/"/g, '\\"');
  const notes = clip(content, 900).replace(/"""/g, '\\"\\"\\"');
  return `from manim import *


class AIStudioExplanation(Scene):
    """Generated by AI Studio.

    Topic: ${title}
    Notes: ${notes}
    """

    def construct(self):
        title = Text("${title}", font_size=34).to_edge(UP)
        subtitle = Text("Algorithm / math / physics animation scaffold", font_size=20, color=GRAY).next_to(title, DOWN)
        self.play(Write(title), FadeIn(subtitle, shift=DOWN))

        axes = Axes(x_range=[0, 8, 1], y_range=[-2, 2, 1], x_length=8, y_length=3)
        axes.to_edge(DOWN)
        curve = axes.plot(lambda x: 1.2 * np.sin(x), color=BLUE)
        dot = Dot(color=YELLOW).move_to(axes.c2p(0, 0))
        tracker = ValueTracker(0)
        dot.add_updater(lambda m: m.move_to(axes.c2p(tracker.get_value(), 1.2 * np.sin(tracker.get_value()))))

        step_labels = VGroup(
            Text("1. Identify input / initial state", font_size=24),
            Text("2. Show transition rule", font_size=24),
            Text("3. Animate state update", font_size=24),
            Text("4. Explain result and checks", font_size=24),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.25).to_edge(LEFT).shift(DOWN * 0.2)

        self.play(Create(axes), Create(curve), FadeIn(step_labels), FadeIn(dot))
        self.play(tracker.animate.set_value(7.5), run_time=5, rate_func=linear)
        self.play(Circumscribe(step_labels[2], color=YELLOW))
        self.wait(1)


# Run locally:
# manim -pqh visualize-manim-animation.py AIStudioExplanation
`;
};

const remotionSource = (context: StudioGenerationContext, content: string) => {
  const title = latestPrompt(context).replace(/`/g, '\\`');
  const summary = clip(content, 700).replace(/`/g, '\\`');
  return `import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

const title = \`${title}\`;
const summary = \`${summary}\`;

export const AIStudioVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp' });
  const y = interpolate(frame, [0, fps], [28, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: '#fbfbfa', color: '#202124', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sequence from={0} durationInFrames={fps * 4}>
        <div style={{ padding: 72, opacity, transform: \`translateY(\${y}px)\` }}>
          <div style={{ fontSize: 18, color: '#1f5fd0', fontWeight: 700 }}>AI Studio Learning Report</div>
          <h1 style={{ fontSize: 58, lineHeight: 1.05, maxWidth: 980 }}>{title}</h1>
        </div>
      </Sequence>
      <Sequence from={fps * 3} durationInFrames={fps * 6}>
        <div style={{ position: 'absolute', left: 72, right: 72, bottom: 88, padding: 34, border: '1px solid #e5e7eb', borderRadius: 18, background: '#fff' }}>
          <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 14 }}>Key idea</div>
          <div style={{ fontSize: 24, lineHeight: 1.45, color: '#475569' }}>{summary}</div>
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

// Example composition:
// <Composition id="AIStudioVideo" component={AIStudioVideo} durationInFrames={270} fps={30} width={1920} height={1080} />
`;
};

export const buildStudioDeliveryArtifact = async (
  context: StudioGenerationContext,
  content: string,
  review: StudioReviewResult
): Promise<StudioDeliveryArtifact> => {
  if (context.template.id === 'slide_deck') {
    try {
      return {
        kind: 'pptx',
        filename: `${toFileBase(context.template.filename)}.pptx`,
        content: await buildPptx(context, content),
        mimeType: pptxMime,
        isBinary: true,
        framework: 'PptxGenJS',
        previewContent: content,
        metadata: { visualFramework: 'PptxGenJS' }
      };
    } catch (error) {
      return {
        kind: 'markdown',
        filename: context.template.filename,
        content: `${content}\n\n> PPTX renderer unavailable: ${error instanceof Error ? error.message : String(error)}`,
        mimeType: 'text/markdown; charset=utf-8',
        isBinary: false,
        framework: 'Markdown fallback',
        metadata: { visualFramework: 'PptxGenJS', rendererError: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  if (context.template.id === 'interactive_demo') {
    return {
      kind: 'html',
      filename: 'visualize-interactive-demo.html',
      content: p5Html(context, content),
      mimeType: 'text/html; charset=utf-8',
      isBinary: false,
      framework: 'p5.js',
      previewContent: content,
      metadata: { visualFramework: 'p5.js' }
    };
  }

  if (context.template.id === 'algorithm_animation') {
    return {
      kind: 'python',
      filename: 'visualize-manim-animation.py',
      content: manimSource(context, content),
      mimeType: 'text/x-python; charset=utf-8',
      isBinary: false,
      framework: 'Manim',
      previewContent: content,
      metadata: { visualFramework: 'Manim', renderCommand: 'manim -pqh visualize-manim-animation.py AIStudioExplanation' }
    };
  }

  if (context.template.id === 'ui_video') {
    return {
      kind: 'tsx',
      filename: 'visualize-remotion-video.tsx',
      content: remotionSource(context, content),
      mimeType: 'text/typescript; charset=utf-8',
      isBinary: false,
      framework: 'Remotion',
      previewContent: content,
      metadata: { visualFramework: 'Remotion' }
    };
  }

  return {
    kind: 'markdown',
    filename: context.template.filename,
    content,
    mimeType: context.template.format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
    isBinary: false,
    framework: undefined,
    metadata: { reviewScore: review.score }
  };
};
