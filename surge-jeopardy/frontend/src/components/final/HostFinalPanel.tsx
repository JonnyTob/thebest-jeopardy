import { useEffect, useState } from 'react';
import { socket } from '../../socket';
import type { Board, GameState } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { useCountdown } from './useCountdown';

interface HostState {
  wagers: Record<string, number>;
  answers: Record<string, string>;
  drafts: Record<string, string>;
}

export default function HostFinalPanel({ roomCode, gameState, board }: { roomCode: string; gameState: GameState; board: Board }) {
  const fj = gameState.finalJeopardy!;
  const [hostState, setHostState] = useState<HostState>({ wagers: {}, answers: {}, drafts: {} });
  const [overridePlayerId, setOverridePlayerId] = useState<string | null>(null);
  const [overrideWager, setOverrideWager] = useState('');
  const [overrideAnswer, setOverrideAnswer] = useState('');
  const remainingMs = useCountdown(fj.deadline, fj.serverNow, 'second');

  useEffect(() => {
    socket.on(SOCKET_EVENTS.FJ_HOST_STATE, (s: HostState) => setHostState(s));
    return () => { socket.off('fj:host-state'); };
  }, []);

  const currentContestantId = fj.contestants[fj.revealIndex]?.playerId ?? null;
  const currentContestant = fj.contestants.find(c => c.playerId === currentContestantId) ?? null;
  const isLast = fj.revealIndex >= fj.contestants.length - 1;

  function applyOverride(playerId: string) {
    const wager = overrideWager.trim() !== '' ? Number(overrideWager) : undefined;
    const answer = overrideAnswer.trim() !== '' ? overrideAnswer : undefined;
    socket.emit(SOCKET_EVENTS.HOST_FJ_SET_FOR_PLAYER, { roomCode, playerId, wager, answer });
    setOverridePlayerId(null);
    setOverrideWager('');
    setOverrideAnswer('');
  }

  return (
    <div className="space-y-3">
      <div className="text-jeopardy-gold font-black text-lg">⚡ Final Jeopardy</div>
      <div className="text-xs text-gray-500 uppercase">{fj.stage}</div>

      {board.finalJeopardy && (
        <div className="bg-green-950 border border-green-700 rounded p-3 text-sm text-green-300">
          <div className="text-[10px] text-gray-500 uppercase mb-1">Correct Response</div>
          {board.finalJeopardy.response}
        </div>
      )}

      {fj.stage === 'answering' && remainingMs != null && (
        <div className="text-center text-3xl font-black text-jeopardy-gold tabular-nums">
          {Math.ceil(remainingMs / 1000)}s
        </div>
      )}

      {/* Contestant table */}
      <div className="space-y-1">
        {fj.contestants.map(c => {
          const wager = hostState.wagers[c.playerId];
          const answer = hostState.answers[c.playerId];
          const draft = hostState.drafts[c.playerId];
          const isCurrent = c.playerId === currentContestantId && fj.stage === 'reveal';
          return (
            <div key={c.playerId} className={`bg-gray-800 rounded p-2 text-xs ${isCurrent ? 'ring-2 ring-jeopardy-gold' : ''}`}>
              <div className="flex justify-between items-center">
                <span className="font-bold">{c.playerName}</span>
                <span className="text-gray-500">max ${c.maxWager}</span>
              </div>
              <div className="text-gray-400 mt-1">
                Wager: <span className="text-white">{wager !== undefined ? `$${wager}` : '—'}</span>
              </div>
              <div className="text-gray-400 truncate">
                Answer: <span className="text-white">{answer || (draft ? `(typing) ${draft}` : '—')}</span>
              </div>
              {overridePlayerId === c.playerId ? (
                <div className="flex gap-1 mt-1">
                  <input className="input-field text-xs py-0.5 w-16" placeholder="wager" value={overrideWager} onChange={e => setOverrideWager(e.target.value)} />
                  <input className="input-field text-xs py-0.5 flex-1" placeholder="answer" value={overrideAnswer} onChange={e => setOverrideAnswer(e.target.value)} />
                  <button className="text-xs bg-jeopardy-gold text-jeopardy-dark px-2 rounded" onClick={() => applyOverride(c.playerId)}>Set</button>
                </div>
              ) : (
                <button className="text-[10px] text-gray-500 hover:text-white mt-1" onClick={() => setOverridePlayerId(c.playerId)}>Override…</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Stage-specific controls */}
      <div className="space-y-2 pt-2 border-t border-gray-700">
        {fj.stage === 'intro' && (
          <button className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_REVEAL_CATEGORY, { roomCode })}>
            Reveal Category
          </button>
        )}

        {fj.stage === 'wagering' && (() => {
          const missing = fj.contestants.filter(c => !c.hasWagered);
          return (
            <button
              className={`w-full font-bold py-2 rounded ${missing.length ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-jeopardy-gold text-jeopardy-dark'}`}
              onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_REVEAL_CLUE, { roomCode, force: missing.length > 0 })}
            >
              {missing.length ? `Force reveal — ${missing.length} missing wager(s) = $0` : 'Reveal Clue'}
            </button>
          );
        })()}

        {fj.stage === 'clue' && (
          <button className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_START_TIMER, { roomCode })}>
            ⏱ Start Timer
          </button>
        )}

        {fj.stage === 'locked' && (
          <button className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_BEGIN_REVEAL, { roomCode })}>
            Begin Reveal
          </button>
        )}

        {fj.stage === 'reveal' && currentContestant && (
          <div className="space-y-2">
            <div className="text-center text-sm text-gray-400">Revealing: <span className="text-white font-bold">{currentContestant.playerName}</span></div>
            {fj.revealStep === 'name' && (
              <button className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_REVEAL_STEP, { roomCode })}>
                Show Wager
              </button>
            )}
            {fj.revealStep === 'wager' && (
              <button className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_REVEAL_STEP, { roomCode })}>
                Show Answer
              </button>
            )}
            {fj.revealStep === 'answer' && (
              <div className="flex gap-2">
                <button className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_JUDGE, { roomCode, playerId: currentContestant.playerId, correct: true })}>
                  ✓ Correct
                </button>
                <button className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_JUDGE, { roomCode, playerId: currentContestant.playerId, correct: false })}>
                  ✗ Wrong
                </button>
              </div>
            )}
            {fj.revealStep === 'judged' && (
              <div className="space-y-2">
                <button className="text-xs text-gray-500 hover:text-red-400 w-full" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_UNDO, { roomCode })}>↺ Undo</button>
                {!isLast ? (
                  <button className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_NEXT, { roomCode })}>
                    Next Contestant
                  </button>
                ) : (
                  <button className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_SHOW_RESPONSE, { roomCode })}>
                    Show Correct Response
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {fj.stage === 'response' && (
          <button className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_SCOREBOARD, { roomCode })}>
            Final Scoreboard
          </button>
        )}

        {fj.stage === 'final' && (
          <div className="flex gap-2">
            <button className="flex-1 btn-danger" onClick={() => socket.emit(SOCKET_EVENTS.HOST_FJ_EXIT, { roomCode })}>
              Return to Board
            </button>
            <button
              className="flex-1 bg-jeopardy-gold text-jeopardy-dark font-bold py-2 rounded"
              onClick={() => { if (confirm('End the game and show the leaderboard?')) socket.emit(SOCKET_EVENTS.HOST_END_GAME, { roomCode }); }}
            >
              End Game
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
