import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { GameEngine } from '../src/server/engine.js';
import { REVIEW_GROUP_MS, START_COUNTDOWN_MS } from '../src/shared/game.js';
import type { HostAction, Snapshot } from '../src/shared/protocol.js';
import type { Session } from '../src/client/session.js';
import { CountdownSound } from '../src/client/components/CountdownSound.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { QuestionClue } = await import('../src/client/components/QuestionClue.js');
const { SessionContext } = await import('../src/client/session.js');
const { AdminConsole } = await import('../src/client/pages/AdminPage.js');
const { DisplayPage } = await import('../src/client/pages/DisplayPage.js');
const { PlayPage } = await import('../src/client/pages/PlayPage.js');
Object.assign(globalThis, { document: previousDocument });

function setup() {
  let time = 0;
  const game = new GameEngine({ id: 1, title: 'Review', questions: [
    { id: 'one', type: 'video', mode: 'typed', fixedPoints: 250, timerSeconds: 30,
      question: 'Current clue', answer: 'OFFICIAL SECRET', media: '/media/a.mp4' },
    { id: 'two', type: 'text', mode: 'buzzer', question: 'FUTURE CLUE', answer: 'FUTURE SECRET' },
  ] }, () => time);
  const players = Array.from({ length: 12 }, (_, index) => game.join({ name: `Player ${index}`, avatarId: 'fox' }));
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  send({ type: 'start' }); time += START_COUNTDOWN_MS; game.tick();
  const instance = game.snapshot().questionInstanceId!;
  players.forEach((player, index) => game.submitAnswer(player.id, instance, `PRIVATE ANSWER ${index}`));
  players.slice(0, 8).forEach((player) => send({ type: 'judgeSubmission', playerId: player.id, correct: true }));
  players.slice(8, 11).forEach((player) => send({ type: 'judgeSubmission', playerId: player.id, correct: false }));
  send({ type: 'startReview' });
  return { game, players, send, advance: () => { time += REVIEW_GROUP_MS; game.tick(); } };
}

function makeSession(state: Snapshot, playerId: string, actions: HostAction[] = []): Session {
  return { state, playerId, receivedAt: performance.now(), connected: true, pending: false, error: null,
    clearError: () => {}, command: async (action) => { actions.push(action); return true; },
    join: async () => true, buzz: async () => true, submitAnswer: async () => true };
}

function wrapped(session: Session, child: ReactNode) {
  return createElement(MemoryRouter, null, createElement(SessionContext.Provider, { value: session }, child));
}

test('group cards show only current players and per-player points while video stays mounted through review', async () => {
  const { game, players, advance } = setup();
  const state = game.snapshot(true);
  let view!: ReactTestRenderer;
  const media = { currentTime: 0, duration: 30, paused: true, pause() {}, play() { return Promise.resolve(); } };
  await act(async () => { view = create(createElement(QuestionClue, { state }), { createNodeMock: () => media }); });
  const video = view.root.findByType('video');
  const group = () => view.root.findByProps({ 'aria-label': 'Grouped answer results' });
  assert.match(group().props.className, /review-group-correct/);
  assert.equal(group().props.style.animationDelay, '0ms');
  const effect = () => group().findByProps({ 'aria-hidden': 'true' });
  assert.match(effect().props.className, /review-result-correct/);
  assert.equal(effect().findAllByType('span')[0].props.style.animationDuration, '4000ms');
  assert.equal(group().findAllByType('li').length, 8);
  for (const card of group().findAllByType('li')) {
    assert.equal(card.findAllByType('svg').length, 1);
    assert.equal(card.findByType('span').children.join(''), '+250');
  }
  let html = JSON.stringify(view.toJSON());
  assert.doesNotMatch(html, /PRIVATE ANSWER|OFFICIAL SECRET|FUTURE CLUE|Player 8/);
  await act(async () => { view.update(createElement(QuestionClue, { state: { ...state,
    reviewGroup: { ...state.reviewGroup!, remainingMs: 2000 } } })); });
  assert.equal(group().props.style.animationDelay, '0ms', 'updates do not restart animation');
  advance();
  const wrong = game.snapshot();
  await act(async () => { view.update(createElement(QuestionClue, { state: { ...wrong,
    reviewGroup: { ...wrong.reviewGroup!, remainingMs: 700 } } })); });
  assert.equal(view.root.findByType('video'), video);
  assert.match(group().props.className, /review-group-wrong/);
  assert.equal(group().props.style.animationDelay, '-3300ms', 'late snapshot skips the entrance');
  assert.match(effect().props.className, /review-result-wrong/);
  assert.match(effect().findAllByType('span')[0].props.style.animationDelay, /-3300ms/);
  assert.equal(group().findAllByType('li').length, 3);
  assert.ok(group().findAllByType('li').every((card) => card.findByType('span').children.join('') === '+0'));
  html = JSON.stringify(view.toJSON());
  assert.doesNotMatch(html, /PRIVATE ANSWER|Player 0|Player 11/);
  advance();
  await act(async () => { view.update(createElement(QuestionClue, { state: game.snapshot() })); });
  assert.equal(view.root.findByType('video'), video);
  assert.equal(view.root.findAllByProps({ 'aria-label': 'Grouped answer results' }).length, 0);
  html = JSON.stringify(view.toJSON());
  assert.match(html, /PRIVATE ANSWER 11/);
  assert.doesNotMatch(html, /PRIVATE ANSWER 0/);
  assert.equal(game.snapshot().review?.playerId, players[11].id);
  await act(async () => { view.unmount(); });
});

