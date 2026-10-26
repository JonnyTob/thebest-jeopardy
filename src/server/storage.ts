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
