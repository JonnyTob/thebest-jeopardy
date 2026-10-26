import { useEffect, useRef, useState } from 'react';

// Shared deadline/clock-offset hook used by the board, host and phone views.
// `deadline` and `serverNow` come from the server (epoch ms); we compute a
// clock offset from the most recent `serverNow` so the countdown stays in
// sync even if the client's clock is off, then drive the remaining time with
// requestAnimationFrame for a smooth ring/number.
// `precision`: 'ms' (default) re-renders every animation frame with the raw
// remaining-ms value, for consumers that need sub-second precision (e.g. a
// smooth ring animation or a sub-second "urgent" threshold). 'second' still
// runs the rAF loop every frame internally (so it stays accurate/responsive
// to the deadline) but only calls setState - and therefore only triggers a
// re-render - on frames where the displayed integer second
// (Math.ceil(remainingMs / 1000)) actually changes, for consumers that only
// ever display that integer.
export function useCountdown(
  deadline: number | null,
  serverNow: number | null,
  precision: 'ms' | 'second' = 'ms',
) {
  const offsetRef = useRef(0); // serverNow - Date.now() at the moment we last heard from the server

  useEffect(() => {
    if (serverNow != null) offsetRef.current = serverNow - Date.now();
  }, [serverNow]);

  const [remainingMs, setRemainingMs] = useState<number | null>(
    deadline != null ? Math.max(0, deadline - (Date.now() + offsetRef.current)) : null,
  );

  useEffect(() => {
    if (deadline == null) {
      setRemainingMs(null);
      return;
    }
    let raf: number;
    let lastDisplayedSecond: number | null = null;
    const tick = () => {
      const now = Date.now() + offsetRef.current;
      const newRemainingMs = Math.max(0, deadline - now);
      if (precision === 'second') {
        const displayedSecond = Math.ceil(newRemainingMs / 1000);
        if (displayedSecond !== lastDisplayedSecond) {
          lastDisplayedSecond = displayedSecond;
          setRemainingMs(newRemainingMs);
        }
      } else {
        setRemainingMs(newRemainingMs);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [deadline, precision]);

  return remainingMs;
}
