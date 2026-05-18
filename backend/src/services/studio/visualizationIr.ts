import { StudioGenerationContext } from './types';

export type TeachingDomain =
  | 'sequence'
  | 'graph'
  | 'table'
  | 'state_machine'
  | 'formula'
  | 'hybrid';

export type VisualPrimitiveKind =
  | 'sequence'
  | 'graph'
  | 'table'
  | 'state_machine'
  | 'formula'
  | 'variables'
  | 'text';

export interface TeachingUnderstandingIR {
  schemaVersion: 'teaching_understanding.v1';
  learningObjectives: string[];
  coreConcepts: string[];
  prerequisites: string[];
  misconceptions: string[];
  explanationStrategy: string[];
  assessmentCheckpoints: string[];
}

export interface ProcessVisualCue {
  primitiveId: string;
  targetIds: string[];
  effect: 'focus' | 'compare' | 'update' | 'create' | 'remove' | 'success' | 'warning';
  label?: string;
}

export interface ProcessStepIR {
  id: string;
  index: number;
  title: string;
  goal: string;
  operation: {
    type: 'initialize' | 'inspect' | 'compare' | 'transition' | 'update' | 'emit' | 'summarize';
    targetIds: string[];
    description: string;
  };
  statePatch: Record<string, unknown>;
  narration: string;
  observation: string;
  misconception?: string;
  checkQuestion?: string;
  visualCues: ProcessVisualCue[];
}

export interface ProcessTraceIR {
  schemaVersion: 'process_trace.v1';
  domain: TeachingDomain;
  title: string;
  initialState: Record<string, unknown>;
  stateModel: {
    primitives: Array<{
      id: string;
      kind: VisualPrimitiveKind;
      label: string;
      role?: string;
      data: Record<string, unknown>;
    }>;
    variables: Array<{ id: string; label: string; value: string; role?: string }>;
  };
  steps: ProcessStepIR[];
}

export interface VisualMappingIR {
  schemaVersion: 'visual_mapping.v1';
  layout: TeachingDomain;
  views: Array<{
    id: string;
    primitiveId: string;
    kind: VisualPrimitiveKind;
    title: string;
    priority: number;
  }>;
  cueRules: Array<{
    operation: ProcessStepIR['operation']['type'];
    effects: ProcessVisualCue['effect'][];
    description: string;
  }>;
  narrationBinding: {
    stepTitle: string;
    primaryText: string;
    secondaryText: string;
    checkText: string;
  };
}

export interface TeachingVisualizationIR {
  teachingPlan: TeachingUnderstandingIR;
  processTrace: ProcessTraceIR;
  visualMapping: VisualMappingIR;
}

export interface IRContractIssue {
  path: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface IRContractReport {
  schemaVersion: 'studio_visualization_contract.v1';
  valid: boolean;
  issues: IRContractIssue[];
  metrics: {
    primitiveCount: number;
    visualElementCount: number;
    stepCount: number;
    cueCount: number;
    frameCount: number;
    rendererFrameCount: number;
    mappedPrimitiveCount: number;
    coveredElementCount: number;
    danglingTargetCount: number;
  };
  coverage: VisualCoverageReport;
  diff: TraceDiffReport;
  rendererState: RendererStateResult;
}

export interface TraceFrame {
  index: number;
  stepId: string;
  title: string;
  state: Record<string, unknown>;
  activeTargets: Record<string, string[]>;
  effects: Record<string, ProcessVisualCue['effect']>;
}

export interface TraceRuntimeResult {
  schemaVersion: 'trace_runtime.v1';
  frames: TraceFrame[];
  finalState: Record<string, unknown>;
  issues: IRContractIssue[];
}

export interface RendererViewState {
  viewId: string;
  primitiveId: string;
  kind: VisualPrimitiveKind;
  title: string;
  priority: number;
  effect?: ProcessVisualCue['effect'];
  activeTargets: string[];
  primitiveData: Record<string, unknown>;
  frameState: Record<string, unknown>;
  diff: TraceDiffItem[];
  rendererState: Record<string, unknown>;
  visualActions: VisualAction[];
  animationTimeline: AnimationTimelineSegment[];
}

export interface RendererFrameState {
  index: number;
  stepId: string;
  title: string;
  views: RendererViewState[];
  narration: {
    title: string;
    primary: string;
    secondary: string;
    check?: string;
  };
}

export interface RendererStateResult {
  schemaVersion: 'renderer_state.v1';
  frames: RendererFrameState[];
  issues: IRContractIssue[];
}

export type VisualActionType =
  | 'highlight'
  | 'compare'
  | 'move'
  | 'swap'
  | 'insert'
  | 'remove'
  | 'create'
  | 'update'
  | 'traverse'
  | 'emit'
  | 'summarize';

export interface VisualAction {
  id: string;
  type: VisualActionType;
  primitiveId: string;
  targetIds: string[];
  fromIndex?: number;
  toIndex?: number;
  fromId?: string;
  toId?: string;
  value?: unknown;
  label?: string;
  durationMs: number;
}

export interface AnimationTimelineSegment {
  id: string;
  actionId: string;
  offsetMs: number;
  durationMs: number;
  easing: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface VisualCoverageReport {
  schemaVersion: 'visual_coverage.v1';
  primitiveCoverage: Array<{
    primitiveId: string;
    kind: VisualPrimitiveKind;
    mapped: boolean;
    elementCount: number;
    coveredElementCount: number;
    uncoveredElementIds: string[];
    danglingTargetIds: string[];
  }>;
  edgeReferenceIssues: IRContractIssue[];
}

export interface TraceDiffItem {
  path: string;
  type: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface TraceDiffFrame {
  fromStepId?: string;
  toStepId: string;
  changes: TraceDiffItem[];
}

export interface TraceDiffReport {
  schemaVersion: 'trace_diff.v1';
  frames: TraceDiffFrame[];
}

export interface IRRepairReport {
  schemaVersion: 'ir_repair.v1';
  changed: boolean;
  actions: Array<{ path: string; action: string; reason: string }>;
}

export interface IRMigrationReport {
  schemaVersion: 'ir_migration.v1';
  fromVersion: string;
  toVersion: 'teaching_visualization_bundle.v1';
  actions: string[];
}

export const STUDIO_VISUALIZATION_IR_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pp1.local/schemas/studio-teaching-visualization-ir.v1.json',
  title: 'Studio Teaching Visualization IR',
  type: 'object',
  required: ['teachingPlan', 'processTrace', 'visualMapping'],
  properties: {
    teachingPlan: {
      type: 'object',
      required: ['schemaVersion', 'learningObjectives', 'coreConcepts', 'prerequisites', 'misconceptions', 'explanationStrategy', 'assessmentCheckpoints'],
      properties: {
        schemaVersion: { const: 'teaching_understanding.v1' },
        learningObjectives: { type: 'array', items: { type: 'string' }, minItems: 1 },
        coreConcepts: { type: 'array', items: { type: 'string' }, minItems: 1 },
        prerequisites: { type: 'array', items: { type: 'string' } },
        misconceptions: { type: 'array', items: { type: 'string' } },
        explanationStrategy: { type: 'array', items: { type: 'string' } },
        assessmentCheckpoints: { type: 'array', items: { type: 'string' } }
      }
    },
    processTrace: {
      type: 'object',
      required: ['schemaVersion', 'domain', 'title', 'initialState', 'stateModel', 'steps'],
      properties: {
        schemaVersion: { const: 'process_trace.v1' },
        domain: { enum: ['sequence', 'graph', 'table', 'state_machine', 'formula', 'hybrid'] },
        title: { type: 'string', minLength: 1 },
        initialState: { type: 'object' },
        stateModel: {
          type: 'object',
          required: ['primitives', 'variables'],
          properties: {
            primitives: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['id', 'kind', 'label', 'data'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  kind: { enum: ['sequence', 'graph', 'table', 'state_machine', 'formula', 'variables', 'text'] },
                  label: { type: 'string', minLength: 1 },
                  role: { type: 'string' },
                  data: { type: 'object' }
                }
              }
            },
            variables: { type: 'array', items: { type: 'object', required: ['id', 'label', 'value'] } }
          }
        },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'index', 'title', 'goal', 'operation', 'statePatch', 'narration', 'observation', 'visualCues'],
            properties: {
              id: { type: 'string', minLength: 1 },
              index: { type: 'integer', minimum: 0 },
              title: { type: 'string', minLength: 1 },
              goal: { type: 'string' },
              operation: {
                type: 'object',
                required: ['type', 'targetIds', 'description'],
                properties: {
                  type: { enum: ['initialize', 'inspect', 'compare', 'transition', 'update', 'emit', 'summarize'] },
                  targetIds: { type: 'array', items: { type: 'string' } },
                  description: { type: 'string' }
                }
              },
              statePatch: { type: 'object' },
              narration: { type: 'string' },
              observation: { type: 'string' },
              misconception: { type: 'string' },
              checkQuestion: { type: 'string' },
              visualCues: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['primitiveId', 'targetIds', 'effect'],
                  properties: {
                    primitiveId: { type: 'string' },
                    targetIds: { type: 'array', items: { type: 'string' } },
                    effect: { enum: ['focus', 'compare', 'update', 'create', 'remove', 'success', 'warning'] },
                    label: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    visualMapping: {
      type: 'object',
      required: ['schemaVersion', 'layout', 'views', 'cueRules', 'narrationBinding'],
      properties: {
        schemaVersion: { const: 'visual_mapping.v1' },
        layout: { enum: ['sequence', 'graph', 'table', 'state_machine', 'formula', 'hybrid'] },
        views: { type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'primitiveId', 'kind', 'title', 'priority'] } },
        cueRules: { type: 'array', items: { type: 'object', required: ['operation', 'effects', 'description'] } },
        narrationBinding: { type: 'object' }
      }
    }
  }
} as const;

const clip = (value: unknown, maxLength = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const deepMerge = (base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = deepMerge(next[key] as Record<string, unknown>, value);
      return;
    }
    next[key] = value;
  });
  return next;
};

const setAtPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = target;
  parts.slice(0, -1).forEach((part) => {
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  });
  cursor[parts[parts.length - 1]] = value;
};

const valueAtPath = (target: Record<string, unknown>, path: string): unknown => {
  let cursor: unknown = target;
  for (const part of path.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
};

const primitiveElementIds = (primitive: ProcessTraceIR['stateModel']['primitives'][number]) => {
  const data = primitive.data || {};
  const fromItems = Array.isArray((data as any).items)
    ? (data as any).items.map((item: any, index: number) => String(item.id || `item-${index}`))
    : [];
  const fromRows = Array.isArray((data as any).rows)
    ? (data as any).rows.map((row: any, index: number) => String(row.id || `row-${index}`))
    : [];
  const fromNodes = Array.isArray((data as any).nodes)
    ? (data as any).nodes.map((node: any, index: number) => String(node.id || `node-${index}`))
    : [];
  const fromEdges = Array.isArray((data as any).edges)
    ? (data as any).edges.map((edge: any, index: number) => String(edge.id || `edge-${index}`))
    : [];
  const fromTokens = Array.isArray((data as any).tokens)
    ? (data as any).tokens.map((token: any, index: number) => String(token.id || `token-${index}`))
    : [];
  return Array.from(new Set([primitive.id, ...fromItems, ...fromRows, ...fromNodes, ...fromEdges, ...fromTokens]));
};

const primitiveElementMap = (trace: ProcessTraceIR) =>
  new Map(trace.stateModel.primitives.map((primitive) => [primitive.id, new Set(primitiveElementIds(primitive))]));

const globalElementSet = (trace: ProcessTraceIR) => {
  const elements = new Set<string>();
  primitiveElementMap(trace).forEach((ids) => ids.forEach((id) => elements.add(id)));
  return elements;
};

const firstArrayAtKeys = (state: Record<string, unknown>, keys: string[]): unknown[] | null => {
  for (const key of keys) {
    const value = state[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(state)) {
    if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null || isRecord(item))) return value;
    if (isRecord(value)) {
      const nested: unknown[] | null = firstArrayAtKeys(value, keys);
      if (nested) return nested;
    }
  }
  return null;
};

const valueLabel = (value: unknown) => {
  if (isRecord(value)) return clip(value.label || value.value || value.id, 80);
  return clip(value, 80);
};

const valueId = (value: unknown, index: number) => {
  if (isRecord(value) && value.id) return String(value.id);
  return `v-${String(valueLabel(value)).replace(/[^a-zA-Z0-9_-]+/g, '_') || index}-${index}`;
};

const normalizeSequenceRendererState = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  frame: TraceFrame,
  previousFrame?: TraceFrame
) => {
  const baseItems = Array.isArray((primitive.data as any).items) ? (primitive.data as any).items : [];
  const currentValues = firstArrayAtKeys(frame.state, ['sequence', 'array', 'items', 'elements', 'currentArray', 'values', 'data']) || baseItems;
  const previousValues = previousFrame
    ? firstArrayAtKeys(previousFrame.state, ['sequence', 'array', 'items', 'elements', 'currentArray', 'values', 'data']) || baseItems
    : baseItems;
  const activeTargets = frame.activeTargets[primitive.id] || [];
  const variables = isRecord(frame.state.variables) ? frame.state.variables : {};
  const items = currentValues.map((value: unknown, index: number) => {
    const id = isRecord(value) && value.id
      ? String(value.id)
      : baseItems[index]?.id
        ? String(baseItems[index].id)
        : valueId(value, index);
    const previousIndex = previousValues.findIndex((candidate: unknown, candidateIndex: number) => {
      const candidateId = isRecord(candidate) && candidate.id ? String(candidate.id) : baseItems[candidateIndex]?.id ? String(baseItems[candidateIndex].id) : valueId(candidate, candidateIndex);
      return candidateId === id || valueLabel(candidate) === valueLabel(value);
    });
    return {
      id,
      value: isRecord(value) && 'value' in value ? value.value : value,
      label: valueLabel(value),
      index,
      previousIndex: previousIndex >= 0 ? previousIndex : index,
      status: activeTargets.includes(id) ? frame.effects[primitive.id] || 'focus' : undefined
    };
  });
  const pointers = Object.entries(variables)
    .filter(([, value]) => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
    .map(([label, value]) => ({ id: `ptr-${label}`, label, index: Number(value) }));
  const keyValue = frame.state.key ?? frame.state.candidate ?? frame.state.current ?? frame.state.pivot;
  return {
    schemaVersion: 'sequence_renderer_state.v1',
    items,
    pointers,
    key: keyValue === undefined ? null : { id: 'key', label: valueLabel(keyValue), value: keyValue },
    regions: [
      typeof variables.i === 'number' ? { id: 'processed', label: 'processed', from: 0, to: Number(variables.i) } : null
    ].filter(Boolean)
  };
};

const normalizeTableRendererState = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  frame: TraceFrame,
  previousFrame?: TraceFrame
) => {
  const data = primitive.data as any;
  const rows = Array.isArray(frame.state.outputRows) && primitive.id.includes('output')
    ? frame.state.outputRows
    : Array.isArray(frame.state.rows) && primitive.id.includes('output')
      ? frame.state.rows
      : Array.isArray(data.rows)
        ? data.rows
        : [];
  const previousRows = previousFrame && Array.isArray(previousFrame.state.outputRows) ? previousFrame.state.outputRows : [];
  const previousIds = new Set(previousRows.map((row: any, index: number) => String(row.id || `row-${index}`)));
  return {
    schemaVersion: 'table_renderer_state.v1',
    columns: Array.isArray(data.columns) ? data.columns : [],
    rows: rows.map((row: any, index: number) => {
      const id = String(row.id || `row-${index}`);
      return {
        id,
        cells: Array.isArray(row.cells) ? row.cells : Object.values(row),
        status: (frame.activeTargets[primitive.id] || []).includes(id) ? frame.effects[primitive.id] || 'focus' : !previousIds.has(id) ? 'create' : undefined
      };
    })
  };
};

const normalizeGraphRendererState = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  frame: TraceFrame
) => {
  const data = primitive.data as any;
  const activeTargets = new Set(frame.activeTargets[primitive.id] || []);
  return {
    schemaVersion: 'graph_renderer_state.v1',
    nodes: (Array.isArray(data.nodes) ? data.nodes : []).map((node: any, index: number) => {
      const id = String(node.id || `node-${index}`);
      return { ...node, id, status: activeTargets.has(id) ? frame.effects[primitive.id] || 'focus' : undefined };
    }),
    edges: (Array.isArray(data.edges) ? data.edges : []).map((edge: any, index: number) => {
      const id = String(edge.id || `edge-${index}`);
      return { ...edge, id, status: activeTargets.has(id) ? frame.effects[primitive.id] || 'focus' : undefined };
    }),
    current: frame.state.current || frame.state.currentState || frame.state.currentSubset,
    frontier: frame.state.frontier,
    visited: frame.state.visited,
    queue: frame.state.queue,
    stack: frame.state.stack,
    subset: frame.state.currentSubset || frame.state.subset,
    alphabet: frame.state.alphabet,
    transitionTable: frame.state.rows || frame.state.transitionTable || frame.state.table
  };
};

const normalizeFormulaRendererState = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  frame: TraceFrame
) => {
  const data = primitive.data as any;
  const activeTargets = new Set(frame.activeTargets[primitive.id] || []);
  const expression = frame.state.expression;
  return {
    schemaVersion: 'formula_renderer_state.v1',
    tokens: (Array.isArray(data.tokens) ? data.tokens : []).map((token: any, index: number) => {
      const id = String(token.id || `token-${index}`);
      return { ...token, id, status: activeTargets.has(id) ? frame.effects[primitive.id] || 'focus' : undefined };
    }),
    expression
  };
};

