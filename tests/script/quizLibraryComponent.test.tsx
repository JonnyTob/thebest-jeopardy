import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { GameEngine } from '../../src/server/engine.js';
import { QuizLibrary } from '../../src/client/components/QuizLibrary.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { QuizEditor } = await import('../../src/client/components/QuizEditor.js');
Object.assign(globalThis, { document: previousDocument });

const state = new GameEngine({ id: 1, title: 'First', questions: [] }).snapshot(true);

test('library can create and select a quiz, then confirm loading a saved quiz', async () => {
  const oldFetch = globalThis.fetch;
  const calls: string[] = [];
  let selected = 0;
  Object.assign(globalThis, { fetch: async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'POST' && url.endsWith('/library')) return Response.json({ quiz: { id: 3 } });
    if (init?.method === 'POST' || init?.method === 'DELETE') return Response.json({ ok: true });
    return Response.json({ quizzes: [{ id: 1, title: 'First', questionCount: 1, enabledCount: 1, revision: 'one' }, { id: 2, title: 'Second', questionCount: 2, enabledCount: 2, revision: 'two' }] });
  } });
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(createElement(QuizLibrary, { passcode: 'pw', state, connected: true, onEdit: (id) => { selected = id; }, onLive: () => {} })); });
    const button = (text: string) => view.root.findAllByType('button').find((item) => item.children.join('') === text)!;
    await act(async () => { button('Load quiz').props.onClick(); });
    await act(async () => { view.root.findAllByType('button').filter((item) => item.children.join('') === 'Load quiz').at(-1)!.props.onClick(); });
    assert.ok(calls.includes('POST /api/editor/library/load'));
    assert.equal(view.root.findByProps({ 'aria-label': 'Delete First' }).props.disabled, true);
    await act(async () => { view.root.findByProps({ 'aria-label': 'Delete Second' }).props.onClick(); });
    assert.match(JSON.stringify(view.toJSON()), /permanently deletes/);
    await act(async () => { button('Delete quiz and media').props.onClick(); });
    assert.ok(calls.includes('DELETE /api/editor/library/2'));
    assert.equal(view.root.findAllByProps({ 'aria-label': 'Delete Second' }).length, 0);
    await act(async () => { button('+ New quiz').props.onClick(); });
    await act(async () => { view.root.findAllByType('input').find((item) => item.props.required)!.props.onChange({ target: { value: 'New' } }); });
    await act(async () => { view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.equal(selected, 3);
  } finally { await act(async () => { view.unmount(); }); Object.assign(globalThis, { fetch: oldFetch }); }
});

test('editor opens an empty quiz and lets the host add its first question', async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
    fetch: async (url: string) => Response.json(url.includes('/media?') ? { files: [], loadedReferences: [] }
      : { archive: { schemaVersion: 1, quiz: { id: 2, title: 'Empty' }, questions: [] }, revision: 'rev' }) });
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(createElement(MemoryRouter, null, createElement(QuizEditor, { passcode: 'pw', gameState: state, quizId: 2, onDirtyChange: () => {} }))); });
    assert.match(JSON.stringify(view.toJSON()), /Add a question to start/);
    const add = view.root.findAllByType('button').find((item) => item.children.join('') === 'Add question')!;
    await act(async () => { add.props.onClick(); });
    assert.equal(view.root.findByProps({ className: 'editor-question-heading' }).findByType('h2').children.join(''), 'Question 1');
  } finally { await act(async () => { view.unmount(); }); Object.assign(globalThis, { fetch: oldFetch, window: oldWindow }); }
});
