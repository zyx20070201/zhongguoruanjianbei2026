import {Player, Stage, ValueDispatcher, Vector2, bootstrap} from '@motion-canvas/core';
import {MetaFile} from '@motion-canvas/core/lib/meta';
import {useEffect, useMemo, useRef, useState} from 'react';
import {createAlgorithmMotionScene} from './motionCanvasAlgorithmScene';
import type {AlgorithmPresentationScene, PresentationCell, PresentationObject} from './motionCanvasPresentation';

interface MotionCanvasStageProps {
  scene: AlgorithmPresentationScene;
  playing: boolean;
  stepKey: string;
}

const STAGE_WIDTH = 1600;
const STAGE_HEIGHT = 900;

const asFullSceneDescription = (scene: ReturnType<typeof createAlgorithmMotionScene>) => ({
  ...scene,
  name: 'algorithm-animation',
  size: new Vector2(STAGE_WIDTH, STAGE_HEIGHT),
  resolutionScale: 1,
  variables: undefined as any,
  playback: undefined as any,
  logger: undefined as any,
  onReplaced: new ValueDispatcher(scene as any),
  timeEventsClass: undefined as any,
  sharedWebGLContext: undefined as any,
  experimentalFeatures: false
});

export default function MotionCanvasStage({scene, playing, stepKey}: MotionCanvasStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);
  const stageRef = useRef<Stage | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const project = useMemo(() => {
    const motionScene = asFullSceneDescription(createAlgorithmMotionScene(scene, {animated: playing})) as any;
    return bootstrap(
      'AI Studio Algorithm Animation',
      {core: '3.17.2', two: '3.17.2', ui: null, vitePlugin: null},
      [],
      {
        name: 'AI Studio Algorithm Animation',
        scenes: [motionScene],
        variables: {}
      },
      new MetaFile('ai-studio-project', false),
      new MetaFile('ai-studio-settings', false)
    );
  }, [scene, playing]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    setRenderError(null);
    playerRef.current?.deactivate();
    host.replaceChildren();

    const stage = new Stage();
    const player = new Player(
      project,
      {
        fps: 60,
        range: [0, Infinity],
        size: new Vector2(STAGE_WIDTH, STAGE_HEIGHT),
        audioOffset: 0,
        resolutionScale: 1
      },
      {loop: false, muted: true, paused: true}
    );

    stage.configure({
      size: new Vector2(STAGE_WIDTH, STAGE_HEIGHT),
      resolutionScale: 1,
      colorSpace: 'srgb',
      background: '#ffffff'
    });

    const canvas = stage.finalBuffer;
    canvas.className = 'relative z-10 block h-full w-full bg-white object-contain';
    host.appendChild(canvas);

    const render = async () => {
      try {
        await stage.render(player.playback.currentScene, player.playback.previousScene);
      } catch (error) {
        console.error(error);
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    };

    player.onRender.subscribe(render);

    playerRef.current = player;
    stageRef.current = stage;

    void (async () => {
      try {
        await player.playback.recalculate();
        await player.playback.seek(playing ? 0 : player.playback.duration);
        if (cancelled) return;
        await render();
        player.togglePlayback(playing);
      } catch (error) {
        console.error(error);
        if (!cancelled) setRenderError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
      player.onRender.unsubscribe(render);
      player.togglePlayback(false);
      player.deactivate();
      if (host.contains(canvas)) host.removeChild(canvas);
    };
  }, [project, stepKey]);

  useEffect(() => {
    const player = playerRef.current;
    const stage = stageRef.current;
    if (!player || !stage) return;
    if (playing) {
      player.requestSeek(0);
      player.togglePlayback(true);
      return;
    }
    player.togglePlayback(false);
    void (async () => {
      try {
        await player.playback.seek(player.playback.duration);
        await stage.render(player.playback.currentScene, player.playback.previousScene);
      } catch (error) {
        console.error(error);
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [playing]);

  return (
    <div className="bg-white p-4 sm:p-5">
      <div className="relative aspect-video min-h-[420px] overflow-hidden rounded-lg border border-[#dfe3ea] bg-white shadow-inner">
        {!playing && !renderError ? <StaticPresentationPreview scene={scene} /> : null}
        <div ref={hostRef} className="absolute inset-0" />
        {renderError ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white p-6 text-center text-sm leading-6 text-[#a50e0e]">
            Motion Canvas render failed: {renderError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const svgPoint = (x: number, y: number) => ({
  x: (x / 100) * STAGE_WIDTH,
  y: (y / 100) * STAGE_HEIGHT
});

const objectBox = (object: PresentationObject) => ({
  x: (object.x / 100) * STAGE_WIDTH,
  y: (object.y / 100) * STAGE_HEIGHT,
  width: (object.w / 100) * STAGE_WIDTH,
  height: (object.h / 100) * STAGE_HEIGHT
});

const cellColor = (active?: boolean, changed?: boolean, muted?: boolean) => {
  if (active) return '#174ea6';
  if (changed) return '#137333';
  if (muted) return '#94a3b8';
  return '#202124';
};

function StaticPresentationPreview({scene}: {scene: AlgorithmPresentationScene}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 h-full w-full bg-white"
      viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={scene.title}
    >
      <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill="#ffffff" />
      <text x="100" y="78" fill="#202124" fontFamily="Inter, system-ui, sans-serif" fontSize="48" fontWeight="700">
        {scene.title}
      </text>
      {(scene.subtitle || scene.actionLabel) ? (
        <text x="100" y="132" fill="#5f6673" fontFamily="Inter, system-ui, sans-serif" fontSize="25">
          {scene.subtitle || scene.actionLabel}
        </text>
      ) : null}
      {scene.objects.map((object) => <StaticObject key={object.id} object={object} />)}
    </svg>
  );
}

function StaticObject({object}: {object: PresentationObject}) {
  if (object.kind === 'calculationStack') return <StaticCalculation object={object} />;
  if (object.kind === 'digitRow') return <StaticDigitRow object={object} />;
  if (object.kind === 'table') return <StaticTable object={object} />;
  if (object.kind === 'graph') return <StaticGraph object={object} />;
  if (object.kind === 'arrow') return <StaticArrow object={object} />;
  return <StaticAnnotation object={object} />;
}

function StaticCalculation({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  const operands = object.operands || [];
  const result = object.result || object.value || '';
  const rowHeight = 62;
  const startY = box.y + 86;
  return (
    <g>
      {object.label ? (
        <text x={box.x} y={box.y + 28} fill="#64748b" fontFamily="Inter, system-ui, sans-serif" fontSize="22" fontWeight="700">
          {object.label}
        </text>
      ) : null}
      {operands.map((line, index) => (
        <text
          key={`${object.id}-op-${index}`}
          x={box.x + box.width - 10}
          y={startY + index * rowHeight}
          fill={index === operands.length - 1 ? '#174ea6' : '#202124'}
          fontFamily="JetBrains Mono, SFMono-Regular, monospace"
          fontSize="54"
          fontWeight="700"
          textAnchor="end"
        >
          {line}
        </text>
      ))}
      {result ? (
        <>
          <line x1={box.x + 12} x2={box.x + box.width - 12} y1={startY + operands.length * rowHeight - 34} y2={startY + operands.length * rowHeight - 34} stroke="#94a3b8" strokeWidth="3" />
          <text x={box.x + box.width - 10} y={startY + operands.length * rowHeight + 26} fill="#137333" fontFamily="JetBrains Mono, SFMono-Regular, monospace" fontSize="62" fontWeight="800" textAnchor="end">
            {result}
          </text>
        </>
      ) : null}
    </g>
  );
}

function StaticDigitRow({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  const cells: PresentationCell[] = object.cells?.length ? object.cells : String(object.value || '').split('').map((value, index) => ({id: `${object.id}-${index}`, value}));
  const cellWidth = Math.min(56, Math.max(34, box.width / Math.max(1, cells.length)));
  const startX = box.x + box.width / 2 - ((cells.length - 1) * cellWidth) / 2;
  return (
    <g>
      {object.label ? <text x={box.x} y={box.y + 24} fill="#64748b" fontFamily="Inter, system-ui, sans-serif" fontSize="20" fontWeight="700">{object.label}</text> : null}
      {cells.map((cell, index) => {
        const x = startX + index * cellWidth;
        const y = box.y + box.height / 2;
        return (
          <g key={cell.id}>
            <rect x={x - (cellWidth - 8) / 2} y={y - 29} width={cellWidth - 8} height="58" rx="8" fill={cell.active ? '#e8f0fe' : cell.changed ? '#e8f6ee' : '#ffffff'} stroke={cell.active ? '#1f5fd0' : '#dfe3ea'} strokeWidth={cell.active ? 3 : 1} opacity={cell.muted ? 0 : 1} />
            <text x={x} y={y + 13} fill={cellColor(cell.active, cell.changed, cell.muted)} fontFamily="JetBrains Mono, SFMono-Regular, monospace" fontSize="36" fontWeight="800" textAnchor="middle">
              {cell.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function StaticTable({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  const columns = object.columns?.length ? object.columns : ['State', 'Value'];
  const rows = object.rows?.slice(0, 6) || [];
  const rowHeight = 42;
  const colWidth = box.width / Math.max(1, columns.length);
  return (
    <g>
      <text x={box.x} y={box.y - 10} fill="#64748b" fontFamily="Inter, system-ui, sans-serif" fontSize="20" fontWeight="700">{object.label || 'Table'}</text>
      {[columns, ...rows.map((row) => row.cells)].map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          const active = rowIndex > 0 && Boolean(rows[rowIndex - 1]?.active || rows[rowIndex - 1]?.changed);
          const x = box.x + colIndex * colWidth;
          const y = box.y + rowIndex * rowHeight;
          return (
            <g key={`${rowIndex}-${colIndex}`}>
              <rect x={x} y={y} width={colWidth} height={rowHeight} fill={active ? '#e8f0fe' : rowIndex === 0 ? '#f8fafc' : '#ffffff'} stroke="#dfe3ea" />
              <text x={x + colWidth / 2} y={y + 27} fill={active ? '#174ea6' : '#334155'} fontFamily="Inter, system-ui, sans-serif" fontSize={rowIndex === 0 ? 18 : 17} fontWeight={rowIndex === 0 || active ? 700 : 600} textAnchor="middle">
                {String(cell ?? '').slice(0, 18)}
              </text>
            </g>
          );
        })
      )}
    </g>
  );
}

function StaticGraph({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  const nodes = object.nodes || [];
  const nodePoint = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    return node ? {x: box.x + (node.x / 100) * box.width, y: box.y + (node.y / 100) * box.height} : null;
  };
  return (
    <g>
      {object.label ? <text x={box.x} y={box.y - 10} fill="#64748b" fontFamily="Inter, system-ui, sans-serif" fontSize="20" fontWeight="700">{object.label}</text> : null}
      {(object.edges || []).map((edge) => {
        const source = nodePoint(edge.source);
        const target = nodePoint(edge.target);
        return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={edge.active ? '#1f5fd0' : '#cbd5e1'} strokeWidth={edge.active ? 4 : 2} /> : null;
      })}
      {nodes.map((node) => {
        const point = svgPoint(object.x + (node.x / 100) * object.w, object.y + (node.y / 100) * object.h);
        return (
          <g key={node.id}>
            <circle cx={point.x} cy={point.y} r="32" fill={node.active ? '#e8f0fe' : '#ffffff'} stroke={node.active ? '#1f5fd0' : '#dfe3ea'} strokeWidth={node.active ? 4 : 2} />
            <text x={point.x} y={point.y + 7} fill={node.active ? '#174ea6' : '#202124'} fontFamily="Inter, system-ui, sans-serif" fontSize="20" fontWeight="800" textAnchor="middle">
              {node.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function StaticArrow({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  const y = box.y + box.height / 2;
  const markerId = `arrow-${object.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <g>
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#34a853" />
        </marker>
      </defs>
      <line x1={box.x} y1={y} x2={box.x + box.width} y2={y} stroke="#34a853" strokeWidth="4" markerEnd={`url(#${markerId})`} />
      {(object.label || object.value) ? <text x={box.x + box.width / 2} y={y - 28} fill="#137333" fontFamily="Inter, system-ui, sans-serif" fontSize="20" fontWeight="700" textAnchor="middle">{object.label || object.value}</text> : null}
    </g>
  );
}

function StaticAnnotation({object}: {object: PresentationObject}) {
  const box = objectBox(object);
  return (
    <text x={box.x + box.width / 2} y={box.y + box.height / 2} fill={object.emphasis === 'active' ? '#174ea6' : '#475569'} fontFamily="Inter, system-ui, sans-serif" fontSize="28" fontWeight={object.emphasis === 'active' ? 700 : 500} textAnchor="middle">
      {object.value || object.label || ''}
    </text>
  );
}