const visualActionsForView = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  step: ProcessStepIR,
  frame: TraceFrame,
  previousFrame?: TraceFrame
): VisualAction[] => {
  const activeTargets = frame.activeTargets[primitive.id] || step.operation.targetIds || [];
  const base: VisualAction[] = activeTargets.length
    ? [{
        id: `${step.id}-${primitive.id}-focus`,
        type: step.operation.type === 'compare' ? 'compare' : step.operation.type === 'emit' ? 'emit' : step.operation.type === 'transition' ? 'traverse' : step.operation.type === 'summarize' ? 'summarize' : 'highlight',
        primitiveId: primitive.id,
        targetIds: activeTargets,
        label: step.operation.description,
        durationMs: 420
      }]
    : [];
  if (primitive.kind === 'sequence') {
    const current = normalizeSequenceRendererState(primitive, frame, previousFrame) as any;
    const moved = (current.items || [])
      .filter((item: any) => typeof item.previousIndex === 'number' && item.previousIndex !== item.index)
      .map((item: any): VisualAction => ({
        id: `${step.id}-${primitive.id}-move-${item.id}`,
        type: 'move',
        primitiveId: primitive.id,
        targetIds: [item.id],
        fromIndex: item.previousIndex,
        toIndex: item.index,
        value: item.value,
        durationMs: 680
      }));
    if (current.key) {
      moved.unshift({
        id: `${step.id}-${primitive.id}-key`,
        type: 'insert',
        primitiveId: primitive.id,
        targetIds: activeTargets,
        value: current.key.value,
        label: `key=${current.key.label}`,
        durationMs: 520
      });
    }
    return [...base, ...moved];
  }
  if (primitive.kind === 'table' && step.operation.type === 'emit') {
    return [...base, {
      id: `${step.id}-${primitive.id}-emit`,
      type: 'emit',
      primitiveId: primitive.id,
      targetIds: activeTargets,
      label: step.operation.description,
      durationMs: 560
    }];
  }
  if (primitive.kind === 'graph' || primitive.kind === 'state_machine') {
    const data = primitive.data as any;
    const edgeIds = new Set((Array.isArray(data.edges) ? data.edges : []).map((edge: any, edgeIndex: number) => String(edge.id || `edge-${edgeIndex}`)));
    const graphActions = activeTargets.map((targetId, index): VisualAction => ({
      id: `${step.id}-${primitive.id}-traverse-${targetId}-${index}`,
      type: edgeIds.has(targetId) || targetId.includes('->') ? 'traverse' : step.operation.type === 'update' ? 'update' : 'highlight',
      primitiveId: primitive.id,
      targetIds: [targetId],
      label: step.operation.description,
      durationMs: 620
    }));
    if (Array.isArray(frame.state.frontier) || Array.isArray(frame.state.queue)) {
      graphActions.push({
        id: `${step.id}-${primitive.id}-frontier`,
        type: 'update',
        primitiveId: primitive.id,
        targetIds: (frame.state.frontier || frame.state.queue || []) as string[],
        label: 'update frontier / queue',
        durationMs: 460
      });
    }
    if (Array.isArray(frame.state.currentSubset) || Array.isArray(frame.state.subset)) {
      graphActions.push({
        id: `${step.id}-${primitive.id}-subset`,
        type: 'create',
        primitiveId: primitive.id,
        targetIds: (frame.state.currentSubset || frame.state.subset || []) as string[],
        label: 'construct DFA subset state',
        durationMs: 620
      });
    }
    return [...base, ...graphActions];
  }
  return base;
};

const timelineForActions = (actions: VisualAction[]): AnimationTimelineSegment[] => {
  let offset = 0;
  return actions.map((action, index) => {
    const segment = {
      id: `segment-${action.id}`,
      actionId: action.id,
      offsetMs: offset,
      durationMs: action.durationMs,
      easing: index === 0 ? 'ease-out' as const : 'ease-in-out' as const
    };
    offset += Math.max(180, Math.round(action.durationMs * 0.72));
    return segment;
  });
};

const normalizeRendererStateForView = (
  primitive: ProcessTraceIR['stateModel']['primitives'][number],
  frame: TraceFrame,
  previousFrame?: TraceFrame
) => {
  if (primitive.kind === 'sequence') return normalizeSequenceRendererState(primitive, frame, previousFrame);
  if (primitive.kind === 'table') return normalizeTableRendererState(primitive, frame, previousFrame);
  if (primitive.kind === 'graph' || primitive.kind === 'state_machine') return normalizeGraphRendererState(primitive, frame);
  if (primitive.kind === 'formula') return normalizeFormulaRendererState(primitive, frame);
  return { schemaVersion: 'generic_renderer_state.v1', data: primitive.data, state: frame.state };
};

const latestPrompt = (context: StudioGenerationContext) =>
  clip(context.input.prompt || context.template.promptFrame || context.template.title, 160);

const evidenceTopic = (context: StudioGenerationContext) => {
  const prompt = latestPrompt(context);
  if (prompt && !/^根据当前资料生成个性化学习资源$/i.test(prompt)) return prompt;
  return clip(context.capsule.citations[0]?.label || context.capsule.activeFile?.fileName || context.template.title, 160);
};

export const inferTeachingDomain = (text: string): TeachingDomain => {
  const value = text.toLowerCase();
  if (/(nfa|dfa|automata|自动机|状态机|正则|epsilon|ε|子集构造)/i.test(text)) return 'state_machine';
  if (/(join|连接|关系代数|数据库|table|表格|元组|主键|外键|sql)/i.test(text)) return 'table';
  if (/(graph|图|节点|边|最短路|bfs|dfs|dijkstra|拓扑|遍历)/i.test(text)) return 'graph';
  if (/(公式|方程|推导|函数|极限|导数|积分|矩阵|概率)/i.test(text)) return 'formula';
  if (/(sort|排序|数组|栈|队列|链表|堆|比较|交换|指针|algorithm|算法)/i.test(text) || value) return 'sequence';
  return 'hybrid';
};

const sourceConcepts = (context: StudioGenerationContext, topic: string) => {
  const citations = context.capsule.citations.map((citation) => citation.label.replace(/\.[a-z0-9]+$/i, ''));
  return Array.from(new Set([topic, ...citations])).filter(Boolean).slice(0, 5);
};

const teachingPlanFor = (context: StudioGenerationContext, domain: TeachingDomain): TeachingUnderstandingIR => {
  const topic = evidenceTopic(context);
  const concepts = sourceConcepts(context, topic);
  return {
    schemaVersion: 'teaching_understanding.v1',
    learningObjectives: [
      `能用自己的话说明「${topic}」解决的问题。`,
      '能按步骤追踪中间状态，并解释每次状态变化的依据。',
      '能根据最终状态判断结果是否正确。'
    ],
    coreConcepts: concepts.length ? concepts : [topic],
    prerequisites: domain === 'state_machine'
      ? ['集合表示', '状态转移', '输入符号']
      : domain === 'table'
        ? ['表、行、列', '条件判断', '结果集']
        : domain === 'graph'
          ? ['节点与边', '邻接关系', '访问状态']
          : domain === 'formula'
            ? ['符号含义', '等价变形', '边界条件']
            : ['输入状态', '指针/位置', '比较与更新'],
    misconceptions: [
      '只记结论，不检查适用条件。',
      '跳过中间状态，导致无法解释为什么进入下一步。',
      '把视觉高亮当成答案，而不是把它和规则对应起来。'
    ],
    explanationStrategy: [
      '先建立对象和符号的含义，再进入步骤轨迹。',
      '每一步只突出一个主要动作，配合一句解释和一个观察问题。',
      '在结果更新时显式展示“旧状态 -> 新状态”。'
    ],
    assessmentCheckpoints: [
      '学生能指出当前步骤正在操作哪个对象。',
      '学生能解释这一步改变了什么、没有改变什么。',
      '学生能预测下一步可能发生的状态变化。'
    ]
  };
};

