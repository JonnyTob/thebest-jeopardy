import type { Server, Socket } from 'socket.io';
import * as gm from './gameManager.js';
import * as boardStorage from '../storage/boardStorage.js';
import type { FinalPublicState, FinalJeopardyBoard, FinalContestant } from '../types.js';
import { onHost } from './hostAuth.js';
import { SOCKET_EVENTS } from '../shared/socketEvents.js';
import { LIMITS } from '../shared/limits.js';

// ── Secret, per-room Final Jeopardy state ──────────────────────────────────
// Kept OUTSIDE GameState because a NodeJS.Timeout can't be serialized over
// socket.io, and wagers/answers/drafts must not leak to phones before reveal.
interface RoomSecret {
  board: FinalJeopardyBoard;
  order: string[]; // playerId reveal order, lowest score first
  wagers: Map<string, number>;
  answers: Map<string, string>;
  drafts: Map<string, string>;
  appliedDelta: Map<string, number>;
  timer: NodeJS.Timeout | null;
}

const secrets = new Map<string, RoomSecret>();

function hostRoom(roomCode: string) {
  return `hostpanel:${roomCode}`;
}

function broadcastState(io: Server, roomCode: string) {
  const session = gm.getSession(roomCode);
  if (session) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, session);
}

function hostLog(io: Server, roomCode: string, msg: string) {
  io.to(hostRoom(roomCode)).emit(SOCKET_EVENTS.FJ_HOST_LOG, { msg, ts: Date.now() });
}

function broadcastHostState(io: Server, roomCode: string) {
  const secret = secrets.get(roomCode);
  if (!secret) return;
  io.to(hostRoom(roomCode)).emit(SOCKET_EVENTS.FJ_HOST_STATE, {
    wagers: Object.fromEntries(secret.wagers),
    answers: Object.fromEntries(secret.answers),
    drafts: Object.fromEntries(secret.drafts),
  });
}

function getFj(roomCode: string): FinalPublicState | null {
  return gm.getFinalState(roomCode) ?? null;
}

function setFj(roomCode: string, fj: FinalPublicState | null) {
  gm.setFinalState(roomCode, fj);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function startFinal(io: Server, roomCode: string): Promise<{ ok: boolean; error?: string }> {
  const session = gm.getSession(roomCode);
  if (!session) return { ok: false, error: 'Room not found' };
  const board = await boardStorage.getBoard(session.boardId);
  const fjBoard = board?.finalJeopardy;
  if (!fjBoard || !fjBoard.category.trim() || !fjBoard.clue.trim()) {
    return { ok: false, error: 'This board has no Final Jeopardy clue configured' };
  }

  // Snapshot reveal order: ascending score, ties broken by join order (index in players array).
  const order = [...session.players]
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => a.p.score - b.p.score || a.idx - b.idx)
    .map(({ p }) => p.id);

  const wagers = new Map<string, number>();

  const contestants: FinalContestant[] = order.map(playerId => {
    const player = session.players.find(p => p.id === playerId)!;
    const maxWager = Math.max(player.score, 0);
    // Players at $0 or below have only one legal wager ($0), so lock it in now
    // rather than making them submit — they can't be stuck waiting on the phone.
    const autoLocked = maxWager === 0;
    if (autoLocked) wagers.set(playerId, 0);
    return {
      playerId,
      playerName: player.name,
      maxWager,
      hasWagered: autoLocked,
      hasAnswered: false,
      preScore: player.score,
    };
  });

  secrets.set(roomCode, {
    board: fjBoard,
    order,
    wagers,
    answers: new Map(),
    drafts: new Map(),
    appliedDelta: new Map(),
    timer: null,
  });

  const fj: FinalPublicState = {
    stage: 'intro',
    category: null,
    clue: null,
    deadline: null,
    serverNow: Date.now(),
    contestants,
    revealIndex: 0,
    revealStep: 'name',
    currentReveal: null,
    revealed: {},
    response: null,
  };
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
  hostLog(io, roomCode, 'Final Jeopardy started');
  return { ok: true };
}

export function revealCategory(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret || fj.stage !== 'intro') return;
  fj.stage = 'wagering';
  fj.category = secret.board.category;
  fj.serverNow = Date.now();
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, `Category revealed: ${secret.board.category}`);
}

