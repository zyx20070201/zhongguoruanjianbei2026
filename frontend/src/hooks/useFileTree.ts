import { useEffect, useCallback } from 'react';
import { useFileTreeStore } from '../store/fileTreeStore';
import { fileSystemApi } from '../services/fileSystemApi';

export const useFileTree = (workspaceId: string | undefined) => {
  const { setFiles, setLoading, setError, files, loading, error } = useFileTreeStore();

  const fetchTree = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await fileSystemApi.getTree(workspaceId);
      setFiles(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch file tree');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, setFiles, setLoading, setError]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  return {
    files,
    loading,
    error,
    refresh: fetchTree
  };
};
