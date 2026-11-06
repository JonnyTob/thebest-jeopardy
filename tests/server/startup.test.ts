import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { GameEngine } from '../../src/server/engine.js';
import { createApp } from '../../src/server/app.js';
import { loadStartupRules } from '../../src/server/settings.js';
import type { ClientEvents, HostAction, Quiz, ServerEvents, Snapshot } from '../../src/shared/protocol.js';

const quiz: Quiz = { id: 1, title: 'Startup', questions: [
  { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'SECRET' },
] };
const rules = { title: 'House rules', rules: ['Be kind', 'Have fun'] };

test('startup steps are host-driven, retain players, clear Wi-Fi and reset on restart', () => {
  const game = new GameEngine(quiz, undefined, undefined, undefined, rules);
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  assert.equal(game.snapshot().phase, 'LOBBY');
  assert.equal(game.snapshot().startupStep, 'welcome');
  assert.deepEqual(game.snapshot().startupRules, rules);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  send({ type: 'showWifi', network: '  Guests  ', password: 'shared password' });
  assert.deepEqual(game.snapshot().wifi, { network: 'Guests', password: 'shared password' });
  send({ type: 'hideWifi' });
  assert.equal(game.snapshot().wifi, null);
  send({ type: 'showWifi', network: 'Guests', password: '' });
  const next = { id: randomUUID(), revision: game.revision, action: { type: 'nextStartup' } } as const;
  game.command(next);
  game.command(next);
  assert.equal(game.snapshot().startupStep, 'rules');
  assert.equal(game.snapshot().wifi, null);
  assert.throws(() => send({ type: 'showWifi', network: 'Guests', password: '' }), /welcome screen/);
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  send({ type: 'nextStartup' });
  assert.equal(game.snapshot().startupStep, 'lobby');
  assert.deepEqual(game.snapshot().players.map((player) => player.id), [alice.id, bob.id]);
  assert.throws(() => send({ type: 'nextStartup' }), /already complete/);
  assert.equal(game.snapshot().question, null);
  send({ type: 'start' });
  assert.equal(game.snapshot().phase, 'STARTING');
  assert.throws(() => send({ type: 'nextStartup' }), /countdown/);
  send({ type: 'restartQuiz' });
  assert.equal(game.snapshot().startupStep, 'welcome');
  assert.equal(game.snapshot().players.length, 0);
  assert.equal(game.snapshot().wifi, null);
});

test('startup rules load from a validated global JSON file', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'startup-rules-'));
  const file = path.join(directory, 'rules.json');
  try {
    writeFileSync(file, JSON.stringify(rules));
    assert.deepEqual(loadStartupRules(file), rules);
    writeFileSync(file, JSON.stringify({ title: 'Rules', rules: [] }));
    assert.throws(() => loadStartupRules(file), /Unable to load startup rules/);
    writeFileSync(file, '{');
    assert.throws(() => loadStartupRules(file), /Unable to load startup rules/);
    assert.throws(() => loadStartupRules(path.join(directory, 'missing.json')), /Unable to load startup rules/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('host commands synchronize startup and Wi-Fi with displays, while phones do not receive credentials', { timeout: 10000 }, async () => {
  const application = await createApp({ storage: { load: async () => quiz },
    passcode: 'test-host-passcode', serveClient: false, startupRules: rules });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  function waitFor(socket: Socket<ServerEvents, ClientEvents>, predicate: (state: Snapshot) => boolean) {
    return new Promise<Snapshot>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('session:snapshot', listener); reject(new Error('Snapshot timeout')); }, 3000);
      function listener(state: Snapshot) {
        if (predicate(state)) { clearTimeout(timeout); socket.off('session:snapshot', listener); resolve(state); }
      }
      socket.on('session:snapshot', listener);
    });
  }
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    async function connect(auth: Record<string, string>) {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`,
        { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      const initial = waitFor(socket, () => true);
      socket.connect();
      return { socket, state: await initial };
    }
    const host = (await connect({ role: 'host', passcode: 'test-host-passcode' })).socket;
    const display = (await connect({ role: 'display' })).socket;
    const phone = (await connect({ role: 'player' })).socket;
    const send = (socket: Socket<ServerEvents, ClientEvents>, action: HostAction) => socket.timeout(3000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action,
    });
    assert.equal((await send(phone, { type: 'nextStartup' })).ok, false);
    const joined = await phone.timeout(3000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    assert.ok(joined.ok);
    const show = waitFor(display, (state) => state.wifi !== null);
    assert.ok((await send(host, { type: 'showWifi', network: 'Guest', password: 'secret' })).ok);
    assert.deepEqual((await show).wifi, { network: 'Guest', password: 'secret' });
    const phoneReconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(phoneReconnect.state.wifi, null);
    assert.doesNotMatch(JSON.stringify(phoneReconnect.state), /secret/i);
    assert.equal((await connect({ role: 'display' })).state.wifi?.network, 'Guest');
    const next = waitFor(display, (state) => state.startupStep === 'rules');
    assert.ok((await send(host, { type: 'nextStartup' })).ok);
    assert.equal((await next).wifi, null);
    assert.deepEqual((await connect({ role: 'display' })).state.startupRules, rules);
    assert.ok((await send(host, { type: 'nextStartup' })).ok);
    assert.equal((await connect({ role: 'display' })).state.startupStep, 'lobby');
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});
