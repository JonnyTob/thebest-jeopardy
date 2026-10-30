import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { NEXT_ROUND_MS, START_COUNTDOWN_MS, REVIEW_RESULT_MS, REVIEW_GROUP_MS } from '../shared/game.js';
import { quizSchema, serverSettingsSchema, type HostAction } from '../shared/protocol.js';
import { GameEngine } from './engine.js';

const quiz = quizSchema.parse({
  id: 100001, title: 'Timing regression', questions: [
    { id: 'first', type: 'text', mode: 'typed', fixedPoints: 250, timerSeconds: 2,
      question: 'Current clue', answer: 'CURRENT SECRET' },
    { id: 'second', type: 'image', mode: 'typed', fixedPoints: 400, timerSeconds: 5,
      question: 'UNOPENED CLUE', answer: 'UNOPENED SECRET', media: '/media/unopened.svg',
      reveal: { effect: 'tiles', durationSeconds: 10 } },
  ],
});

function setup({ offset = 0, last = false, empty = false, mode = 'typed' as 'typed' | 'buzzer' } = {}) {
  let time = 0;
  const questions = (last ? quiz.questions.slice(0, 1) : quiz.questions)
    .map((question, index) => {
      if (index !== 0) return question;
      if (mode === 'typed') return { ...question, mode };
      const { fixedPoints: _points, timerSeconds: _timer, ...buzzer } = question;
      return { ...buzzer, mode };
    });
  const game = new GameEngine({ ...quiz, questions }, () => time,
    serverSettingsSchema.parse({ typedAnswerGraceSeconds: offset }));
  const player = empty ? undefined : game.join({ name: 'Alice', avatarId: 'fox' });
  const command = (action: HostAction) => {
    const request = { id: randomUUID(), revision: game.revision, action };
    game.command(request);
    return request;
  };
  command({ type: 'start' });
  assert.equal(START_COUNTDOWN_MS, 4000);
  assert.equal(NEXT_ROUND_MS, 3000);
  time += START_COUNTDOWN_MS;
  game.tick();
  return { game, player, command, advance: (ms: number) => { time += ms; } };
}

test('typed deadline includes the global offset and rejects at the boundary before a tick', async (t) => {
  for (const offset of [0, 1, 300]) {
    await t.test(`offset=${offset}`, () => {
      const { game, player, command, advance } = setup({ offset });
      const late = game.join({ name: 'Bob', avatarId: 'cat' });
      const instance = game.snapshot().questionInstanceId!;
      const deadline = (2 + offset) * 1000;
      advance(deadline - 1);
      game.tick();
      assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
      assert.equal(game.snapshot().currentPoints, 250);
      game.submitAnswer(player!.id, instance, 'On time');
      const revision = game.revision;
      advance(1);
      assert.throws(() => game.submitAnswer(late.id, instance, 'At deadline'), /timer has ended/);
      assert.equal(game.snapshot().phase, 'QUESTION_OPEN', 'submission rejection must not depend on tick');
      assert.equal(game.snapshot().submissionCount, 1);
      assert.equal(game.revision, revision);
      game.tick();
      assert.equal(game.revision, revision + 1);
      assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
      assert.equal(game.snapshot().clueElapsedMs, deadline);
      assert.equal(game.snapshot().clockRunning, false);
      assert.equal(game.snapshot().nextRoundCountdownMs, null);
      assert.deepEqual(game.snapshot(true).hostSubmissions, [
        { playerId: player!.id, answer: 'On time', correct: null },
        { playerId: late.id, answer: null, correct: null },
      ]);
      advance(10000);
      game.tick();
      assert.equal(game.revision, revision + 1);
      assert.equal(game.snapshot().clueElapsedMs, deadline);
      command({ type: 'startReview' });
      assert.equal(game.snapshot().review?.answer, 'On time');
    });
  }
});

test('typed submission deadline remains independent of point decay', () => {
  const { game, player, advance } = setup({ offset: 3 });
  advance(4999);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  game.submitAnswer(player!.id, game.snapshot().questionInstanceId!, 'Answer');
  advance(1);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().clueElapsedMs, 5000);
});