const sequenceTrace = (topic: string): Pick<ProcessTraceIR, 'stateModel' | 'steps' | 'initialState'> => ({
  initialState: { activeStep: 0, variables: { i: 1, j: 1 }, sequence: [4, 1, 3, 2, 5] },
  stateModel: {
    primitives: [
      {
        id: 'main-sequence',
        kind: 'sequence',
        label: '过程对象',
        role: 'primary-state',
        data: {
          items: [
            { id: 'a0', label: '4', value: 4 },
            { id: 'a1', label: '1', value: 1 },
            { id: 'a2', label: '3', value: 3 },
            { id: 'a3', label: '2', value: 2 },
            { id: 'a4', label: '5', value: 5 }
          ],
          pointers: [
            { id: 'p-i', label: 'i', targetId: 'a1' },
            { id: 'p-j', label: 'j', targetId: 'a1' }
          ]
        }
      }
    ],
    variables: [
      { id: 'i', label: 'i', value: '1', role: 'current index' },
      { id: 'candidate', label: 'candidate', value: '1', role: 'candidate value' }
    ]
  },
  steps: [
    {
      id: 'step-1',
      index: 0,
      title: '建立初始状态',
      goal: `把「${topic}」中的输入对象转成可观察状态。`,
      operation: { type: 'initialize', targetIds: ['main-sequence'], description: '列出输入对象、指针和待更新变量。' },
      statePatch: { activeStep: 0 },
      narration: '先不要急着求结果，先确认每个元素和指针代表什么。',
      observation: '观察哪些对象会在后续步骤中被高亮或更新。',
      checkQuestion: '当前输入对象包含哪些元素？哪个位置最先被处理？',
      visualCues: [{ primitiveId: 'main-sequence', targetIds: ['a0', 'a1', 'a2', 'a3', 'a4'], effect: 'focus' }]
    },
    {
      id: 'step-2',
      index: 1,
      title: '比较关键对象',
      goal: '把规则应用到当前元素和候选元素。',
      operation: { type: 'compare', targetIds: ['a0', 'a1'], description: '比较两个相关状态，决定是否需要变化。' },
      statePatch: { comparing: ['a0', 'a1'] },
      narration: '这一步只关注比较条件：如果条件成立，下一步才会更新状态。',
      observation: '两个被比较的元素会同时高亮，旁白说明比较依据。',
      misconception: '常见错误是直接移动元素，但没有说明比较条件。',
      checkQuestion: '这一步比较的依据是什么？如果条件不成立会怎样？',
      visualCues: [{ primitiveId: 'main-sequence', targetIds: ['a0', 'a1'], effect: 'compare' }]
    },
    {
      id: 'step-3',
      index: 2,
      title: '执行状态更新',
      goal: '把比较结论落实为对象变化。',
      operation: { type: 'update', targetIds: ['a0', 'a1'], description: '更新顺序、标记或变量。' },
      statePatch: { sequence: [1, 4, 3, 2, 5], variables: { i: 1, j: 0 } },
      narration: '现在才改变状态。更新后要立刻检查是否仍满足过程规则。',
      observation: '被更新的对象会以变化色显示，新状态替代旧状态。',
      checkQuestion: '更新后哪个量改变了？哪个约束仍然保持？',
      visualCues: [{ primitiveId: 'main-sequence', targetIds: ['a0', 'a1'], effect: 'update' }]
    },
    {
      id: 'step-4',
      index: 3,
      title: '推进到下一轮',
      goal: '把局部更新连接到整体过程。',
      operation: { type: 'transition', targetIds: ['a2'], description: '移动关注点，进入下一次判断。' },
      statePatch: { activeStep: 3, variables: { i: 2, candidate: 3 } },
      narration: '一次更新不是终点，过程会把焦点推进到下一个待处理对象。',
      observation: '指针移动说明算法或推理正在进入下一轮。',
      checkQuestion: '下一轮需要检查哪个对象？为什么不是重新从头开始？',
      visualCues: [{ primitiveId: 'main-sequence', targetIds: ['a2'], effect: 'focus' }]
    },
    {
      id: 'step-5',
      index: 4,
      title: '总结结果与不变量',
      goal: '把最终状态和核心规则对应起来。',
      operation: { type: 'summarize', targetIds: ['main-sequence'], description: '回顾结果、规则和易错点。' },
      statePatch: { completed: true },
      narration: '最后不要只看答案，要说明每一步为什么合法。',
      observation: '完整轨迹展示了从输入到结果的连续状态变化。',
      checkQuestion: '你能复述这个过程的输入、规则、更新和结果吗？',
      visualCues: [{ primitiveId: 'main-sequence', targetIds: ['a0', 'a1', 'a2', 'a3', 'a4'], effect: 'success' }]
    }
  ]
});

const tableTrace = (topic: string): Pick<ProcessTraceIR, 'stateModel' | 'steps' | 'initialState'> => ({
  initialState: { activeStep: 0, joinKey: 'id', outputRows: [] },
  stateModel: {
    primitives: [
      {
        id: 'left-table',
        kind: 'table',
        label: '左表',
        data: {
          columns: ['id', 'name'],
          rows: [
            { id: 'l1', cells: ['1', 'A'] },
            { id: 'l2', cells: ['2', 'B'] }
          ]
        }
      },
      {
        id: 'right-table',
        kind: 'table',
        label: '右表',
        data: {
          columns: ['id', 'score'],
          rows: [
            { id: 'r1', cells: ['1', '90'] },
            { id: 'r2', cells: ['3', '75'] }
          ]
        }
      },
      { id: 'output-table', kind: 'table', label: '结果表', data: { columns: ['id', 'name', 'score'], rows: [] } }
    ],
    variables: [{ id: 'join-key', label: 'join key', value: 'id', role: 'condition' }]
  },
  steps: [
    {
      id: 'step-1',
      index: 0,
      title: '确认连接条件',
      goal: `把「${topic}」中的匹配规则具体化。`,
      operation: { type: 'initialize', targetIds: ['left-table', 'right-table'], description: '识别两张表和连接键。' },
      statePatch: { joinKey: 'id' },
      narration: '连接不是简单拼接，而是按照条件逐行判断。',
      observation: '先看列名和连接条件，再看具体行。',
      checkQuestion: '这次连接使用哪个字段作为匹配条件？',
      visualCues: [
        { primitiveId: 'left-table', targetIds: ['l1', 'l2'], effect: 'focus' },
        { primitiveId: 'right-table', targetIds: ['r1', 'r2'], effect: 'focus' }
      ]
    },
    {
      id: 'step-2',
      index: 1,
      title: '比较候选行',
      goal: '检查左右表当前行是否满足连接条件。',
      operation: { type: 'compare', targetIds: ['l1', 'r1'], description: '比较连接键值。' },
      statePatch: { comparing: ['l1', 'r1'] },
      narration: '两行的连接键相同，因此它们可以合并进结果表。',
      observation: '被比较的左右行同时高亮。',
      checkQuestion: '这两行为什么匹配？',
      visualCues: [
        { primitiveId: 'left-table', targetIds: ['l1'], effect: 'compare' },
        { primitiveId: 'right-table', targetIds: ['r1'], effect: 'compare' }
      ]
    },
    {
      id: 'step-3',
      index: 2,
      title: '写入结果行',
      goal: '把匹配行合成一条输出记录。',
      operation: { type: 'emit', targetIds: ['output-1'], description: '输出合并后的结果。' },
      statePatch: { outputRows: [{ id: 'output-1', cells: ['1', 'A', '90'] }] },
      narration: '只有满足条件的组合会进入结果集。',
      observation: '结果表新增一行，来源于左右表的匹配行。',
      checkQuestion: '输出行的每一列分别来自哪里？',
      visualCues: [{ primitiveId: 'output-table', targetIds: ['output-1'], effect: 'create' }]
    },
    {
      id: 'step-4',
      index: 3,
      title: '处理不匹配情况',
      goal: '说明为什么某些行不会进入结果。',
      operation: { type: 'inspect', targetIds: ['l2', 'r2'], description: '检查不满足条件的组合。' },
      statePatch: { comparing: ['l2', 'r2'] },
      narration: '当连接键不相等时，这个组合不会产生结果行。',
      observation: '不匹配行用警示色标出，避免误以为所有行都会拼接。',
      misconception: '常见错误是把笛卡尔积和条件连接混在一起。',
      checkQuestion: '这组行为什么不能进入结果表？',
      visualCues: [
        { primitiveId: 'left-table', targetIds: ['l2'], effect: 'warning' },
        { primitiveId: 'right-table', targetIds: ['r2'], effect: 'warning' }
      ]
    },
    {
      id: 'step-5',
      index: 4,
      title: '复盘连接结果',
      goal: '用条件解释最终结果集。',
      operation: { type: 'summarize', targetIds: ['output-table'], description: '检查输出是否完整且没有多余行。' },
      statePatch: { completed: true },
      narration: '最终结果由所有满足连接条件的行组合构成。',
      observation: '结果表是整个过程的可验证输出。',
      checkQuestion: '如果连接类型改变，哪些不匹配行可能被保留？',
      visualCues: [{ primitiveId: 'output-table', targetIds: ['output-1'], effect: 'success' }]
    }
  ]
});

