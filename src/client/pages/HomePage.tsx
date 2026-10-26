import { Link } from 'react-router-dom';
import { Brand, JoinLink } from '../components/Common';

export function HomePage() {
  return <main className="landing">
    <Brand subtitle="Your living room. Your game show." />
    <div className="hero"><span className="eyebrow">A LITTLE COMPETITION. A GREAT NIGHT.</span>
      <h1>Big screen.<br /><em>Quick thinking.</em></h1>
      <p>One quiz. Everyone in the room. Choose your screen to get started.</p></div>
    <div className="role-grid">
      <Link className="panel role-card" to="/admin"><span className="role-number">01 / HOST</span>
        <h2>Run the show</h2><p>Your private control room. Open clues, judge answers, and keep the scores.</p><strong>Open host console &rarr;</strong></Link>
      <Link className="panel role-card" to="/display"><span className="role-number">02 / BIG SCREEN</span>
        <h2>Set the stage</h2><p>Clues, buzzers, and the leaderboard. Put this screen on your TV.</p><strong>Open TV display &rarr;</strong></Link>
      <Link className="panel role-card" to="/play"><span className="role-number">03 / PLAYER</span>
        <h2>Get in the game</h2><p>Choose your avatar and trust your instincts. Your phone is your buzzer.</p><strong>Join the quiz &rarr;</strong></Link>
    </div>
    <section className="panel"><JoinLink /></section>
    <p className="footnote">Local multiplayer / Verbal answers / Gamemaster scoring / No account needed</p>
  </main>;
}
