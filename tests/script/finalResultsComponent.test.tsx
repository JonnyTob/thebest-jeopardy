import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameEngine } from '../../src/server/engine.js';
import type { Snapshot } from '../../src/shared/protocol.js';

const previousDocument = globalThis.document;
Object.assign(globalThis, { document: { getElementById: () => ({ textContent: '{}' }) } });
const { FinalResults } = await import('../../src/client/components/FinalResults.js');
Object.assign(globalThis, { document: previousDocument });

const game = new GameEngine({ id: 1, title: 'Final', questions: [] });
const players = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map((name) => game.join({ name, avatarId: 'fox' }));
players.forEach((player, i) => { player.score = [500, 400, 300, 200, 100][i]; });
const base = { ...game.snapshot(), phase: 'GAME_FINISHED' as const, players, leaderboardIds: players.map((p) => p.id) };
const render = (state: Snapshot) => renderToStaticMarkup(createElement(FinalResults, { state }));

test('final reveal shows third, second and first in sequence, then all ranks', () => {
  const html = (ms: number) => render({ ...base, endGameElapsedMs: ms });
  assert.match(html(0), /Game over!/);
  assert.doesNotMatch(html(0), /Alice|Bob|Carol/);
  assert.match(html(2000), /Carol/);
  assert.doesNotMatch(html(2000), /Alice|Bob/);
  assert.match(html(4000), /Bob/);
  assert.doesNotMatch(html(4000), /Alice/);
  assert.match(html(6000), /Alice/);
  assert.doesNotMatch(html(6000), /Dave/);
  assert.match(html(9000), /Final leaderboard/);
  assert.match(html(9000), /Dave/);
  assert.match(html(9000), /Eve/);
  assert.match(render({ ...base, players: players.slice(0, 3), leaderboardIds: players.slice(0, 3).map((p) => p.id), endGameElapsedMs: 2000 }), /Carol/);
});

test('ties share places and empty games remain valid', () => {
  const tied = players.map((player, i) => ({ ...player, score: i < 2 ? 500 : 300 - i }));
  const html = render({ ...base, players: tied, endGameElapsedMs: 9000 });
  assert.equal((html.match(/1ST/g) ?? []).length, 2);
  assert.match(html, /#3/);
  assert.match(render({ ...base, players: [], leaderboardIds: [], endGameElapsedMs: 9000 }), /Thanks for playing/);
});