test('point decay delay applies to every buzzer media type without shifting its close time', () => {
  for (const type of ['text', 'image', 'audio', 'video'] as const) {
    let time = 0;
    const game = new GameEngine({ id: 7, title: 'Decay', questions: [{
      id: type, type, mode: 'buzzer', question: 'Clue', answer: 'Answer', timerSeconds: 8,
      ...(type === 'text' ? {} : { media: `/media/clue.${type}` }),
    }] }, () => time);
    game.settings.pointDecayDelaySeconds = 2;
    game.settings.dropEverySeconds = 1;
    game.join({ name: 'Alice', avatarId: 'fox' });
    game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
    time += START_COUNTDOWN_MS;
    game.tick();
    time += 2999;
    assert.equal(game.snapshot().currentPoints, 500, type);
    time++;
    assert.equal(game.snapshot().currentPoints, 400, type);
    time += 5000;
    game.tick();
    assert.equal(game.snapshot().phase, 'QUESTION_CLOSED', type);
    assert.equal(game.snapshot().clueElapsedMs, 8000, type);
  }
});

test('a late deadline tick clamps elapsed time, rejects pre-tick late answers and closes only once', () => {
  const { game, player, advance } = setup({ offset: 3 });
  const instance = game.snapshot().questionInstanceId!;
  advance(12000);
  const revision = game.revision;
  assert.throws(() => game.submitAnswer(player!.id, instance, 'Too late'), /timer has ended/);
  assert.equal(game.revision, revision);
  assert.equal(game.snapshot().submissionCount, 0);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().clueElapsedMs, 5000);
  assert.deepEqual(game.snapshot(true).hostSubmissions, [{ playerId: player!.id, answer: null, correct: null }]);
  game.tick();
  assert.equal(game.revision, revision + 1);
});

test('typed deadline uses active clue time across pauses and ignores media restarts', () => {
  const { game, player, command, advance } = setup({ offset: 1 });
  const instance = game.snapshot().questionInstanceId!;
  advance(1500);
  command({ type: 'pause' });
  const revision = game.revision;
  advance(100000);
  game.tick();
  assert.equal(game.revision, revision);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().clueElapsedMs, 1500);
  assert.throws(() => game.submitAnswer(player!.id, instance, 'Paused'), /not open/);
  command({ type: 'restartMedia' });
  assert.equal(game.snapshot().mediaPositionSeconds, 0);
  command({ type: 'resume' });
  advance(1499);
  game.tick();
  assert.equal(game.snapshot().clueElapsedMs, 2999);
  game.submitAnswer(player!.id, instance, 'Still on time');
  command({ type: 'pause' });
  advance(10000);
  game.tick();
  assert.equal(game.snapshot().clueElapsedMs, 2999);
  command({ type: 'resume' });
  advance(1);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().clueElapsedMs, 3000);
  assert.equal(game.snapshot().paused, false);
  assert.equal(game.snapshot().clockRunning, false);
});

test('buzzer questions close at their countdown, without the typed-answer offset', () => {
  const { game, player, advance } = setup({ mode: 'buzzer', offset: 300 });
  advance(29999);
  const revision = game.revision;
  game.tick();
  assert.equal(game.revision, revision);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  advance(1);
  assert.throws(() => game.buzz(player!.id), /timer has ended/i);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().clueElapsedMs, 30000);
});

test('every clue type uses its question countdown override or the global default', () => {
  for (const type of ['text', 'image', 'audio', 'video'] as const) {
    for (const timerSeconds of [undefined, 5]) {
      let time = 0;
      const question = { id: 'one', type, mode: 'buzzer', question: 'Clue', answer: 'Answer',
        ...(type === 'text' ? {} : { media: '/media/clue.mp4' }),
        ...(timerSeconds === undefined ? {} : { timerSeconds }) };
      const game = new GameEngine(quizSchema.parse({ id: 42, title: 'Quiz', questions: [question] }), () => time);
      game.settings.questionTimerSeconds = 12;
      game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
      time += START_COUNTDOWN_MS;
      game.tick();
      const deadline = (timerSeconds ?? 12) * 1000;
      time += deadline - 1;
      game.tick();
      assert.equal(game.snapshot().phase, 'QUESTION_OPEN', `${type}/${timerSeconds}`);
      time++;
      game.tick();
      assert.equal(game.snapshot().phase, 'QUESTION_CLOSED', `${type}/${timerSeconds}`);
      assert.equal(game.snapshot().clueElapsedMs, deadline);
    }
  }
});

const completionPaths = ['review', 'closed', 'open-close', 'open-tick', 'open-review',
  'empty-close', 'empty-tick', 'empty-review'] as const;

