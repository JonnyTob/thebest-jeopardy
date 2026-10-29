import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createApp } from '../src/server/app.js';
import { avatars } from '../src/shared/protocol.js';
import { parsePlayerOptions } from './players.js';

test('player helper defaults, overrides and validation', () => {
  assert.deepEqual(parsePlayerOptions([]), { count: 12, url: 'http://localhost:3000', help: false });
  assert.deepEqual(parsePlayerOptions(['--count', '24', '--url', 'http://127.0.0.1:3100/']), {
    count: 24, url: 'http://127.0.0.1:3100', help: false,
  });
  assert.equal(parsePlayerOptions(['--help']).help, true);
  for (const count of ['0', '-1', '1.5', '101', 'abc']) {
    assert.throws(() => parsePlayerOptions([`--count=${count}`]), /whole number/);
  }
  for (const url of ['ftp://localhost', 'http://localhost/play', 'http://user:secret@localhost', 'http://localhost?token=x']) {
    assert.throws(() => parsePlayerOptions(['--url', url]), /server origin/);
  }
  assert.throws(() => parsePlayerOptions(['--unknown']), /Unknown option/);
});

test('CLI joins 12 distinct online players and Ctrl+C disconnects without deleting scores', { timeout: 15000 }, async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 100003, title: 'Layout test', questions: [{ id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' }] }) },
    passcode: 'test-host-passcode',
    serveClient: false,
  });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const child = spawn(process.execPath, [
    '--import', 'tsx', 'script/players.ts', '--count', '12', '--url', `http://127.0.0.1:${address.port}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '';
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CLI startup timed out: ${output}\n${errors}`)), 8000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('12 players joined and connected')) { clearTimeout(timer); resolve(); }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`CLI exited early (${code}): ${errors}`));
      });
    });
    const state = application.engine.snapshot();
    assert.equal(state.players.length, 12);
    assert.equal(new Set(state.players.map((player) => player.name)).size, 12);
    assert.ok(state.players.every((player) => player.connected && player.score === 0 && avatars.includes(player.avatarId)));
    assert.equal(state.phase, 'LOBBY');
    assert.equal(state.activePlayerId, null);
    assert.equal(state.leaderboardIds.slice(0, state.settings.leaderboardCount).length, 8);
    child.kill('SIGINT');
    const [code] = await exited;
    assert.equal(code, 0, errors);
    const deadline = Date.now() + 2000;
    while ([...application.engine.players.values()].some((player) => player.connected) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(application.engine.players.size, 12);
    assert.ok([...application.engine.players.values()].every((player) => !player.connected && player.score === 0));
    assert.match(output, /Layout-test players disconnected/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    await application.close();
  }
});
