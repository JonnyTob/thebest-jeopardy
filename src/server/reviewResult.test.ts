import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NEXT_ROUND_MS, REVIEW_GROUP_MS, REVIEW_RESULT_MS, START_COUNTDOWN_MS } from '../shared/game.js';
import { hostCommandSchema, quizSchema, type HostAction } from '../shared/protocol.js';
import { GameEngine } from './engine.js';

const quiz = quizSchema.parse({ id: 1, title: 'Review timing', questions: [
  { id: 'one', type: 'text', mode: 'typed', fixedPoints: 250, timerSeconds: 30,
    question: 'Clue', answer: 'SECRET' },
  { id: 'two', type: 'text', question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
] });

function setup(last = false) {
  let time = 0;
  const game = new GameEngine({ ...quiz, questions: last ? quiz.questions.slice(0, 1) : quiz.questions }, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const carol = game.join({ name: 'Carol', avatarId: 'owl' });
  const send = (action: HostAction) => {
    const request = { id: randomUUID(), revision: game.revision, action };
    game.command(request);
    return request;
  };
  send({ type: 'start' });
  time += START_COUNTDOWN_MS;
  game.tick();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'Alice private');
  game.submitAnswer(bob.id, instance, 'Bob private');
  game.submitAnswer(carol.id, instance, 'Carol private');
  time += 1234;
  return { game, alice, bob, carol, send, advance: (ms: number) => { time += ms; } };
}

test('public judgment holds exactly two seconds, rejects legacy advancement and skips privately judged entries', () => {
  const { game, alice, bob, carol, send, advance } = setup();
  assert.equal(REVIEW_RESULT_MS, 2000);
  assert.ok(hostCommandSchema.safeParse({ id: randomUUID(), revision: game.revision, action: { type: 'nextReview' } }).success);
  send({ type: 'judgeSubmission', playerId: bob.id, correct: true });
  assert.equal(game.snapshot().reviewResultId, null);
  assert.equal(game.snapshot().reviewRemainingMs, null);
  send({ type: 'startReview' });
  advance(REVIEW_GROUP_MS);
  game.tick();
  const before = game.snapshot();
  assert.equal(before.review?.playerId, alice.id);
  const command = send({ type: 'judgeReview', correct: false });
  const judged = game.snapshot();
  assert.ok(judged.reviewResultId);
  assert.equal(judged.reviewRemainingMs, 2000);
  assert.equal(judged.review?.correct, false);
  assert.equal(judged.nextRoundCountdownMs, null);
  const revision = game.revision;
  game.command(command);
  assert.equal(game.revision, revision);
  assert.equal(game.snapshot(true).scoreEvents.length, 2);
  assert.throws(() => send({ type: 'judgeReview', correct: true }), /already/);
  assert.throws(() => send({ type: 'nextReview' }), /automatically/);
  assert.throws(() => send({ type: 'adjust', playerId: alice.id, delta: 10 }), /review result/);
  advance(1999);
  game.tick();
  for (const state of [game.snapshot(), game.snapshot(true), game.snapshot(false, alice.id)]) {
    assert.equal(state.reviewResultId, judged.reviewResultId);
    assert.equal(state.reviewRemainingMs, 1);
    assert.equal(state.review?.playerId, alice.id);
    assert.equal(state.clueElapsedMs, before.clueElapsedMs);
    assert.equal(state.mediaPositionSeconds, before.mediaPositionSeconds);
    assert.equal(state.revealProgress, before.revealProgress);
    assert.equal(state.clockRunning, false);
    assert.doesNotMatch(JSON.stringify(state.question), /FUTURE/);
  }
  assert.equal(game.revision, revision);
  advance(1);
  assert.equal(game.snapshot().reviewRemainingMs, 0);
  assert.throws(() => send({ type: 'nextReview' }), /automatically/);
  assert.throws(() => send({ type: 'adjust', playerId: alice.id, delta: 10 }), /review result/);
  game.tick();
  assert.equal(game.revision, revision + 1);
  assert.equal(game.snapshot().review?.playerId, carol.id);
  assert.equal(game.snapshot().review?.correct, null);
  assert.equal(game.snapshot().reviewRemainingMs, null);
  assert.equal(game.snapshot().reviewResultId, null);
  game.tick();
  game.command(command);
  assert.equal(game.revision, revision + 1);
  assert.equal(bob.score, 250);
  const next = send({ type: 'judgeReview', correct: true });
  assert.notEqual(game.snapshot().reviewResultId, judged.reviewResultId);
  game.command(next);
  assert.equal(carol.score, 250);
});

test('late final ticks preserve a full next-round countdown or finish the quiz', () => {
  for (const last of [false, true]) {
    const { game, alice, bob, carol, send, advance } = setup(last);
    send({ type: 'judgeSubmission', playerId: bob.id, correct: false });
    send({ type: 'judgeSubmission', playerId: carol.id, correct: false });
    send({ type: 'startReview' });
    advance(REVIEW_GROUP_MS);
    game.tick();
    send({ type: 'judgeReview', correct: true });
    const frozen = game.snapshot().clueElapsedMs;
    advance(20000);
    const expired = game.snapshot();
    assert.equal(expired.reviewRemainingMs, 0);
    assert.equal(expired.review?.playerId, alice.id);
    assert.equal(expired.phase, 'REVIEW');
    assert.equal(expired.clueElapsedMs, frozen);
    game.tick();
    assert.equal(game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
    assert.equal(game.snapshot().reviewResultId, null);
    assert.equal(game.snapshot().reviewRemainingMs, null);
    assert.equal(game.snapshot().nextRoundCountdownMs, last ? null : NEXT_ROUND_MS);
    if (!last) {
      advance(NEXT_ROUND_MS - 1);
      game.tick();
      assert.equal(game.snapshot().nextRoundCountdownMs, 1);
      assert.equal(game.snapshot().clueElapsedMs, frozen);
      advance(1);
      game.tick();
      assert.equal(game.snapshot().questionIndex, 1);
      assert.equal(game.snapshot().clueElapsedMs, 0);
    }
  }
});

test('undo cancels a hold and after auto-advance restores the previous pending judgment', () => {
  for (const afterAdvance of [false, true]) {
    const { game, alice, bob, send, advance } = setup();
    send({ type: 'startReview' });
    const ruling = send({ type: 'judgeReview', correct: true });
    const firstId = game.snapshot().reviewResultId;
    if (afterAdvance) {
      advance(REVIEW_RESULT_MS);
      game.tick();
      assert.equal(game.snapshot().review?.playerId, bob.id);
    } else advance(REVIEW_RESULT_MS - 1);
    send({ type: 'undo' });
    assert.equal(alice.score, 0);
    assert.equal(game.snapshot().review?.playerId, alice.id);
    assert.equal(game.snapshot().review?.correct, null);
    assert.equal(game.snapshot().reviewResultId, null);
    assert.equal(game.snapshot().reviewRemainingMs, null);
    game.command(ruling);
    advance(10000);
    game.tick();
    assert.equal(game.snapshot().review?.playerId, alice.id);
    assert.equal(game.snapshot().review?.correct, null);
    send({ type: 'judgeReview', correct: false });
    assert.notEqual(game.snapshot().reviewResultId, firstId);
    assert.equal(game.snapshot().reviewRemainingMs, REVIEW_RESULT_MS);
  }
});

test('reset and restart cancel pending result holds without resurrecting them', () => {
  for (const action of ['reset', 'restartQuiz'] as const) {
    const { game, send, advance } = setup();
    send({ type: 'startReview' });
    send({ type: 'judgeReview', correct: true });
    advance(REVIEW_RESULT_MS - 1);
    send({ type: action });
    assert.equal(game.snapshot().reviewResultId, null);
    assert.equal(game.snapshot().reviewRemainingMs, null);
    advance(1);
    game.tick();
    assert.equal(game.snapshot().phase, action === 'reset' ? 'QUESTION_OPEN' : 'LOBBY');
    assert.equal(game.snapshot().nextRoundCountdownMs, null);
  }
});

test('adjustments after auto-advance undo independently without restoring a stale hold', () => {
  const { game, alice, bob, send, advance } = setup();
  send({ type: 'startReview' });
  send({ type: 'judgeReview', correct: true });
  advance(REVIEW_RESULT_MS);
  game.tick();
  send({ type: 'adjust', playerId: bob.id, delta: 20 });
  send({ type: 'undo' });
  assert.equal(bob.score, 0);
  assert.equal(alice.score, 250);
  assert.equal(game.snapshot().review?.playerId, bob.id);
  assert.equal(game.snapshot().reviewRemainingMs, null);
  send({ type: 'undo' });
  assert.equal(alice.score, 0);
  assert.equal(game.snapshot().review?.playerId, alice.id);
  assert.equal(game.snapshot().review?.correct, null);
});