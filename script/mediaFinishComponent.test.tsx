import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { Media } from '../src/client/components/Media.js';
import { GameEngine } from '../src/server/engine.js';
import type { HostAction, Snapshot } from '../src/shared/protocol.js';
import type { Session } from '../src/client/session.js';

// The browser injects branding before the client modules load.
const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { QuestionClue } = await import('../src/client/components/QuestionClue.js');
const { useAnimatedSnapshot, SessionContext } = await import('../src/client/session.js');
const { AdminConsole } = await import('../src/client/pages/AdminPage.js');
const { PlayPage } = await import('../src/client/pages/PlayPage.js');
const { DisplayPage } = await import('../src/client/pages/DisplayPage.js');
Object.assign(globalThis, { document: previousDocument });

const game = new GameEngine({ id: 1, title: 'Test', questions: [
  { id: 'one', type: 'video', question: 'Watch', answer: 'Answer', media: '/media/a.mp4' },
] });
const base: Snapshot = { ...game.snapshot(), phase: 'MEDIA_FINISH', clockRunning: false,
  displayClockRunning: true, clueElapsedMs: 2000, displayElapsedMs: 2000, currentPoints: 500,
  pointsAtBuzz: 500, mediaPositionSeconds: 4, mediaFinishRemainingMs: 3000, mediaFinishNeedsSkip: false,
  revealProgress: 0.2, question: { id: 'one', type: 'video', question: 'Watch', media: '/media/a.mp4',
    playback: { startSeconds: 2, endSeconds: 7 }, reveal: { effect: 'tiles', durationSeconds: 10, columns: 2, rows: 2, seed: 1 } } };

function makeMedia() {
  return { currentTime: 0, duration: 7, paused: true, plays: 0, pauses: 0,
    play() { this.plays++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauses++; this.paused = true; },
  };
}

test('the React interpolation hook advances only the display clock and clamps known finishes', async (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  let result: Snapshot | null = null;
  function Probe({ state, connected = true }: { state: Snapshot; connected?: boolean }) {
    result = useAnimatedSnapshot(state, 1000, connected);
    return null;
  }
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { state: base })); });
  async function advance(time: number) {
    now = time;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 70)); });
    assert.ok(result);
    return result as Snapshot;
  }
  let animated = await advance(2500);
  assert.equal(animated.clueElapsedMs, 2000);
  assert.equal(animated.currentPoints, 500);
  assert.equal(animated.displayElapsedMs, 3500);
  assert.equal(animated.mediaPositionSeconds, 5.5);
  assert.equal(animated.mediaFinishRemainingMs, 1500);
  assert.equal(animated.revealProgress, 0.35);
  animated = await advance(9000);
  assert.equal(animated.displayElapsedMs, 5000);
  assert.equal(animated.mediaPositionSeconds, 7);
  assert.equal(animated.mediaFinishRemainingMs, 0);
  assert.equal(animated.displayClockRunning, false);
  assert.equal(animated.revealProgress, 0.5);
  await act(async () => { view.update(createElement(Probe, { state: { ...base, mediaFinishRemainingMs: null, mediaFinishNeedsSkip: true } })); });
  animated = result as unknown as Snapshot;
  assert.equal(animated.mediaPositionSeconds, 12);
  assert.equal(animated.mediaFinishRemainingMs, null);
  assert.equal(animated.displayClockRunning, true);
  await act(async () => { view.update(createElement(Probe, { state: base, connected: false })); });
  animated = result as unknown as Snapshot;
  assert.equal(animated.mediaPositionSeconds, 4);
  assert.equal(animated.displayClockRunning, false);
  await act(async () => { view.unmount(); });
});

test('video stays mounted through result and resumes, stops at finish, restarts and pauses on disconnect', async () => {
  const media = makeMedia();
  let view!: ReactTestRenderer;
  const held = { ...base, phase: 'BUZZ_RESULT' as const, displayClockRunning: false, mediaFinishRemainingMs: null };
  await act(async () => { view = create(createElement(QuestionClue, { state: held }), { createNodeMock: () => media }); });
  const video = view.root.findByType('video');
  await act(async () => { video.props.onLoadedMetadata(); });
  assert.equal(media.plays, 0);
  assert.equal(media.currentTime, 4);
  await act(async () => { view.update(createElement(QuestionClue, { state: base })); });
  assert.equal(view.root.findByType('video'), video);
  assert.equal(media.plays, 1);
  assert.equal(media.paused, false);
  media.currentTime = 7.2;
  await act(async () => { video.props.onTimeUpdate(); });
  assert.equal(media.currentTime, 7);
  assert.equal(media.paused, true);
  await act(async () => { view.update(createElement(QuestionClue, { state: { ...base, mediaPositionSeconds: 6.9, mediaFinishRemainingMs: 100 } })); });
  assert.equal(media.plays, 1, 'a stale snapshot does not replay after reaching the finish');
  await act(async () => { view.update(createElement(QuestionClue, { state: { ...base, mediaVersion: 1, mediaPositionSeconds: 2, mediaFinishRemainingMs: 5000 } })); });
  assert.equal(media.currentTime, 2);
  assert.equal(media.plays, 2);
  await act(async () => { view.update(createElement(QuestionClue, { state: { ...base, mediaVersion: 1, mediaPositionSeconds: 3, displayClockRunning: false } })); });
  assert.equal(media.paused, true);
  assert.equal(media.currentTime, 3);
  await act(async () => { view.unmount(); });
});

