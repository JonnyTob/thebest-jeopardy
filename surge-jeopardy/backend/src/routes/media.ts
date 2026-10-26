import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID as uuidv4 } from 'crypto';
import { EXT_BY_MIME } from '../mediaTypes.js';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const MEDIA_DIR = path.join(DATA_DIR, 'media');

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    cb(null, MEDIA_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) {
      cb(new Error(`File type ${file.mimetype} not allowed`), '');
      return;
    }
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_TYPES = new Set(Object.keys(EXT_BY_MIME));

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

const router = Router();

router.post('/upload', requireHostPasscode, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const isVideo = req.file.mimetype.startsWith('video/');
  res.json({
    filename: req.file.filename,
    url: `/media/${req.file.filename}`,
    mediaType: isVideo ? 'video' : 'image',
  });
});

router.delete('/:filename', requireHostPasscode, async (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  try {
    await fs.unlink(path.join(MEDIA_DIR, filename));
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
