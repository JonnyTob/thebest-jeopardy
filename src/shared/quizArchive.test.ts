import assert from 'node:assert/strict';
import { test } from 'node:test';
import { questionSchema, type Question } from './protocol.js';
import { archiveQuestionSchema, quizArchiveSchema, toRuntimeQuiz } from './quizArchive.js';

function question(type: Question['type'] = 'text', mode: Question['mode'] = 'buzzer') {
  return {
    id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type, mode,
    question: 'Clue', answer: 'Answer',
    ...(type !== 'text' ? { media: 'media/clue.svg' } : {}),
    ...(mode === 'typed' ? { fixedPoints: 250, timerSeconds: 30 } : {}),
  };
}

function archive(entry: unknown = question()) {
  return { schemaVersion: 1, quiz: { id: 42, title: 'Quiz' }, questions: [entry] };
}

test('archive format requires version 1 and rejects missing, future and malformed versions', () => {
  const { schemaVersion: _version, ...unversioned } = archive();
  for (const value of [unversioned, ...[0, 2, -1, 1.5, '1', null].map((schemaVersion) => ({ ...archive(), schemaVersion }))]) {
    const result = quizArchiveSchema.safeParse(value);
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues[0].path, ['schemaVersion']);
  }
  assert.equal(quizArchiveSchema.parse(archive()).schemaVersion, 1);
});

test('archive accepts all eight type/mode combinations and reports missing typed settings by field', () => {
  for (const type of ['text', 'image', 'audio', 'video'] as const) {
    for (const mode of ['buzzer', 'typed'] as const) {
      const entry = question(type, mode);
      assert.deepEqual(archiveQuestionSchema.parse(entry), entry);
      const runtime = toRuntimeQuiz(quizArchiveSchema.parse(archive(entry)));
      assert.equal(runtime.questions[0].type, type);
      assert.equal(runtime.questions[0].mode, mode);
    }
    for (const field of ['fixedPoints', 'timerSeconds'] as const) {
      const result = quizArchiveSchema.safeParse(archive({ ...question(type, 'typed'), [field]: undefined }));
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.some((issue) =>
        JSON.stringify(issue.path) === JSON.stringify(['questions', 0, field])));
      assert.equal(archiveQuestionSchema.safeParse({ ...question(type), [field]: 30 }).success, false);
    }
    if (type !== 'text') {
      const result = archiveQuestionSchema.safeParse({ ...question(type), media: undefined });
      assert.equal(result.success, false);
      if (!result.success) assert.deepEqual(result.error.issues[0].path, ['media']);
    }
  }
});

test('type-specific fields are accepted only on their applicable clue types in archive and runtime schemas', () => {
  const fields: { field: string; value: unknown; types: Question['type'][] }[] = [
    { field: 'text', value: 'Body', types: ['text'] },
    { field: 'media', value: 'media/clue.svg', types: ['image', 'audio', 'video'] },
    { field: 'reveal', value: { effect: 'tiles' }, types: ['image'] },
    { field: 'playback', value: { startSeconds: 1, endSeconds: 2 }, types: ['audio', 'video'] },
    { field: 'visualizer', value: { enabled: false, style: 'spectrum' }, types: ['audio'] },
  ];
  for (const type of ['text', 'image', 'audio', 'video'] as const) {
    for (const mode of ['buzzer', 'typed'] as const) {
      for (const { field, value, types } of fields) {
        const entry = { ...question(type, mode), [field]: value };
        const valid = types.includes(type);
        const result = archiveQuestionSchema.safeParse(entry);
        assert.equal(result.success, valid, `${type}/${mode}/${field}`);
        if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === field));
        const runtime = { ...entry, ...(entry.media !== undefined ? { media: '/media/clue.svg' } : {}) };
        assert.equal(questionSchema.safeParse(runtime).success, valid, `runtime ${type}/${mode}/${field}`);
      }
    }
  }
});

