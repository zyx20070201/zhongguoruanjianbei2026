import {
  Columns2,
  FileText,
  Globe,
  Plus,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import {
  EditorLayoutNode,
  EditorLeafNode,
  EditorState,
  ResourceReference
} from '../../types';
import { AiChatContext, AiChatMessage } from '../../services/aiApi';
import {
  collectLeafIds,
  createLeaf,
  findLeafById,
  normalizeLeaf,
  WorkbenchDropPlacement
} from '../../utils/workbenchLayout';
import WorkbenchEditorContent, { WorkbenchContextSelectionActionDetail } from './WorkbenchEditorContent';
import { getLanguageLabel } from './editorResource';

type WorkbenchEditorTabDragItem = { editorId: string; sourcePaneId: string };
type WorkbenchResourceDragItem = {
  type: 'WORKBENCH_RESOURCE';
  resourceId: string;
  resource: ResourceReference;
};
type DocumentStateByResourceId = Record<string, { content: string; savedContent: string; loading?: boolean }>;
type DocumentSaveStateByResourceId = Record<string, { status: 'idle' | 'saving' | 'saved' | 'error'; savedAt?: string; error?: string }>;

const EDITOR_TAB_ITEM_TYPE = 'WORKBENCH_EDITOR_TAB';
const WORKBENCH_RESOURCE_ITEM_TYPE = 'WORKBENCH_RESOURCE';

interface WorkbenchEditorProps {
  workspaceId: string;
  editors: EditorState[];
  activeEditorId: string | null;
  activePaneId: string | null;
  editorLayout: EditorLayoutNode | null | undefined;
  resources: ResourceReference[];
  documentStateByResourceId: DocumentStateByResourceId;
  documentSaveStateByResourceId?: DocumentSaveStateByResourceId;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string, anchorRect?: DOMRect | null) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onSaveDocumentContent?: (
    resourceId: string,
    content?: string,
    options?: { baseContentHash?: string | null; revisionSummary?: string; actionType?: string; actor?: string }
  ) => void | Promise<boolean | void>;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onInitializeLayout: (layout: EditorLayoutNode, paneId: string | null) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropResourceToPane: (
    resource: ResourceReference,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onAddEditor: (paneId?: string | null, anchorRect?: DOMRect | null) => void;
  onClosePane: (paneId: string) => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
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
  documentStateByResourceId: DocumentStateByResourceId;
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
      className={`group relative flex min-w-fit max-w-[260px] shrink-0 items-center p-1.5 transition select-none ${
        isActive ? 'text-gray-900' : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'
      } ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      <button
        type="button"
        aria-current={isActive ? 'page' : undefined}
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
        className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-0 transition duration-150 hover:bg-gray-100 hover:text-gray-900 group-hover:opacity-100"
            title="关闭标签页"
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
  onClosePane
}: {
  paneId: string;
  editors: EditorState[];
  activeEditor: EditorState;
  isPrimaryPane: boolean;
  resources: ResourceReference[];
  workspaceId: string;
  documentStateByResourceId: DocumentStateByResourceId;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onActivatePane: (paneId: string) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string, anchorRect?: DOMRect | null) => void;
  onAddEditor: (paneId?: string | null, anchorRect?: DOMRect | null) => void;
  onClosePane: (paneId: string) => void;
}) {
  return (
    <div className="group/pane-header relative z-10 flex h-11 items-center bg-white px-2 text-sm font-medium text-[#25272b]">
      <div className="flex min-w-0 flex-1 gap-1 scrollbar-none overflow-x-auto overflow-y-hidden w-fit text-center rounded-full bg-transparent py-1 touch-auto pointer-events-auto">
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
          onClick={(event) => {
            onActivatePane(paneId);
            onAddEditor(paneId, event.currentTarget.getBoundingClientRect());
          }}
          className="inline-flex min-w-fit shrink-0 items-center justify-center p-1.5 text-gray-300 transition hover:text-gray-700 dark:text-gray-600 dark:hover:text-white"
          title="新增空标签页"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {!isPrimaryPane ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 z-20 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-white text-gray-300 opacity-0 transition duration-150 hover:bg-gray-100 hover:text-gray-900 group-hover/pane-header:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onClosePane(paneId);
          }}
          title="关闭面板"
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
  documentSaveStateByResourceId,
  activeEditorId,
  onActivateEditor,
  onCloseEditor,
  onBindResource,
  onChangeDocumentContent,
  onSaveDocumentContent,
  onUpdateEditorViewState,
  onActivatePane,
  onDropEditorTab,
  onDropResourceToPane,
  onAddEditor,
  onClosePane,
  onAddSelectionAskToAssistant,
  aiContext
}: {
  leaf: EditorLeafNode;
  primaryPaneId: string | null;
  workspaceId: string;
  editors: EditorState[];
  resources: ResourceReference[];
  documentStateByResourceId: DocumentStateByResourceId;
  documentSaveStateByResourceId?: DocumentSaveStateByResourceId;
  activeEditorId: string | null;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string, anchorRect?: DOMRect | null) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onSaveDocumentContent?: (
    resourceId: string,
    content?: string,
    options?: { baseContentHash?: string | null; revisionSummary?: string; actionType?: string; actor?: string }
  ) => void | Promise<boolean | void>;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropResourceToPane: (
    resource: ResourceReference,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onAddEditor: (paneId?: string | null, anchorRect?: DOMRect | null) => void;
  onClosePane: (paneId: string) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
}) {
  const normalizedLeaf = normalizeLeaf(leaf);
  const [dropPlacement, setDropPlacement] = useState<WorkbenchDropPlacement | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const leafEditors = normalizedLeaf.editorIds
    .map((editorId) => editors.find((editor) => editor.id === editorId))
    .filter((editor): editor is EditorState => Boolean(editor));

  const activeEditor =
    leafEditors.find((editor) => editor.id === normalizedLeaf.activeEditorId) ??
    leafEditors.find((editor) => editor.id === activeEditorId) ??
    leafEditors[0] ??
    null;
  const isPrimaryPane = normalizedLeaf.id === primaryPaneId;

  const [{ isOverCurrent, canDrop }, drop] = useDrop<
    WorkbenchEditorTabDragItem | WorkbenchResourceDragItem,
    void,
    { isOverCurrent: boolean; canDrop: boolean }
  >(
    () => ({
      accept: [EDITOR_TAB_ITEM_TYPE, WORKBENCH_RESOURCE_ITEM_TYPE],
      canDrop: (item) =>
        'editorId' in item ? Boolean(item.editorId) : Boolean(item.resource?.id),
      hover: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) return;

        const element = paneRef.current;
        const point = monitor.getClientOffset();
        if (!element || !point) {
          setDropPlacement(null);
          return;
        }

        setDropPlacement(getDropPlacement(point, element));
      },
      drop: (item, monitor) => {
        if (monitor.didDrop()) return;

        const element = paneRef.current;
        const point = monitor.getClientOffset();
        if (!element || !point) return;

        const placement = getDropPlacement(point, element);

        if ('editorId' in item) {
          onDropEditorTab(item.editorId, item.sourcePaneId, normalizedLeaf.id, placement);
          return;
        }
        onDropResourceToPane(item.resource, normalizedLeaf.id, placement);
      },
      collect: (monitor) => ({
        isOverCurrent: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop()
      })
    }),
    [normalizedLeaf.id, onDropEditorTab, onDropResourceToPane]
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
            />
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {leafEditors.map((editor) => {
                const resource = getBoundResource(editor, resources);
                const resourceState = editor.resourceId ? documentStateByResourceId[editor.resourceId] : undefined;
                return (
                  <div
                    key={editor.id}
                    className={`absolute inset-0 min-h-0 ${editor.id === activeEditor.id ? 'block' : 'hidden'}`}
                    aria-hidden={editor.id === activeEditor.id ? undefined : true}
                  >
                    <WorkbenchEditorContent
                      editor={editor}
                      resource={resource}
                      workspaceId={workspaceId}
                      content={editor.resourceId ? resourceState?.content ?? '' : ''}
                      isDirty={Boolean(resourceState && resourceState.content !== resourceState.savedContent)}
                      saveStatus={editor.resourceId ? documentSaveStateByResourceId?.[editor.resourceId]?.status : undefined}
                      savedAt={editor.resourceId ? documentSaveStateByResourceId?.[editor.resourceId]?.savedAt : undefined}
                      saveError={editor.resourceId ? documentSaveStateByResourceId?.[editor.resourceId]?.error : undefined}
                      isLoading={Boolean(resourceState?.loading || (editor.resourceId && (editor.type === 'code' || editor.type === 'notes') && !resourceState))}
                      onChangeContent={onChangeDocumentContent}
                      onSaveContent={editor.resourceId ? (content?: string) => onSaveDocumentContent?.(editor.resourceId as string, content) : undefined}
                      onApplyAiNoteEdit={(resourceId, content, options) => onSaveDocumentContent?.(resourceId, content, options)}
                      onUpdateViewState={onUpdateEditorViewState}
                      onBindResource={onBindResource}
                      onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
                      aiContext={aiContext}
                      resources={resources}
                    />
                  </div>
                );
              })}
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
  documentStateByResourceId: DocumentStateByResourceId;
  documentSaveStateByResourceId?: DocumentSaveStateByResourceId;
  activeEditorId: string | null;
  onActivateEditor: (editorId: string, paneId?: string | null) => void;
  onCloseEditor: (editorId: string) => void;
  onBindResource: (editorId: string, anchorRect?: DOMRect | null) => void;
  onChangeDocumentContent: (resourceId: string, content: string) => void;
  onSaveDocumentContent?: (
    resourceId: string,
    content?: string,
    options?: { baseContentHash?: string | null; revisionSummary?: string; actionType?: string; actor?: string }
  ) => void | Promise<boolean | void>;
  onUpdateEditorViewState: (editorId: string, patch: Record<string, any>) => void;
  onActivatePane: (paneId: string) => void;
  onDropEditorTab: (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onDropResourceToPane: (
    resource: ResourceReference,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => void;
  onAddEditor: (paneId?: string | null, anchorRect?: DOMRect | null) => void;
  onClosePane: (paneId: string) => void;
  onUpdateSplitRatio: (splitId: string, ratio: number) => void;
  onAddSelectionAskToAssistant?: (messages: AiChatMessage[], detail: WorkbenchContextSelectionActionDetail) => void;
  aiContext?: AiChatContext & { activeFileContent?: string | null };
}) {
  const {
    node,
    primaryPaneId,
    workspaceId,
    editors,
    resources,
    documentStateByResourceId,
    documentSaveStateByResourceId,
    activeEditorId,
    onActivateEditor,
    onCloseEditor,
    onBindResource,
    onChangeDocumentContent,
    onSaveDocumentContent,
    onUpdateEditorViewState,
    onActivatePane,
    onDropEditorTab,
    onDropResourceToPane,
    onAddEditor,
    onClosePane,
    onUpdateSplitRatio,
    onAddSelectionAskToAssistant,
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
        documentSaveStateByResourceId={documentSaveStateByResourceId}
        activeEditorId={activeEditorId}
        onActivateEditor={onActivateEditor}
        onCloseEditor={onCloseEditor}
        onBindResource={onBindResource}
        onChangeDocumentContent={onChangeDocumentContent}
        onSaveDocumentContent={onSaveDocumentContent}
        onUpdateEditorViewState={onUpdateEditorViewState}
        onActivatePane={onActivatePane}
        onDropEditorTab={onDropEditorTab}
        onDropResourceToPane={onDropResourceToPane}
        onAddEditor={onAddEditor}
        onClosePane={onClosePane}
        onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        aiContext={aiContext}
      />
    );
  }

  const isRow = node.direction === 'row';
  const ratio = typeof node.ratio === 'number' ? node.ratio : 0.5;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draftRatioRef = useRef(ratio);
  const isResizingRef = useRef(false);
  const [draftRatio, setDraftRatio] = useState(ratio);

  useEffect(() => {
    if (isResizingRef.current) return;
    draftRatioRef.current = ratio;
    setDraftRatio(ratio);
  }, [ratio]);

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${isRow ? 'flex-row' : 'flex-col'}`}
    >
      <div
        style={isRow ? { width: `${draftRatio * 100}%` } : { height: `${draftRatio * 100}%` }}
        className="min-h-0 min-w-0 flex overflow-hidden"
      >
        <LayoutNodeView {...props} node={node.children[0]} />
      </div>

      <div
        className={`${isRow ? 'h-full w-0 cursor-col-resize' : 'h-0 w-full cursor-row-resize'} relative z-20 shrink-0`}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const element = containerRef.current;
          if (!element) return;
          isResizingRef.current = true;
          const rect = element.getBoundingClientRect();

          const onMove = (moveEvent: MouseEvent) => {
            const nextRatio = isRow
              ? (moveEvent.clientX - rect.left) / rect.width
              : (moveEvent.clientY - rect.top) / rect.height;
            const boundedRatio = Math.max(0.2, Math.min(0.8, nextRatio));
            draftRatioRef.current = boundedRatio;
            setDraftRatio(boundedRatio);
          };

          const onUp = () => {
            isResizingRef.current = false;
            onUpdateSplitRatio(node.id, draftRatioRef.current);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };

          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        <div
          className={`absolute bg-transparent transition-colors hover:bg-gray-50/30 ${
            isRow ? '-left-[2px] top-0 h-full w-[4px]' : '-top-[2px] left-0 h-[4px] w-full'
          }`}
        >
          <div
            className={`absolute bg-gray-50 ${
              isRow
                ? 'left-1/2 top-0 h-full w-px'
                : 'left-0 top-1/2 h-px w-full'
            }`}
          />
        </div>
      </div>

      <div
        style={isRow ? { width: `${(1 - draftRatio) * 100}%` } : { height: `${(1 - draftRatio) * 100}%` }}
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
  documentSaveStateByResourceId,
  onActivateEditor,
  onCloseEditor,
  onBindResource,
  onChangeDocumentContent,
  onSaveDocumentContent,
  onUpdateEditorViewState,
  onActivatePane,
  onInitializeLayout,
  onDropEditorTab,
  onDropResourceToPane,
  onAddEditor,
  onClosePane,
  onUpdateSplitRatio,
  onAddSelectionAskToAssistant,
  aiContext
}: WorkbenchEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!missingInit || !normalizedLayout) return;
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
  }, [editors, missingInit, normalizedLayout, onInitializeLayout, resolvedPaneId]);

  if (!normalizedLayout) {
    return (
      <div
        ref={(element) => {
          rootRef.current = element;
        }}
        className="relative flex h-full items-center justify-center overflow-hidden border border-[#e8e7e2] bg-white px-8"
      >
        <div className="workspace-soft-scale max-w-xl rounded-3xl border border-[#e5e5e1] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e5e5e1] bg-[#f6f6f4] text-[#777a80]">
            <Columns2 className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold text-[#25272b]">暂无打开的标签页</h2>
          <p className="mt-3 text-sm leading-6 text-[#777a80]">
            从工作区文件树中选择一个文件开始工作。
          </p>
          <div className="mt-5 flex items-center justify-center">
            <button
              onClick={(event) => onAddEditor('pane-1', event.currentTarget.getBoundingClientRect())}
              className="inline-flex items-center gap-2 rounded-full bg-[#202124] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#34373c] active:scale-95"
            >
              <Plus className="h-4 w-4" />
              新增第一个标签页
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
        documentSaveStateByResourceId={documentSaveStateByResourceId}
        activeEditorId={activeEditorId}
        onActivateEditor={onActivateEditor}
        onCloseEditor={onCloseEditor}
        onBindResource={onBindResource}
        onChangeDocumentContent={onChangeDocumentContent}
        onSaveDocumentContent={onSaveDocumentContent}
        onUpdateEditorViewState={onUpdateEditorViewState}
        onActivatePane={onActivatePane}
        onDropEditorTab={onDropEditorTab}
        onDropResourceToPane={onDropResourceToPane}
        onAddEditor={onAddEditor}
        onClosePane={onClosePane}
        onUpdateSplitRatio={onUpdateSplitRatio}
        onAddSelectionAskToAssistant={onAddSelectionAskToAssistant}
        aiContext={aiContext}
      />
    </div>
  );
}
