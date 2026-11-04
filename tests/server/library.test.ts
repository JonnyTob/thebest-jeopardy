import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../../src/server/app.js';
import { ArchiveQuizSettingsStorage, ArchiveQuizStorage } from '../../src/server/storage.js';

const headers = { 'x-quiz-editor': '1', 'x-host-passcode': 'password', 'content-type': 'application/json' };

test('library creates, edits and loads a separate quiz while keeping players and using its settings and media', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quiz-library-'));
  const first = path.join(root, '100001');
  mkdirSync(path.join(first, 'media'), { recursive: true });
  writeFileSync(path.join(first, 'quiz.json'), JSON.stringify({ schemaVersion: 1, quiz: { id: 100001, title: 'First' }, questions: [
    { id: randomUUID(), type: 'text', mode: 'buzzer', question: 'One', answer: 'Answer' },
  ] }));
  const storage = new ArchiveQuizStorage(root, 100001);
  const application = await createApp({ storage, quizMediaRoot: storage.mediaRoot, settingsStorage: new ArchiveQuizSettingsStorage(storage), passcode: 'password', serveClient: false });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/editor/library`)).status, 403);
    const response = await fetch(`${base}/api/editor/library`, { method: 'POST', headers, body: JSON.stringify({ title: ' Second ' }) });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.quiz.id, 100002);
    assert.deepEqual(created.questions, []);
    const library = await (await fetch(`${base}/api/editor/library`, { headers })).json();
    assert.deepEqual(library.quizzes.map((quiz: { id: number }) => quiz.id), [100001, 100002]);
    const player = application.engine.join({ name: 'Alice', avatarId: 'fox' });
    const load = (id: number, revision = application.engine.revision) => fetch(`${base}/api/editor/library/load`, { method: 'POST', headers, body: JSON.stringify({ id, revision }) });
    assert.equal((await load(100002)).status, 409);
    const draft = await (await fetch(`${base}/api/editor/archive?quizId=100002`, { headers })).json();
    draft.archive.questions.push({ id: randomUUID(), type: 'image', mode: 'buzzer', question: 'Two', answer: 'Answer', media: 'media/image.png' });
    draft.archive.gameSetup = { startPoints: 800 };
    writeFileSync(path.join(root, '100002', 'media', 'image.png'), 'second-image');
    const saved = await fetch(`${base}/api/editor/archive?quizId=100002`, { method: 'PUT', headers, body: JSON.stringify(draft) });
    assert.equal(saved.status, 200);
    assert.equal(application.engine.quiz.id, 100001);
    assert.equal(await (await fetch(`${base}/media/archive/100002/image.png`)).text(), 'second-image');
    assert.equal((await load(100002, 0)).status, 409);
    player.score = 123;
    assert.equal((await load(100002)).status, 200);
    assert.equal(application.engine.quiz.id, 100002);
    assert.equal(application.engine.settings.startPoints, 800);
    assert.equal(application.engine.players.get(player.id)?.score, 0);
    assert.equal(application.engine.players.get(player.id)?.connected, true);
    assert.equal(await (await fetch(`${base}/media/quiz/image.png`)).text(), 'second-image');
    assert.equal((await (await fetch(`${base}/api/editor/archive`, { headers })).json()).archive.quiz.id, 100002);
    const remove = (id: number, revision: string, requestHeaders = headers) => fetch(`${base}/api/editor/library/${id}`, {
      method: 'DELETE', headers: requestHeaders, body: JSON.stringify({ revision }),
    });
    const current = await (await fetch(`${base}/api/editor/library`, { headers })).json();
    assert.equal((await remove(100002, current.quizzes.find((quiz: { id: number }) => quiz.id === 100002).revision)).status, 409);
    assert.equal((await remove(100001, current.quizzes.find((quiz: { id: number }) => quiz.id === 100001).revision)).status, 409);
    const third = await (await fetch(`${base}/api/editor/library`, { method: 'POST', headers, body: JSON.stringify({ title: 'Third' }) })).json();
    const folder = path.join(root, String(third.quiz.id));
    mkdirSync(path.join(folder, 'media', 'nested'));
    writeFileSync(path.join(folder, 'media', 'nested', 'file.wav'), 'media');
    const entries = await (await fetch(`${base}/api/editor/library`, { headers })).json();
    const thirdRevision = entries.quizzes.find((quiz: { id: number }) => quiz.id === third.quiz.id).revision;
    assert.equal((await remove(third.quiz.id, thirdRevision, { ...headers, 'x-host-passcode': 'wrong' })).status, 401);
    assert.equal((await remove(third.quiz.id, 'stale')).status, 409);
    assert.ok(existsSync(folder));
    assert.equal((await remove(third.quiz.id, thirdRevision)).status, 200);
    assert.equal(existsSync(folder), false);
    assert.equal((await fetch(`${base}/media/archive/${third.quiz.id}/nested/file.wav`)).status, 404);
    application.engine.command({ id: randomUUID(), revision: application.engine.revision, action: { type: 'start' } });
    assert.equal((await load(100001)).status, 409);
  } finally { await application.close(); rmSync(root, { recursive: true, force: true }); }
});
