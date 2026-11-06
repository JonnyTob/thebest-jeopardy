import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import QRCode from 'qrcode';
import { GameEngine } from '../../src/server/engine.js';
import type { HostAction, Snapshot } from '../../src/shared/protocol.js';
import type { Session } from '../../src/client/session.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { DisplayScreen } = await import('../../src/client/pages/DisplayPage.js');
const { AdminConsole } = await import('../../src/client/pages/AdminPage.js');
const { SessionContext } = await import('../../src/client/session.js');
Object.assign(globalThis, { document: previousDocument });

function setup() {
  const game = new GameEngine({ id: 1, title: 'Startup', questions: [
    { id: 'one', type: 'text', mode: 'buzzer', question: 'SECRET CLUE', answer: 'SECRET ANSWER' },
  ] });
  const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
  return { game, send };
}

function session(state: Snapshot, actions: HostAction[] = []): Session {
  return { state, playerId: null, receivedAt: performance.now(), connected: true, pending: false, error: null,
    clearError: () => {}, command: async (action) => { actions.push(action); return true; },
    join: async () => true, buzz: async () => true, submitAnswer: async () => true };
}

function wrapped(value: Session, child: ReactNode) {
  return createElement(MemoryRouter, null, createElement(SessionContext.Provider, { value }, child));
}

