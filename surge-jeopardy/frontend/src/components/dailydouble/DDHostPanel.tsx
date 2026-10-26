import { useState } from 'react';
import { socket } from '../../socket';
import type { GameState, Question } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';

export default function DDHostPanel({
  roomCode,
  gameState,
  activeQ,
  onAward,
  onReveal,
  onClose,
}: {
  roomCode: string;
  gameState: GameState;
  activeQ: Question;
  onAward: (playerId: string, correct: boolean) => void;
  onReveal: () => void;
  onClose: () => void;
}) {
  const dd = gameState.dailyDouble!;
  const [overrideAmount, setOverrideAmount] = useState('');

  function pick(playerId: string) {
    socket.emit(SOCKET_EVENTS.HOST_DD_PICK_PLAYER, { roomCode, playerId });
  }

  function applyOverride() {
    const amount = Number(overrideAmount);
    if (!Number.isFinite(amount)) return;
    socket.emit(SOCKET_EVENTS.HOST_DD_OVERRIDE_WAGER, { roomCode, amount: Math.round(amount) }, (res: { ok: boolean; error?: string }) => {
      if (res.ok) setOverrideAmount('');
    });
  }

  const player = dd.playerId ? gameState.players.find(p => p.id === dd.playerId) : null;
  const overrideUnlocked = !dd.hasDevice || dd.submittedByPlayer;

  return (
    <div className="space-y-3">
      <div className="text-yellow-300 font-black text-lg">⭐ Daily Double</div>
      <div className="text-jeopardy-gold font-black text-xl">${activeQ.value}</div>

      {dd.stage === 'picking' && (
        <div className="space-y-2">
          <div className="bg-yellow-900 border border-yellow-500 rounded p-3 text-sm text-yellow-200 text-center">
            No player has answered correctly yet — pick who's wagering.
          </div>
          {gameState.players.map(p => (
            <button
              key={p.id}
              className="w-full flex justify-between items-center bg-gray-800 hover:bg-gray-700 rounded p-2 text-sm"
              onClick={() => pick(p.id)}
            >
              <span className="font-bold">{p.name}</span>
              <span className="text-gray-400">Pick</span>
            </button>
          ))}
          {gameState.players.length === 0 && <p className="text-gray-500 text-sm">No players yet.</p>}
        </div>
      )}

      {dd.stage === 'wagering' && player && (
        <div className="space-y-2">
          <div className="bg-gray-800 rounded p-3 text-sm">
            <div className="font-bold">{player.name}</div>
            <div className="text-gray-400">Max wager: ${dd.maxWager}</div>
            <div className="text-gray-400 mt-1 animate-pulse">
              {dd.hasDevice ? 'Waiting for their wager…' : 'No device connected — enter their wager below.'}
            </div>
          </div>
          <div className="flex gap-1">
            <input
              className="input-field text-sm py-1 flex-1"
              placeholder="wager"
              value={overrideAmount}
              onChange={e => setOverrideAmount(e.target.value.replace(/[^0-9]/g, ''))}
              disabled={!overrideUnlocked}
            />
            <button
              className="text-sm bg-jeopardy-gold text-jeopardy-dark px-3 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={applyOverride}
              disabled={!overrideUnlocked}
            >
              Set
            </button>
          </div>
          {!overrideUnlocked && (
            <p className="text-[10px] text-gray-500">Override unlocks once {player.name} submits a wager.</p>
          )}
        </div>
      )}

      {dd.stage === 'ready' && player && (
        <div className="space-y-3">
          <div className="bg-gray-800 rounded p-3 text-sm">
            <div className="font-bold">{player.name}</div>
            <div className="text-jeopardy-gold font-black text-lg">Wager: ${dd.wager}</div>
          </div>

          {!gameState.dailyDoubleRevealed ? (
            <button className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-2 rounded transition-colors" onClick={onReveal}>
              ▶ Reveal Question
            </button>
          ) : (
            <>
              <div className="bg-gray-800 rounded p-3 text-sm text-white leading-relaxed">{activeQ.clue}</div>
              <div className="bg-green-950 border border-green-700 rounded p-3 text-sm text-green-300">
                <div className="text-[10px] text-gray-500 uppercase mb-1">Answer</div>
                {activeQ.response}
              </div>
              <div className="flex gap-2">
                <button className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded" onClick={() => onAward(player.id, true)}>
                  ✓ Correct
                </button>
                <button className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded" onClick={() => onAward(player.id, false)}>
                  ✗ Wrong
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <button className="btn-danger text-sm w-full" onClick={onClose}>Close Question</button>
    </div>
  );
}
