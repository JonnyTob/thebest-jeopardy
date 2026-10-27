import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { HostAction } from '../shared/protocol.js';
import { GameEngine } from './engine.js';
import { JsonQuizStorage } from './storage.js';
import { START_COUNTDOWN_MS } from '../shared/game.js';

const storage = new JsonQuizStorage(path.resolve('src/data/questions.json'));

test('sample quiz demonstrates both modes for every media type with real local assets', async () => {
  const quiz = await storage.load();
  for (const type of ['text', 'image', 'audio', 'video']) {
    for (const mode of ['buzzer', 'typed']) {
      assert.ok(quiz.questions.some((question) => question.type === type && (question.mode ?? 'buzzer') === mode),
        `Missing ${type}/${mode} example`);
    }
  }
  assert.ok(quiz.questions.some((question) => question.mode === undefined), 'Keep an implicit buzzer example');
  assert.ok(quiz.questions.some((question) => question.reveal?.effect === 'static'));
  assert.ok(quiz.questions.some((question) => question.reveal?.effect === 'tiles'));
  assert.ok(quiz.questions.some((question) => question.visualizer?.enabled === true));
  assert.ok(quiz.questions.some((question) => question.visualizer?.enabled === false));
  for (const type of ['audio', 'video']) {
    assert.ok(quiz.questions.some((question) => question.type === type && !question.playback));
    assert.ok(quiz.questions.some((question) => question.type === type && (question.playback?.startSeconds ?? 0) > 0));
  }
  const assets = new Set([quiz.coverImage, ...quiz.questions.map((question) => question.media)]);
  for (const media of assets) {
    if (!media) continue;
    const bytes = await readFile(path.resolve('src/public', media.slice(1)));
    assert.ok(bytes.length > 0, `Empty sample media: ${media}`);
    if (media.endsWith('.svg')) assert.match(bytes.toString('utf8'), /<svg/);
    if (media.endsWith('.wav')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      const duration = (bytes.length - 44) / bytes.readUInt32LE(28);
      assert.equal(duration, 8);
      for (const question of quiz.questions.filter((question) => question.media === media)) {
        assert.ok((question.playback?.endSeconds ?? 0) <= duration);
      }
    }
    if (media.endsWith('.mp4')) assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
  }
});

test('sample quiz plays through mixed buzzer and typed questions to completion', async () => {
  const quiz = await storage.load();
  let time = 0;
  const game = new GameEngine(quiz, () => time);
  const player = game.join({ name: 'Sample player', avatarId: 'fox' });
  const command = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  let expectedScore = 0;
  command({ type: 'start' });
  assert.equal(game.snapshot().phase, 'STARTING');
  time += START_COUNTDOWN_MS;
  game.tick();
  for (const [index, question] of quiz.questions.entries()) {
    assert.equal(game.snapshot().questionIndex, index);
    assert.equal(game.snapshot().question?.id, question.id);
    assert.equal(game.snapshot().privateAnswer, undefined);
    assert.equal(game.snapshot().revealedAnswer, null);
    assert.equal(game.snapshot(true).privateAnswer, question.answer);
    if (question.mode === 'typed') {
      const instanceId = game.snapshot().questionInstanceId;
      assert.ok(instanceId);
      game.submitAnswer(player.id, instanceId, 'Practice answer');
      command({ type: 'close' });
      command({ type: 'startReview' });
      command({ type: 'judgeReview', correct: true });
      command({ type: 'nextReview' });
      expectedScore += question.fixedPoints!;
    } else {
      game.buzz(player.id);
      expectedScore += game.snapshot().pointsAtBuzz!;
      command({ type: 'judge', correct: true });
    }
    assert.equal(player.score, expectedScore);
    command({ type: 'reveal' });
    assert.equal(game.snapshot().revealedAnswer, question.answer);
    command({ type: 'next' });
  }
  assert.equal(game.snapshot().phase, 'GAME_FINISHED');
});
