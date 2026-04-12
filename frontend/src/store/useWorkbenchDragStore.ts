import { create } from 'zustand';
import { FileSystemObject } from '../types';

interface WorkbenchDragState {
  draggedFile: FileSystemObject | null;
  isDragging: boolean;
  pointer: { x: number; y: number } | null;
  startDragging: (file: FileSystemObject, pointer: { x: number; y: number }) => void;
  updatePointer: (pointer: { x: number; y: number }) => void;
  endDragging: () => void;
}

export const useWorkbenchDragStore = create<WorkbenchDragState>((set) => ({
  draggedFile: null,
  isDragging: false,
  pointer: null,
  startDragging: (file, pointer) =>
    set({
      draggedFile: file,
      isDragging: true,
      pointer
    }),
  updatePointer: (pointer) =>
    set((state) =>
      state.isDragging
        ? {
            pointer
          }
        : state
    ),
  endDragging: () =>
    set({
      draggedFile: null,
      isDragging: false,
      pointer: null
    })
}));
