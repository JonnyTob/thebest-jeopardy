import type { FinalPublicState } from '../../types.js';
import { sessions, resetBuzzerFields } from './state.js';

// Get/set the public Final Jeopardy sub-state on a session (used by finalJeopardy.ts).
export function getFinalState(roomCode: string): FinalPublicState | null | undefined {
  const session = sessions.get(roomCode);
  return session?.finalJeopardy;
}

export function setFinalState(roomCode: string, fj: FinalPublicState | null): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.finalJeopardy = fj;
  return true;
}

export function setLastCorrectPlayer(roomCode: string, playerId: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.lastCorrectPlayerId = playerId;
  return true;
}

// Advances to the next round. Rejects if a question/DD/FJ is active or this
// is already the last round. Players, scores, stats and lastCorrectPlayerId
// all carry over — only the per-question/buzzer/lockout state resets.
export function advanceRound(roomCode: string, roundCount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  if (!session) return { ok: false, error: 'Room not found' };
  if (session.activeQuestionId) return { ok: false, error: 'A question is still active' };
  if (session.finalJeopardy) return { ok: false, error: 'Final Jeopardy is in progress' };
  if (session.currentRoundIndex >= roundCount - 1) return { ok: false, error: 'Already on the last round' };

  session.currentRoundIndex += 1;
  session.activeQuestionId = null;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  session.dailyDouble = null;
  return { ok: true };
}
