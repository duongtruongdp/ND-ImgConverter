import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type GifQueueStatus = 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';

export interface GifQueueItem {
  id: string;
  sourcePath: string;
  sourceName: string;
  name: string;
  inPoint: number;
  outPoint: number;
  width: number;
  fps: number;
  quality: number;
  outputDirectory: string;
  status: GifQueueStatus;
  progress?: number;
  elapsedMs?: number;
  error?: string;
  outputPath?: string;
}

interface VideoGifState {
  queue: GifQueueItem[];
  add: (item: GifQueueItem) => void;
  update: (id: string, patch: Partial<GifQueueItem>) => void;
  remove: (id: string) => void;
  duplicate: (id: string, name: string) => void;
  clear: () => void;
}

export const useVideoGifStore = create<VideoGifState>()(
  persist(
    (set) => ({
      queue: [],
      add: (item) => set((state) => ({ queue: [...state.queue, item] })),
      update: (id, patch) => set((state) => ({
        queue: state.queue.map((item) => item.id === id ? { ...item, ...patch } : item),
      })),
      remove: (id) => set((state) => ({ queue: state.queue.filter((item) => item.id !== id) })),
      duplicate: (id, name) => set((state) => {
        const source = state.queue.find((item) => item.id === id);
        if (!source) return state;
        return {
          queue: [...state.queue, {
            ...source,
            id: crypto.randomUUID(),
            name,
            status: 'queued',
            error: undefined,
            outputPath: undefined,
          }],
        };
      }),
      clear: () => set({ queue: [] }),
    }),
    {
      name: 'nd-image-converter-video-gif-queue',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.queue = state.queue.map((item) => item.status === 'rendering'
          ? { ...item, status: 'queued', progress: 0, error: 'Previous rendering did not finish; review and render again.' }
          : item);
      },
    },
  ),
);
