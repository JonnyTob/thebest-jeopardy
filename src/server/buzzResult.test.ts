import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BUZZ_RESULT_MS, NEXT_ROUND_MS, START_COUNTDOWN_MS } from '../shared/game.js';
import type { HostAction, Quiz } from '../shared/protocol.js';
import { GameEngine } from './engine.js';

const quiz: Quiz = { id: 1, title: 'Buzzer results', questions: [
  { id: 'one', type: 'text', question: 'First', answer: 'SECRET' },
  { id: 'two', type: 'text', mode: 'buzzer', question: 'Second', answer: 'SECRET TWO' },
] };

function setup(last = false, lockoutSeconds = 0) {
  let time = 0;
  const game = new GameEngine({ ...quiz, questions: last ? quiz.questions.slice(0, 1) : quiz.questions }, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  command({ type: 'setup', settings: { ...game.settings, lockoutSeconds } });
  command({ type: 'start' });
  time += START_COUNTDOWN_MS;
  game.tick();
  return { game, alice, bob, command, advance: (ms: number) => { time += ms; } };
}

test('correct result holds frozen public clue through the boundary, then starts a full countdown at the actual tick', () => {
  const { game, alice, bob, command, advance } = setup();
  advance(6000);
  game.buzz(alice.id);
  const before = game.snapshot();
  command({ type: 'judge', correct: true });
  const held = game.snapshot();
  assert.equal(held.phase, 'BUZZ_RESULT');
  assert.deepEqual(held.buzzResult, { id: held.buzzResult?.id, playerId: alice.id, correct: true, delta: 400, remainingMs: BUZZ_RESULT_MS });
  assert.ok(held.buzzResult?.id);
  assert.equal(alice.score, 400);
  assert.equal(held.reviewResultId, null);
  assert.equal(held.reviewRemainingMs, null);
  assert.equal(held.clockRunning, false);
  assert.equal(held.clueElapsedMs, before.clueElapsedMs);
  assert.equal(held.revealProgress, before.revealProgress);
  assert.equal(held.mediaPositionSeconds, before.mediaPositionSeconds);
  assert.equal(held.questionInstanceId, before.questionInstanceId);
  assert.equal(held.revealedAnswer, null);
  assert.deepEqual(game.snapshot(true).buzzResult, held.buzzResult);
  assert.deepEqual(game.snapshot(false, bob.id).buzzResult, held.buzzResult);
  assert.doesNotMatch(JSON.stringify(held), /SECRET/);
  const revision = game.revision;
  advance(BUZZ_RESULT_MS - 1);
  game.tick();
  assert.equal(game.revision, revision);
  assert.equal(game.snapshot().buzzResult?.remainingMs, 1);
  advance(9001);
  assert.equal(game.snapshot().buzzResult?.remainingMs, 0);
  assert.equal(game.snapshot().phase, 'BUZZ_RESULT');
  game.tick();
  assert.equal(game.revision, revision + 1);
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().buzzResult, null);
  assert.equal(game.snapshot().nextRoundCountdownMs, NEXT_ROUND_MS);
  assert.equal(game.snapshot().clueElapsedMs, 6000);
  advance(NEXT_ROUND_MS);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.notEqual(game.snapshot().questionInstanceId, before.questionInstanceId);
  assert.equal(game.snapshot().clueElapsedMs, 0);
});

test('wrong result holds the lockout until reopening, including a late tick', () => {
  const { game, alice, bob, command, advance } = setup(false, 1);
  advance(3500);
  game.buzz(alice.id);
  const instance = game.snapshot().questionInstanceId;
  command({ type: 'judge', correct: false });
  const result = game.snapshot().buzzResult!;
  assert.equal(result.delta, -500);
  assert.equal(alice.score, -500);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 1000);
  advance(1000);
  assert.deepEqual(game.snapshot().lockedOutIds, [alice.id]);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 1000);
  assert.throws(() => game.buzz(alice.id), /not open/);
  assert.throws(() => game.buzz(bob.id), /not open/);
  advance(9000);
  assert.equal(game.snapshot().clueElapsedMs, 3500);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().questionInstanceId, instance);
  assert.equal(game.snapshot().buzzResult, null);
  assert.equal(game.snapshot().clueElapsedMs, 3500);
  advance(1500);
  game.buzz(alice.id);
  assert.equal(game.snapshot().pointsAtBuzz, 400);
  command({ type: 'judge', correct: false });
  assert.notEqual(game.snapshot().buzzResult?.id, result.id);
});

