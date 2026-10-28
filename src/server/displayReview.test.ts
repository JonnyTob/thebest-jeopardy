import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine } from './engine.js';
import { REVIEW_RESULT_MS } from '../shared/game.js';
import type { HostAction, Quiz } from '../shared/protocol.js';

test('TV review overlays the current player without replacing text or media clues', async () => {
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: () => ({ textContent: '{}' }),
  } });
  let QuestionClue: typeof import('../client/components/QuestionClue.js').QuestionClue;
  try {
    ({ QuestionClue } = await import('../client/components/QuestionClue.js'));
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  for (const type of ['text', 'image', 'video', 'audio'] as const) {
    let time = 0;
    const quiz: Quiz = { id: 100001, title: 'Review', questions: [{
      id: 'one', type, question: 'Visible question', text: 'Visible text clue',
      ...(type === 'text' ? {} : { media: `/media/clue.${type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'mp3'}` }),
      mode: 'typed', fixedPoints: 250, timerSeconds: 30, answer: 'SECRET CORRECT ANSWER',
    }] };
    const game = new GameEngine(quiz, () => time);
    const alice = game.join({ name: 'Alice', avatarId: 'fox' });
    const bob = game.join({ name: 'Bob', avatarId: 'cat' });
    const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
    send({ type: 'start' });
    time += 4000;
    game.tick();
    const instance = game.snapshot().questionInstanceId!;
    game.submitAnswer(alice.id, instance, 'Alice guess');
    game.submitAnswer(bob.id, instance, 'Bob guess');
    let html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.doesNotMatch(html, /Current answer review|Alice guess|Bob guess|SECRET CORRECT ANSWER/);
    send({ type: 'startReview' });
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Visible question/);
    assert.match(html, /Current answer review/);
    assert.match(html, /Alice/);
    assert.match(html, /Alice guess/);
    assert.doesNotMatch(html, /Bob guess|SECRET CORRECT ANSWER/);
    assert.doesNotMatch(html, /review-result-animation/);
    assert.match(html, type === 'text' ? /Visible text clue/ : new RegExp(`/media/clue\\.${type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'mp3'}`));
    send({ type: 'judgeReview', correct: false });
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Wrong \/ \+0/);
    assert.match(html, /review-result-wrong/);
    time += REVIEW_RESULT_MS;
    game.tick();
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Bob guess/);
    assert.doesNotMatch(html, /Alice guess|SECRET CORRECT ANSWER/);
    send({ type: 'judgeReview', correct: true });
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Bob guess/);
    assert.match(html, /review-result-correct/);
    assert.match(html, /Correct \+250/);
    time += REVIEW_RESULT_MS;
    game.tick();
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.doesNotMatch(html, /Current answer review|Alice guess|Bob guess|SECRET CORRECT ANSWER/);
  }
  for (const correct of [false, true]) {
    let time = 0;
    const game = new GameEngine({ id: 100001, title: 'Buzzer', questions: [
      { id: 'one', type: 'text', question: 'Buzzer clue', answer: 'SECRET BUZZER ANSWER' },
      { id: 'two', type: 'text', question: 'Future clue', answer: 'SECRET FUTURE ANSWER' },
    ] }, () => time);
    const alice = game.join({ name: 'Alice', avatarId: 'fox' });
    const send = (action: HostAction) => game.command({ id: randomUUID(), revision: game.revision, action });
    send({ type: 'start' });
    time += 4000;
    game.tick();
    let html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.doesNotMatch(html, /Player answering|FIRST TO BUZZ/);
    game.buzz(alice.id);
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Buzzer clue/);
    assert.match(html, /Player answering/);
    assert.match(html, /FIRST TO BUZZ/);
    assert.match(html, /Alice/);
    assert.match(html, /500 points/);
    assert.doesNotMatch(html, /SECRET|Buzzer answer result/);
    send({ type: 'judge', correct });
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.match(html, /Buzzer clue/);
    assert.match(html, /Buzzer answer result/);
    assert.doesNotMatch(html, /Player answering|FIRST TO BUZZ/);
    assert.match(html, /Alice/);
    assert.match(html, correct ? /Correct \+500/ : /Wrong -500/);
    assert.match(html, correct ? /review-result-correct/ : /review-result-wrong/);
    assert.doesNotMatch(html, /SECRET|Future clue/);
    send({ type: 'undo' });
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.doesNotMatch(html, /Buzzer answer result|review-result-animation/);
    assert.match(html, /Player answering/);
    send({ type: 'judge', correct });
    time += 2000;
    game.tick();
    html = renderToStaticMarkup(createElement(QuestionClue, { state: game.snapshot() }));
    assert.doesNotMatch(html, /Buzzer answer result|review-result-animation|Player answering/);
  }
});