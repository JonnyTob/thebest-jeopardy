import path from 'node:path';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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

  readArchive(): { archive: QuizArchive; revision: string } {
    const bytes = readFileSync(this.file);
    return { archive: this.parseArchive(JSON.parse(bytes.toString('utf8'))),
      revision: createHash('sha256').update(bytes).digest('hex') };
  }

  saveArchive(data: unknown, revision: string): string {
    const archive = this.parseArchive(data);
    if (this.readArchive().revision !== revision) throw new ArchiveConflictError();
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const contents = JSON.stringify(archive, null, 2) + '\n';
    try {
      writeFileSync(temporary, contents, { flag: 'wx' });
      renameSync(temporary, this.file);
    } finally { rmSync(temporary, { force: true }); }
    return createHash('sha256').update(contents).digest('hex');
  }
}

export class ArchiveConflictError extends Error {
  constructor() { super('The quiz file changed. Reload before saving; your unsaved edits have not been saved.'); }
}

export class ArchiveQuizSettingsStorage implements QuizSettingsStorage {
  private revision: string | undefined;
  constructor(private readonly storage: ArchiveQuizStorage) {}
  load(quizId: number): Partial<Settings> {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const { archive, revision } = this.storage.readArchive();
    this.revision = revision;
    return archive.gameSetup ?? {};
  }
  save(quizId: number, settings: Settings): void {
    if (quizId !== this.storage.quizId) throw new Error('Quiz ID mismatch');
    const { archive: data } = this.storage.readArchive();
    const { title, ...gameSetup } = settingsSchema.parse(settings);
    data.quiz.title = title;
    data.gameSetup = gameSetup;
    if (!this.revision) throw new Error('Quiz settings were not loaded.');
    this.revision = this.storage.saveArchive(data, this.revision);
  }
}
