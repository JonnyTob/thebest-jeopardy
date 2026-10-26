import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { hostFetch } from '../lib/hostAuth';
const API = '/api';

type BoardSummary = { id: string; name: string; roundCount: number; hasFinal: boolean; createdAt: string; updatedAt: string };

export default function Dashboard() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function fetchBoards() {
    const res = await fetch(`${API}/boards`);
    const data = await res.json();
    setBoards(data);
    setLoading(false);
  }

  useEffect(() => { fetchBoards(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    const res = await hostFetch(`${API}/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const board = await res.json();
    setCreating(false);
    setNewName('');
    navigate(`/editor/${board.id}`);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await hostFetch(`${API}/boards/${id}`, { method: 'DELETE' });
    setBoards(prev => prev.filter(b => b.id !== id));
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await hostFetch(`${API}/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, id: undefined, createdAt: undefined, updatedAt: undefined }),
    });
    const board = await res.json();
    navigate(`/editor/${board.id}`);
  }

  async function handleExport(id: string, name: string) {
    const res = await fetch(`${API}/boards/${id}`);
    const board = await res.json();
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-jeopardy-dark p-6">
      {/* Header */}
      <div className="max-w-5xl mx-auto">
        <h1 className="text-5xl font-black text-center text-jeopardy-gold mb-2 tracking-widest" style={{ textShadow: '2px 2px 0 #000' }}>
          JEOPARDY!
        </h1>
        <p className="text-center text-gray-400 mb-8">Game Night Host Dashboard</p>

        {/* Actions row */}
        <div className="flex gap-3 mb-8 justify-center flex-wrap">
          <button className="btn-primary text-lg px-6 py-3" onClick={() => setCreating(true)}>
            + New Board
          </button>
          <button className="btn-ghost text-lg px-6 py-3" onClick={() => importRef.current?.click()}>
            Import JSON
          </button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>

        {/* Create modal */}
        {creating && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-jeopardy-gold rounded-xl p-8 w-96">
              <h2 className="text-2xl font-bold text-jeopardy-gold mb-4">New Board</h2>
              <input
                autoFocus
                className="input-field mb-4"
                placeholder="Board name (e.g. Game Night #3)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
              />
              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={handleCreate}>Create & Edit</button>
                <button className="btn-ghost flex-1" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Board list */}
        {loading ? (
          <p className="text-center text-gray-400">Loading boards...</p>
        ) : boards.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-xl mb-4">No boards yet.</p>
            <p className="text-gray-500">Create your first board to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map(board => (
              <BoardCard
                key={board.id}
                board={board}
                onEdit={() => navigate(`/editor/${board.id}`)}
                onHost={() => navigate(`/host/${board.id}`)}
                onExport={() => handleExport(board.id, board.name)}
                onDelete={() => handleDelete(board.id, board.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCard({
  board, onEdit, onHost, onExport, onDelete
}: {
  board: BoardSummary;
  onEdit: () => void;
  onHost: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const updated = new Date(board.updatedAt).toLocaleDateString();
  return (
    <div className="bg-gray-900 border-2 border-jeopardy-blue rounded-xl p-5 flex flex-col gap-3 hover:border-jeopardy-gold transition-colors">
      <div>
        <h3 className="text-xl font-bold text-white truncate">{board.name}</h3>
        <p className="text-gray-400 text-sm">Updated {updated}</p>
        <p className="text-gray-500 text-xs mt-1">{board.roundCount} round{board.roundCount === 1 ? '' : 's'}{board.hasFinal ? ' · Final ✓' : ''}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary text-sm py-1 px-3" onClick={onHost}>▶ Host</button>
        <button className="btn-ghost text-sm py-1 px-3" onClick={onEdit}>✏ Edit</button>
        <button className="btn-ghost text-sm py-1 px-3" onClick={onExport}>↓ Export</button>
        <button className="btn-danger text-sm py-1 px-3" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}
