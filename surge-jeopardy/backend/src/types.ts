// Re-exports the canonical shared types. Kept as a thin shim so nothing
// inside backend/src that does `import { X } from './types.js'` (or
// '../types.js') needs to change.
export * from './shared/types.js';
