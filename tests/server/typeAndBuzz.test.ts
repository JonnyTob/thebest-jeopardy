import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BUZZ_CORRECT_ANSWER_MS, BUZZ_RESULT_MS, NEXT_ROUND_MS, REVIEW_GROUP_MS, START_COUNTDOWN_MS } from '../../src/shared/game.js';
import { serverSettingsSchema, type HostAction, type Quiz } from '../../src/shared/protocol.js';
import { GameEngine } from '../../src/server/engine.js';

const quiz: Quiz = { id: 1, title: 'Combined', questions: [{ id: 'one', type: 'text', mode: 'type-and-buzz',
  question: 'Clue', answer: 'Secret', fixedPoints: 100, buzzPoints: 500, typingSeconds: 10, timerSeconds: 20 }] };

test('configured announcement duration controls the transition and snapshot countdown', () => {
  let time = 0;
  const game = new GameEngine(quiz, () => time, serverSettingsSchema.parse({ typeBuzzAnnouncementSeconds: 7 }));
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  assert.equal(game.snapshot().typeBuzzIntroMs, 7000);
  time = 6999;
  game.tick();
  assert.equal(game.snapshot().phase, 'TYPE_BUZZ_INTRO');
  assert.equal(game.snapshot().typeBuzzIntroMs, 1);
  time++;
  game.tick();
  assert.equal(game.snapshot().phase, 'STARTING');
  assert.equal(game.snapshot().typeBuzzIntroMs, null);
});

function setup() {
  let time = 0;
  const game = new GameEngine(quiz, () => time, serverSettingsSchema.parse({ showMissingAnswerGroup: true }));
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const advance = (ms: number) => { time += ms; game.tick(); };
  command({ type: 'start' });
  assert.equal(game.snapshot().phase, 'TYPE_BUZZ_INTRO');
  advance(3000);
  assert.equal(game.snapshot().phase, 'STARTING');
  advance(START_COUNTDOWN_MS);
  return { game, alice, bob, command, advance };
}

test('a correct buzzer winner is excluded from typed review while other answers remain eligible', () => {
  const { game, alice, bob, command, advance } = setup();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'Secret');
  assert.throws(() => game.buzz(bob.id), /typing window/);
  advance(10000);
  game.submitAnswer(bob.id, instance, 'Secret');
  game.buzz(alice.id);
  assert.equal(game.snapshot().submissionsClosed, true);
  assert.equal(game.snapshot().currentPoints, 500);
  assert.equal(game.snapshot().revealedAnswer, null);
  assert.equal(game.snapshot().hostSubmissions, undefined);
  command({ type: 'judge', correct: false });
  assert.equal(alice.score, -250);
  advance(BUZZ_RESULT_MS);
  assert.throws(() => game.submitAnswer(alice.id, instance, 'Secret'), /closed/);
  assert.throws(() => game.buzz(alice.id), /locked out/);
  game.buzz(bob.id);
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.throws(() => command({ type: 'next' }), /Review all answers/);
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.playerId), [alice.id]);
  assert.throws(() => command({ type: 'judgeSubmission', playerId: bob.id, correct: true }), /Review player not found/);
  assert.equal(bob.score, 500);
  command({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  assert.equal(alice.score, -150);
  command({ type: 'startReview' });
  assert.equal(game.snapshot().phase, 'REVIEW_GROUP');
});

test('undoing a correct buzz restores the winner to typed review, even after the result', () => {
  const { game, alice, bob, command, advance } = setup();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'Secret');
  game.submitAnswer(bob.id, instance, 'Secret');
  game.buzz(alice.id);
  command({ type: 'judge', correct: true });
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.playerId), [bob.id]);
  advance(BUZZ_CORRECT_ANSWER_MS);
  command({ type: 'undo' });
  assert.equal(alice.score, 0);
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.playerId), [alice.id, bob.id]);
  command({ type: 'judge', correct: false });
  advance(BUZZ_RESULT_MS);
  command({ type: 'close' });
  command({ type: 'judgeSubmission', playerId: alice.id, correct: true });
  assert.equal(alice.score, -150);
});

