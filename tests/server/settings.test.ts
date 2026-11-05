import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonQuizSettingsStorage, loadGlobalSettings } from '../../src/server/settings.js';
import { GameEngine } from '../../src/server/engine.js';
import { randomUUID } from 'node:crypto';
import { hostCommandSchema, serverSettingsSchema } from '../../src/shared/protocol.js';

const defaults = {
  leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100,
  dropEverySeconds: 5, pointDecayDelaySeconds: 5, questionTimerSeconds: 30, lockoutSeconds: 0, maxAnswerLength: 100,
};
const branding = { name: 'Kaboot', logoText: 'K', tagline: 'Buzz in. Get booted.' };
function withoutPointDefaults(settings: typeof defaults & { title: string }) {
  const { startPoints: _start, minimumPoints: _min, dropPoints: _drop, dropEverySeconds: _interval,
    pointDecayDelaySeconds: _delay, ...rest } = settings;
  return rest;
}

test('review sounds validate local WAV paths independently and are global-server-only', () => {
  const defaultSound = '/media/sounds/countdown-beep.wav';
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-review-sound-settings-'));
  const file = path.join(directory, 'settings.json');
  const storage = new JsonQuizSettingsStorage(path.join(directory, 'quizzes'));
  const config = { branding, server: { port: 3000 }, gameSetup: defaults };
  const settings = { ...defaults, title: 'Quiz' };
  try {
    storage.save(100001, settings);
    for (const key of ['reviewCorrectSound', 'reviewWrongSound'] as const) {
      const other = key === 'reviewCorrectSound' ? 'reviewWrongSound' : 'reviewCorrectSound';
      assert.equal(serverSettingsSchema.parse({})[key], defaultSound);
      for (const value of [null, defaultSound, '/media/custom/my-sound_2.WAV', '/media/beep.wav']) {
        const input = { [key]: value, countdownSound: null };
        const parsed = serverSettingsSchema.parse(input);
        assert.equal(parsed[key], value);
        assert.equal(parsed[other], defaultSound);
        assert.equal(parsed.countdownSound, null);
        writeFileSync(file, JSON.stringify({ ...config, server: { ...config.server, ...input } }));
        const loaded = loadGlobalSettings(file, {}).server;
        assert.equal(loaded[key], value);
        assert.equal(loaded[other], defaultSound);
        assert.equal(loaded.countdownSound, null);
      }
      for (const value of ['', '/media/sounds/beep.mp3', '/media/sounds/beep.wav.mp3',
        '/media/sounds/beep.wav?x=1', '/media/sounds/beep.wav#fragment', '/media/../secret.wav',
        '/media/sounds/../../secret.wav', '/media/%2e%2e/secret.wav', '/media/sounds\\beep.wav',
        '/private/beep.wav', 'media/beep.wav', 'https://example.com/media/beep.wav',
        '//example.com/media/beep.wav', '/media/white space.wav', 123, false, {}, []]) {
        assert.equal(serverSettingsSchema.safeParse({ [key]: value }).success, false, `${key}: ${String(value)}`);
        writeFileSync(file, JSON.stringify({ ...config, server: { ...config.server, [key]: value } }));
        assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
      }
      for (const invalid of [
        { ...config, [key]: defaultSound },
        { ...config, gameSetup: { ...defaults, [key]: defaultSound } },
        { ...config, server: { ...config.server, [key.toLowerCase()]: defaultSound } },
      ]) {
        writeFileSync(file, JSON.stringify(invalid));
        assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
      }
      for (const invalid of [
        { gameSetup: { [key]: defaultSound } },
        { gameSetup: {}, server: { [key]: defaultSound } },
        { gameSetup: {}, [key]: defaultSound },
      ]) {
        writeFileSync(path.join(directory, 'quizzes', '100001.json'), JSON.stringify(invalid));
        assert.throws(() => storage.load(100001), /Invalid quiz settings/);
      }
      const command = hostCommandSchema.parse({ id: randomUUID(), revision: 0,
        action: { type: 'setup', settings: { ...settings, [key]: null } } });
      if (command.action.type !== 'setup') assert.fail('Expected setup command');
      assert.deepEqual(command.action.settings, settings);
      assert.throws(() => storage.save(100001, settings), /Invalid quiz settings/);
      rmSync(path.join(directory, 'quizzes', '100001.json'));
      storage.save(100001, { ...settings, [key]: defaultSound });
      assert.deepEqual(storage.load(100001), withoutPointDefaults(settings));
      assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'quizzes', '100001.json'), 'utf8')), { gameSetup: withoutPointDefaults(settings) });
    }
    writeFileSync(file, JSON.stringify({ ...config, server: { ...config.server,
      countdownSound: '/media/countdown.wav', reviewCorrectSound: null, reviewWrongSound: '/media/wrong.wav' } }));
    const loaded = loadGlobalSettings(file, {}).server;
    assert.equal(loaded.countdownSound, '/media/countdown.wav');
    assert.equal(loaded.reviewCorrectSound, null);
    assert.equal(loaded.reviewWrongSound, '/media/wrong.wav');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('countdownSound defaults to a local WAV, accepts null and safe custom WAV paths, and is server-only', () => {
  const defaultSound = '/media/sounds/countdown-beep.wav';
  assert.equal(serverSettingsSchema.parse({}).countdownSound, defaultSound);
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-sound-settings-'));
  const file = path.join(directory, 'settings.json');
  const storage = new JsonQuizSettingsStorage(path.join(directory, 'quizzes'));
  const config = { branding, server: { port: 3000 }, gameSetup: defaults };
  try {
    for (const countdownSound of [null, defaultSound, '/media/custom/my-sound_2.WAV', '/media/beep.wav']) {
      assert.equal(serverSettingsSchema.parse({ countdownSound }).countdownSound, countdownSound);
      writeFileSync(file, JSON.stringify({ ...config, server: { ...config.server, countdownSound } }));
      assert.equal(loadGlobalSettings(file, {}).server.countdownSound, countdownSound);
    }
    for (const countdownSound of ['', '/media/sounds/beep.mp3', '/media/sounds/beep.wav?x=1',
      '/media/sounds/beep.wav#fragment', '/media/../secret.wav', '/media/%2e%2e/secret.wav',
      '/media/sounds\\beep.wav', '/private/beep.wav', 'media/beep.wav',
      'https://example.com/media/beep.wav', '//example.com/media/beep.wav', 123, false, {}]) {
      assert.equal(serverSettingsSchema.safeParse({ countdownSound }).success, false, String(countdownSound));
      writeFileSync(file, JSON.stringify({ ...config, server: { ...config.server, countdownSound } }));
      assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
    }
    for (const invalid of [
      { ...config, countdownSound: defaultSound },
      { ...config, gameSetup: { ...defaults, countdownSound: defaultSound } },
    ]) {
      writeFileSync(file, JSON.stringify(invalid));
      assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
    }
    writeFileSync(file, JSON.stringify(config));
    assert.equal(loadGlobalSettings(file, {}).server.countdownSound, defaultSound);
    storage.save(100001, { ...defaults, title: 'Quiz' });
    for (const invalid of [
      { gameSetup: { countdownSound: defaultSound } },
      { gameSetup: {}, server: { countdownSound: defaultSound } },
      { gameSetup: {}, countdownSound: defaultSound },
    ]) {
      writeFileSync(path.join(directory, 'quizzes', '100001.json'), JSON.stringify(invalid));
      assert.throws(() => storage.load(100001), /Invalid quiz settings/);
    }
    const settings = { ...defaults, title: 'Quiz' };
    const command = hostCommandSchema.parse({ id: randomUUID(), revision: 0,
      action: { type: 'setup', settings: { ...settings, countdownSound: null } } });
    if (command.action.type !== 'setup') assert.fail('Expected setup command');
    assert.deepEqual(command.action.settings, settings);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('removed typed-answer grace setting is rejected from global and archive configuration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-timer-settings-'));
  const file = path.join(directory, 'settings.json');
  const storage = new JsonQuizSettingsStorage(path.join(directory, 'quizzes'));
  const config = { branding, server: { port: 3000 }, gameSetup: defaults };
  try {
    assert.equal(serverSettingsSchema.safeParse({ typedAnswerGraceSeconds: 3 }).success, false);
    for (const invalid of [
      { ...config, typedAnswerGraceSeconds: 3 },
      { ...config, gameSetup: { ...defaults, typedAnswerGraceSeconds: 3 } },
      { ...config, server: { ...config.server, typedAnswerGraceSeconds: 3 } },
      { ...config, server: { ...config.server, timerEndOffsetSeconds: 10 } },
    ]) {
      writeFileSync(file, JSON.stringify(invalid));
      assert.throws(() => loadGlobalSettings(file, {}), /Unable to load global settings/);
    }
    const settings = { ...defaults, title: 'Quiz' };
    storage.save(100001, settings);
    for (const invalid of [
      { gameSetup: { typedAnswerGraceSeconds: 3 } },
      { gameSetup: {}, server: { typedAnswerGraceSeconds: 3 } },
      { gameSetup: {}, typedAnswerGraceSeconds: 3 },
    ]) {
      writeFileSync(path.join(directory, 'quizzes', '100001.json'), JSON.stringify(invalid));
      assert.throws(() => storage.load(100001), /Invalid quiz settings/);
    }
    const command = hostCommandSchema.parse({ id: randomUUID(), revision: 0,
      action: { type: 'setup', settings: { ...settings, typedAnswerGraceSeconds: 3 } } });
    assert.equal(command.action.type, 'setup');
    if (command.action.type !== 'setup') assert.fail('Expected setup command');
    assert.deepEqual(command.action.settings, settings, 'host setup cannot reintroduce a removed setting');
    assert.throws(() => storage.save(100001, settings), /Invalid quiz settings/);
    rmSync(path.join(directory, 'quizzes', '100001.json'));
    storage.save(100001, { ...settings, ...{ typedAnswerGraceSeconds: 3 } });
    assert.deepEqual(storage.load(100001), withoutPointDefaults(settings));
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'quizzes', '100001.json'), 'utf8')), { gameSetup: withoutPointDefaults(settings) });
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('global sections load defaults, respect environment overrides and reject invalid configuration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quiz-global-settings-'));
  const file = path.join(directory, 'settings.json');
  try {
    const serverDefaults = { startupQuizId: 100001, maxPlayerNameLength: 24, requireAdminPasscode: true, maxPlayers: 12, typeBuzzAnnouncementSeconds: 3,
      countdownSound: '/media/sounds/countdown-beep.wav',
      reviewCorrectSound: '/media/sounds/countdown-beep.wav', reviewWrongSound: '/media/sounds/countdown-beep.wav', endMusic: null };
    const config = { branding, server: { port: 3000, joinOrigin: 'http://example.com:3000' }, gameSetup: defaults };
    writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(loadGlobalSettings(file, {}), { ...config, server: { ...config.server, ...serverDefaults } });
    assert.deepEqual(loadGlobalSettings(file, { PORT: '4000', JOIN_ORIGIN: 'http://example.com:4000' }).server,
      { port: 4000, joinOrigin: 'http://example.com:4000', ...serverDefaults });
    assert.equal(loadGlobalSettings(file, { QUIZ_ID: '100002' }).server.startupQuizId, 100002);
    assert.throws(() => loadGlobalSettings(file, { QUIZ_ID: '0' }), /Unable to load global settings/);
    const customServer = { ...config.server, startupQuizId: 100001, maxPlayerNameLength: 32, requireAdminPasscode: false, maxPlayers: 20, typeBuzzAnnouncementSeconds: 7,
      countdownSound: '/media/custom/countdown.wav',
      reviewCorrectSound: '/media/custom/correct.wav', reviewWrongSound: '/media/custom/wrong.wav', endMusic: '/media/custom/end.mp3' };
    writeFileSync(file, JSON.stringify({ ...config, server: customServer }));
    assert.deepEqual(loadGlobalSettings(file, {}).server, customServer);
    writeFileSync(file, JSON.stringify(config));
    for (const PORT of ['0', '65536', '1.5', '', 'abc']) {
      assert.throws(() => loadGlobalSettings(file, { PORT }), /Unable to load global settings/);
    }
    for (const invalid of [
      { ...config, server: { port: 3000, lockoutSeconds: 10 } },
      { ...config, gameSetup: { ...defaults, port: 3000 } },
      { ...config, gameSetup: { ...defaults, title: 'Override' } },
      { ...config, gameSetup: { ...defaults, minimumPoints: 501 } },
      { ...config, gameSetup: { ...defaults, lockoutSeconds: 301 } },
      { ...config, gameSetup: { ...defaults, maxPlayers: 20 } },
      ...[0, 101, 1.5, '24'].map((maxPlayerNameLength) => ({
        ...config, server: { ...config.server, maxPlayerNameLength },
      })),
      ...[0, 1001, 1.5, '12'].map((maxPlayers) => ({ ...config, server: { ...config.server, maxPlayers } })),
      ...[0, 61, 1.5, '3'].map((typeBuzzAnnouncementSeconds) => ({ ...config, server: { ...config.server, typeBuzzAnnouncementSeconds } })),
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
    const saved = { startPoints: 800, ...withoutPointDefaults(settings) };
    assert.deepEqual(new JsonQuizSettingsStorage(directory).load(100001), saved);
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, '100001.json'), 'utf8')), { gameSetup: saved });
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
    assert.deepEqual(storage.load(100001), saved);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('setup saves before committing state; failed, stale, duplicate or mid-game commands do not write', () => {
  let time = 0;
  const game = new GameEngine({
    id: 100001, title: 'Quiz',
    questions: [{ id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' }],
  }, () => time);
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
    () => { writes++; }), /countdown/);
  time = 4000;
  game.tick();
  assert.throws(() => game.command({ ...command, id: randomUUID(), revision: game.revision },
    () => { writes++; }), /lobby/);
  assert.equal(writes, 1);
});

test('game setup cannot change point defaults even when a command includes different values', () => {
  const game = new GameEngine({ id: 1, title: 'Quiz', questions: [] });
  const before = { ...game.settings };
  let persisted: typeof before | undefined;
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'setup', settings: {
    ...before, title: 'Renamed', startPoints: 900, minimumPoints: 200, dropPoints: 50,
    dropEverySeconds: 2, pointDecayDelaySeconds: 10, lockoutSeconds: 12,
  } } }, (settings) => { persisted = settings; });
  for (const key of ['startPoints', 'minimumPoints', 'dropPoints', 'dropEverySeconds', 'pointDecayDelaySeconds'] as const) {
    assert.equal(game.settings[key], before[key]);
    assert.equal(persisted?.[key], before[key]);
  }
  assert.equal(game.settings.title, 'Renamed');
  assert.equal(game.settings.lockoutSeconds, 12);
});
