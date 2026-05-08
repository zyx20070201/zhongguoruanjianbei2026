import {
  Columns2,
  FileText,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X
} from 'lucide-react';
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
import { AiChatContext } from '../../services/aiApi';
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
  onAddEditor: (paneId?: string | null) => void;
  onClosePane: (paneId: string) => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  onToggleSidebar: () => void;
  isSidebarPinned: boolean;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
}

const getBoundResource = (editor: EditorState, resources: ResourceReference[]) =>
  resources.find((resource) => resource.id === editor.resourceId) ?? null;

const getEditorLabel = (editor: EditorState, resources: ResourceReference[]) => {
  const resource = getBoundResource(editor, resources);
  return (
    resource?.name ||
    editor.viewState?.externalResource?.title ||
    editor.title ||
    getLanguageLabel(resource)
  );
};

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
    <div className="pointer-events-none absolute inset-0 z-20 rounded-[20px] bg-[#202124]/[0.035] backdrop-blur-[1px]">
      <div
        className={`absolute rounded-[16px] border border-[#2f3337]/70 bg-white/70 shadow-[0_18px_48px_rgba(0,0,0,0.18),0_1px_0_rgba(255,255,255,0.95)_inset] ring-1 ring-white/80 ${placementClass}`}
      />
    </div>
  );
}

