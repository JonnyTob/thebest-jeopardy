import { useEffect, useRef, useState } from 'react';
import { socket } from '../../socket';
import type { GameState } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { LIMITS } from '@shared/limits';
import { useCountdown } from './useCountdown';
import Leaderboard from '../shared/Leaderboard';
import WagerInput from '../shared/WagerInput';
import { formatMoney } from '../../utils/format';

type Ack = { ok: boolean; error?: string };

export default function PlayerFinal({ gameState, myId }: { gameState: GameState; myId: string }) {
  const fj = gameState.finalJeopardy!;
  const contestant = fj.contestants.find(c => c.playerId === myId);
  const remainingMs = useCountdown(fj.deadline, fj.serverNow, 'second');

  const [wagerLocked, setWagerLocked] = useState(false);
  const [lockedWagerAmount, setLockedWagerAmount] = useState(0);
  const [wagerError, setWagerError] = useState('');

  const [answerText, setAnswerText] = useState('');
  const [answerLocked, setAnswerLocked] = useState(false);
  const draftTimer = useRef<number | null>(null);

  // Reset local lock state whenever a fresh Final Jeopardy round begins.
  useEffect(() => {
    if (fj.stage === 'intro') {
      setWagerLocked(false);
      setLockedWagerAmount(0);
      setWagerError('');
      setAnswerText('');
      setAnswerLocked(false);
    }
  }, [fj.stage]);

  function lockWager(amount: number) {
    socket.emit(SOCKET_EVENTS.FJ_WAGER, { amount }, (res: Ack) => {
      if (res.ok) { setWagerLocked(true); setLockedWagerAmount(amount); setWagerError(''); }
      else setWagerError(res.error ?? 'Could not lock wager');
    });
  }

  function handleDraft(text: string) {
    setAnswerText(text);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      socket.emit(SOCKET_EVENTS.FJ_DRAFT, { text });
    }, 400);
  }

  function submitAnswer() {
    socket.emit(SOCKET_EVENTS.FJ_ANSWER, { text: answerText }, (res: Ack) => {
      if (res.ok) setAnswerLocked(true);
    });
  }

  if (!contestant) {
    return (
      <div className="text-center">
        <h2 className="text-2xl font-black text-jeopardy-gold mb-2">Final Jeopardy</h2>
        <p className="text-gray-400">You joined too late to play this round — watch the board!</p>
      </div>
    );
  }

  if (fj.stage === 'intro') {
    return (
      <div className="text-center fj-glow">
        <h2 className="text-3xl font-black text-jeopardy-gold">FINAL JEOPARDY!</h2>
        <p className="text-gray-300 mt-3 animate-pulse">is coming…</p>
      </div>
    );
  }

  if (fj.stage === 'wagering') {
    return (
      <WagerInput
        heading={fj.category ?? undefined}
        subtitle={`Your score: $${contestant.preScore} · Max wager: $${contestant.maxWager}`}
        maxWager={contestant.maxWager}
        locked={wagerLocked || contestant.hasWagered}
        lockedAmount={wagerLocked ? lockedWagerAmount : contestant.maxWager}
        waitingText="Waiting for other contestants…"
        onLock={lockWager}
        error={wagerError}
      />
    );
  }

  if (fj.stage === 'clue') {
    return (
      <div className="text-center max-w-sm">
        <h2 className="text-xl font-black text-jeopardy-gold mb-3">{fj.category}</h2>
        <p className="text-gray-400 mb-4">Get ready…</p>
        <p className="text-white text-lg leading-relaxed">{fj.clue}</p>
      </div>
    );
  }

  if (fj.stage === 'answering') {
    const seconds = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;
    if (answerLocked) {
      return (
        <div className="text-center">
          <div className="text-jeopardy-gold font-black text-3xl mb-2">{seconds ?? 0}s</div>
          <p className="text-green-400 font-bold">Answer submitted!</p>
        </div>
      );
    }
    return (
      <div className="w-full max-w-sm text-center">
        <div className={`font-black text-3xl mb-3 ${seconds !== null && seconds <= 5 ? 'text-red-400' : 'text-jeopardy-gold'}`}>{seconds ?? 0}s</div>
        <textarea
          autoFocus
          className="input-field h-28 resize-none mb-3"
          placeholder="What is…"
          value={answerText}
          onChange={e => handleDraft(e.target.value)}
          maxLength={LIMITS.ANSWER_MAX}
        />
        <button className="btn-primary w-full py-3" onClick={submitAnswer}>Submit</button>
      </div>
    );
  }

  if (fj.stage === 'locked') {
    return (
      <div className="text-center stamp-in">
        <div className="text-red-400 font-black text-2xl mb-3">TIME'S UP</div>
        {answerText.trim() ? (
          <p className="text-white">Your answer: <span className="italic">{answerText}</span></p>
        ) : (
          <p className="text-gray-400">No answer submitted — you're out.</p>
        )}
      </div>
    );
  }

  if (fj.stage === 'reveal' || fj.stage === 'response') {
    const revealed = fj.revealed[myId];
    if (!revealed) {
      return (
        <div className="text-center">
          <p className="text-gray-400 animate-pulse">Waiting for your turn to be revealed…</p>
        </div>
      );
    }
    const myScore = gameState.players.find(p => p.id === myId)?.score ?? 0;
    return (
      <div className="text-center">
        <div className={`inline-block font-black text-2xl px-6 py-3 rounded-xl mb-3 ${revealed.correct ? 'bg-green-600' : 'bg-red-600'} text-white`}>
          {revealed.correct ? '✓ Correct!' : '✗ Wrong'}
        </div>
        <p className="text-gray-300">Wager: ${revealed.wager}</p>
        <p className="text-jeopardy-gold font-black text-xl mt-2">
          {formatMoney(myScore)}
        </p>
      </div>
    );
  }

  if (fj.stage === 'final') {
    return <Leaderboard gameState={gameState} compact myId={myId} />;
  }

  return null;
}
