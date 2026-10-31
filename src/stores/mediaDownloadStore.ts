import { create } from 'zustand';

export type MediaJobStatus = 'queued' | 'interrupted' | 'analyzing' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type MediaJobKind = 'video' | 'gallery';

export type MediaDownloadJob = {
  id: string;
  kind: MediaJobKind;
  url: string;
  title: string;
  formatId?: string;
  audioAvailable?: boolean;
  maxHeight?: number | null;
  container?: string | null;
  playlist?: boolean;
  playlistItems?: string | null;
  selectedIndices?: number[];
  authBrowser?: string | null;
  outputDirectory?: string | null;
  status: MediaJobStatus;
  progress: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  completedItems?: number | null;
  totalItems?: number | null;
  detail?: string;
  outputPath?: string;
  error?: string;
  createdAt: number;
};

type MediaDownloadStore = {
  jobs: MediaDownloadJob[];
  add: (job: MediaDownloadJob) => void;
  update: (id: string, patch: Partial<MediaDownloadJob>) => void;
  remove: (id: string) => void;
  clearCompleted: () => void;
  retry: (id: string) => void;
};

const STORAGE_KEY = 'nd-image-converter-media-download-queue';
const STORAGE_VERSION = 1;
const ACTIVE_STATUSES = ['analyzing', 'downloading', 'processing'];
const ALL_STATUSES: MediaJobStatus[] = ['queued', 'interrupted', 'analyzing', 'downloading', 'processing', 'completed', 'failed', 'cancelled'];

const isValidJob = (value: unknown): value is MediaDownloadJob => {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<MediaDownloadJob>;
  return typeof job.id === 'string'
    && typeof job.url === 'string'
    && typeof job.title === 'string'
    && (job.kind === 'video' || job.kind === 'gallery')
    && typeof job.status === 'string'
    && ALL_STATUSES.includes(job.status as MediaJobStatus)
    && (job.progress == null || typeof job.progress === 'number')
    && typeof job.createdAt === 'number';
};

export const restoreMediaJobs = (value: unknown): MediaDownloadJob[] => {
  const storedJobs = Array.isArray(value) ? value : value && typeof value === 'object' && 'jobs' in value ? (value as { jobs?: unknown }).jobs : [];
  if (!Array.isArray(storedJobs)) return [];
  return storedJobs.filter(isValidJob).map((job): MediaDownloadJob => ACTIVE_STATUSES.includes(job.status)
    ? { ...job, status: 'interrupted', progress: null, error: 'Interrupted — ready to retry.' }
    : job).slice(-50);
};

const loadJobs = (): MediaDownloadJob[] => {
  try { return restoreMediaJobs(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return []; }
};

const persist = (jobs: MediaDownloadJob[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, jobs: jobs.slice(-50) })); } catch { /* Queue persistence is best effort. */ }
};

export const useMediaDownloadStore = create<MediaDownloadStore>((set) => ({
  jobs: loadJobs(),
  add: (job) => set((state) => { const jobs = [...state.jobs, job].slice(-50); persist(jobs); return { jobs }; }),
  update: (id, patch) => set((state) => { const jobs = state.jobs.map((job) => job.id === id ? { ...job, ...patch } : job); persist(jobs); return { jobs }; }),
  remove: (id) => set((state) => { const jobs = state.jobs.filter((job) => job.id !== id); persist(jobs); return { jobs }; }),
  clearCompleted: () => set((state) => { const jobs = state.jobs.filter((job) => job.status !== 'completed'); persist(jobs); return { jobs }; }),
  retry: (id) => set((state) => { const jobs = state.jobs.map((job): MediaDownloadJob => job.id === id ? { ...job, status: 'queued' as const, progress: 0, error: undefined, outputPath: undefined } : job); persist(jobs); return { jobs }; }),
}));