test('TV startup screens show a live player panel, Wi-Fi only when published, and configured rules', () => {
  const { game, send } = setup();
  game.join({ name: 'Alice', avatarId: 'fox' });
  const render = () => renderToStaticMarkup(wrapped(session(game.snapshot()),
    createElement(DisplayScreen, { state: game.snapshot(), connected: true, receivedAt: 0 })));
  let html = render();
  assert.match(html, /Bring everyone into the game/);
  assert.match(html, /Alice/);
  assert.match(html, /1 <small>joined/);
  assert.doesNotMatch(html, /Join from your phone/);
  assert.doesNotMatch(html, /EVERYONE&#x27;S INVITED|Pick an avatar/);
  assert.doesNotMatch(html, /Wi-Fi details|SECRET CLUE|SECRET ANSWER/);
  send({ type: 'showWifi', network: 'Guest network', password: 'shared password' });
  html = render();
  assert.match(html, /Guest network/);
  assert.match(html, /shared password/);
  assert.match(html, /Join from your phone/);
  send({ type: 'nextStartup' });
  html = render();
  assert.match(html, /How to play/);
  assert.match(html, /A wrong buzz loses points/);
  assert.doesNotMatch(html, /shared password|Guest network|Join from your phone|SECRET CLUE/);
  send({ type: 'nextStartup' });
  html = render();
  assert.match(html, /WELCOME TO THE SHOW/);
  assert.doesNotMatch(html, /Bring everyone into the game|shared password/);
});

test('host sees forward-only startup actions and publishes Wi-Fi without starting the quiz', async () => {
  const { game, send } = setup();
  const actions: HostAction[] = [];
  const admin = createElement(AdminConsole, { logout: () => {}, requirePasscode: false, development: false });
  let view!: ReactTestRenderer;
  const render = async () => {
    const node = wrapped(session(game.snapshot(true), actions), admin);
    await act(async () => { if (view) view.update(node); else view = create(node); });
  };
  const button = (text: string) => view.root.findAllByType('button').find((node) => node.children.join('').includes(text));
  try {
    await render();
    assert.ok(button('Show rules'));
    assert.equal(button('Start quiz'), undefined);
    const inputs = view.root.findAllByType('input');
    const network = inputs.find((node) => node.props.maxLength === 100 && node.props.type !== 'password')!;
    const password = inputs.find((node) => node.props.type === 'password')!;
    await act(async () => { network.props.onChange({ target: { value: 'Guests' } }); password.props.onChange({ target: { value: 'abc' } }); });
    const form = view.root.findAllByType('form').find((node) => node.findAllByType('input').includes(network))!;
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(actions[0], { type: 'showWifi', network: 'Guests', password: 'abc' });
    send({ type: 'showWifi', network: 'Guests', password: 'abc' });
    await render();
    assert.ok(button('Hide Wi-Fi details'));
    await act(async () => { button('Show rules')!.props.onClick(); });
    assert.deepEqual(actions[1], { type: 'nextStartup' });
    send({ type: 'nextStartup' }); await render();
    assert.ok(button('Show lobby'));
    assert.equal(button('Back'), undefined);
    assert.equal(button('Start quiz'), undefined);
    send({ type: 'nextStartup' }); await render();
    assert.ok(button('Start quiz'));
    assert.equal(button('Show rules'), undefined);
    await act(async () => { button('Start quiz')!.props.onClick(); });
    assert.deepEqual(actions[2], { type: 'start' });
  } finally {
    if (view) await act(async () => { view.unmount(); });
  }
});

test('startup join QR and address follow the selected LAN address inside the Wi-Fi panel', async () => {
  const { game, send } = setup();
  send({ type: 'showWifi', network: 'Guest network', password: 'shared password' });
  const state = game.snapshot();
  const currentSession = { ...session(state), joinUrl: 'http://example.test/play' };
  let view!: ReactTestRenderer;
  const options = { width: 512, margin: 4, color: { dark: '#132425', light: '#ffffff' } };
  const waitForQr = async (url: string) => {
    const expected = await QRCode.toDataURL(url, options);
    const deadline = Date.now() + 2000;
    while (true) {
      const images = view.root.findByProps({ 'aria-label': 'Wi-Fi details' }).findAllByType('img');
      if (images.length === 1 && images[0].props.src === expected) return images[0];
      if (Date.now() >= deadline) throw new Error(`Join QR code for ${url} did not render.`);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  try {
    await act(async () => { view = create(wrapped(currentSession,
      createElement(DisplayScreen, { state, connected: true, receivedAt: 0 }))); });
    const firstImage = await waitForQr('http://example.test/play');
    const firstSource = firstImage.props.src;
    const wifi = view.root.findByProps({ 'aria-label': 'Wi-Fi details' });
    assert.equal(wifi.findAllByType('img').length, 1);
    assert.equal(wifi.findByType('img').props.alt, 'QR code to join at http://example.test/play');
    assert.equal(wifi.findByType('h3').children.join(''), 'Join from your phone');
    assert.equal(wifi.findByProps({ className: 'join-url' }).props.href, 'http://example.test/play');
    const players = view.root.findByType('aside');
    assert.equal(players.findAllByType('img').length, 0);
    assert.equal(players.findAllByType('h3').length, 0);
    assert.equal(players.findAllByProps({ className: 'join-url' }).length, 0);
    await act(async () => { view.update(wrapped({ ...currentSession, joinUrl: 'http://example.test:3000/play' },
      createElement(DisplayScreen, { state, connected: true, receivedAt: 0 }))); });
    assert.equal(view.root.findByProps({ 'aria-label': 'Wi-Fi details' })
      .findByProps({ className: 'join-url' }).props.href, 'http://example.test:3000/play');
    const updatedImage = await waitForQr('http://example.test:3000/play');
    assert.notEqual(updatedImage.props.src, firstSource);
    assert.equal(updatedImage.props.alt, 'QR code to join at http://example.test:3000/play');
    send({ type: 'hideWifi' });
    const hidden = game.snapshot();
    await act(async () => { view.update(wrapped({ ...currentSession, state: hidden },
      createElement(DisplayScreen, { state: hidden, connected: true, receivedAt: 0 }))); });
    assert.equal(view.root.findAllByProps({ 'aria-label': 'Wi-Fi details' }).length, 0);
    assert.equal(view.root.findAllByProps({ className: 'join-url' }).length, 0);
    send({ type: 'nextStartup' });
    const rules = game.snapshot();
    await act(async () => { view.update(wrapped({ ...currentSession, state: rules },
      createElement(DisplayScreen, { state: rules, connected: true, receivedAt: 0 }))); });
    assert.equal(view.root.findAllByProps({ 'aria-label': 'Wi-Fi details' }).length, 0);
    assert.equal(view.root.findByType('aside').findAllByType('img').length, 0);
    assert.equal(view.root.findAllByProps({ className: 'join-url' }).length, 0);
  } finally {
    if (view) await act(async () => { view.unmount(); });
  }
});
