const tokenKey = 'quiz-night-player-token';

// Safari can deny access to localStorage. Persistence is optional: the socket
// still keeps its token in memory so joining and reconnecting work in this tab.
export function readPlayerToken(): string | null {
  try { return localStorage.getItem(tokenKey); }
  catch { return null; }
}

export function savePlayerToken(token: string): boolean {
  try { localStorage.setItem(tokenKey, token); return true; }
  catch { return false; }
}

export function clearPlayerToken(): void {
  try { localStorage.removeItem(tokenKey); }
  catch { /* Storage may be blocked or unavailable. */ }
}