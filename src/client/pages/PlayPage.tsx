import { useState, type FormEvent } from 'react';
import { avatars, type AvatarId } from '../../shared/protocol';
import { rankPlayers } from '../../shared/game';
import { useSession } from '../session';
import { Avatar, Brand, Connection, SessionError } from '../components/Common';

export function PlayPage() {
  const { state, connected, playerId, join, buzz, pending } = useSession();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<AvatarId>('fox');
  const player = state?.players.find((p) => p.id === playerId);
  const rank = state && player ? rankPlayers(state.players).findIndex((p) => p.id === playerId) + 1 : 0;
  const lockedOut = !!playerId && !!state?.lockedOutIds.includes(playerId);
  const answering = !!playerId && state?.activePlayerId === playerId;
  const open = state?.phase === 'QUESTION_OPEN' && !state.paused;
  const canBuzz = connected && open && !lockedOut && !!player && !pending;
  let status = 'Waiting for the host';
  let detail = 'The next question is on its way.';
  if (!connected) { status = 'Reconnecting'; detail = 'Your score and place are saved on the server.'; }
  else if (state?.phase === 'GAME_FINISHED') { status = 'That is a wrap!'; detail = 'Thanks for playing. See the TV for the final scores.'; }
  else if (answering) { status = 'You buzzed first!'; detail = 'Say your answer out loud. The host will make the call.'; }
  else if (lockedOut && (state?.phase === 'QUESTION_OPEN' || state?.phase === 'ANSWERING')) { status = 'Locked out'; detail = 'You have used your attempt. You are back in next question.'; }
  else if (state?.phase === 'ANSWERING') { status = 'Someone is answering'; detail = 'Hold tight. Buzzers may reopen after the ruling.'; }
  else if (state?.paused) { status = 'Host paused'; detail = 'Take a breath. We will be right back.'; }
  else if (open) { status = 'Buzz open'; detail = 'Know it? Buzz, then answer out loud.'; }
  else if (state && ['QUESTION_CLOSED', 'ANSWER_REVEALED'].includes(state.phase)) { status = 'Question closed'; detail = 'Eyes on the TV. The next clue is coming.'; }

  function submit(event: FormEvent) {
    event.preventDefault();
    void join({ name: name.trim(), avatarId: avatar });
  }

  return <main className="phone-shell">
    <header className="phone-header"><Brand /><Connection connected={connected} /></header>
    <SessionError />
    {!player ? <form className="panel join-form" onSubmit={submit}>
      <span className="eyebrow">YOUR BUZZER AWAITS</span><h1>Join the game</h1>
      <p>No account. Just a name and a little confidence.</p>
      <label>Your nickname<input autoComplete="nickname" maxLength={24} required value={name}
        onChange={(event) => setName(event.target.value)} placeholder="What should we call you?" /></label>
      <fieldset><legend>Choose your avatar</legend><div className="avatar-picker">
        {avatars.map((id) => <button type="button" key={id} className={avatar === id ? 'selected' : ''}
          aria-label={`Choose ${id}`} aria-pressed={avatar === id} onClick={() => setAvatar(id)}><Avatar id={id} /></button>)}
      </div></fieldset>
      <button className="primary wide" disabled={!connected || !name.trim() || pending}>{pending ? 'Joining...' : 'Join Quiz Night'}</button>
      <p className="footnote">Keep this page open while you play.</p>
    </form> : <>
      <section className="panel player-profile"><Avatar id={player.avatarId} /><div><span className="eyebrow">YOU'RE IN</span><h1>{player.name}</h1></div>
        <div className="personal-score"><strong>{player.score.toLocaleString()}</strong><span>RANK {rank} OF {state?.players.length}</span></div></section>
      <section className={`buzzer-card ${answering ? 'is-answering' : ''}`}>
        <span className="eyebrow">{state?.phase === 'LOBBY' ? 'LOBBY' : `QUESTION ${(state?.questionIndex ?? 0) + 1} / ${state?.questionCount}`}</span>
        <h2 role="status">{status}</h2><p>{detail}</p>
        <button className="buzz-button" disabled={!canBuzz} onClick={() => { void buzz(); }}>
          <span>{answering ? 'FIRST!' : 'BUZZ'}</span><small>{canBuzz ? `${state?.currentPoints} points at stake` : 'Eyes on the big screen'}</small>
        </button>
        {answering && <p className="frozen-points">{state?.pointsAtBuzz} points at stake / no answer countdown</p>}
      </section>
      <p className="footnote">Correct +points / Wrong -points<br />One attempt per question. Make it count.</p>
    </>}
  </main>;
}
