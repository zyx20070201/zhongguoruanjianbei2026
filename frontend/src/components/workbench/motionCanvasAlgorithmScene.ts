import {Line, Rect, Txt, makeScene2D, type View2D} from '@motion-canvas/2d';
import {all, createRef, waitFor} from '@motion-canvas/core';
import type {AlgorithmPresentationScene, PresentationCell, PresentationObject} from './motionCanvasPresentation';

const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 900;

const toCanvasPoint = (x: number, y: number) => [
  (x / 100) * CANVAS_WIDTH - CANVAS_WIDTH / 2,
  (y / 100) * CANVAS_HEIGHT - CANVAS_HEIGHT / 2
] as [number, number];

const objectCenter = (object: PresentationObject) => toCanvasPoint(object.x + object.w / 2, object.y + object.h / 2);
const objectSize = (object: PresentationObject) => [(object.w / 100) * CANVAS_WIDTH, (object.h / 100) * CANVAS_HEIGHT] as [number, number];
const objectTopLeft = (object: PresentationObject) => toCanvasPoint(object.x, object.y);
const compact = (value: unknown, fallback = '') => String(value ?? fallback).slice(0, 48);

const cellColor = (active?: boolean, changed?: boolean, muted?: boolean) => {
  if (active) return '#1f5fd0';
  if (changed) return '#137333';
  if (muted) return '#94a3b8';
  return '#202124';
};

const addTxt = (view: View2D, ref: ReturnType<typeof createRef<Txt>>, props: ConstructorParameters<typeof Txt>[0]) => {
  const node = new Txt(props);
  ref(node);
  view.add(node);
};

const addRect = (view: View2D, ref: ReturnType<typeof createRef<Rect>>, props: ConstructorParameters<typeof Rect>[0]) => {
  const node = new Rect(props);
  ref(node);
  view.add(node);
};

const addLine = (view: View2D, ref: ReturnType<typeof createRef<Line>>, props: ConstructorParameters<typeof Line>[0]) => {
  const node = new Line(props);
  ref(node);
  view.add(node);
};

interface AlgorithmMotionSceneOptions {
  animated?: boolean;
}

const visibleOpacity = (animated: boolean) => (animated ? 0 : 1);
const visibleLineEnd = (animated: boolean) => (animated ? 0 : 1);

export const createAlgorithmMotionScene = (scene: AlgorithmPresentationScene, options: AlgorithmMotionSceneOptions = {}) =>
  makeScene2D(function* (view) {
    const animated = Boolean(options.animated);
    view.fill('#ffffff');

    const title = createRef<Txt>();
    const subtitle = createRef<Txt>();
    addTxt(view, title, {
      text: scene.title,
      x: -700,
      y: -375,
      width: 900,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 48,
      fontWeight: 700,
      fill: '#202124',
      textAlign: 'left',
      opacity: visibleOpacity(animated)
    });
    addTxt(view, subtitle, {
      text: scene.subtitle || scene.actionLabel || '',
      x: -700,
      y: -315,
      width: 980,
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      fontSize: 25,
      fill: '#5f6673',
      textAlign: 'left',
      opacity: scene.subtitle || scene.actionLabel ? visibleOpacity(animated) : 0
    });

    yield* all(title().opacity(1, 0.25), subtitle().opacity(scene.subtitle || scene.actionLabel ? 1 : 0, 0.25));

    for (const object of scene.objects) {
      if (object.kind === 'calculationStack') yield* drawCalculationStack(view, object, animated);
      else if (object.kind === 'digitRow') yield* drawDigitRow(view, object, animated);
      else if (object.kind === 'table') yield* drawTable(view, object, animated);
      else if (object.kind === 'graph') yield* drawGraph(view, object, animated);
      else if (object.kind === 'arrow') yield* drawArrow(view, object, animated);
      else yield* drawAnnotation(view, object, animated);
    }

    yield* waitFor(0.5);
  });

