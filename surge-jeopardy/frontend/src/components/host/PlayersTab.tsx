import type { Player } from '@shared/types';
import { LIMITS } from '@shared/limits';
import { formatMoney } from '../../utils/format';

export default function PlayersTab({
  players,
  addPlayerName,
  onAddPlayerNameChange,
  onAddPlayer,
  renamingPlayerId,
  renameValue,
  onRenameValueChange,
  renameError,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onAdjustScore,
  onRemovePlayer,
}: {
  players: Player[];
  addPlayerName: string;
  onAddPlayerNameChange: (v: string) => void;
  onAddPlayer: () => void;
  renamingPlayerId: string | null;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  renameError: string;
  onStartRename: (player: { id: string; name: string }) => void;
  onCancelRename: () => void;
  onSaveRename: (playerId: string) => void;
  onAdjustScore: (playerId: string, delta: number) => void;
  onRemovePlayer: (playerId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="input-field text-sm flex-1"
          placeholder="Player name..."
          value={addPlayerName}
          onChange={e => onAddPlayerNameChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAddPlayer()}
        />
        <button className="btn-primary text-sm py-1 px-3" onClick={onAddPlayer}>+</button>
      </div>
      {players.length === 0 && (
        <p className="text-gray-600 text-sm">No players. Add some above or share the buzzer URL.</p>
      )}
      {players.map(player => (
        <div key={player.id} className="bg-gray-800 rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: player.color }} />
            <div className="flex-1 min-w-0">
              {renamingPlayerId === player.id ? (
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      className="input-field text-xs flex-1 py-1"
                      value={renameValue}
                      onChange={e => onRenameValueChange(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') onSaveRename(player.id); if (e.key === 'Escape') onCancelRename(); }}
                      maxLength={LIMITS.PLAYER_NAME_MAX}
                    />
                    <button className="text-xs bg-jeopardy-gold text-jeopardy-dark font-bold px-2 py-1 rounded" onClick={() => onSaveRename(player.id)}>Save</button>
                    <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={onCancelRename}>✕</button>
                  </div>
                  {renameError && <p className="text-red-400 text-xs">{renameError}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="font-bold text-sm truncate">{player.name}</span>
                  <button
                    className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0"
                    title="Rename player"
                    onClick={() => onStartRename(player)}
                  >✎</button>
                </div>
              )}
              <div className="font-black" style={{ color: player.score < 0 ? '#ef4444' : '#FFD700' }}>
                {formatMoney(player.score)}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={() => onAdjustScore(player.id, 100)}>+100</button>
              <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={() => onAdjustScore(player.id, -100)}>-100</button>
              <button className="text-xs text-red-400 hover:text-red-200 px-1" onClick={() => onRemovePlayer(player.id)}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
