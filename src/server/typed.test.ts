import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { GameEngine } from './engine.js';
import { createApp } from './app.js';
import { quizSchema, settingsSchema, type ClientEvents, type HostAction, type ServerEvents, type Snapshot } from '../shared/protocol.js';
import { START_COUNTDOWN_MS } from '../shared/game.js';

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

test('one-click review atomically closes open typed submissions before or after the guide timer, including when paused', () => {
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
    command({ type: 'nextReview' });
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
  assert.equal(game.snapshot().phase, 'REVIEW_COMPLETE');
  assert.equal(game.snapshot().clockRunning, false);
  command({ type: 'next' });
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
  advance(3000);
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
  command({ type: 'nextReview' });
  assert.equal(game.snapshot().review?.playerId, alice.id);
  command({ type: 'judgeReview', correct: false });
  assert.equal(alice.score, 0);
  command({ type: 'nextReview' });
  assert.deepEqual(game.snapshot().review, { playerId: carol.id, answer: null, correct: null });
  assert.throws(() => command({ type: 'judgeReview', correct: true }), /missing answer/);
  command({ type: 'judgeReview', correct: false });
  command({ type: 'nextReview' });
  assert.equal(game.snapshot().phase, 'REVIEW_COMPLETE');
  command({ type: 'reveal' });
  assert.equal(game.snapshot().revealedAnswer, 'SECRET');
  command({ type: 'next' });
  game.buzz(alice.id);
  assert.equal(game.snapshot().phase, 'ANSWERING');
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
  send({ type: 'startReview' });
  assert.equal(empty.snapshot().phase, 'REVIEW_COMPLETE');
  send({ type: 'next' });
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
