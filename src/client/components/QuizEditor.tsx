import { useCallback, useEffect, useRef, useState } from 'react';
import { archiveQuestionSchema, quizArchiveSchema, type ArchiveQuestion, type QuizArchive } from '../../shared/quizArchive';
import type { LoadedMediaReference } from '../../shared/mediaLibrary';
import { settingsSchema, type Snapshot } from '../../shared/protocol';
import { commandId } from '../session';
import { QuestionPreview } from './QuestionPreview';
import { MediaBrowser, MediaPicker, mediaType, type MediaType } from './MediaLibrary';

type Issue = { path: string; message: string };

function VideoDuration({ file }: { file: string }) {
  const [duration, setDuration] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    setDuration(null);
    setUnavailable(false);
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
      else setUnavailable(true);
    };
    video.onerror = () => setUnavailable(true);
    video.src = `/media/quiz/${file.slice('media/'.length)}`;
    return () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [file]);
  return <span className="editor-video-duration">Duration: {duration !== null ? `${duration.toFixed(1)} s` : unavailable ? 'unavailable' : 'loading…'}</span>;
}

export function QuizEditor({ passcode, onDirtyChange, gameState }: { passcode: string; onDirtyChange: (dirty: boolean) => void; gameState: Snapshot }) {
  const [archive, setArchive] = useState<QuizArchive | null>(null);
  const [savedArchive, setSavedArchive] = useState<QuizArchive | null>(null);
  const [original, setOriginal] = useState('');
  const [revision, setRevision] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [loadedReferences, setLoadedReferences] = useState<LoadedMediaReference[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [message, setMessage] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ question: ArchiveQuestion; settings: Snapshot['settings']; index: number; count: number; generation: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [picker, setPicker] = useState<{ type: MediaType; initial?: string; target: 'cover' | string } | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const pickerButton = useRef<HTMLButtonElement | null>(null);
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
      setArchive(parsed); setSavedArchive(parsed); setOriginal(JSON.stringify(parsed)); setRevision(result.revision);
      const library = media as { files: string[]; loadedReferences: LoadedMediaReference[] };
      setFiles(library.files); setLoadedReferences(library.loadedReferences); setSelected(0); setMediaError('');
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
      setArchive(parsed.data); setSavedArchive(parsed.data); setOriginal(JSON.stringify(parsed.data)); setRevision(result.revision);
      setMessage('Saved. Use Restart Quiz in development (or restart the server in production) to load changes; restarting clears players and scores.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  async function upload(file: File): Promise<string | undefined> {
    setBusy(true); setMediaError(''); setMessage('');
    try {
      const result = await request('/media', { method: 'POST', headers: {
        'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name),
      }, body: file }) as { file: string };
      setFiles((current) => [...current, result.file].sort());
      setMessage(`Uploaded ${result.file}. Uploaded files remain even if quiz changes are discarded.`);
      return result.file;
    } catch (cause) { setMediaError(cause instanceof Error ? cause.message : 'Upload failed.'); return undefined; }
    finally { setBusy(false); }
  }
  async function refreshMedia() {
    setBusy(true); setMediaError('');
    try {
      const library = await request('/media') as { files: string[]; loadedReferences: LoadedMediaReference[] };
      setFiles(library.files); setLoadedReferences(library.loadedReferences);
    } catch (cause) { setMediaError(cause instanceof Error ? cause.message : 'Unable to refresh media.'); }
    finally { setBusy(false); }
  }
  async function removeFile(file: string): Promise<boolean> {
    if (!archive) { setMediaError('Quiz editor is not loaded.'); return false; }
    setMediaError('');
    if (archive.quiz.coverImage === file || archive.questions.some((q) => q.media === file)) {
      setMediaError('This file is referenced by your current edits. Remove those references before deleting it.'); return false;
    }
    if (!window.confirm(`Permanently delete ${file}?`)) return false;
    setBusy(true); setMessage('');
    try {
      await request('/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file }) });
      setFiles((current) => current.filter((value) => value !== file));
      setMessage('Media file deleted.');
      return true;
    } catch (cause) { setMediaError(cause instanceof Error ? cause.message : 'Delete failed.'); return false; }
    finally { setBusy(false); }
  }
  if (!archive || !savedArchive) return <section className="panel"><h1>Quiz editor</h1>{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => { void load(); }}>{busy ? 'Loading...' : 'Try again'}</button></section>;

  const question = archive.questions[selected];
  function updateQuestion(patch: Partial<ArchiveQuestion>) {
    setArchive((current) => current && ({ ...current, questions: current.questions.map((q, index) => index === selected ? { ...q, ...patch } : q) }));
  }
  function changeType(type: ArchiveQuestion['type']) {
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
  function mediaField(label: string, value: string | undefined, type: MediaType, target: string, clear: () => void) {
    return <div className="editor-media-field">
      <span>{label}</span>
      <div className="editor-actions"><span>{value || 'No file selected'} {value && (!files.includes(value) ? '(missing)' : mediaType(value) !== type ? '(different type)' : '')}</span>
        <button type="button" aria-label={`Choose ${label.toLowerCase()}`} onClick={(event) => {
          pickerButton.current = event.currentTarget; setMediaError(''); setPicker({ type, target, initial: value });
        }}>Choose media</button>
        {value && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={clear}>Clear</button>}
        {type === 'video' && value && files.includes(value) && mediaType(value) === 'video' && <VideoDuration key={value} file={value} />}
      </div>
    </div>;
  }
  return <section className="panel quiz-editor"><h1>Quiz editor</h1>
    <p>Editing Quiz #{archive.quiz.id}. Saved changes apply after Restart Quiz in development or a server restart in production.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {issues.length > 0 && <ul role="alert">{issues.map((issue, index) => <li key={index}>{issue.path || 'Quiz'}: {issue.message}</li>)}</ul>}
    <fieldset disabled={busy}>
      <label>Quiz title<input value={archive.quiz.title} onChange={(event) => setArchive({ ...archive, quiz: { ...archive.quiz, title: event.target.value } })} /></label>
      {mediaField('Cover image', archive.quiz.coverImage, 'image', 'cover', () => setArchive({ ...archive, quiz: { ...archive.quiz, coverImage: undefined } }))}
      <div className="editor-actions"><button className="primary" onClick={() => { void save(); }}>Save quiz</button>
        <button onClick={() => { if (!dirty || window.confirm('Discard unsaved quiz changes and reload?')) void load(); }}>Reload saved quiz</button>
        <span>{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
      <div className="editor-grid"><div>
        <h2>Questions ({archive.questions.length})</h2>
        <ol className="editor-list">{archive.questions.map((q, index) => <li key={q.id}>
          <button className={index === selected ? 'active' : ''} onClick={() => setSelected(index)}>
            <span className="editor-question-title">{q.keyword || q.question || 'Untitled question'}</span>
            <span className={`editor-question-mode ${q.mode}`}>{q.mode === 'typed' ? 'Typed' : 'Buzzer'}</span>
          </button></li>)}</ol>
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
          updateQuestion({ mode, fixedPoints: mode === 'typed' ? 250 : undefined });
        }}><option value="buzzer">Buzzer</option><option value="typed">Typed</option></select></label>
        {question.mode === 'typed' && <label>Fixed points<input type="number" value={question.fixedPoints ?? ''} onChange={(event) => updateQuestion({ fixedPoints: Number(event.target.value) })} /></label>}
        <label>Timer countdown (seconds)<input type="number" min={1} max={3600} placeholder={`Inherit global (${archive.gameSetup?.questionTimerSeconds ?? gameState.settings.questionTimerSeconds}s)`}
          value={question.timerSeconds ?? ''} onChange={(event) => updateQuestion({ timerSeconds: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        <label>Clue type<select value={question.type} onChange={(event) => changeType(event.target.value as ArchiveQuestion['type'])}>
          <option value="text">Text</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option></select></label>
        {question.type === 'text' ? <label>Clue text (optional)<textarea rows={1} value={question.text ?? ''} onChange={(event) => updateQuestion({ text: event.target.value || undefined })} /></label>
          : mediaField('Clue media', question.media, question.type, question.id, () => updateQuestion({ media: undefined }))}
        {question.type === 'image' && <><label>Reveal effect<select value={question.reveal?.effect ?? 'static'} onChange={(event) => updateQuestion({ reveal: { ...question.reveal, effect: event.target.value === 'tiles' ? 'tiles' : 'static' } })}><option value="static">Static</option><option value="tiles">Tiles</option></select></label>
          {question.reveal?.effect === 'tiles' && (['durationSeconds', 'columns', 'rows', 'seed'] as const).map((field) => <label key={field}>{field}<input type="number" value={question.reveal?.[field] ?? ''} placeholder="Default" onChange={(event) => updateQuestion({ reveal: { ...question.reveal, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>)}</>}
        {(question.type === 'audio' || question.type === 'video') && (['startSeconds', 'endSeconds'] as const).map((field) => <label key={field}>Playback {field}<input type="number" step="any" value={question.playback?.[field] ?? ''} onChange={(event) => updateQuestion({ playback: { ...question.playback, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /></label>)}
        {question.type === 'audio' && <label><input type="checkbox" checked={question.visualizer?.enabled ?? false} onChange={(event) => updateQuestion({ visualizer: { enabled: event.target.checked, style: 'spectrum' } })} /> Show audio visualizer</label>}
      </div></div>
      {preview && <QuestionPreview preview={preview} generation={preview.generation} gameState={gameState}
        onRefresh={openPreview} error={previewError} onClose={() => { setPreview(null); setPreviewError(''); previewButton.current?.focus(); }} />}
      {picker && <MediaPicker files={files} draft={archive} saved={savedArchive} loadedReferences={loadedReferences}
        busy={busy} error={mediaError} onUpload={upload} onRefresh={refreshMedia} fixedType={picker.type} initial={picker.initial}
        onSelect={(file) => setArchive((current) => current && (picker.target === 'cover'
          ? { ...current, quiz: { ...current.quiz, coverImage: file } }
          : { ...current, questions: current.questions.map((q) => q.id === picker.target ? { ...q, media: file } : q) }))}
        onClose={() => { setPicker(null); setMediaError(''); pickerButton.current?.focus(); }} />}
      <details className="editor-media-library" onToggle={(event) => { setLibraryOpen(event.currentTarget.open); setMediaError(''); }}>
        <summary>Media library ({files.length})</summary>
        {libraryOpen && <MediaBrowser files={files} draft={archive} saved={savedArchive} loadedReferences={loadedReferences}
          busy={busy} error={mediaError} onUpload={upload} onRefresh={refreshMedia} onDelete={removeFile} />}
      </details>
    </fieldset>
  </section>;
}
