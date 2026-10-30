import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine } from '../src/server/engine.js';
import { serverSettingsSchema } from '../src/shared/protocol.js';

test('buzzer shows one point decay bar and a separate numeric submission countdown', async () => {
  globalThis.document = { getElementById: () => ({ textContent: '{}' }) } as unknown as Document;
  const { PointBar } = await import('../src/client/components/Common.js');
  let time = 0;
  const game = new GameEngine({ id: 42, title: 'Quiz', questions: [{
    id: randomUUID(), type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer', timerSeconds: 10,
  }] }, () => time);
  game.settings.dropEverySeconds = 1;
  game.settings.pointDecayDelaySeconds = 2;
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  time += 4000;
  game.tick();
  time += 999;
  let html = renderToStaticMarkup(<PointBar state={game.snapshot()} />);
  assert.match(html, /500 <small>pts<\/small>/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Point reduction progress"[^>]*aria-valuenow="100"/);
  assert.match(html, /Points held: 1\.1s/);
  assert.match(html, /Buzzing closes in.*10s/);
  time++;
  game.tick();
  html = renderToStaticMarkup(<PointBar state={game.snapshot()} />);
  assert.equal(game.snapshot().currentPoints, 500);
  assert.match(html, /aria-label="Point reduction progress"[^>]*aria-valuenow="100"/);
  assert.match(html, /Buzzing closes in.*9s/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
  time += 2000;
  html = renderToStaticMarkup(<PointBar state={game.snapshot()} />);
  assert.equal(game.snapshot().currentPoints, 400);
  assert.match(html, /aria-label="Point reduction progress"[^>]*aria-valuenow="75"/);
  assert.match(html, /Buzzing closes in.*7s/);
  time += 3000;
  html = renderToStaticMarkup(<PointBar state={game.snapshot()} />);
  assert.equal(game.snapshot().currentPoints, 100);
  assert.match(html, /aria-label="Point reduction progress"[^>]*aria-valuenow="0"/);
  assert.match(html, /Buzzing closes in.*4\.0s/);
  time += 4000;
  game.tick();
  html = renderToStaticMarkup(<PointBar state={game.snapshot()} />);
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
  assert.match(html, /Buzzing closed.*0\.0s/);
  assert.equal((html.match(/role="progressbar"/g) ?? []).length, 1);
});

test('typed countdown reaches zero before the configured answer grace expires', async () => {
  globalThis.document = { getElementById: () => ({ textContent: '{}' }) } as unknown as Document;
  const { questionTimerMs, typedGraceRemainingMs } = await import('../src/client/components/Common.js');
  let time = 0;
  const game = new GameEngine({ id: 43, title: 'Quiz', questions: [{
    id: randomUUID(), type: 'text', mode: 'typed', question: 'Clue', answer: 'Answer', timerSeconds: 2,
  }] }, () => time, serverSettingsSchema.parse({ typedAnswerGraceSeconds: 3 }));
  game.join({ name: 'Alice', avatarId: 'fox' });
  game.command({ id: randomUUID(), revision: game.revision, action: { type: 'start' } });
  time += 4000;
  game.tick();
  time += 2000;
  game.tick();
  const state = game.snapshot();
  assert.equal(state.phase, 'QUESTION_OPEN');
  assert.equal(questionTimerMs(state) - state.clueElapsedMs, 0);
  assert.equal(typedGraceRemainingMs(state), 3000);
  time += 3000;
  game.tick();
  assert.equal(game.snapshot().phase, 'QUESTION_CLOSED');
});
