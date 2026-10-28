import { z } from 'zod';

export const avatars = ['fox', 'cat', 'bear', 'panda', 'frog', 'owl'] as const;
export type AvatarId = typeof avatars[number];

const localMedia = z.string().regex(/^\/media\/[a-zA-Z0-9_./-]+$/).refine(
  (path) => !path.includes('..'), 'Media must stay inside /media/',
);
const revealSchema = z.object({
  effect: z.enum(['static', 'tiles']).default('static'),
  durationSeconds: z.number().positive().max(600).default(20),
  columns: z.number().int().min(1).max(20).default(8),
  rows: z.number().int().min(1).max(20).default(6),
  seed: z.number().int().min(0).max(2147483647).default(814),
});

export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(['text', 'image', 'video', 'audio']),
  question: z.string().trim().min(1).max(500),
  mode: z.enum(['buzzer', 'typed']).optional(),
  fixedPoints: z.number().int().min(1).max(10000).optional(),
  timerSeconds: z.number().int().min(1).max(3600).optional(),
  text: z.string().max(2000).optional(),
  media: localMedia.optional(),
  answer: z.string().trim().min(1).max(2000),
  reveal: revealSchema.optional(),
  visualizer: z.object({
    enabled: z.boolean(),
    style: z.literal('spectrum'),
  }).optional(),
  playback: z.object({
    startSeconds: z.number().min(0).default(0),
    endSeconds: z.number().positive().optional(),
  }).refine((p) => p.endSeconds === undefined || p.endSeconds > p.startSeconds,
    'Playback end must be after start').optional(),
}).superRefine((question, context) => {
  if (question.type !== 'text' && !question.media) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Media clues require a local media path' });
  }
  if (question.mode === 'typed' && (question.fixedPoints === undefined || question.timerSeconds === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Typed questions require fixedPoints and timerSeconds' });
  }
});
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
  TimerEndOffsetSeconds: z.number().int().min(0).max(300).default(0),
  countdownSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Countdown sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
  reviewCorrectSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Review correct sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
  reviewWrongSound: localMedia.refine((value) => /\.wav$/i.test(value), 'Review wrong sound must be a WAV file')
    .nullable().default('/media/sounds/countdown-beep.wav'),
}).strict();
export type ServerSettings = z.infer<typeof serverSettingsSchema>;
export type Phase = 'LOBBY' | 'STARTING' | 'NEXT_ROUND' | 'QUESTION_OPEN' | 'ANSWERING' | 'BUZZ_RESULT' | 'MEDIA_FINISH' | 'QUESTION_CLOSED' | 'REVIEW' | 'REVIEW_COMPLETE' | 'ANSWER_REVEALED' | 'GAME_FINISHED';
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
