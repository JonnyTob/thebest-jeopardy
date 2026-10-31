import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BUZZ_CORRECT_ANSWER_MS, NEXT_ROUND_MS, START_COUNTDOWN_MS } from '../shared/game.js';
import type { HostAction, Question, Quiz } from '../shared/protocol.js';
import { GameEngine } from './engine.js';

const audio: Question = { id: 'one', type: 'audio', mode: 'buzzer', question: 'Listen', answer: 'SECRET', media: '/media/a.mp3' };
const image: Question = { id: 'one', type: 'image', mode: 'buzzer', question: 'Look', answer: 'SECRET', media: '/media/a.png',
  reveal: { effect: 'tiles', durationSeconds: 10, columns: 8, rows: 6, seed: 1 } };

test('typed video keeps playing after submissions close and stops at its clip end', () => {
  for (const closeEarly of [false, true]) {
    let time = 0;
    const question: Question = { id: 'one', type: 'video', mode: 'typed', fixedPoints: 250,
      timerSeconds: 5, question: 'Watch', answer: 'SECRET', media: '/media/video.mp4' };
    const game = new GameEngine({ id: 1, title: 'Video', questions: [question] }, () => time,
      undefined, { '/media/video.mp4': 8 });
    game.join({ name: 'Alice', avatarId: 'fox' });
    const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
    send({ type: 'start' });
    time += START_COUNTDOWN_MS;
    game.tick();
    time += closeEarly ? 3000 : 5200;
    if (closeEarly) send({ type: 'close' });
    else game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    assert.equal(game.snapshot().displayClockRunning, true);
    assert.equal(game.snapshot().clueElapsedMs, closeEarly ? 3000 : 5000);
    assert.equal(game.snapshot().mediaPositionSeconds, closeEarly ? 3 : 5.2);
    time += closeEarly ? 5000 : 2800;
    game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    assert.equal(game.snapshot().displayClockRunning, false);
    assert.equal(game.snapshot().mediaPositionSeconds, 8);
  }
});

test('buzzer video keeps playing after the independent buzzing deadline', () => {
  for (const closeEarly of [false, true]) {
    let time = 0;
    const question: Question = { id: 'one', type: 'video', mode: 'buzzer',
      timerSeconds: 5, question: 'Watch', answer: 'SECRET', media: '/media/video.mp4' };
    const game = new GameEngine({ id: 1, title: 'Video', questions: [question] }, () => time,
      undefined, { '/media/video.mp4': 8 });
    const player = game.join({ name: 'Alice', avatarId: 'fox' });
    const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
    send({ type: 'start' });
    time += START_COUNTDOWN_MS;
    game.tick();
    time += closeEarly ? 3000 : 5200;
    if (closeEarly) send({ type: 'close' });
    else game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    assert.equal(game.snapshot().clueElapsedMs, closeEarly ? 3000 : 5000);
    assert.equal(game.snapshot().mediaPositionSeconds, closeEarly ? 3 : 5.2);
    assert.equal(game.snapshot().displayClockRunning, true);
    assert.throws(() => game.buzz(player.id), /not open/);
    time += closeEarly ? 5000 : 2800;
    game.tick();
    assert.equal(game.snapshot().displayClockRunning, false);
    assert.equal(game.snapshot().mediaPositionSeconds, 8);
  }
});

