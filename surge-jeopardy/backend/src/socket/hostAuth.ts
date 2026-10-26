import type { Socket } from 'socket.io';

// A socket only earns host:<roomCode> membership via host:create/host:join,
// so this is the source of truth for "is this socket allowed to act as host here."
export function requireHost(socket: Socket, roomCode: string | undefined): boolean {
  return typeof roomCode === 'string' && socket.rooms.has(`host:${roomCode}`);
}

// Wraps a host:* handler so it refuses to run unless the socket is a member
// of host:<roomCode> — blocks a non-host socket from forging host events.
export function onHost<T extends { roomCode: string }>(
  socket: Socket,
  event: string,
  handler: (payload: T, ack?: (res: { ok: boolean; error?: string }) => void) => void,
) {
  socket.on(event, (payload: T, ack?: (res: { ok: boolean; error?: string }) => void) => {
    if (!requireHost(socket, payload?.roomCode)) {
      const message = 'Not authorized as host for this room';
      if (ack) ack({ ok: false, error: message });
      else socket.emit('error', { message });
      return;
    }
    handler(payload, ack);
  });
}
