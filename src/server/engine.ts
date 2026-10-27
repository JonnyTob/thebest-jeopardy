import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pointsAt, rankPlayers } from '../shared/game.js';
import { serverSettingsSchema, type HostCommand, type JoinRequest, type Phase, type Player, type Quiz, type ScoreEvent, type Settings, type Snapshot, type ServerSettings } from '../shared/protocol.js';

export class GameError extends Error {}

interface ClueState {
  phase: Phase;
  questionIndex: number;
  elapsedMs: number;
  startedAt: number | null;
  paused: boolean;
  lockedOutIds: string[];
  lockedOutUntil: Record<string, number>;
  activePlayerId: string | null;
  pointsAtBuzz: number | null;
  mediaOffsetSeconds: number;
  mediaVersion: number;
}
interface UndoEntry {
  clue: ClueState;
  scores: Map<string, number>;
  eventId: string;
}

export class GameEngine {
  readonly players = new Map<string, Player>();
  settings: Settings;
  revision = 0;
  private nextOrder = 0;
  private leaderboardIds: string[] = [];
  private history: UndoEntry[] = [];
  private scoreEvents: ScoreEvent[] = [];
  private processed = new Set<string>();
  private clue: ClueState = {
    phase: 'LOBBY', questionIndex: -1, elapsedMs: 0, startedAt: null,
    paused: false, lockedOutIds: [], lockedOutUntil: {}, activePlayerId: null, pointsAtBuzz: null,
    mediaOffsetSeconds: 0, mediaVersion: 0,
  };

  constructor(readonly quiz: Quiz, private readonly now: () => number = () => performance.now(),
    readonly serverSettings: ServerSettings = serverSettingsSchema.parse({})) {
    this.settings = { title: quiz.title, leaderboardCount: 8, startPoints: 500,
      minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, lockoutSeconds: 0 };
  }

  private require(condition: unknown, message: string): asserts condition {
    if (!condition) throw new GameError(message);
  }

  private elapsed(): number {
    return this.clue.elapsedMs + (this.clue.startedAt === null ? 0 : this.now() - this.clue.startedAt);
  }

  private freeze() {
    this.clue.elapsedMs = this.elapsed();
    this.clue.startedAt = null;
  }

  private rank() {
    this.leaderboardIds = rankPlayers([...this.players.values()]).map((p) => p.id);
  }

  private isActive() {
    return this.clue.phase === 'QUESTION_OPEN' || this.clue.phase === 'ANSWERING';
  }

  private isLockedOut(playerId: string) {
    const until = this.clue.lockedOutUntil[playerId];
    return this.clue.lockedOutIds.includes(playerId) && (until === undefined || this.now() < until);
  }

  join(request: JoinRequest): Player {
    this.require(request.name.length >= 1 && request.name.length <= this.serverSettings.maxPlayerNameLength,
      `Choose a nickname (1-${this.serverSettings.maxPlayerNameLength} characters).`);
    this.require(this.players.size < this.serverSettings.maxPlayers,
      `The game is full (${this.serverSettings.maxPlayers} players maximum). Ask the host to remove an unused player.`);
    this.require(![...this.players.values()].some((p) => p.name.toLocaleLowerCase() === request.name.toLocaleLowerCase()),
      'That nickname is already in use.');
    const player: Player = { id: randomUUID(), ...request, score: 0, connected: true, joinedOrder: this.nextOrder++ };
    this.players.set(player.id, player);
    this.rank();
    this.revision++;
    return player;
  }

  setConnected(playerId: string, connected: boolean) {
    const player = this.players.get(playerId);
    if (player && player.connected !== connected) {
      player.connected = connected;
      this.revision++;
    }
  }

  buzz(playerId: string) {
    this.require(this.players.get(playerId)?.connected, 'Join the game before buzzing.');
    this.require(this.clue.phase === 'QUESTION_OPEN' && !this.clue.paused, 'Buzzers are not open.');
    this.require(!this.isLockedOut(playerId), this.settings.lockoutSeconds > 0
      ? 'You are locked out until your countdown ends.' : 'You are locked out for this question.');
    this.freeze();
    this.clue.activePlayerId = playerId;
    this.clue.pointsAtBuzz = pointsAt(this.clue.elapsedMs, this.settings);
    this.clue.phase = 'ANSWERING';
    this.revision++;
  }

