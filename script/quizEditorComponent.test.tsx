import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { QuizArchive } from '../src/shared/quizArchive.js';
import { toRuntimeQuiz } from '../src/shared/quizArchive.js';
import { GameEngine } from '../src/server/engine.js';
import { serverSettingsSchema } from '../src/shared/protocol.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { QuizEditor } = await import('../src/client/components/QuizEditor.js');
const { QuestionPreview, previewSnapshot } = await import('../src/client/components/QuestionPreview.js');
Object.assign(globalThis, { document: previousDocument });

test('editor handles drafts, validation, question IDs, reordering and conflict feedback', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const listeners = new Map<string, EventListener>();
  const archive: QuizArchive = { schemaVersion: 1, quiz: { id: 42, title: 'Quiz' }, questions: [{
    id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type: 'text', mode: 'buzzer', question: 'First', answer: 'Answer',
  }] };
  const saves: QuizArchive[] = [];
  let conflict = false;
  Object.assign(globalThis, { window: {
    addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    confirm: () => true,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }, fetch: async (url: string, init?: RequestInit) => {
    if (url.endsWith('/media')) return Response.json({ files: [], loadedReferences: [] });
    if (init?.method === 'PUT') {
      saves.push(JSON.parse(String(init.body)).archive);
      return conflict ? Response.json({ error: 'The quiz file changed.' }, { status: 409 }) : Response.json({ revision: 'new' });
    }
    return Response.json({ archive, revision: 'original' });
  } });
  let dirty = false;
  let view!: ReactTestRenderer;
  try {
    const gameState = new GameEngine(toRuntimeQuiz(archive)).snapshot(true);
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(QuizEditor, {
      passcode: 'host', gameState, onDirtyChange: (value) => { dirty = value; },
    })), { createNodeMock: (element) => element.type === 'dialog'
      ? { open: true, showModal() {}, close() {} } : null }); });
    const button = (text: string) => view.root.findAllByType('button').find((item) => item.children.join('') === text)!;
    const field = (text: string, type: 'input' | 'textarea' | 'select') => view.root.findAllByType('label')
      .find((label) => label.children[0] === text)!.findByType(type);
    const modes = () => view.root.findByProps({ className: 'editor-list' }).findAllByType('button')
      .map((item) => item.findAllByType('span')[1].children.join(''));
    assert.deepEqual(modes(), ['Buzzer']);
    assert.equal(field('Question', 'textarea').props.rows, 1);
    assert.equal(field('Answer', 'textarea').props.rows, 1);
    assert.equal(field('Clue text (optional)', 'textarea').props.rows, 1);
    const heading = view.root.findByProps({ className: 'editor-question-heading' });
    assert.equal(heading.findByType('h2').children.join(''), 'Question 1');
    assert.equal(heading.findByType('button').children.join(''), 'Preview question');
    assert.match(heading.findByType('button').props.className, /\bprimary\b/);
    assert.equal(view.root.findAllByType('button').filter((item) => item.children.join('') === 'Preview question').length, 1);
    await act(async () => { button('Duplicate').props.onClick(); });
    assert.equal(dirty, true);
    assert.deepEqual(modes(), ['Buzzer', 'Buzzer']);
    await act(async () => { button('Move up').props.onClick(); });
    await act(async () => { field('Question', 'textarea').props.onChange({ target: { value: '' } }); });
    await act(async () => { button('Preview question').props.onClick(); });
    assert.match(JSON.stringify(view.toJSON()), /Correct these fields before previewing/);
    assert.equal(view.root.findAllByType(QuestionPreview).length, 0);
    await act(async () => { button('Save quiz').props.onClick(); });
    assert.match(JSON.stringify(view.toJSON()), /questions.0.question/);
    assert.equal(saves.length, 0);
    await act(async () => { field('Question', 'textarea').props.onChange({ target: { value: 'Copy' } }); });
    await act(async () => { field('Mode', 'select').props.onChange({ target: { value: 'typed' } }); });
    assert.deepEqual(modes(), ['Typed', 'Buzzer']);
    await act(async () => { field('Answer', 'textarea').props.onChange({ target: { value: '' } }); });
    await act(async () => { button('Preview question').props.onClick(); });
    assert.equal(view.root.findAllByType(QuestionPreview).length, 1);
    assert.equal(view.root.findAllByType('dialog').length, 1);
    assert.equal(view.root.findByType(QuestionPreview).props.preview.question.question, 'Copy');
    assert.equal(view.root.findByType('iframe').props.title, 'TV question preview');
    await act(async () => { field('Question', 'textarea').props.onChange({ target: { value: 'Changed' } }); });
    assert.equal(view.root.findByType(QuestionPreview).props.preview.question.question, 'Copy');
    await act(async () => { button('Refresh preview').props.onClick(); });
    assert.equal(view.root.findByType(QuestionPreview).props.preview.question.question, 'Changed');
    assert.equal(view.root.findByType(QuestionPreview).props.generation, 2);
    await act(async () => { field('Question', 'textarea').props.onChange({ target: { value: '' } }); });
    await act(async () => { button('Refresh preview').props.onClick(); });
    assert.equal(view.root.findByType(QuestionPreview).props.preview.question.question, 'Changed');
    assert.match(view.root.findByType(QuestionPreview).props.error, /questions.0.question/);
    let prevented = false;
    await act(async () => { view.root.findByType('dialog').props.onCancel({ preventDefault: () => { prevented = true; } }); });
    assert.equal(prevented, true);
    assert.equal(view.root.findAllByType(QuestionPreview).length, 0);
    await act(async () => { field('Question', 'textarea').props.onChange({ target: { value: 'Copy' } }); });
    await act(async () => { button('Preview question').props.onClick(); });
    await act(async () => { button('Close preview').props.onClick(); });
    assert.equal(view.root.findAllByType(QuestionPreview).length, 0);
    await act(async () => { field('Answer', 'textarea').props.onChange({ target: { value: 'Answer' } }); });
    await act(async () => { button('Save quiz').props.onClick(); });
    const saved = saves[0];
    assert.ok(saved);
    assert.equal(saved.questions[0].question, 'Copy');
    assert.notEqual(saved.questions[0].id, archive.questions[0].id);
    assert.equal(saved.questions[1].id, archive.questions[0].id);
    assert.equal(saved.questions[0].mode, 'typed');
    assert.equal(saved.questions[0].timerSeconds, undefined);
    assert.equal(dirty, false);
    conflict = true;
    await act(async () => { field('Answer', 'textarea').props.onChange({ target: { value: 'New answer' } }); });
    await act(async () => { button('Save quiz').props.onClick(); });
    assert.equal(dirty, true);
    assert.match(JSON.stringify(view.toJSON()), /quiz file changed/);
    let warned = false;
    listeners.get('beforeunload')?.({ preventDefault: () => { warned = true; } } as Event);
    assert.equal(warned, true);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    Object.assign(globalThis, { fetch: originalFetch, window: originalWindow });
  }
});

