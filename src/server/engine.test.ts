import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameEngine } from './engine.js';
import type { HostAction, Quiz } from '../shared/protocol.js';
import { START_COUNTDOWN_MS, NEXT_ROUND_MS } from '../shared/game.js';

const quiz: Quiz = {
  id: 100001,
  title: 'Test Quiz',
  questions: [
    { id: 'one', type: 'text', question: 'First question?', answer: 'SECRET FIRST' },
    { id: 'two', type: 'text', question: 'Second question?', answer: 'SECRET SECOND' },
  ],
};
function setup() {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const command = (action: HostAction) => {
    game.command({ id: randomUUID(), revision: game.revision, action });
    if (action.type === 'start') { time += START_COUNTDOWN_MS; game.tick(); }
  };
  return { game, alice, bob, command, advance: (ms: number) => { time += ms; } };
}

test('game-start countdown hides the first clue, rejects early play and opens once at the exact boundary', () => {
  for (const mode of ['buzzer', 'typed'] as const) {
    let time = 0;
    const game = new GameEngine({ ...quiz, questions: [
      { ...quiz.questions[0], mode, fixedPoints: 250, timerSeconds: 30 },
    ] }, () => time);
    const player = game.join({ name: 'Alice', avatarId: 'fox' });
    const start = { id: randomUUID(), revision: game.revision, action: { type: 'start' } } as const;
    assert.equal(game.snapshot().countdownId, null);
    game.command(start);
    const revision = game.revision;
    assert.equal(game.snapshot().phase, 'STARTING');
    const countdownId = game.snapshot().countdownId;
    assert.ok(countdownId);
    assert.equal(game.snapshot(true).countdownId, countdownId);
    assert.equal(game.snapshot(false, player.id).countdownId, countdownId);
    assert.equal(game.snapshot().startCountdownMs, 4000);
    assert.equal(game.snapshot().question, null);
    assert.equal(game.snapshot(true).privateAnswer, undefined);
    assert.equal(game.snapshot().questionIndex, -1);
    assert.equal(game.snapshot().questionInstanceId, null);
    assert.equal(game.snapshot().clockRunning, false);
    for (const action of [{ type: 'start' }, { type: 'reset' }, { type: 'close' },
      { type: 'next' }, { type: 'pause' }, { type: 'undo' },
      { type: 'adjust', playerId: player.id, delta: 100 }] satisfies HostAction[]) {
      assert.throws(() => game.command({ id: randomUUID(), revision: game.revision, action }), /countdown/);
    }
    assert.throws(() => game.buzz(player.id), /not open/);
    assert.throws(() => game.submitAnswer(player.id, 'early', 'hello'), /not open/);
    time = 1250;
    game.tick();
    assert.equal(game.revision, revision, 'Countdown updates do not invalidate commands');
    assert.equal(game.snapshot().startCountdownMs, 2750, 'Reconnecting clients see the current countdown');
    game.join({ name: 'Late player', avatarId: 'cat' });
    game.setConnected(player.id, false);
    game.setConnected(player.id, true);
    game.command(start);
    assert.equal(game.snapshot().countdownId, countdownId, 'reconnect and duplicate start preserve the countdown ID');
    assert.equal(game.snapshot().startCountdownMs, 2750, 'Duplicate start must not restart the countdown');
    time = 3999;
    game.tick();
    assert.equal(game.snapshot().phase, 'STARTING');
    assert.equal(game.snapshot().clueElapsedMs, 0);
    assert.equal(game.snapshot().mediaPositionSeconds, 0);
    assert.equal(game.snapshot().revealProgress, 0);
    time = 4000;
    const beforeOpen = game.revision;
    game.tick();
    assert.equal(game.revision, beforeOpen + 1);
    assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
    assert.equal(game.snapshot().countdownId, null);
    assert.equal(game.snapshot().startCountdownMs, null);
    assert.equal(game.snapshot().questionIndex, 0);
    assert.equal(game.snapshot().clueElapsedMs, 0);
    assert.equal(game.snapshot().clockRunning, true);
    const instance = game.snapshot().questionInstanceId!;
    if (mode === 'typed') game.submitAnswer(player.id, instance, 'hello');
    else game.buzz(player.id);
    const afterPlay = game.revision;
    time = 10000;
    game.tick();
    assert.equal(game.revision, afterPlay);
    assert.equal(game.snapshot().questionInstanceId, instance);
    assert.equal(game.snapshot().countdownId, null);
    assert.throws(() => game.command({ id: randomUUID(), revision: start.revision, action: { type: 'reset' } }), /state changed/);
  }
});

