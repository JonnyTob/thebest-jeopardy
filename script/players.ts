import { randomInt } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import { avatars, type ClientEvents, type ServerEvents, type Snapshot } from '../src/shared/protocol.js';
import { createPlayerSimulator } from './simulatedPlayers.js';

const names = ['Alex', 'Sam', 'Charlie', 'Morgan', 'Robin', 'Jo', 'Taylor', 'Max', 'Sky', 'Jamie', 'Casey', 'Quinn'];
export interface PlayerOptions {
  count: number;
  url: string;
}
type PlayerSocket = Socket<ServerEvents, ClientEvents>;

export function parsePlayerOptions(args: string[]): PlayerOptions & { help: boolean; play: boolean } {
  const { values } = parseArgs({
    args,
    options: {
      count: { type: 'string', default: '12' },
      url: { type: 'string', default: 'http://localhost:3000' },
      play: { type: 'boolean', default: false },
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
  return { count, url: url.origin, help: values.help, play: values.play };
}

export async function joinLayoutPlayers(options: PlayerOptions, attach?: (socket: PlayerSocket) => void): Promise<PlayerSocket[]> {
  const sockets: PlayerSocket[] = [];
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
      attach?.(socket);
      const state = await new Promise<Snapshot>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for the server settings.')); }, 5000);
        const received = (snapshot: Snapshot) => { cleanup(); resolve(snapshot); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('session:snapshot', received);
          socket.off('connect_error', failed);
        };
        socket.once('session:snapshot', received);
        socket.once('connect_error', failed);
        socket.connect();
      });
      const limit = state.serverSettings?.maxPlayerNameLength;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error('The server did not provide a valid player name length limit.');
      }
      const suffixLength = Math.min(limit, 4);
      const capacity = 36 ** suffixLength;
      if (options.count > capacity) {
        throw new Error(`Cannot generate ${options.count} distinct names with the server's ${limit}-character limit.`);
      }
      const prefix = limit >= 6 ? `${names[randomInt(names.length)].slice(0, limit - suffixLength - 1)}-` : '';
      const start = randomInt(capacity);
      let joined = false;
      for (let attempt = 0; attempt < Math.min(capacity, 1296); attempt++) {
        const suffix = ((start + attempt) % capacity).toString(36).padStart(suffixLength, '0');
        const result = await socket.timeout(5000).emitWithAck('player:join', {
          name: `${prefix}${suffix}`,
          avatarId: avatars[randomInt(avatars.length)],
        });
        if (result.ok) {
          socket.auth = { role: 'player', token: result.data.token };
          joined = true;
          break;
        }
        if (result.error !== 'That nickname is already in use.') throw new Error(result.error);
      }
      if (!joined) throw new Error(`Could not find an unused name within the server's ${limit}-character limit.`);
    }
    if (sockets.some((socket) => !socket.connected)) {
      throw new Error('A simulated player disconnected before all players could join.');
    }
    return sockets;
  } catch (error) {
    for (const socket of sockets) socket.disconnect();
    if (sockets.length > 1) console.error('Some players may have joined before the failure; their disconnected entries remain in the game.');
    throw error;
  }
}

async function main() {
  const options = parsePlayerOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run players -- [--play] [--count 12] [--url http://localhost:3000]');
    console.log('Joins random players for layout testing. Keep running to keep them online.');
    console.log('Add --play to simulate buzzing and placeholder typed answers; the host still controls the game.');
    console.log('Ctrl+C disconnects players, but their entries and scores remain.');
    return;
  }
  console.log(`Joining ${options.count} ${options.play ? 'simulated' : 'layout-test'} players at ${options.url}...`);
  const simulator = options.play ? createPlayerSimulator({ onFatal: () => { process.exitCode = 1; stop(); } }) : undefined;
  const sockets = await joinLayoutPlayers(options, simulator?.attach);
  console.log(`${sockets.length} players joined and connected. Open /display or /admin to inspect the layout.`);
  console.log(options.play
    ? 'Players will buzz and submit placeholder answers. Start and judge the game in the host console.'
    : 'Players will not buzz or score automatically. Use host controls to adjust their scores.');
  console.log('Press Ctrl+C to disconnect. Remove offline players in admin between questions, or restart the server.');
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    simulator?.stop();
    for (const socket of sockets) socket.disconnect();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    console.log(`${options.play ? 'Simulated' : 'Layout-test'} players disconnected. Their names and scores remain in the game.`);
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
  simulator?.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(`Unable to join simulated players: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