test('a lone correct buzzer winner leaves an empty typed review and can advance', () => {
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  command({ type: 'start' });
  time += 3000; game.tick();
  time += START_COUNTDOWN_MS; game.tick();
  game.submitAnswer(player.id, game.snapshot().questionInstanceId!, 'Secret');
  game.buzz(player.id);
  command({ type: 'judge', correct: true });
  assert.equal(game.snapshot().submissionCount, 1);
  assert.equal(game.snapshot(false, player.id).mySubmitted, true);
  assert.deepEqual(game.snapshot(true).hostSubmissions, []);
  time += BUZZ_CORRECT_ANSWER_MS; game.tick();
  assert.equal(game.snapshot().reviewCount, 0);
  assert.throws(() => command({ type: 'judgeSubmission', playerId: player.id, correct: true }), /Review player not found/);
  command({ type: 'startReview' });
  assert.equal(game.snapshot().phase, 'GAME_FINISHED');
  assert.equal(player.score, 500);
});

test('the correct buzzer winner is excluded from the missing-answer group and undo restores the roster', () => {
  const { game, alice, bob, command, advance } = setup();
  advance(10000);
  game.buzz(alice.id);
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.playerId), [bob.id]);
  command({ type: 'startReview' });
  assert.equal(game.snapshot().reviewGroup?.outcome, 'missing');
  assert.deepEqual(game.snapshot().reviewGroup?.playerIds, [bob.id]);
  assert.equal(game.snapshot(true).scoreEvents.length, 1);
  command({ type: 'undo' });
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.deepEqual(game.snapshot(true).hostSubmissions?.map((entry) => entry.playerId), [alice.id, bob.id]);
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  command({ type: 'startReview' });
  advance(REVIEW_GROUP_MS);
  assert.equal(game.snapshot().phase, 'GAME_FINISHED');
  assert.equal(alice.score, 500);
  assert.equal(bob.score, 0);
  assert.equal(game.snapshot(true).scoreEvents.length, 1);
});

test('a player can buzz immediately after typing; others can buzz after a wrong ruling', () => {
  const { game, alice, bob, command, advance } = setup();
  game.submitAnswer(alice.id, game.snapshot().questionInstanceId!, 'Secret');
  game.buzz(alice.id);
  assert.equal(game.snapshot().phase, 'ANSWERING');
  command({ type: 'judge', correct: false });
  advance(BUZZ_RESULT_MS);
  assert.throws(() => game.buzz(alice.id), /locked out/);
  game.buzz(bob.id);
  assert.equal(game.snapshot().activePlayerId, bob.id);
});

test('odd buzzer rewards deduct half rounded up to a whole point', () => {
  let time = 0;
  const game = new GameEngine({ ...quiz, questions: [{ ...quiz.questions[0], buzzPoints: 501 }] }, () => time);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  command({ type: 'start' });
  time += 3000; game.tick();
  time += START_COUNTDOWN_MS; game.tick();
  game.submitAnswer(player.id, game.snapshot().questionInstanceId!, 'Answer');
  game.buzz(player.id);
  command({ type: 'judge', correct: false });
  assert.equal(player.score, -251);
  assert.equal(game.snapshot().buzzResult?.delta, -251);
});

test('combined decaying buzzer points start after the typing window and freeze at the buzz', () => {
  let time = 0;
  const question = { ...quiz.questions[0], pointMode: 'decay' as const, buzzPoints: undefined,
    pointDecay: { startPoints: 800, minimumPoints: 200, dropPoints: 150, dropEverySeconds: 3, pointDecayDelaySeconds: 2 } };
  const game = new GameEngine({ ...quiz, questions: [question] }, () => time);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  time += 3000; game.tick(); time += START_COUNTDOWN_MS; game.tick();
  time += 10000;
  assert.equal(game.snapshot().currentPoints, 800);
  time += 5000;
  assert.equal(game.snapshot().currentPoints, 650);
  game.buzz(player.id);
  assert.equal(game.snapshot().pointsAtBuzz, 650);
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'judge', correct: false } });
  assert.equal(player.score, -325);
});

