import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { hostCommandSchema, joinSchema, type ClientEvents, type ServerEvents } from '../shared/protocol.js';
import { GameEngine, GameError } from './engine.js';
import type { QuizStorage } from './storage.js';

interface SocketData {
  host: boolean;
  playerId?: string;
}
interface AppOptions {
  storage: QuizStorage;
  passcode: string;
  production?: boolean;
  serveClient?: boolean;
  joinOrigin?: string;
}

export async function createApp(options: AppOptions) {
  let joinOrigin: string | undefined;
  if (options.joinOrigin !== undefined) {
    let parsed: URL;
    try { parsed = new URL(options.joinOrigin); }
    catch { throw new Error('JOIN_ORIGIN must be an HTTP(S) origin, for example http://192.168.1.42:3000.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('JOIN_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.');
    }
    joinOrigin = parsed.origin;
  }
  const engine = new GameEngine(await options.storage.load());
  const app = express();
  app.disable('x-powered-by');
  const httpServer = createServer(app);
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: 16384,
  });
  const tokens = new Map<string, string>();
  const failedHosts = new Map<string, { count: number; since: number }>();
  const passcode = Buffer.from(options.passcode);

  io.use((socket, next) => {
    const auth = socket.handshake.auth;
    socket.data.host = false;
    if (auth.role === 'host') {
      const address = socket.handshake.address;
      const now = Date.now();
      let failures = failedHosts.get(address);
      if (failures && now - failures.since >= 60000) {
        failedHosts.delete(address);
        failures = undefined;
      }
      if (failures && failures.count >= 5) {
        return next(new Error('Too many host login attempts. Wait one minute.'));
      }
      const supplied = Buffer.from(typeof auth.passcode === 'string' ? auth.passcode : '');
      if (supplied.length !== passcode.length || !timingSafeEqual(supplied, passcode)) {
        failedHosts.set(address, { count: (failures?.count ?? 0) + 1, since: failures?.since ?? now });
        return next(new Error('Incorrect host passcode.'));
      }
      failedHosts.delete(address);
      socket.data.host = true;
    } else if (auth.role === 'player' && typeof auth.token === 'string') {
      const playerId = tokens.get(auth.token);
      if (playerId && engine.players.has(playerId)) socket.data.playerId = playerId;
    }
    next();
  });

  function broadcast() {
    const publicState = engine.snapshot();
    const privateState = engine.snapshot(true);
    for (const socket of io.sockets.sockets.values()) {
      socket.emit('session:snapshot', socket.data.host ? privateState : publicState);
    }
  }

  function errorMessage(error: unknown): string {
    if (error instanceof GameError) return error.message;
    console.error('Unexpected game command failure:', error);
    return 'An unexpected server error occurred. Check the server console.';
  }

  io.on('connection', (socket) => {
    if (socket.data.playerId) engine.setConnected(socket.data.playerId, true);
    socket.emit('player:identity', { playerId: socket.data.playerId ?? null });
    broadcast();

    socket.on('player:join', (input, ack) => {
      if (typeof ack !== 'function') {
        socket.emit('session:error', 'Join requests require an acknowledgement.');
        return;
      }
      const parsed = joinSchema.safeParse(input);
      if (!parsed.success) return ack({ ok: false, error: 'Choose a nickname (1-24 characters) and an available avatar.' });
      if (socket.handshake.auth.role !== 'player' || socket.data.playerId) {
        return ack({ ok: false, error: 'This connection cannot join as a new player.' });
      }
      try {
        const player = engine.join(parsed.data);
        const token = randomBytes(32).toString('hex');
        tokens.set(token, player.id);
        socket.data.playerId = player.id;
        ack({ ok: true, data: { token, playerId: player.id } });
        socket.emit('player:identity', { playerId: player.id });
        broadcast();
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on('player:buzz', (ack) => {
      if (typeof ack !== 'function') {
        socket.emit('session:error', 'Buzz requests require an acknowledgement.');
        return;
      }
      try {
        if (!socket.data.playerId) throw new GameError('Join the game before buzzing.');
        engine.buzz(socket.data.playerId);
        ack({ ok: true, data: undefined });
        broadcast();
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
      }
    });

    socket.on('host:command', (input, ack) => {
      if (typeof ack !== 'function') {
        socket.emit('session:error', 'Host commands require an acknowledgement.');
        return;
      }
      if (!socket.data.host) return ack({ ok: false, error: 'Host authorization required.' });
      const parsed = hostCommandSchema.safeParse(input);
      if (!parsed.success) return ack({ ok: false, error: 'Invalid host command. Check the values and try again.' });
      try {
        engine.command(parsed.data);
        if (parsed.data.action.type === 'removePlayer') {
          const removedId = parsed.data.action.playerId;
          for (const [token, playerId] of tokens) if (playerId === removedId) tokens.delete(token);
          for (const client of io.sockets.sockets.values()) {
            if (client.data.playerId === removedId) {
              delete client.data.playerId;
              client.emit('player:identity', { playerId: null });
              client.emit('session:error', 'The host removed your player. You can join again.');
            }
          }
        }
        ack({ ok: true, data: undefined });
        broadcast();
      } catch (error) {
        ack({ ok: false, error: errorMessage(error) });
        socket.emit('session:snapshot', engine.snapshot(true));
      }
    });

    socket.on('disconnect', () => {
      const playerId = socket.data.playerId;
      if (playerId && ![...io.sockets.sockets.values()].some((s) => s.data.playerId === playerId)) {
        engine.setConnected(playerId, false);
        broadcast();
      }
    });
  });

  const interval = setInterval(() => {
    if (engine.snapshot().clockRunning) broadcast();
    for (const [address, failures] of failedHosts) {
      if (Date.now() - failures.since > 60000) failedHosts.delete(address);
    }
  }, 200);
  interval.unref();
  io.engine.on('close', () => clearInterval(interval));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/info', (_req, res) => {
    const address = httpServer.address();
    const port = address && typeof address !== 'string' ? address.port : 3000;
    const hosts = Object.values(networkInterfaces()).flatMap((entries) =>
      (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => entry.address));
    res.json({ joinUrls: joinOrigin ? [`${joinOrigin}/play`] : hosts.map((host) => `http://${host}:${port}/play`),
      preferredJoinUrl: joinOrigin ? `${joinOrigin}/play` : undefined, source: 'src/data/questions.json' });
  });

  let closeVite: (() => Promise<void>) | undefined;
  if (options.serveClient !== false) {
    if (options.production) {
      app.use(express.static(path.resolve('dist/client'), { index: false }));
      app.get(['/', '/display', '/admin', '/play'], (_req, res) => {
        res.sendFile(path.resolve('dist/client/index.html'));
      });
    } else {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: { server: httpServer },
          fs: { allow: ['src/client', 'src/shared', 'src/public', 'node_modules'].map((directory) => path.resolve(directory)) },
        },
      });
      app.use(vite.middlewares);
      closeVite = async () => {
        // Finish background transforms before closing their file watchers.
        await vite.waitForRequestsIdle();
        await vite.close();
      };
    }
  }
  return {
    app, httpServer, io, engine,
    async close() {
      clearInterval(interval);
      await closeVite?.();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
