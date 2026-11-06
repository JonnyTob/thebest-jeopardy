import type { Player, Snapshot } from '../shared/protocol.js';

/** Shared lookup tables are built once per broadcast, not once per phone. */
export function playerSnapshotFactory(publicState: Snapshot, hostState: Snapshot) {
  const players = new Map(publicState.players.map((player) => [player.id, player]));
  const ranks = new Map(publicState.leaderboardIds.map((id, index) => [id, index + 1]));
  const submitted = new Set((hostState.hostSubmissions ?? []).filter((entry) => entry.answer !== null).map((entry) => entry.playerId));
  const locked = new Set(publicState.lockedOutIds);
  const groupMembers = new Set(publicState.reviewGroup?.playerIds ?? []);
  const playerCount = publicState.players.length;

  return (playerId?: string): Snapshot => {
    const player: Player | undefined = playerId ? players.get(playerId) : undefined;
    const remaining = playerId ? publicState.lockoutRemainingMs[playerId] : undefined;
    const group = publicState.reviewGroup;
    const included = !!playerId && groupMembers.has(playerId);
    const points = playerId ? group?.pointsByPlayer?.[playerId] : undefined;
    return {
      ...publicState,
      wifi: null,
      playerCount,
      playerRank: publicState.phase === 'GAME_FINISHED' ? 0 : playerId ? ranks.get(playerId) ?? 0 : 0,
      players: player ? [player] : [],
      leaderboardIds: [],
      lockedOutIds: playerId && locked.has(playerId) ? [playerId] : [],
      lockoutRemainingMs: playerId && remaining !== undefined ? { [playerId]: remaining } : {},
      mySubmitted: !!playerId && submitted.has(playerId),
      review: null,
      reviewGroup: group ? { ...group, playerIds: included ? [playerId!] : [],
        ...(points !== undefined && playerId ? { pointsByPlayer: { [playerId]: points } } : { pointsByPlayer: undefined }) } : null,
    };
  };
}