test('a late server tick opens the first clue with its full time budget', () => {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  time = 10000;
  game.tick();
  assert.equal(game.snapshot().clueElapsedMs, 0);
  assert.equal(game.snapshot().currentPoints, game.settings.startPoints);
  assert.equal(game.snapshot().mediaPositionSeconds, 0);
});

test('quiz ID stays stable across title edits, question resets and new sessions', () => {
  const { game, command, advance } = setup();
  assert.equal(game.snapshot().quizId, quiz.id);
  assert.equal(game.snapshot(true).quizId, quiz.id);
  command({ type: 'setup', settings: { ...game.settings, title: 'Renamed Quiz' } });
  assert.equal(game.snapshot().settings.title, 'Renamed Quiz');
  assert.equal(game.snapshot().quizId, quiz.id);
  command({ type: 'start' });
  command({ type: 'reset' });
  command({ type: 'close' });
  command({ type: 'next' });
  assert.equal(game.snapshot().quizId, quiz.id);
  advance(NEXT_ROUND_MS);
  game.tick();
  assert.equal(game.snapshot().questionIndex, 1);
  assert.equal(game.snapshot().quizId, quiz.id);
  assert.equal(new GameEngine(quiz).snapshot().quizId, quiz.id);
});

test('each quiz publishes its own optional cover without exposing answers', () => {
  const coveredQuiz = { ...quiz, coverImage: '/media/covers/100001.svg' };
  const game = new GameEngine(coveredQuiz);
  assert.equal(game.snapshot().coverImage, coveredQuiz.coverImage);
  assert.equal(game.snapshot(true).coverImage, coveredQuiz.coverImage);
  assert.equal(new GameEngine(quiz).snapshot().coverImage, null);
  assert.equal(new GameEngine({ ...quiz, id: 100002, coverImage: '/media/covers/100002.jpg' }).snapshot().coverImage,
    '/media/covers/100002.jpg');
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
});

test('only first buzz wins; clock freezes indefinitely with no automatic score changes', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'start' });
  advance(6000);
  game.buzz(alice.id);
  assert.throws(() => game.buzz(bob.id), /not open/);
  advance(600000);
  const state = game.snapshot();
  assert.equal(state.activePlayerId, alice.id);
  assert.equal(state.pointsAtBuzz, 400);
  assert.equal(state.clueElapsedMs, 6000);
  assert.equal(alice.score, 0);
  assert.equal(state.clockRunning, false);
});

test('wrong uses frozen penalty, locks player out and resumes; correct closes at frozen value', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'start' });
  advance(10000);
  game.buzz(alice.id);
  advance(100000);
  command({ type: 'judge', correct: false });
  assert.equal(alice.score, -300);
  assert.throws(() => game.buzz(alice.id), /not open/);
  advance(2000);
  game.tick();
  assert.throws(() => game.buzz(alice.id), /locked out/);
  advance(5000);
  game.buzz(bob.id);
  assert.equal(game.snapshot().pointsAtBuzz, 200);
  command({ type: 'judge', correct: true });
  assert.equal(bob.score, 200);
  assert.equal(game.snapshot().phase, 'BUZZ_RESULT');
  advance(2000);
  game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
});

test('minimum value and media end are not deadlines; host pause and restart preserve point time', () => {
  const { game, alice, command, advance } = setup();
  command({ type: 'start' });
  advance(30000);
  command({ type: 'pause' });
  advance(60000);
  assert.equal(game.snapshot().clueElapsedMs, 30000);
  assert.throws(() => game.buzz(alice.id), /not open/);
  command({ type: 'restartMedia' });
  assert.equal(game.snapshot().mediaPositionSeconds, 0);
  assert.equal(game.snapshot().revealProgress, 0);
  assert.equal(game.snapshot().currentPoints, 100);
  command({ type: 'resume' });
  advance(1000);
  assert.equal(game.snapshot().mediaPositionSeconds, 1);
  assert.equal(game.snapshot().revealProgress, 0.05);
  game.buzz(alice.id);
  command({ type: 'judge', correct: true });
  assert.equal(alice.score, 100);
});

test('undo restores scores, answering state, frozen time, eligibility and leaderboard order', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'start' });
  advance(6000);
  game.buzz(bob.id);
  command({ type: 'judge', correct: true });
  assert.equal(game.snapshot().leaderboardIds[0], bob.id);
  command({ type: 'undo' });
  assert.equal(bob.score, 0);
  assert.equal(game.snapshot().activePlayerId, bob.id);
  assert.equal(game.snapshot().clueElapsedMs, 6000);
  assert.equal(game.snapshot().leaderboardIds[0], alice.id);
  command({ type: 'judge', correct: false });
  advance(5000);
  command({ type: 'undo' });
  assert.equal(bob.score, 0);
  assert.deepEqual(game.snapshot().lockedOutIds, []);
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.equal(game.snapshot().clueElapsedMs, 6000);
});