test('an early buzz starts decay for later buzzes after the wrong-answer hold', () => {
  let time = 0;
  const question = { ...quiz.questions[0], pointMode: 'decay' as const, buzzPoints: undefined,
    pointDecay: { startPoints: 800, minimumPoints: 200, dropPoints: 100, dropEverySeconds: 2, pointDecayDelaySeconds: 0 } };
  const game = new GameEngine({ ...quiz, questions: [question] }, () => time);
  const alice = game.join({ name: 'Alice', avatarId: 'fox' });
  const bob = game.join({ name: 'Bob', avatarId: 'cat' });
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  time += 3000; game.tick(); time += START_COUNTDOWN_MS; game.tick();
  time += 1000;
  game.submitAnswer(alice.id, game.snapshot().questionInstanceId!, 'Answer');
  game.buzz(alice.id);
  assert.equal(game.snapshot().pointsAtBuzz, 800);
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'judge', correct: false } });
  time += BUZZ_RESULT_MS; game.tick(); time += 2000;
  assert.equal(game.snapshot().currentPoints, 700);
  game.buzz(bob.id);
  assert.equal(game.snapshot().pointsAtBuzz, 700);
});

test('pause freezes both windows; timeout closes submissions and reset clears the roster', () => {
  const { game, alice, command, advance } = setup();
  const instance = game.snapshot().questionInstanceId!;
  game.submitAnswer(alice.id, instance, 'A');
  advance(5000);
  command({ type: 'pause' });
  advance(30000);
  assert.throws(() => game.buzz(alice.id), /not open/);
  command({ type: 'resume' });
  advance(5000);
  game.buzz(alice.id);
  command({ type: 'reset' });
  assert.equal(game.snapshot().submissionCount, 0);
  assert.equal(game.snapshot().submissionsClosed, false);
  advance(29999);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  advance(1);
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot().submissionsClosed, true);
  assert.equal(game.snapshot(true).hostSubmissions?.length, 2);
});

test('undoing a buzzer ruling restores the answering state and keeps submissions closed', () => {
  const { game, alice, command, advance } = setup();
  advance(10000);
  game.buzz(alice.id);
  command({ type: 'judge', correct: true });
  command({ type: 'undo' });
  assert.equal(alice.score, 0);
  assert.equal(game.snapshot().phase, 'ANSWERING');
  assert.equal(game.snapshot().submissionsClosed, true);
});

test('correct buzzer answer waits for remaining media before typed review', () => {
  let time = 0;
  const mediaQuiz: Quiz = { ...quiz, questions: [{ ...quiz.questions[0], type: 'audio', media: '/media/clue.wav',
    playback: { startSeconds: 0, endSeconds: 20 } }] };
  const game = new GameEngine(mediaQuiz, () => time);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const advance = (ms: number) => { time += ms; game.tick(); };
  command({ type: 'start' });
  advance(3000);
  advance(START_COUNTDOWN_MS);
  advance(10000);
  game.buzz(player.id);
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  assert.equal(game.snapshot().phase, 'MEDIA_FINISH');
  assert.throws(() => command({ type: 'startReview' }), /media playback/);
  advance(10000);
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.equal(game.snapshot(true).hostSubmissions?.length, 0);
  command({ type: 'startReview' });
  assert.equal(game.snapshot().phase, 'GAME_FINISHED');
});

test('announcement precedes the next-round countdown and undo can cancel it', () => {
  let time = 0;
  const game = new GameEngine({ ...quiz, questions: [
    { id: 'first', type: 'text', mode: 'buzzer', question: 'First', answer: 'Answer' },
    quiz.questions[0],
  ] }, () => time);
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  const advance = (ms: number) => { time += ms; game.tick(); };
  command({ type: 'start' });
  advance(START_COUNTDOWN_MS);
  game.buzz(player.id);
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  assert.equal(game.snapshot().phase, 'TYPE_BUZZ_INTRO');
  assert.equal(game.snapshot().question?.mode, 'type-and-buzz');
  command({ type: 'undo' });
  assert.equal(game.snapshot().phase, 'ANSWERING');
  command({ type: 'judge', correct: true });
  advance(BUZZ_CORRECT_ANSWER_MS);
  advance(3000);
  assert.equal(game.snapshot().phase, 'NEXT_ROUND');
  advance(NEXT_ROUND_MS);
  assert.equal(game.snapshot().phase, 'QUESTION_OPEN');
  assert.equal(game.snapshot().question?.mode, 'type-and-buzz');
  assert.equal(game.snapshot().clueElapsedMs, 0);
});
