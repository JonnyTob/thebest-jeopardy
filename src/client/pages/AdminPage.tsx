import { useState, type FormEvent } from 'react';
import { rankPlayers } from '../../shared/game';
import { settingsSchema, type Player, type Settings, type Snapshot } from '../../shared/protocol';
import { SessionProvider, useSession } from '../session';
import { Avatar, Brand, Connection, JoinLink, PointBar, QuizName, SessionError, buzzerLabel } from '../components/Common';
import { Media } from '../components/Media';

const passcodeKey = 'quiz-night-host-passcode';

export function AdminPage() {
  const [passcode, setPasscode] = useState(() => sessionStorage.getItem(passcodeKey) ?? '');
  const [input, setInput] = useState('');
  function login(event: FormEvent) {
    event.preventDefault();
    sessionStorage.setItem(passcodeKey, input);
    setPasscode(input);
  }
  if (!passcode) return <main className="login-shell"><Brand subtitle="Private host console" />
    <form className="panel" onSubmit={login}><span className="eyebrow">YOU'RE RUNNING THE SHOW</span><h1>Welcome, gamemaster.</h1>
      <p>Enter the host passcode printed in the server terminal. Keep this screen off the TV.</p>
      <label>Host passcode<input type="password" autoComplete="current-password" required value={input} onChange={(event) => setInput(event.target.value)} /></label>
      <button className="primary wide">Unlock host console</button></form></main>;
  return <SessionProvider key={passcode} role="host" passcode={passcode}><AdminConsole logout={() => {
    sessionStorage.removeItem(passcodeKey);
    setPasscode('');
    setInput('');
  }} /></SessionProvider>;
}

