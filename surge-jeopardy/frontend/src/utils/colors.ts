/** Palette used for assigning player colors (host add-player and player self-join). */
export const PLAYER_COLORS = ['#FFD700', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399', '#f472b6'];

/** Picks a random color from PLAYER_COLORS. */
export function randomPlayerColor(): string {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}
