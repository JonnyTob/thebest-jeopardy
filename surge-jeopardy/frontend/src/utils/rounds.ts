import type { Board, GameState, Round } from '@shared/types';

export function getRound(board: Board, gameState: GameState): Round {
  return board.rounds[gameState.currentRoundIndex] ?? board.rounds[0];
}

export function isRoundComplete(board: Board, answeredQuestions: string[], roundIndex: number): boolean {
  const round = board.rounds[roundIndex];
  if (!round) return true;
  const answered = new Set(answeredQuestions);
  return round.categories.every(c => c.questions.every(q => answered.has(q.id)));
}
