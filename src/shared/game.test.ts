import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsAt, startCountdownText, tileOrder, valueWindowMs } from './game.js';
import { questionSchema, quizSchema, settingsSchema } from './protocol.js';

test('every question requires an explicit valid mode for all clue types', () => {
  for (const type of ['text', 'image', 'audio', 'video'] as const) {
    const question = { id: 'one', type, question: 'Clue', answer: 'Answer',
      ...(type === 'text' ? {} : { media: '/media/clue.svg' }) };
    for (const mode of [undefined, null, '', 'other', 0]) {
      const result = questionSchema.safeParse({ ...question, ...(mode === undefined ? {} : { mode }) });
      assert.equal(result.success, false, `${type}/${String(mode)}`);
      if (!result.success) {
        assert.ok(result.error.issues.some((issue) => issue.path[0] === 'mode'
          && issue.message.includes('Question mode is required')));
      }
    }
    assert.equal(questionSchema.parse({ ...question, mode: 'buzzer' }).mode, 'buzzer');
    assert.equal(questionSchema.parse({ ...question, mode: 'typed', fixedPoints: 250, timerSeconds: 30 }).mode, 'typed');
  }
});

test('game-start countdown gives each number and the launch message one second', () => {
  for (const [remaining, text] of [[4000, '3'], [3001, '3'], [3000, '2'], [2001, '2'],
    [2000, '1'], [1001, '1'], [1000, "LET'S GO!"], [1, "LET'S GO!"], [0, "LET'S GO!"]] as const) {
    assert.equal(startCountdownText(remaining), text);
  }
});

test('default points hit exact boundaries and stay at minimum indefinitely', () => {
  const settings = { title: 'Test', leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, pointDecayDelaySeconds: 0, questionTimerSeconds: 30, lockoutSeconds: 0, maxAnswerLength: 100 };
  for (const [elapsed, expected] of [[0, 500], [4999, 500], [5000, 400], [10000, 300], [15000, 200], [20000, 100], [999999, 100]]) {
    assert.equal(pointsAt(elapsed, settings), expected);
  }
  assert.equal(valueWindowMs(settings), 20000);
});

test('point decay waits for the configured delay before its first interval', () => {
  const settings = settingsSchema.parse({ title: 'Test', leaderboardCount: 8, startPoints: 500,
    minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, pointDecayDelaySeconds: 3 });
  for (const [elapsed, expected] of [[0, 500], [2999, 500], [3000, 500],
    [7999, 500], [8000, 400], [13000, 300], [23000, 100]]) {
    assert.equal(pointsAt(elapsed, settings), expected);
  }
  const base = { title: 'Test', leaderboardCount: 8, startPoints: 500,
    minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5 };
  assert.equal(settingsSchema.parse(base).pointDecayDelaySeconds, 5);
  for (const delay of [-1, 301, 1.5, '5']) {
    assert.equal(settingsSchema.safeParse({ ...base, pointDecayDelaySeconds: delay }).success, false);
  }
});

test('tile order is a deterministic permutation, including seed zero', () => {
  for (const seed of [0, 814, 1234]) {
    const order = tileOrder(48, seed);
    assert.deepEqual(tileOrder(48, seed), order);
    assert.equal(new Set(order).size, 48);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 48 }, (_, i) => i));
  }
  assert.notDeepEqual(tileOrder(48, 814), tileOrder(48, 815));
});

test('lockout settings preserve the default and validate whole seconds from 0 to 300', () => {
  const settings = { title: 'Test', leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5 };
  assert.equal(settingsSchema.parse(settings).lockoutSeconds, 0);
  for (const lockoutSeconds of [0, 1, 10, 300]) {
    assert.equal(settingsSchema.parse({ ...settings, lockoutSeconds }).lockoutSeconds, lockoutSeconds);
  }
  for (const lockoutSeconds of [-1, 0.5, 301, '10']) {
    assert.equal(settingsSchema.safeParse({ ...settings, lockoutSeconds }).success, false);
  }
});

test('quiz validation rejects missing media, duplicate IDs and invalid playback ranges', () => {
  const question = { id: 'one', type: 'text', mode: 'buzzer', question: 'Question', answer: 'Answer' };
  assert.equal(quizSchema.safeParse({ id: 100001, title: 'Quiz', questions: [question, question] }).success, false);
  assert.equal(quizSchema.safeParse({ id: 100001, title: 'Quiz', questions: [{ ...question, type: 'image' }] }).success, false);
  assert.equal(quizSchema.safeParse({ id: 100001, title: 'Quiz', questions: [{ ...question, type: 'audio', media: '/media/sound.mp3', playback: { startSeconds: 30, endSeconds: 10 } }] }).success, false);
});

test('quiz IDs are required positive safe integers, distinct from question IDs', () => {
  const quiz = { title: 'Quiz', questions: [{ id: 'one', type: 'text', mode: 'buzzer', question: 'Question', answer: 'Answer' }] };
  assert.equal(quizSchema.safeParse(quiz).success, false);
  for (const id of [1, 100001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(quizSchema.parse({ ...quiz, id }).id, id);
  }
  for (const id of [0, -1, 1.5, '100001', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(quizSchema.safeParse({ ...quiz, id }).success, false);
  }
});

test('quiz covers are optional and restricted to local media paths', () => {
  const quiz = { id: 100001, title: 'Quiz', questions: [{ id: 'one', type: 'text', mode: 'buzzer', question: 'Question', answer: 'Answer' }] };
  assert.equal(quizSchema.parse(quiz).coverImage, undefined);
  assert.equal(quizSchema.parse({ ...quiz, coverImage: '/media/covers/100001.svg' }).coverImage, '/media/covers/100001.svg');
  for (const coverImage of ['', 'https://example.com/cover.jpg', '/media/../questions.json', '/private/cover.jpg']) {
    assert.equal(quizSchema.safeParse({ ...quiz, coverImage }).success, false);
  }
});
