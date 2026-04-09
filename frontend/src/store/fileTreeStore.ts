import { create } from 'zustand';
import { FileSystemObject } from '../types';

interface FileTreeState {
  files: FileSystemObject[];
  loading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  expandedNodeIds: Record<string, boolean>;
  
  setFiles: (files: FileSystemObject[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
}

export const useFileTreeStore = create<FileTreeState>((set) => ({
  files: [],
  loading: false,
  error: null,
  selectedNodeId: null,
  expandedNodeIds: {},

  setFiles: (files) => set({ files }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  toggleExpanded: (id) => set((state) => ({
    expandedNodeIds: {
      ...state.expandedNodeIds,
      [id]: !state.expandedNodeIds[id]
    }
  })),
  setExpanded: (id, expanded) => set((state) => ({
    expandedNodeIds: {
      ...state.expandedNodeIds,
      [id]: expanded
    }
  })),
}));
