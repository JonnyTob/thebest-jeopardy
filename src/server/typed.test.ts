import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { GameEngine } from './engine.js';
import { createApp } from './app.js';
import { quizSchema, settingsSchema, type ClientEvents, type HostAction, type ServerEvents, type Snapshot } from '../shared/protocol.js';
import { START_COUNTDOWN_MS, NEXT_ROUND_MS, REVIEW_RESULT_MS, REVIEW_GROUP_MS } from '../shared/game.js';

const quiz = quizSchema.parse({
  id: 100001, title: 'Mixed quiz', questions: [
    { id: 'typed', mode: 'typed', fixedPoints: 250, timerSeconds: 2, type: 'text', question: 'Which movie?', answer: 'SECRET' },
    { id: 'buzzer', type: 'text', question: 'Next?', answer: 'NEXT SECRET' },
  ],
});

function setup() {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const carol = game.join({ name: 'Carol', avatarId: 'owl' });
  const command = (action: HostAction) => {
    game.command({ id: randomUUID(), revision: game.revision, action });
    if (action.type === 'start') { time += START_COUNTDOWN_MS; game.tick(); }
  };
  return { game, alice, bob, carol, command, advance: (ms: number) => { time += ms; } };
}

test('typed question validation requires fixed points and timer while old questions remain valid', () => {
  const base = { id: 'one', type: 'text', question: 'Clue', answer: 'Answer' };
  assert.equal(quizSchema.safeParse({ id: 1, title: 'Quiz', questions: [base] }).success, true);
  for (const data of [
    { mode: 'typed' }, { mode: 'typed', fixedPoints: 10 },
    { mode: 'typed', timerSeconds: 10 }, { mode: 'typed', fixedPoints: 0, timerSeconds: 10 },
    { mode: 'typed', fixedPoints: 10, timerSeconds: 0 }, { mode: 'other' },
  ]) assert.equal(quizSchema.safeParse({ id: 1, title: 'Quiz', questions: [{ ...base, ...data }] }).success, false);
  assert.equal(settingsSchema.safeParse({ title: 'Q', leaderboardCount: 8, startPoints: 500,
    minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, maxAnswerLength: 501 }).success, false);
});

test('one-click review atomically closes open typed submissions before or after the deadline before tick, including when paused', () => {
  for (const [elapsed, paused] of [[1000, false], [3000, false], [1000, true]] as const) {
    const { game, alice, bob, carol, command, advance } = setup();
    assert.throws(() => command({ type: 'startReview' }), /open or closed typed-answer/);
    command({ type: 'start' });
    const instance = game.snapshot().questionInstanceId!;
    game.submitAnswer(bob.id, instance, 'First submission');
    game.setConnected(carol.id, false);
    advance(elapsed);
    if (paused) command({ type: 'pause' });
    const reviewCommand = { id: randomUUID(), revision: game.revision, action: { type: 'startReview' } } as const;
    game.command(reviewCommand);
    assert.equal(game.snapshot().phase, 'REVIEW');
    assert.equal(game.snapshot().clockRunning, false);
    assert.equal(game.snapshot().paused, false);
    assert.equal(game.snapshot().clueElapsedMs, elapsed);
    assert.equal(game.snapshot().reviewCount, 3);
    assert.equal(game.snapshot().review?.playerId, bob.id);
    assert.equal(game.snapshot().review?.answer, 'First submission');
    assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
    advance(10000);
    assert.equal(game.snapshot().clueElapsedMs, elapsed);
    assert.throws(() => game.submitAnswer(alice.id, instance, 'Too late'), /not open/);
    game.join({ name: 'Late player', avatarId: 'bear' });
    assert.equal(game.snapshot().reviewCount, 3);
    command({ type: 'judgeReview', correct: true });
    game.command(reviewCommand);
    assert.equal(game.snapshot().review?.correct, true, 'Duplicate start must not reset review');
    advance(REVIEW_RESULT_MS);
    game.tick();
    assert.equal(game.snapshot().review?.playerId, alice.id);
    assert.throws(() => command({ type: 'startReview' }), /open or closed typed-answer/);
  }
});

