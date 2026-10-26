// Canonical validation limits shared by backend and frontend (see
// backend/src/shared/types.ts for why this lives inside backend/src).
export const LIMITS = {
  // Max characters kept for a player's display name (host-panel rename,
  // player self-rename). The player-name input's maxLength should match
  // this so what the player sees accepted client-side is what's actually
  // stored server-side.
  PLAYER_NAME_MAX: 32,
  // Max characters kept for a Final Jeopardy wager answer / in-progress draft.
  ANSWER_MAX: 200,
} as const;
