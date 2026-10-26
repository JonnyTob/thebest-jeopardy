import { useState } from 'react';

interface WagerInputProps {
  heading?: string;
  subtitle?: string;
  maxWager: number;
  locked: boolean;
  lockedAmount?: number;
  waitingText?: string;
  onLock: (amount: number) => void;
  error?: string;
}

// Shared wager UI: numeric input + $0/Half/All-in quick buttons + a
// confirm-to-lock step, since a locked wager can't be taken back.
// Used by both Final Jeopardy (PlayerFinal) and Daily Double.
export default function WagerInput({ heading, subtitle, maxWager, locked, lockedAmount, waitingText, onLock, error }: WagerInputProps) {
  const [wagerInput, setWagerInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const amount = Math.max(0, Math.min(maxWager, Math.round(Number(wagerInput) || 0)));

  if (locked) {
    return (
      <div className="text-center">
        {heading && <h2 className="text-xl font-black text-jeopardy-gold mb-2">{heading}</h2>}
        <p className="text-white text-lg">
          Wager locked: <span className="text-jeopardy-gold font-black">${lockedAmount ?? maxWager}</span>
        </p>
        {waitingText && <p className="text-gray-500 text-sm mt-4 animate-pulse">{waitingText}</p>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm text-center">
      {heading && <h2 className="text-xl font-black text-jeopardy-gold mb-1">{heading}</h2>}
      {subtitle && <p className="text-gray-400 text-sm mb-4">{subtitle}</p>}
      {!confirming ? (
        <>
          <input
            inputMode="numeric"
            className="input-field text-2xl text-center py-4 mb-3"
            placeholder="0"
            value={wagerInput}
            onChange={e => setWagerInput(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <div className="flex gap-2 mb-4">
            <button className="btn-ghost flex-1 text-sm" onClick={() => setWagerInput('0')}>$0</button>
            <button className="btn-ghost flex-1 text-sm" onClick={() => setWagerInput(String(Math.floor(maxWager / 2)))}>Half</button>
            <button className="btn-ghost flex-1 text-sm" onClick={() => setWagerInput(String(maxWager))}>All-in</button>
          </div>
          {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
          <button className="btn-primary w-full py-3" onClick={() => setConfirming(true)}>
            Wager ${amount}
          </button>
        </>
      ) : (
        <div>
          <p className="text-white text-lg mb-4">Lock in <span className="text-jeopardy-gold font-black">${amount}</span>? This can't be changed.</p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => setConfirming(false)}>Back</button>
            <button className="btn-primary flex-1" onClick={() => onLock(amount)}>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}
