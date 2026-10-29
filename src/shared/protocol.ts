import { z } from 'zod';

export const avatars = ['fox', 'cat', 'bear', 'panda', 'frog', 'owl'] as const;
export type AvatarId = typeof avatars[number];

const localMedia = z.string().regex(/^\/media\/[a-zA-Z0-9_./-]+$/).refine(
  (path) => !path.includes('..'), 'Media must stay inside /media/',
);
const revealDefinitionSchema = z.strictObject({
  effect: z.enum(['static', 'tiles']),
  durationSeconds: z.number().positive().max(600),
  columns: z.number().int().min(1).max(20),
  rows: z.number().int().min(1).max(20),
  seed: z.number().int().min(0).max(2147483647),
}).partial();
const revealSchema = z.strictObject({
  effect: revealDefinitionSchema.shape.effect.unwrap().default('static'),
  durationSeconds: revealDefinitionSchema.shape.durationSeconds.unwrap().default(20),
  columns: revealDefinitionSchema.shape.columns.unwrap().default(8),
  rows: revealDefinitionSchema.shape.rows.unwrap().default(6),
  seed: revealDefinitionSchema.shape.seed.unwrap().default(814),
});
const playbackDefinitionSchema = z.strictObject({
  startSeconds: z.number().min(0).optional(),
  endSeconds: z.number().positive().optional(),
}).refine((p) => p.endSeconds === undefined || p.endSeconds > (p.startSeconds ?? 0),
  { message: 'Playback end must be after start', path: ['endSeconds'] });

