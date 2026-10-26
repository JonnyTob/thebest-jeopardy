import type { Player, Settings } from './protocol.js';

export function pointsAt(elapsedMs: number, settings: Settings): number {
  return Math.max(settings.minimumPoints,
    settings.startPoints - Math.floor(elapsedMs / (settings.dropEverySeconds * 1000)) * settings.dropPoints);
}

export function valueWindowMs(settings: Settings): number {
  return Math.ceil((settings.startPoints - settings.minimumPoints) / settings.dropPoints)
    * settings.dropEverySeconds * 1000;
}

export function rankPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score || a.joinedOrder - b.joinedOrder);
}

export function tileOrder(count: number, seed: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  let state = seed >>> 0;
  for (let i = count - 1; i > 0; i--) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
