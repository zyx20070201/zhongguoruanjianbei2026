import { FolderOpen, PanelLeftOpen, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DndProvider, useDragDropManager } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  EditorLayoutNode,
  FileSystemObject,
  ResourceReference,
  Workbench,
  WorkbenchEditorType
} from '../types';
import { fileSystemApi } from '../services/fileSystemApi';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { workbenchApi } from '../services/workbenchApi';
import { CodeOpenMode, useAppPreferences } from '../appPreferences';
import { useTheme } from '../theme';
import WorkbenchTopBar from '../components/workbench/WorkbenchTopBar';
import ResourcePickerDialog from '../components/workbench/ResourcePickerDialog';
import WorkbenchSidebar from '../components/workbench/WorkbenchSidebar';
import WorkbenchEditor from '../components/workbench/WorkbenchEditor';
import CodeOpenModeDialog from '../components/workbench/CodeOpenModeDialog';
import WorkbenchSettingsDialog from '../components/workbench/WorkbenchSettingsDialog';
import { useFileTreeStore } from '../store/fileTreeStore';
import {
  canEditResource,
  getResourceKind
} from '../components/workbench/editorResource';
import {
  createLeaf,
  createPaneId,
  findLeafById,
  getResolvedLayout,
  mapLayoutTree,
  removeEditorFromLayout,
  updateLeafEditors,
  WorkbenchDropPlacement
} from '../utils/workbenchLayout';

const flattenTree = (nodes: FileSystemObject[]): FileSystemObject[] => {
  const items: FileSystemObject[] = [];

  const walk = (node: FileSystemObject) => {
    items.push(node);
    node.children?.forEach(walk);
  };

  nodes.forEach(walk);
  return items;
};

const flattenResources = (nodes: FileSystemObject[]): ResourceReference[] => {
  const items: ResourceReference[] = [];

  const walk = (node: FileSystemObject) => {
    items.push({
      id: node.id,
      name: node.name,
      path: node.path,
      type: node.nodeType === 'folder' ? 'folder' : node.fileCategory || node.extension || 'file',
      tags: node.tags,
      extension: node.extension,
      mimeType: node.mimeType,
      fileCategory: node.fileCategory,
      isBinary: node.isBinary
    });

    node.children?.forEach(walk);
  };

  nodes.forEach(walk);
  return items;
};

const getEditorTypeForResource = (resource: ResourceReference): WorkbenchEditorType => {
  const kind = getResourceKind(resource);
  if (kind === 'video') return 'video';
  if (kind === 'html') return 'resource';
  if (kind === 'markdown' || kind === 'note') return 'notes';
  if (kind === 'code' || kind === 'structured') return 'code';
  return 'resource';
};

type OpenResourceOptions =
  | { kind: 'tab'; paneId?: string | null; bindEditorId?: string | null }
  | { kind: 'split'; paneId: string | null; placement: WorkbenchDropPlacement };

interface PendingCodeOpenRequest {
  resource: ResourceReference;
  options: OpenResourceOptions;
}

interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: typeof Search;
  run: () => void;
}

