import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { brandingSchema, serverSettingsSchema, settingsSchema, type Settings } from '../shared/protocol.js';
import { gameSetupOverridesSchema } from '../shared/quizArchive.js';

const serverSchema = z.object({
  ...serverSettingsSchema.shape,
  port: z.number().int().min(1).max(65535),
  joinOrigin: z.string().optional(),
  startupQuizId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(100001),
}).strict();

const { title: _title, ...gameSetupShape } = settingsSchema.shape;

const globalSettingsSchema = z.object({
  branding: brandingSchema,
  server: serverSchema,
  gameSetup: z.object({ ...gameSetupShape,
    questionTimerSeconds: settingsSchema.shape.questionTimerSeconds.removeDefault().optional(),
    pointDecayDelaySeconds: settingsSchema.shape.pointDecayDelaySeconds.removeDefault().optional(),
  }).strict(),
}).strict();

export function loadGlobalSettings(file: string, env: NodeJS.ProcessEnv = process.env) {
  try {
    const settings = globalSettingsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    settingsSchema.parse({ title: 'Quiz', ...settings.gameSetup });
    const server = serverSchema.parse({
      ...settings.server,
      ...(env.PORT !== undefined ? { port: Number(env.PORT) } : {}),
      ...(env.JOIN_ORIGIN !== undefined ? { joinOrigin: env.JOIN_ORIGIN } : {}),
      ...(env.QUIZ_ID !== undefined ? { startupQuizId: Number(env.QUIZ_ID) } : {}),
    });
    return { ...settings, server };
  } catch (cause) {
    throw new Error(`Unable to load global settings from ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

export interface QuizSettingsStorage {
  load(quizId: number): Partial<Settings>;
  save(quizId: number, settings: Settings): void;
}

export class JsonQuizSettingsStorage implements QuizSettingsStorage {
  constructor(private readonly directory: string) {}

  private file(quizId: number) {
    return path.join(this.directory, `${z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(quizId)}.json`);
  }

  load(quizId: number): Partial<Settings> {
    const file = this.file(quizId);
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return {};
      throw new Error(`Unable to read quiz settings from ${file}`, { cause });
    }
    try {
      return z.object({ gameSetup: gameSetupOverridesSchema }).strict().parse(JSON.parse(content)).gameSetup;
    } catch (cause) {
      throw new Error(`Invalid quiz settings in ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }

  save(quizId: number, settings: Settings): void {
    const file = this.file(quizId);
    const content = JSON.stringify({ gameSetup: settingsSchema.parse(settings) }, null, 2) + '\n';
    mkdirSync(this.directory, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, content, { flag: 'wx' });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