export function submitWager(io: Server, roomCode: string, playerId: string, amount: number): { ok: boolean; error?: string } {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return { ok: false, error: 'No Final Jeopardy in progress' };
  if (fj.stage !== 'wagering') return { ok: false, error: 'Wagering is closed' };
  const contestant = fj.contestants.find(c => c.playerId === playerId);
  if (!contestant) return { ok: false, error: 'You are not in Final Jeopardy' };
  if (secret.wagers.has(playerId)) return { ok: false, error: 'Wager already locked' };
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > contestant.maxWager) {
    return { ok: false, error: `Wager must be a whole number between 0 and ${contestant.maxWager}` };
  }
  secret.wagers.set(playerId, amount);
  contestant.hasWagered = true;
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
  hostLog(io, roomCode, `${contestant.playerName} wagered $${amount}`);
  return { ok: true };
}

// Host entering a value on behalf of a player with no phone.
export function setForPlayer(io: Server, roomCode: string, playerId: string, wager?: number, answer?: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  const contestant = fj.contestants.find(c => c.playerId === playerId);
  if (!contestant) return;
  if (wager !== undefined && Number.isFinite(wager) && Number.isInteger(wager) && wager >= 0 && wager <= contestant.maxWager) {
    secret.wagers.set(playerId, wager);
    contestant.hasWagered = true;
    hostLog(io, roomCode, `Host set ${contestant.playerName}'s wager to $${wager}`);
  }
  if (answer !== undefined) {
    const trimmed = answer.trim().slice(0, LIMITS.ANSWER_MAX);
    secret.answers.set(playerId, trimmed);
    contestant.hasAnswered = true;
    hostLog(io, roomCode, `Host set ${contestant.playerName}'s answer`);
  }
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
}

export function revealClue(io: Server, roomCode: string, force: boolean): { ok: boolean; error?: string } {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return { ok: false, error: 'No Final Jeopardy in progress' };
  if (fj.stage !== 'wagering') return { ok: false, error: 'Not in wagering stage' };
  const missing = fj.contestants.filter(c => !c.hasWagered);
  if (missing.length && !force) {
    return { ok: false, error: `Missing wagers: ${missing.map(m => m.playerName).join(', ')}` };
  }
  // Force reveal: missing wagers default to $0.
  for (const c of missing) {
    secret.wagers.set(c.playerId, 0);
    c.hasWagered = true;
  }
  fj.stage = 'clue';
  fj.clue = secret.board.clue;
  fj.mediaType = secret.board.mediaType;
  fj.mediaUrl = secret.board.mediaUrl;
  fj.serverNow = Date.now();
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
  hostLog(io, roomCode, 'Clue revealed');
  return { ok: true };
}

export function startTimer(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'clue') return;
  const seconds = secret.board.timerSeconds ?? 30;
  const deadline = Date.now() + seconds * 1000;
  fj.stage = 'answering';
  fj.deadline = deadline;
  fj.serverNow = Date.now();
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, `Timer started (${seconds}s)`);

  if (secret.timer) clearTimeout(secret.timer);
  secret.timer = setTimeout(() => lockAnswers(io, roomCode), seconds * 1000 + 750);
}

export function saveDraft(io: Server, roomCode: string, playerId: string, text: string): { ok: boolean; error?: string } {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return { ok: false, error: 'No Final Jeopardy in progress' };
  if (fj.stage !== 'answering') return { ok: false, error: 'Not accepting answers right now' };
  if (secret.answers.has(playerId)) return { ok: false, error: 'Answer already submitted' };
  secret.drafts.set(playerId, text.slice(0, LIMITS.ANSWER_MAX));
  broadcastHostState(io, roomCode);
  return { ok: true };
}

export function submitAnswer(io: Server, roomCode: string, playerId: string, text: string): { ok: boolean; error?: string } {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return { ok: false, error: 'No Final Jeopardy in progress' };
  if (fj.stage !== 'answering') return { ok: false, error: 'Not accepting answers right now' };
  if (!fj.deadline || Date.now() > fj.deadline + 750) return { ok: false, error: 'Time is up' };
  if (secret.answers.has(playerId)) return { ok: false, error: 'Answer already submitted' };
  const trimmed = text.trim().slice(0, LIMITS.ANSWER_MAX);
  secret.answers.set(playerId, trimmed);
  secret.drafts.delete(playerId);
  const contestant = fj.contestants.find(c => c.playerId === playerId);
  if (contestant) contestant.hasAnswered = true;
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
  const name = contestant?.playerName ?? 'A player';
  hostLog(io, roomCode, `${name} submitted their answer`);
  return { ok: true };
}

