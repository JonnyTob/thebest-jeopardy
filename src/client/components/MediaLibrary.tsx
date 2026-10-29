import { useEffect, useRef, useState } from 'react';
import type { LoadedMediaReference } from '../../shared/mediaLibrary';
import type { QuizArchive } from '../../shared/quizArchive';

export type MediaType = 'image' | 'audio' | 'video';
type Filter = 'all' | MediaType | 'other';
const pageSize = 20;
const uploadTypes = '.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.ogg,.mp4,.webm';

export function mediaType(file: string): MediaType | 'other' {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file)) return 'image';
  if (/\.(mp3|wav|ogg)$/i.test(file)) return 'audio';
  if (/\.(mp4|webm)$/i.test(file)) return 'video';
  return 'other';
}

type BrowserProps = {
  files: string[];
  draft: QuizArchive;
  saved: QuizArchive;
  loadedReferences: LoadedMediaReference[];
  busy: boolean;
  error: string;
  onUpload: (file: File) => Promise<string | undefined>;
  onRefresh: () => Promise<void>;
  onDelete?: (file: string) => Promise<boolean>;
  fixedType?: MediaType;
  initial?: string;
  onSelect?: (file: string) => void;
};

function uses(archive: QuizArchive, file: string): string[] {
  const result = archive.quiz.coverImage === file ? ['Cover image'] : [];
  archive.questions.forEach((question, index) => {
    if (question.media === file) result.push(`Question ${index + 1}`);
  });
  return result;
}

export function MediaBrowser({ files, draft, saved, loadedReferences, busy, error, onUpload, onRefresh, onDelete, fixedType, initial, onSelect }: BrowserProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(fixedType ?? 'all');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(initial && files.includes(initial) && (!fixedType || mediaType(initial) === fixedType) ? initial : '');
  const matching = files.filter((file) => (filter === 'all' || mediaType(file) === filter) && file.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const selectedFile = files.includes(selected) ? selected : '';
  const draftUses = selectedFile ? uses(draft, selectedFile) : [];
  const savedUses = selectedFile ? uses(saved, selectedFile) : [];
  const loadedUses = loadedReferences.filter((reference) => reference.file === selectedFile)
    .map((reference) => reference.kind === 'cover' ? 'Cover image' : `Question ${reference.questionIndex + 1}`);

  return <div className="media-browser">
    <p>Upload up to 50 MB. Files are saved immediately, even if quiz edits are discarded.</p>
    <div className="editor-actions"><label>Upload media<input type="file" accept={uploadTypes} disabled={busy} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      setNotice('');
      if (file) void onUpload(file).then((uploaded) => {
        if (uploaded) {
          setQuery(''); setFilter(fixedType ?? 'all'); setPage(0);
          if (!fixedType || mediaType(uploaded) === fixedType) setSelected(uploaded);
          setNotice(fixedType && mediaType(uploaded) !== fixedType
            ? `Uploaded ${uploaded}, but it is not a compatible ${fixedType} file and cannot be selected here.`
            : `Uploaded ${uploaded}.`);
        }
      });
    }} /></label><button type="button" disabled={busy} onClick={() => { void onRefresh(); }}>Refresh media</button></div>
    {fixedType && <p>Showing {fixedType} files. Uploads of other types remain in the library.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="media-browser-filters">
      <label>Search media<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      {!fixedType && <label>Media type<select value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setPage(0); }}>
        <option value="all">All types</option><option value="image">Images</option><option value="audio">Audio</option>
        <option value="video">Video</option><option value="other">Other files</option>
      </select></label>}
    </div>
    <p role="status">{matching.length} {matching.length === 1 ? 'file' : 'files'} found. Page {currentPage + 1} of {pages}.</p>
    <div className="media-browser-content">
      <div>
        {matching.length === 0 ? <p>No matching files.</p> : <ul className="media-browser-list">
          {matching.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((file) => <li key={file}>
            <button type="button" className={file === selectedFile ? 'active' : ''} aria-pressed={file === selectedFile}
              onClick={() => setSelected(file)}>{file}</button>
          </li>)}
        </ul>}
        <div className="editor-actions"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button>
          <button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next page</button></div>
      </div>
      <div className="media-browser-details">
        {selectedFile ? <>
          <strong>{selectedFile}</strong>
          <MediaPreview key={selectedFile} file={selectedFile} />
          <div className="media-usage">
            <p>Current edits: {draftUses.join(', ') || 'No references'}</p>
            <p>Last loaded or saved in editor: {savedUses.join(', ') || 'No references'}</p>
            <p>Running quiz: {loadedUses.join(', ') || 'No references'}</p>
          </div>
          {onSelect && <button type="button" className="primary" onClick={() => onSelect(selectedFile)}>Select media</button>}
          {onDelete && <button type="button" onClick={() => {
            void onDelete(selectedFile).then((deleted) => { if (deleted) setSelected(''); });
          }}>Delete file</button>}
        </> : <p>Select a file to preview it and see where it is used.</p>}
      </div>
    </div>
    {onDelete && <p>Saved references are checked again on deletion. Other hosts' unsaved edits cannot be checked.</p>}
  </div>;
}

function MediaPreview({ file }: { file: string }) {
  const [error, setError] = useState(false);
  const url = `/media/quiz/${file.slice('media/'.length)}`;
  const type = mediaType(file);
  return <div className="media-browser-preview">
    {type === 'image' && <img src={url} alt="Selected media preview" onError={() => setError(true)} />}
    {type === 'audio' && <audio controls preload="none" src={url} onError={() => setError(true)} />}
    {type === 'video' && <video controls preload="metadata" src={url} onError={() => setError(true)} />}
    {type === 'other' && <p>Preview is not available for this file type.</p>}
    {error && <p role="alert">This file could not be previewed in this browser.</p>}
  </div>;
}

export function MediaPicker({ onClose, ...props }: BrowserProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    heading.current?.focus();
    return () => { if (element?.open) element.close(); };
  }, []);
  function close() {
    dialog.current?.close();
    onClose();
  }
  return <dialog ref={dialog} className="media-picker" aria-labelledby="media-picker-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="media-picker-heading"><h2 id="media-picker-title" ref={heading} tabIndex={-1}>Choose media</h2>
      <button type="button" onClick={close}>Cancel</button></div>
    {props.initial && (!props.files.includes(props.initial) || (props.fixedType && mediaType(props.initial) !== props.fixedType))
      && <p>Current file: {props.initial} {!props.files.includes(props.initial) ? '(missing)' : '(different type)'}</p>}
    <MediaBrowser {...props} onSelect={(file) => { props.onSelect?.(file); close(); }} />
  </dialog>;
}