test('one-click review handles empty queues and rejects buzzer questions without closing them', () => {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  command({ type: 'start' });
  time += START_COUNTDOWN_MS;
  game.tick();
  command({ type: 'startReview' });
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().nextRoundCountdownMs, 3000);
  assert.equal(game.snapshot().clockRunning, false);
  time += NEXT_ROUND_MS;
  game.tick();
  assert.throws(() => command({ type: 'startReview' }), /open or closed typed-answer/);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().clockRunning, true);
});

test('typed answers remain private and final, obey the host close and are reviewed in submission order', () => {
  const { game, alice, bob, carol, command, advance } = setup();
  command({ type: 'setup', settings: { ...game.settings, maxAnswerLength: 8 } });
  command({ type: 'start' });
  const instance = game.snapshot().questionInstanceId!;
  assert.throws(() => game.buzz(alice.id), /typed answer/);
  assert.throws(() => game.submitAnswer(alice.id, instance, ' '), /1-8/);
  assert.throws(() => game.submitAnswer(alice.id, instance, '123456789'), /1-8/);
  assert.throws(() => game.submitAnswer(alice.id, 'stale', 'hello'), /changed/);
  game.submitAnswer(bob.id, instance, '  Matrix  ');
  assert.throws(() => game.submitAnswer(bob.id, instance, 'Change'), /already/);
  advance(1999);
  game.submitAnswer(alice.id, instance, 'Alien');
  assert.equal(game.snapshot().currentPoints, 250);
  assert.equal(game.snapshot().submissionCount, 2);
  assert.equal(game.snapshot(false, bob.id).mySubmitted, true);
  assert.equal(game.snapshot(false, carol.id).mySubmitted, false);
  assert.equal(JSON.stringify(game.snapshot()).includes('Matrix'), false);
  assert.equal(JSON.stringify(game.snapshot(false, alice.id)).includes('Alien'), false);
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((e) => e.answer), ['Matrix', 'Alien']);
  command({ type: 'close' });
  assert.throws(() => game.submitAnswer(carol.id, instance, 'Late'), /not open/);
  assert.throws(() => command({ type: 'next' }), /Review/);
  assert.throws(() => command({ type: 'reveal' }), /Review/);
  assert.throws(() => command({ type: 'removePlayer', playerId: bob.id }), /review/);
  command({ type: 'startReview' });
  assert.equal(game.snapshot().review?.playerId, bob.id);
  assert.equal(game.snapshot().review?.answer, 'Matrix');
  assert.equal(JSON.stringify(game.snapshot()).includes('Alien'), false);
  assert.throws(() => command({ type: 'nextReview' }), /Judge/);
  command({ type: 'judgeReview', correct: true });
  assert.equal(bob.score, 250);
  assert.equal(game.snapshot().leaderboardIds[0], bob.id);
  assert.equal(game.snapshot().review?.correct, true);
  assert.throws(() => command({ type: 'judgeReview', correct: true }), /already/);
  advance(REVIEW_RESULT_MS);
  game.tick();
  assert.equal(game.snapshot().review?.playerId, alice.id);
  command({ type: 'judgeReview', correct: false });
  assert.equal(alice.score, 0);
  advance(REVIEW_RESULT_MS);
  game.tick();
  assert.deepEqual(game.snapshot().review, { playerId: carol.id, answer: null, correct: null });
  assert.throws(() => command({ type: 'judgeReview', correct: true }), /missing answer/);
  command({ type: 'judgeReview', correct: false });
  advance(REVIEW_RESULT_MS);
  game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().revealedAnswer, null);
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
  advance(NEXT_ROUND_MS);
  game.tick();
  game.buzz(alice.id);
  assert.equal(game.snapshot().phase, 'ANSWERING');
});