test('changing clue types does not prompt and clears only incompatible fields', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const archive: QuizArchive = { schemaVersion: 1, quiz: { id: 42, title: 'Quiz' }, questions: [{
    id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type: 'audio', mode: 'buzzer',
    question: 'First', answer: 'Answer', media: 'media/music.mp3',
    playback: { startSeconds: 3, endSeconds: 7 }, visualizer: { enabled: true, style: 'spectrum' },
  }] };
  const saves: QuizArchive[] = [];
  let confirmations = 0;
  Object.assign(globalThis, { window: {
    addEventListener() {}, removeEventListener() {}, confirm: () => { confirmations++; return false; },
  }, fetch: async (url: string, init?: RequestInit) => {
    if (url.endsWith('/media')) return Response.json({ files: ['media/music.mp3'], loadedReferences: [] });
    if (init?.method === 'PUT') {
      saves.push((JSON.parse(String(init.body)) as { archive: QuizArchive }).archive);
      return Response.json({ revision: 'new' });
    }
    return Response.json({ archive, revision: 'original' });
  } });
  let view!: ReactTestRenderer;
  try {
    const gameState = new GameEngine(toRuntimeQuiz(archive)).snapshot(true);
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(QuizEditor, {
      passcode: 'host', gameState, onDirtyChange() {},
    }))); });
    const field = (text: string, type: 'textarea' | 'select') => view.root.findAllByType('label')
      .find((label) => label.children[0] === text)!.findByType(type);
    const button = (text: string) => view.root.findAllByType('button').find((item) => item.children.join('') === text)!;
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'video' } }); });
    await act(async () => { button('Save quiz').props.onClick(); });
    assert.equal(saves[0].questions[0].type, 'video');
    assert.equal(saves[0].questions[0].media, 'media/music.mp3');
    assert.deepEqual(saves[0].questions[0].playback, { startSeconds: 3, endSeconds: 7 });
    assert.equal(saves[0].questions[0].visualizer, undefined);
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'text' } }); });
    await act(async () => { button('Save quiz').props.onClick(); });
    assert.equal(saves[1].questions[0].type, 'text');
    assert.equal(saves[1].questions[0].media, undefined);
    assert.equal(saves[1].questions[0].playback, undefined);
    await act(async () => { field('Clue text (optional)', 'textarea').props.onChange({ target: { value: 'Clue text' } }); });
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'image' } }); });
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'text' } }); });
    assert.equal(field('Clue text (optional)', 'textarea').props.value, '');
    assert.equal(confirmations, 0);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    Object.assign(globalThis, { fetch: originalFetch, window: originalWindow });
  }
});

