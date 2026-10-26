import type { BuzzEntry } from '../../types.js';
import { sessions, resetBuzzerFields, PERMANENT_LOCKOUT } from './state.js';

// ── Question lifecycle (buzzer-adjacent) ────────────────────────────────────

export function openQuestion(roomCode: string, questionId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.activeQuestionId = questionId;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = !isDailyDouble; // DD starts unrevealed; regular questions start revealed
  session.responseVisible = false;
  return true;
}

export function showResponse(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.responseVisible = true;
  return true;
}

export function closeQuestion(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (session.activeQuestionId) {
    session.answeredQuestions.push(session.activeQuestionId);
  }
  session.activeQuestionId = null;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  session.dailyDouble = null;
  return true;
}

export function enableBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function resetBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function lockBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'idle';
  return true;
}

// ── Buzzing / lockout / queue state machine ─────────────────────────────────

export type BuzzOutcome = 'won' | 'early' | 'locked-out' | 'ignored' | 'queued';

export function recordBuzz(roomCode: string, playerId: string, playerName: string, buzzOpenedAt: number | null): BuzzOutcome {
  const session = sessions.get(roomCode);
  if (!session) return 'ignored';
  if (!session.activeQuestionId || session.phase === 'finished') return 'ignored';

  const now = Date.now();
  const player = session.players.find(p => p.id === playerId);

  if (session.buzzerState === 'idle') {
    if (session.settings.lockoutMs > 0) {
      session.buzzLockouts[playerId] = now + session.settings.lockoutMs;
      if (player) {
        if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
        player.stats.earlyBuzzes += 1;
      }
    }
    return 'early';
  }

  if (session.buzzerState === 'locked') {
    // Player already in queue
    if (session.buzzQueue.some(e => e.playerId === playerId)) return 'ignored';
    // Player permanently locked out
    if (session.buzzLockouts[playerId] === PERMANENT_LOCKOUT) return 'ignored';
    // Queue the buzz
    const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
    session.buzzQueue.push({ playerId, playerName, reactionMs, attemptedAnswer: false });
    session.buzzQueue.sort((a, b) => a.reactionMs - b.reactionMs);
    return 'queued';
  }

  // buzzerState === 'open'
  const lockedUntil = session.buzzLockouts[playerId];
  if (lockedUntil && now < lockedUntil) {
    return 'locked-out';
  }

  const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
  session.buzzerState = 'locked';
  session.buzzedPlayerId = playerId;
  session.buzzedPlayerName = playerName;
  session.buzzTimestamp = now;
  session.buzzQueue.unshift({ playerId, playerName, reactionMs, attemptedAnswer: false });
  if (player) {
    if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
    player.stats.buzzes += 1;
  }
  return 'won';
}

// Records a correct/wrong outcome against a player's stats (score delta is applied separately via updateScore).
export function recordOutcome(roomCode: string, playerId: string, outcome: 'correct' | 'wrong'): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
  if (outcome === 'correct') player.stats.correct += 1;
  else player.stats.wrong += 1;
  return true;
}

const VALID_LOCKOUTS = [0, 250, 500, 1000];

export function setLockoutMs(roomCode: string, ms: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (!VALID_LOCKOUTS.includes(ms)) return false;
  session.settings.lockoutMs = ms;
  return true;
}

// Reject stale/duplicate/mismatched "Correct"/"Wrong" judging clicks: the
// awarded playerId must match whoever is actually eligible right now — the
// currently-buzzed-in player for a regular question, or the Daily Double
// contestant when isDailyDouble is true. Does not mutate state. Manual score
// adjustments (no outcome) bypass this check entirely — callers should only
// invoke it when an `outcome` is present.
export function validateScoreEligibility(roomCode: string, playerId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (isDailyDouble) return playerId === session.dailyDouble?.playerId;
  return playerId === session.buzzedPlayerId;
}

export function markWrongAndReopen(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  // Reject stale/duplicate/mismatched emits: only the currently-buzzed-in
  // player can be marked wrong. Does not mutate state on mismatch.
  if (playerId !== session.buzzedPlayerId) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score += delta;
  if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
  player.stats.wrong += 1;
  session.buzzLockouts[playerId] = PERMANENT_LOCKOUT;
  // Does NOT touch buzzerState, buzzedPlayerId, buzzedPlayerName, buzzTimestamp
  return true;
}

export function markBuzzAttempted(roomCode: string, playerId: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const entry = session.buzzQueue.find(e => e.playerId === playerId);
  if (entry) entry.attemptedAnswer = true;
  return true;
}

export function getNextInQueue(roomCode: string, ineligibleIds: Set<string>): BuzzEntry | null {
  const session = sessions.get(roomCode);
  if (!session) return null;
  return session.buzzQueue.find(e => !e.attemptedAnswer && !ineligibleIds.has(e.playerId)) ?? null;
}

export function advanceToBuzzEntry(roomCode: string, entry: BuzzEntry): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'locked';
  session.buzzedPlayerId = entry.playerId;
  session.buzzedPlayerName = entry.playerName;
  session.buzzTimestamp = Date.now();
  return true;
}

export function setAutoLock(roomCode: string, enabled: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.settings.autoLockEnabled = enabled;
  return true;
}

export function setAutoLockTimeout(roomCode: string, seconds: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 10) return false;
  session.settings.autoLockTimeoutS = seconds;
  return true;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function updateScore(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score += delta;
  return true;
}

export function setScore(roomCode: string, playerId: string, score: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score = score;
  return true;
}
