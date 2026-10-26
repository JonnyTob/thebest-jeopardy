import { useEffect, useRef } from 'react';
import type { GameState } from '@shared/types';
import { useCountdown } from './useCountdown';
import Leaderboard from '../shared/Leaderboard';
import { playFinalJeopardy, playTick, playTimesUp, playReveal, playThinkingPulse, stopThinkingPulse } from '../../utils/sounds';
import { getYouTubeEmbedUrl } from '../../utils/media';

function CountdownRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const pct = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const isUrgent = remainingMs <= 5000;
  return (
    <div className="relative w-44 h-44 flex items-center justify-center">
      <svg width="176" height="176" className="-rotate-90">
        <circle cx="88" cy="88" r={radius} stroke="#1f2937" strokeWidth="12" fill="none" />
        <circle
          cx="88" cy="88" r={radius}
          stroke={isUrgent ? '#ef4444' : '#FFD700'}
          strokeWidth="12"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.1s linear' }}
        />
      </svg>
      <div className={`absolute font-black text-5xl ${isUrgent ? 'text-red-400' : 'text-jeopardy-gold'}`}>
        {Math.ceil(remainingMs / 1000)}
      </div>
    </div>
  );
}

export default function FinalBoardScreen({ gameState }: { gameState: GameState }) {
  const fj = gameState.finalJeopardy!;
  const remainingMs = useCountdown(fj.deadline, fj.serverNow);
  const prevStage = useRef<string | null>(null);
  const prevRevealStep = useRef<string | null>(null);
  const lastTickSecond = useRef<number | null>(null);

  useEffect(() => {
    if (fj.stage === 'intro' && prevStage.current !== 'intro') playFinalJeopardy();
    if (fj.stage === 'answering' && prevStage.current !== 'answering') playThinkingPulse();
    if (fj.stage === 'locked' && prevStage.current === 'answering') { playTimesUp(); stopThinkingPulse(); }
    prevStage.current = fj.stage;
  }, [fj.stage]);

  // Safety net: never leave the ambient pulse running if the board unmounts mid-countdown.
  useEffect(() => () => stopThinkingPulse(), []);

  useEffect(() => {
    if (fj.stage === 'reveal' && fj.revealStep !== prevRevealStep.current) {
      playReveal();
      prevRevealStep.current = fj.revealStep;
    }
    if (fj.stage !== 'reveal') prevRevealStep.current = null;
  }, [fj.stage, fj.revealStep]);

  useEffect(() => {
    if (fj.stage !== 'answering' || remainingMs == null) { lastTickSecond.current = null; return; }
    const sec = Math.ceil(remainingMs / 1000);
    if (sec <= 5 && sec >= 1 && sec !== lastTickSecond.current) {
      playTick();
      lastTickSecond.current = sec;
    }
  }, [remainingMs, fj.stage]);

  const contestant = fj.stage === 'reveal' ? fj.contestants[fj.revealIndex] : null;
  const revealed = contestant ? fj.revealed[contestant.playerId] : null;
  const liveWager = revealed?.wager ?? fj.currentReveal?.wager;
  const liveAnswer = revealed?.answer ?? fj.currentReveal?.answer;

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center p-8"
         style={{ background: 'linear-gradient(135deg, #060CE9 0%, #0A0A2E 100%)' }}>

      {fj.stage === 'intro' && (
        <div className="text-center">
          <div className="fj-glow text-jeopardy-gold font-black" style={{ fontSize: 'clamp(48px, 12vw, 140px)', letterSpacing: '0.08em' }}>
            FINAL JEOPARDY!
          </div>
        </div>
      )}

      {fj.stage === 'wagering' && (
        <div className="text-center card-flip">
          <div className="bg-jeopardy-blue border-8 border-jeopardy-gold rounded-2xl px-16 py-10">
            <div className="text-jeopardy-gold font-black text-3xl md:text-5xl uppercase" style={{ textShadow: '3px 3px 0 #000' }}>
              {fj.category}
            </div>
          </div>
          <div className="mt-8 text-white text-2xl font-bold animate-pulse">Contestants are wagering…</div>
          <div className="flex gap-3 justify-center mt-6 flex-wrap">
            {fj.contestants.map(c => (
              <div key={c.playerId} className={`px-4 py-2 rounded-full border-2 ${c.hasWagered ? 'border-green-400 text-green-400' : 'border-gray-600 text-gray-500'}`}>
                {c.hasWagered ? '✓ ' : ''}{c.playerName}
              </div>
            ))}
          </div>
        </div>
      )}

      {(fj.stage === 'clue' || fj.stage === 'answering') && (
        <div className="text-center max-w-4xl">
          <div className="text-jeopardy-gold font-black text-2xl mb-4 uppercase tracking-widest">{fj.category}</div>
          {fj.mediaType === 'image' && fj.mediaUrl && (
            <img src={fj.mediaUrl} alt="clue" className="max-h-64 max-w-full object-contain mb-6 rounded mx-auto" />
          )}
          {fj.mediaType === 'video' && fj.mediaUrl && (
            <video src={fj.mediaUrl} autoPlay controls className="max-h-64 max-w-2xl mb-6 rounded w-full mx-auto" />
          )}
          {fj.mediaType === 'youtube' && fj.mediaUrl && (
            <div className="mb-6 w-full max-w-2xl aspect-video mx-auto">
              <iframe className="w-full h-full rounded" src={getYouTubeEmbedUrl(fj.mediaUrl)} allow="autoplay; fullscreen" allowFullScreen />
            </div>
          )}
          <div className="text-white text-3xl md:text-5xl font-black leading-tight" style={{ textShadow: '2px 2px 0 #000' }}>
            {fj.clue}
          </div>

          {fj.stage === 'clue' && (
            <div className="mt-10 text-gray-300 text-xl font-bold">Get ready…</div>
          )}

          {fj.stage === 'answering' && remainingMs != null && (
            <div className="mt-10 flex flex-col items-center gap-4">
              <CountdownRing remainingMs={remainingMs} totalMs={(fj.deadline ?? 0) - (fj.serverNow ?? 0) || 30000} />
              <div className="flex gap-2 flex-wrap justify-center">
                {fj.contestants.map(c => (
                  <div key={c.playerId} className={`px-3 py-1 rounded-full text-sm border-2 ${c.hasAnswered ? 'border-green-400 text-green-400' : 'border-gray-600 text-gray-500'}`}>
                    {c.hasAnswered ? '✓ ' : ''}{c.playerName}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {fj.stage === 'locked' && (
        <div className="stamp-in text-center">
          <div className="text-red-500 font-black border-8 border-red-500 rounded-2xl px-12 py-6" style={{ fontSize: 'clamp(36px, 8vw, 90px)' }}>
            TIME'S UP
          </div>
        </div>
      )}

      {fj.stage === 'reveal' && contestant && (
        <div className="text-center">
          <div className="text-white font-black text-4xl md:text-6xl mb-6 flip-in" style={{ textShadow: '3px 3px 0 #000' }}>
            {contestant.playerName}
          </div>
          {(fj.revealStep === 'wager' || fj.revealStep === 'answer' || fj.revealStep === 'judged') && liveWager !== undefined && (
            <div className="fade-up text-jeopardy-gold font-black text-3xl mb-4">
              Wagered ${liveWager}
            </div>
          )}
          {(fj.revealStep === 'answer' || fj.revealStep === 'judged') && liveAnswer !== undefined && (
            <div className="fade-up bg-black/60 border-2 border-jeopardy-gold rounded-xl px-8 py-4 max-w-3xl mx-auto mb-4">
              <div className="text-white text-2xl md:text-3xl font-bold">
                {liveAnswer ? liveAnswer : <span className="text-gray-500 italic">No answer</span>}
              </div>
            </div>
          )}
          {fj.revealStep === 'judged' && revealed && (
            <div className="stamp-in">
              <div className={`inline-block font-black text-4xl px-8 py-3 rounded-xl ${revealed.correct ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
                {revealed.correct ? '✓ CORRECT' : '✗ WRONG'}
              </div>
              <div className="count-pop mt-4 text-jeopardy-gold font-black text-3xl">
                ${gameState.players.find(p => p.id === contestant.playerId)?.score ?? 0}
              </div>
            </div>
          )}
        </div>
      )}

      {fj.stage === 'response' && (
        <div className="text-center fade-up">
          <div className="text-gray-400 text-xl uppercase tracking-widest mb-3">Correct Response</div>
          <div className="bg-black/60 border-4 border-jeopardy-gold rounded-2xl px-12 py-8 text-jeopardy-gold font-black text-3xl md:text-5xl max-w-4xl" style={{ textShadow: '2px 2px 0 #000' }}>
            {fj.response}
          </div>
        </div>
      )}

      {fj.stage === 'final' && <Leaderboard gameState={gameState} />}
    </div>
  );
}
