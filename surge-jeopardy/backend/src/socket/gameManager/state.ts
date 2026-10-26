import type { GameState } from '../../types.js';
import { PERMANENT_LOCKOUT } from '../../types.js';

export { PERMANENT_LOCKOUT };

// Single source of truth for in-memory session state. Other gameManager
// submodules (sessions/buzzer/dailyDouble/rounds) import the maps and the
// shared resetBuzzerFields helper from here rather than each owning their
// own copy, since multiple groups need to read/mutate the same GameState
// objects.
export const sessions = new Map<string, GameState>();

// Internal-only bookkeeping: last time each room saw real activity. Kept as a
// separate Map (rather than a field on GameState) because GameState is
// broadcast wholesale to clients in many places, and this value must never
// leak into an outbound payload. Touched inside getSession() in sessions.ts,
// which is called from nearly every socket handler in socketHandler.ts (after
// almost every mutation, for GET_STATE requests, on reconnect, etc.), making
// it a single low-risk choke point that covers essentially all real room
// activity.
export const lastActivityAt = new Map<string, number>();

// Resets the buzzer-related fields shared by every "start fresh" transition
// (openQuestion, closeQuestion, resetBuzzer, enableBuzzer, advanceRound,
// endGame). Callers that need to reset additional fields (dailyDoubleRevealed,
// responseVisible, dailyDouble, buzzLockouts, etc.) do so inline after calling
// this helper — see each call site for the exact variation.
export function resetBuzzerFields(
  session: GameState,
  opts: { buzzerState: 'idle' | 'open'; clearLockouts?: boolean }
) {
  session.buzzerState = opts.buzzerState;
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  session.buzzQueue = [];
  if (opts.clearLockouts) session.buzzLockouts = {};
}
