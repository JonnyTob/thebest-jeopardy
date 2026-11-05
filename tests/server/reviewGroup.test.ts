import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NEXT_ROUND_MS, REVIEW_GROUP_MS, REVIEW_RESULT_MS, START_COUNTDOWN_MS } from '../../src/shared/game.js';
import { quizSchema, type HostAction } from '../../src/shared/protocol.js';
import { GameEngine } from '../../src/server/engine.js';

const quiz = quizSchema.parse({ id: 1, title: 'Grouped review', questions: [
  { id: 'one', type: 'image', mode: 'typed', fixedPoints: 250, timerSeconds: 30,
    question: 'Current', answer: 'OFFICIAL SECRET', media: '/media/image.png',
    reveal: { effect: 'tiles', durationSeconds: 20 } },
  { id: 'two', type: 'text', mode: 'buzzer', question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
] });

function setup() {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const players = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((name) => game.join({ name, avatarId: 'fox' }));
  const send = (action: HostAction) => {
    const request = { id: randomUUID(), revision: game.revision, action };
    game.command(request);
    return request;
  };
  const advance = (ms: number) => { time += ms; };
  send({ type: 'start' }); advance(START_COUNTDOWN_MS); game.tick();
  const instance = game.snapshot().questionInstanceId!;
  for (const player of players.slice(0, 4)) game.submitAnswer(player.id, instance, `PRIVATE ${player.name}`);
  advance(1200);
  return { game, players, send, advance };
}

test('groups reveal only current judged players, then unjudged individuals, without rescoring', () => {
  const { game, players: [alice, bob, carol, dave, eve], send, advance } = setup();
  send({ type: 'close' });
  send({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  send({ type: 'judgeSubmission', playerId: bob.id, correct: false });
  assert.throws(() => send({ type: 'judgeSubmission', playerId: eve.id, correct: false }), /missing answer/);
  assert.throws(() => send({ type: 'judgeSubmission', playerId: eve.id, correct: true }), /missing answer/);
  game.setConnected(bob.id, false);
  const start = send({ type: 'startReview' });
  const first = game.snapshot();
  const group = first.reviewGroup!;
  assert.equal(first.phase, 'REVIEW_GROUP');
  assert.deepEqual(group, { id: group.id, outcome: 'correct', playerIds: [alice.id], points: 250, remainingMs: 4000 });
  assert.ok(group.id);
  assert.equal(first.review, null);
  assert.equal(first.reviewResultId, null);
  assert.equal(first.clockRunning, false);
  assert.equal(first.displayClockRunning, false);
  assert.equal(game.snapshot(true).hostSubmissions?.length, 5);
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((e) => e.correct), [true, false, null, null, null]);
  assert.equal(game.snapshot(true).scoreEvents.length, 2);
  for (const state of [first, game.snapshot(false, alice.id), game.snapshot(false, bob.id)]) {
    assert.equal(state.hostSubmissions, undefined);
    assert.equal(state.privateAnswer, undefined);
    assert.doesNotMatch(JSON.stringify(state), /PRIVATE|OFFICIAL SECRET|FUTURE/);
    assert.deepEqual(state.reviewGroup?.playerIds, [alice.id]);
  }
  const actions: HostAction[] = [
    ...(['start', 'pause', 'resume', 'close', 'reveal', 'next', 'restartMedia', 'skipMedia', 'startReview', 'nextReview'] as const)
      .map((type) => ({ type })),
    { type: 'setup', settings: game.settings }, { type: 'adjust', playerId: alice.id, delta: 10 },
    { type: 'removePlayer', playerId: alice.id }, { type: 'judge', correct: true },
    { type: 'judgeReview', correct: true }, { type: 'judgeSubmission', playerId: carol.id, correct: true },
  ];
  for (const action of actions) {
    assert.throws(() => send(action), /review group/);
    assert.deepEqual(game.snapshot(), first);
  }
  game.command(start);
  advance(REVIEW_GROUP_MS - 1); game.tick();
  assert.equal(game.snapshot().reviewGroup?.remainingMs, 1);
  advance(10000);
  assert.equal(game.snapshot().reviewGroup?.remainingMs, 0);
  game.tick();
  const second = game.snapshot();
  assert.deepEqual(second.reviewGroup, { id: second.reviewGroup!.id, outcome: 'wrong', playerIds: [bob.id], points: 0, remainingMs: 4000 });
  assert.notEqual(second.reviewGroup?.id, group.id);
  assert.equal(second.review, null);
  assert.equal(second.clueElapsedMs, first.clueElapsedMs);
  assert.equal(second.mediaPositionSeconds, first.mediaPositionSeconds);
  assert.equal(second.revealProgress, first.revealProgress);
  advance(REVIEW_GROUP_MS); game.tick();
  const missing = game.snapshot().reviewGroup!;
  assert.deepEqual(missing, { id: missing.id, outcome: 'missing', playerIds: [eve.id], points: 0, remainingMs: 4000 });
  assert.equal(game.snapshot(true).scoreEvents.length, 2);
  advance(REVIEW_GROUP_MS - 1); game.tick();
  assert.equal(game.snapshot().reviewGroup?.remainingMs, 1);
  advance(1); game.tick();
  assert.equal(game.snapshot().reviewGroup, null);
  assert.equal(game.snapshot().review?.playerId, carol.id);
  assert.equal(game.snapshot().review?.answer, 'PRIVATE Carol');
  assert.doesNotMatch(JSON.stringify(game.snapshot()), /PRIVATE Alice|PRIVATE Bob|PRIVATE Dave/);
  send({ type: 'judgeReview', correct: true }); advance(REVIEW_RESULT_MS); game.tick();
  assert.equal(game.snapshot().review?.playerId, dave.id);
  send({ type: 'judgeReview', correct: false }); advance(REVIEW_RESULT_MS); game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().reviewGroup, null);
  assert.deepEqual(playersScores(game), [250, 0, 250, 0, 0]);
  assert.equal(game.snapshot(true).scoreEvents.length, 4);
  advance(NEXT_ROUND_MS); game.tick();
  assert.equal(game.snapshot().reviewGroup, null);
});

function playersScores(game: GameEngine) {
  return [...game.players.values()].map((player) => player.score);
}

test('undo during any group restores the preceding score snapshot and cancels all group timers', () => {
  for (const groupIndex of [0, 1, 2]) {
    const { game, players: [alice, bob], send, advance } = setup();
    send({ type: 'close' });
    send({ type: 'judgeSubmission', playerId: alice.id, correct: true });
    send({ type: 'judgeSubmission', playerId: bob.id, correct: false });
    send({ type: 'startReview' });
    for (let i = 0; i < groupIndex; i++) { advance(REVIEW_GROUP_MS); game.tick(); }
    assert.equal(game.snapshot().reviewGroup?.outcome, ['correct', 'wrong', 'missing'][groupIndex]);
    send({ type: 'undo' });
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    assert.equal(game.snapshot().reviewGroup, null);
    assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.correct), [true, null, null, null, null]);
    assert.deepEqual(playersScores(game), [250, 0, 0, 0, 0]);
    assert.equal(game.snapshot(true).scoreEvents.length, 1);
    advance(20000); game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    send({ type: 'undo' });
    assert.deepEqual(playersScores(game), [0, 0, 0, 0, 0]);
    assert.equal(game.snapshot(true).hostSubmissions?.[0].correct, null);
  }
});

