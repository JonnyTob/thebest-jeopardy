import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { loadGlobalSettings } from './settings.js';
import type { ClientEvents, ServerEvents, Snapshot } from '../shared/protocol.js';

const execFileAsync = promisify(execFile);
const defaultSound = '/media/sounds/countdown-beep.wav';
const storage = { load: async () => ({ id: 100001, title: 'Sound quiz',
  questions: [{ id: 'one', type: 'text' as const, question: 'Clue', answer: 'Answer' }] }) };

test('independent review sound configuration reaches API and all socket snapshots', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-review-sound-app-'));
  const file = path.join(directory, 'settings.json');
  const cases = [
    { server: {}, expected: [defaultSound, defaultSound, defaultSound] },
    { server: { reviewCorrectSound: null }, expected: [defaultSound, null, defaultSound] },
    { server: { reviewWrongSound: null }, expected: [defaultSound, defaultSound, null] },
    { server: { countdownSound: null, reviewCorrectSound: '/media/right.WAV', reviewWrongSound: '/media/wrong.wav' },
      expected: [null, '/media/right.WAV', '/media/wrong.wav'] },
    { server: { countdownSound: '/media/count.wav', reviewCorrectSound: null, reviewWrongSound: '/media/wrong.wav' },
      expected: ['/media/count.wav', null, '/media/wrong.wav'] },
    { server: { countdownSound: '/media/count.wav', reviewCorrectSound: '/media/right.wav', reviewWrongSound: null },
      expected: ['/media/count.wav', '/media/right.wav', null] },
  ];
  try {
    for (const { server, expected } of cases) {
      writeFileSync(file, JSON.stringify({ branding: {}, server: { port: 3000, ...server }, gameSetup: {
        leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5,
      } }));
      const { server: { port: _port, joinOrigin: _joinOrigin, startupQuizId: _startupQuizId, ...serverSettings } } = loadGlobalSettings(file, {});
      const application = await createApp({ storage, passcode: 'test-host-passcode', serveClient: false, serverSettings });
      const sockets: Socket<ServerEvents, ClientEvents>[] = [];
      try {
        await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
        const address = application.httpServer.address();
        assert.ok(address && typeof address !== 'string');
        const url = `http://127.0.0.1:${address.port}`;
        const info = await (await fetch(`${url}/api/info`)).json();
        const assertSounds = (settings: Snapshot['serverSettings']) => {
          assert.deepEqual([settings.countdownSound, settings.reviewCorrectSound, settings.reviewWrongSound], expected);
        };
        assertSounds(info.serverSettings);
        for (const auth of [{ role: 'host', passcode: 'test-host-passcode' }, { role: 'display' }, { role: 'player' }]) {
          const socket: Socket<ServerEvents, ClientEvents> = io(url, { auth, autoConnect: false, reconnection: false });
          sockets.push(socket);
          const snapshot = await new Promise<Snapshot>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timed out waiting for snapshot')), 5000);
            socket.once('session:snapshot', (state) => { clearTimeout(timeout); resolve(state); });
            socket.once('connect_error', (error) => { clearTimeout(timeout); reject(error); });
            socket.connect();
          });
          assertSounds(snapshot.serverSettings);
          assert.deepEqual(snapshot.serverSettings, info.serverSettings);
        }
        assertSounds(application.engine.snapshot().serverSettings);
        assertSounds(application.engine.snapshot(true).serverSettings);
      } finally {
        for (const socket of sockets) socket.disconnect();
        await application.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('configured countdown sounds, including disabled, reach API and snapshots', async () => {
  for (const countdownSound of [null, '/media/custom/sound.wav']) {
    const application = await createApp({ storage, passcode: 'test-host-passcode', serveClient: false,
      serverSettings: { countdownSound } });
    try {
      await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
      const address = application.httpServer.address();
      assert.ok(address && typeof address !== 'string');
      const info = await (await fetch(`http://127.0.0.1:${address.port}/api/info`)).json();
      assert.equal(info.serverSettings.countdownSound, countdownSound);
      assert.equal(application.engine.snapshot().serverSettings.countdownSound, countdownSound);
      assert.equal(application.engine.snapshot(true).serverSettings.countdownSound, countdownSound);
    } finally {
      await application.close();
    }
  }
});

test('production build copies and serves the configured default WAV intact', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-sound-production-'));
  try {
    const output = path.join(directory, 'dist', 'client');
    await execFileAsync(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), 'build', '--outDir', output],
      { cwd: process.cwd(), timeout: 60000 });
    const source = readFileSync(path.resolve('src/public', defaultSound.slice(1)));
    assert.deepEqual(readFileSync(path.join(output, defaultSound.slice(1))), source);
    // Production resolves dist/client from cwd; isolate that cwd in a child process.
    const script = `
      import { createApp } from ${JSON.stringify(pathToFileURL(path.resolve('src/server/app.ts')).href)};
      import { performance } from 'node:perf_hooks';
      import { randomUUID } from 'node:crypto';
      let now = 0;
      Object.defineProperty(performance, 'now', { value: () => now });
      const application = await createApp({ production: true, passcode: 'test-host-passcode',
        storage: { load: async () => ({ id: 100001, title: 'Quiz', questions: [
          { id: 'one', type: 'audio', question: 'Clue', answer: 'Answer', media: '/media/examples/chimes.wav' }
        ] }) } });
      try {
        const engine = application.engine;
        const player = engine.join({ name: 'Alice', avatarId: 'fox' });
        const send = action => engine.command({ id: randomUUID(), revision: engine.revision, action });
        send({ type: 'start' }); now = 4000; engine.tick();
        engine.buzz(player.id); send({ type: 'judge', correct: true }); now = 6000; engine.tick();
        await new Promise(resolve => application.httpServer.listen(0, '127.0.0.1', resolve));
        const address = application.httpServer.address();
        const soundPath = application.engine.snapshot().serverSettings.countdownSound;
        const response = await fetch('http://127.0.0.1:' + address.port + soundPath);
        console.log(JSON.stringify({ soundPath, status: response.status, type: response.headers.get('content-type'),
          bytes: Buffer.from(await response.arrayBuffer()).toString('base64'),
          phase: engine.snapshot().phase, remaining: engine.snapshot().mediaFinishRemainingMs }));
      } finally { await application.close(); }
    `;
    const { stdout } = await execFileAsync(process.execPath,
      ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script],
      { cwd: directory, timeout: 30000 });
    const result = JSON.parse(stdout);
    assert.equal(result.soundPath, defaultSound);
    assert.equal(result.phase, 'MEDIA_FINISH');
    assert.equal(result.remaining, 8000);
    assert.equal(result.status, 200);
    assert.match(result.type, /audio\/(wav|wave|x-wav)/i);
    const bytes = Buffer.from(result.bytes, 'base64');
    assert.deepEqual(bytes, source);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});