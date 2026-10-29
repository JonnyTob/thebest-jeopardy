import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicQuestion, Snapshot } from '../../shared/protocol';
import { tileOrder } from '../../shared/game';

export function Media({ state, preview = false }: { state: Snapshot; preview?: boolean }) {
  const question = state.question;
  if (!question) return null;
  if (question.type === 'text') return <div className="text-clue">{question.text || question.question}</div>;
  if (question.type === 'image') return <ImageClue key={question.id} question={question} progress={preview ? 1 : state.revealProgress} />;
  if (preview) return <div className="media-preview-placeholder">
    <span className="eyebrow">{question.type.toUpperCase()} CLUE</span>
    <p>{question.media}</p><small>Playback is on the TV only.</small>
  </div>;
  return <Playback key={question.id} state={state} question={question} />;
}

function ImageClue({ question, progress }: { question: PublicQuestion; progress: number }) {
  const [error, setError] = useState(false);
  const reveal = question.reveal;
  const count = (reveal?.columns ?? 8) * (reveal?.rows ?? 6);
  const order = useMemo(() => tileOrder(count, reveal?.seed ?? 814), [count, reveal?.seed]);
  const visible = new Set(order.slice(0, Math.floor(progress * count)));
  return <div className="image-clue">
    <img src={question.media} alt="Quiz image clue" onError={() => setError(true)} />
    {error ? <div className="media-error" role="alert">Image could not be loaded. Check the local media file.</div>
      : reveal?.effect === 'tiles' && <div className="tile-cover" aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${reveal.columns}, 1fr)`, gridTemplateRows: `repeat(${reveal.rows}, 1fr)` }}>
        {order.map((_, index) => <div key={index} className={visible.has(index) ? 'uncovered' : ''} />)}
      </div>}
  </div>;
}

function Playback({ state, question }: { state: Snapshot; question: PublicQuestion }) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<{ context: AudioContext; analyser: AnalyserNode } | null>(null);
  const currentState = useRef(state);
  currentState.current = state;
  const [error, setError] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [ended, setEnded] = useState(false);
  const [ready, setReady] = useState(false);
  const [visualizerReady, setVisualizerReady] = useState(false);
  const lastMediaVersion = useRef(-1);

  function enableVisualizer() {
    if (question.type !== 'audio' || question.visualizer?.enabled === false || !mediaRef.current) return;
    if (!audioRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      context.createMediaElementSource(mediaRef.current).connect(analyser);
      analyser.connect(context.destination);
      audioRef.current = { context, analyser };
    }
    void audioRef.current.context.resume().then(() => setVisualizerReady(true)).catch((cause: unknown) => {
      setError(`Audio visualization could not start: ${String(cause)}`);
    });
  }

  function play() {
    const media = mediaRef.current;
    if (!media) return;
    void media.play().then(() => {
      if (!currentState.current.displayClockRunning) media.pause();
      setNeedsUnlock(false);
      setError('');
    }).catch((cause: unknown) => {
      const name = typeof cause === 'object' && cause !== null && 'name' in cause ? cause.name : undefined;
      if (name === 'NotAllowedError') setNeedsUnlock(true);
      else if (name !== 'AbortError') {
        const message = typeof cause === 'object' && cause !== null && 'message' in cause ? String(cause.message) : String(cause);
        setError(`Playback failed: ${message}`);
      }
    });
  }

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !ready) return;
    const end = Math.min(question.playback?.endSeconds ?? Infinity, Number.isFinite(media.duration) ? media.duration : Infinity);
    const target = Math.min(state.mediaPositionSeconds, end);
    const finishEnd = state.phase === 'MEDIA_FINISH' && state.mediaFinishRemainingMs !== null
      ? state.mediaPositionSeconds + state.mediaFinishRemainingMs / 1000 : Infinity;
    if (state.mediaVersion !== lastMediaVersion.current || Math.abs(media.currentTime - target) > 0.8
      || (!state.displayClockRunning && Math.abs(media.currentTime - target) > 0.01)) media.currentTime = target;
    lastMediaVersion.current = state.mediaVersion;
    if (media.currentTime > Math.min(end, finishEnd)) media.currentTime = Math.min(end, finishEnd);
    const atEnd = target >= end || media.currentTime >= Math.min(end, finishEnd);
    setEnded(atEnd);
    if (state.displayClockRunning && !atEnd) {
      if (media.paused && !needsUnlock) play();
    } else media.pause();
  }, [state.mediaPositionSeconds, state.displayClockRunning, state.mediaVersion, state.phase, state.mediaFinishRemainingMs, ready, question.playback?.endSeconds, needsUnlock]);

  useEffect(() => {
    if (question.type !== 'audio') return;
    let frame = 0;
    const values = new Uint8Array(64);
    function draw() {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        const audio = audioRef.current;
        if (audio) audio.analyser.getByteFrequencyData(values);
        for (let i = 0; i < 40; i++) {
          const height = audio && !mediaRef.current?.paused ? Math.max(4, values[i] / 255 * 180) : 4;
          context.fillStyle = i % 3 === 0 ? '#ec65b8' : '#ffe27c';
          context.fillRect(i * 15 + 3, (220 - height) / 2, 9, height);
        }
      }
      frame = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(frame); };
  }, [question.type]);

  useEffect(() => () => {
    if (audioRef.current) {
      void audioRef.current.context.close().catch((cause: unknown) => console.error('Audio context cleanup failed:', cause));
      audioRef.current = null;
    }
  }, []);

  const mediaProps = {
    src: question.media,
    preload: 'auto',
    onLoadedMetadata: () => { setReady(true); },
    onError: () => setError('Media could not be loaded. Check the local file and browser codec support.'),
    onEnded: () => setEnded(true),
    onPlay: enableVisualizer,
    onTimeUpdate: () => {
      const media = mediaRef.current;
      const finishEnd = state.phase === 'MEDIA_FINISH' && state.mediaFinishRemainingMs !== null
        ? state.mediaPositionSeconds + state.mediaFinishRemainingMs / 1000 : Infinity;
      const end = Math.min(question.playback?.endSeconds ?? Infinity, finishEnd);
      if (media && media.currentTime >= end) {
        media.pause();
        if (media.currentTime > end) media.currentTime = end;
        setEnded(true);
      }
    },
  };
  return <div className="playback-clue">
    {question.type === 'video'
      ? <video {...mediaProps} playsInline ref={(element) => { mediaRef.current = element; }} />
      : <><audio {...mediaProps} ref={(element) => { mediaRef.current = element; }} />
        <div className="audio-clue"><span className="eyebrow">LISTEN CLOSELY</span>
          <canvas ref={canvasRef} width={600} height={220} aria-label="Audio frequency spectrum" />
          <span>{state.phase === 'MEDIA_FINISH' ? (ended ? 'Clip ended / buzzing closed' : 'Finishing the clue / buzzing closed')
            : ended ? (state.phase === 'QUESTION_OPEN' ? 'Clip ended / buzzing stays open' : 'Clip ended')
              : state.displayClockRunning ? 'Listen. Recognize. Buzz.' : 'Playback paused'}</span>
        </div></>}
    {(needsUnlock || (question.type === 'audio' && question.visualizer?.enabled !== false && !visualizerReady)) && <button className="media-unlock primary" onClick={() => {
      enableVisualizer();
      if (state.displayClockRunning && !ended) play();
      else setNeedsUnlock(false);
    }}>Enable TV {question.type === 'audio' ? 'audio & visualizer' : 'playback'}</button>}
    {ended && question.type === 'video' && <span className="media-caption">{state.phase === 'QUESTION_OPEN' ? 'Clip ended / buzzing stays open' : 'Clip ended'}</span>}
    {error && <div className="media-error" role="alert">{error}</div>}
  </div>;
}