test('archive and runtime validation reject unknown fields, including nested configuration typos', () => {
  for (const entry of [
    { ...question(), timerSecond: 30 },
    { ...question('image'), reveal: { effect: 'tiles', column: 8 } },
    { ...question('audio'), playback: { endSecond: 8 } },
    { ...question('audio'), visualizer: { enabled: true, style: 'spectrum', typo: true } },
    { ...question(), answerNotes: 'Not supported' },
  ]) {
    assert.equal(archiveQuestionSchema.safeParse(entry).success, false);
    assert.equal(questionSchema.safeParse({ ...entry,
      ...(entry.media !== undefined ? { media: '/media/clue.svg' } : {}) }).success, false);
  }
  for (const value of [
    { ...archive(), typo: true },
    { ...archive(), quiz: { ...archive().quiz, typo: true } },
    { ...archive(), gameSetup: { title: 'Wrong place' } },
    { ...archive(), gameSetup: { TimerEndOffsetSeconds: 2 } },
    { ...archive(), gameSetup: { minPoints: 10 } },
  ]) assert.equal(quizArchiveSchema.safeParse(value).success, false);
});

test('canonical parsing preserves omitted defaults and relative paths; runtime normalization does not mutate it', () => {
  const original = {
    ...archive(),
    quiz: { id: 42, title: 'Quiz', coverImage: 'media/cover.svg' },
    gameSetup: {},
    questions: [
      { ...question('image'), id: question().id.toUpperCase(), reveal: { effect: 'tiles' } },
      { ...question('audio', 'typed'), id: 'd1283d6f-bdd5-4d28-99c1-f2b344406394', playback: { endSeconds: 8 } },
    ],
  };
  const parsed = quizArchiveSchema.parse(original);
  assert.deepEqual(parsed, original);
  const runtime = toRuntimeQuiz(parsed);
  assert.deepEqual(parsed, original);
  assert.equal(runtime.coverImage, '/media/quiz/cover.svg');
  assert.equal(runtime.questions[0].id, question().id);
  assert.equal(runtime.questions[0].media, '/media/quiz/clue.svg');
  assert.deepEqual(runtime.questions[0].reveal, {
    effect: 'tiles', durationSeconds: 20, columns: 8, rows: 6, seed: 814,
  });
  assert.deepEqual(runtime.questions[1].playback, { startSeconds: 0, endSeconds: 8 });
  assert.deepEqual(parsed.gameSetup, {});
  assert.equal('schemaVersion' in runtime, false);
  assert.equal('gameSetup' in runtime, false);
});

test('archive validates IDs, metadata, question counts, settings ranges and playback boundaries', () => {
  const repeated = [question(), { ...question(), id: question().id.toUpperCase() }];
  const duplicate = quizArchiveSchema.safeParse({ ...archive(), questions: repeated });
  assert.equal(duplicate.success, false);
  if (!duplicate.success) assert.deepEqual(duplicate.error.issues[0].path, ['questions', 1, 'id']);
  for (const value of [
    { ...archive(), questions: [] },
    { ...archive(), questions: Array.from({ length: 501 }, () => question()) },
    archive({ ...question(), id: 'not-a-uuid' }),
    archive({ ...question(), keyword: '' }),
    { ...archive(), quiz: { id: 0, title: 'Quiz' } },
    { ...archive(), quiz: { id: 42, title: ' ' } },
    { ...archive(), gameSetup: { startPoints: 100, minimumPoints: 200 } },
    { ...archive(), gameSetup: { lockoutSeconds: 301 } },
    archive({ ...question('audio'), playback: { startSeconds: 2, endSeconds: 2 } }),
    archive({ ...question('audio'), playback: { startSeconds: 3, endSeconds: 2 } }),
  ]) assert.equal(quizArchiveSchema.safeParse(value).success, false);
  for (const gameSetup of [{}, { startPoints: 100 }, { minimumPoints: 200 }, { maxAnswerLength: 100 }]) {
    assert.deepEqual(quizArchiveSchema.parse({ ...archive(), gameSetup }).gameSetup, gameSetup);
  }
});

test('archive media paths must remain relative to the quiz media folder', () => {
  for (const media of ['/media/quiz/clue.svg', 'https://example.com/clue.svg', 'media/../quiz.json',
    '../media/clue.svg', 'other/clue.svg', 'media\\clue.svg', 'media/']) {
    assert.equal(quizArchiveSchema.safeParse(archive({ ...question('image'), media })).success, false, media);
    assert.equal(quizArchiveSchema.safeParse({ ...archive(), quiz: { ...archive().quiz, coverImage: media } }).success, false, media);
  }
});