  private open(index: number) {
    this.rank();
    this.history = [];
    this.clue = {
      phase: 'QUESTION_OPEN', questionIndex: index, elapsedMs: 0, startedAt: this.now(),
      paused: false, lockedOutIds: [], lockedOutUntil: {}, activePlayerId: null, pointsAtBuzz: null,
      mediaOffsetSeconds: 0, mediaVersion: this.clue.mediaVersion + 1,
    };
  }

  private close() {
    this.freeze();
    this.clue.phase = 'QUESTION_CLOSED';
    this.clue.paused = false;
    this.clue.activePlayerId = null;
    this.clue.pointsAtBuzz = null;
    this.rank();
  }

  private saveScore(player: Player, delta: number, description: string) {
    this.require(Number.isSafeInteger(player.score + delta), 'Score would exceed the supported range.');
    const eventId = randomUUID();
    this.history.push({
      clue: { ...structuredClone(this.clue), elapsedMs: this.elapsed(), startedAt: this.clue.startedAt === null ? null : this.now() },
      scores: new Map([...this.players.values()].map((p) => [p.id, p.score])),
      eventId,
    });
    if (this.history.length > 100) this.history.shift();
    player.score += delta;
    this.rank();
    this.scoreEvents.unshift({ id: eventId, description, playerId: player.id, delta });
    this.scoreEvents = this.scoreEvents.slice(0, 100);
  }

  command(command: HostCommand, saveSettings?: (settings: Settings) => void) {
    if (this.processed.has(command.id)) return;
    this.require(command.revision === this.revision, 'Game state changed. Review the latest state and try again.');
    const action = command.action;
    switch (action.type) {
      case 'setup':
        this.require(this.clue.phase === 'LOBBY', 'Setup can only change in the lobby.');
        saveSettings?.(action.settings);
        this.settings = action.settings;
        break;
      case 'start':
        this.require(this.clue.phase === 'LOBBY', 'The game has already started.');
        this.open(0);
        break;
      case 'next':
        this.require(['QUESTION_CLOSED', 'ANSWER_REVEALED'].includes(this.clue.phase), 'Close the current question before advancing.');
        if (this.clue.questionIndex + 1 >= this.quiz.questions.length) {
          this.clue.phase = 'GAME_FINISHED';
          this.history = [];
          this.rank();
        } else this.open(this.clue.questionIndex + 1);
        break;
      case 'pause':
        this.require(this.clue.phase === 'QUESTION_OPEN' && !this.clue.paused, 'Only an open clue can be paused.');
        this.freeze();
        this.clue.paused = true;
        break;
      case 'resume':
        this.require(this.clue.phase === 'QUESTION_OPEN' && this.clue.paused, 'The clue is not paused.');
        this.clue.startedAt = this.now();
        this.clue.paused = false;
        break;
      case 'close':
        this.require(this.isActive(), 'There is no active question to close.');
        this.close();
        break;
      case 'reveal':
        this.require(this.clue.phase === 'QUESTION_CLOSED', 'Close the question before revealing its answer.');
        this.clue.phase = 'ANSWER_REVEALED';
        break;
      case 'reset':
        this.require(this.clue.questionIndex >= 0 && this.clue.phase !== 'GAME_FINISHED', 'There is no question to reset.');
        this.open(this.clue.questionIndex);
        break;
      case 'restartMedia':
        this.require(this.clue.phase === 'QUESTION_OPEN', 'Restart media while the question is open or paused.');
        this.clue.mediaOffsetSeconds = -this.elapsed() / 1000;
        this.clue.mediaVersion++;
        break;
      case 'judge': {
        this.require(this.clue.phase === 'ANSWERING' && this.clue.activePlayerId && this.clue.pointsAtBuzz !== null,
          'No player is currently answering.');
        const player = this.players.get(this.clue.activePlayerId);
        this.require(player, 'Answering player not found.');
        this.saveScore(player, action.correct ? this.clue.pointsAtBuzz : -this.clue.pointsAtBuzz,
          `${player.name}: ${action.correct ? 'correct' : 'wrong'}`);
        if (action.correct) this.close();
        else {
          if (!this.clue.lockedOutIds.includes(player.id)) this.clue.lockedOutIds.push(player.id);
          if (this.settings.lockoutSeconds > 0) {
            this.clue.lockedOutUntil[player.id] = this.now() + this.settings.lockoutSeconds * 1000;
          }
          this.clue.activePlayerId = null;
          this.clue.pointsAtBuzz = null;
          this.clue.phase = 'QUESTION_OPEN';
          this.clue.startedAt = this.now();
        }
        break;
      }
      case 'adjust': {
        const player = this.players.get(action.playerId);
        this.require(player, 'Player not found.');
        this.saveScore(player, action.delta, `${player.name}: manual adjustment`);
        break;
      }
      case 'undo': {
        const entry = this.history.pop();
        this.require(entry, 'There is no score change to undo for this question.');
        this.clue = { ...entry.clue, startedAt: entry.clue.startedAt === null ? null : this.now(),
          mediaVersion: this.clue.mediaVersion + 1 };
        for (const [id, score] of entry.scores) {
          const player = this.players.get(id);
          if (player) player.score = score;
        }
        this.scoreEvents = this.scoreEvents.filter((event) => event.id !== entry.eventId);
        this.rank();
        break;
      }
      case 'removePlayer':
        this.require(!this.isActive(), 'Remove players between questions.');
        this.require(this.players.has(action.playerId), 'Player not found.');
        this.players.delete(action.playerId);
        this.history = [];
        this.rank();
        break;
    }
    this.processed.add(command.id);
    if (this.processed.size > 2000) this.processed.delete(this.processed.values().next().value!);
    this.revision++;
  }