function AdminConsole({ logout }: { logout: () => void }) {
  const { state, connected, command, pending } = useSession();
  const [tab, setTab] = useState<'live' | 'setup'>('live');
  const [confirm, setConfirm] = useState(false);
  const active = state?.players.find((p) => p.id === state.activePlayerId);
  const isOpen = state?.phase === 'QUESTION_OPEN';
  const answering = state?.phase === 'ANSWERING';
  const closed = state?.phase === 'QUESTION_CLOSED' || state?.phase === 'ANSWER_REVEALED';
  const disabled = !connected || pending;
  return <main className="admin-shell">
    <header className="admin-header"><Brand subtitle="Private host console" />
      <nav aria-label="Host sections"><button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Live game</button>
        <button className={tab === 'setup' ? 'active' : ''} onClick={() => setTab('setup')}>Game setup</button></nav>
      <div className="header-actions"><Connection connected={connected} /><a href="/display" target="_blank" rel="noreferrer">Open TV &nearr;</a>
        <button className="quiet" onClick={logout}>Lock console</button></div></header>
    <SessionError />
    {!connected && <div className="notice" role="status">Host controls are disabled until connected. If the passcode was rejected, lock the console and try again.</div>}
    {!state ? <section className="panel"><h1>Connecting to the game...</h1></section>
      : tab === 'setup' ? <Setup state={state} /> : <>
        <section className="panel game-heading"><div><span className="eyebrow">{state.phase === 'LOBBY' ? "LET'S GET EVERYONE IN" : 'YOU CALL THE SHOTS'}</span>
          <h1><QuizName title={state.settings.title} id={state.quizId} /></h1><p>{state.phase === 'LOBBY' ? 'Lobby open / waiting for players' :
            state.phase === 'GAME_FINISHED' ? 'Game finished / final standings' :
              `Question ${state.questionIndex + 1} of ${state.questionCount} / ${buzzerLabel(state).toLowerCase()}`}</p></div>
          <div className={`phase-pill ${answering ? 'amber' : ''}`}>{state.phase.replaceAll('_', ' ')}</div></section>
        {state.phase === 'LOBBY' ? <section className="panel lobby-controls"><JoinLink />
          <div><h2>Ready when you are.</h2><p>Open the TV display, get everyone on the same Wi-Fi, then start the first clue.</p>
            <button className="primary wide" disabled={disabled} onClick={() => { void command({ type: 'start' }); }}>Start quiz</button></div></section>
          : state.phase === 'GAME_FINISHED' ? <section className="panel"><h2>Final standings</h2><p>Scores are still adjustable below. Restart the server for a new session.</p></section>
            : <div className="admin-game-grid">
              <section className="panel admin-question"><span className="eyebrow">CURRENT QUESTION / {state.question?.type.toUpperCase()}</span>
                <h2>{state.question?.question}</h2><div className="admin-media"><Media state={state} preview /></div>
                <div className="private-answer"><span className="eyebrow">PRIVATE ANSWER / HOST ONLY</span><strong>{state.privateAnswer}</strong></div>
                <PointBar state={state} /></section>
              <section className="panel game-actions"><span className="eyebrow">GAME ACTIONS</span>
                {active ? <div className="host-answering"><Avatar id={active.avatarId} /><div><h2>{active.name}</h2>
                  <p>{state.pointsAtBuzz} frozen points / answering aloud</p></div></div> : <h2>{buzzerLabel(state)}</h2>}
                <div className="ruling-buttons"><button className="success" disabled={disabled || !answering}
                  onClick={() => { void command({ type: 'judge', correct: true }); }}>Correct +{state.pointsAtBuzz ?? state.currentPoints}</button>
                  <button className="danger" disabled={disabled || !answering}
                    onClick={() => { void command({ type: 'judge', correct: false }); }}>Wrong -{state.pointsAtBuzz ?? state.currentPoints}</button></div>
                <button disabled={disabled || !isOpen} onClick={() => { void command({ type: state.paused ? 'resume' : 'pause' }); }}>
                  {state.paused ? 'Resume clue & buzzers' : 'Pause clue & buzzers'}</button>
                <button disabled={disabled || !isOpen} onClick={() => { void command({ type: 'restartMedia' }); }}>Restart media only</button>
                <button disabled={disabled || !(isOpen || answering)} onClick={() => { void command({ type: 'close' }); }}>Close / skip question</button>
                <button disabled={disabled || state.phase !== 'QUESTION_CLOSED'} onClick={() => { void command({ type: 'reveal' }); }}>Reveal answer on TV</button>
                <button className="primary" disabled={disabled || !closed} onClick={() => { void command({ type: 'next' }); }}>
                  {state.questionIndex === state.questionCount - 1 ? 'Finish quiz' : 'Next question'} &rarr;</button>
                <div className="action-divider" />
                <button disabled={disabled || !state.canUndo} onClick={() => { void command({ type: 'undo' }); }}>Undo last score change</button>
                {confirm ? <div className="notice"><p>Reopen this clue at full value and clear lockouts? Existing scores stay unchanged.</p>
                  <button className="danger" disabled={disabled} onClick={() => { void command({ type: 'reset' }).then((ok) => { if (ok) setConfirm(false); }); }}>Confirm reset</button>
                  <button className="quiet" onClick={() => setConfirm(false)}>Cancel</button></div>
                  : <button className="quiet" disabled={disabled} onClick={() => setConfirm(true)}>Reset this question...</button>}
              </section>
            </div>}
        <div className="admin-bottom-grid"><PlayerTable state={state} /><section className="panel game-log"><span className="eyebrow">SCORE LOG</span><h2>The night's numbers</h2>
          <button disabled={disabled || !state.canUndo} onClick={() => { void command({ type: 'undo' }); }}>Undo last score change</button>
          {state.scoreEvents.length ? <ol>{state.scoreEvents.map((event) => <li key={event.id}><span>{event.description}</span>
            <strong className={event.delta < 0 ? 'negative' : 'positive'}>{event.delta > 0 ? '+' : ''}{event.delta}</strong></li>)}</ol>
            : <p className="muted">No score changes yet. All rulings and manual adjustments appear here.</p>}</section></div>
      </>}
  </main>;
}

