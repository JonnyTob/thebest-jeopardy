import { useAnimatedState, useSession } from '../session';
import { Avatar, Brand, Connection, JoinLink, PointBar, SessionError, buzzerLabel } from '../components/Common';
import { Media } from '../components/Media';

export function DisplayPage() {
  const { connected } = useSession();
  const state = useAnimatedState();
  if (!state) return <main className="loading-screen"><Brand /><h1>Connecting to the show...</h1><SessionError /></main>;
  const active = state.players.find((p) => p.id === state.activePlayerId);
  const players = state.leaderboardIds.slice(0, state.settings.leaderboardCount)
    .flatMap((id) => state.players.find((p) => p.id === id) ?? []);
  const lobby = state.phase === 'LOBBY';
  const finished = state.phase === 'GAME_FINISHED';
  const open = state.phase === 'QUESTION_OPEN' && !state.paused && connected;
  const winner = finished ? players[0] : null;

  return <main className="tv-shell">
    <header className="tv-header"><Brand /><span>{state.settings.title}</span>
      <span className="question-counter">{lobby ? 'WELCOME TO THE SHOW' : finished ? 'THAT IS A WRAP' :
        `QUESTION ${String(state.questionIndex + 1).padStart(2, '0')} / ${state.questionCount}`}</span></header>
    {!connected && <div className="tv-offline" role="alert">Connection lost. Buzzing is unavailable while reconnecting.</div>}
    <div className="tv-errors"><SessionError /></div>
    <section className="tv-stage">
      <div className="panel clue-panel">
        {lobby ? <div className="tv-welcome"><span className="eyebrow">WELCOME TO</span><h1>{state.settings.title}</h1>
          <p>Quick thinking. Big risks. Bragging rights.</p><JoinLink /></div>
          : finished ? <div className="tv-welcome"><span className="eyebrow">OUR QUIZ NIGHT CHAMPION</span>
            {winner ? <><Avatar id={winner.avatarId} /><h1>{winner.name}</h1><strong className="winner-score">{winner.score.toLocaleString()} points</strong></>
              : <h1>Thanks for playing!</h1>}<p>Same time next quiz?</p></div>
            : <>
              <div className="clue-heading"><span className="eyebrow">THE QUESTION</span><h1>{state.question?.question}</h1></div>
              <div className="media-area"><Media state={state} />
                {state.revealedAnswer && <div className="answer-reveal"><span className="eyebrow">THE ANSWER</span><h2>{state.revealedAnswer}</h2></div>}
              </div>
              <PointBar state={state} />
            </>}
      </div>
      <aside className={`panel tv-buzzer ${open ? 'is-open' : active ? 'is-answering' : ''}`}>
        <span className="eyebrow">BUZZER STATUS</span>
        <div className="buzzer-status"><span className="buzzer-orb" /><h2>{connected ? buzzerLabel(state) : 'RECONNECTING'}</h2></div>
        {active ? <div className="answering-player"><Avatar id={active.avatarId} /><h2>{active.name}</h2>
          <strong>{state.pointsAtBuzz} points</strong><p>The floor is yours.</p></div>
          : <div className="buzzer-idle"><span className="giant-q">?</span><p>{open ? 'Know the answer? Make your move.' : lobby ? 'Pick your avatar. Find your lucky seat.' : 'Eyes on the next clue.'}</p></div>}
        <div className="buzzer-footer"><span>{state.clockRunning ? 'CLUE PLAYING' : 'CLUE PAUSED'}</span>
          <small>{active ? 'No rush. Answer out loud.' : open ? 'First buzz takes the floor' : 'The gamemaster has control'}</small></div>
      </aside>
    </section>
    <section className="tv-leaderboard" aria-label="Leaderboard">
      <div className="leaderboard-heading"><span>TOP {Math.min(state.settings.leaderboardCount, state.players.length)} OF {state.players.length} PLAYERS</span>
        <span>{state.players.filter((p) => p.connected).length} CONNECTED</span></div>
      <div className="leaderboard-row">
        {players.map((player, index) => <div key={player.id} className={`leader-card ${player.id === state.activePlayerId ? 'active' : ''}`}>
          <span className="rank-tag">{index + 1}</span><Avatar id={player.avatarId} />
          <div className="leader-details"><strong title={player.name}>{player.name}</strong><span className={player.score < 0 ? 'negative' : ''}>{player.score.toLocaleString()}</span></div>
        </div>)}
        {!players.length && <div className="empty-leaderboard">Your name could be here. Scan the code to join.</div>}
      </div>
    </section>
    <div className="sr-only"><Connection connected={connected} /></div>
  </main>;
}