test('media picker and library search, page, preview, upload and protect references', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const archive: QuizArchive = { schemaVersion: 1, quiz: { id: 42, title: 'Quiz', coverImage: 'media/missing.png' }, questions: [{
    id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type: 'image', mode: 'buzzer',
    question: 'First', answer: 'Answer', media: 'media/image-00.png',
  }] };
  const files = [...Array.from({ length: 25 }, (_, index) => `media/image-${String(index).padStart(2, '0')}.png`),
    'media/music.mp3', 'media/clip.mp4', 'media/misc.txt'].sort();
  const deletes: string[] = [];
  const saves: QuizArchive[] = [];
  let dirty = false;
  Object.assign(globalThis, { window: {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
  }, fetch: async (url: string, init?: RequestInit) => {
    if (url.endsWith('/media') && init?.method === 'POST') {
      const name = decodeURIComponent(new Headers(init.headers).get('x-file-name') ?? '');
      return name.endsWith('.svg') ? Response.json({ error: 'Unsupported upload.' }, { status: 400 })
        : Response.json({ file: `media/uploaded-${name}` }, { status: 201 });
    }
    if (url.endsWith('/media') && init?.method === 'DELETE') {
      const file = (JSON.parse(String(init.body)) as { file: string }).file;
      deletes.push(file);
      return file === 'media/image-00.png'
        ? Response.json({ error: 'Referenced by the saved or currently loaded quiz.' }, { status: 409 })
        : Response.json({ ok: true });
    }
    if (url.endsWith('/media')) return Response.json({ files, loadedReferences: [
      { file: 'media/image-00.png', kind: 'question', questionIndex: 0 },
    ] });
    if (init?.method === 'PUT') {
      saves.push((JSON.parse(String(init.body)) as { archive: QuizArchive }).archive);
      return Response.json({ revision: 'new' });
    }
    return Response.json({ archive, revision: 'original' });
  } });
  let view!: ReactTestRenderer;
  try {
    const gameState = new GameEngine(toRuntimeQuiz(archive)).snapshot(true);
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(QuizEditor, {
      passcode: 'host', gameState, onDirtyChange: (value) => { dirty = value; },
    })), { createNodeMock: (element) => element.type === 'dialog'
      ? { open: true, showModal() {}, close() {} } : { focus() {} } }); });
    const button = (text: string) => view.root.findAllByType('button').find((item) => item.children.join('') === text)!;
    const labelledButton = (label: string) => view.root.findByProps({ 'aria-label': label });
    const field = (text: string, type: 'input' | 'select') => view.root.findAllByType('label')
      .find((label) => label.children[0] === text)!.findByType(type);
    const text = () => JSON.stringify(view.toJSON());
    const upload = async (name: string) => {
      await act(async () => { field('Upload media', 'input').props.onChange({ currentTarget: { files: [new File(['data'], name)], value: name } }); });
    };

    await act(async () => { labelledButton('Choose cover image').props.onClick({ currentTarget: { focus() {} } }); });
    assert.match(text(), /media\/missing.png.*missing/);
    assert.equal(view.root.findAllByType('img').length, 0);
    assert.equal(view.root.findAllByProps({ className: 'media-browser-list' })[0].findAllByType('button').length, 20);
    assert.doesNotMatch(text(), /media\/music.mp3/);
    files.push('media/new-external.png'); files.sort();
    await act(async () => { button('Refresh media').props.onClick(); });
    await act(async () => { field('Search media', 'input').props.onChange({ target: { value: 'new-external' } }); });
    assert.match(text(), /media\/new-external.png/);
    assert.equal(dirty, false);
    await act(async () => { field('Search media', 'input').props.onChange({ target: { value: 'IMAGE-22' } }); });
    await act(async () => { button('media/image-22.png').props.onClick(); });
    assert.equal(view.root.findAllByType('img').length, 1);
    await act(async () => { button('Cancel').props.onClick(); });
    assert.equal(dirty, false);
    assert.match(text(), /media\/missing.png.*missing/);

    await act(async () => { labelledButton('Choose cover image').props.onClick({ currentTarget: { focus() {} } }); });
    await act(async () => { field('Search media', 'input').props.onChange({ target: { value: 'IMAGE-22' } }); });
    await act(async () => { button('media/image-22.png').props.onClick(); });
    await act(async () => { button('Select media').props.onClick(); });
    assert.equal(dirty, true);
    assert.match(text(), /media\/image-22.png/);

    await act(async () => { labelledButton('Choose clue media').props.onClick({ currentTarget: { focus() {} } }); });
    const usage = () => view.root.findByProps({ className: 'media-usage' }).findAllByType('p').map((item) => item.children.join(''));
    assert.deepEqual(usage(), ['Current edits: Question 1', 'Last loaded or saved in editor: Question 1', 'Running quiz: Question 1']);
    await upload('sound.mp3');
    assert.match(text(), /cannot be selected here/);
    assert.equal(view.root.findAllByType('audio').length, 0);
    await upload('invalid.svg');
    assert.match(text(), /Unsupported upload/);
    await upload('picture.png');
    assert.match(text(), /Uploaded media\/uploaded-picture.png/);
    assert.equal(view.root.findAllByType('img').length, 1);
    await act(async () => { button('Select media').props.onClick(); });

    await act(async () => { view.root.findByType('details').props.onToggle({ currentTarget: { open: true } }); });
    assert.equal(view.root.findAllByType('img').length, 0);
    assert.equal(view.root.findByProps({ className: 'media-browser-list' }).findAllByType('button').length, 20);
    await act(async () => { button('Next page').props.onClick(); });
    assert.match(text(), /Page.*2.*of.*2/);
    await act(async () => { field('Media type', 'select').props.onChange({ target: { value: 'audio' } }); });
    assert.match(text(), /media\/music.mp3/);
    assert.match(text(), /media\/uploaded-sound.mp3/);
    assert.doesNotMatch(text(), /media\/clip.mp4/);
    await act(async () => { button('media/uploaded-sound.mp3').props.onClick(); });
    assert.equal(view.root.findAllByType('audio').length, 1);
    await act(async () => { button('Delete file').props.onClick(); });
    assert.deepEqual(deletes, ['media/uploaded-sound.mp3']);

    await act(async () => { field('Media type', 'select').props.onChange({ target: { value: 'image' } }); });
    await act(async () => { field('Search media', 'input').props.onChange({ target: { value: 'uploaded-picture' } }); });
    await act(async () => { button('media/uploaded-picture.png').props.onClick(); });
    await act(async () => { button('Delete file').props.onClick(); });
    assert.match(text(), /referenced by your current edits/);
    assert.equal(deletes.length, 1);

    await act(async () => { field('Search media', 'input').props.onChange({ target: { value: 'image-00' } }); });
    await act(async () => { button('media/image-00.png').props.onClick(); });
    assert.deepEqual(usage(), ['Current edits: No references', 'Last loaded or saved in editor: Question 1', 'Running quiz: Question 1']);
    await act(async () => { button('Delete file').props.onClick(); });
    assert.match(text(), /Referenced by the saved or currently loaded quiz/);
    assert.deepEqual(deletes, ['media/uploaded-sound.mp3', 'media/image-00.png']);

    await act(async () => { button('Save quiz').props.onClick(); });
    assert.equal(saves[0].quiz.coverImage, 'media/image-22.png');
    assert.equal(saves[0].questions[0].media, 'media/uploaded-picture.png');
    assert.equal(dirty, false);

    await act(async () => { view.root.findByType('details').props.onToggle({ currentTarget: { open: false } }); });
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'video' } }); });
    await act(async () => { labelledButton('Choose clue media').props.onClick({ currentTarget: { focus() {} } }); });
    assert.match(text(), /media\/clip.mp4/);
    assert.doesNotMatch(text(), /media\/music.mp3/);
    let prevented = false;
    await act(async () => { view.root.findByType('dialog').props.onCancel({ preventDefault: () => { prevented = true; } }); });
    assert.equal(prevented, true);
    assert.equal(view.root.findAllByType('dialog').length, 0);
    await act(async () => { labelledButton('Choose clue media').props.onClick({ currentTarget: { focus() {} } }); });
    await act(async () => { button('media/clip.mp4').props.onClick(); });
    assert.equal(view.root.findAllByType('video').length, 1);
    await act(async () => { button('Select media').props.onClick(); });
    await act(async () => { field('Clue type', 'select').props.onChange({ target: { value: 'audio' } }); });
    await act(async () => { labelledButton('Choose clue media').props.onClick({ currentTarget: { focus() {} } }); });
    assert.match(text(), /media\/music.mp3/);
    assert.deepEqual(view.root.findByProps({ className: 'media-browser-list' }).findAllByType('button')
      .map((item) => item.children.join('')), ['media/music.mp3']);
    assert.match(text(), /media\/clip.mp4.*different type/);
    await act(async () => { button('media/music.mp3').props.onClick(); });
    await act(async () => { button('Select media').props.onClick(); });
    await act(async () => { button('Save quiz').props.onClick(); });
    assert.equal(saves[1].questions[0].type, 'audio');
    assert.equal(saves[1].questions[0].media, 'media/music.mp3');
  } finally {
    if (view) await act(async () => { view.unmount(); });
    Object.assign(globalThis, { fetch: originalFetch, window: originalWindow });
  }
});