function PaneTab({
  paneId,
  editor,
  resources,
  documentStateByResourceId,
  isActive,
  onActivateEditor,
  onActivatePane,
  onCloseEditor
}: {
  paneId: string;
  editor: EditorState;
  resources: ResourceReference[];
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  isActive: boolean;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onActivatePane: (paneId: string) => void;
  onCloseEditor: (editorId: string) => void;
}) {
  const resource = getBoundResource(editor, resources);
  const docState = resource?.id ? documentStateByResourceId[resource.id] : undefined;
  const isDirty = Boolean(docState && docState.content !== docState.savedContent);
  const label = getEditorLabel(editor, resources);
  const [{ isDragging }, drag] = useDrag<WorkbenchEditorTabDragItem, void, { isDragging: boolean }>(
    () => ({
      type: EDITOR_TAB_ITEM_TYPE,
      item: { editorId: editor.id, sourcePaneId: paneId },
      canDrag: Boolean(editor.id),
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
      className={`group relative flex h-full min-w-0 max-w-[260px] shrink-0 items-center border-r px-3 transition ${
        isActive
          ? 'z-10 -mb-px border-[#e6e5df] border-b-white bg-white text-[#25272b]'
          : 'border-[#ecebe6] bg-[#fafaf8] text-[#7b7f85] hover:bg-[#f5f5f2] hover:text-[#25272b]'
      } ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2"
        onClick={() => {
          onActivateEditor(editor.id, paneId);
          onActivatePane(paneId);
        }}
        title="Drag this tab to move or split"
      >
        {editor.type === 'external' ? (
          <Globe className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate text-sm font-medium">{label}</span>
        {isDirty ? <span className="shrink-0 text-[10px] text-[#16833a]">●</span> : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCloseEditor(editor.id);
        }}
        className={`ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center opacity-0 transition duration-150 group-hover:opacity-100 ${
          isActive ? 'text-[#7c8086] hover:bg-[#f1f1ef] hover:text-[#25272b]' : 'text-[#a0a4aa] hover:bg-[#f1f1ef] hover:text-[#25272b]'
        }`}
        title="Close tab"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PaneTitleBar({
  paneId,
  editors,
  activeEditor,
  isPrimaryPane,
  resources,
  workspaceId,
  documentStateByResourceId,
  onActivateEditor,
  onActivatePane,
  onCloseEditor,
  onBindResource,
  onAddEditor,
  onClosePane,
  onToggleSidebar,
  isSidebarPinned
}: {
  paneId: string;
  editors: EditorState[];
  activeEditor: EditorState;
  isPrimaryPane: boolean;
  resources: ResourceReference[];
  workspaceId: string;
  documentStateByResourceId: Record<string, { content: string; savedContent: string; loading?: boolean }>;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onActivatePane: (paneId: string) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string) => void;
  onAddEditor: (paneId?: string | null) => void;
  onClosePane: (paneId: string) => void;
  onToggleSidebar: () => void;
  isSidebarPinned: boolean;
}) {
  return (
    <div className="group/pane-header relative z-10 flex h-11 items-stretch gap-0 bg-[#fafaf8] text-sm text-[#25272b]">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e6e5df]" />
      {isPrimaryPane ? (
        <button
          type="button"
          onClick={() => {
            onActivatePane(paneId);
            onToggleSidebar();
          }}
          className={`inline-flex h-full w-11 shrink-0 items-center justify-center border-r transition ${
            isSidebarPinned
              ? 'border-[#e6e5df] bg-[#fafaf8] text-[#202124]'
              : 'border-[#ecebe6] bg-[#fafaf8] text-[#868a90] hover:bg-[#f5f5f2] hover:text-[#202124]'
          }`}
          title={isSidebarPinned ? 'Hide sidebar' : 'Show sidebar'}
        >
          {isSidebarPinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden bg-[#fafaf8]">
        {editors.map((editor) => (
          <PaneTab
            key={editor.id}
            paneId={paneId}
            editor={editor}
            resources={resources}
            documentStateByResourceId={documentStateByResourceId}
            isActive={editor.id === activeEditor.id}
            onActivateEditor={onActivateEditor}
            onActivatePane={onActivatePane}
            onCloseEditor={onCloseEditor}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            onActivatePane(paneId);
            onAddEditor(paneId);
          }}
          className="inline-flex h-full w-8 shrink-0 items-center justify-center bg-[#fafaf8] pr-2 text-[#8a8e94] transition hover:text-[#25272b]"
          title="Open another resource in this pane"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {!isPrimaryPane ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 z-20 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center bg-white text-[#a1a4a9] opacity-0 transition duration-150 group-hover/pane-header:opacity-100 hover:text-[#25272b]"
          onClick={(event) => {
            event.stopPropagation();
            onClosePane(paneId);
          }}
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function EditorLeafView({
  leaf,
  primaryPaneId,
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
  onClosePane,
  onToggleSidebar,
  isSidebarPinned,
  aiContext
}: {
  leaf: EditorLeafNode;
  primaryPaneId: string | null;
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
  onAddEditor: (paneId?: string | null) => void;
  onClosePane: (paneId: string) => void;
  onToggleSidebar: () => void;
  isSidebarPinned: boolean;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
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
  const isPrimaryPane = normalizedLeaf.id === primaryPaneId;

  const [{ isOverCurrent, canDrop }, drop] = useDrop<WorkbenchDropItem, void, { isOverCurrent: boolean; canDrop: boolean }>(
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
      className="workspace-card-in relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-[#e8e7e2] bg-white"
      onMouseDown={() => onActivatePane(normalizedLeaf.id)}
      data-workbench-pane-id={normalizedLeaf.id}
    >
      <DropHint placement={dropPlacement} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeEditor ? (
          <div className="flex h-full min-h-0 flex-col">
            <PaneTitleBar
              paneId={normalizedLeaf.id}
              editors={leafEditors}
              activeEditor={activeEditor}
              isPrimaryPane={isPrimaryPane}
              resources={resources}
              workspaceId={workspaceId}
              documentStateByResourceId={documentStateByResourceId}
              onActivateEditor={onActivateEditor}
              onActivatePane={onActivatePane}
              onCloseEditor={onCloseEditor}
              onBindResource={onBindResource}
              onAddEditor={onAddEditor}
              onClosePane={onClosePane}
              onToggleSidebar={onToggleSidebar}
              isSidebarPinned={isSidebarPinned}
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
          <div className="flex h-full items-center justify-center bg-white text-sm text-[#777a80]">
            Drop a file here to open it in this pane.
          </div>
        )}
      </div>
    </section>
  );
}

function LayoutNodeView(props: {
  node: EditorLayoutNode;
  primaryPaneId: string | null;
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
  onAddEditor: (paneId?: string | null) => void;
  onClosePane: (paneId: string) => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  onToggleSidebar: () => void;
  isSidebarPinned: boolean;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
}) {
  const {
    node,
    primaryPaneId,
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
    onClosePane,
    onUpdateSplitRatio,
    onToggleSidebar,
    isSidebarPinned,
    aiContext
  } = props;

  if (node.type === 'leaf') {
    return (
        <EditorLeafView
          leaf={node}
          primaryPaneId={primaryPaneId}
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
        onClosePane={onClosePane}
        onToggleSidebar={onToggleSidebar}
        isSidebarPinned={isSidebarPinned}
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
        className={`${isRow ? 'h-full w-0 cursor-col-resize' : 'h-0 w-full cursor-row-resize'} relative z-20 shrink-0`}
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
      >
        <div
          className={`absolute bg-transparent transition-colors hover:bg-[#d9d9d4]/10 ${
            isRow ? '-left-[2px] top-0 h-full w-[4px]' : '-top-[2px] left-0 h-[4px] w-full'
          }`}
        >
          <div
            className={`absolute bg-[#e0dfda] ${
              isRow
                ? 'left-1/2 top-0 h-full w-px'
                : 'left-0 top-1/2 h-px w-full'
            }`}
          />
        </div>
      </div>

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
  onClosePane,
  onUpdateSplitRatio,
  onToggleSidebar,
  isSidebarPinned,
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
  const primaryPaneId = leafIds[0] ?? null;
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
        className="relative flex h-full items-center justify-center overflow-hidden border border-[#e8e7e2] bg-white px-8"
      >
        {isOverEmptyState && canDropEmptyState ? <DropHint placement="center" /> : null}
        <div className="workspace-soft-scale max-w-xl rounded-3xl border border-[#e5e5e1] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e5e5e1] bg-[#f6f6f4] text-[#777a80]">
            <Columns2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-[#25272b]">No tabs open</h2>
          <p className="mt-3 text-sm leading-6 text-[#777a80]">
            Open a resource from the explorer or drag a file here to start working.
          </p>
          <div className="mt-5 flex items-center justify-center">
            <button
              onClick={() => onAddEditor('pane-1')}
              className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#34373c] active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Add first tab
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-w-0 overflow-hidden bg-transparent">
      <LayoutNodeView
        node={normalizedLayout}
        primaryPaneId={primaryPaneId}
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
        onClosePane={onClosePane}
        onUpdateSplitRatio={onUpdateSplitRatio}
        onToggleSidebar={onToggleSidebar}
        isSidebarPinned={isSidebarPinned}
        aiContext={aiContext}
      />
    </div>
  );
}
