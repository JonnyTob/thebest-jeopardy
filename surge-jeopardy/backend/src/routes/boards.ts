import { Router } from 'express';
import * as storage from '../storage/boardStorage.js';
import { requireHostPasscode } from '../middleware/requireHostPasscode.js';

const router = Router();

router.get('/', async (_req, res) => {
  const boards = await storage.listBoards();
  res.json(boards);
});

router.get('/:id', async (req, res) => {
  const board = await storage.getBoard(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

router.post('/', requireHostPasscode, async (req, res) => {
  const board = await storage.createBoard(req.body);
  res.status(201).json(board);
});

router.put('/:id', requireHostPasscode, async (req, res) => {
  const board = await storage.updateBoard(req.params.id, req.body);
  if (!board) return res.status(404).json({ error: 'Board not found' });
  res.json(board);
});

router.delete('/:id', requireHostPasscode, async (req, res) => {
  const ok = await storage.deleteBoard(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Board not found' });
  res.status(204).send();
});

export default router;