const stateMachineTrace = (topic: string): Pick<ProcessTraceIR, 'stateModel' | 'steps' | 'initialState'> => ({
  initialState: { activeStep: 0, currentSubset: ['q0'], alphabet: ['a', 'b'] },
  stateModel: {
    primitives: [
      {
        id: 'state-graph',
        kind: 'state_machine',
        label: '状态转移图',
        data: {
          nodes: [
            { id: 'q0', label: 'q0', role: 'start' },
            { id: 'q1', label: 'q1' },
            { id: 'q2', label: 'q2', role: 'accept' }
          ],
          edges: [
            { id: 'e0', source: 'q0', target: 'q1', label: 'a' },
            { id: 'e1', source: 'q1', target: 'q2', label: 'b' }
          ]
        }
      },
      { id: 'subset-table', kind: 'table', label: '子集构造表', data: { columns: ['DFA 状态', 'a', 'b'], rows: [] } }
    ],
    variables: [{ id: 'subset', label: '当前子集', value: '{q0}', role: 'current state set' }]
  },
  steps: [
    {
      id: 'step-1',
      index: 0,
      title: '确定初始状态集合',
      goal: `把「${topic}」的初始状态转成集合表示。`,
      operation: { type: 'initialize', targetIds: ['q0'], description: '从初始状态或闭包开始。' },
      statePatch: { currentSubset: ['q0'] },
      narration: 'DFA 的一个状态可以表示 NFA 的一组可能状态。',
      observation: '初始集合被高亮，作为后续迁移的起点。',
      checkQuestion: '为什么这里要用集合而不是单个状态？',
      visualCues: [{ primitiveId: 'state-graph', targetIds: ['q0'], effect: 'focus' }]
    },
    {
      id: 'step-2',
      index: 1,
      title: '选择输入符号',
      goal: '在当前状态集合上应用一个输入符号。',
      operation: { type: 'inspect', targetIds: ['e0'], description: '检查符号 a 对应的转移。' },
      statePatch: { symbol: 'a' },
      narration: '对集合中的每个状态，都要检查这个符号能到哪里。',
      observation: '当前使用的边会高亮，表示正在读取该输入符号。',
      checkQuestion: '符号 a 从当前集合能到哪些状态？',
      visualCues: [{ primitiveId: 'state-graph', targetIds: ['e0'], effect: 'compare' }]
    },
    {
      id: 'step-3',
      index: 2,
      title: '生成新状态集合',
      goal: '把所有可能到达状态合并成 DFA 新状态。',
      operation: { type: 'update', targetIds: ['q1'], description: '合并迁移结果。' },
      statePatch: { currentSubset: ['q1'] },
      narration: '迁移结果要去重并作为一个整体记录。',
      observation: '新集合被标为一个 DFA 状态。',
      checkQuestion: '这个新集合是否已经在构造表中出现过？',
      visualCues: [{ primitiveId: 'state-graph', targetIds: ['q1'], effect: 'update' }]
    },
    {
      id: 'step-4',
      index: 3,
      title: '写入迁移表',
      goal: '把图上的迁移记录成可检查表格。',
      operation: { type: 'emit', targetIds: ['row-1'], description: '记录 DFA 状态和输入符号的结果。' },
      statePatch: { rows: [{ id: 'row-1', cells: ['{q0}', '{q1}', '-'] }] },
      narration: '表格是过程的账本，避免遗漏状态或重复状态。',
      observation: '新增一行说明从当前集合读入符号后的结果。',
      checkQuestion: '这行表格对应图上的哪条转移？',
      visualCues: [{ primitiveId: 'subset-table', targetIds: ['row-1'], effect: 'create' }]
    },
    {
      id: 'step-5',
      index: 4,
      title: '检查接受状态与未处理集合',
      goal: '判断构造是否完成，并标记接受状态。',
      operation: { type: 'summarize', targetIds: ['q2'], description: '检查是否包含接受状态，以及是否还有待展开集合。' },
      statePatch: { completed: true },
      narration: '如果集合包含 NFA 接受状态，对应 DFA 状态也接受。',
      observation: '接受状态和未处理状态决定下一轮构造。',
      checkQuestion: '什么时候可以宣布子集构造完成？',
      visualCues: [{ primitiveId: 'state-graph', targetIds: ['q2'], effect: 'success' }]
    }
  ]
});

const graphTrace = (topic: string): Pick<ProcessTraceIR, 'stateModel' | 'steps' | 'initialState'> => ({
  initialState: { activeStep: 0, visited: [], frontier: ['A'] },
  stateModel: {
    primitives: [
      {
        id: 'main-graph',
        kind: 'graph',
        label: '图结构',
        data: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
            { id: 'C', label: 'C' },
            { id: 'D', label: 'D' }
          ],
          edges: [
            { id: 'AB', source: 'A', target: 'B', label: '' },
            { id: 'AC', source: 'A', target: 'C', label: '' },
            { id: 'BD', source: 'B', target: 'D', label: '' }
          ]
        }
      }
    ],
    variables: [
      { id: 'frontier', label: 'frontier', value: 'A', role: 'next candidates' },
      { id: 'visited', label: 'visited', value: '-', role: 'processed nodes' }
    ]
  },
  steps: [
    {
      id: 'step-1',
      index: 0,
      title: '选择起点',
      goal: `确认「${topic}」在图上的初始对象。`,
      operation: { type: 'initialize', targetIds: ['A'], description: '标记起始节点和待处理集合。' },
      statePatch: { frontier: ['A'] },
      narration: '图过程通常从一个起点或一组候选节点开始。',
      observation: '起点被高亮，frontier 记录下一步要处理谁。',
      checkQuestion: '为什么从这个节点开始？',
      visualCues: [{ primitiveId: 'main-graph', targetIds: ['A'], effect: 'focus' }]
    },
    {
      id: 'step-2',
      index: 1,
      title: '检查相邻关系',
      goal: '查看当前节点能到达哪些节点。',
      operation: { type: 'inspect', targetIds: ['AB', 'AC'], description: '展开邻接边。' },
      statePatch: { inspecting: ['AB', 'AC'] },
      narration: '当前节点的邻接边决定候选集合如何变化。',
      observation: '相关边会高亮，表示正在检查可达关系。',
      checkQuestion: '哪些节点会被加入候选集合？',
      visualCues: [{ primitiveId: 'main-graph', targetIds: ['AB', 'AC'], effect: 'compare' }]
    },
    {
      id: 'step-3',
      index: 2,
      title: '更新访问状态',
      goal: '把已处理节点和新候选节点分开。',
      operation: { type: 'update', targetIds: ['A', 'B', 'C'], description: '更新 visited 和 frontier。' },
      statePatch: { visited: ['A'], frontier: ['B', 'C'] },
      narration: '状态集合的更新是图算法最容易漏看的部分。',
      observation: '已访问节点和候选节点使用不同颜色显示。',
      checkQuestion: 'A 现在应该留在 frontier 里吗？为什么？',
      visualCues: [{ primitiveId: 'main-graph', targetIds: ['A', 'B', 'C'], effect: 'update' }]
    },
    {
      id: 'step-4',
      index: 3,
      title: '推进下一节点',
      goal: '按规则选择下一个处理对象。',
      operation: { type: 'transition', targetIds: ['B'], description: '从候选集合取出下一个节点。' },
      statePatch: { current: 'B' },
      narration: '不同算法的选择规则不同，但都会体现在 frontier 的变化上。',
      observation: '当前节点从候选集合中被选中。',
      checkQuestion: '这个算法如何决定下一步处理 B 还是 C？',
      visualCues: [{ primitiveId: 'main-graph', targetIds: ['B'], effect: 'focus' }]
    },
    {
      id: 'step-5',
      index: 4,
      title: '总结遍历轨迹',
      goal: '用状态集合解释算法结果。',
      operation: { type: 'summarize', targetIds: ['A', 'B', 'C'], description: '复盘已访问、候选和输出。' },
      statePatch: { completed: true },
      narration: '最终结果来自每一次邻接检查和集合更新。',
      observation: '完整轨迹展示从起点到结果的推理链。',
      checkQuestion: '如果图结构改变，frontier 会如何变化？',
      visualCues: [{ primitiveId: 'main-graph', targetIds: ['A', 'B', 'C'], effect: 'success' }]
    }
  ]
});

const formulaTrace = (topic: string): Pick<ProcessTraceIR, 'stateModel' | 'steps' | 'initialState'> => ({
  initialState: { expression: 'input -> rule -> result' },
  stateModel: {
    primitives: [
      {
        id: 'formula-main',
        kind: 'formula',
        label: '公式/规则',
        data: {
          tokens: [
            { id: 'f-input', label: '输入条件' },
            { id: 'f-rule', label: '规则/变形' },
            { id: 'f-result', label: '结果' }
          ]
        }
      }
    ],
    variables: [{ id: 'condition', label: 'condition', value: '成立条件', role: 'guard' }]
  },
  steps: [
    {
      id: 'step-1',
      index: 0,
      title: '声明符号含义',
      goal: `确认「${topic}」中的每个符号代表什么。`,
      operation: { type: 'initialize', targetIds: ['f-input'], description: '解释输入条件和符号。' },
      statePatch: {},
      narration: '公式推导首先要知道每个符号的含义和适用条件。',
      observation: '输入条件被高亮。',
      checkQuestion: '这里有哪些隐含条件？',
      visualCues: [{ primitiveId: 'formula-main', targetIds: ['f-input'], effect: 'focus' }]
    },
    {
      id: 'step-2',
      index: 1,
      title: '应用规则',
      goal: '说明当前变形依据。',
      operation: { type: 'transition', targetIds: ['f-rule'], description: '应用定义、定理或等价变形。' },
      statePatch: {},
      narration: '每次变形都要能说出依据，而不是只写下一行。',
      observation: '规则部分高亮，连接输入和结果。',
      checkQuestion: '这一步使用了哪个定义或定理？',
      visualCues: [{ primitiveId: 'formula-main', targetIds: ['f-rule'], effect: 'compare' }]
    },
    {
      id: 'step-3',
      index: 2,
      title: '更新表达式',
      goal: '得到新的等价表达或中间结果。',
      operation: { type: 'update', targetIds: ['f-result'], description: '产生中间结果。' },
      statePatch: { expression: 'result' },
      narration: '更新后的表达式必须和前一步在条件下等价。',
      observation: '结果部分显示为更新状态。',
      checkQuestion: '这个结果在哪些条件下成立？',
      visualCues: [{ primitiveId: 'formula-main', targetIds: ['f-result'], effect: 'update' }]
    },
    {
      id: 'step-4',
      index: 3,
      title: '检查边界条件',
      goal: '防止把结论过度泛化。',
      operation: { type: 'inspect', targetIds: ['condition'], description: '检查条件是否满足。' },
      statePatch: {},
      narration: '很多错误来自忽略条件或把局部结论当成全局结论。',
      observation: '条件变量作为警示对象显示。',
      misconception: '只关注公式形状，不检查条件。',
      checkQuestion: '哪些输入会让这一步不成立？',
      visualCues: [{ primitiveId: 'formula-main', targetIds: ['f-input', 'f-rule'], effect: 'warning' }]
    },
    {
      id: 'step-5',
      index: 4,
      title: '总结推导链',
      goal: '把输入、规则和结果连成完整解释。',
      operation: { type: 'summarize', targetIds: ['formula-main'], description: '回顾推导路径。' },
      statePatch: { completed: true },
      narration: '最终要能复述每一步为什么成立。',
      observation: '完整链路同时高亮。',
      checkQuestion: '你能补出每一步的依据吗？',
      visualCues: [{ primitiveId: 'formula-main', targetIds: ['f-input', 'f-rule', 'f-result'], effect: 'success' }]
    }
  ]
});