test('fast approval scores privately and TV review skips judged first, middle and last entries', () => {
  const { game, alice, bob, carol, command, advance } = setup();
  const dave = game.join({ name: 'Dave', avatarId: 'bear' });
  const eve = game.join({ name: 'Eve', avatarId: 'panda' });
  command({ type: 'start' });
  const instance = game.snapshot().questionInstanceId!;
  for (const player of [alice, bob, carol, dave, eve]) game.submitAnswer(player.id, instance, `Private ${player.name}`);
  command({ type: 'close' });
  command({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  command({ type: 'judgeSubmission', playerId: carol.id, correct: false });
  game.setConnected(eve.id, false);
  const lastRuling = { id: randomUUID(), revision: game.revision,
    action: { type: 'judgeSubmission', playerId: eve.id, correct: true } } as const;
  game.command(lastRuling);
  game.command(lastRuling);
  assert.equal(alice.score, 250);
  assert.equal(carol.score, 0);
  assert.equal(eve.score, 250, 'a duplicate command must not award points twice');
  assert.equal(game.snapshot(true).scoreEvents.length, 3);
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().review, null);
  assert.equal(game.snapshot().leaderboardIds[0], alice.id);
  for (const snapshot of [game.snapshot(), game.snapshot(false, alice.id), game.snapshot(false, eve.id)]) {
    assert.equal(JSON.stringify(snapshot).includes('Private'), false);
    assert.equal(snapshot.hostSubmissions, undefined);
  }
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.correct), [true, null, false, null, true]);
  assert.throws(() => command({ type: 'judgeSubmission', playerId: alice.id, correct: false }), /already/);
  assert.throws(() => game.command({ id: randomUUID(), revision: game.revision - 1,
    action: { type: 'judgeSubmission', playerId: bob.id, correct: true } }), /state changed/);
  command({ type: 'startReview' });
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [alice.id, eve.id]);
  advance(REVIEW_GROUP_MS); game.tick();
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [carol.id]);
  advance(REVIEW_GROUP_MS); game.tick();
  assert.equal(game.snapshot().review?.playerId, bob.id);
  assert.equal(game.snapshot().reviewIndex, 1);
  assert.equal(game.snapshot().reviewCount, 5);
  assert.throws(() => command({ type: 'judgeSubmission', playerId: dave.id, correct: true }), /before starting review/);
  command({ type: 'judgeReview', correct: false });
  advance(REVIEW_RESULT_MS);
  game.tick();
  assert.equal(game.snapshot().review?.playerId, dave.id);
  command({ type: 'judgeReview', correct: true });
  advance(REVIEW_RESULT_MS);
  game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().review, null);
});

test('fast approval enforces phase, roster and missing-answer rules and completes fully judged queues', () => {
  const { game, alice, bob, carol, command, advance } = setup();
  const judge = (playerId: string, correct: boolean) => command({ type: 'judgeSubmission', playerId, correct });
  assert.throws(() => judge(alice.id, true), /before starting review/);
  command({ type: 'start' });
  game.submitAnswer(alice.id, game.snapshot().questionInstanceId!, 'Private answer');
  assert.throws(() => judge(bob.id, false), /not found/);
  command({ type: 'pause' });
  judge(alice.id, true);
  assert.equal(alice.score, 250);
  assert.equal(game.snapshot().paused, true);
  command({ type: 'close' });
  const late = game.join({ name: 'Late', avatarId: 'frog' });
  assert.throws(() => judge(late.id, true), /not found/);
  assert.throws(() => judge(bob.id, true), /missing answer/);
  assert.throws(() => judge(alice.id, true), /already/);
  judge(bob.id, false);
  judge(carol.id, false);
  assert.equal(game.snapshot().phase, 'REVIEW_GROUP');
  advance(REVIEW_GROUP_MS); game.tick();
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [bob.id, carol.id]);
  advance(REVIEW_GROUP_MS); game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.throws(() => command({ type: 'next' }), /next-round transition/);
  assert.throws(() => command({ type: 'startReview' }), /next-round transition/);
  assert.equal(game.snapshot().review, null);
  assert.equal(JSON.stringify(game.snapshot()).includes('Private answer'), false);
  assert.equal(game.snapshot().revealedAnswer, null);
  advance(NEXT_ROUND_MS);
  game.tick();
  command({ type: 'close' });
  assert.throws(() => judge(alice.id, true), /before starting review/);
});

test('live fast approval keeps submissions open and skips judged answers when review starts', () => {
  const { game, alice, bob, carol, command, advance } = setup();
  command({ type: 'start' });
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'Private correct');
  command({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  advance(500);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().clockRunning, true);
  assert.equal(game.snapshot().clueElapsedMs, 500);
  game.submitAnswer(bob.id, instance, 'Private wrong');
  command({ type: 'judgeSubmission', playerId: bob.id, correct: false });
  game.submitAnswer(carol.id, instance, 'Remaining answer');
  assert.equal(alice.score, 250);
  assert.equal(bob.score, 0);
  assert.equal(JSON.stringify(game.snapshot(false, alice.id)).includes('Private'), false);
  assert.equal(game.snapshot().review, null);
  command({ type: 'startReview' });
  advance(REVIEW_GROUP_MS); game.tick();
  advance(REVIEW_GROUP_MS); game.tick();
  assert.equal(game.snapshot().review?.playerId, carol.id);
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.correct), [true, false, null]);
});