function WorkbenchPageContent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dndManager = useDragDropManager();
  const [searchParams, setSearchParams] = useSearchParams();
  const [resourcePickerEditorId, setResourcePickerEditorId] = useState<string | null>(null);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingCodeOpenRequest, setPendingCodeOpenRequest] = useState<PendingCodeOpenRequest | null>(
    null
  );
  const [commandQuery, setCommandQuery] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false);
  const sidebarPreviewCloseTimer = useRef<number | null>(null);
  const [workspaceWorkbenches, setWorkspaceWorkbenches] = useState<Workbench[]>([]);
  const [documentStateByResourceId, setDocumentStateByResourceId] = useState<
    Record<string, { content: string; savedContent: string; loading?: boolean }>
  >({});
  const { files } = useFileTreeStore();
  const { theme, setTheme } = useTheme();
  const {
    codeOpenMode,
    shouldPromptForCodeOpenMode,
    setCodeOpenMode,
    setShouldPromptForCodeOpenMode
  } = useAppPreferences();
  const {
    workbench,
    state,
    resources,
    loading,
    saveStatus,
    error,
    loadWorkbench,
    setResources,
    setWorkbenchMeta,
    addEditor,
    updateEditorViewState,
    updateWorkbenchState,
    activateEditor,
    closeEditor,
    bindResourceToEditor,
    saveNow,
    reset
  } = useWorkbenchStore();

  const openSidebarPreview = () => {
    if (sidebarPreviewCloseTimer.current) {
      window.clearTimeout(sidebarPreviewCloseTimer.current);
      sidebarPreviewCloseTimer.current = null;
    }
    setIsSidebarPreviewOpen(true);
  };

  const scheduleCloseSidebarPreview = () => {
    if (sidebarPreviewCloseTimer.current) {
      window.clearTimeout(sidebarPreviewCloseTimer.current);
    }
    sidebarPreviewCloseTimer.current = window.setTimeout(() => {
      setIsSidebarPreviewOpen(false);
      sidebarPreviewCloseTimer.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (sidebarPreviewCloseTimer.current) {
        window.clearTimeout(sidebarPreviewCloseTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!id) return;

    void loadWorkbench(id);

    return () => {
      reset();
    };
  }, [id, loadWorkbench, reset]);

  useEffect(() => {
    if (!workbench?.workspaceId) return;

    void fileSystemApi
      .getTree(workbench.workspaceId)
      .then((tree) => setResources(flattenResources(tree)))
      .catch((loadError) => {
        console.error('Failed to load workspace resources:', loadError);
      });
  }, [workbench?.workspaceId, setResources]);

  useEffect(() => {
    if (!workbench?.workspaceId) return;

    void workbenchApi
      .listByWorkspace(workbench.workspaceId)
      .then(setWorkspaceWorkbenches)
      .catch((loadError) => {
        console.error('Failed to load workspace workbenches:', loadError);
        setWorkspaceWorkbenches(workbench ? [workbench] : []);
      });
  }, [workbench]);

  useEffect(() => {
    if (files.length > 0) {
      setResources(flattenResources(files));
    }
  }, [files, setResources]);

  const resourceOptions = useMemo(
    () => resources.filter((resource) => resource.type !== 'folder'),
    [resources]
  );
  const flattenedFiles = useMemo(() => flattenTree(files), [files]);

  const resourceMap = useMemo(
    () => new Map(resourceOptions.map((resource) => [resource.id, resource])),
    [resourceOptions]
  );
  const activeEditor = useMemo(
    () => state?.editors.find((editor) => editor.id === state.activeEditorId) ?? null,
    [state]
  );
  const activeExternalContext = useMemo(() => {
    if (activeEditor?.type === 'external' && activeEditor.viewState?.externalResource) {
      return activeEditor.viewState.externalResource as {
        title: string;
        url: string;
        description?: string;
      };
    }

    return (
      state?.editors.find((editor) => editor.type === 'external' && editor.viewState?.externalResource)
        ?.viewState?.externalResource ?? null
    ) as { title: string; url: string; description?: string } | null;
  }, [activeEditor, state?.editors]);
  const preferredFileEditor = useMemo(() => {
    if (!state?.editors?.length) return null;

    const candidates = state.editors.filter((editor) => editor.resourceId);
    if (candidates.length === 0) return null;

    if (activeEditor?.resourceId) {
      return activeEditor;
    }

    return [...candidates].sort((left, right) => right.zIndex - left.zIndex)[0] ?? null;
  }, [activeEditor, state?.editors]);
  const activeFileContext = useMemo(() => {
    if (!preferredFileEditor?.resourceId) return null;
    const resource = resourceMap.get(preferredFileEditor.resourceId);
    return resource ? { id: resource.id, name: resource.name, path: resource.path } : null;
  }, [preferredFileEditor, resourceMap]);
  const activeFileContent = useMemo(() => {
    if (!preferredFileEditor?.resourceId) return null;
    return documentStateByResourceId[preferredFileEditor.resourceId]?.content ?? null;
  }, [documentStateByResourceId, preferredFileEditor]);
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(
    () => [
      {
        id: 'view.sidebar',
        title: 'View: Toggle Sidebar',
        subtitle: 'Pin or unpin the workbench sidebar',
        icon: PanelLeftOpen,
        run: () => setIsSidebarPinned((value) => !value)
      },
      {
        id: 'workbench.new-ai',
        title: 'Workbench: New AI Conversation',
        subtitle: 'Create a new AI editor in the current workbench',
        icon: Sparkles,
        run: () => {
          handleCreateAiPanel();
        }
      },
      {
        id: 'workbench.rename',
        title: 'Workbench: Rename',
        subtitle: 'Rename the current workbench',
        icon: FolderOpen,
        run: () => void handleRename()
      },
      {
        id: 'file.save-all',
        title: 'File: Save All',
        subtitle: 'Save open editable resources and workbench state',
        icon: FolderOpen,
        run: () => void handleSaveAllEditors()
      }
    ],
    []
  );
  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;

    return commandPaletteItems.filter((item) =>
      `${item.title} ${item.subtitle || ''}`.toLowerCase().includes(query)
    );
  }, [commandPaletteItems, commandQuery]);

  const openTextResourceIds = useMemo(
    () => [
      ...new Set(
        (state?.editors ?? [])
          .filter((editor) => editor.type === 'notes' || editor.type === 'code')
          .map((editor) => editor.resourceId)
          .filter((value): value is string => Boolean(value))
          .filter((resourceId) => {
            const resource = resourceMap.get(resourceId);
            return Boolean(resource && canEditResource(resource));
          })
      )
    ],
    [resourceMap, state?.editors]
  );

  useEffect(() => {
    if (!workbench?.workspaceId) return;

    openTextResourceIds.forEach((resourceId) => {
      if (documentStateByResourceId[resourceId]) return;

      setDocumentStateByResourceId((current) => ({
        ...current,
        [resourceId]: { content: '', savedContent: '', loading: true }
      }));

      void fileSystemApi
        .getContent(workbench.workspaceId, resourceId)
        .then((response) => {
          setDocumentStateByResourceId((current) => ({
            ...current,
            [resourceId]: {
              content: response.content ?? '',
              savedContent: response.content ?? '',
              loading: false
            }
          }));
        })
        .catch(() => {
          setDocumentStateByResourceId((current) => ({
            ...current,
            [resourceId]: {
              content: '',
              savedContent: '',
              loading: false
            }
          }));
        });
    });
  }, [documentStateByResourceId, openTextResourceIds, workbench?.workspaceId]);

  useEffect(() => {
    if (!state) return;

    const invalidResourceIds = (state.editors ?? [])
      .map((editor) => editor.resourceId)
      .filter((value): value is string => Boolean(value))
      .filter((resourceId) => !resourceMap.has(resourceId));

    if (invalidResourceIds.length === 0) return;

    setDocumentStateByResourceId((current) => {
      const next = { ...current };
      invalidResourceIds.forEach((resourceId) => {
        delete next[resourceId];
      });
      return next;
    });
  }, [resourceMap, state]);

  useEffect(() => {
    if (!state) return;
    if (state.editorLayout || state.editors.length === 0) return;

    const defaultPaneId = 'pane-1';
    updateWorkbenchState({
      editorLayout: createLeaf(
        defaultPaneId,
        state.editors.map((editor) => editor.id),
        state.activeEditorId ?? state.editors[0]?.id ?? null
      ),
      activeEditorPaneId: defaultPaneId
    });
  }, [state, updateWorkbenchState]);

  useEffect(() => {
    if (!state) return;

    const editorsNeedingMetadata = state.editors.filter(
      (editor) =>
        typeof editor.viewState.editorGroupId !== 'string' ||
        typeof editor.viewState.editorOrder !== 'number'
    );

    if (editorsNeedingMetadata.length === 0) return;

    editorsNeedingMetadata.forEach((editor, index) => {
      updateEditorViewState(editor.id, {
        editorGroupId:
          typeof editor.viewState.editorGroupId === 'string'
            ? editor.viewState.editorGroupId
            : 'group-1',
        editorOrder:
          typeof editor.viewState.editorOrder === 'number'
            ? editor.viewState.editorOrder
            : index
      });
    });
  }, [state, updateEditorViewState]);

  useEffect(() => {
    if (!state) return;

    const resourceId = searchParams.get('resourceId');
    if (!resourceId) return;

    const existingEditor = state.editors.find((editor) => editor.resourceId === resourceId);
    const resource = resources.find((item) => item.id === resourceId);

    if (existingEditor) {
      activateEditor(existingEditor.id);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('resourceId');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    if (resource) {
      requestOpenResource(resource, { kind: 'tab' });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('resourceId');
      setSearchParams(nextParams, { replace: true });
    }
  }, [activateEditor, resources, searchParams, setSearchParams, state]);

  const handleChangeDocumentContent = (resourceId: string, content: string) => {
    setDocumentStateByResourceId((current) => ({
      ...current,
      [resourceId]: {
        ...(current[resourceId] ?? { savedContent: '' }),
        content,
        loading: false
      }
    }));
  };

  const createEditorInitialViewState = (resource: ResourceReference, mode?: CodeOpenMode) => ({
    resourceName: resource.name,
    resourceType: resource.type,
    ...(mode ? { codeOpenMode: mode, blocksuiteMode: 'page' as const } : {})
  });

  const createEditorInstance = (
    resource: ResourceReference,
    mode?: CodeOpenMode
  ) => {
    const type = getEditorTypeForResource(resource);
    const index = state?.editors.length ?? 0;

    return {
      id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title: resource.name,
      resourceId: resource.id,
      resourcePath: resource.path,
      x: 48 + (index % 8) * 28,
      y: 48 + (index % 8) * 24,
      w: type === 'notes' ? 420 : 380,
      h: type === 'notes' ? 320 : 260,
      zIndex: (state?.editors.length ?? 0) + 1,
      minimized: false,
      viewState: createEditorInitialViewState(resource, mode)
    };
  };

  const commitOpenResource = (
    resource: ResourceReference,
    mode: CodeOpenMode | undefined,
    options: OpenResourceOptions
  ) => {
    const currentState = useWorkbenchStore.getState().state;
    if (!currentState) return;

    const existingEditor = currentState.editors.find((editor) => editor.resourceId === resource.id);
    if (existingEditor) {
      activateEditor(existingEditor.id, options.kind === 'split' ? options.paneId : options.paneId);
      if (mode && existingEditor.type === 'code') {
        updateEditorViewState(existingEditor.id, { codeOpenMode: mode });
      }
      return;
    }

    if (options.kind === 'tab' && options.bindEditorId) {
      bindResourceToEditor(options.bindEditorId, resource);
      updateEditorViewState(options.bindEditorId, createEditorInitialViewState(resource, mode));
      activateEditor(options.bindEditorId);
      setResourcePickerEditorId(null);
      return;
    }

    if (options.kind === 'split') {
      if (!state || !options.paneId || options.placement === 'center') {
        addEditor(
          getEditorTypeForResource(resource),
          resource,
          createEditorInitialViewState(resource, mode),
          options.paneId
        );
        return;
      }

      const baseLayout = getResolvedLayout(
        state.editorLayout,
        state.editors.map((editor) => editor.id),
        state.activeEditorId
      );
      if (!baseLayout) {
        addEditor(
          getEditorTypeForResource(resource),
          resource,
          createEditorInitialViewState(resource, mode)
        );
        return;
      }

      const targetLeaf = findLeafById(baseLayout, options.paneId);
      if (!targetLeaf) return;

      const newEditor = createEditorInstance(resource, mode);
      const nextPaneId = createPaneId();
      const isHorizontalSplit = options.placement === 'left' || options.placement === 'right';
      const nextLeaf = createLeaf(nextPaneId, [newEditor.id], newEditor.id);
      const currentLeaf = {
        ...targetLeaf,
        editorIds: targetLeaf.editorIds,
        activeEditorId: targetLeaf.activeEditorId ?? targetLeaf.editorIds[0] ?? null
      };

      const nextLayout = mapLayoutTree(baseLayout, options.paneId, () => ({
        id: `${options.paneId}-split-${options.placement}-${Date.now()}`,
        type: 'split',
        direction: isHorizontalSplit ? 'row' : 'column',
        ratio: 0.5,
        children:
          options.placement === 'left' || options.placement === 'top'
            ? [nextLeaf, currentLeaf]
            : [currentLeaf, nextLeaf]
      }));

      updateWorkbenchState({
        editors: [...state.editors, newEditor],
        editorLayout: nextLayout,
        activeEditorId: newEditor.id,
        activeEditorPaneId: nextPaneId
      });
      return;
    }

    addEditor(
      getEditorTypeForResource(resource),
      resource,
      createEditorInitialViewState(resource, mode),
      options.paneId
    );
  };

  const requestOpenResource = (resource: ResourceReference, options: OpenResourceOptions) => {
    const kind = getResourceKind(resource);
    const isCodeLike = kind === 'code' || kind === 'structured';

    if (isCodeLike && shouldPromptForCodeOpenMode) {
      setPendingCodeOpenRequest({ resource, options });
      return;
    }

    commitOpenResource(resource, isCodeLike ? codeOpenMode : undefined, options);
  };

  const handleOpenResourceInWorkbench = (file: FileSystemObject) => {
    if (file.nodeType !== 'file') return;

    const resource: ResourceReference = {
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.fileCategory || file.extension || 'file',
      extension: file.extension,
      mimeType: file.mimeType,
      fileCategory: file.fileCategory,
      isBinary: file.isBinary
    };

    const currentState = useWorkbenchStore.getState().state;
    if (!currentState) return;

    const existingEditor = currentState.editors.find((editor) => editor.resourceId === resource.id);
    if (existingEditor) {
      activateEditor(existingEditor.id);
      return;
    }

    if (resourcePickerEditorId) {
      requestOpenResource(resource, { kind: 'tab', bindEditorId: resourcePickerEditorId });
      return;
    }

    requestOpenResource(resource, { kind: 'tab' });
  };

  const getCreationTarget = () => {
    const selectedNodeId = useFileTreeStore.getState().selectedNodeId;
    const selectedNode = flattenedFiles.find((file) => file.id === selectedNodeId);
    if (!selectedNode) {
      return {
        parentId: undefined as string | undefined,
        parentPath: undefined as string | undefined
      };
    }

    if (selectedNode.nodeType === 'folder') {
      return { parentId: selectedNode.id, parentPath: selectedNode.path };
    }

    const parent = selectedNode.parentId
      ? flattenedFiles.find((file) => file.id === selectedNode.parentId)
      : undefined;

    return { parentId: selectedNode.parentId, parentPath: parent?.path };
  };

  const handleCreateNote = async () => {
    if (!workbench?.workspaceId) return;

    const defaultName = `note-${new Date().toISOString().slice(0, 10)}.md`;
    const name = prompt('Note file name', defaultName)?.trim();
    if (!name) return;

    const finalName = /\.[^./]+$/.test(name) ? name : `${name}.md`;
    const { parentId, parentPath } = getCreationTarget();

    try {
      const created = await fileSystemApi.createFile(workbench.workspaceId, {
        name: finalName,
        parentId,
        parentPath
      });
      const latestTree = await fileSystemApi.getTree(workbench.workspaceId);
      useFileTreeStore.getState().setFiles(latestTree);
      handleOpenResourceInWorkbench(created);
    } catch (createError) {
      console.error('Failed to create note:', createError);
    }
  };

  const handleUploadResources = () => {
    if (!workbench?.workspaceId) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (event) => {
      const selectedFiles = Array.from((event.target as HTMLInputElement).files || []);
      if (selectedFiles.length === 0) return;

      const { parentId, parentPath } = getCreationTarget();

      try {
        await fileSystemApi.upload(workbench.workspaceId, selectedFiles, parentId, parentPath);
        const latestTree = await fileSystemApi.getTree(workbench.workspaceId);
        useFileTreeStore.getState().setFiles(latestTree);
      } catch (uploadError) {
        console.error('Failed to upload resources:', uploadError);
      }
    };
    input.click();
  };

  const handleCreateAiPanel = () => {
    addEditor('ai', undefined, {
      messages: [],
      contextHint: 'workbench'
    });
  };

  const handleCreateExternalPanel = (draft?: {
    title?: string;
    url?: string;
    description?: string;
  }) => {
    const nextTitle =
      draft?.title?.trim() || prompt('External resource title', 'External Resource')?.trim();
    if (!nextTitle) return;

    const nextUrl = draft?.url?.trim() || prompt('External resource URL', 'https://')?.trim();
    if (!nextUrl) return;

    const nextDescription =
      typeof draft?.description === 'string'
        ? draft.description.trim()
        : prompt('Description (optional)', '')?.trim() || '';

    addEditor('external', undefined, {
      externalResource: {
        title: nextTitle,
        url: nextUrl,
        description: nextDescription
      }
    });
  };

  const handleDropResourceToEditor = (
    file: FileSystemObject,
    paneId: string | null,
    placement: WorkbenchDropPlacement
  ) => {
    if (!state || file.nodeType !== 'file') return;

    const resource: ResourceReference = {
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.fileCategory || file.extension || 'file',
      extension: file.extension,
      mimeType: file.mimeType,
      fileCategory: file.fileCategory,
      isBinary: file.isBinary
    };

    requestOpenResource(resource, { kind: 'split', paneId, placement });
  };

  const handleDropEditorTab = (
    editorId: string,
    sourcePaneId: string,
    targetPaneId: string,
    placement: WorkbenchDropPlacement
  ) => {
    if (!state) return;

    const baseLayout = getResolvedLayout(
      state.editorLayout,
      state.editors.map((editor) => editor.id),
      state.activeEditorId
    );
    if (!baseLayout) return;

    const sourceLeaf = findLeafById(baseLayout, sourcePaneId);
    if (!sourceLeaf || !sourceLeaf.editorIds.includes(editorId)) return;

    if (placement === 'center') {
      if (sourcePaneId === targetPaneId) {
        activateEditor(editorId, targetPaneId);
        return;
      }

      const compactLayout = removeEditorFromLayout(baseLayout, editorId);
      if (!compactLayout) return;

      const nextLayout = updateLeafEditors(compactLayout, targetPaneId, (leaf) => ({
        ...leaf,
        editorIds: leaf.editorIds.includes(editorId) ? leaf.editorIds : [...leaf.editorIds, editorId],
        activeEditorId: editorId
      }));

      updateWorkbenchState({
        editorLayout: nextLayout,
        activeEditorId: editorId,
        activeEditorPaneId: targetPaneId
      });
      return;
    }

    if (sourcePaneId === targetPaneId && sourceLeaf.editorIds.length <= 1) {
      activateEditor(editorId, targetPaneId);
      return;
    }

    const compactLayout = removeEditorFromLayout(baseLayout, editorId);
    if (!compactLayout) return;

    const targetLeaf = findLeafById(compactLayout, targetPaneId);
    if (!targetLeaf) return;

    const nextPaneId = createPaneId();
    const isHorizontalSplit = placement === 'left' || placement === 'right';
    const nextLeaf = createLeaf(nextPaneId, [editorId], editorId);
    const currentLeaf = {
      ...targetLeaf,
      editorIds: targetLeaf.editorIds,
      activeEditorId: targetLeaf.activeEditorId ?? targetLeaf.editorIds[0] ?? null
    };

    const nextLayout = mapLayoutTree(compactLayout, targetPaneId, () => ({
      id: `${targetPaneId}-split-${placement}-${Date.now()}`,
      type: 'split',
      direction: isHorizontalSplit ? 'row' : 'column',
      ratio: 0.5,
      children:
        placement === 'left' || placement === 'top'
          ? [nextLeaf, currentLeaf]
          : [currentLeaf, nextLeaf]
    }));

    updateWorkbenchState({
      editorLayout: nextLayout,
      activeEditorId: editorId,
      activeEditorPaneId: nextPaneId
    });
  };

  const handleSaveAllEditors = async () => {
    if (!workbench?.workspaceId) return;

    const dirtyEntries = Object.entries(documentStateByResourceId).filter(
      ([, value]) => value.content !== value.savedContent
    );

    for (const [resourceId, value] of dirtyEntries) {
      await fileSystemApi.saveContent(workbench.workspaceId, {
        id: resourceId,
        content: value.content
      });
    }

    if (dirtyEntries.length > 0) {
      setDocumentStateByResourceId((current) => {
        const next = { ...current };
        dirtyEntries.forEach(([resourceId]) => {
          next[resourceId] = {
            ...next[resourceId],
            savedContent: next[resourceId].content
          };
        });
        return next;
      });
    }

    await saveNow();
  };

  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.max(240, Math.min(520, startWidth + moveEvent.clientX - startX)));
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleRename = async () => {
    if (!workbench) return;

    const nextTitle = prompt('Workbench title', workbench.title);
    if (!nextTitle || nextTitle.trim() === workbench.title) return;

    try {
      const updated = await workbenchApi.update(workbench.id, { title: nextTitle.trim() });
      setWorkbenchMeta({ title: updated.title, description: updated.description });
    } catch (renameError) {
      console.error('Failed to rename workbench:', renameError);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isPaletteShortcut =
        (event.metaKey || event.ctrlKey) && ((event.shiftKey && key === 'p') || key === 'p');

      if (isPaletteShortcut) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }

      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#fbfbfa] p-8">
        <div className="workspace-card-in max-w-md rounded-3xl border border-[#e5e5e1] bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-[#25272b]">Unable to load workbench</h2>
          <p className="mt-2 text-sm text-[#777a80]">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 rounded-full border border-[#e5e5e1] bg-white px-4 py-2 text-sm font-medium text-[#34373c] transition-all duration-200 hover:bg-[#f6f6f4] active:scale-95"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (loading || !workbench || !state) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#fbfbfa]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#e5e5e1] border-t-[#202124]" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa] text-[#202124]">
      <WorkbenchTopBar
        workspaceId={workbench.workspaceId}
        title={workbench.title}
        onRename={handleRename}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleSidebar={() => setIsSidebarPinned((value) => !value)}
        onSidebarPreviewStart={() => {
          if (!isSidebarPinned) openSidebarPreview();
        }}
        onSidebarPreviewEnd={() => {
          if (!isSidebarPinned) scheduleCloseSidebarPreview();
        }}
        isSidebarPinned={isSidebarPinned}
        workbenches={workspaceWorkbenches}
      />

      {isCommandPaletteOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/20 pt-20 backdrop-blur-[3px]">
          <div className="workspace-soft-scale w-full max-w-2xl overflow-hidden rounded-3xl border border-[#e5e5e1] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
            <div className="flex items-center gap-3 border-b border-[#eeeeeb] px-5 py-4">
              <Search className="h-4 w-4 text-[#96999d]" />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Type a command"
                className="h-8 flex-1 border-0 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#a6a8ab]"
              />
              <span className="rounded-lg border border-[#e5e5e1] bg-[#f6f6f4] px-2 py-1 text-[10px] uppercase tracking-wide text-[#96999d]">
                Esc
              </span>
            </div>
            <div className="max-h-[420px] overflow-y-auto py-2">
              {filteredCommandItems.length === 0 ? (
                <div className="px-5 py-6 text-sm text-[#777a80]">No commands found.</div>
              ) : (
                filteredCommandItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setIsCommandPaletteOpen(false);
                        setCommandQuery('');
                        item.run();
                      }}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-[#f6f6f4]"
                    >
                      <div className="rounded-xl bg-[#f1f1ef] p-2 text-[#777a80]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[#25272b]">{item.title}</div>
                        {item.subtitle && (
                          <div className="truncate text-xs text-[#96999d]">{item.subtitle}</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="workspace-main relative flex min-h-0 flex-1 overflow-hidden bg-[#fbfbfa] p-3 pt-16">
        {isSidebarPinned ? (
          <div className="mr-3 min-h-0 shrink-0">
            <WorkbenchSidebar
              workspaceId={workbench.workspaceId}
              workbenchRootPath={workbench.rootPath}
              dndManager={dndManager}
              editors={state.editors}
              workbenches={workspaceWorkbenches}
              currentWorkbenchId={workbench.id}
              activeEditorId={state.activeEditorId}
              onActivateEditor={activateEditor}
              onFileOpen={handleOpenResourceInWorkbench}
              onNewChat={handleCreateAiPanel}
              onNewNote={() => void handleCreateNote()}
              onUploadResources={handleUploadResources}
              onSearch={() => {
                setCommandQuery('');
                setIsCommandPaletteOpen(true);
              }}
              onOpenWorkbench={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
              width={sidebarWidth}
              onResizeStart={handleSidebarResizeStart}
            />
          </div>
        ) : (
          <div
            className="group/sidebar absolute bottom-12 left-0 top-14 z-20 w-4"
            onMouseEnter={openSidebarPreview}
            onMouseLeave={scheduleCloseSidebarPreview}
          >
            <div
              className={`absolute left-0 top-0 h-full w-[min(420px,calc(100vw-40px))] transition-all duration-300 ease-out ${
                isSidebarPreviewOpen
                  ? 'pointer-events-auto translate-x-3 opacity-100'
                  : 'pointer-events-none -translate-x-[calc(100%-12px)] opacity-0 group-hover/sidebar:pointer-events-auto group-hover/sidebar:translate-x-3 group-hover/sidebar:opacity-100 group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:translate-x-3 group-focus-within/sidebar:opacity-100'
              }`}
              onMouseEnter={openSidebarPreview}
              onMouseLeave={scheduleCloseSidebarPreview}
            >
              <WorkbenchSidebar
                workspaceId={workbench.workspaceId}
                workbenchRootPath={workbench.rootPath}
                dndManager={dndManager}
                editors={state.editors}
                workbenches={workspaceWorkbenches}
                currentWorkbenchId={workbench.id}
                activeEditorId={state.activeEditorId}
                onActivateEditor={activateEditor}
                onFileOpen={handleOpenResourceInWorkbench}
                onNewChat={handleCreateAiPanel}
                onNewNote={() => void handleCreateNote()}
                onUploadResources={handleUploadResources}
                onSearch={() => {
                  setCommandQuery('');
                  setIsCommandPaletteOpen(true);
                }}
                onOpenWorkbench={(workbenchId) => navigate(`/workbenches/${workbenchId}`)}
                width={sidebarWidth}
                onResizeStart={handleSidebarResizeStart}
              />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 overflow-hidden">
          <WorkbenchEditor
            workspaceId={workbench.workspaceId}
            editors={state.editors}
            activeEditorId={state.activeEditorId}
            activePaneId={state.activeEditorPaneId ?? null}
            editorLayout={state.editorLayout ?? null}
            resources={resourceOptions}
            documentStateByResourceId={documentStateByResourceId}
            onActivateEditor={(editorId, paneId) => activateEditor(editorId, paneId)}
            onCloseEditor={closeEditor}
            onBindResource={(editorId) => setResourcePickerEditorId(editorId)}
            onChangeDocumentContent={handleChangeDocumentContent}
            onUpdateEditorViewState={updateEditorViewState}
            onActivatePane={(paneId) => updateWorkbenchState({ activeEditorPaneId: paneId })}
            onInitializeLayout={(layout, paneId) =>
              updateWorkbenchState({
                editorLayout: layout,
                activeEditorPaneId: paneId
              })
            }
            onDropResourceToPane={handleDropResourceToEditor}
            onDropEditorTab={handleDropEditorTab}
            onAddEditor={() => addEditor('notes')}
            onUpdateSplitRatio={(splitId, ratio) => {
              if (!state?.editorLayout) return;

              const updateRatio = (node: EditorLayoutNode): EditorLayoutNode => {
                if (node.type === 'leaf') return node;
                if (node.id === splitId) return { ...node, ratio };
                return {
                  ...node,
                  children: [updateRatio(node.children[0]), updateRatio(node.children[1])]
                };
              };

              updateWorkbenchState({
                editorLayout: updateRatio(state.editorLayout)
              });
            }}
            aiContext={{
              workbenchTitle: workbench.title,
              workbenchDescription: workbench.description,
              workbenchId: workbench.id,
              activeFile: activeFileContext,
              activeFileContent,
              activeExternal: activeExternalContext
            }}
          />
        </div>
      </div>

      <button
        onClick={handleCreateAiPanel}
        className="workspace-soft-scale absolute bottom-14 right-5 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#e5e5e1] bg-[#202124] text-white shadow-[0_18px_50px_rgba(0,0,0,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#34373c] active:scale-95"
        title="Open AI"
      >
        <Sparkles className="h-5 w-5" />
      </button>

      <ResourcePickerDialog
        open={Boolean(resourcePickerEditorId)}
        resources={resourceOptions}
        onClose={() => setResourcePickerEditorId(null)}
        onSelect={(resource) => {
          if (resourcePickerEditorId) {
            requestOpenResource(resource, { kind: 'tab', bindEditorId: resourcePickerEditorId });
          }
        }}
      />

      <CodeOpenModeDialog
        isOpen={Boolean(pendingCodeOpenRequest)}
        fileName={pendingCodeOpenRequest?.resource.name || 'Code file'}
        onClose={() => setPendingCodeOpenRequest(null)}
        onConfirm={(mode, rememberPreference) => {
          if (rememberPreference) {
            setCodeOpenMode(mode);
            setShouldPromptForCodeOpenMode(false);
          }

          if (pendingCodeOpenRequest) {
            commitOpenResource(pendingCodeOpenRequest.resource, mode, pendingCodeOpenRequest.options);
          }

          setPendingCodeOpenRequest(null);
        }}
      />

      <WorkbenchSettingsDialog
        isOpen={isSettingsOpen}
        theme={theme}
        codeOpenMode={codeOpenMode}
        shouldPromptForCodeOpenMode={shouldPromptForCodeOpenMode}
        onClose={() => setIsSettingsOpen(false)}
        onThemeChange={setTheme}
        onCodeOpenModeChange={setCodeOpenMode}
        onPromptPreferenceChange={setShouldPromptForCodeOpenMode}
      />

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-[#eeeeeb] bg-[#fbfbfa] px-5 text-[11px] text-[#96999d]">
        <div className="flex items-center gap-3">
          <span>{workbench.title}</span>
          <span>{state.editors.length} open</span>
          <span>{resourceOptions.length} files indexed</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Save error' : 'Ready'}</span>
          <span>{activeFileContext?.path || activeExternalContext?.title || 'Workbench'}</span>
        </div>
      </footer>
    </div>
  );
}

export default function WorkbenchPage() {
  return (
    <DndProvider backend={HTML5Backend}>
      <WorkbenchPageContent />
    </DndProvider>
  );
}
