import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { GameEngine } from './engine.js';
import { createApp } from './app.js';
import type { ClientEvents, HostAction, ServerEvents, Quiz } from '../shared/protocol.js';

const quiz: Quiz = { id: 100001, title: 'Restart test', questions: [
  { id: 'one', type: 'text', question: 'First?', answer: 'First answer' },
  { id: 'two', type: 'text', question: 'Second?', answer: 'Second answer' },
] };

test('restart clears game state in every phase and preserves setup and revision', () => {
  for (const phase of ['LOBBY', 'STARTING', 'QUESTION_OPEN', 'NEXT_ROUND', 'GAME_FINISHED'] as const) {
    let time = 0;
    const game = new GameEngine(quiz, () => time);
    game.settings.title = 'Custom setup';
    const player = game.join({ name: 'Alice', avatarId: 'fox' });
    const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
    send({ type: 'adjust', playerId: player.id, delta: 123 });
    if (phase !== 'LOBBY') send({ type: 'start' });
    if (phase !== 'LOBBY' && phase !== 'STARTING') { time += 4000; game.tick(); }
    if (phase === 'NEXT_ROUND' || phase === 'GAME_FINISHED') {
      send({ type: 'close' });
      send({ type: 'next' });
    }
    if (phase === 'GAME_FINISHED') {
      time += 3000;
      game.tick();
      send({ type: 'close' });
      send({ type: 'next' });
    }
    assert.equal(game.snapshot().phase, phase);
    const revision = game.revision;
    const id = randomUUID();
    const command = { id, revision, action: { type: 'restartQuiz' } } as const;
    game.command(command);
    const state = game.snapshot(true);
    assert.equal(state.revision, revision + 1);
    assert.equal(state.phase, 'LOBBY');
    assert.equal(state.questionIndex, -1);
    assert.equal(state.question, null);
    assert.equal(state.questionInstanceId, null);
    assert.equal(state.countdownId, null);
    assert.equal(state.startCountdownMs, null);
    assert.equal(state.nextRoundCountdownMs, null);
    assert.deepEqual(state.players, []);
    assert.deepEqual(state.leaderboardIds, []);
    assert.deepEqual(state.scoreEvents, []);
    assert.equal(state.canUndo, false);
    assert.equal(state.settings.title, 'Custom setup');
    time += 10000;
    game.tick();
    assert.equal(game.snapshot().phase, 'LOBBY');
    const newPlayer = game.join({ name: 'Bob', avatarId: 'cat' });
    assert.equal(newPlayer.joinedOrder, 0);
    game.command(command);
    assert.equal(game.players.size, 1, 'duplicate command cannot reset a later session');
    assert.throws(() => game.command({ id: randomUUID(), revision, action: { type: 'start' } }), /state changed/i);
  }
});

test('restart discards typed submissions and invalidates their question instance', () => {
  let time = 0;
  const game = new GameEngine({ ...quiz, questions: [{ ...quiz.questions[0], mode: 'typed', fixedPoints: 250, timerSeconds: 30 }] }, () => time);
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  send({ type: 'start' });
  time += 4000;
  game.tick();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(player.id, instance, 'Private answer');
  send({ type: 'judgeSubmission', playerId: player.id, correct: true });
  send({ type: 'restartQuiz' });
  const state = game.snapshot(true);
  assert.equal(state.submissionCount, 0);
  assert.deepEqual(state.hostSubmissions, []);
  assert.equal(state.questionInstanceId, null);
  assert.throws(() => game.submitAnswer(player.id, instance, 'Stale answer'), /join/i);
  assert.doesNotMatch(JSON.stringify(state), /Private answer/);
});

test('restart is host-only, invalidates players and tokens, and is forbidden in production', async (t) => {
  for (const production of [false, true]) await t.test(`production=${production}`, async () => {
    const application = await createApp({ storage: { load: async () => quiz }, passcode: 'test-host-passcode',
      serveClient: false, production });
    const sockets: Socket<ServerEvents, ClientEvents>[] = [];
    try {
      await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
      const address = application.httpServer.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      const info = await (await fetch(`${url}/api/info`)).json();
      assert.equal(info.development, !production);
      const connect = async (auth: Record<string, string>) => {
        const socket: Socket<ServerEvents, ClientEvents> = io(url, { auth, autoConnect: false, reconnection: false });
        sockets.push(socket);
        const identity = new Promise<string | null>((resolve, reject) => {
          socket.once('player:identity', ({ playerId }) => resolve(playerId));
          socket.once('connect_error', reject);
        });
        socket.connect();
        return { socket, identity: await identity };
      };
      const { socket: host } = await connect({ role: 'host', passcode: 'test-host-passcode' });
      const { socket: player } = await connect({ role: 'player' });
      const joined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
      assert.ok(joined.ok);
      const command = { id: randomUUID(), revision: application.engine.revision, action: { type: 'restartQuiz' } } as const;
      const forbidden = await player.timeout(5000).emitWithAck('host:command', command);
      assert.equal(forbidden.ok, false);
      if (!forbidden.ok) assert.match(forbidden.error, /authorization/i);
      const identity = production ? undefined : new Promise<string | null>((resolve) => {
        player.once('player:identity', ({ playerId }) => resolve(playerId));
      });
      const result = await host.timeout(5000).emitWithAck('host:command', command);
      assert.equal(result.ok, !production);
      if (production) {
        assert.equal(application.engine.players.size, 1);
        if (!result.ok) assert.match(result.error, /development/i);
      } else {
        assert.equal(await identity, null);
        assert.equal(application.engine.players.size, 0);
        const oldToken = await connect({ role: 'player', token: joined.data.token });
        assert.equal(oldToken.identity, null);
        const rejoined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
        assert.ok(rejoined.ok);
        const duplicate = await host.timeout(5000).emitWithAck('host:command', command);
        assert.ok(duplicate.ok);
        assert.equal(application.engine.players.size, 1);
        const reconnect = await connect({ role: 'player', token: rejoined.data.token });
        assert.equal(reconnect.identity, rejoined.data.playerId);
      }
    } finally {
      for (const socket of sockets) socket.disconnect();
      await application.close();
    }
  });
});