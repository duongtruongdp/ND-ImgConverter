import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fitTimeline,
  isValidSelection,
  panTimeline,
  percentForTime,
  snapToFrame,
  timeFromPointer,
  zoomTimeline,
} from '../src/components/video/timeline.ts';

test('zoom keeps the anchor timestamp stable', () => {
  const zoomed = zoomTimeline(fitTimeline(900), 900, 2, 450);
  assert.deepEqual(zoomed, { start: 225, end: 675 });
});
test('zoom clamps at both source boundaries and supports long media', () => {
  assert.deepEqual(zoomTimeline(fitTimeline(900), 900, 4, 0), { start: 0, end: 225 });
  assert.deepEqual(zoomTimeline(fitTimeline(86_400), 86_400, 2, 86_400), { start: 43_200, end: 86_400 });
});

test('playhead-centered zoom preserves marker timestamps and coordinate precision', () => {
  const range = { start: 10, end: 20 };
  const zoomed = zoomTimeline(range, 90, 2, 15);
  assert.deepEqual(zoomed, { start: 12.5, end: 17.5 });
  assert.equal(percentForTime(13, zoomed), 10);
  assert.equal(percentForTime(17, zoomed), 90);
});

test('short media and repeated zoom-fit cycles remain bounded', () => {
  const short = fitTimeline(0.25);
  let range = short;
  for (let index = 0; index < 20; index += 1) range = zoomTimeline(range, 0.25, 2, 0.125);
  assert.ok(Math.abs((range.end - range.start) - 0.001) < 1e-9);
  assert.ok(Math.abs((range.start + range.end) / 2 - 0.125) < 1e-9);
  assert.deepEqual(fitTimeline(0.25), { start: 0, end: 0.25 });
});

test('pan clamps at both boundaries without changing visible span', () => {
  const range = { start: 20, end: 40 };
  assert.deepEqual(panTimeline(range, 60, -10_000, 1_000), { start: 0, end: 20 });
  assert.deepEqual(panTimeline(range, 60, 10_000, 1_000), { start: 40, end: 60 });
  assert.deepEqual(panTimeline(range, 60, 100, 1_000), { start: 22, end: 42 });
});

test('pointer mapping uses the visible range, not the full source duration', () => {
  assert.equal(timeFromPointer(50, { left: 0, width: 100 }, { start: 10, end: 20 }, 900), 15);
});

test('frame snapping and selection validation are deterministic', () => {
  assert.equal(snapToFrame(0.34, 30, 900), 1 / 3);
  assert.equal(isValidSelection(10, 13, 900), true);
  assert.equal(isValidSelection(13, 13, 900), false);
  assert.equal(isValidSelection(-1, 4, 900), false);
});
