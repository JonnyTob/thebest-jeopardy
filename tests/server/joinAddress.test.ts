import assert from 'node:assert/strict';
import { test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../../src/server/app.js';
import type { ClientEvents, ServerEvents } from '../../src/shared/protocol.js';

test('host address choice reaches displays, survives reconnects, and rejects non-host changes', async () => {
  const application = await createApp({ storage: { load: async () => ({ id: 1, title: 'Quiz', questions: [] }) },
    passcode: 'host-password', joinOrigin: 'http://192.168.1.42:3000', serveClient: false });
  await new Promise<void>((resolve) => application.httpServer.listen(0, '127.0.0.1', resolve));
  const address = application.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: Socket<ServerEvents, ClientEvents>[] = [];
  async function connect(role: 'host' | 'display') {
    const socket: Socket<ServerEvents, ClientEvents> = io(base, { autoConnect: false,
      auth: { role, passcode: role === 'host' ? 'host-password' : undefined }, extraHeaders: { origin: 'http://localhost:4321' } });
    sockets.push(socket);
    const first = new Promise<string | null>((resolve, reject) => { socket.once('session:joinUrl', resolve); socket.once('connect_error', reject); });
    socket.connect();
    return { socket, initial: await first };
  }
  try {
    const host = await connect('host');
    const display = await connect('display');
    assert.equal(host.initial, 'http://192.168.1.42:3000/play');
    assert.equal(display.initial, host.initial);
    assert.equal((await display.socket.timeout(3000).emitWithAck('host:selectJoinUrl', 'http://localhost:4321/play')).ok, false);
    assert.equal((await host.socket.timeout(3000).emitWithAck('host:selectJoinUrl', 'https://unrelated.example/play')).ok, false);
    const update = new Promise<string | null>((resolve) => display.socket.once('session:joinUrl', resolve));
    assert.equal((await host.socket.timeout(3000).emitWithAck('host:selectJoinUrl', 'http://localhost:4321/play')).ok, true);
    assert.equal(await update, 'http://localhost:4321/play');
    const info = await (await fetch(`${base}/api/info`)).json();
    assert.equal(info.selectedJoinUrl, 'http://localhost:4321/play');
    assert.equal((await connect('display')).initial, 'http://localhost:4321/play');
  } finally { for (const socket of sockets) socket.disconnect(); await application.close(); }
});
