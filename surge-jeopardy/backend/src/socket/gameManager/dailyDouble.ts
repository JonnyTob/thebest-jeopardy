import type { DailyDoubleState } from '../../types.js';
import { sessions } from './state.js';

// ── Daily Double wagering ───────────────────────────────────────────────────

export function revealDailyDouble(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.dailyDoubleRevealed = true;
  return true;
}

// Begin the wager step for a newly-opened Daily Double. If no player has
// correctly answered a regular question yet, falls into 'picking' so the
// host can choose the contestant manually.
export function startDailyDoubleWager(
  roomCode: string,
  lastCorrectPlayerId: string | null,
  boardHighValue: number,
  hasDevice: boolean,
): DailyDoubleState | null {
  const session = sessions.get(roomCode);
  if (!session) return null;

  if (!lastCorrectPlayerId || !session.players.some(p => p.id === lastCorrectPlayerId)) {
    session.dailyDouble = {
      stage: 'picking',
      playerId: null,
      maxWager: 0,
      boardHighValue,
      wager: null,
      hasDevice: false,
      submittedByPlayer: false,
    };
    return session.dailyDouble;
  }

  const player = session.players.find(p => p.id === lastCorrectPlayerId)!;
  session.dailyDouble = {
    stage: 'wagering',
    playerId: player.id,
    maxWager: Math.max(player.score, boardHighValue),
    boardHighValue,
    wager: null,
    hasDevice,
    submittedByPlayer: false,
  };
  return session.dailyDouble;
}

// Host's fallback pick when there's no tracked "last correct" player.
export function pickDDContestant(roomCode: string, playerId: string, hasDevice: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session || !session.dailyDouble) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  session.dailyDouble.playerId = player.id;
  session.dailyDouble.maxWager = Math.max(player.score, session.dailyDouble.boardHighValue);
  session.dailyDouble.hasDevice = hasDevice;
  session.dailyDouble.stage = 'wagering';
  return true;
}

export function submitDDWager(roomCode: string, playerId: string, amount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  const dd = session?.dailyDouble;
  if (!session || !dd) return { ok: false, error: 'No Daily Double in progress' };
  if (dd.stage !== 'wagering') return { ok: false, error: 'Wagering is closed' };
  if (dd.playerId !== playerId) return { ok: false, error: 'You are not the Daily Double contestant' };
  if (dd.submittedByPlayer) return { ok: false, error: 'Wager already locked' };
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > dd.maxWager) {
    return { ok: false, error: `Wager must be a whole number between 0 and ${dd.maxWager}` };
  }
  dd.wager = amount;
  dd.submittedByPlayer = true;
  dd.stage = 'ready';
  return { ok: true };
}

// Host correcting/entering the wager. Only allowed once the player has
// submitted (so this is a fix-up, not a bypass) — unless the assigned
// player has no phone connected, in which case this IS their only path in.
export function overrideDDWager(roomCode: string, amount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  const dd = session?.dailyDouble;
  if (!session || !dd || !dd.playerId) return { ok: false, error: 'No Daily Double contestant assigned' };
  if (dd.hasDevice && !dd.submittedByPlayer) {
    return { ok: false, error: "Waiting for the player's own wager first" };
  }
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > dd.maxWager) {
    return { ok: false, error: `Wager must be a whole number between 0 and ${dd.maxWager}` };
  }
  dd.wager = amount;
  dd.stage = 'ready';
  return { ok: true };
}

export function clearDailyDouble(roomCode: string): void {
  const session = sessions.get(roomCode);
  if (session) session.dailyDouble = null;
}
