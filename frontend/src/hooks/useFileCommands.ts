import { useCallback } from 'react';
import { fileSystemApi } from '../services/fileSystemApi';
import { useFileTreeStore } from '../store/fileTreeStore';

type FileCommandOptions = {
  resourceMode?: boolean;
  workbenchId?: string;
  resourceRole?: string;
  scope?: string;
};

export const useFileCommands = (workspaceId: string | undefined, commandOptions: FileCommandOptions = {}) => {
  const { setFiles, setSelectedNodeId, setRevealNodeId, setExpanded } = useFileTreeStore();

  const refreshTree = useCallback(async () => {
    if (!workspaceId) return;
    const data = commandOptions.resourceMode
      ? await fileSystemApi.getResources(workspaceId, {
          workbenchId: commandOptions.workbenchId,
          role: commandOptions.resourceRole === 'workspace' ? 'file' : commandOptions.resourceRole,
          scope: commandOptions.scope || (commandOptions.workbenchId ? 'all' : 'workspace')
        })
      : await fileSystemApi.getTree(workspaceId);
    setFiles(data);
  }, [workspaceId, commandOptions.resourceMode, commandOptions.workbenchId, commandOptions.resourceRole, commandOptions.scope, setFiles]);

  const revealNode = useCallback((files: any[], nodeId?: string) => {
    if (!nodeId) return;
    const node = files.find((item) => item.id === nodeId);
    if (!node) return;

    setSelectedNodeId(nodeId);
    setRevealNodeId(nodeId);

    let parentId = node.parentId;
    while (parentId) {
      setExpanded(parentId, true);
      const parent = files.find((item) => item.id === parentId);
      parentId = parent?.parentId;
    }
  }, [setExpanded, setRevealNodeId, setSelectedNodeId]);

  const createFolder = useCallback(async (name: string, parentId?: string, parentPath?: string) => {
    if (!workspaceId) return;
    const created = await fileSystemApi.createFolder(workspaceId, {
      name,
      parentId,
      parentPath,
      workbenchId: commandOptions.workbenchId,
      resourceRole: commandOptions.resourceRole,
      scope: commandOptions.scope
    });
    const data = commandOptions.resourceMode
      ? await fileSystemApi.getResources(workspaceId, { workbenchId: commandOptions.workbenchId, role: commandOptions.resourceRole, scope: commandOptions.scope || 'all' })
      : await fileSystemApi.getTree(workspaceId);
    setFiles(data);
    revealNode(data, created.id);
  }, [workspaceId, commandOptions.workbenchId, commandOptions.resourceRole, commandOptions.scope, commandOptions.resourceMode, revealNode, setFiles]);

  const createFile = useCallback(async (
    name: string,
    parentId?: string,
    parentPath?: string,
    options?: { content?: string; fileCategory?: string; resourceRole?: string; resourceType?: string; scope?: string; origin?: string }
  ) => {
    if (!workspaceId) return;
    const created = await fileSystemApi.createFile(workspaceId, {
      name,
      parentId,
      parentPath,
      content: options?.content,
      fileCategory: options?.fileCategory,
      workbenchId: commandOptions.workbenchId,
      resourceRole: options?.resourceRole || commandOptions.resourceRole,
      resourceType: options?.resourceType,
      scope: options?.scope || commandOptions.scope,
      origin: options?.origin || 'user'
    });
    const data = commandOptions.resourceMode
      ? await fileSystemApi.getResources(workspaceId, { workbenchId: commandOptions.workbenchId, role: commandOptions.resourceRole, scope: commandOptions.scope || 'all' })
      : await fileSystemApi.getTree(workspaceId);
    setFiles(data);
    revealNode(data, created.id);
  }, [workspaceId, commandOptions.workbenchId, commandOptions.resourceRole, commandOptions.scope, commandOptions.resourceMode, revealNode, setFiles]);

  const renameNode = useCallback(async (id: string, newName: string) => {
    if (!workspaceId) return;
    await fileSystemApi.rename(workspaceId, { id, newName });
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const moveNode = useCallback(async (id: string, targetParentId?: string) => {
    if (!workspaceId) return;
    await fileSystemApi.move(workspaceId, { id, targetParentId });
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const updateTags = useCallback(async (id: string, tags: string[]) => {
    if (!workspaceId) return;
    await fileSystemApi.updateTags(workspaceId, { id, tags });
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const copyNode = useCallback(async (id: string, targetParentId?: string | null) => {
    if (!workspaceId) return;
    const copied = await fileSystemApi.copy(workspaceId, { id, targetParentId });
    const data = await fileSystemApi.getTree(workspaceId);
    setFiles(data);
    revealNode(data, copied.id);
  }, [workspaceId, revealNode, setFiles]);

  const deleteNode = useCallback(async (id: string) => {
    if (!workspaceId) return;
      await fileSystemApi.remove(workspaceId, id);
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const uploadFiles = useCallback(async (files: File[], parentId?: string, parentPath?: string) => {
    if (!workspaceId) return;
    const result = await fileSystemApi.upload(workspaceId, files, parentId, parentPath, {
      workbenchId: commandOptions.workbenchId,
      resourceRole: commandOptions.resourceRole,
      scope: commandOptions.scope,
      origin: 'upload'
    });
    const data = commandOptions.resourceMode
      ? await fileSystemApi.getResources(workspaceId, { workbenchId: commandOptions.workbenchId, role: commandOptions.resourceRole, scope: commandOptions.scope || 'all' })
      : await fileSystemApi.getTree(workspaceId);
    setFiles(data);
    const createdIds = Array.isArray(result)
      ? result
          .filter((item) => item?.success && item?.file?.id)
          .map((item) => item.file.id)
      : [];
    revealNode(data, createdIds[createdIds.length - 1]);
  }, [workspaceId, commandOptions.workbenchId, commandOptions.resourceRole, commandOptions.scope, commandOptions.resourceMode, revealNode, setFiles]);

  const importUrl = useCallback(async (
    input: { url: string; title?: string },
    parentId?: string,
    parentPath?: string
  ) => {
    if (!workspaceId) return;
    const result = await fileSystemApi.importUrl(workspaceId, {
      ...input,
      parentId,
      parentPath,
      workbenchId: commandOptions.workbenchId,
      resourceRole: 'source',
      resourceType: 'source',
      scope: commandOptions.scope,
      origin: 'web'
    });
    const data = commandOptions.resourceMode
      ? await fileSystemApi.getResources(workspaceId, { workbenchId: commandOptions.workbenchId, role: commandOptions.resourceRole || 'source', scope: commandOptions.scope || 'all' })
      : await fileSystemApi.getTree(workspaceId);
    setFiles(data);
    revealNode(data, result.file.id);
  }, [workspaceId, commandOptions.workbenchId, commandOptions.resourceRole, commandOptions.scope, commandOptions.resourceMode, revealNode, setFiles]);

  return {
    createFolder,
    createFile,
    renameNode,
    moveNode,
    updateTags,
    copyNode,
    deleteNode,
    uploadFiles,
    importUrl,
    refreshTree
  };
};