test('a late auto-close starts a full transition at the tick, not at the expired submission deadline', () => {
  const { game, player, command, advance } = setup({ offset: 1 });
  game.submitAnswer(player!.id, game.snapshot().questionInstanceId!, 'Answer');
  command({ type: 'judgeSubmission', playerId: player!.id, correct: true });
  advance(20000);
  game.tick();
  assert.equal(game.snapshot().phase, 'REVIEW_GROUP');
  assert.equal(game.snapshot().reviewGroup?.remainingMs, REVIEW_GROUP_MS);
  assert.equal(game.snapshot().clueElapsedMs, 3000);
  advance(REVIEW_GROUP_MS);
  game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().questionIndex, 0);
  assert.equal(game.snapshot().clueElapsedMs, 3000);
  assert.equal(game.snapshot().nextRoundCountdownMs, 3000);
  const revision = game.revision;
  game.tick();
  assert.equal(game.revision, revision);
  advance(2999);
  game.tick();
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  assert.equal(game.snapshot().nextRoundCountdownMs, 1);
  advance(1);
  game.tick();
  assert.equal(game.snapshot().questionIndex, 1);
  assert.equal(game.snapshot().clueElapsedMs, 0);
});

test('an empty queue transition cannot be cancelled by undo without a score history', () => {
  const { game, command, advance } = setup({ empty: true });
  command({ type: 'close' });
  const before = game.snapshot(true);
  assert.equal(before.phase, 'NEXT_ROUND');
  assert.equal(before.canUndo, false);
  assert.throws(() => command({ type: 'undo' }), /no score change/);
  assert.deepEqual(game.snapshot(true), before);
  advance(NEXT_ROUND_MS);
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().questionIndex, 1);
});

