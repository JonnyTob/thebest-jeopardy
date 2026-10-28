export type CountdownPhase = 'STARTING' | 'NEXT_ROUND';
export type CountdownDigit = 1 | 2 | 3;

export interface CountdownSoundState {
  id: string | null;
  // The lowest number observed, including numbers missed while sound was unavailable.
  lowest: number;
}

export const initialCountdownSoundState: CountdownSoundState = { id: null, lowest: 4 };

export function countdownDigit(phase: CountdownPhase | null, remaining: number | null): CountdownDigit | null {
  if (!phase || remaining === null || !Number.isFinite(remaining) || remaining <= 0) return null;
  const digit = Math.ceil(remaining / 1000) - (phase === 'STARTING' ? 1 : 0);
  return digit >= 1 && digit <= 3 ? digit as CountdownDigit : null;
}

/** Consume only the current visible digit; never catch up or move backwards on resync. */
export function advanceCountdownSound(previous: CountdownSoundState, input: {
  id: string | null;
  phase: CountdownPhase | null;
  remaining: number | null;
  connected: boolean;
  enabled: boolean;
}): { state: CountdownSoundState; play: CountdownDigit | null } {
  let state = previous.id === input.id ? previous : { id: input.id, lowest: 4 };
  if (!input.id || !input.phase || input.remaining === null || !Number.isFinite(input.remaining)) return { state, play: null };
  const digit = countdownDigit(input.phase, input.remaining);
  // GO / zero is also a watermark: a stale snapshot must not bring numbers back.
  const observed = digit ?? (input.remaining <= (input.phase === 'STARTING' ? 1000 : 0) ? 0 : null);
  if (observed === null || observed >= state.lowest) return { state, play: null };
  state = { ...state, lowest: observed };
  return { state, play: digit && input.connected && input.enabled ? digit : null };
}