import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceCountdownSound, countdownDigit, initialCountdownSoundState, type CountdownPhase } from '../src/client/countdownSound.js';

test('digits match both visible countdowns at their exact boundaries', () => {
  for (const [phase, cases] of [
    ['STARTING', [[4000, 3], [3001, 3], [3000, 2], [2000, 1], [1001, 1], [1000, null], [1, null], [0, null]]],
    ['NEXT_ROUND', [[3000, 3], [2001, 3], [2000, 2], [1000, 1], [1, 1], [0, null]]],
  ] as [CountdownPhase, [number, number | null][]][]) {
    for (const [remaining, expected] of cases) assert.equal(countdownDigit(phase, remaining), expected);
  }
  for (const value of [null, -1, NaN, Infinity]) assert.equal(countdownDigit('NEXT_ROUND', value), null);
  assert.equal(countdownDigit(null, 3000), null);
});

test('rerenders, resyncs and StrictMode repetitions never repeat or replay skipped digits', () => {
  let state = initialCountdownSoundState;
  const step = (remaining: number) => {
    const result = advanceCountdownSound(state, { id: 'one', phase: 'NEXT_ROUND', remaining, enabled: true, connected: true });
    state = result.state;
    return result.play;
  };
  assert.equal(step(3000), 3);
  assert.equal(step(3000), null);
  assert.equal(step(2500), null);
  assert.equal(step(900), 1); // 2 was missed, not queued
  assert.equal(step(2000), null); // backwards resync
  assert.equal(step(3000), null);
  assert.equal(step(1), null);
  assert.equal(step(0), null);
  assert.equal(step(1000), null);
});

test('GO and zero prevent stale numbers and a new transition ID rearms the sound', () => {
  let state = initialCountdownSoundState;
  const step = (id: string | null, phase: CountdownPhase | null, remaining: number | null) => {
    const result = advanceCountdownSound(state, { id, phase, remaining, enabled: true, connected: true });
    state = result.state;
    return result.play;
  };
  assert.equal(step('start', 'STARTING', 4000), 3);
  assert.equal(step('start', 'STARTING', 1000), null);
  assert.equal(step('start', 'STARTING', 2000), null);
  assert.equal(step(null, null, null), null); // undo / end
  assert.equal(step('restart', 'STARTING', 4000), 3);
  assert.equal(step('next', 'NEXT_ROUND', 3000), 3);
  assert.equal(step('next', 'NEXT_ROUND', -1), null);
  assert.equal(step('next', 'NEXT_ROUND', 1000), null);
  assert.equal(step('after-undo', 'NEXT_ROUND', 3000), 3);
});

test('unavailable sound and disconnected digits are consumed, not replayed after enabling or reconnecting', () => {
  let state = initialCountdownSoundState;
  const step = (remaining: number, enabled: boolean, connected: boolean) => {
    const result = advanceCountdownSound(state, { id: 'one', phase: 'NEXT_ROUND', remaining, enabled, connected });
    state = result.state;
    return result.play;
  };
  assert.equal(step(3000, false, true), null);
  assert.equal(step(2800, true, true), null);
  assert.equal(step(2000, true, true), 2);
  assert.equal(step(2000, true, false), null);
  assert.equal(step(2000, true, true), null);
  assert.equal(step(1000, true, false), null);
  assert.equal(step(1000, true, true), null);
});

test('missing IDs, invalid remaining and non-countdown phases are silent', () => {
  const input = { id: null, phase: 'NEXT_ROUND' as const, remaining: 3000, enabled: true, connected: true };
  assert.equal(advanceCountdownSound(initialCountdownSoundState, input).play, null);
  assert.equal(advanceCountdownSound(initialCountdownSoundState, { ...input, id: 'a', phase: null }).play, null);
  assert.equal(advanceCountdownSound(initialCountdownSoundState, { ...input, id: 'a', remaining: NaN }).play, null);
});