test('undo of live approval restores judgments and preserves later submissions across close and review', () => {
  for (const correct of [true, false]) {
    for (const startReview of [true, false]) {
      const { game, alice, bob, carol, command, advance } = setup();
      command({ type: 'start' });
      const instance = game.snapshot().questionInstanceId!;
      game.submitAnswer(alice.id, instance, 'First');
      command({ type: 'judgeSubmission', playerId: alice.id, correct: false });
      game.submitAnswer(bob.id, instance, 'Second');
      command({ type: 'judgeSubmission', playerId: bob.id, correct });
      game.submitAnswer(carol.id, instance, 'Later submission');
      command({ type: 'close' });
      if (startReview) command({ type: 'startReview' });
      command({ type: 'undo' });
      assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
      assert.equal(game.snapshot().submissionCount, 3);
      assert.equal(bob.score, 0);
      assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.correct), [false, null, null]);
      assert.equal(game.snapshot(true).hostSubmissions?.[2].answer, 'Later submission');
      command({ type: 'startReview' });
      advance(REVIEW_GROUP_MS); game.tick();
      assert.equal(game.snapshot().review?.playerId, bob.id);
    }
  }
});

test('undo restores private correct, wrong and missing rulings even after review completes', () => {
  for (const outcome of ['correct', 'wrong', 'missing'] as const) {
    const { game, alice, bob, carol, command, advance } = setup();
    command({ type: 'removePlayer', playerId: bob.id });
    command({ type: 'removePlayer', playerId: carol.id });
    command({ type: 'start' });
    if (outcome !== 'missing') game.submitAnswer(alice.id, game.snapshot().questionInstanceId!, 'Private');
    command({ type: 'close' });
    command({ type: 'judgeSubmission', playerId: alice.id, correct: outcome === 'correct' });
    assert.equal(alice.score, outcome === 'correct' ? 250 : 0);
    assert.equal(game.snapshot(true).hostSubmissions?.[0].correct, outcome === 'correct');
    assert.equal(game.snapshot(true).scoreEvents.length, 1);
    advance(REVIEW_GROUP_MS); game.tick();
    assert.equal(game.snapshot().phase, 'NEXT_ROUND');
    command({ type: 'undo' });
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
    assert.equal(alice.score, 0);
    assert.equal(game.snapshot(true).hostSubmissions?.[0].correct, null);
    assert.equal(game.snapshot(true).scoreEvents.length, 0);
    assert.equal(game.snapshot().review, null);
    command({ type: 'startReview' });
    assert.equal(game.snapshot().review?.playerId, alice.id);
  }
});

test('paused submissions, reconnect, reset, undo and empty reviews preserve their rules', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'start' });
  const first = game.snapshot().questionInstanceId!;
  command({ type: 'pause' });
  advance(5000);
  assert.throws(() => game.submitAnswer(alice.id, first, 'paused'), /not open/);
  assert.equal(game.snapshot().clueElapsedMs, 0);
  command({ type: 'resume' });
  game.submitAnswer(alice.id, first, 'Alice');
  game.setConnected(alice.id, false);
  game.setConnected(alice.id, true);
  assert.equal(game.snapshot(false, alice.id).mySubmitted, true);
  assert.throws(() => game.submitAnswer(alice.id, first, 'Again'), /already/);
  command({ type: 'adjust', playerId: alice.id, delta: 10 });
  game.submitAnswer(bob.id, first, 'Bob');
  command({ type: 'undo' });
  assert.equal(game.snapshot().submissionCount, 2);
  command({ type: 'close' });
  command({ type: 'startReview' });
  command({ type: 'judgeReview', correct: true });
  assert.equal(alice.score, 250);
  command({ type: 'undo' });
  assert.equal(alice.score, 0);
  assert.equal(game.snapshot().review?.correct, null);
  command({ type: 'reset' });
  assert.equal(game.snapshot().submissionCount, 0);
  assert.throws(() => game.submitAnswer(alice.id, first, 'Old'), /changed/);

  let emptyTime = 0;
  const empty = new GameEngine(quiz, () => emptyTime);
  const send = (action: HostAction) => empty.command({ id: randomUUID(), revision: empty.revision, action });
  send({ type: 'start' });
  emptyTime += START_COUNTDOWN_MS;
  empty.tick();
  send({ type: 'close' });
  assert.equal(empty.snapshot().phase, 'NEXT_ROUND');
  emptyTime += NEXT_ROUND_MS;
  empty.tick();
  assert.equal(empty.snapshot().question?.id, 'buzzer');
});

