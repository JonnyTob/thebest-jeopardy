import type { NextFunction, Request, Response } from 'express';

const HOST_PASSCODE = process.env.HOST_PASSCODE;

if (!HOST_PASSCODE && process.env.NODE_ENV === 'production') {
  throw new Error('HOST_PASSCODE must be set in production — refusing to start with open write access');
}

// Gates mutating board/media routes behind a shared passcode so a stranger
// on the LAN (or internet, once deployed) can't edit or delete a game in
// progress. Left permissive when HOST_PASSCODE is unset in dev for convenience.
export function requireHostPasscode(req: Request, res: Response, next: NextFunction) {
  if (!HOST_PASSCODE) return next();
  const provided = req.header('X-Host-Passcode');
  if (provided === HOST_PASSCODE) return next();
  res.status(401).json({ error: 'Invalid or missing host passcode' });
}
