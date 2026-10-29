import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { QuizSettingsStorage } from './settings.js';
import { settingsSchema, type Settings } from '../shared/protocol.js';
import { readFile } from 'node:fs/promises';
import { quizSchema, type Quiz } from '../shared/protocol.js';
import { quizArchiveSchema, toRuntimeQuiz, type QuizArchive } from '../shared/quizArchive.js';

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

  parseArchive(data: unknown): QuizArchive {
    const archive = quizArchiveSchema.parse(data);
    if (archive.quiz.id !== this.quizId) throw new Error(`Quiz ID does not match directory: ${this.file}`);
    return archive;
  }

  async load(): Promise<Quiz> {
    return toRuntimeQuiz(this.parseArchive(JSON.parse(await readFile(this.file, 'utf8'))));
  }
}

export class ArchiveQuizSettingsStorage implements QuizSettingsStorage {
  constructor(private readonly storage: ArchiveQuizStorage) {}
  load(quizId: number): Partial<Settings> {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const data = this.storage.parseArchive(JSON.parse(readFileSync(this.storage.file, 'utf8')));
    return data.gameSetup ?? {};
  }
  save(quizId: number, settings: Settings): void {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const data = this.storage.parseArchive(JSON.parse(readFileSync(this.storage.file, 'utf8')));
    const { title, ...gameSetup } = settingsSchema.parse(settings);
    data.quiz.title = title;
    data.gameSetup = gameSetup;
    const archive = this.storage.parseArchive(data);
    const temporary = `${this.storage.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(archive, null, 2) + '\n', { flag: 'wx' });
      renameSync(temporary, this.storage.file);
    } finally { rmSync(temporary, { force: true }); }
  }
}
