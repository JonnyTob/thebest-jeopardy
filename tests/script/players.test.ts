import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../../src/server/app.js';
import { avatars, type ClientEvents, type HostAction, type ServerEvents } from '../../src/shared/protocol.js';
import { joinLayoutPlayers, parsePlayerOptions } from '../../script/players.js';
import { createPlayerSimulator } from '../../script/simulatedPlayers.js';

test('player helper defaults, overrides and validation', () => {
  assert.deepEqual(parsePlayerOptions([]), { count: 12, url: 'http://localhost:3000', help: false, play: false });
  assert.deepEqual(parsePlayerOptions(['--count', '24', '--url', 'http://127.0.0.1:3100/']), {
    count: 24, url: 'http://127.0.0.1:3100', help: false, play: false,
  });
  assert.equal(parsePlayerOptions(['--help']).help, true);
  assert.equal(parsePlayerOptions(['--play']).play, true);
  for (const count of ['0', '-1', '1.5', '101', 'abc']) {
    assert.throws(() => parsePlayerOptions([`--count=${count}`]), /whole number/);
  }
  for (const url of ['ftp://localhost', 'http://localhost/play', 'http://user:secret@localhost', 'http://localhost?token=x']) {
    assert.throws(() => parsePlayerOptions(['--url', url]), /server origin/);
  }
  assert.throws(() => parsePlayerOptions(['--unknown']), /Unknown option/);
});

