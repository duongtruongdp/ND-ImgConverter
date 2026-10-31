export interface TimelineRange {
  start: number;
  end: number;
}

export const clampTime = (value: number, duration: number) =>
  Math.max(0, Math.min(Math.max(0, duration), Number.isFinite(value) ? value : 0));

export const normalizeRange = (range: TimelineRange, duration: number): TimelineRange => {
  const end = Math.max(0, duration);
  const start = clampTime(Math.min(range.start, range.end), end);
  return { start, end: clampTime(Math.max(range.start, range.end), end) };
};

export const fitTimeline = (duration: number): TimelineRange => ({ start: 0, end: Math.max(0, duration) });

/** Zoom the visible timeline around an anchor while keeping that timestamp stable. */
export const zoomTimeline = (
  range: TimelineRange,
  duration: number,
  factor: number,
  anchor = (range.start + range.end) / 2,
): TimelineRange => {
  const sourceDuration = Math.max(0, duration);
  if (sourceDuration === 0 || !Number.isFinite(factor) || factor <= 0) return fitTimeline(sourceDuration);

  const currentDuration = Math.max(0.001, range.end - range.start);
  const nextDuration = Math.max(0.001, Math.min(sourceDuration, currentDuration / factor));
  const safeAnchor = clampTime(anchor, sourceDuration);
  const anchorRatio = currentDuration === 0 ? 0.5 : (safeAnchor - range.start) / currentDuration;
  let start = safeAnchor - nextDuration * anchorRatio;
  start = Math.max(0, Math.min(sourceDuration - nextDuration, start));
  return { start, end: start + nextDuration };
};

/** Pan a visible range by pixels while preserving its duration and source boundaries. */
export const panTimeline = (
  range: TimelineRange,
  duration: number,
  deltaPixels: number,
  viewportWidth: number,
): TimelineRange => {
  const sourceDuration = Math.max(0, duration);
  if (sourceDuration === 0) return fitTimeline(sourceDuration);
  const span = Math.max(0.001, Math.min(sourceDuration, range.end - range.start));
  const seconds = (deltaPixels / Math.max(1, viewportWidth)) * span;
  const start = Math.max(0, Math.min(sourceDuration - span, range.start + seconds));
  return { start, end: start + span };
};

export const timeFromPointer = (
  clientX: number,
  rect: Pick<DOMRect, 'left' | 'width'>,
  range: TimelineRange,
  duration: number,
) => {
  if (rect.width <= 0) return clampTime(range.start, duration);
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return clampTime(range.start + ratio * (range.end - range.start), duration);
};

export const percentForTime = (value: number, range: TimelineRange) => {
  const span = Math.max(0.001, range.end - range.start);
  return Math.max(0, Math.min(100, ((value - range.start) / span) * 100));
};

export const frameStep = (fps?: number) => (fps && Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 30);

export const snapToFrame = (value: number, fps: number | undefined, duration: number) => {
  const step = frameStep(fps);
  return clampTime(Math.round(value / step) * step, duration);
};

export const isValidSelection = (inPoint: number, outPoint: number, duration: number) =>
  Number.isFinite(inPoint) && Number.isFinite(outPoint) && inPoint >= 0 && outPoint <= duration && outPoint > inPoint;