test('typed completion automatically transitions or finishes the last question on every completion path', async (t) => {
  for (const last of [false, true]) {
    for (const path of completionPaths) {
      await t.test(`${path}, last=${last}`, () => {
        const { game, player, command, advance } = setup({ last, empty: path.startsWith('empty') });
        const instance = game.snapshot().questionInstanceId;
        if (player) game.submitAnswer(player.id, instance!, 'PRIVATE SUBMISSION');
        if (path === 'review') {
          command({ type: 'startReview' });
          command({ type: 'judgeReview', correct: true });
          advance(REVIEW_RESULT_MS);
          game.tick();
        } else if (path === 'closed') {
          command({ type: 'close' });
          command({ type: 'judgeSubmission', playerId: player!.id, correct: true });
        } else {
          if (player) {
            command({ type: 'judgeSubmission', playerId: player.id, correct: true });
            assert.equal(game.snapshot().phase, 'QUESTION_OPEN', 'last live ruling must wait for close');
            assert.equal(game.snapshot().nextRoundCountdownMs, null);
            advance(1999);
            game.tick();
            assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
          }
          if (path.endsWith('tick')) {
            advance(player ? 1 : 2000);
            game.tick();
          } else command({ type: path.endsWith('review') ? 'startReview' : 'close' });
        }
        if (game.snapshot().phase === 'REVIEW_GROUP') {
          advance(REVIEW_GROUP_MS);
          game.tick();
        }
        assert.equal(game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
        assert.equal(game.snapshot().nextRoundCountdownMs, last ? null : 3000);
        assert.equal(game.snapshot().questionInstanceId, instance);
        assert.equal(game.snapshot().questionIndex, 0);
        assert.equal(game.snapshot().clockRunning, false);
        assert.equal(game.snapshot().paused, false);
        assert.equal(game.snapshot().review, null);
        assert.equal(game.snapshot().revealedAnswer, null);
        if (player) assert.equal(player.score, 250);
        for (const state of [game.snapshot(), game.snapshot(false, player?.id)]) {
          assert.equal(state.hostSubmissions, undefined);
          assert.equal(state.privateAnswer, undefined);
          assert.deepEqual(state.scoreEvents, []);
          assert.doesNotMatch(JSON.stringify(state), /PRIVATE SUBMISSION|CURRENT SECRET|UNOPENED/);
        }
        assert.doesNotMatch(JSON.stringify(game.snapshot(true)), /UNOPENED/);
        const revision = game.revision;
        game.tick();
        assert.equal(game.revision, revision);
        if (last) {
          advance(100000);
          game.tick();
          assert.equal(game.revision, revision);
          assert.equal(game.snapshot().phase, 'GAME_FINISHED');
          assert.equal(game.snapshot().questionIndex, 0);
        }
      });
    }
  }
});

test('next round retains the old clue through 2999ms, opens only on tick and starts fresh even on a late tick', async (t) => {
  for (const late of [false, true]) {
    for (const manual of [false, true]) {
      await t.test(`late=${late}, manual=${manual}`, () => {
        const { game, player, command, advance } = setup({ mode: manual ? 'buzzer' : 'typed' });
        const first = game.snapshot();
        advance(500);
        let trigger;
        if (manual) {
          game.buzz(player!.id);
          trigger = command({ type: 'judge', correct: true });
        } else {
          game.submitAnswer(player!.id, first.questionInstanceId!, 'PRIVATE SUBMISSION');
          command({ type: 'startReview' });
          trigger = command({ type: 'judgeReview', correct: true });
        }
        advance(REVIEW_RESULT_MS);
        game.tick();
        const revision = game.revision;
        assert.equal(game.snapshot().phase, 'NEXT_ROUND');
        const countdownId = game.snapshot().countdownId;
        assert.ok(countdownId);
        assert.equal(game.snapshot().nextRoundCountdownMs, 3000);
        assert.equal(game.snapshot(true).canUndo, true);
        const frozen = game.snapshot().clueElapsedMs;
        advance(2999);
        game.tick();
        game.command(trigger);
        assert.equal(game.revision, revision);
        assert.equal(game.snapshot().phase, 'NEXT_ROUND');
        assert.equal(game.snapshot().nextRoundCountdownMs, 1);
        assert.equal(game.snapshot().clueElapsedMs, frozen);
        for (const state of [game.snapshot(), game.snapshot(false, player!.id), game.snapshot(true)]) {
          assert.equal(state.countdownId, countdownId);
          assert.equal(state.questionIndex, 0);
          assert.equal(state.questionInstanceId, first.questionInstanceId);
          assert.doesNotMatch(JSON.stringify(state), /UNOPENED/);
        }
        advance(late ? 10001 : 1);
        assert.equal(game.snapshot().phase, 'NEXT_ROUND');
        assert.equal(game.snapshot().nextRoundCountdownMs, 0, 'snapshots do not open clues');
        game.tick();
        const opened = game.snapshot(true);
        assert.equal(game.revision, revision + 1);
        assert.equal(opened.phase, 'QUESTION_OPEN');
        assert.equal(opened.nextRoundCountdownMs, null);
        assert.equal(opened.countdownId, null);
        assert.equal(opened.startCountdownMs, null);
        assert.equal(opened.questionIndex, 1);
        assert.equal(opened.question?.id, 'second');
        assert.notEqual(opened.questionInstanceId, first.questionInstanceId);
        assert.equal(opened.clueElapsedMs, 0);
        assert.equal(opened.mediaPositionSeconds, 0);
        assert.equal(opened.revealProgress, 0);
        assert.equal(opened.mediaVersion, first.mediaVersion + 1);
        assert.equal(opened.currentPoints, 400);
        assert.equal(opened.clockRunning, true);
        assert.equal(opened.canUndo, false);
        assert.equal(opened.submissionCount, 0);
        assert.equal(opened.reviewCount, 0);
        assert.deepEqual(opened.hostSubmissions, []);
        assert.equal(opened.mySubmitted, false);
        assert.throws(() => command({ type: 'undo' }), /no score change/);
        assert.throws(() => game.submitAnswer(player!.id, first.questionInstanceId!, 'Old'), /changed/);
        game.command(trigger);
        game.tick();
        assert.equal(game.snapshot().countdownId, null);
        assert.equal(game.revision, revision + 1);
        assert.equal(game.snapshot().questionInstanceId, opened.questionInstanceId);
        assert.equal(player!.score, manual ? 500 : 250);
        advance(4999);
        game.tick();
        assert.equal(game.snapshot().phase, 'QUESTION_OPEN', 'the next typed clue gets its full time budget');
      });
    }
  }
});

test('NEXT_ROUND rejects every host action except undo and rejects player play without mutating state', () => {
  const { game, player, command, advance } = setup();
  game.submitAnswer(player!.id, game.snapshot().questionInstanceId!, 'Answer');
  command({ type: 'startReview' });
  command({ type: 'judgeReview', correct: true });
  advance(REVIEW_RESULT_MS);
  game.tick();
  const before = game.snapshot(true);
  const actions: HostAction[] = [
    ...(['start', 'pause', 'resume', 'close', 'reveal', 'next', 'reset', 'restartMedia', 'startReview', 'nextReview'] as const)
      .map((type) => ({ type })),
    { type: 'setup', settings: { ...game.settings } },
    { type: 'adjust', playerId: player!.id, delta: 100 },
    { type: 'removePlayer', playerId: player!.id },
    { type: 'judge', correct: true }, { type: 'judgeReview', correct: false },
    { type: 'judgeSubmission', playerId: player!.id, correct: false },
  ];
  for (const action of actions) {
    assert.throws(() => command(action), /next-round transition/, action.type);
    assert.deepEqual(game.snapshot(true), before);
  }
  assert.throws(() => game.buzz(player!.id), /not open/);
  assert.throws(() => game.submitAnswer(player!.id, before.questionInstanceId!, 'Late'), /not open/);
  assert.deepEqual(game.snapshot(true), before);
  command({ type: 'undo' });
  assert.equal(game.snapshot().phase, 'REVIEW');
  assert.equal(game.snapshot().nextRoundCountdownMs, null);
});

test('undo cancels automatic transitions, restores final rulings and rearms a fresh countdown after rejudging', async (t) => {
  for (const last of [false, true]) {
    for (const path of ['review', 'closed', 'open-close', 'open-tick', 'open-review'] as const) {
      for (const correct of [false, true]) {
        await t.test(`${path}, correct=${correct}, last=${last}`, () => {
          const { game, player, command, advance } = setup({ last });
          const instance = game.snapshot().questionInstanceId!;
          game.submitAnswer(player!.id, instance, 'Private ruling');
          if (path === 'review') command({ type: 'startReview' });
          else if (path === 'closed') command({ type: 'close' });
          const ruling = command(path === 'review' ? { type: 'judgeReview', correct }
            : { type: 'judgeSubmission', playerId: player!.id, correct });
          if (path === 'open-close') command({ type: 'close' });
          else if (path === 'open-review') command({ type: 'startReview' });
          else if (path === 'open-tick') { advance(2000); game.tick(); }
          if (path === 'review') { advance(REVIEW_RESULT_MS); game.tick(); }
          else { advance(REVIEW_GROUP_MS); game.tick(); }
          assert.equal(game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
          const firstCountdownId = game.snapshot().countdownId;
          if (last) assert.equal(firstCountdownId, null);
          else assert.ok(firstCountdownId);
          advance(1000);
          const undo = command({ type: 'undo' });
          const restored = game.snapshot(true);
          assert.equal(restored.phase, path === 'review' ? 'REVIEW' : path === 'closed' ? 'QUESTION_CLOSED' : 'QUESTION_OPEN');
          assert.equal(restored.nextRoundCountdownMs, null);
          assert.equal(restored.countdownId, null);
          assert.equal(restored.questionInstanceId, instance);
          assert.equal(restored.hostSubmissions?.[0].correct, null);
          assert.equal(restored.scoreEvents.length, 0);
          assert.equal(player!.score, 0);
          game.command(undo);
          game.command(ruling);
          assert.deepEqual(game.snapshot(true), restored, 'duplicates cannot resurrect an undone ruling or countdown');
          advance(10000);
          game.tick();
          assert.equal(game.snapshot().questionIndex, 0);
          assert.equal(game.snapshot().questionInstanceId, instance);
          assert.equal(game.snapshot().nextRoundCountdownMs, null);
          assert.equal(game.snapshot().phase, path === 'review' ? 'REVIEW' : 'QUESTION_CLOSED');
          if (path !== 'review') command({ type: 'startReview' });
          command({ type: 'judgeReview', correct });
          advance(REVIEW_RESULT_MS);
          game.tick();
          assert.equal(game.snapshot().phase, last ? 'GAME_FINISHED' : 'NEXT_ROUND');
          assert.equal(game.snapshot().nextRoundCountdownMs, last ? null : 3000);
          if (last) assert.equal(game.snapshot().countdownId, null);
          else {
            assert.ok(game.snapshot().countdownId);
            assert.notEqual(game.snapshot().countdownId, firstCountdownId);
          }
          assert.equal(player!.score, correct ? 250 : 0);
          assert.equal(game.snapshot(true).scoreEvents.length, 1);
        });
      }
    }
  }
});

test('undo also cancels an automatic buzzer transition and restores the answering state', () => {
  const { game, player, command, advance } = setup({ mode: 'buzzer' });
  game.settings.pointDecayDelaySeconds = 0;
  advance(6000);
  game.buzz(player!.id);
  command({ type: 'judge', correct: true });
  advance(2000);
  game.tick();
  advance(2999);
  command({ type: 'undo' });
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.equal(game.snapshot().nextRoundCountdownMs, null);
  assert.equal(game.snapshot().activePlayerId, player!.id);
  assert.equal(game.snapshot().pointsAtBuzz, 400);
  assert.equal(game.snapshot().clueElapsedMs, 6000);
  assert.equal(player!.score, 0);
  advance(10000);
  game.tick();
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.equal(game.snapshot().questionIndex, 0);
});
