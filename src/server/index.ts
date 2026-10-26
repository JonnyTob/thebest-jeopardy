import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { JsonQuizStorage } from './storage.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const passcode = process.env.HOST_PASSCODE ?? randomBytes(6).toString('hex');
if (passcode.length < 8) throw new Error('HOST_PASSCODE must contain at least 8 characters.');
const application = await createApp({
  storage: new JsonQuizStorage(path.resolve('src/data/questions.json')),
  passcode,
  production: process.argv.includes('--production'),
});
application.httpServer.on('error', (error) => {
  console.error('Unable to start Quiz Night:', error);
  process.exitCode = 1;
  void application.close();
});
application.httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Quiz Night: http://localhost:${port}`);
  console.log(`Private host console: http://localhost:${port}/admin`);
  console.log(`Host passcode: ${passcode}`);
  console.log('Keep this passcode private. Active game state is lost when this server stops.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void application.close().catch((error: unknown) => {
      console.error('Error shutting down Quiz Night:', error);
      process.exitCode = 1;
    });
  });
}
