import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { pointsAt, rankPlayers, START_COUNTDOWN_MS, NEXT_ROUND_MS, REVIEW_RESULT_MS, REVIEW_GROUP_MS, BUZZ_RESULT_MS } from '../shared/game.js';
import { serverSettingsSchema, type HostCommand, type JoinRequest, type Phase, type Player, type Quiz, type ScoreEvent, type Settings, type Snapshot, type ServerSettings, type TypedReview } from '../shared/protocol.js';

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
  questionInstanceId: string | null;
  submissions: TypedReview[];
  reviewQueue: TypedReview[];
  reviewIndex: number;
}
interface UndoEntry {
  clue: ClueState;
  scores: Map<string, number>;
  eventId: string;
}

function emptyClue(): ClueState {
  return {
    phase: 'LOBBY', questionIndex: -1, elapsedMs: 0, startedAt: null,
    paused: false, lockedOutIds: [], lockedOutUntil: {}, activePlayerId: null, pointsAtBuzz: null,
    mediaOffsetSeconds: 0, mediaVersion: 0,
    questionInstanceId: null, submissions: [], reviewQueue: [], reviewIndex: 0,
  };
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
  private startCountdownAt: number | null = null;
  private nextRoundAt: number | null = null;
  private countdownId: string | null = null;
  private reviewResultAt: number | null = null;
  private reviewResultId: string | null = null;
  private reviewGroup: { id: string; outcome: 'correct' | 'wrong'; playerIds: string[]; points: number; at: number } | null = null;
  private buzzResult: { id: string; playerId: string; correct: boolean; delta: number; at: number } | null = null;
  private mediaFinishAt: number | null = null;
  private mediaFinishDurationMs: number | null = null;
  private mediaFinishElapsedMs = 0;
  private clue: ClueState = emptyClue();

  constructor(public quiz: Quiz, private readonly now: () => number = () => performance.now(),
    readonly serverSettings: ServerSettings = serverSettingsSchema.parse({}),
    private mediaDurations: Readonly<Record<string, number>> = {}) {
    this.settings = { title: quiz.title, leaderboardCount: 8, startPoints: 500,
      minimumPoints: 100, dropPoints: 100, dropEverySeconds: 5, lockoutSeconds: 0, maxAnswerLength: 100 };
  }

  reloadQuiz(quiz: Quiz, settings: Settings, mediaDurations: Readonly<Record<string, number>>) {
    this.require(this.clue.phase === 'LOBBY' && this.players.size === 0,
      'Restart the quiz before loading saved changes.');
    this.quiz = quiz;
    this.settings = settings;
    this.mediaDurations = mediaDurations;
  }

  private require(condition: unknown, message: string): asserts condition {
    if (!condition) throw new GameError(message);
  }

  tick() {
    if (this.clue.phase === 'STARTING' && this.startCountdownAt !== null
      && this.now() - this.startCountdownAt >= START_COUNTDOWN_MS) {
      this.startCountdownAt = null;
      this.open(0);
      this.revision++;
    } else if (this.clue.phase === 'NEXT_ROUND' && this.nextRoundAt !== null
      && this.now() - this.nextRoundAt >= NEXT_ROUND_MS) {
      this.open(this.clue.questionIndex + 1);
      this.revision++;
    } else if (this.clue.phase === 'REVIEW_GROUP' && this.reviewGroup !== null
      && this.now() - this.reviewGroup.at >= REVIEW_GROUP_MS) {
      const outcome = this.reviewGroup.outcome;
      this.reviewGroup = null;
      if (outcome !== 'correct' || !this.startReviewGroup('wrong')) this.advanceReview(0);
      this.revision++;
    } else if (this.clue.phase === 'REVIEW' && this.reviewResultAt !== null
      && this.now() - this.reviewResultAt >= REVIEW_RESULT_MS) {
      this.clearReviewResult();
      this.advanceReview(this.clue.reviewIndex + 1);
      this.revision++;
    } else if (this.clue.phase === 'BUZZ_RESULT' && this.buzzResult !== null
      && this.now() - this.buzzResult.at >= BUZZ_RESULT_MS) {
      const result = this.buzzResult;
      const correct = result.correct;
      if (!correct && this.settings.lockoutSeconds > 0) {
        this.clue.lockedOutUntil[result.playerId] = this.now() + this.settings.lockoutSeconds * 1000;
      }
      this.buzzResult = null;
      if (correct) {
        this.close();
        const remaining = this.remainingPlaybackMs();
        if (remaining === null || remaining > 0) {
          this.clue.phase = 'MEDIA_FINISH';
          this.mediaFinishAt = this.now();
          this.mediaFinishDurationMs = remaining;
          this.mediaFinishElapsedMs = 0;
        } else this.beginNextRound();
      } else {
        this.clue.activePlayerId = null;
        this.clue.pointsAtBuzz = null;
        this.clue.phase = 'QUESTION_OPEN';
        this.clue.startedAt = this.now();
      }
      this.revision++;
    } else if (this.clue.phase === 'MEDIA_FINISH' && this.mediaFinishAt !== null
      && this.mediaFinishDurationMs !== null && this.now() - this.mediaFinishAt >= this.mediaFinishDurationMs) {
      this.finishMedia();
      this.revision++;
    } else if (this.clue.phase === 'QUESTION_OPEN' && !this.clue.paused && this.elapsed() >= this.submissionDeadline()) {
      this.close();
      this.clue.elapsedMs = this.submissionDeadline();
      if (this.clue.reviewQueue.every((entry) => entry.correct !== null)) this.beginReview();
      this.revision++;
    }
  }

  private submissionDeadline(): number {
    const question = this.quiz.questions[this.clue.questionIndex];
    return question?.mode === 'typed'
      ? ((question.timerSeconds ?? 0) + this.serverSettings.TimerEndOffsetSeconds) * 1000 : Infinity;
  }

  private beginNextRound() {
    this.reviewGroup = null;
    this.freeze();
    this.clue.paused = false;
    this.rank();
    if (this.clue.questionIndex + 1 >= this.quiz.questions.length) {
      this.clue.phase = 'GAME_FINISHED';
      this.nextRoundAt = null;
      this.countdownId = null;
    } else {
      this.clue.phase = 'NEXT_ROUND';
      this.nextRoundAt = this.now();
      this.countdownId = randomUUID();
    }
  }

  private clearReviewResult() {
    this.reviewResultAt = null;
    this.reviewResultId = null;
  }

  /** Null means an audio/video endpoint could not be determined. */
  private remainingPlaybackMs(): number | null {
    const question = this.quiz.questions[this.clue.questionIndex];
    const position = Math.max(0, this.clue.elapsedMs / 1000 + this.clue.mediaOffsetSeconds);
    if (question?.type === 'image' && question.reveal?.effect === 'tiles') {
      return Math.max(0, (question.reveal.durationSeconds - position) * 1000);
    }
    if (question?.type !== 'audio' && question?.type !== 'video') return 0;
    const duration = question.media ? this.mediaDurations[question.media] : undefined;
    const natural = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    const end = Math.min(question.playback?.endSeconds ?? Infinity, natural);
    return Number.isFinite(end) ? Math.max(0, (end - (question.playback?.startSeconds ?? 0) - position) * 1000) : null;
  }

  private visualFinishElapsed(): number {
    if (this.mediaFinishAt === null) return this.mediaFinishElapsedMs;
    const elapsed = Math.max(0, this.now() - this.mediaFinishAt);
    return this.mediaFinishElapsedMs + (this.mediaFinishDurationMs === null ? elapsed : Math.min(elapsed, this.mediaFinishDurationMs));
  }

  private finishMedia() {
    this.mediaFinishElapsedMs = this.visualFinishElapsed();
    this.mediaFinishAt = null;
    this.mediaFinishDurationMs = null;
    this.beginNextRound();
  }

  private clearMediaFinish() {
    this.mediaFinishAt = null;
    this.mediaFinishDurationMs = null;
    this.mediaFinishElapsedMs = 0;
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
    this.require(this.quiz.questions[this.clue.questionIndex]?.mode !== 'typed', 'This question requires a typed answer.');
    this.require(!this.isLockedOut(playerId), this.settings.lockoutSeconds > 0
      ? 'You are locked out until your countdown ends.' : 'You are locked out for this question.');
    this.freeze();
    this.clue.activePlayerId = playerId;
    this.clue.pointsAtBuzz = pointsAt(this.clue.elapsedMs, this.settings);
    this.clue.phase = 'ANSWERING';
    this.revision++;
  }

  submitAnswer(playerId: string, instanceId: string, value: string) {
    this.require(this.players.get(playerId)?.connected, 'Join the game before answering.');
    this.require(this.clue.phase === 'QUESTION_OPEN' && !this.clue.paused, 'Submissions are not open.');
    this.require(this.elapsed() < this.submissionDeadline(), 'Submissions are not open. The timer has ended.');
    this.require(this.quiz.questions[this.clue.questionIndex]?.mode === 'typed', 'This question does not accept typed answers.');
    this.require(instanceId === this.clue.questionInstanceId, 'This question has changed. Check the current question.');
    const answer = value.trim();
    this.require(answer.length > 0 && answer.length <= this.settings.maxAnswerLength,
      `Enter an answer of 1-${this.settings.maxAnswerLength} characters.`);
    this.require(!this.clue.submissions.some((entry) => entry.playerId === playerId), 'Your answer has already been submitted.');
    this.clue.submissions.push({ playerId, answer, correct: null });
    this.revision++;
  }

  private open(index: number) {
    this.nextRoundAt = null;
    this.countdownId = null;
    this.clearReviewResult();
    this.reviewGroup = null;
    this.buzzResult = null;
    this.clearMediaFinish();
    this.rank();
    this.history = [];
    this.clue = {
      phase: 'QUESTION_OPEN', questionIndex: index, elapsedMs: 0, startedAt: this.now(),
      paused: false, lockedOutIds: [], lockedOutUntil: {}, activePlayerId: null, pointsAtBuzz: null,
      mediaOffsetSeconds: 0, mediaVersion: this.clue.mediaVersion + 1,
      questionInstanceId: randomUUID(), submissions: [], reviewQueue: [], reviewIndex: 0,
    };
  }

  private close() {
    this.freeze();
    this.clue.phase = 'QUESTION_CLOSED';
    this.clue.paused = false;
    this.clue.activePlayerId = null;
    this.clue.pointsAtBuzz = null;
    if (this.quiz.questions[this.clue.questionIndex]?.mode === 'typed') {
      const submitted = new Set(this.clue.submissions.map((entry) => entry.playerId));
      this.clue.reviewQueue = [...structuredClone(this.clue.submissions),
        ...[...this.players.values()].filter((player) => !submitted.has(player.id))
          .sort((a, b) => a.joinedOrder - b.joinedOrder)
          .map((player) => ({ playerId: player.id, answer: null, correct: null }))];
    }
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

  private judgeTypedAnswer(entry: TypedReview | undefined, correct: boolean) {
    this.require(entry, 'Review player not found.');
    this.require(entry.correct === null, 'This answer has already been reviewed.');
    this.require(!correct || entry.answer !== null, 'A missing answer cannot be marked correct.');
    const player = this.players.get(entry.playerId);
    this.require(player, 'Review player not found.');
    const points = this.quiz.questions[this.clue.questionIndex].fixedPoints;
    this.require(points !== undefined, 'Question points are missing.');
    this.saveScore(player, correct ? points : 0, `${player.name}: ${correct ? 'correct' : entry.answer === null ? 'no answer' : 'wrong'}`);
    entry.correct = correct;
  }

  private advanceReview(fromIndex: number) {
    const next = this.clue.reviewQueue.findIndex((entry, index) => index >= fromIndex && entry.correct === null);
    this.clue.reviewIndex = next < 0 ? this.clue.reviewQueue.length : next;
    this.clue.phase = next < 0 ? 'REVIEW_COMPLETE' : 'REVIEW';
    if (next < 0) this.beginNextRound();
  }

  private startReviewGroup(outcome: 'correct' | 'wrong'): boolean {
    const playerIds = this.clue.reviewQueue.filter((entry) => entry.correct === (outcome === 'correct'))
      .map((entry) => entry.playerId);
    if (!playerIds.length) return false;
    this.clue.phase = 'REVIEW_GROUP';
    this.reviewGroup = { id: randomUUID(), outcome, playerIds,
      points: outcome === 'correct' ? this.quiz.questions[this.clue.questionIndex].fixedPoints! : 0, at: this.now() };
    return true;
  }

  private beginReview() {
    if (!this.startReviewGroup('correct') && !this.startReviewGroup('wrong')) this.advanceReview(0);
  }

  command(command: HostCommand, saveSettings?: (settings: Settings) => void) {
    if (this.processed.has(command.id)) return;
    this.require(command.revision === this.revision, 'Game state changed. Review the latest state and try again.');
    this.require(this.clue.phase !== 'STARTING' || command.action.type === 'restartQuiz', 'Wait for the game-start countdown to finish.');
    this.require(this.clue.phase !== 'NEXT_ROUND' || command.action.type === 'undo' || command.action.type === 'restartQuiz', 'Wait for the next-round transition to finish.');
    this.require(this.clue.phase !== 'BUZZ_RESULT' || ['undo', 'reset', 'restartQuiz'].includes(command.action.type),
      'Wait for the buzzer result before taking that action.');
    this.require(this.clue.phase !== 'MEDIA_FINISH' || ['undo', 'reset', 'restartQuiz', 'restartMedia', 'skipMedia'].includes(command.action.type),
      'Wait for media playback to finish or skip it.');
    this.require(this.clue.phase !== 'REVIEW_GROUP' || ['undo', 'reset', 'restartQuiz'].includes(command.action.type),
      'Wait for the review group before taking that action.');
    const action = command.action;
    switch (action.type) {
      case 'setup':
        this.require(this.clue.phase === 'LOBBY', 'Setup can only change in the lobby.');
        saveSettings?.(action.settings);
        this.settings = action.settings;
        break;
      case 'start':
        this.require(this.clue.phase === 'LOBBY', 'The game has already started.');
        this.clue.phase = 'STARTING';
        this.startCountdownAt = this.now();
        this.countdownId = randomUUID();
        break;
      case 'next':
        this.require(['QUESTION_CLOSED', 'REVIEW_COMPLETE', 'ANSWER_REVEALED'].includes(this.clue.phase), 'Close the current question before advancing.');
        this.require(this.quiz.questions[this.clue.questionIndex]?.mode !== 'typed' || this.clue.phase !== 'QUESTION_CLOSED',
          'Review all answers before advancing.');
        this.beginNextRound();
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
        if (this.quiz.questions[this.clue.questionIndex]?.mode === 'typed'
          && this.clue.reviewQueue.every((entry) => entry.correct !== null)) this.beginReview();
        break;
      case 'reveal':
        this.require(this.clue.phase === 'QUESTION_CLOSED' || this.clue.phase === 'REVIEW_COMPLETE', 'Close the question before revealing its answer.');
        this.require(this.quiz.questions[this.clue.questionIndex]?.mode !== 'typed' || this.clue.phase === 'REVIEW_COMPLETE',
          'Review all answers before revealing the answer.');
        this.clue.phase = 'ANSWER_REVEALED';
        break;
      case 'startReview':
        this.require(['QUESTION_OPEN', 'QUESTION_CLOSED'].includes(this.clue.phase) &&
          this.quiz.questions[this.clue.questionIndex]?.mode === 'typed',
          'Start review from an open or closed typed-answer question.');
        if (this.clue.phase === 'QUESTION_OPEN') this.close();
        this.beginReview();
        break;
      case 'judgeSubmission': {
        this.require(['QUESTION_OPEN', 'QUESTION_CLOSED'].includes(this.clue.phase) && this.quiz.questions[this.clue.questionIndex]?.mode === 'typed',
          'Fast approval is only available on open or closed typed questions before starting review.');
        const entries = this.clue.phase === 'QUESTION_OPEN' ? this.clue.submissions : this.clue.reviewQueue;
        this.judgeTypedAnswer(entries.find((entry) => entry.playerId === action.playerId), action.correct);
        if (this.clue.phase === 'QUESTION_CLOSED' && entries.every((entry) => entry.correct !== null)) this.beginReview();
        break;
      }
      case 'judgeReview': {
        this.require(this.clue.phase === 'REVIEW', 'There is no answer to review.');
        this.judgeTypedAnswer(this.clue.reviewQueue[this.clue.reviewIndex], action.correct);
        this.reviewResultAt = this.now();
        this.reviewResultId = randomUUID();
        break;
      }
      case 'nextReview':
        this.require(this.clue.phase === 'REVIEW', 'There is no answer to advance.');
        this.require(this.clue.reviewQueue[this.clue.reviewIndex]?.correct !== null, 'Judge the current answer before advancing.');
        this.require(false, 'Wait for the review result to advance automatically.');
        break;
      case 'reset':
        this.require(this.clue.questionIndex >= 0 && this.clue.phase !== 'GAME_FINISHED', 'There is no question to reset.');
        this.open(this.clue.questionIndex);
        break;
      case 'restartQuiz':
        this.players.clear();
        this.nextOrder = 0;
        this.leaderboardIds = [];
        this.history = [];
        this.scoreEvents = [];
        this.startCountdownAt = null;
        this.nextRoundAt = null;
        this.countdownId = null;
        this.clearReviewResult();
        this.reviewGroup = null;
        this.buzzResult = null;
        this.clearMediaFinish();
        this.clue = emptyClue();
        break;
      case 'restartMedia':
        this.require(this.clue.phase === 'QUESTION_OPEN' || this.clue.phase === 'MEDIA_FINISH', 'Restart media while the question is open or finishing.');
        this.clue.mediaOffsetSeconds = -this.elapsed() / 1000;
        this.clue.mediaVersion++;
        if (this.clue.phase === 'MEDIA_FINISH') {
          this.mediaFinishElapsedMs = 0;
          this.mediaFinishAt = this.now();
          this.mediaFinishDurationMs = this.remainingPlaybackMs();
        }
        break;
      case 'skipMedia':
        this.require(this.clue.phase === 'MEDIA_FINISH', 'There is no finishing media to skip.');
        this.finishMedia();
        break;
      case 'judge': {
        this.require(this.clue.phase === 'ANSWERING' && this.clue.activePlayerId && this.clue.pointsAtBuzz !== null,
          'No player is currently answering.');
        const player = this.players.get(this.clue.activePlayerId);
        this.require(player, 'Answering player not found.');
        const delta = action.correct ? this.clue.pointsAtBuzz : -this.clue.pointsAtBuzz;
        this.saveScore(player, delta,
          `${player.name}: ${action.correct ? 'correct' : 'wrong'}`);
        const at = this.now();
        if (!action.correct) {
          if (!this.clue.lockedOutIds.includes(player.id)) this.clue.lockedOutIds.push(player.id);
          if (this.settings.lockoutSeconds > 0) {
            this.clue.lockedOutUntil[player.id] = at + BUZZ_RESULT_MS + this.settings.lockoutSeconds * 1000;
          }
        }
        this.buzzResult = { id: randomUUID(), playerId: player.id, correct: action.correct, delta, at };
        this.clue.phase = 'BUZZ_RESULT';
        break;
      }
      case 'adjust': {
        this.require(this.reviewResultAt === null, 'Wait for the review result before adjusting scores.');
        const player = this.players.get(action.playerId);
        this.require(player, 'Player not found.');
        this.saveScore(player, action.delta, `${player.name}: manual adjustment`);
        break;
      }
      case 'undo': {
        const entry = this.history.pop();
        this.require(entry, 'There is no score change to undo for this question.');
        this.nextRoundAt = null;
        this.countdownId = null;
        this.clearReviewResult();
        this.reviewGroup = null;
        this.buzzResult = null;
        this.clearMediaFinish();
        const submissions = this.clue.submissions;
        this.clue = { ...entry.clue, startedAt: entry.clue.startedAt === null ? null : this.now(),
          mediaVersion: this.clue.mediaVersion + 1 };
        if (this.clue.phase === 'QUESTION_OPEN' && this.quiz.questions[this.clue.questionIndex]?.mode === 'typed') {
          const previous = new Map(this.clue.submissions.map((submission) => [submission.playerId, submission]));
          // Retain answers received since the score operation, but restore the
          // saved judgments so undo cannot leave a reverted award marked correct.
          this.clue.submissions = submissions.map((submission) => ({
            ...submission, correct: previous.get(submission.playerId)?.correct ?? null,
          }));
        }
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
        this.require(this.clue.phase !== 'REVIEW' && !(this.clue.phase === 'QUESTION_CLOSED'
          && this.quiz.questions[this.clue.questionIndex]?.mode === 'typed'), 'Remove players after answer review.');
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

  snapshot(host = false, playerId?: string): Snapshot {
    const question = this.quiz.questions[this.clue.questionIndex];
    const elapsed = this.elapsed();
    const now = this.now();
    const displayElapsed = elapsed + this.visualFinishElapsed();
    const finishRemaining = this.mediaFinishAt === null || this.mediaFinishDurationMs === null ? null
      : Math.max(0, this.mediaFinishDurationMs - (now - this.mediaFinishAt));
    const publicQuestion = question ? {
      id: question.id, type: question.type, question: question.question, text: question.text,
      mode: question.mode, fixedPoints: question.fixedPoints, timerSeconds: question.timerSeconds,
      media: question.media, reveal: question.reveal, playback: question.playback, visualizer: question.visualizer,
    } : null;
    return {
      revision: this.revision, quizId: this.quiz.id, settings: { ...this.settings }, phase: this.clue.phase,
      startCountdownMs: this.startCountdownAt === null ? null
        : Math.max(0, START_COUNTDOWN_MS - (now - this.startCountdownAt)),
      nextRoundCountdownMs: this.nextRoundAt === null ? null
        : Math.max(0, NEXT_ROUND_MS - (now - this.nextRoundAt)),
      countdownId: this.countdownId,
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
        .filter(([, until]) => until > now).map(([id, until]) => [id, until - now -
          (this.buzzResult?.playerId === id && !this.buzzResult.correct
            ? Math.max(0, this.buzzResult.at + BUZZ_RESULT_MS - now) : 0)])),
      activePlayerId: this.clue.activePlayerId, pointsAtBuzz: this.clue.pointsAtBuzz,
      currentPoints: question?.mode === 'typed' ? question.fixedPoints ?? 0 : this.clue.pointsAtBuzz ?? pointsAt(elapsed, this.settings),
      clueElapsedMs: elapsed, clockRunning: this.clue.startedAt !== null, paused: this.clue.paused,
      displayElapsedMs: displayElapsed,
      displayClockRunning: this.clue.startedAt !== null || (this.mediaFinishAt !== null && (finishRemaining === null || finishRemaining > 0)),
      mediaFinishRemainingMs: finishRemaining,
      mediaFinishNeedsSkip: this.clue.phase === 'MEDIA_FINISH' && this.mediaFinishDurationMs === null,
      revealProgress: Math.min(1, Math.max(0, displayElapsed / 1000 + this.clue.mediaOffsetSeconds) / (question?.reveal?.durationSeconds ?? 20)),
      mediaPositionSeconds: (question?.playback?.startSeconds ?? 0) + Math.max(0, displayElapsed / 1000 + this.clue.mediaOffsetSeconds),
      mediaVersion: this.clue.mediaVersion,
      canUndo: host && this.history.length > 0,
      scoreEvents: host ? structuredClone(this.scoreEvents) : [],
      questionInstanceId: this.clue.questionInstanceId,
      submissionCount: this.clue.submissions.length,
      mySubmitted: !!playerId && this.clue.submissions.some((entry) => entry.playerId === playerId),
      buzzResult: this.buzzResult === null ? null : {
        id: this.buzzResult.id, playerId: this.buzzResult.playerId, correct: this.buzzResult.correct,
        delta: this.buzzResult.delta, remainingMs: Math.max(0, BUZZ_RESULT_MS - (now - this.buzzResult.at)),
      },
      reviewGroup: this.reviewGroup === null ? null : {
        id: this.reviewGroup.id, outcome: this.reviewGroup.outcome, playerIds: [...this.reviewGroup.playerIds],
        points: this.reviewGroup.points, remainingMs: Math.max(0, REVIEW_GROUP_MS - (now - this.reviewGroup.at)),
      },
      review: this.clue.phase === 'REVIEW' ? structuredClone(this.clue.reviewQueue[this.clue.reviewIndex]) : null,
      reviewResultId: this.reviewResultId,
      reviewRemainingMs: this.reviewResultAt === null ? null : Math.max(0, REVIEW_RESULT_MS - (now - this.reviewResultAt)),
      reviewIndex: this.clue.reviewIndex,
      reviewCount: this.clue.reviewQueue.length,
      ...(host ? { hostSubmissions: structuredClone(this.clue.reviewQueue.length ? this.clue.reviewQueue : this.clue.submissions) } : {}),
    };
  }
}
