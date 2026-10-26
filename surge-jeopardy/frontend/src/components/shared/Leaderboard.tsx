import { useEffect, useMemo } from 'react';
import type { GameState } from '@shared/types';
import { playWinnerFanfare } from '../../utils/sounds';
import { formatMoneyChange } from '../../utils/format';

interface Row {
  playerId: string;
  name: string;
  color: string;
  preScore: number | null;
  wager: number | null;
  result: 'correct' | 'wrong' | null;
  change: number;
  finalScore: number;
  correct: number;
  wrong: number;
  buzzes: number;
  earlyBuzzes: number;
  accuracy: number;
  rank: number;
  tied: boolean;
}

export function buildRows(gameState: GameState): Row[] {
  const fj = gameState.finalJeopardy;

  const withScore: Row[] = fj
    ? fj.contestants.map(c => {
        const player = gameState.players.find(p => p.id === c.playerId);
        const revealed = fj.revealed[c.playerId];
        const change = revealed ? (revealed.correct ? revealed.wager : -revealed.wager) : 0;
        const correct = player?.stats?.correct ?? 0;
        const wrong = player?.stats?.wrong ?? 0;
        const total = correct + wrong;
        return {
          playerId: c.playerId,
          name: c.playerName,
          color: player?.color ?? '#FFD700',
          preScore: c.preScore,
          wager: revealed ? revealed.wager : null,
          result: revealed ? (revealed.correct ? 'correct' as const : 'wrong' as const) : null,
          change,
          finalScore: player?.score ?? c.preScore,
          correct,
          wrong,
          buzzes: player?.stats?.buzzes ?? 0,
          earlyBuzzes: player?.stats?.earlyBuzzes ?? 0,
          accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
          rank: 0,
          tied: false,
        };
      })
    : gameState.players.map(p => {
        const correct = p.stats?.correct ?? 0;
        const wrong = p.stats?.wrong ?? 0;
        const total = correct + wrong;
        return {
          playerId: p.id,
          name: p.name,
          color: p.color,
          preScore: null,
          wager: null,
          result: null,
          change: 0,
          finalScore: p.score,
          correct,
          wrong,
          buzzes: p.stats?.buzzes ?? 0,
          earlyBuzzes: p.stats?.earlyBuzzes ?? 0,
          accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
          rank: 0,
          tied: false,
        };
      });

  withScore.sort((a, b) => b.finalScore - a.finalScore);
  let rank = 0;
  let prevScore: number | null = null;
  withScore.forEach((r, i) => {
    if (prevScore === null || r.finalScore !== prevScore) rank = i + 1;
    r.rank = rank;
    prevScore = r.finalScore;
  });
  const rankCounts = new Map<number, number>();
  withScore.forEach(r => rankCounts.set(r.rank, (rankCounts.get(r.rank) ?? 0) + 1));
  withScore.forEach(r => { r.tied = (rankCounts.get(r.rank) ?? 0) > 1; });
  return withScore;
}

