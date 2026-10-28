import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BUZZ_RESULT_MS, NEXT_ROUND_MS, START_COUNTDOWN_MS } from '../shared/game.js';
import type { HostAction, Question, Quiz } from '../shared/protocol.js';
import { GameEngine } from './engine.js';

const audio: Question = { id: 'one', type: 'audio', question: 'Listen', answer: 'SECRET', media: '/media/a.mp3' };
const image: Question = { id: 'one', type: 'image', question: 'Look', answer: 'SECRET', media: '/media/a.png',
  reveal: { effect: 'tiles', durationSeconds: 10, columns: 8, rows: 6, seed: 1 } };

function setup(question: Question, durations: Record<string, number> = {}, last = false) {
  let time = 0;
  const quiz: Quiz = { id: 1, title: 'Media', questions: [question, ...last ? [] : [
    { id: 'two', type: 'text' as const, question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
  ]] };
  const game = new GameEngine(quiz, () => time, undefined, durations);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const advance = (ms: number) => { time += ms; };
  send({ type: 'start' }); advance(START_COUNTDOWN_MS); game.tick();
  return { game, player, send, advance };
}

function correct(s: ReturnType<typeof setup>, elapsed = 0, lateHold = 0) {
  s.advance(elapsed); s.game.buzz(s.player.id); s.send({ type: 'judge', correct: true });
  s.advance(BUZZ_RESULT_MS + lateHold); s.game.tick();
}

test('known audio resumes only after the actual result tick, freezes points, clamps at end, and starts a full countdown', () => {
  const s = setup(audio, { '/media/a.mp3': 8 });
  correct(s, 2500, 9000);
  let state = s.game.snapshot();
  assert.equal(state.phase, 'MEDIA_FINISH');
  assert.equal(state.clueElapsedMs, 2500);
  assert.equal(state.displayElapsedMs, 2500);
  assert.equal(state.currentPoints, 500);
  assert.equal(state.mediaPositionSeconds, 2.5);
  assert.equal(state.mediaFinishRemainingMs, 5500);
  assert.equal(state.clockRunning, false);
  assert.equal(state.displayClockRunning, true);
  assert.equal(state.mediaFinishNeedsSkip, false);
  assert.equal(state.nextRoundCountdownMs, null);
  assert.doesNotMatch(JSON.stringify(state), /SECRET|FUTURE/);
  assert.throws(() => s.game.buzz(s.player.id), /not open/);
  assert.throws(() => s.send({ type: 'close' }), /media playback/);
  s.advance(5499); s.game.tick();
  state = s.game.snapshot();
  assert.equal(state.mediaFinishRemainingMs, 1);
  assert.equal(state.mediaPositionSeconds, 7.999);
  assert.equal(state.clueElapsedMs, 2500);
  s.advance(9001);
  assert.equal(s.game.snapshot().mediaPositionSeconds, 8);
  assert.equal(s.game.snapshot().displayClockRunning, false);
  s.game.tick();
  state = s.game.snapshot();
  assert.equal(state.phase, 'NEXT_ROUND');
  assert.equal(state.nextRoundCountdownMs, NEXT_ROUND_MS);
  assert.equal(state.mediaPositionSeconds, 8);
  assert.equal(state.displayElapsedMs, 8000);
  s.advance(1000);
  assert.equal(s.game.snapshot().mediaPositionSeconds, 8);
  s.advance(2000); s.game.tick();
  assert.equal(s.game.snapshot().clueElapsedMs, 0);
  assert.equal(s.game.snapshot().displayElapsedMs, 0);
});

test('clip endpoints use start, configured end and natural duration without guessing', () => {
  for (const [type, end, natural, buzz, expected] of [
    ['audio', 20, 8, 2, 4000], ['video', 6, 8, 2, 2000],
    ['video', 6, undefined, 2, 2000], ['audio', undefined, 8, 6, 0],
    ['video', 20, 2, 0, 0],
  ] as const) {
    const q: Question = { ...audio, type, playback: { startSeconds: 2, ...(end ? { endSeconds: end } : {}) } };
    const s = setup(q, natural ? { '/media/a.mp3': natural } : {});
    correct(s, buzz * 1000);
    assert.equal(s.game.snapshot().phase, expected ? 'MEDIA_FINISH' : 'NEXT_ROUND');
    if (expected) {
      assert.equal(s.game.snapshot().mediaFinishRemainingMs, expected);
      s.advance(expected); s.game.tick();
      assert.equal(s.game.snapshot().phase, 'NEXT_ROUND');
    }
  }
});

test('unknown audio/video stays indefinitely until an explicit host skip, even with invalid duration map entries', () => {
  for (const duration of [undefined, 0, NaN, Infinity, -1]) {
    const s = setup({ ...audio, type: 'video' }, duration === undefined ? {} : { '/media/a.mp3': duration });
    correct(s, 1000);
    s.advance(100000); s.game.tick();
    const state = s.game.snapshot();
    assert.equal(state.phase, 'MEDIA_FINISH');
    assert.equal(state.mediaFinishNeedsSkip, true);
    assert.equal(state.mediaFinishRemainingMs, null);
    assert.equal(state.clueElapsedMs, 1000);
    assert.equal(state.mediaPositionSeconds, 101);
    s.send({ type: 'skipMedia' });
    assert.equal(s.game.snapshot().phase, 'NEXT_ROUND');
    assert.equal(s.game.snapshot().nextRoundCountdownMs, NEXT_ROUND_MS);
    s.advance(5000); s.game.tick();
    assert.equal(s.game.snapshot().phase, 'QUESTION_OPEN');
    assert.throws(() => s.send({ type: 'skipMedia' }), /no finishing media/i);
  }
});

test('wrong media ruling keeps the old hold, lockout and point-clock behavior', () => {
  const s = setup(audio, { '/media/a.mp3': 8 });
  s.advance(2000); s.game.buzz(s.player.id);
  s.send({ type: 'judge', correct: false });
  s.advance(5000); s.game.tick();
  let state = s.game.snapshot();
  assert.equal(state.phase, 'QUESTION_OPEN');
  assert.equal(state.clueElapsedMs, 2000);
  assert.equal(state.mediaPositionSeconds, 2);
  assert.equal(state.displayClockRunning, true);
  assert.deepEqual(state.lockedOutIds, [s.player.id]);
  s.advance(1000);
  state = s.game.snapshot();
  assert.equal(state.clueElapsedMs, 3000);
  assert.equal(state.mediaPositionSeconds, 3);
  assert.equal(state.mediaFinishRemainingMs, null);
  assert.equal(state.mediaFinishNeedsSkip, false);
});

test('tile reveal honors media restart offset; text, static and finished tiles advance immediately', () => {
  const s = setup(image);
  s.advance(7000); s.send({ type: 'restartMedia' });
  correct(s, 2000);
  assert.equal(s.game.snapshot().phase, 'MEDIA_FINISH');
  assert.equal(s.game.snapshot().clueElapsedMs, 9000);
  assert.equal(s.game.snapshot().revealProgress, 0.2);
  assert.equal(s.game.snapshot().mediaFinishRemainingMs, 8000);
  s.advance(4000);
  assert.equal(s.game.snapshot().revealProgress, 0.6);
  assert.equal(s.game.snapshot().clueElapsedMs, 9000);
  s.advance(4000); s.game.tick();
  assert.equal(s.game.snapshot().revealProgress, 1);
  assert.equal(s.game.snapshot().phase, 'NEXT_ROUND');
  for (const q of [ { ...image, type: 'text' as const }, { ...image, reveal: { ...image.reveal!, effect: 'static' as const } }, image ]) {
    const other = setup(q, {}, true);
    correct(other, 10000);
    assert.equal(other.game.snapshot().phase, 'GAME_FINISHED');
  }
});

test('restart media, undo, reset, restart quiz and skip cancel or rearm finish timers correctly', () => {
  for (const action of ['undo', 'reset', 'restartQuiz', 'skipMedia'] as const) {
    const s = setup(audio, { '/media/a.mp3': 8 });
    correct(s, 3000);
    s.advance(2000);
    const version = s.game.snapshot().mediaVersion;
    s.send({ type: 'restartMedia' });
    assert.equal(s.game.snapshot().mediaVersion, version + 1);
    assert.equal(s.game.snapshot().mediaPositionSeconds, 0);
    assert.equal(s.game.snapshot().mediaFinishRemainingMs, 8000);
    s.advance(1000);
    s.send({ type: action });
    const expected = action === 'undo' ? 'ANSWERING' : action === 'reset' ? 'QUESTION_OPEN' : action === 'restartQuiz' ? 'LOBBY' : 'NEXT_ROUND';
    assert.equal(s.game.snapshot().phase, expected);
    if (action === 'undo') {
      assert.equal(s.player.score, 0);
      assert.equal(s.game.snapshot().clueElapsedMs, 3000);
      assert.equal(s.game.snapshot().mediaPositionSeconds, 3);
    }
    if (action === 'skipMedia') assert.equal(s.game.snapshot().mediaPositionSeconds, 1);
    s.advance(action === 'skipMedia' ? 1000 : 9000); s.game.tick();
    assert.equal(s.game.snapshot().phase, expected);
  }
});

test('undo after media ends restores the original frozen ruling and rejudging starts a fresh finish', () => {
  for (const last of [false, true]) {
    const s = setup(audio, { '/media/a.mp3': 5 }, last);
    correct(s, 2000);
    s.advance(3000); s.game.tick();
    assert.equal(s.game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
    s.send({ type: 'undo' });
    assert.equal(s.game.snapshot().phase, 'ANSWERING');
    assert.equal(s.game.snapshot().mediaPositionSeconds, 2);
    assert.equal(s.game.snapshot().displayElapsedMs, 2000);
    s.send({ type: 'judge', correct: true });
    s.advance(2000); s.game.tick();
    assert.equal(s.game.snapshot().mediaFinishRemainingMs, 3000);
  }
});