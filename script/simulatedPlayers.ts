import { performance } from 'node:perf_hooks';
import type { Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, Snapshot } from '../src/shared/protocol.js';

type PlayerSocket = Socket<ServerEvents, ClientEvents>;

interface Plan {
  instanceId: string;
  submitAt: number | null;
  buzzAt: number | null;
  answer: string;
  submitted: boolean;
}

interface SimulatedPlayer {
  socket: PlayerSocket;
  index: number;
  snapshot?: Snapshot;
  receivedAt: number;
  plan?: Plan;
  pending: boolean;
  retryAt: number;
  listener: (snapshot: Snapshot) => void;
}

export function createPlayerSimulator(options: {
  random?: () => number;
  now?: () => number;
  log?: (message: string) => void;
  error?: (message: string) => void;
  onFatal?: () => void;
} = {}) {
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  const players: SimulatedPlayer[] = [];
  let interval: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  function attach(socket: PlayerSocket) {
    const player: SimulatedPlayer = {
      socket, index: players.length, receivedAt: 0, pending: false, retryAt: 0,
      listener: (snapshot) => { player.snapshot = snapshot; player.receivedAt = now(); },
    };
    players.push(player);
    socket.on('session:snapshot', player.listener);
  }

  function makePlan(state: Snapshot, index: number): Plan {
    const question = state.question!;
    const duration = (question.timerSeconds ?? state.settings.questionTimerSeconds) * 1000;
    const typingWindow = question.mode === 'type-and-buzz' ? (question.typingSeconds ?? 0) * 1000 : 0;
    const total = duration + typingWindow;
    const willSubmit = question.mode !== 'buzzer' && (index === 0 || random() < 0.8);
    const willBuzz = question.mode !== 'typed' && (index === 0 || random() < 0.8);
    const submitWindow = question.mode === 'type-and-buzz' ? typingWindow : duration;
    const submitAt = willSubmit ? Math.min(submitWindow * (0.15 + random() * 0.55), 12000) : null;
    const buzzAt = willBuzz ? question.mode === 'type-and-buzz'
      ? submitAt !== null ? Math.min(submitAt + 1000 + random() * 3000, total * 0.9)
        : typingWindow + duration * (0.15 + random() * 0.5)
      : Math.min(duration * (0.2 + random() * 0.6), 15000) : null;
    const answers = ['Simulated answer A', 'Simulated answer B', 'Simulated answer C', 'Not sure'];
    const answer = answers[Math.floor(random() * answers.length)].slice(0, state.settings.maxAnswerLength).trim() || '?';
    return { instanceId: state.questionInstanceId!, submitAt, buzzAt, answer, submitted: state.mySubmitted };
  }

  async function act(player: SimulatedPlayer, plan: Plan, action: 'submit' | 'buzz', elapsed: number, name: string) {
    player.pending = true;
    player.retryAt = now() + 1000;
    try {
      const result = action === 'submit'
        ? await player.socket.timeout(5000).emitWithAck('player:submitAnswer', { questionInstanceId: plan.instanceId, answer: plan.answer })
        : await player.socket.timeout(5000).emitWithAck('player:buzz');
      if (stopped) return;
      if (!result.ok) {
        error(`${name}: ${action} rejected: ${result.error}`);
        return;
      }
      if (action === 'submit') {
        plan.submitted = true;
        log(`${name} submitted "${plan.answer}". Judge it as you choose.`);
      } else {
        plan.buzzAt = elapsed + 2000;
        log(`${name} buzzed. Suggested ruling: ${random() < 0.7 ? 'correct' : 'wrong'} (random; host decides).`);
      }
    } catch (cause) {
      if (!stopped) {
        error(`${name}: ${action} acknowledgement failed: ${cause instanceof Error ? cause.message : String(cause)}. Stopping simulation.`);
        stop();
        options.onFatal?.();
      }
    } finally {
      player.pending = false;
    }
  }

  function tick() {
    for (const player of players) {
      const state = player.snapshot;
      const identity = state?.players[0];
      if (!state?.question || !state.questionInstanceId || !identity || !player.socket.connected) continue;
      if (player.plan?.instanceId !== state.questionInstanceId) player.plan = makePlan(state, player.index);
      const plan = player.plan;
      if (player.pending || now() < player.retryAt || state.phase !== 'QUESTION_OPEN' || state.paused || !state.clockRunning) continue;
      const elapsed = state.clueElapsedMs + Math.max(0, now() - player.receivedAt);
      const deadline = ((state.question.timerSeconds ?? state.settings.questionTimerSeconds)
        + (state.question.mode === 'type-and-buzz' ? state.question.typingSeconds ?? 0 : 0)) * 1000;
      if (elapsed >= deadline) continue;
      const lockoutRemaining = state.lockoutRemainingMs[identity.id];
      const lockedOut = state.lockedOutIds.includes(identity.id)
        && (lockoutRemaining === undefined || lockoutRemaining > Math.max(0, now() - player.receivedAt));
      if (plan.submitAt !== null && !plan.submitted && !state.mySubmitted && !state.submissionsClosed && elapsed >= plan.submitAt) {
        void act(player, plan, 'submit', elapsed, identity.name);
      } else if (plan.buzzAt !== null && elapsed >= plan.buzzAt && !lockedOut
        && (state.question.mode !== 'type-and-buzz' || state.submissionsClosed || plan.submitted || state.mySubmitted
          || elapsed >= (state.question.typingSeconds ?? 0) * 1000)) {
        void act(player, plan, 'buzz', elapsed, identity.name);
      }
    }
  }

  function start() {
    if (stopped || interval) throw new Error('Player simulator cannot be started twice.');
    interval = setInterval(tick, 100);
    tick();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (interval) clearInterval(interval);
    for (const player of players) player.socket.off('session:snapshot', player.listener);
  }

  return { attach, start, stop };
}
