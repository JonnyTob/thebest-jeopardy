import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CountdownSound } from '../src/client/components/CountdownSound.js';
import type { CountdownPhase } from '../src/client/countdownSound.js';

const base = { sound: '/media/sounds/countdown-beep.wav', id: null as string | null,
  reviewCorrectSound: '/media/sounds/countdown-beep.wav' as string | null,
  reviewWrongSound: '/media/sounds/countdown-beep.wav' as string | null,
  phase: null as CountdownPhase | null, remaining: null as number | null, connected: true, receivedAt: 1 };

function makeAudio() {
  return { src: '', currentTime: 0, playbackRate: 1, error: null, plays: 0, pauses: 0, loads: 0,
    play() { this.plays++; return Promise.resolve(); },
    pause() { this.pauses++; },
    load() { this.loads++; },
  };
}

test('enabled countdown sounds each visible digit once without cutting off the first beep', async () => {
  for (const phase of ['STARTING', 'NEXT_ROUND'] as const) {
    const audio = makeAudio();
    let view!: ReactTestRenderer;
    await act(async () => { view = create(createElement(CountdownSound, base), { createNodeMock: () => audio }); });
    await act(async () => { view.root.findByType('button').props.onClick(); });
    assert.equal(audio.plays, 1);
    const pauses = audio.pauses;
    const first = phase === 'STARTING' ? 4000 : 3000;
    const props = { ...base, id: phase, phase, remaining: first };
    await act(async () => { view.update(createElement(CountdownSound, props)); });
    assert.equal(audio.plays, 2, '3 plays immediately');
    assert.equal(audio.pauses, pauses, 'starting the countdown does not interrupt playback');
    await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: first - 200, receivedAt: 2 })); });
    assert.equal(audio.plays, 2, 'a repeated snapshot does not replay 3');
    await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: first - 1000 })); });
    assert.equal(audio.plays, 3, '2 plays');
    await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: first - 900 })); });
    assert.equal(audio.plays, 3, 'a backward clock correction does not replay 3');
    assert.equal(audio.pauses, pauses, 'clock corrections do not cut off the beep');
    await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: first - 2000 })); });
    assert.equal(audio.plays, 4, '1 plays');
    await act(async () => { view.update(createElement(CountdownSound, base)); });
    assert.ok(audio.pauses > pauses, 'ending the countdown stops obsolete playback');
    await act(async () => { view.unmount(); });
  }
});

test('enabling during 3 lets the gesture beep play instead of immediately pausing it', async () => {
  const audio = makeAudio();
  let view!: ReactTestRenderer;
  const props = { ...base, id: 'transition', phase: 'NEXT_ROUND' as const, remaining: 3000 };
  await act(async () => { view = create(createElement(CountdownSound, props), { createNodeMock: () => audio }); });
  const pauses = audio.pauses;
  await act(async () => { view.root.findByType('button').props.onClick(); });
  assert.equal(audio.plays, 1);
  assert.equal(audio.pauses, pauses, 'the enable beep is not cut off');
  await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: 2800 })); });
  assert.equal(audio.plays, 1, '3 is not replayed after enabling');
  await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: 2000 })); });
  assert.equal(audio.plays, 2);
  await act(async () => { view.unmount(); });
});

test('a countdown starting while the enable gesture is pending does not cancel it', async () => {
  const audio = makeAudio();
  let finishPlay!: () => void;
  audio.play = function () { this.plays++; return new Promise<void>((resolve) => { finishPlay = resolve; }); };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CountdownSound, base), { createNodeMock: () => audio }); });
  await act(async () => { view.root.findByType('button').props.onClick(); });
  const pauses = audio.pauses;
  const props = { ...base, id: 'transition', phase: 'NEXT_ROUND' as const, remaining: 3000 };
  await act(async () => { view.update(createElement(CountdownSound, props)); });
  assert.equal(audio.pauses, pauses);
  await act(async () => { finishPlay(); });
  assert.equal(view.root.findByType('button').children.join(''), 'TV sounds enabled');
  await act(async () => { view.update(createElement(CountdownSound, { ...props, remaining: 2000 })); });
  assert.equal(audio.plays, 2);
  await act(async () => { view.unmount(); });
});

test('review placeholder effects play once at distinct pitches and never replay stale results', async () => {
  const audio = makeAudio();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CountdownSound, base), { createNodeMock: () => audio }); });
  await act(async () => { view.root.findByType('button').props.onClick(); });
  const right = { ...base, reviewResultId: 'right', reviewRemainingMs: 2000, reviewCorrect: true };
  await act(async () => { view.update(createElement(CountdownSound, right)); });
  assert.equal(audio.plays, 2);
  assert.equal(audio.playbackRate, 1.4);
  await act(async () => { view.update(createElement(CountdownSound, { ...right, reviewRemainingMs: 1800, receivedAt: 2 })); });
  assert.equal(audio.plays, 2);
  const wrong = { ...base, reviewResultId: 'wrong', reviewRemainingMs: 2000, reviewCorrect: false, receivedAt: 3 };
  await act(async () => { view.update(createElement(CountdownSound, wrong)); });
  assert.equal(audio.plays, 3);
  assert.equal(audio.playbackRate, 0.7);
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, connected: false })); });
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, connected: true, receivedAt: 4 })); });
  assert.equal(audio.plays, 3);
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, reviewResultId: 'late', reviewRemainingMs: 700 })); });
  assert.equal(audio.plays, 3, 'late results are not replayed');
  await act(async () => { view.update(createElement(CountdownSound, { ...base, id: 'next', phase: 'NEXT_ROUND', remaining: 3000 })); });
  assert.equal(audio.plays, 4);
  assert.equal(audio.playbackRate, 1, 'countdown beep resets its pitch');
  await act(async () => { view.unmount(); });
});

