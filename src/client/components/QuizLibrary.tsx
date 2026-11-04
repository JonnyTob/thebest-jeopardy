import { useEffect, useState, type FormEvent } from 'react';
import type { Snapshot } from '../../shared/protocol';

interface QuizEntry { id: number; title: string; questionCount: number; enabledCount: number; revision: string }

export function QuizLibrary({ passcode, state, connected, onEdit, onLive }: {
  passcode: string; state: Snapshot; connected: boolean; onEdit: (id: number) => void; onLive: () => void;
}) {
  const [quizzes, setQuizzes] = useState<QuizEntry[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmLoad, setConfirmLoad] = useState<QuizEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuizEntry | null>(null);

  async function request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('x-quiz-editor', '1');
    headers.set('x-host-passcode', encodeURIComponent(passcode));
    const response = await fetch(`/api/editor${url}`, { ...init, headers });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Unable to access quiz library.');
    return result;
  }
  async function refresh() {
    try { const result = await request('/library'); setQuizzes(result.quizzes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quiz library.'); }
  }
  useEffect(() => { void refresh(); }, [passcode]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const archive = await request('/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      setCreating(false); setTitle(''); onEdit(archive.quiz.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create quiz.'); }
    finally { setBusy(false); }
  }
  async function load(quiz: QuizEntry) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request('/library/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: quiz.id, revision: state.revision }) });
      setConfirmLoad(null); setMessage(`${quiz.title} loaded into the lobby.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quiz.'); }
    finally { setBusy(false); }
  }
  async function remove(quiz: QuizEntry) {
    setBusy(true); setError(''); setMessage('');
    try {
      await request(`/library/${quiz.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: quiz.revision }) });
      setQuizzes((current) => current.filter((entry) => entry.id !== quiz.id));
      setConfirmDelete(null); setMessage(`${quiz.title} and its media were deleted.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete quiz.'); }
    finally { setBusy(false); }
  }
  const filtered = quizzes.filter((quiz) => `${quiz.title} ${quiz.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <section className="panel quiz-library"><div className="quiz-library-heading"><div><span className="eyebrow">YOUR QUIZZES</span><h1>Quiz library</h1><p>Create, edit and choose a quiz for your next game.</p></div>
    <button className="primary" disabled={!connected || busy} onClick={() => setCreating(true)}>+ New quiz</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {creating && <form className="notice" onSubmit={(event) => { void create(event); }}><h2>Create a new quiz</h2>
      <label>Quiz title<input autoFocus maxLength={100} required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <p>A quiz ID and media folder are created automatically. Add questions in the editor before loading.</p>
      <div className="editor-actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button><button className="primary" disabled={busy || !title.trim()}>Create &amp; edit</button></div></form>}
    <div className="quiz-library-current"><div><span className="eyebrow">CURRENT QUIZ</span><h2>{state.settings.title}</h2><p>Quiz #{state.quizId} · {state.questionCount} questions · {state.phase === 'LOBBY' ? 'Lobby' : 'Game in progress'}</p></div>
      <div className="editor-actions"><button onClick={() => onEdit(state.quizId)}>Edit quiz</button><button className="primary" onClick={onLive}>Go to live game →</button></div></div>
    <div className="quiz-library-heading"><h2>All quizzes ({filtered.length})</h2><label>Search quizzes<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="quiz-library-list">{filtered.map((quiz) => <div className="quiz-library-row" key={quiz.id}><div><strong>{quiz.title}</strong><p>Quiz #{quiz.id} · {quiz.questionCount} questions{quiz.enabledCount === 0 ? ' · No enabled questions' : ''}</p></div>
      {quiz.id === state.quizId && <span className="quiz-library-badge">LOADED</span>}
      <div className="editor-actions"><button onClick={() => onEdit(quiz.id)}>Edit</button><button disabled={!connected || busy || state.phase !== 'LOBBY' || quiz.enabledCount === 0} onClick={() => { setConfirmDelete(null); setConfirmLoad(quiz); }}>{quiz.id === state.quizId ? 'Reload quiz' : 'Load quiz'}</button>
        <button className="danger" disabled={!connected || busy || quiz.id === state.quizId} title={quiz.id === state.quizId ? 'Load another quiz before deleting this one.' : undefined} aria-label={`Delete ${quiz.title}`} onClick={() => { setConfirmLoad(null); setError(''); setConfirmDelete(quiz); }}>Delete</button></div></div>)}</div>
    {!filtered.length && <p>No quizzes found.</p>}
    {state.phase !== 'LOBBY' && <p className="muted">Quizzes can be loaded in the lobby.</p>}
    {confirmLoad && <div className="notice" role="alert"><h2>Load {confirmLoad.title}?</h2><p>Players stay connected. Scores and quiz progress will be reset.</p><div className="editor-actions"><button onClick={() => setConfirmLoad(null)}>Cancel</button><button className="primary" disabled={busy || !connected || state.phase !== 'LOBBY'} onClick={() => { void load(confirmLoad); }}>Load quiz</button></div></div>}
    {confirmDelete && <div className="notice" role="alert"><h2>Delete {confirmDelete.title}?</h2><p>This permanently deletes Quiz #{confirmDelete.id}, its questions and all files in its media folder. This cannot be undone.</p><div className="editor-actions"><button disabled={busy} onClick={() => setConfirmDelete(null)}>Cancel</button><button className="danger" disabled={busy || !connected || confirmDelete.id === state.quizId} onClick={() => { void remove(confirmDelete); }}>Delete quiz and media</button></div></div>}
  </section>;
}
