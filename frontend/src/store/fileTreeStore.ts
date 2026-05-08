import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemObject } from '../types';

interface FileTreeState {
  files: FileSystemObject[];
  loading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  revealNodeId: string | null;
  expandedNodeIds: Record<string, boolean>;
  
  setFiles: (files: FileSystemObject[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  setRevealNodeId: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  clearExpanded: () => void;
}

export const useFileTreeStore = create<FileTreeState>()(
  persist(
    (set) => ({
      files: [],
      loading: false,
      error: null,
      selectedNodeId: null,
      revealNodeId: null,
      expandedNodeIds: {},

      setFiles: (files) => set({ files }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setSelectedNodeId: (id) => set({ selectedNodeId: id }),
      setRevealNodeId: (id) => set({ revealNodeId: id }),
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
      clearExpanded: () => set({ expandedNodeIds: {} }),
    }),
    {
      name: 'pp1-file-tree-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        expandedNodeIds: state.expandedNodeIds,
      }),
    }
  )
);
