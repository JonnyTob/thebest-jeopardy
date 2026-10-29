import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from './app.js';
import { ArchiveConflictError, ArchiveQuizSettingsStorage, ArchiveQuizStorage } from './storage.js';
import type { QuizArchive } from '../shared/quizArchive.js';

test('editor authorizes archive and media, detects stale writes, and protects loaded media', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quiz-editor-'));
  const directory = path.join(root, '42');
  await mkdir(path.join(directory, 'media'), { recursive: true });
  const archive: QuizArchive = { schemaVersion: 1, quiz: { id: 42, title: 'Original', coverImage: 'media/old.png' }, questions: [{
    id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type: 'image', mode: 'buzzer',
    question: 'What?', answer: 'SECRET', media: 'media/old.png',
  }] };
  await writeFile(path.join(directory, 'quiz.json'), JSON.stringify(archive));
  await writeFile(path.join(directory, 'media', 'old.png'), 'image');
  const storage = new ArchiveQuizStorage(root, 42);
  const setup = new ArchiveQuizSettingsStorage(storage);
  const application = await createApp({ storage, settingsStorage: setup, quizMediaRoot: storage.mediaRoot, passcode: 'host-passcode', serveClient: false });
  try {
    await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
    const address = application.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/editor`;
    const headers = { 'x-quiz-editor': '1', 'x-host-passcode': 'host-passcode' };
    assert.equal((await fetch(`${base}/archive`)).status, 403);
    assert.equal((await fetch(`${base}/archive`, { headers: { ...headers, 'x-host-passcode': 'wrong' } })).status, 401);
    const initialResponse = await fetch(`${base}/archive`, { headers });
    assert.equal(initialResponse.headers.get('cache-control'), 'no-store');
    const initial = await initialResponse.json() as { archive: QuizArchive; revision: string };
    assert.equal(initial.archive.questions[0].answer, 'SECRET');
    assert.equal((await fetch(`${base}/media`)).status, 403);
    const initialMedia = await (await fetch(`${base}/media`, { headers })).json();
    assert.deepEqual(initialMedia, { files: ['media/old.png'], loadedReferences: [
      { file: 'media/old.png', kind: 'cover' }, { file: 'media/old.png', kind: 'question', questionIndex: 0 },
    ] });
    const upload = await fetch(`${base}/media`, { method: 'POST', headers: { ...headers,
      'content-type': 'application/octet-stream', 'x-file-name': 'new%20picture.png' }, body: 'image' });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json() as { file: string };
    assert.match(uploaded.file, /^media\/new-picture-[0-9a-f]{4}\.png$/);
    const secondUpload = await fetch(`${base}/media`, { method: 'POST', headers: { ...headers,
      'content-type': 'application/octet-stream', 'x-file-name': 'new%20picture.png' }, body: 'second image' });
    assert.equal(secondUpload.status, 201);
    const secondUploaded = await secondUpload.json() as { file: string };
    assert.match(secondUploaded.file, /^media\/new-picture-[0-9a-f]{4}\.png$/);
    assert.notEqual(secondUploaded.file, uploaded.file);
    assert.equal(await readFile(path.join(directory, uploaded.file), 'utf8'), 'image');
    const badUpload = await fetch(`${base}/media`, { method: 'POST', headers: { ...headers,
      'content-type': 'application/octet-stream', 'x-file-name': 'test.svg' }, body: '<svg />' });
    assert.equal(badUpload.status, 400);
    const save = (data: QuizArchive, revision: string) => fetch(`${base}/archive`, { method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ archive: data, revision }) });
    const changed = structuredClone(initial.archive);
    changed.quiz.title = 'Edited';
    changed.questions[0].media = uploaded.file;
    assert.equal((await save({ ...changed, quiz: { ...changed.quiz, id: 43 } }, initial.revision)).status, 400);
    const invalid = structuredClone(changed);
    invalid.questions[0].answer = '';
    const invalidResponse = await save(invalid, initial.revision);
    assert.equal(invalidResponse.status, 400);
    assert.match(JSON.stringify(await invalidResponse.json()), /questions.0.answer/);
    const missing = structuredClone(changed);
    missing.questions[0].media = 'media/missing.png';
    assert.equal((await save(missing, initial.revision)).status, 400);
    const saved = await save(changed, initial.revision);
    assert.equal(saved.status, 200);
    assert.equal((await save(initial.archive, initial.revision)).status, 409);
    assert.equal(application.engine.quiz.title, 'Original');
    const currentMedia = await (await fetch(`${base}/media`, { headers })).json() as { loadedReferences: unknown };
    assert.deepEqual(currentMedia.loadedReferences, [
      { file: 'media/old.png', kind: 'cover' }, { file: 'media/old.png', kind: 'question', questionIndex: 0 },
    ]);
    assert.equal(JSON.parse(await readFile(storage.file, 'utf8')).quiz.title, 'Edited');
    assert.throws(() => setup.save(42, application.engine.settings), ArchiveConflictError);
    const deleteFile = (file: string) => fetch(`${base}/media`, { method: 'DELETE', headers: { ...headers,
      'content-type': 'application/json' }, body: JSON.stringify({ file }) });
    assert.equal((await deleteFile('media/old.png')).status, 409);
    assert.equal((await deleteFile(uploaded.file)).status, 409);
    assert.equal((await deleteFile('media/../quiz.json')).status, 404);
    const savedRevision = (await saved.json() as { revision: string }).revision;
    changed.questions[0].media = 'media/old.png';
    assert.equal((await save(changed, savedRevision)).status, 200);
    assert.equal((await deleteFile(uploaded.file)).status, 200);
    const current = storage.readArchive();
    await writeFile(storage.file, JSON.stringify({ ...current.archive, quiz: { ...current.archive.quiz, title: 'External edit' } }));
    assert.throws(() => storage.saveArchive(current.archive, current.revision), ArchiveConflictError);
    const refreshedSetup = new ArchiveQuizSettingsStorage(storage);
    refreshedSetup.load(42);
    const beforeSetup = storage.readArchive();
    refreshedSetup.save(42, { ...application.engine.settings, title: 'Setup edit' });
    assert.throws(() => storage.saveArchive(beforeSetup.archive, beforeSetup.revision), ArchiveConflictError);
  } finally {
    await application.close();
    await rm(root, { recursive: true, force: true });
  }
});