const traceForDomain = (domain: TeachingDomain, topic: string) => {
  if (domain === 'table') return tableTrace(topic);
  if (domain === 'state_machine') return stateMachineTrace(topic);
  if (domain === 'graph') return graphTrace(topic);
  if (domain === 'formula') return formulaTrace(topic);
  return sequenceTrace(topic);
};

const visualMappingFor = (trace: ProcessTraceIR): VisualMappingIR => ({
  schemaVersion: 'visual_mapping.v1',
  layout: trace.domain,
  views: trace.stateModel.primitives.map((primitive, index) => ({
    id: `view-${primitive.id}`,
    primitiveId: primitive.id,
    kind: primitive.kind,
    title: primitive.label,
    priority: index + 1
  })),
  cueRules: [
    { operation: 'initialize', effects: ['focus'], description: '显示初始对象和符号含义。' },
    { operation: 'compare', effects: ['compare', 'warning'], description: '并列突出被比较或被判断对象。' },
    { operation: 'transition', effects: ['focus', 'update'], description: '移动当前关注点或状态边。' },
    { operation: 'update', effects: ['update', 'create', 'remove'], description: '展示状态变化的结果。' },
    { operation: 'emit', effects: ['create', 'success'], description: '把中间结果写入输出区域。' },
    { operation: 'summarize', effects: ['success'], description: '复盘完整过程和检查点。' }
  ],
  narrationBinding: {
    stepTitle: 'step.title',
    primaryText: 'step.narration',
    secondaryText: 'step.observation',
    checkText: 'step.checkQuestion'
  }
});

export const buildFallbackTeachingVisualizationIR = (
  context: StudioGenerationContext,
  content?: string
): TeachingVisualizationIR => {
  const topic = evidenceTopic(context);
  const domain = inferTeachingDomain(`${topic}\n${content || ''}`);
  const traceSeed = traceForDomain(domain, topic);
  const processTrace: ProcessTraceIR = {
    schemaVersion: 'process_trace.v1',
    domain,
    title: topic,
    ...traceSeed
  };
  return {
    teachingPlan: teachingPlanFor(context, domain),
    processTrace,
    visualMapping: visualMappingFor(processTrace)
  };
};

const asStringArray = (value: unknown, fallback: string[]) =>
  Array.isArray(value)
    ? value.map((item) => clip(item, 180)).filter(Boolean).slice(0, 12)
    : fallback;

const normalizeStep = (step: any, index: number, fallback: ProcessStepIR): ProcessStepIR => ({
  id: clip(step?.id, 60) || fallback.id,
  index,
  title: clip(step?.title, 120) || fallback.title,
  goal: clip(step?.goal, 220) || fallback.goal,
  operation: {
    type: ['initialize', 'inspect', 'compare', 'transition', 'update', 'emit', 'summarize'].includes(String(step?.operation?.type))
      ? step.operation.type
      : fallback.operation.type,
    targetIds: asStringArray(step?.operation?.targetIds, fallback.operation.targetIds),
    description: clip(step?.operation?.description, 260) || fallback.operation.description
  },
  statePatch: step?.statePatch && typeof step.statePatch === 'object' ? step.statePatch : fallback.statePatch,
  narration: clip(step?.narration, 500) || fallback.narration,
  observation: clip(step?.observation, 360) || fallback.observation,
  misconception: clip(step?.misconception, 260) || fallback.misconception,
  checkQuestion: clip(step?.checkQuestion, 260) || fallback.checkQuestion,
  visualCues: Array.isArray(step?.visualCues)
    ? step.visualCues.slice(0, 8).map((cue: any, cueIndex: number) => ({
        primitiveId: clip(cue?.primitiveId, 80) || fallback.visualCues[0]?.primitiveId || 'main',
        targetIds: asStringArray(cue?.targetIds, fallback.visualCues[0]?.targetIds || []),
        effect: ['focus', 'compare', 'update', 'create', 'remove', 'success', 'warning'].includes(String(cue?.effect))
          ? cue.effect
          : fallback.visualCues[cueIndex]?.effect || 'focus',
        label: clip(cue?.label, 120)
      }))
    : fallback.visualCues
});

export const normalizeTeachingVisualizationIR = (
  context: StudioGenerationContext,
  candidate: any,
  content?: string
): TeachingVisualizationIR => {
  const migrated = migrateTeachingVisualizationIR(candidate);
  const fallback = buildFallbackTeachingVisualizationIR(context, content);
  const input = migrated.value;
  const plan = input?.teachingPlan || input?.teachingUnderstanding || {};
  const trace = input?.processTrace || {};
  const mapping = input?.visualMapping || {};
  const domain = inferTeachingDomain(String(trace.domain || mapping.layout || `${evidenceTopic(context)}\n${content || ''}`));
  const fallbackTrace = fallback.processTrace.domain === domain
    ? fallback.processTrace
    : {
        schemaVersion: 'process_trace.v1' as const,
        domain,
        title: evidenceTopic(context),
        ...traceForDomain(domain, evidenceTopic(context))
      };

  const processTrace: ProcessTraceIR = {
    schemaVersion: 'process_trace.v1',
    domain,
    title: clip(trace.title, 160) || fallbackTrace.title,
    initialState: trace.initialState && typeof trace.initialState === 'object' ? trace.initialState : fallbackTrace.initialState,
    stateModel: {
      primitives: Array.isArray(trace.stateModel?.primitives) && trace.stateModel.primitives.length
        ? trace.stateModel.primitives.slice(0, 8).map((primitive: any, index: number) => ({
            id: clip(primitive.id, 80) || `primitive-${index + 1}`,
            kind: ['sequence', 'graph', 'table', 'state_machine', 'formula', 'variables', 'text'].includes(String(primitive.kind))
              ? primitive.kind
              : 'text',
            label: clip(primitive.label, 120) || `Visual ${index + 1}`,
            role: clip(primitive.role, 80),
            data: primitive.data && typeof primitive.data === 'object' ? primitive.data : {}
          }))
        : fallbackTrace.stateModel.primitives,
      variables: Array.isArray(trace.stateModel?.variables)
        ? trace.stateModel.variables.slice(0, 12).map((variable: any, index: number) => ({
            id: clip(variable.id, 80) || `var-${index + 1}`,
            label: clip(variable.label, 120) || `var ${index + 1}`,
            value: clip(variable.value, 160),
            role: clip(variable.role, 100)
          }))
        : fallbackTrace.stateModel.variables
    },
    steps: Array.isArray(trace.steps) && trace.steps.length
      ? trace.steps.slice(0, 16).map((step: any, index: number) =>
          normalizeStep(step, index, fallbackTrace.steps[Math.min(index, fallbackTrace.steps.length - 1)])
        )
      : fallbackTrace.steps
  };

  const normalized: TeachingVisualizationIR = {
    teachingPlan: {
      schemaVersion: 'teaching_understanding.v1',
      learningObjectives: asStringArray(plan.learningObjectives, fallback.teachingPlan.learningObjectives),
      coreConcepts: asStringArray(plan.coreConcepts, fallback.teachingPlan.coreConcepts),
      prerequisites: asStringArray(plan.prerequisites, fallback.teachingPlan.prerequisites),
      misconceptions: asStringArray(plan.misconceptions, fallback.teachingPlan.misconceptions),
      explanationStrategy: asStringArray(plan.explanationStrategy, fallback.teachingPlan.explanationStrategy),
      assessmentCheckpoints: asStringArray(plan.assessmentCheckpoints, fallback.teachingPlan.assessmentCheckpoints)
    },
    processTrace,
    visualMapping: {
      schemaVersion: 'visual_mapping.v1',
      layout: domain,
      views: Array.isArray(mapping.views) && mapping.views.length
        ? mapping.views.slice(0, 8).map((view: any, index: number) => ({
            id: clip(view.id, 80) || `view-${index + 1}`,
            primitiveId: clip(view.primitiveId, 80) || processTrace.stateModel.primitives[index]?.id || processTrace.stateModel.primitives[0]?.id || 'main',
            kind: ['sequence', 'graph', 'table', 'state_machine', 'formula', 'variables', 'text'].includes(String(view.kind))
              ? view.kind
              : processTrace.stateModel.primitives[index]?.kind || 'text',
            title: clip(view.title, 120) || processTrace.stateModel.primitives[index]?.label || `View ${index + 1}`,
            priority: Number.isFinite(Number(view.priority)) ? Number(view.priority) : index + 1
          }))
        : visualMappingFor(processTrace).views,
      cueRules: visualMappingFor(processTrace).cueRules,
      narrationBinding: visualMappingFor(processTrace).narrationBinding
    }
  };
  return repairTeachingVisualizationIR(normalized).value;
};

