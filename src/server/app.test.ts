import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';
import { createApp } from './app.js';
import { JsonQuizSettingsStorage } from './settings.js';
import type { ClientEvents, ServerEvents, Snapshot, Result, HostAction } from '../shared/protocol.js';

test('media finish broadcasts the visual clock and accepts skip only from an authenticated host', async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const application = await createApp({ storage: { load: async () => ({ id: 1, title: 'Media socket quiz', questions: [
    { id: 'one', type: 'audio', question: 'Current', answer: 'SECRET', media: '/media/examples/chimes.wav' },
    { id: 'two', type: 'text', question: 'FUTURE', answer: 'SECRET TWO' },
  ] }) }, passcode: 'test-host-passcode', serveClient: false });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  function waitFor(socket: Socket<ServerEvents, ClientEvents>, predicate: (state: Snapshot) => boolean) {
    return new Promise<Snapshot>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('session:snapshot', listener); reject(new Error('Timed out waiting for media')); }, 5000);
      function listener(state: Snapshot) {
        if (!predicate(state)) return;
        clearTimeout(timeout); socket.off('session:snapshot', listener); resolve(state);
      }
      socket.on('session:snapshot', listener);
    });
  }
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`, { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      const initial = waitFor(socket, () => true); socket.connect();
      return { socket, state: await initial };
    };
    const { socket: host } = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const { socket: display } = await connect({ role: 'display' });
    const { socket: player } = await connect({ role: 'player' });
    const joined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    assert.ok(joined.ok);
    const send = async (socket: Socket<ServerEvents, ClientEvents>, action: HostAction) => socket.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action,
    });
    assert.ok((await send(host, { type: 'start' })).ok);
    const opened = waitFor(display, (state) => state.phase === 'QUESTION_OPEN');
    time = 4000; await opened;
    time = 5000;
    assert.ok((await player.timeout(5000).emitWithAck('player:buzz')).ok);
    assert.ok((await send(host, { type: 'judge', correct: true })).ok);
    const finishing = waitFor(display, (state) => state.phase === 'MEDIA_FINISH');
    time = 7000;
    const started = await finishing;
    assert.equal(started.mediaFinishRemainingMs, 7000);
    assert.equal(started.clockRunning, false);
    assert.equal(started.displayClockRunning, true);
    const updated = waitFor(display, (state) => state.phase === 'MEDIA_FINISH' && state.mediaPositionSeconds === 3);
    time = 9000;
    const moving = await updated;
    assert.equal(moving.clueElapsedMs, 1000);
    assert.equal(moving.mediaFinishRemainingMs, 5000);
    assert.doesNotMatch(JSON.stringify(moving), /SECRET|FUTURE/);
    const reconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(reconnect.state.mediaPositionSeconds, 3);
    assert.equal(reconnect.state.displayClockRunning, true);
    assert.equal((await send(player, { type: 'skipMedia' })).ok, false);
    assert.equal(application.engine.snapshot().phase, 'MEDIA_FINISH');
    assert.ok((await send(host, { type: 'skipMedia' })).ok);
    assert.equal(application.engine.snapshot().phase, 'NEXT_ROUND');
    assert.equal(application.engine.snapshot().nextRoundCountdownMs, 3000);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('buzzer result and automatic transitions broadcast to players and displays including reconnects', async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const application = await createApp({
    storage: { load: async () => ({ id: 100001, title: 'Buzzer socket quiz', questions: [
      { id: 'one', type: 'text', question: 'First', answer: 'SECRET ONE' },
      { id: 'two', type: 'text', question: 'Second', answer: 'SECRET TWO' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false, gameSetup: { lockoutSeconds: 1 },
  });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  function waitFor(socket: Socket<ServerEvents, ClientEvents>, predicate: (state: Snapshot) => boolean) {
    return new Promise<Snapshot>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('session:snapshot', listener); reject(new Error('Timed out waiting for snapshot')); }, 5000);
      function listener(state: Snapshot) {
        if (!predicate(state)) return;
        clearTimeout(timeout);
        socket.off('session:snapshot', listener);
        resolve(state);
      }
      socket.on('session:snapshot', listener);
    });
  }
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`, { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      const initial = waitFor(socket, () => true);
      socket.connect();
      return { socket, state: await initial };
    };
    const { socket: host } = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const { socket: display } = await connect({ role: 'display' });
    const { socket: player } = await connect({ role: 'player' });
    const joined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    assert.ok(joined.ok);
    const send = async (action: HostAction) => host.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action,
    });
    assert.ok((await send({ type: 'start' })).ok);
    const open = waitFor(display, (state) => state.phase === 'QUESTION_OPEN');
    time = 4000;
    const first = await open;
    assert.ok((await player.timeout(5000).emitWithAck('player:buzz')).ok);
    const wrongBroadcast = waitFor(display, (state) => state.phase === 'BUZZ_RESULT');
    assert.ok((await send({ type: 'judge', correct: false })).ok);
    const wrong = await wrongBroadcast;
    assert.equal(wrong.buzzResult?.playerId, joined.data.playerId);
    assert.equal(wrong.buzzResult?.correct, false);
    assert.equal(wrong.buzzResult?.delta, -500);
    assert.equal(wrong.buzzResult?.remainingMs, 2000);
    assert.equal(wrong.players[0].score, -500);
    assert.equal((await player.timeout(5000).emitWithAck('player:buzz')).ok, false);
    assert.equal((await send({ type: 'adjust', playerId: joined.data.playerId, delta: 50 })).ok, false);
    time = 5000;
    const reconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(reconnect.state.buzzResult?.id, wrong.buzzResult?.id);
    assert.equal(reconnect.state.buzzResult?.remainingMs, 1000);
    assert.deepEqual(reconnect.state.lockedOutIds, [joined.data.playerId]);
    const reopened = waitFor(display, (state) => state.phase === 'QUESTION_OPEN' && state.buzzResult === null);
    time = 7000;
    const resumed = await reopened;
    assert.equal(resumed.questionInstanceId, first.questionInstanceId);
    assert.equal(resumed.clueElapsedMs, 0);
    assert.equal(resumed.clockRunning, true);
    assert.equal((await player.timeout(5000).emitWithAck('player:buzz')).ok, false);
    time += 1000;
    assert.ok((await player.timeout(5000).emitWithAck('player:buzz')).ok);
    const correctBroadcast = waitFor(display, (state) => state.phase === 'BUZZ_RESULT');
    assert.ok((await send({ type: 'judge', correct: true })).ok);
    const correct = await correctBroadcast;
    assert.notEqual(correct.buzzResult?.id, wrong.buzzResult?.id);
    assert.equal(correct.buzzResult?.delta, 500);
    assert.equal(correct.buzzResult?.correct, true);
    assert.doesNotMatch(JSON.stringify(correct), /SECRET/);
    const next = waitFor(player, (state) => state.phase === 'NEXT_ROUND');
    time = 11000;
    const transition = await next;
    assert.equal(transition.buzzResult, null);
    assert.equal(transition.nextRoundCountdownMs, 3000);
    assert.equal(transition.questionInstanceId, first.questionInstanceId);
    const second = waitFor(display, (state) => state.phase === 'QUESTION_OPEN' && state.questionIndex === 1);
    time = 14000;
    assert.equal((await second).clueElapsedMs, 0);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('server interval broadcasts typed auto-close, next-round countdowns and fresh clues without leaking future content', async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const application = await createApp({
    storage: { load: async () => ({ id: 100001, title: 'Timed socket quiz', questions: [
      { id: 'one', type: 'text', mode: 'typed', fixedPoints: 250, timerSeconds: 2,
        question: 'Current clue', answer: 'CURRENT SECRET' },
      { id: 'two', type: 'text', mode: 'typed', fixedPoints: 400, timerSeconds: 2,
        question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
    ] }) },
    passcode: 'test-host-passcode', serveClient: false, serverSettings: { TimerEndOffsetSeconds: 1 },
  });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  const publicStates: Snapshot[] = [];
  function waitFor(socket: Socket<ServerEvents, ClientEvents>, predicate: (state: Snapshot) => boolean) {
    return new Promise<Snapshot>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('session:snapshot', listener);
        reject(new Error('Timed out waiting for expected snapshot'));
      }, 5000);
      function listener(state: Snapshot) {
        if (!predicate(state)) return;
        clearTimeout(timeout);
        socket.off('session:snapshot', listener);
        resolve(state);
      }
      socket.on('session:snapshot', listener);
    });
  }
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`,
        { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      if (auth.role !== 'host') socket.on('session:snapshot', (state) => publicStates.push(state));
      const initial = waitFor(socket, () => true);
      socket.connect();
      return { socket, state: await initial };
    };
    const { socket: host } = await connect({ role: 'host', passcode: 'test-host-passcode' });
    const { socket: display } = await connect({ role: 'display' });
    const { socket: player } = await connect({ role: 'player' });
    const joined = await player.timeout(5000).emitWithAck('player:join', { name: 'Alice', avatarId: 'fox' });
    assert.ok(joined.ok);
    const send = async (action: HostAction) => {
      const result = await host.timeout(5000).emitWithAck('host:command', {
        id: randomUUID(), revision: application.engine.revision, action,
      });
      assert.ok(result.ok, JSON.stringify(result));
    };
    await send({ type: 'start' });
    assert.equal(application.engine.snapshot().startCountdownMs, 4000);
    const startId = application.engine.snapshot().countdownId;
    assert.ok(startId);
    const startingReconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(startingReconnect.state.phase, 'STARTING');
    assert.equal(startingReconnect.state.countdownId, startId);
    assert.equal((await connect({ role: 'display' })).state.countdownId, startId);
    const opened = waitFor(player, (state) => state.phase === 'QUESTION_OPEN');
    time = 4000;
    const first = await opened;
    assert.equal(first.countdownId, null);
    assert.equal(first.clueElapsedMs, 0);
    assert.equal(first.serverSettings.TimerEndOffsetSeconds, 1);
    const submitted = await player.timeout(5000).emitWithAck('player:submitAnswer', {
      questionInstanceId: first.questionInstanceId!, answer: 'PRIVATE GUESS',
    });
    assert.ok(submitted.ok);
    const beforeDeadline = waitFor(display, (state) => state.clueElapsedMs === 2999);
    time = 6999;
    assert.equal((await beforeDeadline).phase, 'QUESTION_OPEN');
    const closed = waitFor(display, (state) => state.phase === 'QUESTION_CLOSED');
    time = 7000;
    assert.equal((await closed).clueElapsedMs, 3000);
    await send({ type: 'judgeSubmission', playerId: joined.data.playerId, correct: true });
    assert.equal(application.engine.snapshot().phase, 'REVIEW_GROUP');
    const groupId = application.engine.snapshot().reviewGroup?.id;
    assert.ok(groupId);
    const reconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(reconnect.state.phase, 'REVIEW_GROUP');
    assert.equal(reconnect.state.reviewGroup?.id, groupId);
    assert.deepEqual(reconnect.state.reviewGroup?.playerIds, [joined.data.playerId]);
    assert.equal(reconnect.state.reviewGroup?.points, 250);
    assert.equal(reconnect.state.mySubmitted, true);
    assert.equal(reconnect.state.review, null);
    const revision = application.engine.revision;
    const countdown = waitFor(display, (state) => state.reviewGroup?.remainingMs === 3000);
    time = 8000;
    const countdownState = await countdown;
    assert.equal(countdownState.revision, revision, 'countdowns broadcast even without revision changes');
    assert.equal(countdownState.reviewGroup?.id, groupId);
    const undone = waitFor(display, (state) => state.phase === 'QUESTION_CLOSED');
    await send({ type: 'undo' });
    const undoneState = await undone;
    assert.equal(undoneState.nextRoundCountdownMs, null);
    assert.equal(undoneState.countdownId, null);
    time = 11000;
    const afterUndo = await connect({ role: 'display' });
    assert.equal(afterUndo.state.phase, 'QUESTION_CLOSED');
    assert.equal(afterUndo.state.players[0].score, 0);
    await send({ type: 'judgeSubmission', playerId: joined.data.playerId, correct: true });
    assert.notEqual(application.engine.snapshot().reviewGroup?.id, groupId);
    const nextRound = waitFor(display, (state) => state.phase === 'NEXT_ROUND');
    time = 15000;
    await nextRound;
    const rearmedId = application.engine.snapshot().countdownId;
    assert.ok(rearmedId);
    assert.notEqual(rearmedId, startId);
    const lastMillisecond = waitFor(display, (state) => state.nextRoundCountdownMs === 1);
    time = 17999;
    const transition = await lastMillisecond;
    assert.equal(transition.countdownId, rearmedId);
    assert.equal(transition.questionInstanceId, first.questionInstanceId);
    for (const state of publicStates) {
      assert.equal(state.hostSubmissions, undefined);
      assert.equal(state.privateAnswer, undefined);
      assert.doesNotMatch(JSON.stringify(state), /PRIVATE GUESS|CURRENT SECRET|FUTURE/);
    }
    const next = waitFor(player, (state) => state.phase === 'QUESTION_OPEN' && state.questionIndex === 1);
    time = 18000;
    const second = await next;
    assert.equal(second.question?.question, 'FUTURE CLUE');
    assert.notEqual(second.questionInstanceId, first.questionInstanceId);
    assert.equal(second.clueElapsedMs, 0);
    assert.equal(second.nextRoundCountdownMs, null);
    assert.equal(second.countdownId, null);
    assert.equal(second.mySubmitted, false);
    const stale = await player.timeout(5000).emitWithAck('player:submitAnswer', {
      questionInstanceId: first.questionInstanceId!, answer: 'Old answer',
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.match(stale.error, /changed/);
    const lastClosed = waitFor(display, (state) => state.phase === 'QUESTION_CLOSED' && state.questionIndex === 1);
    time = 21000;
    await lastClosed;
    await send({ type: 'startReview' });
    const finished = waitFor(display, (state) => state.phase === 'GAME_FINISHED');
    const resultBroadcast = waitFor(display, (state) => state.reviewResultId !== null);
    await send({ type: 'judgeReview', correct: false });
    const result = application.engine.snapshot();
    assert.equal(result.phase, 'REVIEW');
    assert.ok(result.reviewResultId);
    assert.equal(result.reviewRemainingMs, 2000);
    const displayResult = await resultBroadcast;
    assert.equal(displayResult.reviewResultId, result.reviewResultId);
    assert.equal(displayResult.reviewRemainingMs, 2000);
    assert.equal(displayResult.review?.correct, false);
    time = 21999;
    const reviewReconnect = await connect({ role: 'player', token: joined.data.token });
    assert.equal(reviewReconnect.state.reviewResultId, result.reviewResultId);
    assert.equal(reviewReconnect.state.reviewRemainingMs, 1001);
    assert.equal(reviewReconnect.state.review?.correct, false);
    time = 23000;
    const final = await finished;
    assert.equal(final.nextRoundCountdownMs, null);
    assert.equal(final.players[0].score, 250);
    assert.equal(final.questionIndex, 1);
    for (const state of publicStates) assert.doesNotMatch(JSON.stringify(state), /PRIVATE GUESS|CURRENT SECRET|FUTURE SECRET/);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

test('mixed review groups broadcast only the current group and retain private host submissions', async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const application = await createApp({ storage: { load: async () => ({ id: 1, title: 'Groups', questions: [
    { id: 'one', type: 'text', mode: 'typed', fixedPoints: 250, timerSeconds: 30, question: 'Clue', answer: 'SECRET' },
    { id: 'two', type: 'text', question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
  ] }) }, passcode: 'host-passcode', serveClient: false });
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  function waitFor(socket: Socket<ServerEvents, ClientEvents>, predicate: (state: Snapshot) => boolean) {
    return new Promise<Snapshot>((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('session:snapshot', listener); reject(new Error('Timed out waiting for group')); }, 5000);
      function listener(state: Snapshot) {
        if (!predicate(state)) return;
        clearTimeout(timeout); socket.off('session:snapshot', listener); resolve(state);
      }
      socket.on('session:snapshot', listener);
    });
  }
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const connect = async (auth: Record<string, string>) => {
      const socket: Socket<ServerEvents, ClientEvents> = io(`http://127.0.0.1:${address.port}`, { auth, autoConnect: false, reconnection: false });
      sockets.push(socket);
      const initial = waitFor(socket, () => true); socket.connect();
      return { socket, state: await initial };
    };
    const { socket: host } = await connect({ role: 'host', passcode: 'host-passcode' });
    const { socket: display } = await connect({ role: 'display' });
    const participants = [];
    for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) {
      const { socket } = await connect({ role: 'player' });
      const joined = await socket.timeout(5000).emitWithAck('player:join', { name, avatarId: 'fox' });
      assert.ok(joined.ok);
      participants.push({ socket, ...joined.data });
    }
    const [alice, bob, carol, dave] = participants;
    const send = (socket: Socket<ServerEvents, ClientEvents>, action: HostAction) => socket.timeout(5000).emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action,
    });
    assert.ok((await send(host, { type: 'start' })).ok);
    const opened = waitFor(display, (state) => state.phase === 'QUESTION_OPEN');
    time = 4000; const state = await opened;
    for (const player of [alice, bob, carol]) {
      assert.ok((await player.socket.timeout(5000).emitWithAck('player:submitAnswer', {
        questionInstanceId: state.questionInstanceId!, answer: `PRIVATE ${player.playerId}`,
      })).ok);
    }
    assert.ok((await send(host, { type: 'close' })).ok);
    assert.ok((await send(host, { type: 'judgeSubmission', playerId: alice.playerId, correct: true })).ok);
    assert.ok((await send(host, { type: 'judgeSubmission', playerId: bob.playerId, correct: false })).ok);
    assert.ok((await send(host, { type: 'judgeSubmission', playerId: dave.playerId, correct: false })).ok);
    const firstBroadcast = waitFor(display, (snapshot) => snapshot.reviewGroup?.outcome === 'correct');
    assert.ok((await send(host, { type: 'startReview' })).ok);
    const first = await firstBroadcast;
    assert.deepEqual(first.reviewGroup?.playerIds, [alice.playerId]);
    assert.equal(first.review, null);
    assert.equal(first.hostSubmissions, undefined);
    assert.doesNotMatch(JSON.stringify(first), /PRIVATE|SECRET|FUTURE/);
    assert.equal((await send(alice.socket, { type: 'undo' })).ok, false);
    assert.equal((await send(host, { type: 'adjust', playerId: alice.playerId, delta: 10 })).ok, false);
    const hostReconnect = await connect({ role: 'host', passcode: 'host-passcode' });
    assert.equal(hostReconnect.state.hostSubmissions?.length, 4);
    assert.equal(hostReconnect.state.hostSubmissions?.[2].answer, `PRIVATE ${carol.playerId}`);
    const reconnect = await connect({ role: 'player', token: bob.token });
    assert.equal(reconnect.state.reviewGroup?.id, first.reviewGroup?.id);
    assert.equal(reconnect.state.hostSubmissions, undefined);
    const wrongBroadcast = waitFor(display, (snapshot) => snapshot.reviewGroup?.outcome === 'wrong');
    time = 15000; const wrong = await wrongBroadcast;
    assert.notEqual(wrong.reviewGroup?.id, first.reviewGroup?.id);
    assert.deepEqual(wrong.reviewGroup?.playerIds, [bob.playerId, dave.playerId]);
    assert.equal(wrong.reviewGroup?.remainingMs, 4000);
    assert.equal(wrong.reviewGroup?.points, 0);
    assert.doesNotMatch(JSON.stringify(wrong), /PRIVATE|SECRET|FUTURE/);
    const reviewBroadcast = waitFor(display, (snapshot) => snapshot.phase === 'REVIEW');
    time = 19000; const review = await reviewBroadcast;
    assert.equal(review.reviewGroup, null);
    assert.equal(review.review?.playerId, carol.playerId);
    assert.equal(review.review?.answer, `PRIVATE ${carol.playerId}`);
    assert.equal(application.engine.snapshot(true).scoreEvents.length, 3);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await application.close();
  }
});

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
    assert.deepEqual(info.serverSettings, { maxPlayerNameLength: 32, maxPlayers: 1, requireAdminPasscode: true,
      TimerEndOffsetSeconds: 0, countdownSound: '/media/sounds/countdown-beep.wav',
      reviewCorrectSound: '/media/sounds/countdown-beep.wav', reviewWrongSound: '/media/sounds/countdown-beep.wav' });
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
        assert.equal(application.engine.snapshot().phase, 'STARTING');
        assert.equal(application.engine.snapshot(true).privateAnswer, undefined);
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
    serverSettings: { TimerEndOffsetSeconds: 7 },
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
      assert.equal(snapshot.serverSettings.TimerEndOffsetSeconds, 7);
      const info = await (await fetch(`http://127.0.0.1:${address.port}/api/info`)).json();
      assert.equal(info.serverSettings.TimerEndOffsetSeconds, 7);
      const saved = { ...snapshot.settings, title: 'Persisted title', lockoutSeconds: 15 };
      const result = await socket.timeout(5000).emitWithAck('host:command', {
        id: randomUUID(), revision: snapshot.revision,
        action: { type: 'setup', settings: { ...saved, ...{ TimerEndOffsetSeconds: 300 } } },
      });
      assert.ok(result.ok);
      assert.equal(application.engine.snapshot().serverSettings.TimerEndOffsetSeconds, 7);
      assert.deepEqual(application.engine.settings, saved);
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
      assert.equal(restarted.engine.snapshot().serverSettings.TimerEndOffsetSeconds, 7);
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
    const opened = new Promise<void>((resolve) => {
      display.on('session:snapshot', function listener(state) {
        if (state.phase === 'QUESTION_OPEN') {
          display.off('session:snapshot', listener);
          resolve();
        }
      });
    });
    const started = await host.emitWithAck('host:command', {
      id: randomUUID(), revision: application.engine.revision, action: { type: 'start' },
    });
    assert.ok(started.ok);
    assert.equal(application.engine.snapshot().phase, 'STARTING');
    assert.equal(application.engine.snapshot().question, null);
    const earlyBuzz = await alice.emitWithAck('player:buzz');
    assert.equal(earlyBuzz.ok, false);
    const lateDisplay = await connect({ role: 'display' });
    assert.equal(snapshots.get(lateDisplay)?.phase, 'STARTING');
    assert.ok((snapshots.get(lateDisplay)?.startCountdownMs ?? 0) > 0);
    await opened;
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
    const soundPath = application.engine.snapshot().serverSettings.countdownSound;
    assert.equal(soundPath, '/media/sounds/countdown-beep.wav');
    const sound = await fetch(base + soundPath);
    assert.equal(sound.status, 200);
    assert.match(sound.headers.get('content-type') ?? '', /audio\/(wav|wave|x-wav)/i);
    const bytes = Buffer.from(await sound.arrayBuffer());
    assert.deepEqual(bytes, readFileSync(path.resolve('src/public', soundPath.slice(1))));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    for (const file of ['src/server/index.ts', 'settings.json']) {
      const response = await fetch(`${base}/@fs${path.resolve(file)}`);
      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /A rocket/);
    }
  } finally {
    await application.close();
  }
});
