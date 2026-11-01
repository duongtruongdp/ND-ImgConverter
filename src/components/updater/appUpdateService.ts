import {
  type AppUpdateChannel,
  type AppUpdateTarget,
  type GitHubRelease,
  type ReleaseUpdate,
  resolveReleaseUpdate,
} from './updateUtils.ts';

export const APP_UPDATE_CHANNEL_STORAGE_KEY = 'nd-image-converter-app-update-channel';
export const RELEASES_API = 'https://api.github.com/repos/duongtruongdp/ND-ImgConverter/releases?per_page=30';

export type AppUpdateCheckState = 'up-to-date' | 'update-available' | 'no-installer';

export type AppUpdateCheckResult = {
  state: AppUpdateCheckState;
  update: ReleaseUpdate | null;
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const fallbackStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const readAppUpdateChannel = (storage: StorageLike | null = fallbackStorage()): AppUpdateChannel => {
  try {
    return storage?.getItem(APP_UPDATE_CHANNEL_STORAGE_KEY) === 'beta' ? 'beta' : 'stable';
  } catch {
    return 'stable';
  }
};

export const writeAppUpdateChannel = (channel: AppUpdateChannel, storage: StorageLike | null = fallbackStorage()) => {
  try {
    storage?.setItem(APP_UPDATE_CHANNEL_STORAGE_KEY, channel);
  } catch {
    // A missing or read-only webview storage must not block About or updates.
  }
};

const parseReleasePayload = (payload: unknown): GitHubRelease[] => {
  if (!Array.isArray(payload)) throw new Error('GitHub returned malformed release metadata.');
  return payload as GitHubRelease[];
};

export const fetchReleases = async (fetchImpl: typeof fetch = fetch, signal?: AbortSignal) => {
  const response = await fetchImpl(RELEASES_API, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limit reached. Try again later.');
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  return parseReleasePayload(await response.json());
};

type InFlightCheck = {
  key: string;
  request: Promise<AppUpdateCheckResult>;
};

let inFlight: InFlightCheck | null = null;

export const checkAppUpdates = ({
  currentVersion,
  target,
  channel,
  fetchImpl = fetch,
}: {
  currentVersion: string;
  target: AppUpdateTarget;
  channel: AppUpdateChannel;
  fetchImpl?: typeof fetch;
}) => {
  const key = `${currentVersion}|${target}|${channel}`;
  if (inFlight?.key === key) return inFlight.request;
  const request = fetchReleases(fetchImpl)
    .then((releases) => {
      const update = resolveReleaseUpdate(releases, currentVersion, target, channel);
      return {
        state: update ? (update.installer ? 'update-available' : 'no-installer') : 'up-to-date',
        update,
      } as AppUpdateCheckResult;
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = null;
    });
  inFlight = { key, request };
  return request;
};

export const resetInFlightAppUpdateCheck = () => {
  inFlight = null;
};
