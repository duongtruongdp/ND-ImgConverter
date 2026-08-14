import { create } from 'zustand';
import { ImageItem } from '../types/conversion';

interface FileState {
  files: ImageItem[];
  selectedFileId: string | null;
  addFiles: (newFiles: ImageItem[]) => void;
  updateBatchFileInfo: (items: Array<{ path: string; width: number; height: number; size: number; thumbnail: string }>) => void;
  removeFile: (id: string) => void;
  clearFiles: () => void;
  selectFile: (id: string | null) => void;
  updateFileStatus: (
    id: string,
    status: ImageItem['status'],
    error?: string,
    output?: { path: string; size: number }
  ) => void;
}

export const useFileStore = create<FileState>((set) => ({
  files: [],
  selectedFileId: null,
  addFiles: (newFiles) =>
    set((state) => ({
      files: [
        ...state.files,
        ...newFiles.filter((nf) => !state.files.some((f) => f.path === nf.path)),
      ],
    })),
  updateBatchFileInfo: (items) =>
    set((state) => {
      const map = new Map(items.map((i) => [i.path, i]));
      return {
        files: state.files.map((f) => {
          const info = map.get(f.path);
          if (info) {
            return {
              ...f,
              width: info.width,
              height: info.height,
              size: info.size,
              thumbnail: info.thumbnail,
            };
          }
          return f;
        }),
      };
    }),
  removeFile: (id) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== id),
      selectedFileId: state.selectedFileId === id ? null : state.selectedFileId,
    })),
  clearFiles: () => set({ files: [], selectedFileId: null }),
  selectFile: (id) => set({ selectedFileId: id }),
  updateFileStatus: (id, status, error, output) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id
          ? {
              ...f,
              status,
              errorMessage: error,
              outputPath: output?.path || f.outputPath,
              outputSize: output?.size || f.outputSize,
            }
          : f
      ),
    })),
}));