test('sockets send answers only to host until current review and restore submission identity on reconnect', async () => {
  const application = await createApp({ storage: { load: async () => quiz },
    passcode: 'test-host-passcode', serveClient: false });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  const snapshots = new Map<Socket<ServerEvents, ClientEvents>, Snapshot>();
  const publicPayloads: string[] = [];
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`,
        { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      socket.on('session:snapshot', (state) => {
        snapshots.set(socket, state);
        if (auth.role !== 'host') publicPayloads.push(JSON.stringify(state));
      });
      await new Promise<void>((resolve, reject) => {
        socket.once('session:snapshot', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
      });
      return socket;
    };
    const host = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const display = await connect({ role: 'display' });
    const player = await connect({ role: 'player' });
    const joined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    assert.ok(joined.ok);
    const send = (action: HostAction) => host.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action,
    });
    const opened = new Promise<void>((resolve) => {
      player.on('session:snapshot', function listener(state) {
        if (state.phase === 'QUESTION_OPEN') {
          player.off('session:snapshot', listener);
          resolve();
        }
      });
    });
    assert.ok((await send({ type: 'start' })).ok);
    assert.equal(application.engine.snapshot().phase, 'STARTING');
    const early = await player.timeout(5000).emitWithAck('player:submitAnswer', { questionInstanceId: 'early', answer: 'PRIVATE GUESS' });
    assert.equal(early.ok, false);
    await opened;
    const id = application.engine.snapshot().questionInstanceId!;
    const hostReceived = new Promise<Snapshot>((resolve) => {
      host.on('session:snapshot', function listener(state) {
        if (state.hostSubmissions?.some((entry) => entry.answer === 'PRIVATE GUESS')) {
          host.off('session:snapshot', listener);
          resolve(state);
        }
      });
    });
    const response = await player.timeout(5000).emitWithAck('player:submitAnswer', { questionInstanceId: id, answer: 'PRIVATE GUESS' });
    assert.ok(response.ok);
    await hostReceived;
    assert.equal(publicPayloads.some((payload) => payload.includes('PRIVATE GUESS')), false);
    assert.equal(snapshots.get(host)?.hostSubmissions?.[0].answer, 'PRIVATE GUESS');
    const reconnected = await connect({ role: 'player', token: joined.data.token });
    assert.equal(snapshots.get(reconnected)?.mySubmitted, true);
    const repeat = await reconnected.timeout(5000).emitWithAck('player:submitAnswer', { questionInstanceId: id, answer: 'Again' });
    assert.equal(repeat.ok, false);
    assert.ok((await send({ type: 'close' })).ok);
    const unauthorized = await player.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision,
      action: { type: 'judgeSubmission', playerId: joined.data.playerId, correct: true },
    });
    assert.equal(unauthorized.ok, false);
    assert.ok((await send({ type: 'judgeSubmission', playerId: joined.data.playerId, correct: true })).ok);
    const fastReconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(snapshots.get(fastReconnect)?.review, null);
    assert.equal(snapshots.get(fastReconnect)?.players[0].score, 250);
    assert.equal(publicPayloads.some((payload) => payload.includes('PRIVATE GUESS')), false);
    assert.ok((await send({ type: 'undo' })).ok);
    const displayReceived = new Promise<Snapshot>((resolve) => {
      display.on('session:snapshot', function listener(state) {
        if (state.review?.answer === 'PRIVATE GUESS') {
          display.off('session:snapshot', listener);
          resolve(state);
        }
      });
    });
    assert.ok((await send({ type: 'startReview' })).ok);
    assert.equal((await displayReceived).review?.answer, 'PRIVATE GUESS');
    assert.equal(snapshots.get(display)?.hostSubmissions, undefined);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});
