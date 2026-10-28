import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link } from 'react-router-dom';
import type { AvatarId, Snapshot } from '../../shared/protocol';
import { valueWindowMs } from '../../shared/game';
import { useSession } from '../session';
import { branding } from '../branding';

const animalColors: Record<AvatarId, string> = {
  fox: '#f69246', cat: '#f7c955', bear: '#ba835b', panda: '#eee7fa', frog: '#65d7a1', owl: '#b49aef',
};

export function Avatar({ id, className = '' }: { id: AvatarId; className?: string }) {
  const round = id === 'bear' || id === 'panda' || id === 'frog';
  return <svg className={`avatar ${className}`} viewBox="0 0 80 80" aria-label={`${id} avatar`} role="img">
    <rect width="80" height="80" rx="24" fill={`${animalColors[id]}20`} />
    <g fill={animalColors[id]}>
      {round ? <><circle cx="21" cy="23" r="11" /><circle cx="59" cy="23" r="11" /></>
        : <><path d="M14 40 13 9 35 28Z" /><path d="M66 40 67 9 45 28Z" /></>}
      <ellipse cx="40" cy="44" rx="28" ry="26" />
    </g>
    {id === 'panda' && <g fill="#372748"><ellipse cx="27" cy="40" rx="10" ry="12" /><ellipse cx="53" cy="40" rx="10" ry="12" /></g>}
    <ellipse cx="40" cy="56" rx="17" ry="10" fill="#fff4df" />
    <g fill="#21132e"><circle cx="28" cy="39" r="4" /><circle cx="52" cy="39" r="4" /><path d="M35 49h10l-5 6Z" /></g>
    <path d="M32 58q8 7 16 0" fill="none" stroke="#21132e" strokeWidth="2.5" strokeLinecap="round" />
  </svg>;
}

export function Brand({ subtitle }: { subtitle?: string }) {
  return <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">{branding.logoText}</span>
    <span>{branding.name}{subtitle && <small>{subtitle}</small>}</span></Link>;
}

export function QuizName({ title, id }: { title: string; id: number }) {
  return <span className="quiz-name"><span className="quiz-name-text" title={title}>{title}</span>
    <span className="quiz-id">Quiz #{id}</span></span>;
}

export function Connection({ connected }: { connected: boolean }) {
  return <span className={`connection ${connected ? 'online' : 'offline'}`} role="status">
    <span className="status-dot" />{connected ? 'Connected' : 'Reconnecting'}
  </span>;
}

export function SessionError() {
  const { error, clearError } = useSession();
  return error ? <div className="error-banner" role="alert"><span>{error}</span>
    <button className="quiet" onClick={clearError} aria-label="Dismiss error">Dismiss</button></div> : null;
}

export function buzzerLabel(state: Snapshot): string {
  if (state.phase === 'LOBBY') return 'WAITING TO START';
  if (state.phase === 'STARTING') return 'GET READY';
  if (state.phase === 'NEXT_ROUND') return 'NEXT ROUND';
  if (state.phase === 'GAME_FINISHED') return 'FINAL SCORES';
  if (state.phase === 'ANSWERING') return 'PLAYER ANSWERING';
  if (state.phase === 'BUZZ_RESULT') return state.buzzResult?.correct ? 'CORRECT ANSWER' : 'WRONG ANSWER';
  if (state.phase === 'MEDIA_FINISH') return 'FINISHING CLUE';
  if (state.phase === 'REVIEW_GROUP') return 'GROUP RESULTS';
  if (state.phase === 'REVIEW') return 'REVIEWING ANSWERS';
  if (state.phase === 'REVIEW_COMPLETE') return 'REVIEW COMPLETE';
  if (state.paused) return 'HOST PAUSED';
  if (state.phase === 'QUESTION_OPEN') return state.question?.mode === 'typed' ? 'ANSWERS OPEN' : 'BUZZ NOW';
  return 'QUESTION CLOSED';
}

export function nextRoundCountdownText(remainingMs: number | null): string {
  return remainingMs !== null && remainingMs > 0 ? String(Math.ceil(remainingMs / 1000)) : "LET'S GO!";
}

export function typedTimerMs(state: Snapshot): number {
  return Math.max(0, (state.question?.timerSeconds ?? 0) + (state.serverSettings.TimerEndOffsetSeconds ?? 0)) * 1000;
}

export function PointBar({ state }: { state: Snapshot }) {
  const windowMs = valueWindowMs(state.settings);
  const remaining = windowMs === 0 ? 0 : Math.max(0, 1 - state.clueElapsedMs / windowMs);
  return <div className="point-bar">
    <div className="point-label"><span>TIME / POINT VALUE</span><strong>{state.currentPoints.toLocaleString()} <small>pts</small></strong></div>
    <div className="point-track" role="progressbar" aria-label="Remaining high-value window" aria-valuenow={Math.round(remaining * 100)}
      aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${remaining * 100}%` }} /></div>
    <div className="point-meta"><span>{state.clockRunning ? 'Clock running' : 'Clock frozen'}{remaining === 0 ? ' / minimum value' : ''}</span>
      <span>{(state.clueElapsedMs / 1000).toFixed(1)}s / {windowMs / 1000}s</span></div>
  </div>;
}

export function JoinLink({ compact = false }: { compact?: boolean }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/info', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Unable to load LAN join addresses.');
      const info: { joinUrls: string[]; preferredJoinUrl?: string } = await response.json();
      const current = `${location.origin}/play`;
      const choices = [...new Set([...info.joinUrls, current])];
      setUrls(choices);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      setUrl(info.preferredJoinUrl ?? (local ? choices[0] : current));
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load join link.');
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!url) return;
    let active = true;
    void QRCode.toDataURL(url, { width: 512, margin: 4, color: { dark: '#211035', light: '#ffffff' } })
      .then((image) => { if (active) setQr(image); })
      .catch((cause: unknown) => { if (active) setError(`Unable to generate QR code: ${String(cause)}`); });
    return () => { active = false; };
  }, [url]);
  return <div className={`join-link ${compact ? 'compact' : ''}`}>
    {qr && <img src={qr} alt={`QR code to join at ${url}`} />}
    <div><span className="eyebrow">EVERYONE'S INVITED</span><h3>Join from your phone</h3>
      <p>Same Wi-Fi. Pick an avatar. Get ready to buzz.</p>
      {urls.length > 1 && !compact && <label>LAN address<select value={url} onChange={(event) => setUrl(event.target.value)}>
        {urls.map((address) => <option key={address}>{address}</option>)}
      </select></label>}
      <a className="join-url" href={url || '/play'}>{url || 'Loading join address...'}</a>
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  </div>;
}
