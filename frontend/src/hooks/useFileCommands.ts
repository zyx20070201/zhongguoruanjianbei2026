import { useCallback } from 'react';
import { fileSystemApi } from '../services/fileSystemApi';
import { useFileTreeStore } from '../store/fileTreeStore';

export const useFileCommands = (workspaceId: string | undefined) => {
  const { setFiles } = useFileTreeStore();

  const refreshTree = useCallback(async () => {
    if (!workspaceId) return;
    const data = await fileSystemApi.getTree(workspaceId);
    setFiles(data);
  }, [workspaceId, setFiles]);

  const createFolder = useCallback(async (name: string, parentId?: string, parentPath?: string) => {
    if (!workspaceId) return;
    await fileSystemApi.createFolder(workspaceId, { name, parentId, parentPath });
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const createFile = useCallback(async (name: string, parentId?: string, parentPath?: string) => {
    if (!workspaceId) return;
    await fileSystemApi.createFile(workspaceId, { name, parentId, parentPath });
    await refreshTree();
  }, [workspaceId, refreshTree]);

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

  const deleteNode = useCallback(async (id: string) => {
    if (!workspaceId) return;
      await fileSystemApi.remove(workspaceId, id);
    await refreshTree();
  }, [workspaceId, refreshTree]);

  const uploadFiles = useCallback(async (files: File[], parentId?: string, parentPath?: string) => {
    if (!workspaceId) return;
    await fileSystemApi.upload(workspaceId, files, parentId, parentPath);
    await refreshTree();
  }, [workspaceId, refreshTree]);

  return {
    createFolder,
    createFile,
    renameNode,
    moveNode,
    deleteNode,
    uploadFiles,
    refreshTree
  };
};
