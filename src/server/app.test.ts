import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { JsonQuizSettingsStorage } from './settings.js';
import type { ClientEvents, ServerEvents, Snapshot, Result } from '../shared/protocol.js';

test('server nickname and player limits are advertised and enforced, including reconnects and removal', async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 100001, title: 'Limits quiz',
      questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }] }) },
    passcode: 'test-host-passcode', serveClient: false,
    serverSettings: { maxPlayerNameLength: 32, maxPlayers: 1 },
  });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(url, { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('session:snapshot', () => resolve());
        socket.once('connect_error', reject);
        socket.connect();
      });
      return socket;
    };
    const info = await (await fetch(`${url}/api/info`)).json();
    assert.deepEqual(info.serverSettings, { maxPlayerNameLength: 32, maxPlayers: 1, requireAdminPasscode: true });
    assert.deepEqual(application.engine.snapshot().serverSettings, info.serverSettings);
    const host = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const alice = await connect({ role: 'player' });
    for (const name of [' ', 'A'.repeat(33)]) {
      const rejected = await alice.timeout(5000).emitWithAck('player:join', { name, avatarId: 'fox' });
      assert.equal(rejected.ok, false);
      if (!rejected.ok) assert.match(rejected.error, /1-32 characters/);
    }
    const joined = await alice.timeout(5000).emitWithAck('player:join', { name: ` ${'A'.repeat(32)} `, avatarId: 'fox' });
    assert.ok(joined.ok);
    assert.equal(application.engine.players.get(joined.data.playerId)?.name.length, 32);
    const bob = await connect({ role: 'player' });
    const full = await bob.timeout(5000).emitWithAck('player:join', { name: 'Bob', avatarId: 'cat' });
    assert.equal(full.ok, false);
    if (!full.ok) assert.match(full.error, /full \(1 players maximum\)/);
    const disconnected = new Promise<void>((resolve) => {
      host.on('session:snapshot', (state) => {
        if (state.players.some((player) => player.id === joined.data.playerId && !player.connected)) resolve();
      });
    });
    alice.disconnect();
    await disconnected;
    const stillFull = await bob.timeout(5000).emitWithAck('player:join', { name: 'Bob', avatarId: 'cat' });
    assert.equal(stillFull.ok, false);
    await connect({ role: 'player', token: joined.data.token });
    assert.equal(application.engine.players.size, 1);
    assert.equal(application.engine.players.get(joined.data.playerId)?.connected, true);
    const removed = await host.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision,
      action: { type: 'removePlayer', playerId: joined.data.playerId },
    });
    assert.ok(removed.ok);
    const bobJoined = await bob.timeout(5000).emitWithAck('player:join', { name: 'Bob', avatarId: 'cat' });
    assert.ok(bobJoined.ok);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('admin passcode switch controls host authentication without granting players host privileges', async (t) => {
  for (const requireAdminPasscode of [true, false]) {
    await t.test(`requireAdminPasscode=${requireAdminPasscode}`, async () => {
      const application = await createApp({
        storage: { load: async () => ({ id: 100001, title: 'Auth quiz',
          questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Private answer' }] }) },
        passcode: 'test-host-passcode', serveClient: false,
        serverSettings: { requireAdminPasscode },
      });
      const sockets: Socket<ServerEvents, ClientEvents>[] = [];
      try {
        await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
        const address = application.httpServer.address();
        assert.ok(address && typeof address !== 'string');
        const url = `http://127.0.0.1:${address.port}`;
        const connect = async (auth: Record<string, string>) => {
          const socket: Socket<ServerEvents, ClientEvents> = io(url, { auth, autoConnect: false, reconnection: false });
          sockets.push(socket);
          await new Promise<void>((resolve, reject) => {
            socket.once('session:snapshot', () => resolve());
            socket.once('connect_error', reject);
            socket.connect();
          });
          return socket;
        };
        if (requireAdminPasscode) {
          await assert.rejects(connect({ role: 'host' }), /Incorrect host passcode/);
          await assert.rejects(connect({ role: 'host', passcode: 'wrong' }), /Incorrect host passcode/);
        }
        const host = await connect(requireAdminPasscode
          ? { role: 'host', passcode: 'test-host-passcode' } : { role: 'host' });
        const player = await connect({ role: 'player' });
        const unauthorized = await player.timeout(5000).emitWithAck('host:command', {
          id: randomUUID(), revision: application.engine.revision, action: { type: 'start' },
        });
        assert.deepEqual(unauthorized, { ok: false, error: 'Host authorization required.' });
        const started = await host.timeout(5000).emitWithAck('host:command', {
          id: randomUUID(), revision: application.engine.revision, action: { type: 'start' },
        });
        assert.ok(started.ok);
        assert.equal(application.engine.snapshot().privateAnswer, undefined);
        assert.equal(application.engine.snapshot(true).privateAnswer, 'Private answer');
      } finally {
        for (const socket of sockets) socket.disconnect();
        await application.close();
      }
    });
  }
});

test('global defaults and per-quiz overrides reach the host, save through sockets and survive restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-app-settings-'));
  const settingsStorage = new JsonQuizSettingsStorage(directory);
  const options = {
    storage: { load: async () => ({ id: 100001, title: 'Question title',
      questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }] }) },
    passcode: 'test-host-passcode', serveClient: false, settingsStorage,
    gameSetup: { title: 'Global title', startPoints: 700, lockoutSeconds: 20 },
  };
  try {
    writeFileSync(path.join(directory, '100001.json'), '{"gameSetup":{"title":"Quiz title","lockoutSeconds":10}}');
    const application = await createApp(options);
    let host: Socket<ServerEvents, ClientEvents> | undefined;
    try {
      assert.equal(application.engine.settings.title, 'Quiz title');
      assert.equal(application.engine.settings.startPoints, 700);
      assert.equal(application.engine.settings.lockoutSeconds, 10);
      await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
      const address = application.httpServer.address();
      assert.ok(address && typeof address !== 'string');
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`, {
        auth: { role: 'host', passcode: options.passcode }, autoConnect: false, reconnection: false,
      });
      host = socket;
      const snapshot = await new Promise<Snapshot>((resolve, reject) => {
        socket.once('session:snapshot', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      assert.deepEqual(snapshot.settings, application.engine.settings);
      const saved = { ...snapshot.settings, title: 'Persisted title', lockoutSeconds: 15 };
      const result = await socket.timeout(5000).emitWithAck('host:command', {
        id: randomUUID(), revision: snapshot.revision, action: { type: 'setup', settings: saved },
      });
      assert.ok(result.ok);
      assert.deepEqual(JSON.parse(readFileSync(path.join(directory, '100001.json'), 'utf8')), { gameSetup: saved });
      assert.deepEqual(settingsStorage.load(100002), {});
    } finally {
      host?.disconnect();
      await application.close();
    }
    const restarted = await createApp(options);
    try {
      assert.equal(restarted.engine.settings.title, 'Persisted title');
      assert.equal(restarted.engine.settings.lockoutSeconds, 15);
      assert.equal(restarted.engine.settings.startPoints, 700);
    } finally {
      await restarted.close();
    }
    writeFileSync(path.join(directory, '100001.json'), '{"gameSetup":{"minimumPoints":800}}');
    await assert.rejects(createApp(options), /Minimum points/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('configured LAN origin overrides internal interface addresses for QR links', async () => {
  const options = {
    storage: { load: async () => ({ id: 100001, title: 'LAN Quiz', questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }] }) },
    passcode: 'test-host-passcode', serveClient: false,
  };
  for (const joinOrigin of ['not-a-url', 'ftp://example.com', 'http://user:secret@example.com',
    'http://example.com/play', 'http://example.com?token=x', 'http://example.com#fragment']) {
    await assert.rejects(createApp({ ...options, joinOrigin }), /JOIN_ORIGIN/);
  }
  const application = await createApp({ ...options, joinOrigin: 'http://192.168.1.42:4000/' });
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/info`);
    const info = await response.json();
    assert.deepEqual(info.joinUrls, ['http://192.168.1.42:4000/play']);
    assert.equal(info.preferredJoinUrl, 'http://192.168.1.42:4000/play');
  } finally {
    await application.close();
  }
});

