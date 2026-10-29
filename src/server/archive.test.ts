import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ArchiveQuizSettingsStorage, ArchiveQuizStorage } from './storage.js';

test('archive loads relative media and saves settings alongside questions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quiz-archive-'));
  try {
    await mkdir(path.join(root, '42'));
    const file = path.join(root, '42', 'quiz.json');
    const original = { schemaVersion: 1, quiz: { id: 42, title: 'Quiz', coverImage: 'media/cover.svg' }, questions: [{ id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', keyword: 'q', type: 'image', mode: 'buzzer', question: 'What?', answer: 'Secret', media: 'media/image.png', reveal: { effect: 'tiles' } }], gameSetup: { lockoutSeconds: 5 } };
    await writeFile(file, JSON.stringify(original));
    const storage = new ArchiveQuizStorage(root, 42);
    const quiz = await storage.load();
    assert.equal(quiz.coverImage, '/media/quiz/cover.svg');
    assert.equal(quiz.questions[0].media, '/media/quiz/image.png');
    assert.equal(quiz.questions[0].mode, 'buzzer');
    assert.equal(quiz.questions[0].reveal?.columns, 8);
    const settings = new ArchiveQuizSettingsStorage(storage);
    assert.equal(settings.load(42).lockoutSeconds, 5);
    const setup = { title: 'New', leaderboardCount: 8, startPoints: 500, minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, lockoutSeconds: 0, maxAnswerLength: 100 };
    settings.save(42, setup);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.questions, original.questions);
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.quiz.coverImage, original.quiz.coverImage);
    assert.equal(saved.quiz.title, 'New');
    assert.equal(saved.gameSetup.title, undefined);
    assert.equal((await storage.load()).title, 'New');
    assert.equal(settings.load(42).lockoutSeconds, 0);
    await writeFile(file, JSON.stringify({ ...original, quiz: { ...original.quiz, coverImage: 'media/../quiz.json' } }));
    await assert.rejects(storage.load(), /Invalid quiz media/);
    await writeFile(file, JSON.stringify({ ...original, gameSetup: { title: 'Override' } }));
    await assert.rejects(storage.load());
    await writeFile(file, JSON.stringify({ ...original, questions: [{ ...original.questions[0], id: 'old-text-id' }] }));
    await assert.rejects(storage.load());
    await writeFile(file, JSON.stringify({ ...original, questions: [original.questions[0], { ...original.questions[0], id: original.questions[0].id.toUpperCase() }] }));
    await assert.rejects(storage.load(), /Question IDs must be unique/);
    await writeFile(file, JSON.stringify({ ...original, quiz: { ...original.quiz, id: 43 } }));
    await assert.rejects(storage.load(), /ID does not match/);
    const { mode: _mode, ...withoutMode } = original.questions[0];
    for (const question of [withoutMode, { ...withoutMode, mode: null }, { ...withoutMode, mode: 'unknown' }]) {
      await writeFile(file, JSON.stringify({ ...original, questions: [question] }));
      await assert.rejects(storage.load(), /Question mode is required and must be/);
    }
    const { schemaVersion: _version, ...unversioned } = original;
    for (const document of [unversioned, { ...original, schemaVersion: 2 },
      { ...original, questions: [{ ...original.questions[0], timerSecond: 30 }] },
      { ...original, questions: [{ ...original.questions[0], fixedPoints: 250 }] }]) {
      const content = JSON.stringify(document);
      await writeFile(file, content);
      await assert.rejects(storage.load());
      assert.throws(() => settings.load(42));
      assert.throws(() => settings.save(42, setup));
      assert.equal(await readFile(file, 'utf8'), content, 'Invalid archives must not be rewritten');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
