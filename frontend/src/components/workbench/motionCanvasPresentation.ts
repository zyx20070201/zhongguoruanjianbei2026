export type PresentationObjectKind = 'calculationStack' | 'digitRow' | 'annotation' | 'table' | 'graph' | 'arrow';

export interface PresentationCell {
  id: string;
  value: string;
  active?: boolean;
  changed?: boolean;
  muted?: boolean;
}

export interface PresentationRow {
  id: string;
  label?: string;
  cells: string[];
  active?: boolean;
  changed?: boolean;
}

export interface PresentationNode {
  id: string;
  label: string;
  active?: boolean;
  x: number;
  y: number;
}

export interface PresentationEdge {
  id: string;
  source: string;
  target: string;
  active?: boolean;
  label?: string;
}

export interface PresentationObject {
  id: string;
  kind: PresentationObjectKind;
  label?: string;
  value?: string;
  cells?: PresentationCell[];
  rows?: PresentationRow[];
  columns?: string[];
  operands?: string[];
  result?: string;
  nodes?: PresentationNode[];
  edges?: PresentationEdge[];
  x: number;
  y: number;
  w: number;
  h: number;
  emphasis?: 'primary' | 'active' | 'changed' | 'muted';
}

export interface AlgorithmPresentationScene {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  objects: PresentationObject[];
}
