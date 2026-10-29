import path from 'node:path';
import { z } from 'zod';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { archiveGameSetupSchema, type QuizSettingsStorage } from './settings.js';
import { settingsSchema, type Settings } from '../shared/protocol.js';
import { readFile } from 'node:fs/promises';
import { quizSchema, type Quiz } from '../shared/protocol.js';

export interface QuizStorage {
  load(): Promise<Quiz>;
}

export class JsonQuizStorage implements QuizStorage {
  constructor(private readonly path: string) {}

  async load(): Promise<Quiz> {
    return quizSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
  }
}

// A quiz archive keeps its private JSON and its public media in separate paths.
export class ArchiveQuizStorage implements QuizStorage {
  readonly mediaRoot: string;
  readonly file: string;
  constructor(directory: string, readonly quizId: number) {
    if (!Number.isSafeInteger(quizId) || quizId < 1) throw new Error('QUIZ_ID must be a positive safe integer.');
    this.file = path.join(directory, String(quizId), 'quiz.json');
    this.mediaRoot = path.join(directory, String(quizId), 'media');
  }

  async load(): Promise<Quiz> {
    const data = JSON.parse(await readFile(this.file, 'utf8'));
    const archive = z.object({
      quiz: z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), title: z.string(), coverImage: z.unknown().optional() }).strict(),
      gameSetup: archiveGameSetupSchema.optional(),
      questions: z.array(z.object({ id: z.uuid(), keyword: z.string().trim().min(1).max(80).optional() }).passthrough()),
    }).strict().parse(data);
    if (archive.quiz.id !== this.quizId) throw new Error(`Quiz ID does not match directory: ${this.file}`);
    const convert = (value: unknown) => {
      if (typeof value !== 'string' || !/^media\/[a-zA-Z0-9_./-]+$/.test(value) || value.includes('..')) {
        throw new Error(`Invalid quiz media path in ${this.file}`);
      }
      return '/media/quiz/' + value.slice('media/'.length);
    };
    const questions = archive.questions.map((q) => ({ ...q, id: q.id.toLowerCase(),
      ...(q.media !== undefined ? { media: convert(q.media) } : {}) }));
    return quizSchema.parse({ ...archive.quiz,
      ...(archive.quiz.coverImage !== undefined ? { coverImage: convert(archive.quiz.coverImage) } : {}), questions });
  }
}

export class ArchiveQuizSettingsStorage implements QuizSettingsStorage {
  constructor(private readonly storage: ArchiveQuizStorage) {}
  load(quizId: number): Partial<Settings> {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const data = JSON.parse(readFileSync(this.storage.file, 'utf8'));
    return archiveGameSetupSchema.parse(data.gameSetup ?? {});
  }
  save(quizId: number, settings: Settings): void {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const data = JSON.parse(readFileSync(this.storage.file, 'utf8'));
    const { title, ...gameSetup } = settingsSchema.parse(settings);
    data.quiz.title = title;
    data.gameSetup = gameSetup;
    const temporary = `${this.storage.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      renameSync(temporary, this.storage.file);
    } finally { rmSync(temporary, { force: true }); }
  }
}
