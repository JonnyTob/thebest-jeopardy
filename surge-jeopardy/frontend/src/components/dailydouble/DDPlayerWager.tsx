import { useState } from 'react';
import { socket } from '../../socket';
import type { DailyDoubleState } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import WagerInput from '../shared/WagerInput';

type Ack = { ok: boolean; error?: string };

export default function DDPlayerWager({ dailyDouble }: { dailyDouble: DailyDoubleState }) {
  const [error, setError] = useState('');

  function lockWager(amount: number) {
    socket.emit(SOCKET_EVENTS.DD_WAGER, { amount }, (res: Ack) => {
      if (!res.ok) setError(res.error ?? 'Could not lock wager');
    });
  }

  return (
    <WagerInput
      heading="Daily Double!"
      subtitle={`Max wager: $${dailyDouble.maxWager}`}
      maxWager={dailyDouble.maxWager}
      locked={dailyDouble.stage !== 'wagering'}
      lockedAmount={dailyDouble.wager ?? undefined}
      waitingText="Get ready…"
      onLock={lockWager}
      error={error}
    />
  );
}
