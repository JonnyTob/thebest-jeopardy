import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameEngine } from '../../src/server/engine.js';
import { playerSnapshotFactory } from '../../src/server/playerSnapshot.js';
import { serverSettingsSchema, type HostAction } from '../../src/shared/protocol.js';
import { START_COUNTDOWN_MS } from '../../src/shared/game.js';

test('phone snapshots remain small and contain only personal status, including review groups', () => {
  let time = 0;
  const game = new GameEngine({ id: 1, title: 'Quiz', questions: [{ id: 'q', type: 'text', mode: 'typed', fixedPoints: 250, question: 'Question', answer: 'Secret' }] },
    () => time, serverSettingsSchema.parse({ maxPlayers: 300 }));
  const players = Array.from({ length: 300 }, (_, i) => game.join({ name: `Player ${i}`, avatarId: 'fox' }));
  const snapshot = (id?: string) => playerSnapshotFactory(game.snapshot(), game.snapshot(true))(id);
  assert.equal(snapshot().playerCount, 300);
  assert.equal(snapshot().players.length, 0);
  assert.deepEqual(snapshot(players[99].id).players.map((p) => p.id), [players[99].id]);
  assert.equal(snapshot(players[99].id).playerRank, 100);
  assert.ok(JSON.stringify(snapshot(players[0].id)).length < 3000);
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  send({ type: 'start' }); time += START_COUNTDOWN_MS; game.tick();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(players[0].id, instance, 'private answer');
  assert.equal(snapshot(players[0].id).mySubmitted, true);
  assert.equal(snapshot(players[1].id).mySubmitted, false);
  assert.doesNotMatch(JSON.stringify(snapshot(players[1].id)), /private answer|Secret/);
  send({ type: 'close' });
  send({ type: 'judgeSubmission', playerId: players[0].id, correct: true });
  send({ type: 'startReview' });
  assert.deepEqual(snapshot(players[0].id).reviewGroup?.playerIds, [players[0].id]);
  assert.deepEqual(snapshot(players[1].id).reviewGroup?.playerIds, []);
  assert.equal(snapshot(players[0].id).players[0].score, 250);
  assert.doesNotMatch(JSON.stringify(snapshot(players[1].id)), /private answer/);
});

test('finish snapshot hides personal rank and keeps the reveal synchronized on reconnect', () => {
  let time = 0;
  const game = new GameEngine({ id: 1, title: 'Quiz', questions: [{ id: 'q', type: 'text', mode: 'buzzer', question: 'Question', answer: 'Secret' }] }, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  send({ type: 'start' }); time += START_COUNTDOWN_MS; game.tick();
  send({ type: 'close' }); send({ type: 'next' });
  const first = game.snapshot();
  assert.equal(first.phase, 'GAME_FINISHED');
  assert.ok(first.endGameId);
  assert.equal(first.endGameElapsedMs, 0);
  time += 4200;
  const reconnect = playerSnapshotFactory(game.snapshot(), game.snapshot(true))(alice.id);
  assert.equal(reconnect.endGameId, first.endGameId);
  assert.equal(reconnect.endGameElapsedMs, 4200);
  assert.equal(reconnect.playerRank, 0);
  assert.deepEqual(reconnect.leaderboardIds, []);
});