export function lockAnswers(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'answering') return;
  if (secret.timer) { clearTimeout(secret.timer); secret.timer = null; }

  // Whatever was drafted becomes final for anyone who didn't explicitly submit.
  for (const c of fj.contestants) {
    if (!secret.answers.has(c.playerId)) {
      const draft = (secret.drafts.get(c.playerId) ?? '').trim().slice(0, LIMITS.ANSWER_MAX);
      secret.answers.set(c.playerId, draft);
      c.hasAnswered = draft.length > 0;
    }
  }
  fj.stage = 'locked';
  fj.deadline = null;
  fj.serverNow = Date.now();
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  broadcastHostState(io, roomCode);
  hostLog(io, roomCode, "Time's up — answers locked");
}

export function beginReveal(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  if (!fj) return;
  if (fj.stage !== 'locked') return;
  fj.stage = 'reveal';
  fj.revealIndex = 0;
  fj.revealStep = 'name';
  fj.currentReveal = null;
  fj.serverNow = Date.now();
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, 'Beginning reveal');
}

function currentRevealFor(roomCode: string, playerId: string): { wager: number; answer: string } {
  const secret = secrets.get(roomCode);
  return {
    wager: secret?.wagers.get(playerId) ?? 0,
    answer: secret?.answers.get(playerId) ?? '',
  };
}

export function revealStep(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'reveal') return;
  const steps: Array<'name' | 'wager' | 'answer'> = ['name', 'wager', 'answer'];
  const i = steps.indexOf(fj.revealStep as any);
  if (i === -1 || i >= steps.length - 1) return; // 'answer' -> judge() moves to 'judged'
  fj.revealStep = steps[i + 1];
  if (fj.revealStep === 'wager') {
    const playerId = secret.order[fj.revealIndex];
    fj.currentReveal = currentRevealFor(roomCode, playerId);
  }
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
}

export function judge(io: Server, roomCode: string, playerId: string, correct: boolean) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'reveal') return;
  const current = secret.order[fj.revealIndex];
  if (current !== playerId) return; // only judge the currently-revealed contestant
  const contestant = fj.contestants.find(c => c.playerId === playerId);
  if (!contestant) return;

  // Idempotent: revert any previously-applied delta first.
  const prevDelta = secret.appliedDelta.get(playerId) ?? 0;
  if (prevDelta !== 0) gm.updateScore(roomCode, playerId, -prevDelta);

  const wager = secret.wagers.get(playerId) ?? 0;
  const answer = secret.answers.get(playerId) ?? '';
  const delta = correct ? wager : -wager;
  gm.updateScore(roomCode, playerId, delta);
  gm.recordOutcome(roomCode, playerId, correct ? 'correct' : 'wrong');
  secret.appliedDelta.set(playerId, delta);

  fj.revealed[playerId] = { wager, answer, correct };
  fj.revealStep = 'judged';
  fj.currentReveal = null;
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, `${contestant.playerName} was judged ${correct ? 'correct' : 'wrong'} (${correct ? '+' : '-'}$${wager})`);
}

export function undo(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'reveal' || fj.revealStep !== 'judged') return;
  const playerId = secret.order[fj.revealIndex];
  const prevDelta = secret.appliedDelta.get(playerId) ?? 0;
  if (prevDelta !== 0) {
    gm.updateScore(roomCode, playerId, -prevDelta);
    secret.appliedDelta.delete(playerId);
  }
  const entry = fj.revealed[playerId];
  if (entry) {
    // Revert the stats counter too.
    const session = gm.getSession(roomCode);
    const player = session?.players.find(p => p.id === playerId);
    if (player?.stats) {
      if (entry.correct) player.stats.correct = Math.max(0, player.stats.correct - 1);
      else player.stats.wrong = Math.max(0, player.stats.wrong - 1);
    }
    delete fj.revealed[playerId];
  }
  fj.revealStep = 'answer';
  fj.currentReveal = currentRevealFor(roomCode, playerId);
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, 'Undid last judgment');
}