export const migrateTeachingVisualizationIR = (
  candidate: any
): { value: any; report: IRMigrationReport } => {
  const actions: string[] = [];
  const value = isRecord(candidate) ? { ...candidate } : {};
  const fromVersion = String(value.schemaVersion || value.version || 'unknown');
  if (!value.teachingPlan && value.teachingUnderstanding) {
    value.teachingPlan = value.teachingUnderstanding;
    actions.push('Renamed teachingUnderstanding to teachingPlan.');
  }
  if (!value.processTrace && value.trace) {
    value.processTrace = value.trace;
    actions.push('Renamed trace to processTrace.');
  }
  if (!value.visualMapping && value.mapping) {
    value.visualMapping = value.mapping;
    actions.push('Renamed mapping to visualMapping.');
  }
  return {
    value,
    report: {
      schemaVersion: 'ir_migration.v1',
      fromVersion,
      toVersion: 'teaching_visualization_bundle.v1',
      actions
    }
  };
};

export const repairTeachingVisualizationIR = (
  visualization: TeachingVisualizationIR
): { value: TeachingVisualizationIR; report: IRRepairReport } => {
  const actions: IRRepairReport['actions'] = [];
  const trace = visualization.processTrace;
  const primitiveIds = new Set(trace.stateModel.primitives.map((primitive) => primitive.id));
  const elementMap = primitiveElementMap(trace);
  const allElements = globalElementSet(trace);
  const defaultPrimitiveId = trace.stateModel.primitives[0]?.id || 'main';
  const repairedSteps = trace.steps.map((step, index) => {
    const repairedCues = (step.visualCues?.length ? step.visualCues : [{ primitiveId: defaultPrimitiveId, targetIds: step.operation.targetIds || [], effect: 'focus' as const }])
      .map((cue, cueIndex) => {
        const cuePrimitiveId = primitiveIds.has(cue.primitiveId) ? cue.primitiveId : defaultPrimitiveId;
        if (!primitiveIds.has(cue.primitiveId)) {
          actions.push({
            path: `processTrace.steps[${index}].visualCues[${cueIndex}].primitiveId`,
            action: `rewire:${cue.primitiveId}->${defaultPrimitiveId}`,
            reason: 'Cue referenced an unknown primitive.'
          });
        }
        const validTargets = elementMap.get(cuePrimitiveId) || new Set<string>([cuePrimitiveId]);
        const repairedTargets = (cue.targetIds || []).filter((targetId) => {
          const ok = validTargets.has(targetId);
          if (!ok) {
            actions.push({
              path: `processTrace.steps[${index}].visualCues[${cueIndex}].targetIds`,
              action: `drop:${targetId}`,
              reason: `Cue target does not exist in primitive "${cuePrimitiveId}".`
            });
          }
          return ok;
        });
        return {
          ...cue,
          primitiveId: cuePrimitiveId,
          targetIds: repairedTargets.length ? repairedTargets : [cuePrimitiveId]
        };
      });
    const repairedOperationTargets = (step.operation.targetIds || []).filter((targetId) => {
      const ok = allElements.has(targetId);
      if (!ok) {
        actions.push({
          path: `processTrace.steps[${index}].operation.targetIds`,
          action: `drop:${targetId}`,
          reason: 'Operation target does not exist in any visual primitive.'
        });
      }
      return ok;
    });
    if (step.index !== index) {
      actions.push({
        path: `processTrace.steps[${index}].index`,
        action: `set:${index}`,
        reason: 'Step indexes must be sequential for deterministic playback.'
      });
    }
    return {
      ...step,
      index,
      operation: {
        ...step.operation,
        targetIds: repairedOperationTargets.length
          ? repairedOperationTargets
          : repairedCues.flatMap((cue) => cue.targetIds).slice(0, 8)
      },
      statePatch: isRecord(step.statePatch) ? step.statePatch : {},
      visualCues: repairedCues
    };
  });
  const repairedViews = visualization.visualMapping.views.map((view, index) => {
    if (!primitiveIds.has(view.primitiveId)) {
      actions.push({
        path: `visualMapping.views[${index}].primitiveId`,
        action: `rewire:${view.primitiveId}->${defaultPrimitiveId}`,
        reason: 'View referenced an unknown primitive.'
      });
      return { ...view, primitiveId: defaultPrimitiveId };
    }
    return view;
  });
  return {
    value: {
      ...visualization,
      processTrace: { ...trace, steps: repairedSteps },
      visualMapping: { ...visualization.visualMapping, views: repairedViews }
    },
    report: {
      schemaVersion: 'ir_repair.v1',
      changed: actions.length > 0,
      actions
    }
  };
};

export const executeProcessTrace = (trace: ProcessTraceIR): TraceRuntimeResult => {
  const issues: IRContractIssue[] = [];
  let state = isRecord(trace.initialState) ? trace.initialState : {};
  const frames = trace.steps.map((step, index) => {
    if (step.index !== index) {
      issues.push({
        path: `processTrace.steps[${index}].index`,
        severity: 'warning',
        code: 'step.index.non_sequential',
        message: `Step index is ${step.index}, expected ${index}.`
      });
    }
    state = deepMerge(state, isRecord(step.statePatch) ? step.statePatch : {});
    const activeTargets: Record<string, string[]> = {};
    const effects: Record<string, ProcessVisualCue['effect']> = {};
    for (const cue of step.visualCues || []) {
      activeTargets[cue.primitiveId] = cue.targetIds || [];
      effects[cue.primitiveId] = cue.effect;
    }
    return {
      index,
      stepId: step.id,
      title: step.title,
      state,
      activeTargets,
      effects
    };
  });
  return {
    schemaVersion: 'trace_runtime.v1',
    frames,
    finalState: state,
    issues
  };
};

