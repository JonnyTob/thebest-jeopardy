import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, HostAction, JoinRequest, ServerEvents, Snapshot } from '../shared/protocol';
import { pointsAt } from '../shared/game';
import { clearPlayerToken, readPlayerToken, savePlayerToken } from './playerToken';
import { branding } from './branding';

type GameSocket = Socket<ServerEvents, ClientEvents>;
interface Session {
  state: Snapshot | null;
  receivedAt: number;
  connected: boolean;
  playerId: string | null;
  error: string | null;
  pending: boolean;
  clearError: () => void;
  command: (action: HostAction) => Promise<boolean>;
  join: (request: JoinRequest) => Promise<boolean>;
  buzz: () => Promise<boolean>;
  submitAnswer: (answer: string, questionInstanceId: string) => Promise<boolean>;
}
const Context = createContext<Session | null>(null);

function commandId(): string {
  // randomUUID is unavailable on ordinary HTTP LAN origins.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function SessionProvider({ role, passcode, children }: {
  role: 'host' | 'display' | 'player'; passcode?: string; children: ReactNode;
}) {
  const socketRef = useRef<GameSocket | null>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<Snapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let playerToken = role === 'player' ? readPlayerToken() : null;
    const socket: GameSocket = io({
      autoConnect: false,
      auth: { role, passcode, token: playerToken ?? undefined },
    });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); setError(null); });
    socket.on('disconnect', () => { setConnected(false); });
    socket.on('connect_error', (event) => {
      setConnected(false);
      setError(event.message);
    });
    socket.on('session:snapshot', (snapshot) => {
      setState(snapshot);
      setReceivedAt(performance.now());
    });
    socket.on('player:identity', ({ playerId: id }) => {
      setPlayerId(id);
      if (role === 'player' && !id && (playerToken || (socket.auth as { token?: string }).token)) {
        playerToken = null;
        clearPlayerToken();
        socket.auth = { role };
        setError('Your previous player is no longer in this session. Please join again.');
      }
    });
    socket.on('session:error', setError);
    socket.connect();
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [role, passcode]);

  const request = useCallback(async (execute: (socket: GameSocket) => Promise<boolean>) => {
    if (!socketRef.current?.connected) {
      setError('Connection lost. Wait for reconnection before trying again.');
      return false;
    }
    if (busyRef.current) return false;
    busyRef.current = true;
    setPending(true);
    setError(null);
    try {
      return await execute(socketRef.current);
    } catch (cause) {
      console.error(`${branding.name} request failed:`, cause);
      setError('The server did not confirm the request. Check the current state before retrying.');
      return false;
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }, []);

  const command = (action: HostAction) => request(async (socket) => {
    if (!state) { setError('Waiting for the game state.'); return false; }
    const result = await socket.timeout(5000).emitWithAck('host:command', { id: commandId(), revision: state.revision, action });
    if (!result.ok) setError(result.error);
    return result.ok;
  });
  const join = (input: JoinRequest) => request(async (socket) => {
    const result = await socket.timeout(5000).emitWithAck('player:join', input);
    if (!result.ok) { setError(result.error); return false; }
    socket.auth = { role, token: result.data.token };
    setPlayerId(result.data.playerId);
    if (!savePlayerToken(result.data.token)) {
      setError('Joined successfully, but Safari or your browser blocked saving your player. Keep this tab open; reloading may require joining again.');
    }
    return true;
  });
  const buzz = () => request(async (socket) => {
    const result = await socket.timeout(5000).emitWithAck('player:buzz');
    if (!result.ok) setError(result.error);
    return result.ok;
  });
  const submitAnswer = (answer: string, questionInstanceId: string) => request(async (socket) => {
    const result = await socket.timeout(5000).emitWithAck('player:submitAnswer', { answer, questionInstanceId });
    if (!result.ok) setError(result.error);
    return result.ok;
  });

  return <Context.Provider value={{ state, receivedAt, connected, playerId, error, pending, clearError: () => setError(null), command, join, buzz, submitAnswer }}>
    {children}
  </Context.Provider>;
}

export function useSession(): Session {
  const context = useContext(Context);
  if (!context) throw new Error('Game views require a SessionProvider.');
  return context;
}

export function useAnimatedState(): Snapshot | null {
  const { state, receivedAt, connected } = useSession();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if ((!state?.clockRunning && state?.phase !== 'STARTING' && state?.phase !== 'NEXT_ROUND') || !connected) return;
    const timer = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(timer);
  }, [state?.clockRunning, state?.phase, connected]);
  if (!state) return null;
  const extra = connected ? Math.max(0, now - receivedAt) : 0;
  const clueExtra = state.clockRunning ? extra : 0;
  const elapsed = state.clueElapsedMs + clueExtra;
  return { ...state, clockRunning: state.clockRunning && connected,
    startCountdownMs: state.startCountdownMs === null ? null
      : Math.max(0, state.startCountdownMs - (state.phase === 'STARTING' ? extra : 0)),
    nextRoundCountdownMs: state.nextRoundCountdownMs === null ? null
      : Math.max(0, state.nextRoundCountdownMs - (state.phase === 'NEXT_ROUND' ? extra : 0)),
    clueElapsedMs: elapsed, currentPoints: state.question?.mode === 'typed'
      ? state.question.fixedPoints ?? state.currentPoints : state.pointsAtBuzz ?? pointsAt(elapsed, state.settings),
    revealProgress: Math.min(1, state.revealProgress + clueExtra / ((state.question?.reveal?.durationSeconds ?? 20) * 1000)),
    mediaPositionSeconds: state.mediaPositionSeconds + clueExtra / 1000 };
}
