import { invoke } from '@tauri-apps/api/core';

export const ENGINE_UPDATE_CHECK_STORAGE_KEY = 'nd-media-engine-update-check';
export const ENGINE_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 800;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

export type EngineAsset = {
  engine: string;
  packageId: string;
  version: string;
  channel: string;
  platform: string;
  architecture: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  publisher: string;
  minAppVersion: string;
  companions: string[];
  license: string;
  fileName: string;
};

export type UpdateCheckResult = {
  state: string;
  checkedAt?: string;
  manifestRevision?: number;
  installedVersions?: Record<string, string>;
  message: string;
  updates: EngineAsset[];
};

export type EngineUpdateCheckState = {
  lastAttemptAt: number;
  lastSuccessAt?: number;
  manifestRevision?: number;
  failureCount: number;
  lastState?: string;
  message?: string;
  availableUpdates?: EngineAsset[];
  installedVersions?: Record<string, string>;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type InvokeLike = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const fallbackStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const readEngineUpdateCheckState = (storage: StorageLike | null = fallbackStorage()): EngineUpdateCheckState | null => {
  try {
    const raw = storage?.getItem(ENGINE_UPDATE_CHECK_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<EngineUpdateCheckState>;
    if (!Number.isFinite(value.lastAttemptAt) || value.lastAttemptAt! <= 0) return null;
    return {
      lastAttemptAt: value.lastAttemptAt!,
      lastSuccessAt: Number.isFinite(value.lastSuccessAt) ? value.lastSuccessAt : undefined,
      manifestRevision: Number.isFinite(value.manifestRevision) ? value.manifestRevision : undefined,
      failureCount: Number.isFinite(value.failureCount) ? Math.max(0, value.failureCount!) : 0,
      lastState: typeof value.lastState === 'string' ? value.lastState : undefined,
      message: typeof value.message === 'string' ? value.message : undefined,
      availableUpdates: Array.isArray(value.availableUpdates) ? value.availableUpdates as EngineAsset[] : undefined,
      installedVersions: value.installedVersions && typeof value.installedVersions === 'object' ? value.installedVersions as Record<string, string> : undefined,
    };
  } catch {
    return null;
  }
};

const writeEngineUpdateCheckState = (state: EngineUpdateCheckState, storage: StorageLike | null = fallbackStorage()) => {
  try {
    storage?.setItem(ENGINE_UPDATE_CHECK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A missing or read-only webview storage must not block the app.
  }
};

export const automaticCheckDelay = (state: EngineUpdateCheckState | null, now = Date.now()) => {
  if (!state) return INITIAL_CHECK_DELAY_MS;
  const elapsed = Math.max(0, now - state.lastAttemptAt);
  if (state.lastState === 'failed') {
    const backoff = Math.min(ENGINE_UPDATE_CHECK_INTERVAL_MS, FAILURE_BACKOFF_MS * (2 ** Math.min(state.failureCount - 1, 5)));
    return Math.max(0, backoff - elapsed);
  }
  return Math.max(0, ENGINE_UPDATE_CHECK_INTERVAL_MS - elapsed);
};

export const isEngineUpdateDismissed = (revision: number | undefined, asset: EngineAsset, storage: StorageLike | null = fallbackStorage()) => {
  if (!revision) return false;
  try {
    return storage?.getItem(`nd-media-engine-update-dismissed:${revision}:${asset.engine}:${asset.version}`) === '1';
  } catch {
    return false;
  }
};

export const dismissEngineUpdate = (revision: number | undefined, asset: EngineAsset, storage: StorageLike | null = fallbackStorage()) => {
  if (!revision) return;
  try {
    storage?.setItem(`nd-media-engine-update-dismissed:${revision}:${asset.engine}:${asset.version}`, '1');
  } catch {
    // A missing or read-only webview storage must not block dismissal.
  }
};

let inFlight: Promise<UpdateCheckResult> | null = null;

export const checkEngineUpdatesNow = ({
  invokeImpl = invoke as InvokeLike,
  storage = fallbackStorage(),
  now = Date.now(),
}: {
  invokeImpl?: InvokeLike;
  storage?: StorageLike | null;
  now?: number;
} = {}) => {
  if (inFlight) return inFlight;
  const started = typeof performance === 'undefined' ? 0 : performance.now();
  const request = invokeImpl<UpdateCheckResult>('check_engine_updates')
    .then((result) => {
      const previous = readEngineUpdateCheckState(storage);
      const successful = result.state === 'upToDate' || result.state === 'updateAvailable';
      writeEngineUpdateCheckState({
        lastAttemptAt: now,
        lastSuccessAt: successful ? now : previous?.lastSuccessAt,
        manifestRevision: result.manifestRevision ?? previous?.manifestRevision,
        failureCount: result.state === 'failed' ? (previous?.failureCount || 0) + 1 : 0,
        lastState: result.state,
        message: result.message,
        availableUpdates: result.state === 'updateAvailable' ? result.updates : [],
        installedVersions: result.installedVersions,
      }, storage);
      const duration = typeof performance === 'undefined' ? 0 : performance.now() - started;
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug(`[engine-update] check completed in ${duration.toFixed(1)}ms (${result.state})`);
      }
      return result;
    })
    .catch((reason) => {
      const previous = readEngineUpdateCheckState(storage);
      writeEngineUpdateCheckState({
        lastAttemptAt: now,
        lastSuccessAt: previous?.lastSuccessAt,
        manifestRevision: previous?.manifestRevision,
        failureCount: (previous?.failureCount || 0) + 1,
        lastState: 'failed',
        message: String(reason),
        availableUpdates: [],
        installedVersions: previous?.installedVersions,
      }, storage);
      throw reason;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
};

export const resetInFlightEngineUpdateCheck = () => {
  inFlight = null;
};

export const startEngineUpdateAutoCheck = ({
  onResult,
  invokeImpl = invoke as InvokeLike,
  storage = fallbackStorage(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}: {
  onResult: (result: UpdateCheckResult) => void;
  invokeImpl?: InvokeLike;
  storage?: StorageLike | null;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) return;
    const delay = automaticCheckDelay(readEngineUpdateCheckState(storage));
    timer = setTimeoutImpl(() => {
      if (stopped) return;
      void checkEngineUpdatesNow({ invokeImpl, storage }).then(onResult).catch(() => undefined).finally(schedule);
    }, delay);
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeoutImpl(timer);
  };
};