test('review sounds use independent files and work with the countdown disabled', async () => {
  const audio = makeAudio();
  let view!: ReactTestRenderer;
  const settings = { ...base, sound: null, reviewCorrectSound: '/media/sounds/win.wav', reviewWrongSound: '/media/sounds/lose.wav' };
  await act(async () => { view = create(createElement(CountdownSound, settings), { createNodeMock: () => audio }); });
  await act(async () => { view.root.findByType('button').props.onClick(); });
  assert.equal(audio.src, settings.reviewCorrectSound);
  const right = { ...settings, reviewResultId: 'right', reviewRemainingMs: 2000, reviewCorrect: true };
  await act(async () => { view.update(createElement(CountdownSound, right)); });
  assert.equal(audio.plays, 2);
  assert.equal(audio.src, settings.reviewCorrectSound);
  assert.equal(audio.playbackRate, 1);
  const wrong = { ...settings, reviewResultId: 'wrong', reviewRemainingMs: 2000, reviewCorrect: false };
  await act(async () => { view.update(createElement(CountdownSound, wrong)); });
  assert.equal(audio.plays, 3);
  assert.equal(audio.src, settings.reviewWrongSound);
  assert.equal(audio.playbackRate, 1);
  await act(async () => { view.update(createElement(CountdownSound, { ...settings, reviewResultId: null })); });
  assert.ok(audio.pauses > 0, 'ending or undoing a review stops its sound');
  await act(async () => { view.unmount(); });
});

test('null independently disables either review outcome', async () => {
  for (const correct of [true, false]) {
    const audio = makeAudio();
    let view!: ReactTestRenderer;
    const settings = { ...base, reviewCorrectSound: correct ? null : '/media/right.wav',
      reviewWrongSound: correct ? '/media/wrong.wav' : null };
    await act(async () => { view = create(createElement(CountdownSound, settings), { createNodeMock: () => audio }); });
    await act(async () => { view.root.findByType('button').props.onClick(); });
    await act(async () => { view.update(createElement(CountdownSound, { ...settings,
      reviewResultId: 'silent', reviewRemainingMs: 2000, reviewCorrect: correct })); });
    assert.equal(audio.plays, 1);
    await act(async () => { view.update(createElement(CountdownSound, { ...settings,
      reviewResultId: 'audible', reviewRemainingMs: 2000, reviewCorrect: !correct })); });
    assert.equal(audio.plays, 2);
    assert.equal(audio.src, correct ? '/media/wrong.wav' : '/media/right.wav');
    await act(async () => { view.unmount(); });
  }
});

test('no audio enable button is shown when all three sounds are disabled', async () => {
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CountdownSound, { ...base,
    sound: null, reviewCorrectSound: null, reviewWrongSound: null }), { createNodeMock: () => makeAudio() }); });
  assert.equal(view.root.findAllByType('button').length, 0);
  await act(async () => { view.unmount(); });
});

test('four-second group sounds play once per fresh group, not on late or reconnected snapshots', async () => {
  const audio = makeAudio();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CountdownSound, base), { createNodeMock: () => audio }); });
  await act(async () => { view.root.findByType('button').props.onClick(); });
  const group = { ...base, reviewHoldMs: 4000, reviewResultId: 'group-one', reviewRemainingMs: 4000, reviewCorrect: true };
  await act(async () => { view.update(createElement(CountdownSound, group)); });
  assert.equal(audio.plays, 2);
  await act(async () => { view.update(createElement(CountdownSound, { ...group, receivedAt: 2, reviewRemainingMs: 3800 })); });
  assert.equal(audio.plays, 2);
  const wrong = { ...group, receivedAt: 3, reviewResultId: 'group-two', reviewCorrect: false };
  await act(async () => { view.update(createElement(CountdownSound, wrong)); });
  assert.equal(audio.plays, 3);
  assert.equal(audio.playbackRate, 0.7);
  await act(async () => { view.update(createElement(CountdownSound, { ...group, receivedAt: 3 })); });
  assert.equal(audio.plays, 3, 'an earlier group ID cannot play again after another group');
  await act(async () => { view.update(createElement(CountdownSound, wrong)); });
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, connected: false })); });
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, connected: true })); });
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, receivedAt: 4, reviewResultId: 'missed', reviewRemainingMs: 4000 })); });
  assert.equal(audio.plays, 3, 'first new snapshot after reconnect is silent even near its start');
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, receivedAt: 5, reviewResultId: 'missed', reviewRemainingMs: 3800 })); });
  assert.equal(audio.plays, 3);
  await act(async () => { view.update(createElement(CountdownSound, { ...wrong, receivedAt: 6, reviewResultId: 'late', reviewRemainingMs: 3500 })); });
  assert.equal(audio.plays, 3, 'late group does not use the individual two-second freshness window');
  await act(async () => { view.update(createElement(CountdownSound, { ...base, receivedAt: 7, reviewResultId: 'individual', reviewRemainingMs: 2000, reviewCorrect: true })); });
  assert.equal(audio.plays, 4, 'individual result still plays');
  await act(async () => { view.unmount(); });
});