test('host controls, instructions, TV sound and phone status follow the current group', async () => {
  const { game, players, advance } = setup();
  const actions: HostAction[] = [];
  let session = makeSession(game.snapshot(true), players[0].id, actions);
  let view!: ReactTestRenderer;
  await act(async () => { view = create(wrapped(session, createElement(AdminConsole, { logout: () => {}, requirePasscode: false, development: false }))); });
  const button = (text: string) => view.root.findAllByType('button').find((item) => item.children.join('').includes(text))!;
  assert.equal(button('Remove').props.disabled, true);
  assert.equal(view.root.findByProps({ 'aria-label': "Adjust Player 0's score" }).props.disabled, true);
  assert.equal(button('Undo last score change').props.disabled, false);
  assert.equal(button('Reset this question').props.disabled, false);
  await act(async () => { button('Undo last score change').props.onClick(); button('Reset this question').props.onClick(); });
  assert.equal(button('Confirm reset').props.disabled, false);
  await act(async () => { button('Confirm reset').props.onClick(); });
  assert.deepEqual(actions, [{ type: 'undo' }, { type: 'reset' }]);
  const toggle = view.root.findByProps({ type: 'checkbox' });
  await act(async () => { toggle.props.onChange({ target: { checked: true } }); });
  assert.match(JSON.stringify(view.toJSON()), /correct first, then wrong or missing/);
  assert.ok(view.root.findAllByType('strong').some((node) => node.children.join('') === 'Correct group on TV'));
  session = makeSession(game.snapshot(), players[0].id);
  await act(async () => { view.update(wrapped(session, createElement(PlayPage))); });
  assert.match(JSON.stringify(view.toJSON()), /Correct \/ \+250 points/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /PRIVATE ANSWER/);
  await act(async () => { view.update(wrapped(session, createElement(DisplayPage))); });
  const sound = view.root.findByType(CountdownSound);
  assert.equal(sound.props.reviewResultId, session.state?.reviewGroup?.id);
  assert.equal(sound.props.reviewHoldMs, REVIEW_GROUP_MS);
  assert.equal(sound.props.reviewCorrect, true);
  assert.match(JSON.stringify(view.toJSON()), /GROUP RESULTS/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Type your answer on your phone|PRIVATE ANSWER/);
  advance();
  session = makeSession(game.snapshot(), players[8].id);
  await act(async () => { view.update(wrapped(session, createElement(PlayPage))); });
  assert.match(JSON.stringify(view.toJSON()), /Wrong or missing \/ \+0 points/);
  session = makeSession(game.snapshot(), players[11].id);
  await act(async () => { view.update(wrapped(session, createElement(PlayPage))); });
  assert.match(JSON.stringify(view.toJSON()), /previously judged answers/);
  advance();
  session = makeSession(game.snapshot(), players[11].id);
  await act(async () => { view.update(wrapped(session, createElement(PlayPage))); });
  assert.match(JSON.stringify(view.toJSON()), /Reviewing answers on TV/);
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /PRIVATE ANSWER/);
  await act(async () => { view.unmount(); });
});