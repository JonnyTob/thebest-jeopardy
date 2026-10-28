import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createApp } from './app.js';

const execFileAsync = promisify(execFile);
const defaultSound = '/media/sounds/countdown-beep.wav';
const storage = { load: async () => ({ id: 100001, title: 'Sound quiz',
  questions: [{ id: 'one', type: 'text' as const, question: 'Clue', answer: 'Answer' }] }) };

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
      const application = await createApp({ production: true, passcode: 'test-host-passcode',
        storage: { load: async () => ({ id: 100001, title: 'Quiz', questions: [
          { id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }
        ] }) } });
      try {
        await new Promise(resolve => application.httpServer.listen(0, '127.0.0.1', resolve));
        const address = application.httpServer.address();
        const soundPath = application.engine.snapshot().serverSettings.countdownSound;
        const response = await fetch('http://127.0.0.1:' + address.port + soundPath);
        console.log(JSON.stringify({ soundPath, status: response.status, type: response.headers.get('content-type'),
          bytes: Buffer.from(await response.arrayBuffer()).toString('base64') }));
      } finally { await application.close(); }
    `;
    const { stdout } = await execFileAsync(process.execPath,
      ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script],
      { cwd: directory, timeout: 30000 });
    const result = JSON.parse(stdout);
    assert.equal(result.soundPath, defaultSound);
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