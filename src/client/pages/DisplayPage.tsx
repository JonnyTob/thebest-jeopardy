import { useAnimatedState, useSession } from '../session';
import { Avatar, Brand, Connection, JoinLink, PointBar, QuizName, SessionError, buzzerLabel } from '../components/Common';
import { Media } from '../components/Media';
import { QuizCover } from '../components/QuizCover';
import { branding } from '../branding';

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
  const typed = state.question?.mode === 'typed';
  const reviewedPlayer = state.players.find((player) => player.id === state.review?.playerId);
  const timerMs = (state.question?.timerSeconds ?? 0) * 1000;
  const remainingMs = Math.max(0, timerMs - state.clueElapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const remainingPercent = timerMs > 0 ? Math.min(100, remainingMs / timerMs * 100) : 0;

  return <main className="tv-shell">
    <header className="tv-header"><Brand /><QuizName title={state.settings.title} id={state.quizId} />
      <span className="question-counter">{lobby ? 'WELCOME TO THE SHOW' : finished ? 'THAT IS A WRAP' :
        `QUESTION ${String(state.questionIndex + 1).padStart(2, '0')} / ${state.questionCount}`}</span></header>
    {!connected && <div className="tv-offline" role="alert">Connection lost. Buzzing is unavailable while reconnecting.</div>}
    <div className="tv-errors"><SessionError /></div>
    <section className="tv-stage">
      <div className={`panel clue-panel ${lobby ? 'lobby-cover-panel' : ''}`}>
        {lobby ? <QuizCover key={`${state.quizId}:${state.coverImage}`} title={state.settings.title} id={state.quizId} image={state.coverImage} />
          : finished ? <div className="tv-welcome"><span className="eyebrow">OUR {branding.name.toUpperCase()} CHAMPION</span>
            {winner ? <><Avatar id={winner.avatarId} /><h1>{winner.name}</h1><strong className="winner-score">{winner.score.toLocaleString()} points</strong></>
              : <h1>Thanks for playing!</h1>}<p>Same time next quiz?</p></div>
            : state.phase === 'REVIEW' && state.review ? <div className="tv-welcome review-card">
              <span className="eyebrow">ANSWER {state.reviewIndex + 1} / {state.reviewCount}</span>
              {reviewedPlayer && <><Avatar id={reviewedPlayer.avatarId} /><h1>{reviewedPlayer.name}</h1></>}
              <strong className="review-answer">{state.review.answer ?? 'No answer'}</strong>
              {state.review.correct !== null && <p className={state.review.correct ? 'positive' : 'negative'}>
                {state.review.correct ? `Correct +${state.question?.fixedPoints}` : state.review.answer === null ? 'No answer / +0' : 'Wrong / +0'}</p>}
              </div>
            : <>
              <div className="clue-heading"><span className="eyebrow">THE QUESTION</span><h1>{state.question?.question}</h1></div>
              <div className="media-area"><Media state={state} />
                {state.revealedAnswer && <div className="answer-reveal"><span className="eyebrow">THE ANSWER</span><h2>{state.revealedAnswer}</h2></div>}
              </div>
              {typed ? <div className="point-bar">
                <div className="point-label"><span>TIME REMAINING</span><strong>{remainingSeconds} <small>s</small></strong></div>
                <div className="point-track" role="progressbar" aria-label="Time remaining"
                  aria-valuenow={Math.round(remainingPercent)} aria-valuemin={0} aria-valuemax={100}
                  aria-valuetext={`${remainingSeconds} seconds remaining`}>
                  <div style={{ width: `${remainingPercent}%` }} />
                </div>
                <div className="point-meta"><strong>{state.question?.fixedPoints} fixed points</strong>
                  <span>{state.clockRunning ? 'Clock running' : 'Clock frozen'} / host closes submissions</span></div>
                </div>
                : <PointBar state={state} />}
            </>}
      </div>
      <aside className={`panel tv-buzzer ${lobby ? 'lobby-buzzer' : open ? 'is-open' : active ? 'is-answering' : ''}`}>
        <span className="eyebrow">{typed ? 'ANSWER STATUS' : 'BUZZER STATUS'}</span>
        <div className="buzzer-status"><span className="buzzer-orb" /><h2>{connected ? buzzerLabel(state) : 'RECONNECTING'}</h2></div>
        {lobby ? <div className="lobby-join"><JoinLink compact /></div>
          : active ? <div className="answering-player"><Avatar id={active.avatarId} /><h2>{active.name}</h2>
          <strong>{state.pointsAtBuzz} points</strong><p>The floor is yours.</p></div>
          : <div className="buzzer-idle"><span className="giant-q">?</span><p>{typed
            ? `${state.submissionCount} of ${state.players.length} submitted` : open ? 'Know the answer? Make your move.' : 'Eyes on the next clue.'}</p></div>}
        {!lobby && <div className="buzzer-footer"><span>{state.clockRunning ? 'CLUE PLAYING' : 'CLUE PAUSED'}</span>
          <small>{typed ? 'Type your answer on your phone' : active ? 'No rush. Answer out loud.' : open ? 'First buzz takes the floor' : 'The gamemaster has control'}</small></div>}
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
        {!players.length && <div className="empty-leaderboard">{lobby ? 'Your name could be here. Scan the code to join.' : 'No players in this game yet.'}</div>}
      </div>
    </section>
    <div className="sr-only"><Connection connected={connected} /></div>
  </main>;
}
