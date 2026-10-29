import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readdirSync, lstatSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { Quiz } from '../shared/protocol.js';
import type { LoadedMediaReference } from '../shared/mediaLibrary.js';
import { ArchiveConflictError, ArchiveQuizStorage } from './storage.js';

const extensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.mp4', '.webm']);
const maxUpload = 50 * 1024 * 1024;

function mediaFiles(root: string, prefix = ''): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...mediaFiles(root, relative));
    else if (entry.isFile() && /^media\/[a-zA-Z0-9_./-]+$/.test(`media/${relative}`) && !relative.includes('..')) result.push(`media/${relative}`);
  }
  return result.sort();
}

function referenced(quiz: { quiz: { coverImage?: string }; questions: { media?: string }[] }, file: string): boolean {
  return quiz.quiz.coverImage === file || quiz.questions.some((question) => question.media === file);
}

export function editorRoutes(storage: ArchiveQuizStorage, quiz: Quiz, passcode: string, requirePasscode: boolean) {
  const router = express.Router();
  const runtime = { quiz: { coverImage: quiz.coverImage?.replace('/media/quiz/', 'media/') },
    questions: quiz.questions.map((q) => ({ media: q.media?.replace('/media/quiz/', 'media/') })) };
  const loadedReferences: LoadedMediaReference[] = [];
  if (runtime.quiz.coverImage) loadedReferences.push({ file: runtime.quiz.coverImage, kind: 'cover' });
  runtime.questions.forEach((question, questionIndex) => {
    if (question.media) loadedReferences.push({ file: question.media, kind: 'question', questionIndex });
  });
  const failures = new Map<string, { count: number; since: number }>();
  const expected = Buffer.from(passcode);
  router.use((req, res, next) => {
    if (req.get('x-quiz-editor') !== '1') { res.status(403).json({ error: 'Host authorization required.' }); return; }
    if (!requirePasscode) { next(); return; }
    const address = req.ip ?? '';
    const now = Date.now();
    const previous = failures.get(address);
    const attempts = previous && now - previous.since < 60000 ? previous : undefined;
    if (attempts && attempts.count >= 5) { res.status(429).json({ error: 'Too many host login attempts. Wait one minute.' }); return; }
    let decoded: string;
    try { decoded = decodeURIComponent(req.get('x-host-passcode') ?? ''); }
    catch { res.status(400).json({ error: 'Invalid host credentials.' }); return; }
    const supplied = Buffer.from(decoded);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      failures.set(address, { count: (attempts?.count ?? 0) + 1, since: attempts?.since ?? now });
      res.status(401).json({ error: 'Incorrect host passcode.' }); return;
    }
    failures.delete(address);
    next();
  });
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  function fail(res: Response, error: unknown) {
    if (error instanceof ArchiveConflictError) { res.status(409).json({ error: error.message }); return; }
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Quiz validation failed.', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) }); return;
    }
    console.error('Quiz editor request failed:', error);
    res.status(500).json({ error: 'Quiz editor request failed. Check the server console.' });
  }

  router.get('/archive', (_req, res) => {
    try { res.json(storage.readArchive()); } catch (error) { fail(res, error); }
  });
  router.put('/archive', express.json({ limit: '12mb' }), (req, res) => {
    try {
      if (typeof req.body?.revision !== 'string' || !req.body.archive) { res.status(400).json({ error: 'Archive and revision are required.' }); return; }
      if (req.body.archive.quiz?.id !== storage.quizId) { res.status(400).json({ error: 'Quiz ID cannot be changed.' }); return; }
      const archive = storage.parseArchive(req.body.archive);
      const files = new Set(mediaFiles(storage.mediaRoot));
      const missing = [archive.quiz.coverImage, ...archive.questions.map((q) => q.media)].filter((file): file is string => !!file && !files.has(file));
      if (missing.length) { res.status(400).json({ error: `Media not found: ${[...new Set(missing)].join(', ')}` }); return; }
      res.json({ revision: storage.saveArchive(archive, req.body.revision) });
    } catch (error) { fail(res, error); }
  });
  router.get('/media', (_req, res) => {
    try { res.json({ files: mediaFiles(storage.mediaRoot), loadedReferences }); } catch (error) { fail(res, error); }
  });
  router.post('/media', express.raw({ type: 'application/octet-stream', limit: maxUpload }), (req, res) => {
    try {
      let name: string;
      try { name = decodeURIComponent(req.get('x-file-name') ?? ''); }
      catch { res.status(400).json({ error: 'Invalid file name.' }); return; }
      const extension = path.extname(name).toLowerCase();
      if (!extensions.has(extension) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Choose a non-empty PNG, JPEG, GIF, WebP, MP3, WAV, OGG, MP4 or WebM file.' }); return;
      }
      const basename = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'upload';
      for (let attempt = 0; attempt < 32; attempt++) {
        const filename = `${basename}-${randomBytes(2).toString('hex')}${extension}`;
        try {
          writeFileSync(path.join(storage.mediaRoot, filename), req.body, { flag: 'wx' });
          res.status(201).json({ file: `media/${filename}` });
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      res.status(409).json({ error: 'Could not find an unused media filename. Try again.' });
    } catch (error) { fail(res, error); }
  });
  router.delete('/media', express.json({ limit: '8kb' }), (req: Request, res: Response) => {
    try {
      const file: unknown = req.body?.file;
      if (typeof file !== 'string' || !mediaFiles(storage.mediaRoot).includes(file)) {
        res.status(404).json({ error: 'Media file not found.' }); return;
      }
      if (referenced(storage.readArchive().archive, file) || referenced(runtime, file)) {
        res.status(409).json({ error: 'This file is referenced by the saved or currently loaded quiz and cannot be deleted.' }); return;
      }
      const full = path.join(storage.mediaRoot, file.slice('media/'.length));
      if (!lstatSync(full).isFile()) { res.status(404).json({ error: 'Media file not found.' }); return; }
      unlinkSync(full);
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });
  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Invalid request JSON.' }); return; }
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) {
      res.status(413).json({ error: 'Request is too large (quiz limit: 12 MB; upload limit: 50 MB).' }); return;
    }
    fail(res, error);
  });
  return router;
}