function setup(question: Question, durations: Record<string, number> = {}, last = false) {
  let time = 0;
  const quiz: Quiz = { id: 1, title: 'Media', questions: [question, ...last ? [] : [
    { id: 'two', type: 'text' as const, mode: 'buzzer' as const, question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
  ]] };
  const game = new GameEngine(quiz, () => time, undefined, durations);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const advance = (ms: number) => { time += ms; };
  send({ type: 'start' }); advance(START_COUNTDOWN_MS); game.tick();
  return { game, player, send, advance };
}

test('correct answer pauses video, audio and tile reveal for three seconds, then resumes to the endpoint', () => {
  for (const [question, durations, remaining] of [
    [audio, { '/media/a.mp3': 8 }, 7000],
    [{ ...audio, type: 'video' as const }, { '/media/a.mp3': 8 }, 7000],
    [image, {}, 9000],
    [{ ...audio, type: 'text' as const }, {}, 0],
  ] as const) {
    const s = setup(question, durations);
    s.advance(1000);
    s.game.buzz(s.player.id);
    s.send({ type: 'judge', correct: true });
    assert.equal(s.game.snapshot().phase, 'BUZZ_RESULT');
    assert.equal(s.game.snapshot().revealedAnswer, 'SECRET');
    assert.equal(s.game.snapshot().buzzResult?.remainingMs, BUZZ_CORRECT_ANSWER_MS);
    assert.equal(s.game.snapshot().mediaFinishRemainingMs, null);
    assert.equal(s.game.snapshot().displayClockRunning, false);
    assert.equal(s.player.score, 500);
    s.advance(BUZZ_CORRECT_ANSWER_MS - 1);
    s.game.tick();
    assert.equal(s.game.snapshot().phase, 'BUZZ_RESULT');
    s.advance(1);
    s.game.tick();
    assert.equal(s.game.snapshot().phase, remaining ? 'MEDIA_FINISH' : 'NEXT_ROUND');
    assert.equal(s.game.snapshot().revealedAnswer, null);
    if (remaining) {
      assert.equal(s.game.snapshot().mediaFinishRemainingMs, remaining);
      assert.equal(s.game.snapshot().mediaPositionSeconds, 1);
      assert.equal(s.game.snapshot().displayClockRunning, true);
      s.advance(remaining);
      s.game.tick();
    }
    assert.equal(s.game.snapshot().phase, 'NEXT_ROUND');
    assert.equal(s.game.snapshot().nextRoundCountdownMs, NEXT_ROUND_MS);
  }
});

test('unknown video duration waits for host skip after the three-second answer pause', () => {
  const s = setup({ ...audio, type: 'video' }, {});
  s.game.buzz(s.player.id);
  s.send({ type: 'judge', correct: true });
  s.advance(BUZZ_CORRECT_ANSWER_MS);
  s.game.tick();
  assert.equal(s.game.snapshot().phase, 'MEDIA_FINISH');
  assert.equal(s.game.snapshot().mediaFinishNeedsSkip, true);
  s.send({ type: 'skipMedia' });
  assert.equal(s.game.snapshot().phase, 'NEXT_ROUND');
});

test('correct buzzer answer on the last question finishes after playback', () => {
  const s = setup(audio, { '/media/a.mp3': 5 }, true);
  s.game.buzz(s.player.id);
  s.send({ type: 'judge', correct: true });
  s.advance(BUZZ_CORRECT_ANSWER_MS);
  s.game.tick();
  assert.equal(s.game.snapshot().phase, 'MEDIA_FINISH');
  s.advance(5000);
  s.game.tick();
  assert.equal(s.game.snapshot().phase, 'GAME_FINISHED');
  assert.equal(s.game.snapshot().nextRoundCountdownMs, null);
});

test('undo during or after the correct answer hold restores the frozen ruling', () => {
  for (const after of [false, true]) {
    const s = setup(audio, { '/media/a.mp3': 8 });
    s.advance(2000);
    s.game.buzz(s.player.id);
    s.send({ type: 'judge', correct: true });
    if (after) { s.advance(BUZZ_CORRECT_ANSWER_MS); s.game.tick(); }
    s.send({ type: 'undo' });
    assert.equal(s.game.snapshot().phase, 'ANSWERING');
    assert.equal(s.game.snapshot().revealedAnswer, null);
    assert.equal(s.game.snapshot().clueElapsedMs, 2000);
    assert.equal(s.player.score, 0);
    s.advance(10000); s.game.tick();
    assert.equal(s.game.snapshot().phase, 'ANSWERING');
  }
});