test('previous timed and permanent lockouts survive holds, pauses, and undo without extending deadlines', () => {
  for (const seconds of [0, 10]) {
    const { game, alice, bob, command, advance } = setup(false, seconds);
    game.buzz(alice.id);
    command({ type: 'judge', correct: false });
    advance(2000);
    game.tick();
    command({ type: 'pause' });
    advance(1000);
    command({ type: 'resume' });
    game.buzz(bob.id);
    command({ type: 'judge', correct: false });
    assert.deepEqual(game.snapshot().lockedOutIds, [alice.id, bob.id]);
    if (seconds) assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 9000);
    advance(2500);
    game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
    assert.deepEqual(game.snapshot().lockedOutIds, [alice.id, bob.id]);
    command({ type: 'undo' });
    assert.equal(game.snapshot().phase, 'ANSWERING');
    assert.equal(game.snapshot().activePlayerId, bob.id);
    assert.deepEqual(game.snapshot().lockedOutIds, [alice.id]);
    if (seconds) assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 6500);
    else assert.deepEqual(game.snapshot().lockoutRemainingMs, {});
    command({ type: 'judge', correct: false });
    advance(2000);
    game.tick();
    assert.throws(() => game.buzz(alice.id), /locked out/);
    if (seconds) {
      advance(4500);
      assert.deepEqual(game.snapshot().lockedOutIds, [bob.id]);
      game.buzz(alice.id);
    }
  }
});

test('result holds reject host and player actions, while reset and restart clear the result', () => {
  for (const reset of ['reset', 'restartQuiz'] as const) {
    const { game, alice, command, advance } = setup();
    game.buzz(alice.id);
    command({ type: 'judge', correct: false });
    const before = game.snapshot(true);
    const actions: HostAction[] = [
      ...(['start', 'next', 'pause', 'resume', 'close', 'reveal', 'restartMedia', 'startReview', 'nextReview'] as const).map((type) => ({ type })),
      { type: 'judge', correct: true }, { type: 'judgeReview', correct: true },
      { type: 'judgeSubmission', playerId: alice.id, correct: true },
      { type: 'adjust', playerId: alice.id, delta: 5 }, { type: 'removePlayer', playerId: alice.id },
      { type: 'setup', settings: game.settings },
    ];
    for (const action of actions) {
      assert.throws(() => command(action), /buzzer result/, action.type);
      assert.deepEqual(game.snapshot(true), before);
    }
    assert.throws(() => game.buzz(alice.id), /not open/);
    assert.throws(() => game.submitAnswer(alice.id, before.questionInstanceId!, 'answer'), /not open/);
    command({ type: reset });
    assert.equal(game.snapshot().buzzResult, null);
    assert.equal(game.snapshot().phase, reset === 'reset' ? 'QUESTION_OPEN' : 'LOBBY');
    advance(10000);
    game.tick();
    assert.equal(game.snapshot().phase, reset === 'reset' ? 'QUESTION_OPEN' : 'LOBBY');
  }
});

test('undo before and after the automatic transition restores answering and cancels stale timers', () => {
  for (const correct of [false, true]) for (const last of [false, true]) for (const after of [false, true]) {
    const { game, alice, command, advance } = setup(last);
    advance(6000);
    game.buzz(alice.id);
    const instance = game.snapshot().questionInstanceId;
    command({ type: 'judge', correct });
    const oldId = game.snapshot().buzzResult!.id;
    if (after) { advance(BUZZ_RESULT_MS); game.tick(); }
    command({ type: 'undo' });
    assert.equal(game.snapshot().phase, 'ANSWERING');
    assert.equal(game.snapshot().activePlayerId, alice.id);
    assert.equal(game.snapshot().pointsAtBuzz, 400);
    assert.equal(game.snapshot().clueElapsedMs, 6000);
    assert.equal(game.snapshot().questionInstanceId, instance);
    assert.equal(game.snapshot().buzzResult, null);
    assert.equal(game.snapshot().nextRoundCountdownMs, null);
    assert.deepEqual(game.snapshot().lockedOutIds, []);
    assert.equal(alice.score, 0);
    advance(10000);
    game.tick();
    assert.equal(game.snapshot().phase, 'ANSWERING');
    command({ type: 'judge', correct: true });
    assert.notEqual(game.snapshot().buzzResult!.id, oldId);
    advance(BUZZ_RESULT_MS);
    game.tick();
    assert.equal(game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
    assert.equal(game.snapshot().nextRoundCountdownMs, last ? null : NEXT_ROUND_MS);
    assert.equal(alice.score, 400);
  }
});