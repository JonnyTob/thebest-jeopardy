import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioLoopSegment, playbackEnd } from '../../src/shared/playback.js';

test('audio loops grow from the same start and cap at the file end', () => {
  const playback = { startSeconds: 15, durationSeconds: 8, loop: { increaseSeconds: 2 } };
  for (const [elapsed, index, position, end, remaining] of [
    [0, 0, 15, 23, 8], [7, 0, 22, 23, 1], [8, 1, 15, 25, 10],
    [17, 1, 24, 25, 1], [18, 2, 15, 27, 12], [30, 3, 15, 27, 12],
    [43, 4, 16, 27, 11],
  ]) {
    assert.deepEqual(audioLoopSegment(playback, elapsed, 27), { index, position, end, remaining });
  }
  assert.deepEqual(audioLoopSegment(playback, 18, 27, true), { index: 1, position: 25, end: 25, remaining: 0 });
});

test('equal-length and fractional loops seek correctly even after many iterations', () => {
  const fixed = { startSeconds: 2, durationSeconds: 0.5, loop: { increaseSeconds: 0 } };
  assert.deepEqual(audioLoopSegment(fixed, 1000.25, 4), { index: 2000, position: 2.25, end: 2.5, remaining: 0.25 });
  assert.deepEqual(audioLoopSegment({ ...fixed, durationSeconds: 4 }, 2, 4), { index: 1, position: 2, end: 4, remaining: 2 });
  assert.equal(playbackEnd({ startSeconds: 3, durationSeconds: 4 }), 7);
  assert.equal(playbackEnd({ startSeconds: 3, endSeconds: 7 }), 7);
});
