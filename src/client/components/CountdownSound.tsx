import { useEffect, useRef, useState } from 'react';
import { advanceCountdownSound, countdownDigit, initialCountdownSoundState, type CountdownPhase } from '../countdownSound';

type SoundStatus = 'locked' | 'unlocking' | 'enabled' | 'error';

export function CountdownSound({ sound, id, phase, remaining, connected, receivedAt }: {
  sound: string | null; id: string | null; phase: CountdownPhase | null;
  remaining: number | null; connected: boolean; receivedAt: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const dedupe = useRef(initialCountdownSoundState);
  const operation = useRef(0);
  const unlocking = useRef(false);
  const ready = useRef(false);
  const connection = useRef({ disconnectedAt: null as number | null });
  const [status, setStatus] = useState<SoundStatus>('locked');
  const [error, setError] = useState('');
  const digit = countdownDigit(phase, remaining);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      operation.current++;
      audio?.pause();
    };
  }, []);

  // A changed source requires another gesture; keep the same audio element.
  useEffect(() => {
    operation.current++;
    audioRef.current?.pause();
    ready.current = false;
    unlocking.current = false;
    setStatus('locked');
    setError('');
  }, [sound]);

  useEffect(() => {
    // Cancel an obsolete play or unlock, but not on ordinary snapshot refreshes.
    operation.current++;
    audioRef.current?.pause();
    if (unlocking.current) {
      unlocking.current = false;
      setStatus('locked');
    }
  }, [id, phase, digit, connected, sound]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!connected) connection.current.disconnectedAt = receivedAt;
    const fresh = connected && (connection.current.disconnectedAt === null || receivedAt !== connection.current.disconnectedAt);
    if (fresh) connection.current.disconnectedAt = null;
    const result = advanceCountdownSound(dedupe.current, {
      id, phase, remaining, connected: fresh, enabled: !!sound && ready.current,
    });
    dedupe.current = result.state;
    if (!audio || !result.play) return;
    const currentOperation = ++operation.current;
    try {
      audio.currentTime = 0;
      void audio.play().catch((cause: unknown) => {
        if (operation.current !== currentOperation) return;
        ready.current = false;
        setStatus('error');
        setError(cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Browser blocked countdown sound. Enable it again.'
          : 'Countdown sound could not play. Check the WAV file and retry.');
      });
    } catch {
      ready.current = false;
      setStatus('error');
      setError('Countdown sound could not play. Check the WAV file and retry.');
    }
  }, [id, phase, remaining, connected, receivedAt, sound]);

  function enable() {
    const audio = audioRef.current;
    if (!audio || !sound || !connected || (phase !== null && (remaining === null || remaining <= 0))) return;
    const currentOperation = ++operation.current;
    unlocking.current = true;
    ready.current = false;
    setStatus('unlocking');
    setError('');
    try {
      // Reload even after a missing file is fixed. play() must run in this gesture.
      audio.load();
      void audio.play().then(() => {
        if (operation.current !== currentOperation) return;
        audio.pause();
        unlocking.current = false;
        ready.current = true;
        setStatus('enabled');
      }).catch((cause: unknown) => {
        if (operation.current !== currentOperation) return;
        unlocking.current = false;
        setStatus('error');
        setError(cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Browser blocked countdown sound. Try enabling it again.'
          : 'Countdown sound could not load or play. Check the WAV file and retry.');
      });
    } catch {
      unlocking.current = false;
      setStatus('error');
      setError('Countdown sound could not load or play. Check the WAV file and retry.');
    }
  }

  return <div className="countdown-sound">
    <audio ref={audioRef} src={sound ?? undefined} preload="auto" onError={() => {
      // An error event queued for an old load must not invalidate a successful retry.
      if (!sound || !audioRef.current?.error) return;
      operation.current++;
      unlocking.current = false;
      ready.current = false;
      setStatus('error');
      setError('Countdown sound could not load. Check the WAV file and retry.');
    }} />
    {sound ? <button type="button" className="small" onClick={enable}
      disabled={!connected || status === 'unlocking' || (phase !== null && (remaining === null || remaining <= 0))}>
      {status === 'unlocking' ? 'Enabling countdown sound...' : status === 'enabled' ? 'Countdown sound enabled' :
        status === 'error' ? 'Retry countdown sound' : 'Enable countdown sound'}
    </button> : <span>Countdown sound disabled</span>}
    {error && <span className="countdown-sound-error" role="alert">{error}</span>}
  </div>;
}