export const questionDefinitionSchema = z.strictObject({
  id: z.string().min(1).max(80),
  keyword: z.string().trim().min(1).max(80).optional(),
  type: z.enum(['text', 'image', 'video', 'audio']),
  question: z.string().trim().min(1).max(500),
  mode: z.enum(['buzzer', 'typed'], { error: 'Question mode is required and must be "buzzer" or "typed".' }),
  fixedPoints: z.number().int().min(1).max(10000).optional(),
  timerSeconds: z.number().int().min(1).max(3600).optional(),
  text: z.string().max(2000).optional(),
  media: localMedia.optional(),
  answer: z.string().trim().min(1).max(2000),
  reveal: revealDefinitionSchema.optional(),
  visualizer: z.strictObject({
    enabled: z.boolean(),
    style: z.literal('spectrum'),
  }).optional(),
  playback: playbackDefinitionSchema.optional(),
}).superRefine((question, context) => {
  if (question.type !== 'text' && !question.media) {
    context.addIssue({ code: 'custom', path: ['media'], message: 'Media clues require a local media path' });
  }
  for (const field of ['fixedPoints'] as const) {
    if (question.mode === 'typed' && question[field] === undefined) {
      context.addIssue({ code: 'custom', path: [field], message: `Typed questions require ${field}` });
    }
    if (question.mode === 'buzzer' && question[field] !== undefined) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} is only allowed for typed questions` });
    }
  }
  if (question.type !== 'text' && question.text !== undefined) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'text is only allowed for text questions' });
  }
  if (question.type === 'text' && question.media !== undefined) {
    context.addIssue({ code: 'custom', path: ['media'], message: 'media is only allowed for image, audio and video questions' });
  }
  if (question.type !== 'image' && question.reveal !== undefined) {
    context.addIssue({ code: 'custom', path: ['reveal'], message: 'reveal is only allowed for image questions' });
  }
  if (question.type !== 'audio' && question.visualizer !== undefined) {
    context.addIssue({ code: 'custom', path: ['visualizer'], message: 'visualizer is only allowed for audio questions' });
  }
  if (question.type !== 'audio' && question.type !== 'video' && question.playback !== undefined) {
    context.addIssue({ code: 'custom', path: ['playback'], message: 'playback is only allowed for audio and video questions' });
  }
});
export const questionSchema = questionDefinitionSchema.transform(({ reveal, playback, ...question }) => ({
  ...question,
  ...(reveal !== undefined ? { reveal: revealSchema.parse(reveal) } : {}),
  ...(playback !== undefined ? { playback: { ...playback, startSeconds: playback.startSeconds ?? 0 } } : {}),
}));
export type Question = z.infer<typeof questionSchema>;
export type PublicQuestion = Omit<Question, 'answer'>;
export const quizSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(100),
  coverImage: localMedia.optional(),
  questions: z.array(questionSchema).min(1).max(500),
}).refine((quiz) => new Set(quiz.questions.map((q) => q.id)).size === quiz.questions.length,
  'Question IDs must be unique');
export type Quiz = z.infer<typeof quizSchema>;

export const settingsSchema = z.object({
  title: z.string().trim().min(1).max(100),
  leaderboardCount: z.number().int().min(1).max(12),
  startPoints: z.number().int().min(1).max(10000),
  minimumPoints: z.number().int().min(1).max(10000),
  dropPoints: z.number().int().min(1).max(10000),
  dropEverySeconds: z.number().min(1).max(120),
  questionTimerSeconds: z.number().int().min(1).max(3600).default(30),
  lockoutSeconds: z.number().int().min(0).max(300).default(0),
  maxAnswerLength: z.number().int().min(1).max(500).default(100),
}).refine((s) => s.minimumPoints <= s.startPoints,
  'Minimum points cannot exceed starting points');
export type Settings = z.infer<typeof settingsSchema>;
export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(100).default('Kaboot'),
  logoText: z.string().trim().min(1).max(4).default('K'),
  tagline: z.string().trim().max(160).default('Buzz in. Get booted.'),
}).strict();
export type Branding = z.infer<typeof brandingSchema>;
export const serverSettingsSchema = z.object({
  maxPlayerNameLength: z.number().int().min(1).max(100).default(24),
  requireAdminPasscode: z.boolean().default(true),
  maxPlayers: z.number().int().min(1).max(1000).default(12),
  typedAnswerGraceSeconds: z.number().int().min(0).max(300).default(0),
  countdownSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Countdown sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
  reviewCorrectSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Review correct sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
  reviewWrongSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Review wrong sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
}).strict();
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
export type Phase = 'LOBBY' | 'STARTING' | 'NEXT_ROUND' | 'QUESTION_OPEN' | 'ANSWERING' | 'BUZZ_RESULT' | 'MEDIA_FINISH' | 'QUESTION_CLOSED' | 'REVIEW_GROUP' | 'REVIEW' | 'REVIEW_COMPLETE' | 'ANSWER_REVEALED' | 'GAME_FINISHED';
export interface BuzzResult {
  id: string;
  playerId: string;
  correct: boolean;
  delta: number;
  /** Server-calculated time until automatic transition; zero until the next tick. */
  remainingMs: number;
}
export interface TypedReview {
  playerId: string;
  answer: string | null;
  correct: boolean | null;
}
/** A previously judged group, without individual answers or future groups. */
export interface ReviewGroup {
  id: string;
  outcome: 'correct' | 'wrong';
  playerIds: string[];
  points: number;
  /** Server-calculated time until automatic advancement; zero until the next tick. */
  remainingMs: number;
}
export interface Player {
  id: string;
  name: string;
  avatarId: AvatarId;
  score: number;
  connected: boolean;
  joinedOrder: number;
}
export interface ScoreEvent {
  id: string;
  description: string;
  playerId: string;
  delta: number;
}
export interface Snapshot {
  revision: number;
  quizId: number;
  coverImage: string | null;
  settings: Settings;
  serverSettings: ServerSettings;
  phase: Phase;
  startCountdownMs: number | null;
  nextRoundCountdownMs: number | null;
  countdownId: string | null;
  questionIndex: number;
  questionCount: number;
  question: PublicQuestion | null;
  revealedAnswer: string | null;
  privateAnswer?: string;
  players: Player[];
  leaderboardIds: string[];
  lockedOutIds: string[];
  lockoutRemainingMs: Record<string, number>;
  activePlayerId: string | null;
  pointsAtBuzz: number | null;
  currentPoints: number;
  clueElapsedMs: number;
  clockRunning: boolean;
  paused: boolean;
  /** Visual clock includes post-ruling playback; the scoring clock remains frozen. */
  displayElapsedMs: number;
  displayClockRunning: boolean;
  /** Null outside MEDIA_FINISH or when its duration is unknown. */
  mediaFinishRemainingMs: number | null;
  mediaFinishNeedsSkip: boolean;
  revealProgress: number;
  mediaPositionSeconds: number;
  mediaVersion: number;
  canUndo: boolean;
  scoreEvents: ScoreEvent[];
  questionInstanceId: string | null;
  submissionCount: number;
  mySubmitted: boolean;
  /** Public buzzer ruling, present only during BUZZ_RESULT. */
  buzzResult: BuzzResult | null;
  /** Current previously judged group, present only during REVIEW_GROUP. */
  reviewGroup: ReviewGroup | null;
  review: TypedReview | null;
  /** Unique to each public judgment; null outside its result hold. */
  reviewResultId: string | null;
  /** Server-calculated time until automatic advancement; zero until the next tick. */
  reviewRemainingMs: number | null;
  reviewIndex: number;
  reviewCount: number;
  hostSubmissions?: TypedReview[];
}

export function createJoinSchema(maxPlayerNameLength: number) {
  return z.object({
    name: z.string().trim().min(1).max(maxPlayerNameLength),
    avatarId: z.enum(avatars),
  });
}
export const joinSchema = createJoinSchema(serverSettingsSchema.parse({}).maxPlayerNameLength);
export type JoinRequest = z.infer<typeof joinSchema>;
export const hostCommandSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.enum(['start', 'pause', 'resume', 'close', 'reveal', 'next', 'reset', 'restartQuiz', 'restartMedia', 'skipMedia', 'undo', 'startReview', 'nextReview']) }),
    z.object({ type: z.literal('judge'), correct: z.boolean() }),
    z.object({ type: z.literal('judgeReview'), correct: z.boolean() }),
    z.object({ type: z.literal('judgeSubmission'), playerId: z.string().uuid(), correct: z.boolean() }),
    z.object({ type: z.literal('adjust'), playerId: z.string(), delta: z.number().int().min(-100000).max(100000).refine((v) => v !== 0) }),
    z.object({ type: z.literal('removePlayer'), playerId: z.string() }),
    z.object({ type: z.literal('setup'), settings: settingsSchema }),
  ]),
});
export type HostCommand = z.infer<typeof hostCommandSchema>;
export type HostAction = HostCommand['action'];
export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T = undefined> = (result: Result<T>) => void;
export interface ClientEvents {
  'player:join': (request: JoinRequest, ack: Ack<{ token: string; playerId: string }>) => void;
  'player:buzz': (ack: Ack) => void;
  'player:submitAnswer': (request: { questionInstanceId: string; answer: string }, ack: Ack) => void;
  'host:command': (command: HostCommand, ack: Ack) => void;
}
export interface ServerEvents {
  'session:snapshot': (snapshot: Snapshot) => void;
  'player:identity': (identity: { playerId: string | null }) => void;
  'session:error': (message: string) => void;
}
