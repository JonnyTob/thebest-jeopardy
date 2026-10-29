import type { Player, ReviewGroup, Snapshot } from '../../shared/protocol';
import { useRef, type CSSProperties } from 'react';
import { REVIEW_GROUP_MS, REVIEW_RESULT_MS } from '../../shared/game';
import { Avatar, PointBar, typedTimerMs } from './Common';
import { Media } from './Media';

export function QuestionClue({ state }: { state: Snapshot }) {
  const typed = state.question?.mode === 'typed';
  const reviewedPlayer = state.players.find((player) => player.id === state.review?.playerId);
  const answeringPlayer = state.phase === 'ANSWERING' ? state.players.find((player) => player.id === state.activePlayerId) : undefined;
  const buzzResult = state.phase === 'BUZZ_RESULT' ? state.buzzResult : null;
  const buzzPlayer = state.players.find((player) => player.id === buzzResult?.playerId);
  const timerMs = typedTimerMs(state);
  const remainingMs = Math.max(0, timerMs - state.clueElapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const remainingPercent = timerMs > 0 ? Math.min(100, remainingMs / timerMs * 100) : 0;

  return <>
    <div className="clue-heading"><span className="eyebrow">THE QUESTION</span><h1>{state.question?.question}</h1></div>
    <div className="media-area"><Media state={state} />
      {state.revealedAnswer && <div className="answer-reveal"><span className="eyebrow">THE ANSWER</span><h2>{state.revealedAnswer}</h2></div>}
      {state.phase === 'REVIEW' && state.reviewResultId && state.review?.correct !== null && state.review?.correct !== undefined
        && <ReviewResultAnimation key={state.reviewResultId} correct={state.review.correct} remaining={state.reviewRemainingMs} />}
      {buzzResult && <ReviewResultAnimation key={buzzResult.id} correct={buzzResult.correct} remaining={buzzResult.remainingMs} />}
      {state.phase === 'REVIEW_GROUP' && state.reviewGroup && <ReviewGroupOverlay key={state.reviewGroup.id}
        group={state.reviewGroup} players={state.players} />}
      {state.phase === 'REVIEW' && state.review && <section className="review-overlay" aria-label="Current answer review" aria-live="polite" aria-atomic="true">
        <span className="eyebrow">ANSWER {state.reviewIndex + 1} / {state.reviewCount}</span>
        {reviewedPlayer && <div className="review-player"><Avatar id={reviewedPlayer.avatarId} /><h2>{reviewedPlayer.name}</h2></div>}
        <strong className="review-answer">{state.review.answer ?? 'No answer'}</strong>
        {state.review.correct !== null && <p className={state.review.correct ? 'positive' : 'negative'}>
          {state.review.correct ? `Correct +${state.question?.fixedPoints}` : state.review.answer === null ? 'No answer / +0' : 'Wrong / +0'}</p>}
      </section>}
      {answeringPlayer && <section className="review-overlay" aria-label="Player answering" aria-live="polite" aria-atomic="true">
        <span className="eyebrow">FIRST TO BUZZ</span>
        <div className="review-player"><Avatar id={answeringPlayer.avatarId} /><h2>{answeringPlayer.name}</h2></div>
        <strong className="review-answer">{state.pointsAtBuzz} points</strong>
      </section>}
      {buzzResult && <section className="review-overlay" aria-label="Buzzer answer result" aria-live="polite" aria-atomic="true">
        <span className="eyebrow">BUZZER ANSWER</span>
        {buzzPlayer && <div className="review-player"><Avatar id={buzzPlayer.avatarId} /><h2>{buzzPlayer.name}</h2></div>}
        <p className={buzzResult.correct ? 'positive review-answer' : 'negative review-answer'}>
          {buzzResult.correct ? 'Correct' : 'Wrong'} {buzzResult.delta > 0 ? '+' : ''}{buzzResult.delta}</p>
      </section>}
    </div>
    {typed ? <div className="point-bar">
      <div className="point-label"><span>TIME REMAINING</span><strong>{remainingSeconds} <small>s</small></strong></div>
      <div className="point-track" role="progressbar" aria-label="Time remaining"
        aria-valuenow={Math.round(remainingPercent)} aria-valuemin={0} aria-valuemax={100}
        aria-valuetext={`${remainingSeconds} seconds remaining`}>
        <div style={{ width: `${remainingPercent}%` }} />
      </div>
      <div className="point-meta"><strong>{state.question?.fixedPoints} fixed points</strong>
        <span>{state.clockRunning ? 'Clock running' : 'Clock frozen'}</span></div>
    </div> : <><PointBar state={state} /><div className="clue-countdown" aria-label="Question time remaining">
      Time remaining: {remainingSeconds}s</div></>}
  </>;
}

function ReviewGroupOverlay({ group, players }: { group: ReviewGroup; players: Player[] }) {
  // Keep the original offset across snapshots, including late reconnects.
  const delay = useRef(-Math.max(0, Math.min(REVIEW_GROUP_MS, REVIEW_GROUP_MS - group.remainingMs)));
  const correct = group.outcome === 'correct';
  const members = group.playerIds.flatMap((id) => players.find((player) => player.id === id) ?? []);
  return <section className={`review-group review-group-${group.outcome}`} aria-label="Grouped answer results"
    aria-live="polite" aria-atomic="true" style={{ animationDelay: `${delay.current}ms` }}>
    <ReviewResultAnimation correct={correct} remaining={group.remainingMs} duration={REVIEW_GROUP_MS} />
    <header className="review-group-heading"><span className="eyebrow">FAST APPROVAL / GROUP RESULT</span>
      <h2>{correct ? 'Correct answers' : 'Wrong or missing answers'}</h2></header>
    <ul className="review-group-grid" tabIndex={0} aria-label="Players in this group">
      {members.map((player) => <li key={player.id} className="review-group-player">
        <Avatar id={player.avatarId} /><strong>{player.name}</strong>
        <span className={correct ? 'positive' : 'negative'}>+{(correct ? group.points : 0).toLocaleString()}</span>
      </li>)}
    </ul>
  </section>;
}

function ReviewResultAnimation({ correct, remaining, duration = REVIEW_RESULT_MS }: { correct: boolean; remaining: number | null; duration?: number }) {
  // Capture the initial server offset once so snapshots do not restart the animation.
  const delay = useRef(-Math.max(0, Math.min(duration, duration - (remaining ?? 0))));
  return <div className={`review-result-animation ${correct ? 'review-result-correct' : 'review-result-wrong'}`} aria-hidden="true">
    {Array.from({ length: 10 }, (_, index) => <span key={index} className="review-result-item" style={{
      '--x': `${8 + index * 9.2}%`,
      '--drift': `${(index % 2 ? 1 : -1) * (35 + index * 9)}px`,
      '--spin': `${index % 2 ? 150 : -150}deg`,
      '--offset': `${index * 70}ms`,
      animationDelay: `calc(${delay.current}ms + var(--offset))`,
      animationDuration: `${duration}ms`,
    } as CSSProperties}>{correct ? '' : '$'}</span>)}
  </div>;
}
