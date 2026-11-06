import type { PublicQuestion } from './protocol.js';

type Playback = NonNullable<PublicQuestion['playback']>;

export function playbackEnd(playback: Playback | undefined): number {
  return playback?.durationSeconds !== undefined
    ? (playback.startSeconds ?? 0) + playback.durationSeconds
    : playback?.endSeconds ?? Infinity;
}

export function audioLoopSegment(playback: Playback, elapsed: number, mediaDuration: number, finishAtBoundary = false) {
  if (!playback.loop || playback.durationSeconds === undefined) throw new Error('Looping audio requires a duration.');
  const start = playback.startSeconds ?? 0;
  const maximum = mediaDuration - start;
  if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('Audio duration must be greater than the playback start.');
  const initial = Math.min(playback.durationSeconds, maximum);
  const increase = playback.loop.increaseSeconds;
  const cappedAt = increase === 0 ? Infinity : Math.max(0, Math.ceil((maximum - initial) / increase));
  const total = (count: number) => {
    const growing = Math.min(count, cappedAt);
    return growing * initial + increase * growing * (growing - 1) / 2 + (count - growing) * maximum;
  };
  const time = Math.max(0, elapsed);
  const lookup = finishAtBoundary && time > 0 ? Math.max(0, time - 1e-9) : time;
  let low = 0;
  let high = Math.floor(lookup / initial) + 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (total(middle) <= lookup) low = middle;
    else high = middle;
  }
  const length = Math.min(maximum, initial + low * increase);
  const offset = Math.min(length, Math.max(0, time - total(low)));
  return { index: low, position: start + offset, end: start + length, remaining: Math.max(0, length - offset) };
}