test('audio resumes after the result and a pending play is paused if disconnected', async () => {
  const previousFrame = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  Object.assign(globalThis, { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  const media = makeMedia();
  let resolvePlay!: () => void;
  media.play = function () { this.plays++; this.paused = false; return new Promise<void>((resolve) => { resolvePlay = resolve; }); };
  const state = { ...base, question: { ...base.question!, type: 'audio' as const, visualizer: { enabled: false, style: 'spectrum' as const } } };
  let view!: ReactTestRenderer;
  try {
    await act(async () => { view = create(createElement(Media, { state: { ...state, phase: 'BUZZ_RESULT', displayClockRunning: false } }),
      { createNodeMock: (element) => element.type === 'canvas' ? { getContext: () => null } : media }); });
    await act(async () => { view.root.findByType('audio').props.onLoadedMetadata(); });
    assert.equal(media.plays, 0);
    await act(async () => { view.update(createElement(Media, { state })); });
    assert.equal(media.plays, 1);
    await act(async () => { view.update(createElement(Media, { state: { ...state, displayClockRunning: false } })); });
    await act(async () => { resolvePlay(); });
    assert.equal(media.paused, true);
  } finally {
    if (view) await act(async () => { view.unmount(); });
    Object.assign(globalThis, { requestAnimationFrame: previousFrame, cancelAnimationFrame: previousCancel });
  }
});

test('host can skip or restart unknown media but cannot adjust scores or remove players; phone buzz is closed', async () => {
  const player = { id: 'alice', name: 'Alice', avatarId: 'fox' as const, score: 500, connected: true, joinedOrder: 0 };
  const state = { ...base, players: [player], leaderboardIds: [player.id], activePlayerId: player.id,
    canUndo: true, mediaFinishRemainingMs: null, mediaFinishNeedsSkip: true };
  const actions: HostAction[] = [];
  const session: Session = { state, receivedAt: performance.now(), connected: true, playerId: player.id,
    error: null, pending: false, clearError: () => {}, command: async (action) => { actions.push(action); return true; },
    join: async () => true, buzz: async () => true, submitAnswer: async () => true };
  let view!: ReactTestRenderer;
  const render = (child: React.ReactNode) => createElement(MemoryRouter, null,
    createElement(SessionContext.Provider, { value: session }, child));
  await act(async () => { view = create(render(createElement(AdminConsole, { logout: () => {}, requirePasscode: false, development: false }))); });
  const button = (label: string) => view.root.findAllByType('button').find((item) => item.children.join('').includes(label))!;
  assert.ok(JSON.stringify(view.toJSON()).includes('Duration unknown'));
  assert.equal(button('Skip finishing media').props.disabled, false);
  assert.equal(button('Restart media only').props.disabled, false);
  assert.equal(button('Close / skip question').props.disabled, true);
  assert.equal(button('Pause clue').props.disabled, true);
  assert.equal(button('Remove').props.disabled, true);
  assert.equal(view.root.findByProps({ 'aria-label': "Adjust Alice's score" }).props.disabled, true);
  assert.equal(button('Undo last score change').props.disabled, false);
  assert.equal(button('Reset this question').props.disabled, false);
  await act(async () => { button('Skip finishing media').props.onClick(); button('Restart media only').props.onClick(); });
  assert.deepEqual(actions, [{ type: 'skipMedia' }, { type: 'restartMedia' }]);
  await act(async () => { view.update(render(createElement(PlayPage))); });
  assert.ok(JSON.stringify(view.toJSON()).includes('Finishing the clue'));
  assert.equal(view.root.findAllByType('button').find((item) => item.props.className === 'buzz-button')?.props.disabled, true);
  await act(async () => { view.update(render(createElement(DisplayPage))); });
  const television = JSON.stringify(view.toJSON());
  assert.ok(television.includes('FINISHING CLUE'));
  assert.ok(television.includes('Buzzing is closed'));
  assert.ok(!television.includes('The floor is yours'));
  await act(async () => { view.unmount(); });
});

test('audio and video host previews never mount or play media', async () => {
  for (const type of ['audio', 'video'] as const) {
    let view!: ReactTestRenderer;
    let nodeMocks = 0;
    await act(async () => { view = create(createElement(Media, { state: { ...base, question: { ...base.question!, type } }, preview: true }),
      { createNodeMock: () => { nodeMocks++; return makeMedia(); } }); });
    assert.equal(view.root.findAllByType('audio').length, 0);
    assert.equal(view.root.findAllByType('video').length, 0);
    assert.equal(nodeMocks, 0);
    await act(async () => { view.unmount(); });
  }
});

test('tile display actually uncovers tiles during finishing and respects restart', async () => {
  const question = { ...base.question!, type: 'image' as const };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Media, { state: { ...base, question, revealProgress: 0.25 } })); });
  const uncovered = () => view.root.findAll((node) => node.props.className === 'uncovered').length;
  assert.equal(uncovered(), 1);
  await act(async () => { view.update(createElement(Media, { state: { ...base, question, revealProgress: 0.75 } })); });
  assert.equal(uncovered(), 3);
  await act(async () => { view.update(createElement(Media, { state: { ...base, question, mediaVersion: 1, revealProgress: 0 } })); });
  assert.equal(uncovered(), 0);
  await act(async () => { view.unmount(); });
});