  snapshot(host = false): Snapshot {
    const question = this.quiz.questions[this.clue.questionIndex];
    const elapsed = this.elapsed();
    const now = this.now();
    const publicQuestion = question ? {
      id: question.id, type: question.type, question: question.question, text: question.text,
      media: question.media, reveal: question.reveal, playback: question.playback, visualizer: question.visualizer,
    } : null;
    return {
      revision: this.revision, quizId: this.quiz.id, settings: { ...this.settings }, phase: this.clue.phase,
      serverSettings: { ...this.serverSettings },
      coverImage: this.quiz.coverImage ?? null,
      questionIndex: this.clue.questionIndex, questionCount: this.quiz.questions.length,
      question: publicQuestion,
      revealedAnswer: this.clue.phase === 'ANSWER_REVEALED' ? question.answer : null,
      ...(host && question ? { privateAnswer: question.answer } : {}),
      players: [...this.players.values()].map((p) => ({ ...p })),
      leaderboardIds: [...this.leaderboardIds],
      lockedOutIds: this.clue.lockedOutIds.filter((id) => this.isLockedOut(id)),
      lockoutRemainingMs: Object.fromEntries(Object.entries(this.clue.lockedOutUntil)
        .filter(([, until]) => until > now).map(([id, until]) => [id, until - now])),
      activePlayerId: this.clue.activePlayerId, pointsAtBuzz: this.clue.pointsAtBuzz,
      currentPoints: this.clue.pointsAtBuzz ?? pointsAt(elapsed, this.settings),
      clueElapsedMs: elapsed, clockRunning: this.clue.startedAt !== null, paused: this.clue.paused,
      revealProgress: Math.min(1, Math.max(0, elapsed / 1000 + this.clue.mediaOffsetSeconds) / (question?.reveal?.durationSeconds ?? 20)),
      mediaPositionSeconds: (question?.playback?.startSeconds ?? 0) + Math.max(0, elapsed / 1000 + this.clue.mediaOffsetSeconds),
      mediaVersion: this.clue.mediaVersion,
      canUndo: host && this.history.length > 0,
      scoreEvents: host ? structuredClone(this.scoreEvents) : [],
    };
  }
}