test('preview timeline matches typed deadlines, image reveal, media offsets and buzzer points', () => {
  const game = new GameEngine({ id: 42, title: 'Quiz', questions: [{
    id: 'one', type: 'text', mode: 'buzzer', question: 'Live', answer: 'LIVE SECRET',
  }] }, undefined, serverSettingsSchema.parse({ typedAnswerGraceSeconds: 2 }));
  game.settings.pointDecayDelaySeconds = 0;
  const base = game.snapshot(true);
  const image = { id: 'c1283d6f-bdd5-4d28-99c1-f2b344406394', type: 'image' as const,
    mode: 'typed' as const, question: 'Draft', answer: 'Preview only', media: 'media/image.png',
    timerSeconds: 8, fixedPoints: 250, reveal: { effect: 'tiles' as const, durationSeconds: 20 } };
  const preview = { question: image, settings: base.settings, index: 3, count: 5 };
  const atHalf = previewSnapshot(base, preview, 5000);
  assert.equal(atHalf.revealProgress, 0.25);
  assert.equal(atHalf.clueElapsedMs, 5000);
  assert.equal(atHalf.question?.media, '/media/quiz/image.png');
  assert.equal(atHalf.question?.reveal?.columns, 8);
  assert.equal(atHalf.phase, 'QUESTION_OPEN');
  assert.equal(atHalf.players.length, 0);
  assert.equal(atHalf.revealedAnswer, null);
  assert.equal(atHalf.privateAnswer, undefined);
  assert.equal(JSON.stringify(atHalf).includes('LIVE SECRET'), false);
  const finished = previewSnapshot(base, preview, 15000);
  assert.equal(finished.clueElapsedMs, 10000);
  assert.equal(finished.revealProgress, 0.5);
  assert.equal(finished.clockRunning, false);
  assert.equal(finished.phase, 'QUESTION_CLOSED');
  const video = { ...image, type: 'video' as const, mode: 'buzzer' as const, media: 'media/video.mp4',
    fixedPoints: undefined, timerSeconds: undefined, reveal: undefined, playback: { startSeconds: 4, endSeconds: 12 } };
  const buzzer = previewSnapshot(base, { ...preview, question: video }, 6000);
  assert.equal(buzzer.mediaPositionSeconds, 10);
  assert.equal(buzzer.currentPoints, 400);
  assert.equal(buzzer.phase, 'QUESTION_OPEN');
});
