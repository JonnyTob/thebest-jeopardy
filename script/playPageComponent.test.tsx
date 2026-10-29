import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { GameEngine } from '../src/server/engine.js';
import type { Snapshot } from '../src/shared/protocol.js';
import type { Session } from '../src/client/session.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { SessionContext } = await import('../src/client/session.js');
const { PlayPage } = await import('../src/client/pages/PlayPage.js');
Object.assign(globalThis, { document: previousDocument });

const game = new GameEngine({ id: 1, title: 'Phone test', questions: [
  { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer' },
] });
const player = game.join({ name: 'Alice', avatarId: 'fox' });
const base: Snapshot = { ...game.snapshot(), phase: 'QUESTION_OPEN',
  question: { id: 'one', type: 'text', mode: 'buzzer', question: 'Clue' }, questionIndex: 0 };

function makeSession(state: Snapshot): Session {
  return { state, playerId: player.id, receivedAt: performance.now(), connected: true,
    pending: false, error: null, clearError: () => {}, command: async () => true,
    join: async () => true, buzz: async () => true, submitAnswer: async () => true };
}

function wrapped(session: Session) {
  return createElement(MemoryRouter, null,
    createElement(SessionContext.Provider, { value: session }, createElement(PlayPage)));
}

test('phone shows the buzzer only for a current explicit buzzer question', async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(wrapped(makeSession(base))); });
  try {
    assert.equal(view.root.findAllByProps({ className: 'buzz-button' }).length, 1);
    const typed = { ...base, question: { ...base.question!, mode: 'typed' as const, fixedPoints: 250, timerSeconds: 30 } };
    const hiddenStates: Snapshot[] = [
      { ...base, question: null },
      ...(['LOBBY', 'STARTING', 'NEXT_ROUND', 'GAME_FINISHED'] as const).map((phase) => ({ ...base, phase })),
      ...(['QUESTION_OPEN', 'QUESTION_CLOSED', 'REVIEW', 'REVIEW_GROUP', 'NEXT_ROUND', 'GAME_FINISHED'] as const)
        .map((phase) => ({ ...typed, phase })),
    ];
    for (const state of hiddenStates) {
      await act(async () => { view.update(wrapped(makeSession(state))); });
      assert.equal(view.root.findAllByProps({ className: 'buzz-button' }).length, 0, `${state.phase}/${state.question?.mode}`);
      assert.doesNotMatch(JSON.stringify(view.toJSON()), /Correct \+points/);
    }
  } finally {
    await act(async () => { view.unmount(); });
  }
});

test('phone enables buzzing only for eligible connected players and preserves answering feedback', async () => {
  let buzzes = 0;
  const session = { ...makeSession(base), buzz: async () => { buzzes++; return true; } };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(wrapped(session)); });
  const button = () => view.root.findByProps({ className: 'buzz-button' });
  try {
    assert.equal(button().props.disabled, false);
    await act(async () => { button().props.onClick(); });
    assert.equal(buzzes, 1);
    for (const next of [
      { ...session, connected: false },
      { ...session, pending: true },
      { ...session, state: { ...base, paused: true } },
      { ...session, state: { ...base, lockedOutIds: [player.id] } },
      ...(['ANSWERING', 'BUZZ_RESULT', 'MEDIA_FINISH', 'QUESTION_CLOSED', 'ANSWER_REVEALED'] as const)
        .map((phase) => ({ ...session, state: { ...base, phase } })),
    ]) {
      await act(async () => { view.update(wrapped(next)); });
      assert.equal(button().props.disabled, true);
    }
    await act(async () => {
      view.update(wrapped({ ...session, state: { ...base, phase: 'ANSWERING', activePlayerId: player.id, pointsAtBuzz: 500 } }));
    });
    assert.equal(view.root.findAllByProps({ className: 'buzzer-card is-answering' }).length, 1);
    assert.equal(button().findByType('span').children.join(''), 'FIRST!');
    await act(async () => { view.update(wrapped(session)); });
    assert.equal(button().props.disabled, false);
  } finally {
    await act(async () => { view.unmount(); });
  }
});
