import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsAt, tileOrder, valueWindowMs } from './game.js';
import { quizSchema } from './protocol.js';

test('default points hit exact boundaries and stay at minimum indefinitely', () => {
  const settings = { title: 'Test', leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5 };
  for (const [elapsed, expected] of [[0, 500], [4999, 500], [5000, 400], [10000, 300], [15000, 200], [20000, 100], [999999, 100]]) {
    assert.equal(pointsAt(elapsed, settings), expected);
  }
  assert.equal(valueWindowMs(settings), 20000);
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

test('quiz validation rejects missing media, duplicate IDs and invalid playback ranges', () => {
  const question = { id: 'one', type: 'text', question: 'Question', answer: 'Answer' };
  assert.equal(quizSchema.safeParse({ title: 'Quiz', questions: [question, question] }).success, false);
  assert.equal(quizSchema.safeParse({ title: 'Quiz', questions: [{ ...question, type: 'image' }] }).success, false);
  assert.equal(quizSchema.safeParse({ title: 'Quiz', questions: [{ ...question, type: 'audio', media: '/media/sound.mp3', playback: { startSeconds: 30, endSeconds: 10 } }] }).success, false);
});
