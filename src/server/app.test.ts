import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import type { ClientEvents, ServerEvents, Snapshot, Result } from '../shared/protocol.js';

test('socket flow enforces host authorization, answer privacy, one winner and token reconnection', async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 100001, title: 'Socket Quiz', questions: [{ id: 'one', type: 'text', question: 'Public clue', answer: 'PRIVATE ANSWER' }] }) },
    passcode: 'test-host-passcode',
    serveClient: false,
  });

  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  const snapshots = new Map<Socket<ServerEvents, ClientEvents>, Snapshot>();
  const publicPayloads: string[] = [];
  async function connect(auth: Record<string, string>) {
    const socket: Socket<ServerEvents, ClientEvents> = io(url, { auth, autoConnect: false, reconnection: false });
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
  }
  try {
    await assert.rejects(connect({ role: 'host', passcode: 'wrong' }), /Incorrect/);
    const host = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const display = await connect({ role: 'display' });
    const alice = await connect({ role: 'player' });
    const bob = await connect({ role: 'player' });
    const first = await alice.emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    const second = await bob.emitWithAck('player:join', { name: 'Bob', avatarId: 'cat' });
    assert.ok(first.ok && second.ok);
    const unauthorized = await alice.emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action: { type: 'start' },
    });
    assert.deepEqual(unauthorized, { ok: false, error: 'Host authorization required.' });
    const started = await host.emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action: { type: 'start' },
    });
    assert.ok(started.ok);
    const buzzes: Result[] = await Promise.all([alice.emitWithAck('player:buzz'), bob.emitWithAck('player:buzz')]);
    assert.equal(buzzes.filter((r) => r.ok).length, 1);
    assert.equal(publicPayloads.some((p) => p.includes('PRIVATE ANSWER')), false);
    assert.equal(snapshots.get(host)?.privateAnswer, 'PRIVATE ANSWER');
    assert.equal(snapshots.get(display)?.privateAnswer, undefined);
    for (const client of [host, display, alice, bob]) {
      assert.equal(snapshots.get(client)?.quizId, 100001);
    }
    const resumed = await connect({ role: 'player', token: first.data.token });
    const identity = application.engine.players.get(first.data.playerId);
    assert.ok(identity?.connected);
    alice.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(identity.connected, 'another socket with same token keeps player connected');
    const rebuzz = await resumed.emitWithAck('player:buzz');
    assert.equal(rebuzz.ok, false);
    const malformed = await host.emitWithAck('host:command', JSON.parse('{"action":{"type":"adjust","delta":"oops"}}'));
    assert.equal(malformed.ok, false);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('development serves all pages, modules and public media without exposing server files', async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 100002, title: 'Development Quiz', questions: [{ id: 'one', type: 'text', question: 'Public clue', answer: 'Private answer' }] }) },
    passcode: 'test-host-passcode',
  });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of ['/', '/admin', '/display', '/play']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), /id="root"/);
    }
    for (const route of ['/main.tsx', '/media/mystery.svg']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      await response.text();
    }
    const response = await fetch(`${base}/@fs${path.resolve('src/data/questions.json')}`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /A rocket/);
  } finally {
    await application.close();
  }
});