test('reset and restart discard group timers without undoing already awarded points on reset', () => {
  for (const action of ['reset', 'restartQuiz'] as const) {
    const { game, players: [alice], send, advance } = setup();
    send({ type: 'close' });
    send({ type: 'judgeSubmission', playerId: alice.id, correct: true });
    send({ type: 'startReview' });
    advance(REVIEW_GROUP_MS); game.tick();
    assert.equal(game.snapshot().reviewGroup?.outcome, 'missing');
    send({ type: action });
    assert.equal(game.snapshot().reviewGroup, null);
    assert.equal(game.snapshot().phase, action === 'reset' ? 'QUESTION_OPEN' : 'LOBBY');
    if (action === 'reset') assert.equal(alice.score, 250);
    advance(1000); game.tick();
    assert.equal(game.snapshot().phase, action === 'reset' ? 'QUESTION_OPEN' : 'LOBBY');
  }
});

test('all missing answers form one four-second group without score events, including disconnected players', () => {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  send({ type: 'start' }); time += START_COUNTDOWN_MS; game.tick();
  game.setConnected(bob.id, false);
  send({ type: 'close' });
  const late = game.join({ name: 'Late', avatarId: 'owl' });
  for (const correct of [true, false]) {
    assert.throws(() => send({ type: 'judgeSubmission', playerId: alice.id, correct }), /missing answer/);
  }
  assert.throws(() => send({ type: 'judgeSubmission', playerId: late.id, correct: false }), /not found/);
  send({ type: 'startReview' });
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [alice.id, bob.id]);
  assert.equal(game.snapshot().reviewGroup?.outcome, 'missing');
  assert.equal(game.snapshot().reviewCount, 0);
  assert.equal(game.snapshot(true).scoreEvents.length, 0);
  assert.equal(game.snapshot().canUndo, false);
  assert.throws(() => send({ type: 'judgeReview', correct: false }), /review group/);
  game.setConnected(bob.id, true);
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [alice.id, bob.id]);
  time += REVIEW_GROUP_MS - 1; game.tick();
  assert.equal(game.snapshot().reviewGroup?.remainingMs, 1);
  time++; game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot(true).scoreEvents.length, 0);
  assert.deepEqual(playersScores(game), [0, 0, 0]);
});

test('typed decaying points are captured per submission and shown in fast review', () => {
  let time = 0;
  const question = { id: 'decay', type: 'text', mode: 'typed', pointMode: 'decay',
    pointDecay: { startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, pointDecayDelaySeconds: 0 },
    question: 'Question', answer: 'Answer' } as const;
  const game = new GameEngine(quizSchema.parse({ id: 1, title: 'Quiz', questions: [question] }), () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'fox' });
  const carol = game.join({ name: 'Carol', avatarId: 'fox' });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  send({ type: 'start' }); time += START_COUNTDOWN_MS; game.tick();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'first');
  time += 5000;
  assert.equal(game.snapshot().currentPoints, 400);
  game.submitAnswer(bob.id, instance, 'second');
  send({ type: 'close' });
  send({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  send({ type: 'judgeSubmission', playerId: bob.id, correct: true });
  send({ type: 'startReview' });
  assert.deepEqual(game.snapshot().reviewGroup?.pointsByPlayer, { [alice.id]: 500, [bob.id]: 400 });
  assert.equal(game.snapshot().players.find((player) => player.id === alice.id)?.score, 500);
  assert.equal(game.snapshot().players.find((player) => player.id === bob.id)?.score, 400);
  time += REVIEW_GROUP_MS; game.tick();
  assert.equal(game.snapshot().reviewGroup?.outcome, 'missing');
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [carol.id]);
  assert.equal(game.snapshot().reviewGroup?.pointsByPlayer, undefined);
  assert.equal(game.snapshot(true).scoreEvents.length, 2);
});
