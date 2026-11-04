/** Local, single-process Socket.IO load probe; results include client overhead. */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import type { ClientEvents, ServerEvents, Snapshot } from '../src/shared/protocol.js';

type Client = Socket<ServerEvents, ClientEvents>;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(count: number) {
  const app = await createApp({ storage: { load: async () => ({ id: 1, title: 'Load test', questions: [
    { id: 'q', type: 'text', mode: 'buzzer', question: 'Clue', answer: 'Answer', timerSeconds: 30 },
  ] }) }, passcode: 'benchmark-passcode', serveClient: false, serverSettings: { maxPlayers: count } });
  const clients: Client[] = [];
  let bytes = 0;
  let messages = 0;
  let measuring = false;
  try {
    await new Promise<void>((resolve) => app.httpServer.listen(0, '127.0.0.1', resolve));
    const address = app.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('No listening address');
    const url = `http://127.0.0.1:${address.port}`;
    const connect = async (role: 'host' | 'player') => {
      const socket: Client = io(url, { auth: role === 'host' ? { role, passcode: 'benchmark-passcode' } : { role }, reconnection: false, transports: ['websocket'] });
      clients.push(socket);
      if (role === 'player') socket.on('session:snapshot', (state: Snapshot) => {
        if (measuring) { bytes += Buffer.byteLength(JSON.stringify(state)); messages++; }
      });
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    };
    const host = await connect('host');
    const players = await Promise.all(Array.from({ length: count }, () => connect('player')));
    await Promise.all(players.map(async (socket, index) => {
      const result = await socket.timeout(30000).emitWithAck('player:join', { name: `Player ${index}`, avatarId: 'fox' });
      if (!result.ok) throw new Error(result.error);
    }));
    const opened = new Promise<void>((resolve) => host.on('session:snapshot', (state) => { if (state.phase === 'QUESTION_OPEN') resolve(); }));
    const start = await host.timeout(10000).emitWithAck('host:command', { id: randomUUID(), revision: app.engine.revision, action: { type: 'start' } });
    if (!start.ok) throw new Error(start.error);
    await opened;
    await delay(300);
    bytes = 0; messages = 0; measuring = true;
    const cpu = process.cpuUsage();
    const wall = performance.now();
    await delay(2000);
    const idleBytes = bytes, idleMessages = messages;
    const latencies = await Promise.all(players.map(async (socket) => {
      const startAt = performance.now();
      const result = await socket.timeout(30000).emitWithAck('player:buzz');
      return { ms: performance.now() - startAt, ok: result.ok };
    }));
    await delay(300);
    measuring = false;
    const used = process.cpuUsage(cpu);
    const ms = performance.now() - wall;
    const times = latencies.map((entry) => entry.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ players: count, idleSeconds: 2, idleSnapshotBytes: idleBytes, idleSnapshotMessages: idleMessages,
      snapshotBytesIncludingBuzz: bytes, snapshotMessagesIncludingBuzz: messages, acceptedBuzzes: latencies.filter((entry) => entry.ok).length,
      buzzP50Ms: +times[Math.floor(times.length * .5)].toFixed(2), buzzP95Ms: +times[Math.floor(times.length * .95)].toFixed(2),
      combinedServerClientCpuPercent: +((used.user + used.system) / 1000 / ms * 100).toFixed(1),
      fullSnapshotBytes: Buffer.byteLength(JSON.stringify(app.engine.snapshot())), note: 'JSON payload sizes; excludes transport overhead; server and simulated clients share one process' }));
  } finally {
    for (const socket of clients) socket.disconnect();
    await app.close();
  }
}
for (const size of [50, 100, 300]) await run(size);