function* drawCalculationStack(view: View2D, object: PresentationObject, animated: boolean) {
  const group = createRef<Rect>();
  const [x, y] = objectCenter(object);
  const operands = object.operands || [];
  const result = object.result || object.value || '';
  const width = Math.max(420, objectSize(object)[0]);
  const rowHeight = 62;
  const startY = y - ((operands.length + (result ? 1 : 0)) * rowHeight) / 2;

  addRect(view, group, {x, y, width, height: objectSize(object)[1], opacity: visibleOpacity(animated)});
  yield* group().opacity(1, 0.1);

  const label = createRef<Txt>();
  addTxt(view, label, {
    text: object.label || 'Calculation',
    x: x - width / 2,
    y: startY - 58,
    width,
    fontFamily: 'Inter, ui-sans-serif, system-ui',
    fontSize: 22,
    fontWeight: 700,
    fill: '#64748b',
    textAlign: 'left',
    opacity: visibleOpacity(animated)
  });
  yield* label().opacity(1, 0.2);

  for (let index = 0; index < operands.length; index += 1) {
    const line = createRef<Txt>();
    addTxt(view, line, {
      text: operands[index],
      x: x + width / 2 - 24,
      y: startY + index * rowHeight,
      width,
      fontFamily: 'JetBrains Mono, SFMono-Regular, monospace',
      fontSize: 54,
      fontWeight: 700,
      fill: index === operands.length - 1 ? '#174ea6' : '#202124',
      textAlign: 'right',
      opacity: visibleOpacity(animated)
    });
    yield* all(line().opacity(1, 0.2), line().x(x + width / 2 - 4, 0.25));
  }

  if (result) {
    const rule = createRef<Line>();
    const resultText = createRef<Txt>();
    const lineY = startY + operands.length * rowHeight - 26;
    addLine(view, rule, {points: [[-width / 2, 0], [width / 2, 0]], x, y: lineY, stroke: '#94a3b8', lineWidth: 3, end: visibleLineEnd(animated)});
    addTxt(view, resultText, {
      text: result,
      x: x + width / 2 - 4,
      y: lineY + 52,
      width,
      fontFamily: 'JetBrains Mono, SFMono-Regular, monospace',
      fontSize: 62,
      fontWeight: 800,
      fill: '#137333',
      textAlign: 'right',
      opacity: visibleOpacity(animated)
    });
    yield* rule().end(1, 0.25);
    yield* resultText().opacity(1, 0.25);
  }
}

function* drawDigitRow(view: View2D, object: PresentationObject, animated: boolean) {
  const [x, y] = objectCenter(object);
  const cells: PresentationCell[] = object.cells?.length ? object.cells : String(object.value || '').split('').map((value, index) => ({id: `${object.id}-${index}`, value}));
  const label = createRef<Txt>();
  const [width] = objectSize(object);

  addTxt(view, label, {
    text: object.label || '',
    x: x - width / 2,
    y: y - 56,
    width,
    fontFamily: 'Inter, ui-sans-serif, system-ui',
    fontSize: 20,
    fontWeight: 700,
    fill: '#64748b',
    textAlign: 'left',
    opacity: object.label ? visibleOpacity(animated) : 0
  });
  yield* label().opacity(object.label ? 1 : 0, 0.15);

  const cellWidth = Math.min(56, Math.max(34, width / Math.max(1, cells.length)));
  const startX = x - ((cells.length - 1) * cellWidth) / 2;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const text = createRef<Txt>();
    const highlight = createRef<Rect>();
    addRect(view, highlight, {
      x: startX + index * cellWidth,
      y,
      width: cellWidth - 8,
      height: 58,
      radius: 8,
      fill: cell.active ? '#e8f0fe' : cell.changed ? '#e8f6ee' : '#ffffff',
      stroke: cell.active ? '#1f5fd0' : '#dfe3ea',
      lineWidth: cell.active ? 3 : 1,
      opacity: cell.muted ? 0 : visibleOpacity(animated)
    });
    addTxt(view, text, {
      text: cell.value,
      x: startX + index * cellWidth,
      y,
      fontFamily: 'JetBrains Mono, SFMono-Regular, monospace',
      fontSize: 36,
      fontWeight: 800,
      fill: cellColor(cell.active, cell.changed, cell.muted),
      opacity: visibleOpacity(animated)
    });
    yield* all(highlight().opacity(cell.muted ? 0 : 1, 0.12), text().opacity(1, 0.12));
  }
}

function* drawTable(view: View2D, object: PresentationObject, animated: boolean) {
  const [left, top] = objectTopLeft(object);
  const [width] = objectSize(object);
  const rowHeight = 42;
  const columns = object.columns?.length ? object.columns : ['State', 'Value'];
  const rows = object.rows?.slice(0, 6) || [];
  const label = createRef<Txt>();
  addTxt(view, label, {text: object.label || 'Table', x: left, y: top - 32, width, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 20, fontWeight: 700, fill: '#64748b', textAlign: 'left', opacity: visibleOpacity(animated)});
  yield* label().opacity(1, 0.2);

  const colWidth = width / Math.max(1, columns.length);
  for (let col = 0; col < columns.length; col += 1) {
    yield* addTableCell(view, columns[col], left + colWidth * col + colWidth / 2, top, colWidth, rowHeight, true, false, animated);
  }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let col = 0; col < columns.length; col += 1) {
      yield* addTableCell(view, compact(row.cells[col], ''), left + colWidth * col + colWidth / 2, top + rowHeight * (rowIndex + 1), colWidth, rowHeight, false, Boolean(row.active || row.changed), animated);
    }
  }
}

