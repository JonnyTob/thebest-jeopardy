const STORAGE_KEY = 'jeopardy:hostPasscode';

function getStoredPasscode(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function setStoredPasscode(value: string) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
}

function clearStoredPasscode() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function promptForPasscode(): string | null {
  const value = window.prompt('Enter the host passcode:');
  if (value) setStoredPasscode(value);
  return value;
}

// Wraps fetch for mutating host requests (board/media writes): attaches the
// passcode header, prompting once if none is stored yet, and clears +
// re-prompts on a 401 so a stale or wrong passcode doesn't get stuck.
export async function hostFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let passcode = getStoredPasscode();
  if (!passcode) passcode = promptForPasscode();

  const headers = new Headers(init.headers);
  if (passcode) headers.set('X-Host-Passcode', passcode);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    clearStoredPasscode();
    const retry = promptForPasscode();
    if (retry) {
      headers.set('X-Host-Passcode', retry);
      res = await fetch(input, { ...init, headers });
    }
  }

  return res;
}
