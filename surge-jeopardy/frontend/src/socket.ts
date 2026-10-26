import { io } from 'socket.io-client';

function getBackendUrl(): string {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  // Production: frontend is served from the same Express server — same origin, no port needed.
  if (import.meta.env.PROD) return window.location.origin;
  // Dev: Vite runs on 5173, backend on 3001, but same hostname — works for LAN too.
  return `${window.location.protocol}//${window.location.hostname}:3001`;
}

export const socket = io(getBackendUrl(), {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
});