export default function Leaderboard({ gameState, compact, myId }: { gameState: GameState; compact?: boolean; myId?: string }) {
  const rows = useMemo(() => buildRows(gameState), [gameState]);
  const hasFj = !!gameState.finalJeopardy;

  const podiumRanks = [1, 2, 3].filter(rank => rows.some(r => r.rank === rank));
  const podiumGroups = podiumRanks.map(rank => ({ rank, players: rows.filter(r => r.rank === rank) }));

  useEffect(() => { playWinnerFanfare(); }, []);

  function rankLabel(r: Row): string {
    return r.tied ? `T-${r.rank}` : `#${r.rank}`;
  }

  if (compact) {
    const me = myId ? rows.find(r => r.playerId === myId) : undefined;
    return (
      <div className="text-center">
        <div className="text-jeopardy-gold font-black text-2xl mb-1">Final Standings</div>
        {rows.map(r => (
          <div key={r.playerId} className={`flex justify-between text-sm py-1 border-b border-gray-800 ${r.playerId === myId ? 'text-white font-bold' : ''}`}>
            <span>{rankLabel(r)} {r.name}</span>
            <span className="text-jeopardy-gold font-bold">${r.finalScore}</span>
          </div>
        ))}
        {me && <div className="text-gray-400 text-xs mt-2">You finished {rankLabel(me)}</div>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      {/* Confetti for the winner */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 60 }).map((_, i) => {
          const colors = ['#FFD700', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c'];
          const left = Math.random() * 100;
          const delay = Math.random() * 2;
          const duration = 3 + Math.random() * 2;
          return (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${left}%`,
                background: colors[i % colors.length],
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
              }}
            />
          );
        })}
      </div>

      <div className="text-center text-jeopardy-gold font-black text-4xl mb-6" style={{ textShadow: '3px 3px 0 #000' }}>
        FINAL SCOREBOARD
      </div>

      {/* Podium — grouped by rank so ties all appear */}
      <div className="flex items-end justify-center gap-4 mb-8">
        {[2, 1, 3].map((rank, i) => {
          const group = podiumGroups.find(g => g.rank === rank);
          if (!group) return null;
          return (
            <div key={rank} className="podium-rise text-center" style={{ animationDelay: `${i * 0.15}s` }}>
              {rank === 1 && <div className="text-4xl mb-1">👑</div>}
              {group.players.map(r => (
                <div key={r.playerId} className="mb-1">
                  <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: r.color }} />
                  <div className="font-bold text-white truncate max-w-[140px]">{r.name}</div>
                  <div className="text-jeopardy-gold font-black text-xl">${r.finalScore}</div>
                </div>
              ))}
              <div
                className="bg-jeopardy-blue border-4 border-black flex items-center justify-center font-black text-jeopardy-gold mt-2"
                style={{ width: 140, height: rank === 1 ? 140 : rank === 2 ? 100 : 70 }}
              >
                {group.players.length > 1 ? `T-${rank}` : `#${rank}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* Full stats table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-white">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="p-2 text-left">Rank</th>
              <th className="p-2 text-left">Player</th>
              {hasFj && <th className="p-2 text-right">Pre-FJ</th>}
              {hasFj && <th className="p-2 text-right">Wager</th>}
              {hasFj && <th className="p-2 text-center">Result</th>}
              {hasFj && <th className="p-2 text-right">Change</th>}
              <th className="p-2 text-right">Final</th>
              <th className="p-2 text-right">✓</th>
              <th className="p-2 text-right">✗</th>
              <th className="p-2 text-right">Acc%</th>
              <th className="p-2 text-right">Buzzes</th>
              <th className="p-2 text-right">Early</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.playerId} className="border-b border-gray-800">
                <td className="p-2">{rankLabel(r)}</td>
                <td className="p-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: r.color }} />
                  {r.name}
                </td>
                {hasFj && <td className="p-2 text-right text-gray-400">${r.preScore}</td>}
                {hasFj && <td className="p-2 text-right">{r.wager !== null ? `$${r.wager}` : '—'}</td>}
                {hasFj && <td className="p-2 text-center">{r.result === 'correct' ? '✅' : r.result === 'wrong' ? '❌' : '—'}</td>}
                {hasFj && (
                  <td className={`p-2 text-right ${r.change > 0 ? 'text-green-400' : r.change < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {formatMoneyChange(r.change)}
                  </td>
                )}
                <td className="p-2 text-right font-black text-jeopardy-gold">${r.finalScore}</td>
                <td className="p-2 text-right text-green-400">{r.correct}</td>
                <td className="p-2 text-right text-red-400">{r.wrong}</td>
                <td className="p-2 text-right">{r.accuracy}%</td>
                <td className="p-2 text-right text-orange-300">{r.buzzes}</td>
                <td className="p-2 text-right text-red-300">{r.earlyBuzzes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
