import { useState } from 'react';
import type { FinalJeopardyBoard } from '@shared/types';
import { hostFetch } from '../../lib/hostAuth';

export default function FinalJeopardyEditor({
  finalJeopardy, onSave, onRemove, onClose,
}: {
  finalJeopardy?: FinalJeopardyBoard;
  onSave: (fj: FinalJeopardyBoard) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(finalJeopardy?.category ?? '');
  const [clue, setClue] = useState(finalJeopardy?.clue ?? '');
  const [response, setResponse] = useState(finalJeopardy?.response ?? '');
  const [mediaType, setMediaType] = useState<FinalJeopardyBoard['mediaType']>(finalJeopardy?.mediaType);
  const [mediaUrl, setMediaUrl] = useState(finalJeopardy?.mediaUrl ?? '');
  const [timerSeconds, setTimerSeconds] = useState(finalJeopardy?.timerSeconds ?? 30);
  const [uploading, setUploading] = useState(false);

  async function handleFileUpload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await hostFetch('/api/media/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setMediaType(data.mediaType);
      setMediaUrl(data.url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function save() {
    onSave({
      category: category.trim(),
      clue,
      response,
      mediaType,
      mediaUrl: mediaUrl || undefined,
      timerSeconds: Number(timerSeconds) || 30,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border-2 border-jeopardy-gold rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-jeopardy-gold">⚡ Final Jeopardy</h2>
          <button className="text-gray-400 hover:text-white text-2xl" onClick={onClose}>✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <input
              className="input-field"
              placeholder="e.g. WORLD CAPITALS"
              value={category}
              onChange={e => setCategory(e.target.value)}
            />
          </div>

          {/* Clue */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Clue (shown to contestants)</label>
            <textarea
              className="input-field h-24 resize-none"
              placeholder="This is the Final Jeopardy clue..."
              value={clue}
              onChange={e => setClue(e.target.value)}
            />
          </div>

          {/* Response */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Response (correct answer)</label>
            <input
              className="input-field"
              placeholder="What is...?"
              value={response}
              onChange={e => setResponse(e.target.value)}
            />
          </div>

          {/* Timer */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Answer timer (seconds)</label>
            <input
              type="number"
              min={5}
              max={300}
              className="input-field w-32"
              value={timerSeconds}
              onChange={e => setTimerSeconds(Number(e.target.value))}
            />
          </div>

          {/* Media */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Media (optional)</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              <label className={`btn-ghost text-sm py-1 px-3 cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? 'Uploading...' : '📁 Upload Image/Video'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,video/*"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                />
              </label>
              <button
                className="btn-ghost text-sm py-1 px-3"
                onClick={() => { setMediaType('youtube'); setMediaUrl(''); }}
              >▶ YouTube URL</button>
              {mediaUrl && (
                <button
                  className="btn-danger text-sm py-1 px-3"
                  onClick={() => { setMediaType(undefined); setMediaUrl(''); }}
                >Remove Media</button>
              )}
            </div>

            {mediaType === 'youtube' && (
              <input
                className="input-field"
                placeholder="https://www.youtube.com/watch?v=..."
                value={mediaUrl}
                onChange={e => setMediaUrl(e.target.value)}
              />
            )}

            {mediaUrl && mediaType === 'image' && (
              <img src={mediaUrl} alt="preview" className="max-h-40 rounded border border-gray-600 mt-2" />
            )}
            {mediaUrl && mediaType === 'video' && (
              <video src={mediaUrl} controls className="max-h-40 rounded border border-gray-600 mt-2 w-full" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-700">
          {finalJeopardy ? (
            <button className="btn-danger text-sm" onClick={() => { onRemove(); onClose(); }}>Remove Final Jeopardy</button>
          ) : <div />}
          <button
            className="btn-primary"
            disabled={!category.trim() || !clue.trim()}
            onClick={save}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
