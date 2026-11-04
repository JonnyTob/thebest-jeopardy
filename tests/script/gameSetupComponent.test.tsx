import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { GameEngine } from '../../src/server/engine.js';
import type { HostAction } from '../../src/shared/protocol.js';
import type { Session } from '../../src/client/session.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { SessionContext } = await import('../../src/client/session.js');
const { AdminConsole } = await import('../../src/client/pages/AdminPage.js');
Object.assign(globalThis, { document: previousDocument });

test('game setup omits point controls and saves the remaining settings', async () => {
  const previousFetch = globalThis.fetch;
  const previousLocation = globalThis.location;
  Object.assign(globalThis, { location: { origin: 'http://localhost:3000', hostname: 'localhost' },
    fetch: async () => Response.json({ joinUrls: [] }) });
  const game = new GameEngine({ id: 1, title: 'Quiz', questions: [] });
  const actions: HostAction[] = [];
  const session: Session = { state: game.snapshot(true), receivedAt: performance.now(), connected: true, playerId: null,
    pending: false, error: null, clearError: () => {}, command: async (action) => { actions.push(action); return true; },
    join: async () => true, buzz: async () => true, submitAnswer: async () => true };
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(createElement(MemoryRouter, null,
      createElement(SessionContext.Provider, { value: session }, createElement(AdminConsole, { logout() {}, requirePasscode: false, development: false })))); });
    const setup = view.root.findAllByType('button').find((button) => button.children.join('') === 'Game setup')!;
    await act(async () => { setup.props.onClick(); });
    const labels = view.root.findAllByType('label').map((label) => label.children[0]);
    assert.ok(labels.includes('Default question countdown seconds'));
    assert.ok(labels.includes('Wrong-answer lockout seconds (0 = entire question)'));
    assert.ok(!labels.includes('Starting points'));
    assert.ok(!labels.includes('Minimum points'));
    assert.ok(!labels.includes('Points dropped per step'));
    assert.ok(!labels.includes('Seconds between drops'));
    assert.ok(!labels.includes('Wait before points start dropping (seconds)'));
    await act(async () => { view.root.findByProps({ className: 'panel setup-form' }).props.onSubmit({ preventDefault() {} }); });
    assert.equal(actions[0].type, 'setup');
  } finally {
    await act(async () => { view.unmount(); });
    Object.assign(globalThis, { fetch: previousFetch, location: previousLocation });
  }
});
