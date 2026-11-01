import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GameEngine } from '../src/server/engine.js';
import { START_COUNTDOWN_MS, BUZZ_RESULT_MS } from '../src/shared/game.js';
import type { Snapshot } from '../src/shared/protocol.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { DisplayScreen } = await import('../src/client/pages/DisplayPage.js');
const { previewSnapshot } = await import('../src/client/components/QuestionPreview.js');
Object.assign(globalThis, { document: previousDocument });

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('');
}

test('TV separates the buzzer countdown from the changing and frozen question points', async () => {
  let time = 0;
  const game = new GameEngine({ id: 42, title: 'Quiz', questions: [{
    id: randomUUID(), type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer', timerSeconds: 10,
  }] }, () => time);
  game.settings.pointDecayDelaySeconds = 2;
  game.settings.dropEverySeconds = 1;
  const player = game.join({ name: 'Alice', avatarId: 'fox' });
  let view!: ReactTestRenderer;
  const screen = (state: Snapshot) => createElement(DisplayScreen, { state, connected: true, receivedAt: 0, preview: true });
  const update = async () => { await act(async () => { view.update(screen(game.snapshot())); }); };
  const timer = () => view.root.findByProps({ 'aria-label': 'Time remaining' });
  const points = () => view.root.findByProps({ 'aria-label': 'Question points' });
  const clue = () => view.root.findAll((item) => typeof item.props.className === 'string'
    && item.props.className.split(' ').includes('clue-panel'))[0];
  try {
    await act(async () => { view = create(screen(game.snapshot())); });
    assert.equal(view.root.findAllByProps({ 'aria-label': 'Question points' }).length, 0);
    game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
    time += START_COUNTDOWN_MS; game.tick();
    await update();
    assert.equal(timer().props['aria-valuenow'], 100);
    assert.equal(timer().props['aria-valuetext'], '10 seconds remaining');
    assert.equal(points().findByType('span').children.join(''), 'TIMED POINTS');
    assert.equal(points().findByType('strong').children[0], '500');
    assert.equal(clue().findAllByProps({ 'aria-label': 'Point reduction progress' }).length, 0);
    assert.doesNotMatch(textOf(clue()), /POINT VALUE|fixed points|500/);

    time += 4000;
    await update();
    assert.equal(timer().props['aria-valuenow'], 60);
    assert.equal(timer().props['aria-valuetext'], '6 seconds remaining');
    assert.equal(timer().findAllByType('div')[1].props.style.width, '60%');
    assert.equal(points().findByType('strong').children[0], '300');

    game.buzz(player.id);
    time += 1000;
    await update();
    assert.equal(timer().props['aria-valuenow'], 60);
    assert.equal(points().findByType('span').children.join(''), 'TIMED POINTS');
    assert.equal(points().findByType('strong').children[0], '300');
    assert.match(textOf(clue()), /Clock frozen/);
    assert.doesNotMatch(textOf(clue()), /300 points/);
    game.command({ id: randomUUID(), revision: game.revision, action: { type: 'judge', correct: false } });
    await update();
    assert.equal(points().findByType('strong').children[0], '300');
    assert.match(textOf(view.root.findByType('aside')), /-300 points/);
    time += BUZZ_RESULT_MS; game.tick();
    time += 2000;
    await update();
    assert.equal(points().findByType('strong').children[0], '100');
    assert.equal(timer().props['aria-valuenow'], 40, 'the countdown continues after points reach their minimum');
    time += 4000; game.tick();
    await update();
    assert.equal(timer().props['aria-valuenow'], 0);
    assert.equal(timer().props['aria-valuetext'], '0 seconds remaining');
    assert.equal(points().findByType('strong').children[0], '100');
  } finally {
    if (view) await act(async () => { view.unmount(); });
  }
});

test('typed questions and the editor preview use the same TV timer and fixed points', async () => {
  const question = { id: randomUUID(), type: 'text' as const, mode: 'typed' as const,
    question: 'Clue', answer: 'Answer', fixedPoints: 250, timerSeconds: 8 };
  const game = new GameEngine({ id: 42, title: 'Quiz', questions: [question] });
  const base = game.snapshot();
  const preview = { question, settings: base.settings, index: 0, count: 1 };
  const screen = (elapsed: number) => createElement(DisplayScreen, {
    state: previewSnapshot(base, preview, elapsed), connected: true, receivedAt: 0, preview: true,
  });
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(screen(0)); });
    assert.equal(view.root.findByProps({ 'aria-label': 'Time remaining' }).props['aria-valuenow'], 100);
    assert.equal(view.root.findByProps({ 'aria-label': 'Question points' }).findByType('span').children.join(''), 'FIXED POINTS');
    assert.equal(view.root.findByProps({ 'aria-label': 'Question points' }).findByType('strong').children[0], '250');
    await act(async () => { view.update(screen(2000)); });
    assert.equal(view.root.findByProps({ 'aria-label': 'Time remaining' }).props['aria-valuenow'], 75);
    assert.equal(view.root.findByProps({ 'aria-label': 'Question points' }).findByType('strong').children[0], '250');
    const clue = view.root.findAll((item) => typeof item.props.className === 'string'
      && item.props.className.split(' ').includes('clue-panel'))[0];
    assert.doesNotMatch(textOf(clue), /250|fixed points|POINT VALUE/);
    await act(async () => { view.update(screen(8000)); });
    assert.equal(view.root.findByProps({ 'aria-label': 'Time remaining' }).props['aria-valuenow'], 0);
    assert.equal(view.root.findByProps({ 'aria-label': 'Question points' }).findByType('strong').children[0], '250');
    await act(async () => { view.update(createElement(DisplayScreen, {
      state: { ...base, phase: 'GAME_FINISHED' }, connected: true, receivedAt: 0, preview: true,
    })); });
    assert.equal(view.root.findAllByProps({ 'aria-label': 'Question points' }).length, 0);
  } finally {
    if (view) await act(async () => { view.unmount(); });
  }
});
