import { useEffect, useRef, useState } from 'react';
import { REVIEW_RESULT_MS } from '../../shared/game';
import { advanceCountdownSound, initialCountdownSoundState, type CountdownPhase } from '../countdownSound';

type SoundStatus = 'locked' | 'unlocking' | 'enabled' | 'error';

export function CountdownSound({ sound, id, phase, remaining, connected, receivedAt,
  reviewCorrectSound, reviewWrongSound, reviewResultId = null, reviewRemainingMs = null, reviewCorrect = null,
  reviewHoldMs = REVIEW_RESULT_MS }: {
  sound: string | null; id: string | null; phase: CountdownPhase | null;
  remaining: number | null; connected: boolean; receivedAt: number;
  reviewCorrectSound: string | null; reviewWrongSound: string | null;
  reviewResultId?: string | null; reviewRemainingMs?: number | null; reviewCorrect?: boolean | null;
  reviewHoldMs?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const dedupe = useRef(initialCountdownSoundState);
  const operation = useRef(0);
  const unlocking = useRef(false);
  const ready = useRef(false);
  const source = useRef<string | null>(null);
  const playingReview = useRef<string | null>(null);
  const previousCountdown = useRef<string | null>(null);
  const seenReviewResults = useRef(new Set<string>());
  const connection = useRef({ disconnectedAt: null as number | null });
  const reconnectedSnapshot = useRef<number | null>(null);
  const [status, setStatus] = useState<SoundStatus>('locked');
  const [error, setError] = useState('');

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      operation.current++;
      audio?.pause();
    };
  }, []);

  // A changed configuration requires another gesture; keep the same audio element.
  useEffect(() => {
    operation.current++;
    audioRef.current?.pause();
    ready.current = false;
    playingReview.current = null;
    unlocking.current = false;
    setStatus('locked');
    setError('');
  }, [sound, reviewCorrectSound, reviewWrongSound]);

  function selectSource(audio: HTMLAudioElement, path: string) {
    if (source.current !== path) {
      audio.src = path;
      source.current = path;
    }
  }

  useEffect(() => {
    // Let a short beep finish across digit changes and harmless clock resyncs.
    // Starting a countdown must not interrupt an enable gesture already in flight.
    const ended = previousCountdown.current !== null && previousCountdown.current !== id;
    previousCountdown.current = id;
    if (!connected || ended) {
      operation.current++;
      audioRef.current?.pause();
      if (unlocking.current) {
        unlocking.current = false;
        setStatus('locked');
      }
    }
  }, [id, connected]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!connected) connection.current.disconnectedAt = receivedAt;
    const fresh = connected && (connection.current.disconnectedAt === null || receivedAt !== connection.current.disconnectedAt);
    if (fresh && connection.current.disconnectedAt !== null) {
      reconnectedSnapshot.current = receivedAt;
      connection.current.disconnectedAt = null;
    }
    const result = advanceCountdownSound(dedupe.current, {
      id, phase, remaining, connected: fresh, enabled: !!sound && ready.current,
    });
    dedupe.current = result.state;
    if (!audio || !result.play) return;
    const currentOperation = ++operation.current;
    try {
      playingReview.current = null;
      selectSource(audio, sound!);
      audio.playbackRate = 1;
      audio.currentTime = 0;
      void audio.play().catch((cause: unknown) => {
        if (operation.current !== currentOperation) return;
        ready.current = false;
        setStatus('error');
        setError(cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Browser blocked TV sound. Enable it again.'
          : 'Countdown sound could not play. Check the WAV file and retry.');
      });
    } catch {
      ready.current = false;
      setStatus('error');
      setError('Countdown sound could not play. Check the WAV file and retry.');
    }
  }, [id, phase, remaining, connected, receivedAt, sound]);

  useEffect(() => {
    if (playingReview.current && playingReview.current !== reviewResultId) {
      operation.current++;
      audioRef.current?.pause();
      playingReview.current = null;
    }
    if (!reviewResultId || seenReviewResults.current.has(reviewResultId)) return;
    seenReviewResults.current.add(reviewResultId);
    const audio = audioRef.current;
    const reviewSound = reviewCorrect === true ? reviewCorrectSound : reviewWrongSound;
    // Do not play stale effects on late join or reconnect.
    if (!audio || !reviewSound || !ready.current || !connected || reviewCorrect === null
      || reviewRemainingMs === null || reviewRemainingMs <= reviewHoldMs - 500
      || connection.current.disconnectedAt !== null || reconnectedSnapshot.current === receivedAt) return;
    const currentOperation = ++operation.current;
    try {
      playingReview.current = reviewResultId;
      selectSource(audio, reviewSound);
      // The bundled beep is a temporary stand-in; custom sounds play at their original speed.
      audio.playbackRate = reviewSound === '/media/sounds/countdown-beep.wav' ? (reviewCorrect ? 1.4 : 0.7) : 1;
      audio.currentTime = 0;
      void audio.play().catch(() => {
        if (operation.current !== currentOperation) return;
        ready.current = false;
        setStatus('error');
        setError('Review sound could not play. Check the WAV file and retry.');
      });
    } catch {
      ready.current = false;
      setStatus('error');
      setError('Review sound could not play. Check the WAV file and retry.');
    }
  }, [reviewResultId, reviewRemainingMs, reviewCorrect, reviewHoldMs, connected, receivedAt, reviewCorrectSound, reviewWrongSound]);

  function enable() {
    const audio = audioRef.current;
    const previewSound = sound ?? reviewCorrectSound ?? reviewWrongSound;
    if (!audio || !previewSound || !connected || (phase !== null && (remaining === null || remaining <= 0))) return;
    const currentOperation = ++operation.current;
    unlocking.current = true;
    ready.current = false;
    setStatus('unlocking');
    setError('');
    try {
      // Reload even after a missing file is fixed. play() must run in this gesture.
      playingReview.current = null;
      selectSource(audio, previewSound);
      audio.playbackRate = 1;
      audio.load();
      void audio.play().then(() => {
        if (operation.current !== currentOperation) return;
        unlocking.current = false;
        ready.current = true;
        setStatus('enabled');
      }).catch((cause: unknown) => {
        if (operation.current !== currentOperation) return;
        unlocking.current = false;
        setStatus('error');
        setError(cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Browser blocked TV sound. Try enabling it again.'
          : 'TV sound could not load or play. Check the WAV file and retry.');
      });
    } catch {
      unlocking.current = false;
      setStatus('error');
      setError('TV sound could not load or play. Check the WAV file and retry.');
    }
  }

  return <div className="countdown-sound">
    <audio ref={audioRef} preload="auto" onError={() => {
      // An error event queued for an old load must not invalidate a successful retry.
      if (!audioRef.current?.error) return;
      operation.current++;
      unlocking.current = false;
      ready.current = false;
      setStatus('error');
      setError('Sound could not load. Check the WAV file and retry.');
    }} />
    {sound || reviewCorrectSound || reviewWrongSound ? <button type="button" className="small" onClick={enable}
      disabled={!connected || status === 'unlocking' || (phase !== null && (remaining === null || remaining <= 0))}>
      {status === 'unlocking' ? 'Enabling TV sounds...' : status === 'enabled' ? 'TV sounds enabled' :
        status === 'error' ? 'Retry TV sounds' : 'Enable TV sounds'}
    </button> : <span>TV sounds disabled</span>}
    {error && <span className="countdown-sound-error" role="alert">{error}</span>}
  </div>;
}