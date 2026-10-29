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
    if (url.endsWith('/media')) return Response.json({ files: [] });
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
    assert.equal(saved.questions[0].timerSeconds, 30);
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

test('preview timeline matches typed deadlines, image reveal, media offsets and buzzer points', () => {
  const game = new GameEngine({ id: 42, title: 'Quiz', questions: [{
    id: 'one', type: 'text', mode: 'buzzer', question: 'Live', answer: 'LIVE SECRET',
  }] }, undefined, serverSettingsSchema.parse({ TimerEndOffsetSeconds: 2 }));
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