export function next(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  if (fj.stage !== 'reveal' || fj.revealStep !== 'judged') return;
  const order = secret.order;
  if (fj.revealIndex >= order.length - 1) return; // last contestant — host proceeds via show-response
  fj.revealIndex += 1;
  fj.revealStep = 'name';
  fj.currentReveal = null;
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
}

export function showResponse(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  const secret = secrets.get(roomCode);
  if (!fj || !secret) return;
  fj.stage = 'response';
  fj.response = secret.board.response;
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, 'Correct response revealed');
}

export function showScoreboard(io: Server, roomCode: string) {
  const fj = getFj(roomCode);
  if (!fj) return;
  fj.stage = 'final';
  setFj(roomCode, fj);
  broadcastState(io, roomCode);
  hostLog(io, roomCode, 'Final scoreboard shown');
}

export function exitFinal(io: Server, roomCode: string) {
  cleanup(roomCode);
  setFj(roomCode, null);
  broadcastState(io, roomCode);
}

export function cleanup(roomCode: string) {
  const secret = secrets.get(roomCode);
  if (secret?.timer) clearTimeout(secret.timer);
  secrets.delete(roomCode);
}

// ── Socket registration ─────────────────────────────────────────────────────

export function registerFinalHandlers(
  io: Server,
  socket: Socket,
  socketPlayers: Map<string, { roomCode: string; playerId: string; playerName: string }>,
) {
  onHost(socket, SOCKET_EVENTS.HOST_FJ_START, async ({ roomCode }: { roomCode: string }) => {
    const res = await startFinal(io, roomCode);
    if (!res.ok) socket.emit('error', { message: res.error });
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_REVEAL_CATEGORY, ({ roomCode }: { roomCode: string }) => {
    revealCategory(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_REVEAL_CLUE, ({ roomCode, force }: { roomCode: string; force?: boolean }) => {
    const res = revealClue(io, roomCode, !!force);
    if (!res.ok) socket.emit('error', { message: res.error });
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_START_TIMER, ({ roomCode }: { roomCode: string }) => {
    startTimer(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_BEGIN_REVEAL, ({ roomCode }: { roomCode: string }) => {
    beginReveal(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_REVEAL_STEP, ({ roomCode }: { roomCode: string }) => {
    revealStep(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_JUDGE, ({ roomCode, playerId, correct }: { roomCode: string; playerId: string; correct: boolean }) => {
    judge(io, roomCode, playerId, correct);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_UNDO, ({ roomCode }: { roomCode: string }) => {
    undo(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_NEXT, ({ roomCode }: { roomCode: string }) => {
    next(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_SHOW_RESPONSE, ({ roomCode }: { roomCode: string }) => {
    showResponse(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_SCOREBOARD, ({ roomCode }: { roomCode: string }) => {
    showScoreboard(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_EXIT, ({ roomCode }: { roomCode: string }) => {
    exitFinal(io, roomCode);
  });

  onHost(socket, SOCKET_EVENTS.HOST_FJ_SET_FOR_PLAYER, ({ roomCode, playerId, wager, answer }: { roomCode: string; playerId: string; wager?: number; answer?: string }) => {
    setForPlayer(io, roomCode, playerId, wager, answer);
  });

  // ── Player events ──────────────────────────────────────────────────────
  socket.on(SOCKET_EVENTS.FJ_WAGER, ({ amount }: { amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
    const info = socketPlayers.get(socket.id);
    if (!info) return ack?.({ ok: false, error: 'Not joined' });
    const res = submitWager(io, info.roomCode, info.playerId, amount);
    ack?.(res);
  });

  socket.on(SOCKET_EVENTS.FJ_DRAFT, ({ text }: { text: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
    const info = socketPlayers.get(socket.id);
    if (!info) return ack?.({ ok: false, error: 'Not joined' });
    const res = saveDraft(io, info.roomCode, info.playerId, text ?? '');
    ack?.(res);
  });

  socket.on(SOCKET_EVENTS.FJ_ANSWER, ({ text }: { text: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
    const info = socketPlayers.get(socket.id);
    if (!info) return ack?.({ ok: false, error: 'Not joined' });
    const res = submitAnswer(io, info.roomCode, info.playerId, text ?? '');
    ack?.(res);
  });
}