function PlayerTable({ state }: { state: Snapshot }) {
  const { command, pending, connected } = useSession();
  const [sort, setSort] = useState('rank');
  const [search, setSearch] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const ranks = rankPlayers(state.players);
  const players = [...ranks].filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'connection') return Number(b.connected) - Number(a.connected) || a.joinedOrder - b.joinedOrder;
    return 0;
  });
  const activeClue = state.phase === 'QUESTION_OPEN' || state.phase === 'ANSWERING';
  return <section className="panel players-panel"><div className="table-heading"><h2>Players <span className="count-badge">{state.players.length}</span></h2>
    <input aria-label="Search players" placeholder="Search players" value={search} onChange={(event) => setSearch(event.target.value)} />
    <select aria-label="Sort players" value={sort} onChange={(event) => setSort(event.target.value)}>
      <option value="rank">Sort: score / rank</option><option value="name">Sort: name</option><option value="connection">Sort: connection</option></select></div>
    <div className="table-scroll"><table><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Connection</th><th>Eligibility</th><th>Adjust points</th><th>Manage</th></tr></thead>
      <tbody>{players.map((player) => <tr key={player.id}><td>{ranks.findIndex((p) => p.id === player.id) + 1}</td>
        <td><div className="table-player"><Avatar id={player.avatarId} /><strong>{player.name}</strong></div></td>
        <td className={player.score < 0 ? 'negative score-cell' : 'score-cell'}>{player.score.toLocaleString()}</td>
        <td><span className={player.connected ? 'positive' : 'muted'}>{player.connected ? 'Online' : 'Offline'}</span></td>
        <td><span className={`eligibility ${player.id === state.activePlayerId ? 'amber' : ''}`}>
          {player.id === state.activePlayerId ? 'Answering' : state.lockedOutIds.includes(player.id) && activeClue ? 'Locked out' :
            state.phase === 'QUESTION_OPEN' && !state.paused && player.connected ? 'Ready' : 'Waiting'}</span></td>
        <td><ScoreAdjustment player={player} /></td><td><button className="quiet small" disabled={pending || !connected || activeClue}
          onClick={() => setRemoveId(player.id)}>Remove</button></td></tr>)}</tbody></table>
      {!players.length && <p className="empty-state">{state.players.length ? 'No matching players.' : 'The lobby is open. Players will appear here as they join.'}</p>}</div>
    {removeId && <div className="notice"><p>Remove {state.players.find((p) => p.id === removeId)?.name} and their score? This cannot be undone.</p>
      <button className="danger" disabled={pending || !connected || activeClue} onClick={() => { void command({ type: 'removePlayer', playerId: removeId }).then((ok) => { if (ok) setRemoveId(null); }); }}>Confirm remove</button>
      <button className="quiet" onClick={() => setRemoveId(null)}>Cancel</button></div>}
  </section>;
}

function ScoreAdjustment({ player }: { player: Player }) {
  const { command, pending, connected } = useSession();
  const [delta, setDelta] = useState('');
  return <form className="score-adjust" onSubmit={(event) => {
    event.preventDefault();
    void command({ type: 'adjust', playerId: player.id, delta: Number(delta) }).then((ok) => { if (ok) setDelta(''); });
  }}><input type="number" step="1" min="-100000" max="100000" required placeholder="+/-"
    aria-label={`Adjust ${player.name}'s score`} value={delta} onChange={(event) => setDelta(event.target.value)} />
    <button className="small" disabled={pending || !connected || !delta || Number(delta) === 0}>Apply</button></form>;
}

function Setup({ state }: { state: Snapshot }) {
  const { command, connected, pending } = useSession();
  const [settings, setSettings] = useState<Settings>(state.settings);
  const [message, setMessage] = useState('');
  const editable = state.phase === 'LOBBY';
  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    void command({ type: 'setup', settings: parsed.data }).then((ok) => { if (ok) setMessage('Game setup saved.'); });
  }
  return <div className="setup-grid"><form className="panel setup-form" onSubmit={save}><span className="eyebrow">MAKE IT YOUR NIGHT</span><h1>Game setup</h1>
    <QuizName title={settings.title} id={state.quizId} />
    {!editable && <p className="notice">Setup is locked once the quiz starts.</p>}
    <fieldset disabled={!editable || !connected || pending}>
      <label>Quiz title<input required maxLength={100} value={settings.title} onChange={(event) => setSettings({ ...settings, title: event.target.value })} /></label>
      <div className="settings-fields">{([
        ['leaderboardCount', 'TV leaderboard cards', 1, 12],
        ['startPoints', 'Starting points', 1, 10000],
        ['minimumPoints', 'Minimum points', 1, 10000],
        ['dropPoints', 'Points dropped per step', 1, 10000],
        ['dropEverySeconds', 'Seconds between drops', 1, 120],
      ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input type="number" required min={min} max={max} step="1"
        value={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: Number(event.target.value) })} /></label>)}</div>
      <button className="primary" type="submit">Save setup</button></fieldset>
    {message && <p role="status">{message}</p>}
    <p className="muted">Wrong answers always lose the frozen point value. The minimum value is not a deadline.</p>
  </form><section className="panel setup-guide"><h2>Before you start</h2><ol><li>Connect the TV and choose <strong>Extend</strong>, not Duplicate.</li>
    <li>Open <a href="/display" target="_blank" rel="noreferrer">the TV display</a> there and press F11.</li><li>Keep this private console on the laptop.</li>
    <li>Join phones on the same Wi-Fi. Allow the server port through the firewall.</li><li>For audio/video clues, enable playback in the TV browser.</li></ol>
    <h3>Question source</h3><code>src/data/questions.json</code><p>{state.questionCount} questions loaded. Edit this file and restart the server to load a different quiz. Restarting clears players and scores.</p>
    <h3>Avatars & theme</h3><p>Six original, bundled SVG characters. Purple, gold, and magenta game-show theme.</p><JoinLink compact /></section></div>;
}