test('ten players join independently across a five-second window', { timeout: 10000 }, async (t) => {
  const application = await createApp({
    storage: { load: async () => ({ id: 1, title: 'Join timing', questions: [
      { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false,
  });
  let sockets: Awaited<ReturnType<typeof joinLayoutPlayers>> = [];
  const joinTimes: number[] = [];
  const join = application.engine.join.bind(application.engine);
  t.mock.method(application.engine, 'join', (input: Parameters<typeof join>[0]) => {
    const player = join(input);
    joinTimes.push(Date.now());
    return player;
  });
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const values = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.999];
    let index = 0;
    sockets = await joinLayoutPlayers({ count: 10, url: `http://127.0.0.1:${address.port}` }, undefined,
      { random: () => values[index++] });
    assert.equal(index, 10);
    assert.equal(joinTimes.length, 10);
    assert.ok(joinTimes[1] - joinTimes[0] >= 300, 'joins are not immediate');
    assert.ok(joinTimes[9] - joinTimes[0] >= 4800, 'the final join is scheduled near five seconds');
    assert.ok(joinTimes[9] - joinTimes[0] < 7000, 'delays are relative to one start, not cumulative');
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('cancelling while players are joining disconnects arrivals and cancels pending joins', { timeout: 7000 }, async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 1, title: 'Cancel joining', questions: [
      { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false,
  });
  const controller = new AbortController();
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    let index = 0;
    const joining = joinLayoutPlayers({ count: 4, url: `http://127.0.0.1:${address.port}` }, undefined,
      { signal: controller.signal, random: () => index++ === 0 ? 0 : 0.9 });
    const deadline = Date.now() + 2000;
    while (application.engine.players.size === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(application.engine.players.size, 1);
    controller.abort();
    await assert.rejects(joining, { name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 1900));
    assert.equal(application.engine.players.size, 1);
    assert.ok([...application.engine.players.values()].every((player) => !player.connected));
  } finally {
    controller.abort();
    await application.close();
  }
});

test('active players can answer while the rest of the batch is still joining', { timeout: 7000 }, async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const application = await createApp({
    storage: { load: async () => ({ id: 1, title: 'Early participation', questions: [
      { id: 'one', type: 'text', mode: 'typed', question: 'Clue', answer: 'Answer', fixedPoints: 100, timerSeconds: 10 },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false,
  });
  const simulator = createPlayerSimulator({ random: () => 0, log: () => {} });
  const controller = new AbortController();
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for an early simulated player.');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    let index = 0;
    simulator.start();
    const joining = joinLayoutPlayers({ count: 10, url: `http://127.0.0.1:${address.port}` }, simulator.attach,
      { signal: controller.signal, random: () => index++ === 0 ? 0 : 0.99 });
    await waitFor(() => application.engine.players.size === 1);
    application.engine.command({ id: randomUUID(), revision: application.engine.revision, action: { type: 'start' } });
    time += 4000;
    await waitFor(() => application.engine.snapshot().phase === 'QUESTION_OPEN');
    time += 1600;
    await waitFor(() => application.engine.snapshot().submissionCount === 1);
    assert.equal(application.engine.players.size, 1);
    controller.abort();
    await assert.rejects(joining, { name: 'AbortError' });
  } finally {
    controller.abort();
    simulator.stop();
    await application.close();
  }
});

test('active players use real sockets while the host controls all three modes', { timeout: 15000 }, async (t) => {
    let time = 0;
    t.mock.method(performance, 'now', () => time);
    const application = await createApp({
      storage: { load: async () => ({ id: 1, title: 'Simulation', questions: [
        { id: 'typed', type: 'text', mode: 'typed', question: 'Typed', answer: 'SECRET', fixedPoints: 100, timerSeconds: 10 },
        { id: 'buzz', type: 'text', mode: 'buzzer', question: 'Buzz', answer: 'SECRET', timerSeconds: 10 },
        { id: 'combined', type: 'text', mode: 'type-and-buzz', question: 'Combined', answer: 'SECRET',
          fixedPoints: 100, buzzPoints: 500, typingSeconds: 10, timerSeconds: 10 },
      ] }) },
      passcode: 'test-host-passcode', serveClient: false, gameSetup: { lockoutSeconds: 2 },
    });
    const messages: string[] = [];
    const errors: string[] = [];
    const simulator = createPlayerSimulator({ random: () => 0, log: (message) => messages.push(message), error: (message) => errors.push(message) });
    let host: Socket<ServerEvents, ClientEvents> | undefined;
    let players: Socket<ServerEvents, ClientEvents>[] = [];
    const waitFor = async (predicate: () => boolean, label: string) => {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}. Errors: ${errors.join('; ')}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const advance = async (ms: number, predicate: () => boolean, label: string) => {
      time += ms;
      await waitFor(predicate, label);
      await new Promise((resolve) => setTimeout(resolve, 50));
    };
    try {
      await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
      const address = application.httpServer.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      players = await joinLayoutPlayers({ count: 1, url }, simulator.attach);
      host = io(url, { auth: { role: 'host', passcode: 'test-host-passcode' }, reconnection: false });
      await new Promise<void>((resolve, reject) => {
        host!.once('connect', resolve);
        host!.once('connect_error', reject);
      });
      const command = async (action: HostAction) => {
        const result = await host!.timeout(5000).emitWithAck('host:command', { id: randomUUID(), revision: application.engine.revision, action });
        assert.equal(result.ok, true, result.ok ? '' : result.error);
        await new Promise((resolve) => setTimeout(resolve, 50));
      };
      simulator.start();
      await command({ type: 'start' });
      await advance(4000, () => application.engine.snapshot().phase === 'QUESTION_OPEN', 'typed question');
      await command({ type: 'pause' });
      time += 5000;
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(application.engine.snapshot().submissionCount, 0, 'players do not submit while paused');
      await command({ type: 'resume' });
      await advance(1600, () => application.engine.snapshot().submissionCount === 1, 'typed submission');
      assert.match(application.engine.snapshot(true).hostSubmissions![0].answer!, /Simulated answer/);
      await command({ type: 'close' });
      await command({ type: 'startReview' });
      await command({ type: 'judgeReview', correct: true });
      await advance(2000, () => application.engine.snapshot().phase === 'NEXT_ROUND', 'next round');
      await advance(3000, () => application.engine.snapshot().phase === 'QUESTION_OPEN', 'buzzer question');
      await advance(2100, () => application.engine.snapshot().phase === 'ANSWERING', 'first buzz');
      const buzzerPlayer = application.engine.snapshot().activePlayerId;
      assert.ok(buzzerPlayer);
      await command({ type: 'judge', correct: false });
      await advance(2000, () => application.engine.snapshot().phase === 'QUESTION_OPEN', 'buzz reopen');
      time += 1000;
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(application.engine.snapshot().phase, 'QUESTION_OPEN', 'locked-out player does not buzz again');
      await advance(1100, () => application.engine.snapshot().phase === 'ANSWERING', 'buzz after lockout expires');
      await command({ type: 'judge', correct: false });
      await advance(2000, () => application.engine.snapshot().phase === 'QUESTION_OPEN', 'second buzz reopen');
      await command({ type: 'close' });
      await command({ type: 'next' });
      await advance(3000, () => application.engine.snapshot().phase === 'NEXT_ROUND', 'combined countdown');
      await advance(3000, () => application.engine.snapshot().phase === 'QUESTION_OPEN', 'combined question');
      await advance(1600, () => application.engine.snapshot().submissionCount === 1, 'combined submission');
      await advance(1100, () => application.engine.snapshot().phase === 'ANSWERING', 'early combined buzz');
      assert.equal(application.engine.snapshot().submissionsClosed, true);
      await command({ type: 'judge', correct: true });
      await advance(3000, () => application.engine.snapshot().phase === 'QUESTION_CLOSED', 'combined review');
      assert.equal(application.engine.snapshot().reviewCount, 0, 'correct buzzer winner has no typed award');
      await command({ type: 'startReview' });
      assert.equal(application.engine.snapshot().phase, 'GAME_FINISHED');
      assert.equal(application.engine.players.get(buzzerPlayer)?.score, 100);
      assert.ok(messages.some((message) => message.includes('submitted')));
      assert.ok(messages.some((message) => message.includes('Suggested ruling')));
      assert.deepEqual(errors, []);
    } finally {
      simulator.stop();
      for (const player of players) player.disconnect();
      host?.disconnect();
      await application.close();
    }
});

test('CLI --play submits an answer without operating the host', { timeout: 15000 }, async () => {
    const application = await createApp({
      storage: { load: async () => ({ id: 1, title: 'Active test', questions: [
        { id: 'one', type: 'text', mode: 'typed', question: 'Clue', answer: 'SECRET', fixedPoints: 100, timerSeconds: 2 },
      ] }) },
      passcode: 'test-host-passcode', serveClient: false, serverSettings: { maxPlayerNameLength: 10 },
    });
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const child = spawn(process.execPath, [
      '--import', 'tsx', 'script/players.ts', '--play', '--count', '10', '--url', `http://127.0.0.1:${address.port}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
    const waitFor = async (predicate: () => boolean, label: string) => {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        if (child.exitCode !== null || Date.now() >= deadline) throw new Error(`Waiting for ${label}: ${output}\n${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    try {
      await waitFor(() => output.includes('10 players joined and connected'), 'players');
      assert.equal(application.engine.players.size, 10);
      assert.ok([...application.engine.players.values()].every((player) => player.name.length <= 10));
      assert.equal(application.engine.snapshot().phase, 'LOBBY', 'the simulator does not start the game');
      application.engine.command({ id: randomUUID(), revision: application.engine.revision, action: { type: 'start' } });
      await waitFor(() => application.engine.snapshot().submissionCount >= 1, 'simulated submission');
      assert.equal(application.engine.snapshot().phase, 'QUESTION_OPEN');
      await waitFor(() => output.includes('submitted "'), 'submission log');
      child.kill('SIGINT');
      const [code] = await exited;
      assert.equal(code, 0, errors);
      assert.equal(application.engine.players.size, 10);
      assert.ok([...application.engine.players.values()].every((player) => player.score === 0));
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
      await application.close();
    }
});

test('short nickname limits retry collisions and reject impossible batch sizes', { timeout: 15000 }, async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 1, title: 'Short names', questions: [
      { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'SECRET' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false,
    serverSettings: { maxPlayerNameLength: 1, maxPlayers: 100 },
  });
  let sockets: Awaited<ReturnType<typeof joinLayoutPlayers>> = [];
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    await assert.rejects(joinLayoutPlayers({ count: 37, url }), /Cannot generate 37 distinct names/);
    assert.equal(application.engine.players.size, 0);
    for (const name of '0123456789abcdefghijklmnopqrstuvwxy') {
      application.engine.join({ name, avatarId: 'fox' });
    }
    sockets = await joinLayoutPlayers({ count: 1, url });
    const names = [...application.engine.players.values()].map((player) => player.name);
    assert.equal(names.length, 36);
    assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 36);
    assert.ok(names.includes('z'));
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('CLI Ctrl+C cancels a batch while players are still joining', { timeout: 10000 }, async () => {
  const application = await createApp({
    storage: { load: async () => ({ id: 1, title: 'Interrupted joins', questions: [
      { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false,
  });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const child = spawn(process.execPath, [
    '--import', 'tsx', 'script/players.ts', '--count', '20', '--url', `http://127.0.0.1:${address.port}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  try {
    const deadline = Date.now() + 5000;
    while (application.engine.players.size === 0 && child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const joined = application.engine.players.size;
    assert.ok(joined > 0 && joined < 20, `Expected a partial batch, got ${joined}: ${errors}`);
    child.kill('SIGINT');
    const [code] = await exited;
    assert.equal(code, 0, errors);
    const afterExit = application.engine.players.size;
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(application.engine.players.size, afterExit);
    assert.ok([...application.engine.players.values()].every((player) => !player.connected));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
    await application.close();
  }
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
