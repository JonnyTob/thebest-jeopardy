import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { ArchiveQuizStorage, ArchiveQuizSettingsStorage } from './storage.js';
import { loadGlobalSettings } from './settings.js';

const settings = loadGlobalSettings(path.resolve('settings.json'));
const { port, joinOrigin, startupQuizId, ...serverSettings } = settings.server;
const passcode = serverSettings.requireAdminPasscode ? process.env.HOST_PASSCODE ?? randomBytes(6).toString('hex') : '';
if (serverSettings.requireAdminPasscode && passcode.length < 8) throw new Error('HOST_PASSCODE must contain at least 8 characters.');
const storage = new ArchiveQuizStorage(path.resolve(process.env.QUIZ_DATA_DIR ?? 'quizzes'), startupQuizId);
const application = await createApp({
  storage,
  quizMediaRoot: storage.mediaRoot,
  passcode,
  production: process.argv.includes('--production'),
  joinOrigin,
  gameSetup: settings.gameSetup,
  settingsStorage: new ArchiveQuizSettingsStorage(storage),
  serverSettings,
  branding: settings.branding,
});
application.httpServer.on('error', (error) => {
  console.error(`Unable to start ${settings.branding.name}:`, error);
  process.exitCode = 1;
  void application.close();
});
application.httpServer.listen(port, '0.0.0.0', () => {
  console.log(`${settings.branding.name}: http://localhost:${port}`);
  console.log(`Private host console: http://localhost:${port}/admin`);
  if (joinOrigin) console.log(`Player join URL: ${new URL('/play', joinOrigin).href}`);
  if (serverSettings.requireAdminPasscode) console.log(`Host passcode: ${passcode} (keep private)`);
  else console.warn('Admin passcode protection is DISABLED. Anyone who can reach this server can control the quiz.');
  console.log('Quiz setup is saved; players, scores and active game state are lost when this server stops.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void application.close().catch((error: unknown) => {
      console.error(`Error shutting down ${settings.branding.name}:`, error);
      process.exitCode = 1;
    });
  });
}
