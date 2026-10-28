import { useAnimatedState, useSession } from '../session';
import { Avatar, Brand, Connection, JoinLink, QuizName, SessionError, buzzerLabel, nextRoundCountdownText } from '../components/Common';
import { QuestionClue } from '../components/QuestionClue';
import { QuizCover } from '../components/QuizCover';
import { CountdownSound } from '../components/CountdownSound';
import { branding } from '../branding';
import { startCountdownText } from '../../shared/game';

export function DisplayPage() {
  const { connected, receivedAt } = useSession();
  const state = useAnimatedState();
  if (!state) return <main className="loading-screen"><Brand /><h1>Connecting to the show...</h1><SessionError /></main>;
  const active = state.phase === 'ANSWERING' || state.phase === 'BUZZ_RESULT'
    ? state.players.find((p) => p.id === state.activePlayerId) : undefined;
  const players = state.leaderboardIds.slice(0, state.settings.leaderboardCount)
    .flatMap((id) => state.players.find((p) => p.id === id) ?? []);
  const lobby = state.phase === 'LOBBY';
  const starting = state.phase === 'STARTING';
  const nextRound = state.phase === 'NEXT_ROUND';
  const preGame = lobby || starting;
  const countdownText = nextRound ? nextRoundCountdownText(state.nextRoundCountdownMs) : startCountdownText(state.startCountdownMs ?? 0);
  const finished = state.phase === 'GAME_FINISHED';
  const open = state.phase === 'QUESTION_OPEN' && !state.paused && connected;
  const winner = finished ? players[0] : null;
  const typed = state.question?.mode === 'typed';

  return <main className="tv-shell">
    <CountdownSound sound={state.serverSettings.countdownSound}
      reviewCorrectSound={state.serverSettings.reviewCorrectSound}
      reviewWrongSound={state.serverSettings.reviewWrongSound}
      id={state.countdownId}
      phase={starting ? 'STARTING' : nextRound ? 'NEXT_ROUND' : null}
      remaining={starting ? state.startCountdownMs : nextRound ? state.nextRoundCountdownMs : null}
      reviewResultId={state.buzzResult?.id ?? state.reviewResultId}
      reviewRemainingMs={state.buzzResult?.remainingMs ?? state.reviewRemainingMs}
      reviewCorrect={state.buzzResult?.correct ?? state.review?.correct ?? null}
      connected={connected} receivedAt={receivedAt} />
    <header className="tv-header"><Brand /><QuizName title={state.settings.title} id={state.quizId} />
      <span className="question-counter">{lobby ? 'WELCOME TO THE SHOW' : starting ? 'GET READY' : finished ? 'THAT IS A WRAP' :
        `QUESTION ${String(state.questionIndex + 1).padStart(2, '0')} / ${state.questionCount}`}</span></header>
    {!connected && <div className="tv-offline" role="alert">Connection lost. Buzzing is unavailable while reconnecting.</div>}
    <div className="tv-errors"><SessionError /></div>
    <section className="tv-stage">
      <div className={`panel clue-panel ${preGame ? 'lobby-cover-panel' : ''}`}>
        {preGame ? <QuizCover key={`${state.quizId}:${state.coverImage}`} title={state.settings.title} id={state.quizId} image={state.coverImage} />
          : finished ? <div className="tv-welcome"><span className="eyebrow">OUR {branding.name.toUpperCase()} CHAMPION</span>
            {winner ? <><Avatar id={winner.avatarId} /><h1>{winner.name}</h1><strong className="winner-score">{winner.score.toLocaleString()} points</strong></>
              : <h1>Thanks for playing!</h1>}<p>Same time next quiz?</p></div>
            : <QuestionClue state={state} />}
      </div>
      <aside className={`panel tv-buzzer ${lobby ? 'lobby-buzzer' : open ? 'is-open' : active ? 'is-answering' : ''}`}>
        <span className="eyebrow">{typed ? 'ANSWER STATUS' : 'BUZZER STATUS'}</span>
        <div className="buzzer-status"><span className="buzzer-orb" /><h2>{connected ? buzzerLabel(state) : 'RECONNECTING'}</h2></div>
        {lobby ? <div className="lobby-join"><JoinLink compact /></div>
          : active ? <div className="answering-player"><Avatar id={active.avatarId} /><h2>{active.name}</h2>
          {state.buzzResult ? <><strong className={state.buzzResult.correct ? 'positive' : 'negative'}>
            {state.buzzResult.delta > 0 ? '+' : ''}{state.buzzResult.delta} points</strong>
            <p>{state.buzzResult.correct ? 'Next question coming up.' : 'Buzzers reopen after the result.'}</p></>
            : <><strong>{state.pointsAtBuzz} points</strong><p>The floor is yours.</p></>}</div>
          : <div className="buzzer-idle"><span className="giant-q">?</span><p>{typed
            ? `${state.submissionCount} of ${state.players.length} submitted` : state.phase === 'MEDIA_FINISH' ? 'Watch the rest of the clue. Buzzing is closed.' : open ? 'Know the answer? Make your move.' : 'Eyes on the next clue.'}</p></div>}
        {!preGame && <div className="buzzer-footer"><span>{state.phase === 'MEDIA_FINISH' ? 'FINISHING CLUE / SCORE FROZEN' : state.clockRunning ? 'CLUE PLAYING' : 'CLUE PAUSED'}</span>
          <small>{state.phase === 'MEDIA_FINISH' ? 'Buzzing is closed' : typed ? 'Type your answer on your phone' : active ? 'No rush. Answer out loud.' : open ? 'First buzz takes the floor' : 'The gamemaster has control'}</small></div>}
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
    {(starting || nextRound) && <div className="game-start-overlay">
      <div className="game-start-ring" aria-hidden="true" />
      <div className="game-start-content">
        <span className="eyebrow">{nextRound ? 'NEXT ROUND' : 'THE GAME IS ABOUT TO BEGIN'}</span>
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong key={countdownText} className={`game-start-number ${countdownText === "LET'S GO!" ? 'game-start-go' : ''}`}>
            {countdownText}
          </strong>
        </div>
        <p>{connected ? 'Eyes on the screen. Get ready to play.' : 'Connection lost. Waiting to reconnect...'}</p>
      </div>
    </div>}
  </main>;
}
