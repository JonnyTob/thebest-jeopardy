import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonQuizSettingsStorage, loadGlobalSettings } from './settings.js';
import { GameEngine } from './engine.js';
import { randomUUID } from 'node:crypto';

const defaults = {
  leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100,
  dropEverySeconds: 5, lockoutSeconds: 0,
};
const branding = { name: 'Kaboot', logoText: 'K', tagline: 'Buzz in. Get booted.' };

test('global sections load defaults, respect environment overrides and reject invalid configuration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-global-settings-'));
  const file = path.join(directory, 'settings.json');
  try {
    const serverDefaults = { maxPlayerNameLength: 24, requireAdminPasscode: true, maxPlayers: 12 };
    const config = { branding, server: { port: 3000, joinOrigin: 'http://example.com:3000' }, gameSetup: defaults };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(loadGlobalSettings(file, {}), { ...config, server: { ...config.server, ...serverDefaults } });
    assert.deepEqual(loadGlobalSettings(file, { PORT: '4000', JOIN_ORIGIN: 'http://example.com:4000' }).server,
      { port: 4000, joinOrigin: 'http://example.com:4000', ...serverDefaults });
    const customServer = { ...config.server, maxPlayerNameLength: 32, requireAdminPasscode: false, maxPlayers: 20 };
    writeFileSync(file, JSON.stringify({ ...config, server: customServer }));
    assert.deepEqual(loadGlobalSettings(file, {}).server, customServer);
    writeFileSync(file, JSON.stringify(config));
    for (const PORT of ['0', '65536', '1.5', '', 'abc']) {
      assert.throws(() => loadGlobalSettings(file, { PORT }), /Unable to load global settings/);
    }
    for (const invalid of [
      { ...config, server: { port: 3000, lockoutSeconds: 10 } },
      { ...config, gameSetup: { ...defaults, port: 3000 } },
      { ...config, gameSetup: { ...defaults, minimumPoints: 501 } },
      { ...config, gameSetup: { ...defaults, lockoutSeconds: 301 } },
      { ...config, gameSetup: { ...defaults, maxPlayers: 20 } },
      ...[0, 101, 1.5, '24'].map((maxPlayerNameLength) => ({
        ...config, server: { ...config.server, maxPlayerNameLength },
      })),
      ...[0, 1001, 1.5, '12'].map((maxPlayers) => ({ ...config, server: { ...config.server, maxPlayers } })),
      { ...config, server: { ...config.server, requireAdminPasscode: 'false' } },
      { ...config, branding: { ...branding, name: '' } },
      { ...config, branding: { ...branding, logoText: 'Too long' } },
      { ...config, branding: { ...branding, tagline: 123 } },
    ]) {
      writeFileSync(file, JSON.stringify(invalid));
      assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
    }
    writeFileSync(file, '{bad json');
    assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
    assert.throws(() => loadGlobalSettings(path.join(directory, 'missing.json'), {}), /Unable to load global settings/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('quiz settings support partial overrides, persist separately and reject malformed files', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-settings-'));
  const storage = new JsonQuizSettingsStorage(directory);
  try {
    assert.deepEqual(storage.load(100001), {});
    writeFileSync(path.join(directory, '100001.json'), '{"gameSetup":{"startPoints":800}}');
    assert.deepEqual(storage.load(100001), { startPoints: 800 });
    storage.save(100002, { ...defaults, title: 'Another quiz', lockoutSeconds: 30 });
    assert.equal(storage.load(100002).lockoutSeconds, 30);
    const settings = { ...defaults, title: 'Saved quiz', lockoutSeconds: 10 };
    storage.save(100001, settings);
    assert.deepEqual(new JsonQuizSettingsStorage(directory).load(100001), settings);
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, '100001.json'), 'utf8')), { gameSetup: settings });
    assert.equal(storage.load(100002).lockoutSeconds, 30);
    assert.deepEqual(readdirSync(directory).sort(), ['100001.json', '100002.json']);
    for (const content of ['bad json', '{"gameSetup":{"lockoutSeconds":301}}',
      '{"gameSetup":{"port":4000}}', '{"server":{"port":4000},"gameSetup":{}}',
      '{"gameSetup":{"maxPlayerNameLength":10}}', '{"gameSetup":{"requireAdminPasscode":false}}',
      '{"gameSetup":{"maxPlayers":20}}', '{"gameSetup":{},"branding":{"name":"Other"}}']) {
      writeFileSync(path.join(directory, '100002.json'), content);
      assert.throws(() => storage.load(100002), /Invalid quiz settings/);
    }
    assert.throws(() => storage.save(100001, { ...settings, minimumPoints: 999 }), /Minimum points/);
    assert.deepEqual(storage.load(100001), settings);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('setup saves before committing state; failed, stale, duplicate or mid-game commands do not write', () => {
  const game = new GameEngine({
    id: 100001, title: 'Quiz',
    questions: [{ id: 'one', type: 'text', question: 'Clue', answer: 'Answer' }],
  });
  const settings = { ...game.settings, lockoutSeconds: 10 };
  const command = { id: randomUUID(), revision: game.revision, action: { type: 'setup', settings } } as const;
  let writes = 0;
  assert.throws(() => game.command(command, () => { throw new Error('Disk full'); }), /Disk full/);
  assert.equal(game.revision, 0);
  assert.equal(game.settings.lockoutSeconds, 0);
  game.command(command, () => { writes++; });
  game.command(command, () => { writes++; });
  assert.equal(writes, 1);
  assert.equal(game.settings.lockoutSeconds, 10);
  assert.throws(() => game.command({ ...command, id: randomUUID() }, () => { writes++; }), /state changed/);
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  assert.throws(() => game.command({ ...command, id: randomUUID(), revision: game.revision },
    () => { writes++; }), /lobby/);
  assert.equal(writes, 1);
});