test('setup persistence failures are reported to the host without changing state', async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 100001, title: 'Quiz title',
      questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }] }) },
    passcode: 'test-host-passcode', serveClient: false,
    settingsStorage: { load: () => ({}), save: () => { throw new Error('Disk is read-only'); } },
  });
  let host: Socket<ServerEvents, ClientEvents> | undefined;
  try {
    assert.equal(application.engine.settings.title, 'Quiz title');
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`, {
      auth: { role: 'host', passcode: 'test-host-passcode' }, autoConnect: false, reconnection: false,
    });
    host = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('session:snapshot', () => resolve());
      socket.once('connect_error', reject);
      socket.connect();
    });
    const revision = application.engine.revision;
    const settings = { ...application.engine.settings };
    const result = await socket.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision,
      action: { type: 'setup', settings: { ...settings, lockoutSeconds: 20 } },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Unable to save quiz settings to disk/);
    assert.deepEqual(application.engine.settings, settings);
    assert.equal(application.engine.revision, revision);
  } finally {
    host?.disconnect();
    await application.close();
  }
});

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
  const branding = { name: 'Custom Quiz', logoText: 'CQ', tagline: 'Custom tagline.' };
  const application = await createApp({
    storage: { load: async () => ({ id: 100002, title: 'Development Quiz', questions: [{ id: 'one', type: 'text', question: 'Public clue', answer: 'Private answer' }] }) },
    passcode: 'test-host-passcode',
    branding,
  });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of ['/', '/index.html', '/admin', '/display', '/play']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.match(html, /id="root"/);
      assert.match(html, /<title>Custom Quiz<\/title>/);
      assert.match(html, /Loading Custom Quiz/);
      assert.equal(html.includes('__APP_'), false);
      const json = html.match(/id="app-branding" type="application\/json">([^]*?)<\/script>/)?.[1];
      assert.ok(json);
      assert.deepEqual(JSON.parse(json), branding);
    }
    for (const route of ['/main.tsx', '/media/mystery.svg', '/media/covers/100001.svg']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      await response.text();
    }
    for (const file of ['src/data/questions.json', 'settings.json']) {
      const response = await fetch(`${base}/@fs${path.resolve(file)}`);
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /A rocket/);
    }
  } finally {
    await application.close();
  }
});
