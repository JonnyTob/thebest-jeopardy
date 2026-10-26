import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import type { Board, Round } from '../types.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const BOARDS_DIR = path.join(DATA_DIR, 'boards');

async function ensureDir() {
  await fs.mkdir(BOARDS_DIR, { recursive: true });
}

// Migrates a legacy single-round board (top-level categories/pointValues) into
// the rounds[] shape. Idempotent — a board that already has rounds passes through.
export function normalizeBoard(raw: any): Board {
  if (Array.isArray(raw.rounds)) {
    const { categories, pointValues, ...rest } = raw;
    return rest as Board;
  }
  const round: Round = {
    id: uuidv4(),
    name: 'Jeopardy!',
    categories: raw.categories ?? [],
    pointValues: raw.pointValues ?? [200, 400, 600, 800, 1000],
  };
  const { categories, pointValues, ...rest } = raw;
  return { ...rest, rounds: [round] } as Board;
}

export function isRoundComplete(board: Board, answeredQuestions: string[], roundIndex: number): boolean {
  const round = board.rounds[roundIndex];
  if (!round) return true;
  const answered = new Set(answeredQuestions);
  return round.categories.every(c => c.questions.every(q => answered.has(q.id)));
}

export async function listBoards(): Promise<{ id: string; name: string; roundCount: number; hasFinal: boolean; createdAt: string; updatedAt: string }[]> {
  await ensureDir();
  const files = await fs.readdir(BOARDS_DIR).catch(() => [] as string[]);
  const boards: { id: string; name: string; roundCount: number; hasFinal: boolean; createdAt: string; updatedAt: string }[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(BOARDS_DIR, file), 'utf-8');
      const board = normalizeBoard(JSON.parse(raw));
      boards.push({
        id: board.id,
        name: board.name,
        roundCount: board.rounds.length,
        hasFinal: !!board.finalJeopardy,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      });
    } catch {}
  }
  return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBoard(id: string): Promise<Board | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(BOARDS_DIR, `${id}.json`), 'utf-8');
    return normalizeBoard(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function createBoard(data: Partial<Board> & { categories?: any; pointValues?: any }): Promise<Board> {
  await ensureDir();
  const now = new Date().toISOString();
  const normalized = normalizeBoard({ ...data, id: undefined });
  const board: Board = {
    id: uuidv4(),
    name: data.name ?? 'New Board',
    rounds: normalized.rounds?.length ? normalized.rounds : [{ id: uuidv4(), name: 'Jeopardy!', categories: [], pointValues: [200, 400, 600, 800, 1000] }],
    createdAt: now,
    updatedAt: now,
    finalJeopardy: data.finalJeopardy,
  };
  await fs.writeFile(path.join(BOARDS_DIR, `${board.id}.json`), JSON.stringify(board, null, 2));
  return board;
}

export async function updateBoard(id: string, data: Partial<Board> & { categories?: any; pointValues?: any }): Promise<Board | null> {
  const existing = await getBoard(id);
  if (!existing) return null;
  const merged = normalizeBoard({ ...existing, ...data, id });
  const updated: Board = { ...merged, id, updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(BOARDS_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

export async function deleteBoard(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(BOARDS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
