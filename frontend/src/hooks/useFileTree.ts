import { useEffect, useCallback, useState } from 'react';
import { useFileTreeStore } from '../store/fileTreeStore';
import { fileSystemApi } from '../services/fileSystemApi';
import { FileSystemObject } from '../types';

export const useFileTree = (
  workspaceId: string | undefined,
  options?: { resourceMode?: boolean; workbenchId?: string; role?: string; scope?: string }
) => {
  const { setFiles, setLoading, setError, files, loading, error } = useFileTreeStore();
  const [localFiles, setLocalFiles] = useState<FileSystemObject[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const isLocalResourceList = Boolean(options?.resourceMode);

  const fetchTree = useCallback(async () => {
    if (!workspaceId) return;
    if (isLocalResourceList) {
      setLocalLoading(true);
    } else {
      setLoading(true);
    }

    try {
      const data = isLocalResourceList
        ? await fileSystemApi.getResources(workspaceId, {
            workbenchId: options?.workbenchId,
            role: options?.role,
            scope: options?.scope || (options?.workbenchId ? 'all' : 'workspace')
          })
        : await fileSystemApi.getTree(workspaceId);

      if (isLocalResourceList) {
        setLocalFiles(data);
        setLocalError(null);
      } else {
        setFiles(data);
        setError(null);
      }
    } catch (err: any) {
      const message = err.message || 'Failed to fetch file tree';
      if (isLocalResourceList) {
        setLocalError(message);
      } else {
        setError(message);
      }
    } finally {
      if (isLocalResourceList) {
        setLocalLoading(false);
      } else {
        setLoading(false);
      }
    }
  }, [workspaceId, isLocalResourceList, options?.workbenchId, options?.role, options?.scope, setFiles, setLoading, setError]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return {
    files: isLocalResourceList ? localFiles : files,
    loading: isLocalResourceList ? localLoading : loading,
    error: isLocalResourceList ? localError : error,
    refresh: fetchTree
  };
};
