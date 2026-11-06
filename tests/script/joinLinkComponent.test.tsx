import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import QRCode from 'qrcode';
import type { Session } from '../../src/client/session.js';

const oldDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { SessionContext } = await import('../../src/client/session.js');
const { JoinLink } = await import('../../src/client/components/Common.js');
Object.assign(globalThis, { document: oldDocument });

test('host selection and TV link follow the shared server address', async () => {
  const oldFetch = globalThis.fetch;
  const oldLocation = globalThis.location;
  Object.assign(globalThis, { location: { origin: 'http://localhost:3000', hostname: 'localhost' },
    fetch: async () => Response.json({ joinUrls: ['http://192.168.1.4:3000/play', 'http://192.168.1.5:3000/play'], selectedJoinUrl: 'http://192.168.1.4:3000/play' }) });
  let selected = '';
  const session: Session = { state: null, receivedAt: 0, connected: true, playerId: null, pending: false, error: null,
    clearError: () => {}, command: async () => true, join: async () => true, buzz: async () => true, submitAnswer: async () => true,
    joinUrl: 'http://192.168.1.4:3000/play', selectJoinUrl: async (url) => { selected = url; return true; } };
  const screen = (shared: Session) => createElement(SessionContext.Provider, { value: shared },
    createElement(JoinLink, { editable: true }), createElement(JoinLink, { compact: true }),
    createElement(JoinLink, { compact: true, minimal: true }));
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(screen(session)); });
    const select = view.root.findByType('select');
    await act(async () => { select.props.onChange({ target: { value: 'http://192.168.1.5:3000/play' } }); });
    assert.equal(selected, 'http://192.168.1.5:3000/play');
    await act(async () => { view.update(screen({ ...session, joinUrl: selected })); });
    assert.equal(view.root.findByType('select').props.value, selected);
    assert.deepEqual(view.root.findAllByProps({ className: 'join-url' }).map((link) => link.props.href), [selected, selected, selected]);
    const minimal = view.root.findAllByProps({ className: 'join-link compact' })[1];
    assert.equal(minimal.findByType('h3').children.join(''), 'Join from your phone');
  } finally { await act(async () => { view.unmount(); }); Object.assign(globalThis, { fetch: oldFetch, location: oldLocation }); }
});

test('join QR generation failure keeps the address visible and reports the error', async (t) => {
  const oldFetch = globalThis.fetch;
  const oldLocation = globalThis.location;
  Object.assign(globalThis, { location: { origin: 'http://localhost:3000', hostname: 'localhost' },
    fetch: async () => Response.json({ joinUrls: ['http://192.168.1.4:3000/play'] }) });
  t.mock.method(QRCode, 'toDataURL', () => Promise.reject(new Error('renderer unavailable')));
  const session: Session = { state: null, receivedAt: 0, connected: true, playerId: null, pending: false, error: null,
    clearError: () => {}, command: async () => true, join: async () => true, buzz: async () => true, submitAnswer: async () => true,
    joinUrl: 'http://192.168.1.4:3000/play' };
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(createElement(SessionContext.Provider, { value: session },
      createElement(JoinLink, { compact: true, minimal: true }))); });
    assert.equal(view.root.findAllByType('img').length, 0);
    assert.equal(view.root.findByProps({ className: 'join-url' }).props.href, session.joinUrl);
    assert.match(view.root.findByProps({ role: 'alert' }).children.join(''), /Unable to generate join QR code/);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    Object.assign(globalThis, { fetch: oldFetch, location: oldLocation });
  }
});
