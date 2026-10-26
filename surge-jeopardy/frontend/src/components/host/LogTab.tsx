import type { LogEntry } from '../../store/gameStore';

const LOG_ICONS: Record<string, string> = {
  open: '📋', dd: '⭐', buzz: '⚡', correct: '✅', wrong: '❌', close: '✖', score: '💰',
  fj: '⚡', wager: '🎲', answer: '📝',
};
const LOG_COLORS: Record<string, string> = {
  open: 'text-blue-300', dd: 'text-yellow-300', buzz: 'text-orange-300',
  correct: 'text-green-400', wrong: 'text-red-400', close: 'text-gray-400', score: 'text-purple-300',
  fj: 'text-jeopardy-gold', wager: 'text-yellow-300', answer: 'text-blue-300',
};

export default function LogTab({
  gameLog,
  onClearLog,
}: {
  gameLog: LogEntry[];
  onClearLog: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs text-gray-500">{gameLog.length} events</span>
        <button className="text-xs text-gray-500 hover:text-red-400" onClick={onClearLog}>Clear</button>
      </div>
      {gameLog.length === 0 && <p className="text-gray-600 text-sm">No events yet.</p>}
      {gameLog.map(entry => (
        <div key={entry.id} className="flex gap-2 text-xs py-1 border-b border-gray-800">
          <span className="text-gray-600 flex-shrink-0 tabular-nums">{entry.ts}</span>
          <span className="flex-shrink-0">{LOG_ICONS[entry.type]}</span>
          <span className={LOG_COLORS[entry.type]}>{entry.msg}</span>
        </div>
      ))}
    </div>
  );
}
