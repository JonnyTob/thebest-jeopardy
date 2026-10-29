import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { archiveQuestionSchema, quizArchiveSchema, type ArchiveQuestion, type QuizArchive } from '../../shared/quizArchive';
import { settingsSchema, type Snapshot } from '../../shared/protocol';
import { commandId } from '../session';
import { QuestionPreview } from './QuestionPreview';

type Issue = { path: string; message: string };

export function QuizEditor({ passcode, onDirtyChange, gameState }: { passcode: string; onDirtyChange: (dirty: boolean) => void; gameState: Snapshot }) {
  const [archive, setArchive] = useState<QuizArchive | null>(null);
  const [original, setOriginal] = useState('');
  const [revision, setRevision] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ question: ArchiveQuestion; settings: Snapshot['settings']; index: number; count: number; generation: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const previewButton = useRef<HTMLButtonElement>(null);
  const dirty = archive !== null && JSON.stringify(archive) !== original;

  const request = useCallback(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-quiz-editor', '1');
    headers.set('x-host-passcode', encodeURIComponent(passcode));
    const response = await fetch(`/api/editor${url}`, { ...init, headers });
    const result: unknown = await response.json();
    if (!response.ok) {
      const body = result as { error?: string; issues?: Issue[] };
      setIssues(body.issues ?? []);
      throw new Error(body.error ?? `Request failed (${response.status}).`);
    }
    return result;
  }, [passcode]);

  const load = useCallback(async () => {
    setBusy(true); setError(''); setIssues([]);
    try {
      const [data, media] = await Promise.all([request('/archive'), request('/media')]);
      const result = data as { archive: unknown; revision: string };
      const parsed = quizArchiveSchema.parse(result.archive);
      setArchive(parsed); setOriginal(JSON.stringify(parsed)); setRevision(result.revision);
      setFiles((media as { files: string[] }).files); setSelected(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quiz editor.'); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!archive) return;
    const parsed = quizArchiveSchema.safeParse(archive);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
      setError('Correct the validation errors before saving.'); return;
    }
    setBusy(true); setError(''); setIssues([]); setMessage('');
    try {
      const result = await request('/archive', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: parsed.data, revision }) }) as { revision: string };
      setArchive(parsed.data); setOriginal(JSON.stringify(parsed.data)); setRevision(result.revision);
      setMessage('Saved. Restart the server to load quiz changes; restarting clears players and scores.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await request('/media', { method: 'POST', headers: {
        'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name),
      }, body: file }) as { file: string };
      setFiles((current) => [...current, result.file].sort());
      setMessage(`Uploaded ${result.file}. Select it below. Uploaded files remain even if quiz changes are discarded.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { setBusy(false); }
  }
  async function removeFile(file: string) {
    if (!archive) return;
    if (archive.quiz.coverImage === file || archive.questions.some((q) => q.media === file)) {
      setError('This file is referenced by your current edits. Remove those references before deleting it.'); return;
    }
    if (!window.confirm(`Permanently delete ${file}?`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await request('/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
      setFiles((current) => current.filter((value) => value !== file));
      setMessage('Media file deleted.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Delete failed.'); }
    finally { setBusy(false); }
  }
  if (!archive) return <section className="panel"><h1>Quiz editor</h1>{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => { void load(); }}>{busy ? 'Loading...' : 'Try again'}</button></section>;

  const question = archive.questions[selected];
  function updateQuestion(patch: Partial<ArchiveQuestion>) {
    setArchive((current) => current && ({ ...current, questions: current.questions.map((q, index) => index === selected ? { ...q, ...patch } : q) }));
  }
  function changeType(type: ArchiveQuestion['type']) {
    if (type !== question.type && (question.text || question.media || question.reveal || question.playback || question.visualizer)
      && !window.confirm('Changing clue type removes fields specific to the current type. Continue?')) return;
    const { text, media, reveal, playback, visualizer, ...rest } = question;
    updateQuestion({ ...rest, type, text: type === 'text' ? text : undefined,
      media: type !== 'text' ? media : undefined, reveal: type === 'image' ? reveal : undefined,
      playback: type === 'audio' || type === 'video' ? playback : undefined,
      visualizer: type === 'audio' ? visualizer : undefined });
  }
  function addQuestion(copy: boolean) {
    const next: ArchiveQuestion = copy ? { ...structuredClone(question), id: commandId() }
      : { id: commandId(), type: 'text', mode: 'buzzer', question: '', answer: '' };
    const questions = [...archive!.questions, next];
    setArchive({ ...archive!, questions }); setSelected(questions.length - 1);
  }
  function move(delta: number) {
    const target = selected + delta;
    if (target < 0 || target >= archive!.questions.length) return;
    const questions = [...archive!.questions];
    [questions[selected], questions[target]] = [questions[target], questions[selected]];
    setArchive({ ...archive!, questions }); setSelected(target);
  }
  function openPreview() {
    const parsed = archiveQuestionSchema.safeParse({ ...question, answer: 'Preview only' });
    const settings = settingsSchema.safeParse({ ...gameState.settings, ...archive!.gameSetup, title: archive!.quiz.title });
    if (!parsed.success || !settings.success) {
      const errors = [
        ...(!parsed.success ? parsed.error.issues.map((issue) => ({ path: `questions.${selected}.${issue.path.join('.')}`, message: issue.message })) : []),
        ...(!settings.success ? settings.error.issues.map((issue) => ({ path: `settings.${issue.path.join('.')}`, message: issue.message })) : []),
      ];
      setIssues(errors);
      setPreviewError(errors.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
      setError('Correct these fields before previewing the question. An answer is not required for preview.');
      return;
    }
    if (parsed.data.media && !files.includes(parsed.data.media)) {
      setError(`Media not found: ${parsed.data.media}`); setPreviewError(`Media not found: ${parsed.data.media}`); setIssues([]); return;
    }
    setError(''); setPreviewError(''); setIssues([]);
    setPreview((current) => ({ question: parsed.data, settings: settings.data, index: selected, count: archive!.questions.length,
      generation: (current?.generation ?? 0) + 1 }));
  }
  const mediaSelect = (value: string | undefined, change: (value: string | undefined) => void, type: 'image' | 'audio' | 'video') => <select value={value ?? ''} onChange={(event) => change(event.target.value || undefined)}>
    <option value="">Select media</option>
    {value && (!files.includes(value) || !matchesType(value, type)) && <option value={value}>{value} {!files.includes(value) ? '(missing)' : '(different type)'}</option>}
    {files.filter((file) => matchesType(file, type)).map((file) => <option key={file} value={file}>{file}</option>)}
  </select>;
  return <section className="panel quiz-editor"><h1>Quiz editor</h1>
    <p>Editing Quiz #{archive.quiz.id}. Saved changes apply after a server restart, not to the current game.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {issues.length > 0 && <ul role="alert">{issues.map((issue, index) => <li key={index}>{issue.path || 'Quiz'}: {issue.message}</li>)}</ul>}
    <fieldset disabled={busy}>
      <label>Quiz title<input value={archive.quiz.title} onChange={(event) => setArchive({ ...archive, quiz: { ...archive.quiz, title: event.target.value } })} /></label>
      <label>Cover image{mediaSelect(archive.quiz.coverImage, (value) => setArchive({ ...archive, quiz: { ...archive.quiz, coverImage: value } }), 'image')}</label>
      <div className="editor-actions"><button className="primary" onClick={() => { void save(); }}>Save quiz</button>
        <button onClick={() => { if (!dirty || window.confirm('Discard unsaved quiz changes and reload?')) void load(); }}>Reload saved quiz</button>
        <span>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
      <div className="editor-grid"><div>
        <h2>Questions ({archive.questions.length})</h2>
        <ol className="editor-list">{archive.questions.map((q, index) => <li key={q.id}>
          <button className={index === selected ? 'active' : ''} onClick={() => setSelected(index)}>{q.keyword || q.question || 'Untitled question'}</button></li>)}</ol>
        <div className="editor-actions"><button disabled={archive.questions.length >= 500} onClick={() => addQuestion(false)}>Add question</button>
          <button disabled={archive.questions.length >= 500} onClick={() => addQuestion(true)}>Duplicate</button>
          <button disabled={selected === 0} onClick={() => move(-1)}>Move up</button>
          <button disabled={selected === archive.questions.length - 1} onClick={() => move(1)}>Move down</button>
          <button disabled={archive.questions.length === 1} onClick={() => {
            if (!window.confirm('Delete this question?')) return;
            setArchive({ ...archive, questions: archive.questions.filter((_, index) => index !== selected) });
            setSelected(Math.max(0, selected - 1));
          }}>Delete question</button></div>
      </div><div className="editor-fields"><div className="editor-question-heading"><h2>Question {selected + 1}</h2>
        <button className="small primary" ref={previewButton} type="button" onClick={openPreview}>Preview question</button></div>
        <label>Keyword (optional)<input value={question.keyword ?? ''} onChange={(event) => updateQuestion({ keyword: event.target.value || undefined })} /></label>
        <label>Question<textarea rows={1} value={question.question} onChange={(event) => updateQuestion({ question: event.target.value })} /></label>
        <label>Answer<textarea rows={1} value={question.answer} onChange={(event) => updateQuestion({ answer: event.target.value })} /></label>
        <label>Mode<select value={question.mode} onChange={(event) => {
          const mode = event.target.value === 'typed' ? 'typed' : 'buzzer';
          if (mode === 'buzzer' && question.mode === 'typed' && !window.confirm('Changing to buzzer removes typed points and timer. Continue?')) return;
          updateQuestion({ mode, fixedPoints: mode === 'typed' ? 250 : undefined, timerSeconds: mode === 'typed' ? 30 : undefined });
        }}><option value="buzzer">Buzzer</option><option value="typed">Typed</option></select></label>
        {question.mode === 'typed' && <><label>Fixed points<input type="number" value={question.fixedPoints ?? ''} onChange={(event) => updateQuestion({ fixedPoints: Number(event.target.value) })} /></label>
          <label>Timer seconds<input type="number" value={question.timerSeconds ?? ''} onChange={(event) => updateQuestion({ timerSeconds: Number(event.target.value) })} /></label></>}
        <label>Clue type<select value={question.type} onChange={(event) => changeType(event.target.value as ArchiveQuestion['type'])}>
          <option value="text">Text</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option></select></label>
        {question.type === 'text' ? <label>Clue text (optional)<textarea rows={1} value={question.text ?? ''} onChange={(event) => updateQuestion({ text: event.target.value || undefined })} /></label>
          : <label>Clue media{mediaSelect(question.media, (value) => updateQuestion({ media: value }), question.type)}</label>}
        {question.type === 'image' && <><label>Reveal effect<select value={question.reveal?.effect ?? 'static'} onChange={(event) => updateQuestion({ reveal: { ...question.reveal, effect: event.target.value === 'tiles' ? 'tiles' : 'static' } })}><option value="static">Static</option><option value="tiles">Tiles</option></select></label>
          {question.reveal?.effect === 'tiles' && (['durationSeconds', 'columns', 'rows', 'seed'] as const).map((field) => <label key={field}>{field}<input type="number" value={question.reveal?.[field] ?? ''} placeholder="Default" onChange={(event) => updateQuestion({ reveal: { ...question.reveal, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>)}</>}
        {(question.type === 'audio' || question.type === 'video') && (['startSeconds', 'endSeconds'] as const).map((field) => <label key={field}>Playback {field}<input type="number" step="any" value={question.playback?.[field] ?? ''} onChange={(event) => updateQuestion({ playback: { ...question.playback, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>)}
        {question.type === 'audio' && <label><input type="checkbox" checked={question.visualizer?.enabled ?? false} onChange={(event) => updateQuestion({ visualizer: { enabled: event.target.checked, style: 'spectrum' } })} /> Show audio visualizer</label>}
      </div></div>
      {preview && <QuestionPreview preview={preview} generation={preview.generation} gameState={gameState}
        onRefresh={openPreview} error={previewError} onClose={() => { setPreview(null); setPreviewError(''); previewButton.current?.focus(); }} />}
      <h2>Media library</h2><p>Upload up to 50 MB. Playback depends on the TV browser's supported formats. Uploaded files are saved immediately.</p>
      <label>Upload media<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.ogg,.mp4,.webm" onChange={(event) => { void upload(event); }} /></label>
      <ul className="editor-media">{files.map((file) => <li key={file}><MediaPreview file={file} /><span>{file}</span><button onClick={() => { void removeFile(file); }}>Delete</button></li>)}</ul>
    </fieldset>
  </section>;
}

function MediaPreview({ file }: { file: string }) {
  const url = `/media/quiz/${file.slice('media/'.length)}`;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file)) return <img src={url} alt="" />;
  if (/\.(mp3|wav|ogg)$/i.test(file)) return <audio controls preload="none" src={url} />;
  if (/\.(mp4|webm)$/i.test(file)) return <video controls preload="metadata" src={url} />;
  return null;
}

function matchesType(file: string, type: 'image' | 'audio' | 'video'): boolean {
  return type === 'image' ? /\.(png|jpe?g|gif|webp|svg)$/i.test(file)
    : type === 'audio' ? /\.(mp3|wav|ogg)$/i.test(file) : /\.(mp4|webm)$/i.test(file);
}
