import type { BuzzEntry, Player, Question } from '@shared/types';
import { PERMANENT_LOCKOUT } from '@shared/types';

export default function ActiveQuestionPanel({
  activeQ,
  responseVisible,
  buzzerState,
  buzzWinner,
  buzzWinnerId,
  players,
  buzzLockouts,
  buzzQueue,
  buzzedPlayerId,
  onShowAnswer,
  onEnableBuzzer,
  onLockBuzzer,
  onResetBuzzer,
  onAward,
  onMarkWrong,
  onClose,
}: {
  activeQ: Question;
  responseVisible: boolean;
  buzzerState: 'idle' | 'open' | 'locked';
  buzzWinner: string | null;
  buzzWinnerId: string | null;
  players: Player[];
  buzzLockouts: Record<string, number>;
  buzzQueue: BuzzEntry[];
  buzzedPlayerId: string | null;
  onShowAnswer: () => void;
  onEnableBuzzer: () => void;
  onLockBuzzer: () => void;
  onResetBuzzer: () => void;
  onAward: (playerId: string, correct: boolean) => void;
  onMarkWrong: (playerId: string) => void;
  onClose: () => void;
}) {
  const lockedOut = players.filter(p => buzzLockouts[p.id] === PERMANENT_LOCKOUT);

  return (
    <div className="space-y-3">
      <div className="text-jeopardy-gold font-black text-xl">${activeQ.value}</div>

      <div className="bg-gray-800 rounded p-3 text-sm text-white leading-relaxed">{activeQ.clue}</div>

      {/* Answer always visible to host */}
      <div className="bg-green-950 border border-green-700 rounded p-3 text-sm text-green-300">
        <div className="text-[10px] text-gray-500 uppercase mb-1">Answer</div>
        {activeQ.response}
      </div>

      {/* Show on board button — only relevant until revealed */}
      {!responseVisible && (
        <button className="btn-ghost text-sm w-full" onClick={onShowAnswer}>Show Answer on Board</button>
      )}

      {/* Buzzer controls */}
      <div className="space-y-2">
        {buzzerState === 'idle' && (
          <button className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded transition-colors" onClick={onEnableBuzzer}>
            🔔 Open Buzzers
          </button>
        )}
        {buzzerState === 'open' && (
          <button className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 rounded transition-colors" onClick={onLockBuzzer}>
            🔒 Lock Buzzers
          </button>
        )}
        {buzzerState === 'locked' && buzzWinner && (
          <div className="bg-jeopardy-blue border-2 border-jeopardy-gold rounded p-3 text-center">
            <div className="text-gray-300 text-sm">Buzzed In:</div>
            <div className="text-jeopardy-gold font-black text-lg">{buzzWinner}</div>
            <div className="flex gap-2 mt-2">
              <button
                className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-1 rounded text-sm"
                onClick={() => {
                  if (buzzWinnerId) onAward(buzzWinnerId, true);
                }}
              >✓ Correct</button>
              <button
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-1 rounded text-sm"
                onClick={() => {
                  if (buzzWinnerId) onMarkWrong(buzzWinnerId);
                }}
              >✗ Wrong</button>
              <button className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-1 px-2 rounded text-sm" onClick={onResetBuzzer}>↺</button>
            </div>
          </div>
        )}
        {buzzerState === 'locked' && !buzzWinner && (
          <button className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded transition-colors" onClick={onResetBuzzer}>
            🔔 Re-open Buzzers
          </button>
        )}
      </div>

      {lockedOut.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-gray-500 uppercase mb-1">Ineligible this question</div>
          <div className="flex flex-wrap gap-1">
            {lockedOut.map(p => (
              <span key={p.id} className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {buzzQueue && buzzQueue.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] text-gray-500 uppercase mb-1">Buzz Queue</div>
          <div className="space-y-1">
            {buzzQueue.map((entry, i) => (
              <div
                key={entry.playerId}
                className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                  entry.attemptedAnswer
                    ? 'bg-gray-800 text-gray-500 line-through'
                    : buzzedPlayerId === entry.playerId
                    ? 'bg-blue-900 text-white font-bold'
                    : 'bg-gray-800 text-gray-300'
                }`}
              >
                <span className="text-gray-500 w-4">{i + 1}.</span>
                <span className="flex-1">{entry.playerName}</span>
                <span className="text-gray-500 tabular-nums">{entry.reactionMs}ms</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="btn-danger text-sm w-full" onClick={onClose}>Close Question</button>
    </div>
  );
}