function* addTableCell(view: View2D, value: string, x: number, y: number, width: number, height: number, header: boolean, active: boolean, animated: boolean) {
  const rect = createRef<Rect>();
  const text = createRef<Txt>();
  addRect(view, rect, {x, y, width, height, fill: active ? '#e8f0fe' : header ? '#f8fafc' : '#ffffff', stroke: '#dfe3ea', lineWidth: 1, opacity: visibleOpacity(animated)});
  addTxt(view, text, {text: value, x, y, width: width - 10, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: header ? 18 : 17, fontWeight: header || active ? 700 : 600, fill: active ? '#174ea6' : '#334155', textAlign: 'center', opacity: visibleOpacity(animated)});
  yield* all(rect().opacity(1, 0.08), text().opacity(1, 0.08));
}

function* drawGraph(view: View2D, object: PresentationObject, animated: boolean) {
  const [left, top] = objectTopLeft(object);
  const [width, height] = objectSize(object);
  const nodes = object.nodes || [];
  const edges = object.edges || [];
  const nodePoint = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    return node ? [left + (node.x / 100) * width, top + (node.y / 100) * height] as [number, number] : null;
  };

  for (const edge of edges) {
    const source = nodePoint(edge.source);
    const target = nodePoint(edge.target);
    if (!source || !target) continue;
    const line = createRef<Line>();
    addLine(view, line, {points: [source, target], stroke: edge.active ? '#1f5fd0' : '#cbd5e1', lineWidth: edge.active ? 4 : 2, end: visibleLineEnd(animated)});
    yield* line().end(1, 0.12);
  }

  for (const node of nodes) {
    const circle = createRef<Rect>();
    const text = createRef<Txt>();
    const nodeX = left + (node.x / 100) * width;
    const nodeY = top + (node.y / 100) * height;
    addRect(view, circle, {x: nodeX, y: nodeY, width: 64, height: 64, radius: 32, fill: node.active ? '#e8f0fe' : '#ffffff', stroke: node.active ? '#1f5fd0' : '#dfe3ea', lineWidth: node.active ? 4 : 2, opacity: visibleOpacity(animated)});
    addTxt(view, text, {text: compact(node.label, node.id), x: nodeX, y: nodeY, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 20, fontWeight: 800, fill: node.active ? '#174ea6' : '#202124', opacity: visibleOpacity(animated)});
    yield* all(circle().opacity(1, 0.16), text().opacity(1, 0.16));
  }
}

function* drawArrow(view: View2D, object: PresentationObject, animated: boolean) {
  const [x, y] = objectCenter(object);
  const [width] = objectSize(object);
  const line = createRef<Line>();
  const label = createRef<Txt>();
  addLine(view, line, {points: [[-width / 2, 0], [width / 2, 0]], x, y, stroke: '#34a853', lineWidth: 4, endArrow: true, end: visibleLineEnd(animated)});
  addTxt(view, label, {text: object.label || object.value || '', x, y: y - 34, width, fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 20, fontWeight: 700, fill: '#137333', textAlign: 'center', opacity: object.label || object.value ? visibleOpacity(animated) : 0});
  yield* all(line().end(1, 0.25), label().opacity(object.label || object.value ? 1 : 0, 0.25));
}

function* drawAnnotation(view: View2D, object: PresentationObject, animated: boolean) {
  const [x, y] = objectCenter(object);
  const text = createRef<Txt>();
  addTxt(view, text, {
    text: object.value || object.label || '',
    x,
    y,
    width: objectSize(object)[0],
    fontFamily: 'Inter, ui-sans-serif, system-ui',
    fontSize: 28,
    fontWeight: object.emphasis === 'active' ? 700 : 500,
    fill: object.emphasis === 'active' ? '#174ea6' : '#475569',
    textAlign: 'center',
    opacity: visibleOpacity(animated)
  });
  yield* all(text().opacity(1, 0.25), text().y(y - 8, 0.25));
}