export const diffTraceFrames = (frames: TraceFrame[]): TraceDiffReport => {
  const diffValue = (before: unknown, after: unknown, path = 'state'): TraceDiffItem[] => {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (!isRecord(before) || !isRecord(after)) {
      return [{ path, type: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed', before, after }];
    }
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys.flatMap((key) => diffValue(before[key], after[key], `${path}.${key}`));
  };
  return {
    schemaVersion: 'trace_diff.v1',
    frames: frames.map((frame, index) => ({
      fromStepId: frames[index - 1]?.stepId,
      toStepId: frame.stepId,
      changes: diffValue(index === 0 ? {} : frames[index - 1].state, frame.state)
    }))
  };
};

export const buildRendererState = (
  trace: ProcessTraceIR,
  mapping: VisualMappingIR
): RendererStateResult => {
  const runtime = executeProcessTrace(trace);
  const diff = diffTraceFrames(runtime.frames);
  const primitiveById = new Map(trace.stateModel.primitives.map((primitive) => [primitive.id, primitive]));
  const views = (mapping.views || [])
    .slice()
    .sort((a, b) => a.priority - b.priority);
  const issues: IRContractIssue[] = [...runtime.issues];
  const frames = runtime.frames.map((frame, index) => {
    const step = trace.steps[index] || trace.steps[0];
    const previousFrame = runtime.frames[index - 1];
    return {
      index,
      stepId: frame.stepId,
      title: frame.title,
      views: views.flatMap((view): RendererViewState[] => {
        const primitive = primitiveById.get(view.primitiveId);
        if (!primitive) {
          issues.push({
            path: `visualMapping.views.${view.id}.primitiveId`,
            severity: 'error',
            code: 'renderer.primitive.missing',
            message: `Renderer view "${view.id}" points to missing primitive "${view.primitiveId}".`
          });
          return [];
        }
        const rendererState = normalizeRendererStateForView(primitive, frame, previousFrame);
        const visualActions = visualActionsForView(primitive, step, frame, previousFrame);
        return [{
          viewId: view.id,
          primitiveId: primitive.id,
          kind: view.kind,
          title: view.title,
          priority: view.priority,
          effect: frame.effects[primitive.id],
          activeTargets: frame.activeTargets[primitive.id] || [],
          primitiveData: primitive.data,
          frameState: frame.state,
          diff: diff.frames[index]?.changes || [],
          rendererState,
          visualActions,
          animationTimeline: timelineForActions(visualActions)
        }];
      }),
      narration: {
        title: step?.title || frame.title,
        primary: step?.narration || '',
        secondary: step?.observation || '',
        check: step?.checkQuestion
      }
    };
  });
  return {
    schemaVersion: 'renderer_state.v1',
    frames,
    issues
  };
};

export const computeVisualCoverage = (
  trace: ProcessTraceIR,
  mapping: VisualMappingIR
): VisualCoverageReport => {
  const mappedIds = new Set((mapping.views || []).map((view) => view.primitiveId));
  const cueTargets = new Map<string, Set<string>>();
  const danglingByPrimitive = new Map<string, Set<string>>();
  const edgeReferenceIssues: IRContractIssue[] = [];
  const elementMap = primitiveElementMap(trace);
  for (const primitive of trace.stateModel.primitives) {
    if (Array.isArray((primitive.data as any).edges)) {
      const nodeIds = new Set(Array.isArray((primitive.data as any).nodes) ? (primitive.data as any).nodes.map((node: any) => String(node.id)) : []);
      (primitive.data as any).edges.forEach((edge: any, index: number) => {
        if (edge.source && !nodeIds.has(String(edge.source))) {
          edgeReferenceIssues.push({
            path: `processTrace.stateModel.primitives.${primitive.id}.data.edges[${index}].source`,
            severity: 'error',
            code: 'edge.source.unknown',
            message: `Edge source "${edge.source}" does not exist in primitive "${primitive.id}".`
          });
        }
        if (edge.target && !nodeIds.has(String(edge.target))) {
          edgeReferenceIssues.push({
            path: `processTrace.stateModel.primitives.${primitive.id}.data.edges[${index}].target`,
            severity: 'error',
            code: 'edge.target.unknown',
            message: `Edge target "${edge.target}" does not exist in primitive "${primitive.id}".`
          });
        }
      });
    }
  }
  for (const step of trace.steps) {
    for (const cue of step.visualCues || []) {
      const covered = cueTargets.get(cue.primitiveId) || new Set<string>();
      const dangling = danglingByPrimitive.get(cue.primitiveId) || new Set<string>();
      const validIds = elementMap.get(cue.primitiveId) || new Set<string>();
      for (const targetId of cue.targetIds || []) {
        if (validIds.has(targetId)) covered.add(targetId);
        else dangling.add(targetId);
      }
      cueTargets.set(cue.primitiveId, covered);
      danglingByPrimitive.set(cue.primitiveId, dangling);
    }
  }
  return {
    schemaVersion: 'visual_coverage.v1',
    primitiveCoverage: trace.stateModel.primitives.map((primitive) => {
      const elements = elementMap.get(primitive.id) || new Set<string>();
      const covered = cueTargets.get(primitive.id) || new Set<string>();
      const dangling = danglingByPrimitive.get(primitive.id) || new Set<string>();
      return {
        primitiveId: primitive.id,
        kind: primitive.kind,
        mapped: mappedIds.has(primitive.id),
        elementCount: elements.size,
        coveredElementCount: covered.size,
        uncoveredElementIds: Array.from(elements).filter((id) => !covered.has(id)),
        danglingTargetIds: Array.from(dangling)
      };
    }),
    edgeReferenceIssues
  };
};

export const validateTeachingVisualizationIR = (visualization: TeachingVisualizationIR): IRContractReport => {
  const issues: IRContractIssue[] = [];
  const trace = visualization.processTrace;
  const mapping = visualization.visualMapping;
  const primitives = Array.isArray(trace?.stateModel?.primitives) ? trace.stateModel.primitives : [];
  const primitiveIds = new Set(primitives.map((primitive) => primitive.id).filter(Boolean));
  const elementMap = primitiveElementMap(trace);
  const allElements = globalElementSet(trace);
  const views = Array.isArray(mapping?.views) ? mapping.views : [];
  const stepList = Array.isArray(trace?.steps) ? trace.steps : [];
  const add = (issue: IRContractIssue) => issues.push(issue);

  if (visualization.teachingPlan?.schemaVersion !== 'teaching_understanding.v1') {
    add({ path: 'teachingPlan.schemaVersion', severity: 'error', code: 'schema.invalid', message: 'Teaching plan schemaVersion must be teaching_understanding.v1.' });
  }
  if (trace?.schemaVersion !== 'process_trace.v1') {
    add({ path: 'processTrace.schemaVersion', severity: 'error', code: 'schema.invalid', message: 'Process trace schemaVersion must be process_trace.v1.' });
  }
  if (mapping?.schemaVersion !== 'visual_mapping.v1') {
    add({ path: 'visualMapping.schemaVersion', severity: 'error', code: 'schema.invalid', message: 'Visual mapping schemaVersion must be visual_mapping.v1.' });
  }
  if (!primitives.length) {
    add({ path: 'processTrace.stateModel.primitives', severity: 'error', code: 'primitive.empty', message: 'At least one visual primitive is required.' });
  }
  primitives.forEach((primitive, index) => {
    if (!primitive.id) add({ path: `processTrace.stateModel.primitives[${index}].id`, severity: 'error', code: 'primitive.id.missing', message: 'Primitive id is required.' });
    if (!primitive.label) add({ path: `processTrace.stateModel.primitives[${index}].label`, severity: 'warning', code: 'primitive.label.missing', message: 'Primitive label improves renderer usability.' });
    if (!isRecord(primitive.data)) add({ path: `processTrace.stateModel.primitives[${index}].data`, severity: 'error', code: 'primitive.data.invalid', message: 'Primitive data must be an object.' });
  });
  if (stepList.length < 3) {
    add({ path: 'processTrace.steps', severity: 'warning', code: 'steps.too_few', message: 'A demonstration trace should usually contain at least three steps.' });
  }
  stepList.forEach((step, index) => {
    if (!step.id) add({ path: `processTrace.steps[${index}].id`, severity: 'error', code: 'step.id.missing', message: 'Step id is required.' });
    if (!step.title || !step.narration) add({ path: `processTrace.steps[${index}]`, severity: 'warning', code: 'step.text.thin', message: 'Step should include title and narration.' });
    if (!isRecord(step.statePatch)) add({ path: `processTrace.steps[${index}].statePatch`, severity: 'error', code: 'step.patch.invalid', message: 'statePatch must be an object.' });
    for (const targetId of step.operation?.targetIds || []) {
      if (!allElements.has(targetId)) {
        add({
          path: `processTrace.steps[${index}].operation.targetIds`,
          severity: 'error',
          code: 'operation.target.unknown',
          message: `Operation target "${targetId}" is not backed by any visual element.`
        });
      }
    }
    for (const [cueIndex, cue] of (step.visualCues || []).entries()) {
      if (!primitiveIds.has(cue.primitiveId)) {
        add({
          path: `processTrace.steps[${index}].visualCues`,
          severity: 'error',
          code: 'cue.primitive.unknown',
          message: `Cue references unknown primitive "${cue.primitiveId}".`
        });
        continue;
      }
      const validTargets = elementMap.get(cue.primitiveId) || new Set<string>();
      for (const targetId of cue.targetIds || []) {
        if (!validTargets.has(targetId)) {
          add({
            path: `processTrace.steps[${index}].visualCues[${cueIndex}].targetIds`,
            severity: 'error',
            code: 'cue.target.unknown',
            message: `Cue target "${targetId}" does not exist in primitive "${cue.primitiveId}".`
          });
        }
      }
    }
  });
  views.forEach((view, index) => {
    if (!primitiveIds.has(view.primitiveId)) {
      add({
        path: `visualMapping.views[${index}].primitiveId`,
        severity: 'error',
        code: 'mapping.primitive.unknown',
        message: `View references unknown primitive "${view.primitiveId}".`
      });
    }
  });
  const runtime = executeProcessTrace(trace);
  issues.push(...runtime.issues);
  const diff = diffTraceFrames(runtime.frames);
  const rendererState = buildRendererState(trace, mapping);
  issues.push(...rendererState.issues.filter((issue) => !runtime.issues.includes(issue)));
  const coverage = computeVisualCoverage(trace, mapping);
  issues.push(...coverage.edgeReferenceIssues);
  const mappedPrimitiveCount = new Set(views.map((view) => view.primitiveId).filter((id) => primitiveIds.has(id))).size;
  if (mappedPrimitiveCount < primitiveIds.size) {
    add({
      path: 'visualMapping.views',
      severity: 'warning',
      code: 'mapping.coverage.partial',
      message: `Visual mapping covers ${mappedPrimitiveCount}/${primitiveIds.size} primitives.`
    });
  }

  return {
    schemaVersion: 'studio_visualization_contract.v1',
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    metrics: {
      primitiveCount: primitiveIds.size,
      visualElementCount: coverage.primitiveCoverage.reduce((sum, item) => sum + item.elementCount, 0),
      stepCount: stepList.length,
      cueCount: stepList.reduce((sum, step) => sum + (step.visualCues?.length || 0), 0),
      frameCount: runtime.frames.length,
      rendererFrameCount: rendererState.frames.length,
      mappedPrimitiveCount,
      coveredElementCount: coverage.primitiveCoverage.reduce((sum, item) => sum + item.coveredElementCount, 0),
      danglingTargetCount: coverage.primitiveCoverage.reduce((sum, item) => sum + item.danglingTargetIds.length, 0)
    },
    coverage,
    diff,
    rendererState
  };
};
