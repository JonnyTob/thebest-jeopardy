// Barrel file: gameManager.ts used to be a single 500-line file mixing
// session CRUD, the buzzer/lockout/queue state machine, the Daily Double
// wager state machine, and round-progression logic, all as flat exported
// functions mutating a shared module-level `sessions` Map. It has since been
// split into focused submodules under ./gameManager/ — this file re-exports
// everything so that socketHandler.ts and finalJeopardy.ts (which do
// `import * as gm from './gameManager.js'`) need zero import-path changes.
export { PERMANENT_LOCKOUT } from './gameManager/state.js';
export * from './gameManager/sessions.js';
export * from './gameManager/buzzer.js';
export * from './gameManager/dailyDouble.js';
export * from './gameManager/rounds.js';
