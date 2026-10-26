import type { Player } from '@shared/types';
import type { LogEntry } from '../../store/gameStore';
import { formatMoney } from '../../utils/format';

export interface PlayerStat extends Player {
  correct: number;
  wrong: number;
  buzzes: number;
  earlyBuzzes: number;
}

export default function StatsTab({
  playerStats,
  answeredQuestionsCount,
  gameLog,
}: {
  playerStats: PlayerStat[];
  answeredQuestionsCount: number;
  gameLog: LogEntry[];
}) {
  return (
    <div className="space-y-4">
      {playerStats.length === 0 && <p className="text-gray-600 text-sm">No players yet.</p>}

      {/* Leaderboard */}
      {playerStats.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase mb-2">Leaderboard</div>
          {playerStats.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 py-2 border-b border-gray-800">
              <span className="text-gray-500 text-xs w-4 text-right">{i + 1}</span>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="flex-1 text-sm font-bold truncate">{p.name}</span>
              <span className="font-black text-sm" style={{ color: p.score < 0 ? '#ef4444' : '#FFD700' }}>
                {formatMoney(p.score)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Per-player breakdown */}
      {playerStats.length > 0 && (
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase mb-2">Answer Breakdown</div>
          <div className="space-y-2">
            {playerStats.map(p => (
              <div key={p.id} className="bg-gray-800 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  <span className="font-bold text-sm">{p.name}</span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <div className="bg-gray-700 rounded py-1">
                    <div className="text-green-400 font-black text-base">{p.correct}</div>
                    <div className="text-gray-400">Correct</div>
                  </div>
                  <div className="bg-gray-700 rounded py-1">
                    <div className="text-red-400 font-black text-base">{p.wrong}</div>
                    <div className="text-gray-400">Wrong</div>
                  </div>
                  <div className="bg-gray-700 rounded py-1">
                    <div className="text-orange-300 font-black text-base">{p.buzzes}</div>
                    <div className="text-gray-400">Buzzes</div>
                  </div>
                  <div className="bg-gray-700 rounded py-1">
                    <div className="text-red-300 font-black text-base">{p.earlyBuzzes}</div>
                    <div className="text-gray-400">Early</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game summary */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase mb-2">Game Summary</div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="bg-gray-800 rounded p-2">
            <div className="text-white font-black text-base">{answeredQuestionsCount}</div>
            <div className="text-gray-400">Questions Closed</div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'correct').length}</div>
            <div className="text-gray-400">Correct Answers</div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'wrong').length}</div>
            <div className="text-gray-400">Wrong Answers</div>
          </div>
          <div className="bg-gray-800 rounded p-2">
            <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'dd').length}</div>
            <div className="text-gray-400">Daily Doubles</div>
          </div>
        </div>
      </div>
    </div>
  );
}