test('duplicate command is idempotent and stale commands cannot rule on a later buzz', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'start' });
  game.buzz(alice.id);
  const ruling = { id: randomUUID(), revision: game.revision, action: { type: 'judge', correct: false } } as const;
  game.command(ruling);
  game.command(ruling);
  assert.equal(alice.score, -500);
  advance(2000);
  game.tick();
  game.buzz(bob.id);
  assert.throws(() => game.command({ ...ruling, id: randomUUID() }), /state changed/);
  assert.equal(bob.score, 0);
});

test('public snapshots never contain private answers until explicit reveal', () => {
  const { game, command, advance } = setup();
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
  command({ type: 'start' });
  assert.equal(game.snapshot(true).privateAnswer, 'SECRET FIRST');
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
  command({ type: 'close' });
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
  command({ type: 'reveal' });
  assert.equal(game.snapshot().revealedAnswer, 'SECRET FIRST');
  command({ type: 'next' });
  assert.equal(JSON.stringify(game.snapshot()).includes('SECRET'), false);
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  advance(NEXT_ROUND_MS);
  game.tick();
  command({ type: 'close' });
  command({ type: 'next' });
  assert.equal(game.snapshot().phase, 'GAME_FINISHED');
  assert.throws(() => command({ type: 'next' }), /Close/);
});

test('12-player leaderboard immediately promotes a scorer into the displayed top players during an active clue', () => {
  const { game, command } = setup();
  for (let i = 2; i < 12; i++) game.join({ name: `Player ${i}`, avatarId: 'frog' });
  const last = [...game.players.values()][11];
  command({ type: 'start' });
  assert.equal(game.snapshot().leaderboardIds.slice(0, game.settings.leaderboardCount).includes(last.id), false);
  game.buzz(last.id);
  assert.equal(game.snapshot().activePlayerId, last.id);
  assert.equal(game.snapshot().players.length, 12);
  command({ type: 'adjust', playerId: last.id, delta: 1000 });
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.equal(game.snapshot().leaderboardIds[0], last.id);
  assert.equal(game.snapshot().leaderboardIds.slice(0, game.settings.leaderboardCount).length, 8);
  assert.equal(game.snapshot().activePlayerId, last.id);
  command({ type: 'judge', correct: true });
  assert.equal(game.snapshot().leaderboardIds[0], last.id);
});

test('wrong rulings and undo immediately rerank an open question without waiting for close', () => {
  const { game, alice, bob, command } = setup();
  command({ type: 'start' });
  assert.deepEqual(game.snapshot().leaderboardIds, [alice.id, bob.id]);
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  assert.equal(game.snapshot().phase, 'BUZZ_RESULT');
  assert.deepEqual(game.snapshot().leaderboardIds, [bob.id, alice.id]);
  command({ type: 'undo' });
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.deepEqual(game.snapshot().leaderboardIds, [alice.id, bob.id]);
  assert.equal(alice.score, 0);
});

test('manual score changes rerank immediately while paused, with ties resolved by join order', () => {
  const { game, alice, bob, command } = setup();
  command({ type: 'start' });
  command({ type: 'pause' });
  command({ type: 'adjust', playerId: bob.id, delta: 100 });
  assert.deepEqual(game.snapshot().leaderboardIds, [bob.id, alice.id]);
  command({ type: 'adjust', playerId: alice.id, delta: 100 });
  assert.deepEqual(game.snapshot().leaderboardIds, [alice.id, bob.id]);
  command({ type: 'adjust', playerId: alice.id, delta: -200 });
  assert.deepEqual(game.snapshot().leaderboardIds, [bob.id, alice.id]);
  command({ type: 'undo' });
  assert.deepEqual(game.snapshot().leaderboardIds, [alice.id, bob.id]);
  assert.equal(game.snapshot().paused, true);
});

test('late joiners rank above negative scores, and undo includes players who joined after the ruling', () => {
  const { game, alice, bob, command } = setup();
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  const charlie = game.join({ name: 'Charlie', avatarId: 'bear' });
  assert.deepEqual(game.snapshot().leaderboardIds, [bob.id, charlie.id, alice.id]);
  command({ type: 'undo' });
  assert.deepEqual(game.snapshot().leaderboardIds, [alice.id, bob.id, charlie.id]);
});
test('disconnects retain identity, score and eligibility; reset clears lockout but not scores', () => {
  const { game, alice, command, advance } = setup();
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  game.setConnected(alice.id, false);
  game.setConnected(alice.id, true);
  advance(2000);
  game.tick();
  assert.throws(() => game.buzz(alice.id), /locked out/);
  assert.equal(alice.score, -500);
  command({ type: 'reset' });
  game.buzz(alice.id);
  assert.equal(alice.score, -500);
});

