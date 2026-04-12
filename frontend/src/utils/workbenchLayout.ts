import { EditorLayoutNode, EditorLeafNode } from '../types';

export type WorkbenchDropPlacement = 'center' | 'left' | 'right' | 'top' | 'bottom';

export const createLeaf = (
  id: string,
  editorIds: string[],
  activeEditorId: string | null
): EditorLeafNode => ({
  id,
  type: 'leaf',
  editorIds,
  activeEditorId
});

export const createPaneId = () => `pane-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const normalizeLeaf = (leaf: EditorLeafNode): EditorLeafNode => ({
  ...leaf,
  editorIds: Array.isArray(leaf.editorIds)
    ? leaf.editorIds
    : Array.isArray(leaf.panelIds)
      ? leaf.panelIds
      : [],
  activeEditorId:
    typeof leaf.activeEditorId === 'string'
      ? leaf.activeEditorId
      : typeof leaf.activePanelId === 'string'
        ? leaf.activePanelId
        : null
});

export const collectLeafIds = (node: EditorLayoutNode | null | undefined): string[] => {
  if (!node) return [];
  if (node.type === 'leaf') return [node.id];
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])];
};

export const countLeafNodes = (node: EditorLayoutNode | null | undefined): number => {
  if (!node) return 0;
  if (node.type === 'leaf') return 1;
  return countLeafNodes(node.children[0]) + countLeafNodes(node.children[1]);
};

export const getResolvedLayout = (
  layout: EditorLayoutNode | null | undefined,
  editorIds: string[],
  activeEditorId: string | null
) => {
  if (layout) return layout;
  if (editorIds.length === 0) return null;
  return createLeaf('pane-1', editorIds, activeEditorId ?? editorIds[0] ?? null);
};

export const findLeafById = (
  node: EditorLayoutNode | null | undefined,
  paneId: string | null
): EditorLeafNode | null => {
  if (!node || !paneId) return null;
  if (node.type === 'leaf') return node.id === paneId ? normalizeLeaf(node) : null;
  return findLeafById(node.children[0], paneId) ?? findLeafById(node.children[1], paneId);
};

export const mapLayoutTree = (
  node: EditorLayoutNode,
  paneId: string,
  mapper: (leaf: EditorLeafNode) => EditorLayoutNode
): EditorLayoutNode => {
  if (node.type === 'leaf') {
    return node.id === paneId ? mapper(normalizeLeaf(node)) : node;
  }

  return {
    ...node,
    children: [
      mapLayoutTree(node.children[0], paneId, mapper),
      mapLayoutTree(node.children[1], paneId, mapper)
    ]
  };
};

export const updateLeafEditors = (
  node: EditorLayoutNode | null | undefined,
  paneId: string,
  updater: (leaf: EditorLeafNode) => EditorLeafNode
): EditorLayoutNode | null => {
  if (!node) return null;

  if (node.type === 'leaf') {
    return node.id === paneId ? updater(normalizeLeaf(node)) : node;
  }

  return {
    ...node,
    children: [
      updateLeafEditors(node.children[0], paneId, updater) as EditorLayoutNode,
      updateLeafEditors(node.children[1], paneId, updater) as EditorLayoutNode
    ]
  };
};

export const findPaneContainingEditor = (
  node: EditorLayoutNode | null | undefined,
  editorId: string
): string | null => {
  if (!node) return null;

  if (node.type === 'leaf') {
    return normalizeLeaf(node).editorIds.includes(editorId) ? node.id : null;
  }

  return (
    findPaneContainingEditor(node.children[0], editorId) ??
    findPaneContainingEditor(node.children[1], editorId)
  );
};

export const removeEditorFromLayout = (
  node: EditorLayoutNode | null | undefined,
  editorId: string
): EditorLayoutNode | null => {
  if (!node) return null;

  if (node.type === 'leaf') {
    const normalizedLeaf = normalizeLeaf(node);
    const editorIds = normalizedLeaf.editorIds.filter((id) => id !== editorId);

    if (editorIds.length === 0) {
      return null;
    }

    return {
      ...normalizedLeaf,
      editorIds,
      activeEditorId:
        normalizedLeaf.activeEditorId === editorId
          ? editorIds.at(-1) ?? null
          : normalizedLeaf.activeEditorId
    };
  }

  const left = removeEditorFromLayout(node.children[0], editorId);
  const right = removeEditorFromLayout(node.children[1], editorId);

  if (!left && !right) return null;
  if (!left) return right;
  if (!right) return left;

  return {
    ...node,
    children: [left, right]
  };
};

export const findFirstLeafId = (node: EditorLayoutNode | null | undefined): string | null => {
  if (!node) return null;
  if (node.type === 'leaf') return node.id;
  return findFirstLeafId(node.children[0]) ?? findFirstLeafId(node.children[1]);
};
