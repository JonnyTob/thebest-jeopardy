import type { Player, PublicQuestion, Settings } from './protocol.js';

export const START_COUNTDOWN_MS = 4000;
export const NEXT_ROUND_MS = 3000;
export const REVIEW_RESULT_MS = 2000;
export const REVIEW_GROUP_MS = 4000;
export const BUZZ_RESULT_MS = 2000;
export const BUZZ_CORRECT_ANSWER_MS = 3000;

/** Wrong buzzes lose half the correct value, rounded up to a whole point. */
export function wrongBuzzPenalty(points: number): number {
  return Math.ceil(points / 2);
}

export function pointSettingsFor(question: PublicQuestion | null | undefined, settings: Settings): Settings {
  return question?.pointDecay ? { ...settings, ...question.pointDecay } : settings;
}

export function buzzerPointMode(question: PublicQuestion | null | undefined): 'fixed' | 'decay' {
  return question?.pointMode ?? (question?.mode === 'buzzer' ? 'decay' : 'fixed');
}

export function buzzerPointsAt(question: PublicQuestion | null | undefined, elapsedMs: number, settings: Settings, decayStartMs?: number | null): number {
  if (buzzerPointMode(question) === 'fixed') return (question?.mode === 'typed' ? question.fixedPoints : question?.buzzPoints) ?? 0;
  const scoringElapsed = question?.mode === 'type-and-buzz'
    ? Math.max(0, elapsedMs - (decayStartMs ?? (question.typingSeconds ?? 0) * 1000)) : elapsedMs;
  return pointsAt(scoringElapsed, pointSettingsFor(question, settings));
}

export function startCountdownText(remainingMs: number): string {
  return remainingMs > 1000 ? String(Math.ceil(remainingMs / 1000) - 1) : "LET'S GO!";
}

export function pointsAt(elapsedMs: number, settings: Settings): number {
  const decayElapsedMs = Math.max(0, elapsedMs - settings.pointDecayDelaySeconds * 1000);
  return Math.max(settings.minimumPoints,
    settings.startPoints - Math.floor(decayElapsedMs / (settings.dropEverySeconds * 1000)) * settings.dropPoints);
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
