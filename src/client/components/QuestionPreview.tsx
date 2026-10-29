import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pointsAt } from '../../shared/game';
import { toRuntimeQuestion, type ArchiveQuestion } from '../../shared/quizArchive';
import type { Settings, Snapshot } from '../../shared/protocol';
import { DisplayScreen } from '../pages/DisplayPage';

type Preview = { question: ArchiveQuestion; settings: Settings; index: number; count: number };

export function previewSnapshot(base: Snapshot, preview: Preview, elapsedMs: number): Snapshot {
  const { answer: _answer, ...question } = toRuntimeQuestion(preview.question);
  const deadline = question.mode === 'typed'
    ? ((question.timerSeconds ?? 0) + base.serverSettings.TimerEndOffsetSeconds) * 1000 : Infinity;
  const elapsed = Math.max(0, Math.min(elapsedMs, deadline));
  const running = elapsedMs < deadline;
  const { privateAnswer: _privateAnswer, hostSubmissions: _hostSubmissions, ...publicBase } = base;
  return {
    ...publicBase,
    settings: preview.settings,
    question,
    questionIndex: preview.index,
    questionCount: preview.count,
    phase: running ? 'QUESTION_OPEN' : 'QUESTION_CLOSED',
    revealedAnswer: null,
    players: [], leaderboardIds: [], lockedOutIds: [], lockoutRemainingMs: {},
    activePlayerId: null, pointsAtBuzz: null,
    currentPoints: question.mode === 'typed' ? question.fixedPoints ?? 0 : pointsAt(elapsed, preview.settings),
    clueElapsedMs: elapsed, displayElapsedMs: elapsed,
    clockRunning: running, displayClockRunning: running, paused: false,
    revealProgress: Math.min(1, elapsed / ((question.reveal?.durationSeconds ?? 20) * 1000)),
    mediaPositionSeconds: (question.playback?.startSeconds ?? 0) + elapsed / 1000,
    mediaFinishRemainingMs: null, mediaFinishNeedsSkip: false, mediaVersion: 0,
    submissionCount: 0, mySubmitted: false, buzzResult: null, reviewGroup: null,
    review: null, reviewResultId: null, reviewRemainingMs: null, reviewIndex: 0, reviewCount: 0,
    canUndo: false, scoreEvents: [],
  };
}

export function QuestionPreview({ preview, generation, gameState, onClose, onRefresh, error }: {
  preview: Preview; generation: number; gameState: Snapshot; onClose: () => void; onRefresh: () => void; error: string;
}) {
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
  return <dialog ref={dialog} className="question-preview" aria-labelledby="question-preview-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="question-preview-toolbar">
      <div><h2 id="question-preview-title" ref={heading} tabIndex={-1}>Question preview</h2><p>Local only. Close to edit; refresh to restart.</p></div>
      <div className="editor-actions"><button type="button" onClick={onRefresh}>Refresh preview</button>
        <button type="button" className="primary" onClick={close}>Close preview</button></div>
    </div>
    {error && <p role="alert">{error}</p>}
    <PreviewScreen key={generation} preview={preview} gameState={gameState} onClose={close} />
  </dialog>;
}

function PreviewScreen({ preview, gameState, onClose }: { preview: Preview; gameState: Snapshot; onClose: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [base] = useState(gameState);
  const [frameRoot, setFrameRoot] = useState<HTMLElement | null>(null);
  const [frameError, setFrameError] = useState('');
  const [width, setWidth] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!frameRoot) return;
    const start = performance.now();
    setStartedAt(start); setNow(start);
    const timer = window.setInterval(() => setNow(performance.now()), 50);
    return () => window.clearInterval(timer);
  }, [frameRoot]);
  useEffect(() => {
    if (!frameRoot) return;
    const doc = frameRoot.ownerDocument;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [frameRoot, onClose]);
  function prepareFrame(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;
    const root = doc?.getElementById('preview-root');
    if (!doc || !root) { setFrameError('Unable to open the preview. Try refreshing it.'); return; }
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((style) => doc.head.appendChild(style.cloneNode(true)));
    setFrameError('');
    setFrameRoot(root);
  }
  const state = startedAt === null ? null : previewSnapshot(base, preview, now - startedAt);
  return <>
    {frameError && <p role="alert">{frameError}</p>}
    <div className="question-preview-viewport" ref={viewport}>
      <iframe title="TV question preview" className="question-preview-frame"
        srcDoc={'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="preview-root"></div></body></html>'}
        style={{ transform: `scale(${width / 1280})` }}
        onLoad={(event) => prepareFrame(event.currentTarget)} />
    </div>
    {frameRoot && state && createPortal(<DisplayScreen state={state} connected receivedAt={startedAt ?? 0} preview />, frameRoot)}
  </>;
}