test('timed lockouts reject early buzzes, expire at the exact boundary and restart after another wrong answer', () => {
  const { game, alice, command, advance } = setup();
  command({ type: 'setup', settings: { ...game.settings, lockoutSeconds: 10 } });
  command({ type: 'start' });
  game.buzz(alice.id);
  advance(20000);
  command({ type: 'judge', correct: false });
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 10000);
  assert.equal(alice.score, -500);
  advance(2000);
  game.tick();
  advance(9999);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 1);
  assert.throws(() => game.buzz(alice.id), /locked out/);
  advance(1);
  assert.deepEqual(game.snapshot().lockedOutIds, []);
  assert.deepEqual(game.snapshot().lockoutRemainingMs, {});
  game.buzz(alice.id);
  assert.equal(game.snapshot().pointsAtBuzz, 300);
  command({ type: 'judge', correct: false });
  assert.equal(alice.score, -800);
  assert.deepEqual(game.snapshot().lockedOutIds, [alice.id]);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 10000);
});

test('timed lockouts continue while paused, answering or disconnected, without reopening buzzers', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'setup', settings: { ...game.settings, lockoutSeconds: 10 } });
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  game.setConnected(alice.id, false);
  advance(2000);
  game.tick();
  command({ type: 'pause' });
  advance(10000);
  game.setConnected(alice.id, true);
  assert.deepEqual(game.snapshot().lockedOutIds, []);
  assert.throws(() => game.buzz(alice.id), /not open/);
  command({ type: 'resume' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  advance(2000);
  game.tick();
  game.buzz(bob.id);
  advance(10000);
  assert.deepEqual(game.snapshot().lockedOutIds, []);
  assert.throws(() => game.buzz(alice.id), /not open/);
  command({ type: 'judge', correct: false });
  advance(2000);
  game.tick();
  game.buzz(alice.id);
});

test('default lockouts last the whole question; timed lockouts clear on reset and advance', () => {
  const { game, alice, command, advance } = setup();
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  advance(1000000);
  game.tick();
  assert.deepEqual(game.snapshot().lockedOutIds, [alice.id]);
  assert.deepEqual(game.snapshot().lockoutRemainingMs, {});
  assert.throws(() => game.buzz(alice.id), /locked out/);

  const timed = setup();
  timed.command({ type: 'setup', settings: { ...timed.game.settings, lockoutSeconds: 10 } });
  timed.command({ type: 'start' });
  timed.game.buzz(timed.alice.id);
  timed.command({ type: 'judge', correct: false });
  timed.command({ type: 'reset' });
  assert.deepEqual(timed.game.snapshot().lockoutRemainingMs, {});
  timed.game.buzz(timed.alice.id);
  timed.command({ type: 'judge', correct: false });
  timed.advance(2000);
  timed.game.tick();
  timed.command({ type: 'close' });
  timed.command({ type: 'next' });
  assert.equal(timed.game.snapshot().phase, 'NEXT_ROUND');
  timed.advance(NEXT_ROUND_MS);
  timed.game.tick();
  assert.deepEqual(timed.game.snapshot().lockedOutIds, []);
  assert.deepEqual(timed.game.snapshot().lockoutRemainingMs, {});
});

test('undo restores timed eligibility and prior deadlines without resetting another player countdown', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'setup', settings: { ...game.settings, lockoutSeconds: 10 } });
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  advance(2000);
  game.tick();
  game.buzz(bob.id);
  command({ type: 'judge', correct: false });
  advance(3000);
  command({ type: 'undo' });
  assert.equal(bob.score, 0);
  assert.equal(game.snapshot().activePlayerId, bob.id);
  assert.deepEqual(game.snapshot().lockedOutIds, [alice.id]);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 7000);
  command({ type: 'undo' });
  assert.equal(alice.score, 0);
  assert.equal(game.snapshot().activePlayerId, alice.id);
  assert.deepEqual(game.snapshot().lockoutRemainingMs, {});
});


test('a two-second lockout starts after the wrong-answer result', () => {
  const { game, alice, bob, command, advance } = setup();
  command({ type: 'setup', settings: { ...game.settings, lockoutSeconds: 2 } });
  command({ type: 'start' });
  game.buzz(alice.id);
  command({ type: 'judge', correct: false });
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 2000);
  advance(2000);
  game.tick();
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], 2000);
  assert.throws(() => game.buzz(alice.id), /locked out/);
  game.buzz(bob.id);
  advance(2000);
  assert.equal(game.snapshot().lockoutRemainingMs[alice.id], undefined);
});
