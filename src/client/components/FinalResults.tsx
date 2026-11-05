import { Avatar } from './Common';
import type { Player, Snapshot } from '../../shared/protocol';

/** Equal scores share a competition rank; no player is excluded from the final list. */
export function finalRanks(state: Snapshot): { player: Player; rank: number }[] {
  const byId = new Map(state.players.map((player) => [player.id, player]));
  const ordered = state.leaderboardIds.flatMap((id) => byId.get(id) ?? []);
  let rank = 0;
  return ordered.map((player, index) => {
    if (index === 0 || player.score !== ordered[index - 1].score) rank = index + 1;
    return { player, rank };
  });
}

export function FinalResults({ state }: { state: Snapshot }) {
  const elapsed = state.endGameElapsedMs ?? 9000;
  const ranked = finalRanks(state);
  const complete = elapsed >= 9000;
  const revealRank = elapsed < 2000 ? 0 : elapsed < 4000 ? 3 : elapsed < 6000 ? 2 : 1;
  const podium = ranked.filter(({ rank }) => rank <= 3 && (rank >= revealRank || complete) && (revealRank !== 0 || complete));
  return <section className="final-results" aria-label="Final results">
    {!complete && revealRank === 0 ? <div className="final-intro" role="status"><span className="eyebrow">THE QUIZ IS COMPLETE</span><h1>Game over!</h1><p>Let’s see the final results.</p></div> : <>
      <div className="final-confetti" aria-hidden="true">✦ ✧ ✦ ✧ ✦</div>
      <header><span className="eyebrow">{complete ? 'FINAL RESULTS' : 'THE FINAL REVEAL'}</span><h1>{revealRank === 1 || complete ? 'Here are your champions!' : 'The podium'}</h1></header>
      {podium.length > 0 ? <div className="final-podium" aria-live="polite">{podium.map(({ player, rank }) => <article className={`final-podium-card place-${rank}`} key={player.id}>
        <span className="final-place">{rank === 1 ? '1ST' : rank === 2 ? '2ND' : '3RD'}</span><Avatar id={player.avatarId} />
        <strong>{player.name}</strong><span>{player.score.toLocaleString()} points</span>
      </article>)}</div> : <p>{ranked.length ? 'The results are coming up…' : 'Thanks for playing!'}</p>}
      {complete && ranked.length > 0 && <section className="final-standings" aria-label="Complete final leaderboard"><h2>Final leaderboard</h2>
        <ol>{ranked.map(({ player, rank }) => <li key={player.id}><span>#{rank}</span><Avatar id={player.avatarId} /><strong>{player.name}</strong><span>{player.score.toLocaleString()}</span></li>)}</ol>
      </section>}
    </>}
  </section>;
}
