import { useCallback, useEffect, useRef, useState } from 'react';
import { archiveQuestionSchema, quizArchiveSchema, type ArchiveQuestion, type QuizArchive } from '../../shared/quizArchive';
import type { LoadedMediaReference } from '../../shared/mediaLibrary';
import { settingsSchema, type Snapshot } from '../../shared/protocol';
import { commandId } from '../session';
import { QuestionPreview } from './QuestionPreview';
import { MediaBrowser, MediaPicker, mediaType, type MediaType } from './MediaLibrary';

type Issue = { path: string; message: string };

function VideoDuration({ file, quizId }: { file: string; quizId: number }) {
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
    video.src = `/media/archive/${quizId}/${file.slice('media/'.length)}`;
    return () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [file, quizId]);
  return <span className="editor-video-duration">Duration: {duration !== null ? `${duration.toFixed(1)} s` : unavailable ? 'unavailable' : 'loading…'}</span>;
}

export function QuizEditor({ passcode, onDirtyChange, gameState, quizId }: { passcode: string; onDirtyChange: (dirty: boolean) => void; gameState: Snapshot; quizId?: number }) {
  const [archive, setArchive] = useState<QuizArchive | null>(null);
  const [globalSettings, setGlobalSettings] = useState<Snapshot['settings'] | null>(null);
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
    const response = await fetch(`/api/editor${url}${quizId === undefined ? '' : `?quizId=${quizId}`}`, { ...init, headers });
    const result: unknown = await response.json();
    if (!response.ok) {
      const body = result as { error?: string; issues?: Issue[] };
      setIssues(body.issues ?? []);
      throw new Error(body.error ?? `Request failed (${response.status}).`);
    }
    return result;
  }, [passcode, quizId]);

  const load = useCallback(async () => {
    setBusy(true); setError(''); setIssues([]);
    try {
      const [data, media] = await Promise.all([request('/archive'), request('/media')]);
      const result = data as { archive: unknown; revision: string; globalSettings?: unknown };
      const parsed = quizArchiveSchema.parse(result.archive);
      setGlobalSettings(result.globalSettings ? settingsSchema.parse(result.globalSettings) : null);
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
      setMessage('Saved. Load or reload this quiz from the library in the lobby to apply changes.');
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
  const inheritedPoints = { ...(globalSettings ?? gameState.settings), ...archive.gameSetup };
  const decayPoints = question?.pointDecay ?? {
    startPoints: inheritedPoints.startPoints, minimumPoints: inheritedPoints.minimumPoints,
    dropPoints: inheritedPoints.dropPoints, dropEverySeconds: inheritedPoints.dropEverySeconds,
    pointDecayDelaySeconds: inheritedPoints.pointDecayDelaySeconds,
  };
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
    const next: ArchiveQuestion = copy && question ? { ...structuredClone(question), id: commandId() }
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
    const settings = settingsSchema.safeParse({ ...(globalSettings ?? gameState.settings), ...archive!.gameSetup, title: archive!.quiz.title });
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
      {type === 'video' && value && files.includes(value) && mediaType(value) === 'video' && <VideoDuration key={value} file={value} quizId={archive!.quiz.id} />}
      </div>
    </div>;
  }
  return <section className="panel quiz-editor"><h1>Quiz editor</h1>
    <p>Editing Quiz #{archive.quiz.id}. Load or reload it from the library in the lobby to apply saved changes.</p>
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
            <span className={`editor-question-mode ${q.mode}`}>{q.mode === 'typed' ? 'Typed' : q.mode === 'type-and-buzz' ? 'Type + buzz' : 'Buzz'}</span>
            {q.enabled === false && <span className="editor-question-disabled">✕ Disabled</span>}
          </button></li>)}</ol>
        <div className="editor-actions"><button disabled={archive.questions.length >= 500} onClick={() => addQuestion(false)}>Add question</button>
          <button disabled={!question || archive.questions.length >= 500} onClick={() => addQuestion(true)}>Duplicate</button>
          <button disabled={selected === 0} onClick={() => move(-1)}>Move up</button>
          <button disabled={!question || selected === archive.questions.length - 1} onClick={() => move(1)}>Move down</button>
          <button disabled={!question} onClick={() => {
            if (!window.confirm('Delete this question?')) return;
            setArchive({ ...archive, questions: archive.questions.filter((_, index) => index !== selected) });
            setSelected(Math.max(0, selected - 1));
          }}>Delete question</button></div>
      </div>{question ? <div className="editor-fields"><div className="editor-question-heading"><h2>Question {selected + 1}</h2>
        <button className="small primary" ref={previewButton} type="button" onClick={openPreview}>Preview question</button></div>
        <label>Mode<select value={question.mode} onChange={(event) => {
          const mode = event.target.value as ArchiveQuestion['mode'];
          updateQuestion({ mode, fixedPoints: mode === 'typed' ? 250 : mode === 'type-and-buzz' ? 100 : undefined,
            buzzPoints: mode === 'type-and-buzz' ? 500 : undefined, typingSeconds: mode === 'type-and-buzz' ? 10 : undefined,
            pointMode: undefined, pointDecay: undefined });
        }}><option value="buzzer">Buzzer</option><option value="typed">Typed</option><option value="type-and-buzz">Type + buzz</option></select></label>
        <label>Clue type<select value={question.type} onChange={(event) => changeType(event.target.value as ArchiveQuestion['type'])}>
          <option value="text">Text</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option></select></label>
        {question.type !== 'text' && mediaField('Clue media', question.media, question.type, question.id, () => updateQuestion({ media: undefined }))}
          {question.type === 'image' && <><label>Reveal effect (optional)<select value={question.reveal?.effect ?? 'static'} onChange={(event) => updateQuestion({ reveal: { ...question.reveal, effect: event.target.value === 'tiles' ? 'tiles' : 'static' } })}><option value="static">Static</option><option value="tiles">Tiles</option></select>
            <small>Choose whether the image appears at once or is revealed in tiles.</small></label>
            {question.reveal?.effect === 'tiles' && ([['durationSeconds', 'Reveal duration (seconds)', 'Default: 20 seconds.'], ['columns', 'Tile columns', 'Default: 8 columns.'], ['rows', 'Tile rows', 'Default: 6 rows.'], ['seed', 'Reveal seed', 'Default: 814; the same seed repeats the tile order.']] as const).map(([field, label, help]) => <label key={field}>{label} (optional)<input type="number" value={question.reveal?.[field] ?? ''} placeholder="Default" onChange={(event) => updateQuestion({ reveal: { ...question.reveal, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /><small>{help}</small></label>)}</>}
          {(question.type === 'audio' || question.type === 'video') && ([['startSeconds', 'Playback start (seconds)', 'Leave blank to start at the beginning.'], ['endSeconds', 'Playback end (seconds)', 'Leave blank to play to the end.']] as const).map(([field, label, help]) => <label key={field}>{label} (optional)<input type="number" step="any" value={question.playback?.[field] ?? ''} onChange={(event) => updateQuestion({ playback: { ...question.playback, [field]: event.target.value === '' ? undefined : Number(event.target.value) } })} /><small>{help}</small></label>)}
          {question.type === 'audio' && <label className="editor-question-enabled"><input type="checkbox" checked={question.visualizer?.enabled ?? false} onChange={(event) => updateQuestion({ visualizer: { enabled: event.target.checked, style: 'spectrum' } })} /> Show audio visualizer (optional)</label>}
        <label className="editor-question-enabled"><input type="checkbox" checked={question.enabled !== false}
          onChange={(event) => updateQuestion({ enabled: event.target.checked })} /> Include question in quiz</label>
        <label>Question<textarea rows={1} value={question.question} onChange={(event) => updateQuestion({ question: event.target.value })} /></label>
        <label>Answer<textarea rows={1} value={question.answer} onChange={(event) => updateQuestion({ answer: event.target.value })} /></label>
        {(question.mode === 'type-and-buzz' || (question.mode === 'typed' && question.pointMode !== 'decay')) && <label>{question.mode === 'type-and-buzz' ? 'Typed answer points' : 'Fixed points'}<input type="number" min={1} max={10000} value={Number.isNaN(question.fixedPoints) ? '' : question.fixedPoints ?? ''} onChange={(event) => updateQuestion({ fixedPoints: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>}
        {question.mode === 'type-and-buzz' && <label>Initial typing window (seconds)<input type="number" min={1} max={3600} value={Number.isNaN(question.typingSeconds) ? '' : question.typingSeconds ?? ''} onChange={(event) => updateQuestion({ typingSeconds: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>}
        {<div className="editor-optional"><h3>{question.mode === 'typed' ? 'Answer points' : 'Buzzer points'}</h3>
          <label>Point type<select value={question.pointMode ?? (question.mode === 'buzzer' ? 'decay' : 'fixed')} onChange={(event) => {
            const inherited = { ...(globalSettings ?? gameState.settings), ...archive.gameSetup };
            if (event.target.value === 'fixed') {
              updateQuestion(question.mode === 'typed' ? { pointMode: 'fixed', pointDecay: undefined, fixedPoints: inherited.startPoints, buzzPoints: undefined } : { pointMode: 'fixed', pointDecay: undefined, buzzPoints: Math.max(inherited.startPoints, (question.fixedPoints ?? 0) + 1) });
            } else {
              const startPoints = Math.max(inherited.startPoints, (question.fixedPoints ?? 0) + 1);
              updateQuestion({ pointMode: 'decay', buzzPoints: undefined, ...(question.mode === 'typed' ? { fixedPoints: undefined } : {}), pointDecay: { startPoints,
                minimumPoints: Math.min(inherited.minimumPoints, startPoints), dropPoints: inherited.dropPoints,
                dropEverySeconds: inherited.dropEverySeconds, pointDecayDelaySeconds: inherited.pointDecayDelaySeconds } });
            }
          }}><option value="fixed">Fixed points</option><option value="decay">Decaying points</option></select></label>
          {(question.pointMode ?? (question.mode === 'buzzer' ? 'decay' : 'fixed')) === 'fixed'
            ? question.mode === 'typed' ? null : <label>Buzzer points for a correct answer<input type="number" min={1} max={10000} value={Number.isNaN(question.buzzPoints) ? '' : question.buzzPoints ?? ''} onChange={(event) => updateQuestion({ buzzPoints: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
            : <>
          {!question.pointDecay && <small>Showing the quiz's default values. Editing a value saves all five settings for this question.</small>}
          {([['startPoints', 'Starting points', 1, 10000], ['minimumPoints', 'Minimum points', 1, 10000],
            ['dropPoints', 'Points dropped per step', 1, 10000], ['dropEverySeconds', 'Seconds between drops', 1, 120],
            ['pointDecayDelaySeconds', 'Wait before points start dropping (seconds)', 0, 300]] as const).map(([field, label, min, max]) =>
            <label key={field}>{label}<input type="number" min={min} max={max} step={field === 'dropEverySeconds' ? 'any' : 1} value={Number.isNaN(decayPoints[field]) ? '' : decayPoints[field]}
              onChange={(event) => updateQuestion({ pointDecay: { ...decayPoints, [field]: event.target.value === '' ? NaN : Number(event.target.value) } })} /></label>)}
          </>}
        </div>}
        <div className="editor-optional"><h3>Optional settings</h3>
          <label>Keyword (optional)<input value={question.keyword ?? ''} onChange={(event) => updateQuestion({ keyword: event.target.value || undefined })} />
            <small>A short name for finding this question in the editor.</small></label>
          {question.type === 'text' && <label>Clue text (optional)<textarea rows={1} value={question.text ?? ''} onChange={(event) => updateQuestion({ text: event.target.value || undefined })} />
            <small>Additional text displayed below the question.</small></label>}
          <label>{question.mode === 'type-and-buzz' ? 'Buzzer countdown (seconds) (optional)' : 'Timer countdown (seconds) (optional)'}<input type="number" min={1} max={3600} placeholder={`Inherit global (${archive.gameSetup?.questionTimerSeconds ?? globalSettings?.questionTimerSeconds ?? gameState.settings.questionTimerSeconds}s)`}
            value={question.timerSeconds ?? ''} onChange={(event) => updateQuestion({ timerSeconds: event.target.value === '' ? undefined : Number(event.target.value) })} />
            <small>Leave blank to use the quiz's default countdown.</small></label>

        </div>
      </div> : <p>Add a question to start building this quiz.</p>}</div>
      {preview && <QuestionPreview preview={preview} generation={preview.generation} gameState={gameState} quizId={quizId}
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
