import { Bot, ChevronRight, Columns2, FileText, Globe, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import {
  EditorLayoutNode,
  EditorLeafNode,
  EditorState,
  FileSystemObject,
  ResourceReference
} from '../../types';
import { useFileTreeStore } from '../../store/fileTreeStore';
import {
  collectLeafIds,
  createLeaf,
  findLeafById,
  normalizeLeaf,
  WorkbenchDropPlacement
} from '../../utils/workbenchLayout';
import WorkbenchEditorContent from './WorkbenchEditorContent';
import { getLanguageLabel } from './editorResource';

type WorkbenchTreeDragItem = { id: string; dragIds?: string[] };
type WorkbenchEditorTabDragItem = { editorId: string; sourcePaneId: string };
type WorkbenchDropItem = WorkbenchTreeDragItem | WorkbenchEditorTabDragItem;

const FILE_TREE_ITEM_TYPE = 'NODE';
const EDITOR_TAB_ITEM_TYPE = 'WORKBENCH_EDITOR_TAB';

interface WorkbenchEditorProps {
  workspaceId: string;
  editors: EditorState[];
  activeEditorId: string | null;
  activePaneId: string | null;
  editorLayout: EditorLayoutNode | null | undefined;
  resources: ResourceReference[];
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onInitializeLayout: (layout: EditorLayoutNode, paneId: string | null) => void;
  onDropResourceToPane: (
    file: FileSystemObject,
    paneId: string | null,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onAddEditor: () => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  aiContext?: {
    activeFile?: { name: string; path: string } | null;
    activeExternal?: { title: string; url: string; description?: string } | null;
  };
}

const getBoundResource = (editor: EditorState, resources: ResourceReference[]) =>
  resources.find((resource) => resource.id === editor.resourceId) ?? null;

const getDropPlacement = (
  point: { x: number; y: number },
  element: HTMLElement
): WorkbenchDropPlacement => {
  const rect = element.getBoundingClientRect();
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  const horizontalEdge = rect.width * 0.25;
  const verticalEdge = rect.height * 0.25;

  if (x <= horizontalEdge) return 'left';
  if (x >= rect.width - horizontalEdge) return 'right';
  if (y <= verticalEdge) return 'top';
  if (y >= rect.height - verticalEdge) return 'bottom';
  return 'center';
};

function DropHint({
  placement
}: {
  placement: WorkbenchDropPlacement | null;
}) {
  if (!placement) return null;

  const placementClass = {
    center: 'inset-[20%]',
    left: 'left-2 top-2 bottom-2 w-[28%]',
    right: 'right-2 top-2 bottom-2 w-[28%]',
    top: 'left-2 right-2 top-2 h-[28%]',
    bottom: 'left-2 right-2 bottom-2 h-[28%]'
  }[placement];

  return (
    <div className="pointer-events-none absolute inset-0 z-20 rounded-lg bg-blue-500/8">
      <div className={`absolute rounded-md border border-blue-400 bg-blue-500/20 ${placementClass}`} />
    </div>
  );
}

function EditorTab({
  editor,
  paneId,
  isActive,
  resource,
  isDirty,
  onActivate,
  onClose
}: {
  editor: EditorState;
  paneId: string;
  isActive: boolean;
  resource: ResourceReference | null;
  isDirty: boolean;
  onActivate: () => void;
  onClose: () => void;
}) {
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: EDITOR_TAB_ITEM_TYPE,
      item: {
        editorId: editor.id,
        sourcePaneId: paneId
      } satisfies WorkbenchEditorTabDragItem,
      collect: (monitor) => ({
        isDragging: monitor.isDragging()
      })
    }),
    [editor.id, paneId]
  );

  return (
    <div
      ref={(element) => {
        drag(element);
      }}
      className={`group flex min-w-[160px] max-w-[280px] items-center border-r border-[var(--wb-border)] ${
        isActive ? 'bg-[var(--wb-tab-active)]' : 'bg-[var(--wb-tab)]'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        onClick={onActivate}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 px-3 py-2 text-left text-sm active:cursor-grabbing hover:bg-[var(--wb-tab-hover)]"
      >
        <span className={`truncate ${isActive ? 'text-[var(--wb-text)]' : 'text-[var(--wb-text-muted)]'}`}>
          {editor.title}
        </span>
        {resource && <span className="truncate text-xs text-[var(--wb-text-dim)]">{resource.name}</span>}
        {isDirty && <span className="text-[10px] font-semibold text-[var(--wb-accent)]">M</span>}
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="mr-2 rounded p-1 text-[var(--wb-text-dim)] opacity-0 transition-opacity hover:bg-white/5 hover:text-[var(--wb-text)] group-hover:opacity-100"
        title="Close editor"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EditorBreadcrumbs({
  editor,
  resource,
  aiContext
}: {
  editor: EditorState;
  resource: ResourceReference | null;
  aiContext?: {
    activeFile?: { name: string; path: string } | null;
    activeExternal?: { title: string; url: string; description?: string } | null;
  };
}) {
  const resourceParts = resource?.path.split('/').filter(Boolean) ?? [];

  let crumbs = resourceParts;
  let leadingIcon = <FileText className="h-3.5 w-3.5 text-[var(--wb-accent)]" />;
  let trailingLabel = resource ? getLanguageLabel(resource) : editor.type;

  if (editor.type === 'external') {
    leadingIcon = <Globe className="h-3.5 w-3.5 text-[var(--wb-accent)]" />;
    crumbs = ['REFERENCES', editor.viewState?.externalResource?.title || editor.title];
    trailingLabel = 'External';
  } else if (editor.type === 'ai') {
    leadingIcon = <Bot className="h-3.5 w-3.5 text-[var(--wb-accent)]" />;
    crumbs = [
      'AI',
      aiContext?.activeFile?.name || aiContext?.activeExternal?.title || editor.title || 'Conversation'
    ];
    trailingLabel = aiContext?.activeExternal ? 'Using reference' : 'Workbench';
  } else if (resourceParts.length === 0) {
    crumbs = [editor.title];
  }

  return (
    <div className="flex h-7 items-center gap-1 border-b border-[var(--wb-border)] bg-[var(--wb-panel)] px-3 text-xs text-[var(--wb-text-dim)]">
      <span className="mr-1">{leadingIcon}</span>
      {crumbs.map((crumb, index) => (
        <div key={`${crumb}-${index}`} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="h-3 w-3 text-[var(--wb-text-dim)]" />}
          <span
            className={
              index === crumbs.length - 1
                ? 'max-w-[240px] truncate text-[var(--wb-text)]'
                : 'max-w-[160px] truncate'
            }
          >
            {crumb}
          </span>
        </div>
      ))}
      <span className="ml-auto rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--wb-text-muted)]">
        {trailingLabel}
      </span>
    </div>
  );
}

function EditorLeafView({
  leaf,
  workspaceId,
  editors,
  resources,
  documentStateByResourceId,
  activeEditorId,
  onActivateEditor,
  onCloseEditor,
  onBindResource,
  onChangeDocumentContent,
  onUpdateEditorViewState,
  onActivatePane,
  onDropResourceToPane,
  onDropEditorTab,
  aiContext
}: {
  leaf: EditorLeafNode;
  workspaceId: string;
  editors: EditorState[];
  resources: ResourceReference[];
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  activeEditorId: string | null;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onDropResourceToPane: (
    file: FileSystemObject,
    paneId: string | null,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  aiContext?: {
    activeFile?: { name: string; path: string } | null;
    activeExternal?: { title: string; url: string; description?: string } | null;
  };
}) {
  const normalizedLeaf = normalizeLeaf(leaf);
  const [dropPlacement, setDropPlacement] = useState<WorkbenchDropPlacement | null>(null);
  const files = useFileTreeStore((state) => state.files);
  const paneRef = useRef<HTMLElement | null>(null);
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file] as const)), [files]);
  const leafEditors = normalizedLeaf.editorIds
    .map((editorId) => editors.find((editor) => editor.id === editorId))
    .filter((editor): editor is EditorState => Boolean(editor));

  const activeEditor =
    leafEditors.find((editor) => editor.id === normalizedLeaf.activeEditorId) ??
    leafEditors.find((editor) => editor.id === activeEditorId) ??
    leafEditors[0] ??
    null;

  const [{ isOverCurrent, canDrop }, drop] = useDrop<
    WorkbenchDropItem,
    void,
    { isOverCurrent: boolean; canDrop: boolean }
  >(
    () => ({
      accept: [FILE_TREE_ITEM_TYPE, EDITOR_TAB_ITEM_TYPE],
      canDrop: (item, monitor) => {
        if (monitor.getItemType() === FILE_TREE_ITEM_TYPE) {
          return filesById.get((item as WorkbenchTreeDragItem).id)?.nodeType === 'file';
        }

        if (monitor.getItemType() === EDITOR_TAB_ITEM_TYPE) {
          return Boolean((item as WorkbenchEditorTabDragItem).editorId);
        }

        return false;
      },
      hover: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) return;

        const element = paneRef.current;
        const point = monitor.getClientOffset();
        if (!element || !point) {
          setDropPlacement(null);
          return;
        }

        if (monitor.getItemType() === FILE_TREE_ITEM_TYPE) {
          const file = filesById.get((item as WorkbenchTreeDragItem).id);
          if (file?.nodeType !== 'file') {
            setDropPlacement(null);
            return;
          }
        }

        setDropPlacement(getDropPlacement(point, element));
      },
      drop: (item, monitor) => {
        if (monitor.didDrop()) return;

        const element = paneRef.current;
        const point = monitor.getClientOffset();
        if (!element || !point) return;

        const placement = getDropPlacement(point, element);

        if (monitor.getItemType() === FILE_TREE_ITEM_TYPE) {
          const file = filesById.get((item as WorkbenchTreeDragItem).id);
          if (file?.nodeType !== 'file') return;
          onDropResourceToPane(file, normalizedLeaf.id, placement);
          return;
        }

        if (monitor.getItemType() === EDITOR_TAB_ITEM_TYPE) {
          const draggedTab = item as WorkbenchEditorTabDragItem;
          onDropEditorTab(draggedTab.editorId, draggedTab.sourcePaneId, normalizedLeaf.id, placement);
        }
      },
      collect: (monitor) => ({
        isOverCurrent: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop()
      })
    }),
    [filesById, normalizedLeaf.id, onDropEditorTab, onDropResourceToPane]
  );

  useEffect(() => {
    if (!isOverCurrent || !canDrop) {
      setDropPlacement(null);
    }
  }, [canDrop, isOverCurrent]);

  return (
    <section
      ref={(element) => {
        paneRef.current = element;
        drop(element);
      }}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-[var(--wb-border)] last:border-r-0 bg-[var(--wb-editor)]"
      onMouseDown={() => onActivatePane(normalizedLeaf.id)}
      data-workbench-pane-id={normalizedLeaf.id}
    >
      <DropHint placement={dropPlacement} />

      <div className="flex items-stretch overflow-x-auto border-b border-[var(--wb-border)] bg-[var(--wb-tab)]">
        {leafEditors.map((editor) => {
          const resource = getBoundResource(editor, resources);
          const docState = resource?.id ? documentStateByResourceId[resource.id] : undefined;
          const isDirty = Boolean(docState && docState.content !== docState.savedContent);

          return (
            <EditorTab
              key={editor.id}
              editor={editor}
              paneId={normalizedLeaf.id}
              isActive={editor.id === activeEditor?.id}
              resource={resource}
              isDirty={isDirty}
              onActivate={() => {
                onActivateEditor(editor.id, normalizedLeaf.id);
                onActivatePane(normalizedLeaf.id);
              }}
              onClose={() => onCloseEditor(editor.id)}
            />
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeEditor ? (
          <div className="flex h-full min-h-0 flex-col">
            <EditorBreadcrumbs
              editor={activeEditor}
              resource={getBoundResource(activeEditor, resources)}
              aiContext={aiContext}
            />
            <div className="min-h-0 flex-1">
              <WorkbenchEditorContent
                editor={activeEditor}
                resource={getBoundResource(activeEditor, resources)}
                workspaceId={workspaceId}
                content={
                  activeEditor.resourceId
                    ? documentStateByResourceId[activeEditor.resourceId]?.content ?? ''
                    : ''
                }
                isDirty={Boolean(
                  activeEditor.resourceId &&
                    documentStateByResourceId[activeEditor.resourceId] &&
                    documentStateByResourceId[activeEditor.resourceId].content !==
                      documentStateByResourceId[activeEditor.resourceId].savedContent
                )}
                isLoading={Boolean(
                  activeEditor.resourceId &&
                    documentStateByResourceId[activeEditor.resourceId]?.loading
                )}
                onChangeContent={onChangeDocumentContent}
                onUpdateViewState={onUpdateEditorViewState}
                onBindResource={onBindResource}
                aiContext={aiContext}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--wb-editor)] text-sm text-[var(--wb-text-muted)]">
            Drop a file here to open it in this editor pane.
          </div>
        )}
      </div>
    </section>
  );
}

function LayoutNodeView(props: {
  node: EditorLayoutNode;
  workspaceId: string;
  editors: EditorState[];
  resources: ResourceReference[];
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  activeEditorId: string | null;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onDropResourceToPane: (
    file: FileSystemObject,
    paneId: string | null,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onAddEditor: () => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  aiContext?: {
    activeFile?: { name: string; path: string } | null;
    activeExternal?: { title: string; url: string; description?: string } | null;
  };
}) {
  const {
    node,
    workspaceId,
    editors,
    resources,
    documentStateByResourceId,
    activeEditorId,
    onActivateEditor,
    onCloseEditor,
    onBindResource,
    onChangeDocumentContent,
    onUpdateEditorViewState,
    onActivatePane,
    onDropResourceToPane,
    onDropEditorTab,
    onAddEditor,
    onUpdateSplitRatio,
    aiContext
  } = props;

  if (node.type === 'leaf') {
    return (
      <EditorLeafView
        leaf={node}
        workspaceId={workspaceId}
        editors={editors}
        resources={resources}
        documentStateByResourceId={documentStateByResourceId}
        activeEditorId={activeEditorId}
        onActivateEditor={onActivateEditor}
        onCloseEditor={onCloseEditor}
        onBindResource={onBindResource}
        onChangeDocumentContent={onChangeDocumentContent}
        onUpdateEditorViewState={onUpdateEditorViewState}
        onActivatePane={onActivatePane}
        onDropResourceToPane={onDropResourceToPane}
        onDropEditorTab={onDropEditorTab}
        aiContext={aiContext}
      />
    );
  }

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isRow = node.direction === 'row';
  const ratio = typeof node.ratio === 'number' ? node.ratio : 0.5;

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${isRow ? 'flex-row' : 'flex-col'}`}
    >
      <div
        style={isRow ? { width: `${ratio * 100}%` } : { height: `${ratio * 100}%` }}
        className="min-h-0 min-w-0 flex overflow-hidden"
      >
        <LayoutNodeView {...props} node={node.children[0]} />
      </div>

      <div
        className={`${isRow ? 'h-full w-px cursor-col-resize' : 'h-px w-full cursor-row-resize'} shrink-0 bg-[var(--wb-border)] hover:bg-[var(--wb-accent)]`}
        onMouseDown={(event) => {
          event.preventDefault();
          const element = containerRef.current;
          if (!element) return;
          const rect = element.getBoundingClientRect();

          const onMove = (moveEvent: MouseEvent) => {
            const nextRatio = isRow
              ? (moveEvent.clientX - rect.left) / rect.width
              : (moveEvent.clientY - rect.top) / rect.height;
            onUpdateSplitRatio(node.id, Math.max(0.2, Math.min(0.8, nextRatio)));
          };

          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      />

      <div
        style={isRow ? { width: `${(1 - ratio) * 100}%` } : { height: `${(1 - ratio) * 100}%` }}
        className="min-h-0 min-w-0 flex overflow-hidden"
      >
        <LayoutNodeView {...props} node={node.children[1]} />
      </div>
    </div>
  );
}

export default function WorkbenchEditor({
  workspaceId,
  editors,
  activeEditorId,
  activePaneId,
  editorLayout,
  resources,
  documentStateByResourceId,
  onActivateEditor,
  onCloseEditor,
  onBindResource,
  onChangeDocumentContent,
  onUpdateEditorViewState,
  onActivatePane,
  onInitializeLayout,
  onDropResourceToPane,
  onDropEditorTab,
  onAddEditor,
  onUpdateSplitRatio,
  aiContext
}: WorkbenchEditorProps) {
  const files = useFileTreeStore((state) => state.files);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file] as const)), [files]);
  const normalizedLayout = useMemo(() => {
    if (editorLayout) return editorLayout;
    if (editors.length === 0) return null;
    return createLeaf(
      'pane-1',
      editors.map((editor) => editor.id),
      activeEditorId ?? editors[0]?.id ?? null
    );
  }, [editorLayout, editors, activeEditorId]);

  const leafIds = useMemo(() => collectLeafIds(normalizedLayout), [normalizedLayout]);
  const resolvedPaneId =
    activePaneId && leafIds.includes(activePaneId) ? activePaneId : leafIds[0] ?? null;

  const [{ isOverEmptyState, canDropEmptyState }, dropEmptyState] = useDrop<
    WorkbenchTreeDragItem,
    void,
    { isOverEmptyState: boolean; canDropEmptyState: boolean }
  >(
    () => ({
      accept: FILE_TREE_ITEM_TYPE,
      canDrop: (item) => filesById.get(item.id)?.nodeType === 'file',
      drop: (item, monitor) => {
        if (monitor.didDrop()) return;
        const file = filesById.get(item.id);
        if (file?.nodeType !== 'file') return;
        onDropResourceToPane(file, null, 'center');
      },
      collect: (monitor) => ({
        isOverEmptyState: monitor.isOver({ shallow: true }),
        canDropEmptyState: monitor.canDrop()
      })
    }),
    [filesById, onDropResourceToPane]
  );

  const missingInit = useMemo(() => {
    if (!normalizedLayout && editors.length > 0) return true;
    if (!normalizedLayout) return false;

    const existingEditorIds = new Set<string>();
    const collect = (node: EditorLayoutNode) => {
      if (node.type === 'leaf') {
        normalizeLeaf(node).editorIds.forEach((editorId) => existingEditorIds.add(editorId));
      } else {
        collect(node.children[0]);
        collect(node.children[1]);
      }
    };
    collect(normalizedLayout);

    return editors.some((editor) => !existingEditorIds.has(editor.id));
  }, [normalizedLayout, editors]);

  if (missingInit && normalizedLayout) {
    const firstLeaf =
      findLeafById(normalizedLayout, resolvedPaneId) ??
      (normalizedLayout.type === 'leaf' ? normalizeLeaf(normalizedLayout) : null);
    const knownIds = new Set(firstLeaf?.editorIds ?? []);
    const extraEditors = editors.map((editor) => editor.id).filter((editorId) => !knownIds.has(editorId));

    if (firstLeaf && extraEditors.length > 0) {
      onInitializeLayout(
        {
          ...normalizedLayout,
          ...(normalizedLayout.type === 'leaf'
            ? {
                editorIds: [...normalizeLeaf(normalizedLayout).editorIds, ...extraEditors],
                activeEditorId: normalizeLeaf(normalizedLayout).activeEditorId ?? extraEditors[0] ?? null
              }
            : {})
        } as EditorLayoutNode,
        resolvedPaneId
      );
    }
  }

  if (!normalizedLayout) {
    return (
      <div
        ref={(element) => {
          rootRef.current = element;
          dropEmptyState(element);
        }}
        className="relative flex h-full items-center justify-center overflow-hidden bg-[var(--wb-editor)] px-8"
      >
        {isOverEmptyState && canDropEmptyState && <DropHint placement="center" />}
        <div className="max-w-xl rounded border border-[var(--wb-border)] bg-[var(--wb-panel)] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded border border-[var(--wb-border)] bg-[var(--wb-sidebar-alt)] text-[var(--wb-text-muted)]">
            <Columns2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--wb-text)]">No editors open</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--wb-text-muted)]">
            Open a resource from the explorer or drag a file here to start working.
          </p>
          <div className="mt-5 flex items-center justify-center">
            <button
              onClick={onAddEditor}
              className="inline-flex items-center gap-2 rounded bg-[var(--wb-accent)] px-4 py-2 text-sm font-medium text-[#08111c] hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              New Notes Editor
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-w-0 overflow-hidden bg-[var(--wb-editor)]">
      <LayoutNodeView
        node={normalizedLayout}
        workspaceId={workspaceId}
        editors={editors}
        resources={resources}
        documentStateByResourceId={documentStateByResourceId}
        activeEditorId={activeEditorId}
        onActivateEditor={onActivateEditor}
        onCloseEditor={onCloseEditor}
        onBindResource={onBindResource}
        onChangeDocumentContent={onChangeDocumentContent}
        onUpdateEditorViewState={onUpdateEditorViewState}
        onActivatePane={onActivatePane}
        onDropResourceToPane={onDropResourceToPane}
        onDropEditorTab={onDropEditorTab}
        onAddEditor={onAddEditor}
        onUpdateSplitRatio={onUpdateSplitRatio}
        aiContext={aiContext}
      />
    </div>
  );
}
