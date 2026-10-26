import { randomBytes, randomInt } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import { avatars, type ClientEvents, type ServerEvents } from '../src/shared/protocol.js';

const names = ['Alex', 'Sam', 'Charlie', 'Morgan', 'Robin', 'Jo', 'Taylor', 'Max', 'Sky', 'Jamie', 'Casey', 'Quinn'];
export interface PlayerOptions {
  count: number;
  url: string;
}
type PlayerSocket = Socket<ServerEvents, ClientEvents>;

export function parsePlayerOptions(args: string[]): PlayerOptions & { help: boolean } {
  const { values } = parseArgs({
    args,
    options: {
      count: { type: 'string', default: '12' },
      url: { type: 'string', default: 'http://localhost:3000' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('--count must be a whole number between 1 and 100.');
  }
  const url = new URL(values.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash) {
    throw new Error('--url must be a server origin, such as http://localhost:3000 (without /play).');
  }
  return { count, url: url.origin, help: values.help };
}

export async function joinLayoutPlayers(options: PlayerOptions): Promise<PlayerSocket[]> {
  const sockets: PlayerSocket[] = [];
  const batch = randomBytes(3).toString('hex');
  try {
    for (let index = 0; index < options.count; index++) {
      const socket: PlayerSocket = io(options.url, {
        auth: { role: 'player' },
        autoConnect: false,
        reconnection: false,
        timeout: 5000,
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        const connected = () => { cleanup(); resolve(); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => {
          socket.off('connect', connected);
          socket.off('connect_error', failed);
        };
        socket.once('connect', connected);
        socket.once('connect_error', failed);
        socket.connect();
      });
      const result = await socket.timeout(5000).emitWithAck('player:join', {
        name: `${names[randomInt(names.length)]} ${batch}-${index + 1}`,
        avatarId: avatars[randomInt(avatars.length)],
      });
      if (!result.ok) throw new Error(result.error);
      socket.auth = { role: 'player', token: result.data.token };
    }
    if (sockets.some((socket) => !socket.connected)) {
      throw new Error('A simulated player disconnected before all players could join.');
    }
    return sockets;
  } catch (error) {
    for (const socket of sockets) socket.disconnect();
    throw error;
  }
}

async function main() {
  const options = parsePlayerOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run players -- [--count 12] [--url http://localhost:3000]');
    console.log('Joins random players for layout testing. Keep running to keep them online.');
    console.log('Players do not buzz or change scores. Ctrl+C disconnects them, but their entries remain.');
    return;
  }
  console.log(`Joining ${options.count} layout-test players at ${options.url}...`);
  const sockets = await joinLayoutPlayers(options);
  console.log(`${sockets.length} players joined and connected. Open /display or /admin to inspect the layout.`);
  console.log('Players will not buzz or score automatically. Use host controls to adjust their scores.');
  console.log('Press Ctrl+C to disconnect. Remove offline players in admin between questions, or restart the server.');
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const socket of sockets) socket.disconnect();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    console.log('Layout-test players disconnected. Their names and scores remain in the game.');
  }
  for (const socket of sockets) {
    socket.on('disconnect', (reason) => {
      if (stopped) return;
      console.error(`A layout-test player disconnected (${reason}). Stopping this batch; rerun the command to join a new batch.`);
      process.exitCode = 1;
      stop();
    });
    socket.on('session:error', (message) => console.error(`Layout-test player: ${message}`));
    socket.on('player:identity', ({ playerId }) => {
      if (!playerId && !stopped) {
        console.error('A layout-test player was removed from the game. Stopping this batch.');
        process.exitCode = 1;
        stop();
      }
    });
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(`Unable to join layout-test players: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
